/**
 * 中国体彩竞彩足球赛果大宽表代理与清洗路由（迁移自 sporttery 项目，零第三方依赖）
 * - GET /api/sporttery/results（同时兼容旧路径 GET /api/matches/results）
 * - 自动保护官方 90 天最大日期跨度限制（避免 20007 错误）
 * - 单场开奖赔率并发池限流（并发 6 + 8s 超时）+ 24 小时强缓存，列表结果 5 分钟缓存
 */

import { sharedCache } from '../lib/cache.mjs'
import { runWithConcurrency, sendJson, sendText } from '../lib/http.mjs'

const GATEWAY_URL = 'https://webapi.sporttery.cn'
const REQUEST_TIMEOUT_MS = 8000
const BONUS_CONCURRENCY = 6

const DEFAULT_HEADERS = {
  Referer: 'https://www.sporttery.cn/',
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  Accept: 'application/json, text/plain, */*',
}

/** 格式化日期 YYYY-MM-DD */
function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 校验并规范 YYYY-MM-DD 日期字符串 */
function normalizeDateParam(raw, fallbackDate) {
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    const dt = new Date(`${raw.trim()}T00:00:00`)
    if (!Number.isNaN(dt.getTime())) return raw.trim()
  }
  return formatDate(fallbackDate)
}

/** 获取单场比赛的开奖详细彩果与固定奖金 SP（带 24 小时强缓存） */
async function getMatchFixedBonus(matchId) {
  const cacheKey = `sporttery:fixed_bonus:${matchId}`
  const cached = sharedCache.get(cacheKey)
  if (cached) return cached

  const defaultResult = {
    scoreOdds: '--',
    hadResult: '--',
    hadOdds: '--',
    hhadResult: '--',
    hhadOdds: '--',
    ttgResult: '--',
    ttgOdds: '--',
    hafuResult: '--',
    hafuOdds: '--',
    isSingle: false,
  }

  try {
    const url = `${GATEWAY_URL}/gateway/uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId=${encodeURIComponent(String(matchId))}`
    const response = await fetch(url, {
      headers: DEFAULT_HEADERS,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) return defaultResult

    const json = await response.json()
    if (!json?.success || !json?.value) return defaultResult

    const value = json.value
    const resultList = Array.isArray(value.matchResultList) ? value.matchResultList : []
    const singleList = value.oddsList?.singleList || []
    const hasSingle = Array.isArray(singleList) && singleList.some((s) => s.single === 1)

    const bonusData = { ...defaultResult, isSingle: hasSingle }

    for (const item of resultList) {
      const code = item.code
      const desc = item.combinationDesc || item.combination || ''
      const odds = item.odds || '--'

      switch (code) {
        case 'CRS':
          bonusData.scoreOdds = odds
          break
        case 'HAD':
          bonusData.hadResult = desc
          bonusData.hadOdds = odds
          break
        case 'HHAD':
          bonusData.hhadResult = desc
          bonusData.hhadOdds = odds
          break
        case 'TTG':
          bonusData.ttgResult = desc ? (desc.includes('球') ? desc : `${desc}球`) : '--'
          bonusData.ttgOdds = odds
          break
        case 'HAFU':
          bonusData.hafuResult = desc
          bonusData.hafuOdds = odds
          break
      }
    }

    // 历史完赛开奖赔率不再变动，缓存 24 小时
    sharedCache.set(cacheKey, bonusData, 86400)
    return bonusData
  } catch (err) {
    console.warn(`[sporttery] 获取单场开奖赔率异常 matchId=${matchId}:`, err?.message || err)
    return defaultResult
  }
}

/**
 * 拉取并清洗完赛开奖大宽表（15 列标准字段）
 */
async function getMatchResults({ startDate, endDate, leagueId = '', pageNo = 1, pageSize = 40, forceRefresh = false }) {
  // 官方接口单次最大允许跨度 90 天，超出自动收缩起点，避免 20007 错误
  let queryStartDate = startDate
  let queryEndDate = endDate
  const startTs = new Date(`${startDate}T00:00:00`).getTime()
  const endTs = new Date(`${endDate}T00:00:00`).getTime()
  const maxSpan = 89 * 24 * 60 * 60 * 1000
  if (startTs > endTs) {
    queryStartDate = endDate
    queryEndDate = startDate
  } else if (endTs - startTs > maxSpan) {
    queryStartDate = formatDate(new Date(endTs - maxSpan))
  }

  const cacheKey = `sporttery:results:${queryStartDate}:${queryEndDate}:${leagueId}:${pageNo}:${pageSize}`
  if (!forceRefresh) {
    const cached = sharedCache.get(cacheKey)
    if (cached) return { ...cached, fromCache: true }
  }

  const query = new URLSearchParams({
    matchBeginDate: queryStartDate,
    matchEndDate: queryEndDate,
    leagueId: String(leagueId),
    pageSize: String(pageSize),
    pageNo: String(pageNo),
    isFix: '0',
    matchPage: '1',
    pcOrWap: '1',
  })

  const url = `${GATEWAY_URL}/gateway/uniform/football/getUniformMatchResultV1.qry?${query.toString()}`
  const response = await fetch(url, {
    headers: DEFAULT_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`体彩官方网关返回异常状态 (${response.status})`)
  }

  const json = await response.json()
  if (!json?.success || !json?.value) {
    throw new Error(json?.errorMessage || '体彩官方接口返回赛果数据失败')
  }

  const value = json.value
  const rawList = Array.isArray(value.matchResult) ? value.matchResult : []
  const total = Number(value.total) || rawList.length

  // 受控并发拉取每场固定奖金 SP（避免一次性 40 并发触发官方风控）
  const resultRows = await runWithConcurrency(rawList, BONUS_CONCURRENCY, async (m) => {
    const matchId = m.matchId
    const matchDate = m.matchDate || queryStartDate
    const season = String(matchDate).split('-')[0] || String(new Date().getFullYear())
    const score = m.sectionsNo999 || '--'
    const halfScore = m.sectionsNo1 || '--'

    const bonus = await getMatchFixedBonus(matchId)

    let hadResult = bonus.hadResult
    if (hadResult === '--' && m.winFlag) {
      if (m.winFlag === 'H') hadResult = '胜'
      else if (m.winFlag === 'D') hadResult = '平'
      else if (m.winFlag === 'A') hadResult = '负'
    }

    const fallbackHadOdds = m.h ? (m.winFlag === 'H' ? m.h : m.winFlag === 'D' ? m.d : m.a) : '--'
    const isSingleStr = bonus.isSingle || m.bettingSingle === 1 ? '是' : '否'

    return {
      matchId: m.matchId,
      matchNumStr: m.matchNumStr || '',
      matchDate,
      season,
      league: m.leagueNameAbbr || m.leagueName || '',
      leagueColor: m.leagueBackColor || '3b82f6',
      homeTeam: m.homeTeam || m.allHomeTeam || '',
      awayTeam: m.awayTeam || m.allAwayTeam || '',
      score,
      halfScore,
      scoreOdds: bonus.scoreOdds,
      hadResult,
      hadOdds: bonus.hadOdds !== '--' ? bonus.hadOdds : fallbackHadOdds || '--',
      hhadResult: bonus.hhadResult !== '--' ? bonus.hhadResult : m.goalLine ? `(${m.goalLine})--` : '--',
      hhadOdds: bonus.hhadOdds,
      ttgResult: bonus.ttgResult,
      ttgOdds: bonus.ttgOdds,
      hafuResult: bonus.hafuResult,
      hafuOdds: bonus.hafuOdds,
      isSingle: isSingleStr,
    }
  })

  // 从实际赛果去重提取有效中文联赛，杜绝官方返回纯数字 ID 空白标签问题
  const leagueMap = new Map()
  for (const r of resultRows) {
    if (r.league && !leagueMap.has(r.league)) {
      leagueMap.set(r.league, {
        leagueId: r.league,
        leagueName: r.league,
        leagueAbbName: r.league,
      })
    }
  }

  const formattedResult = {
    total,
    pageNo,
    pageSize,
    queryStartDate,
    queryEndDate,
    lastUpdateTime: value.lastUpdateTime || new Date().toLocaleString('zh-CN'),
    results: resultRows,
    leagueList: Array.from(leagueMap.values()),
  }

  // 分页赛果缓存 5 分钟
  sharedCache.set(cacheKey, formattedResult, 300)
  return { ...formattedResult, fromCache: false }
}

/**
 * 处理 /api/sporttery/* 与兼容路由 /api/matches/results
 * @returns {Promise<boolean>} 是否已匹配并接管响应
 */
export async function handleSportteryRoutes(req, res, pathname, parsedUrl) {
  const isResultsPath = pathname === '/api/sporttery/results' || pathname === '/api/matches/results'
  if (!isResultsPath) return false

  const method = req.method || 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    sendText(req, res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' })
    return true
  }

  try {
    const today = new Date()
    const threeDaysAgo = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000)

    const startDate = normalizeDateParam(parsedUrl.searchParams.get('startDate'), threeDaysAgo)
    const endDate = normalizeDateParam(parsedUrl.searchParams.get('endDate'), today)
    const leagueId = (parsedUrl.searchParams.get('leagueId') || '').trim()
    const rawPageNo = parseInt(parsedUrl.searchParams.get('pageNo') || '1', 10)
    const rawPageSize = parseInt(parsedUrl.searchParams.get('pageSize') || '40', 10)
    const pageNo = Number.isFinite(rawPageNo) && rawPageNo >= 1 ? rawPageNo : 1
    const pageSize = Number.isFinite(rawPageSize) ? Math.max(1, Math.min(100, rawPageSize)) : 40
    const forceRefresh = parsedUrl.searchParams.get('refresh') === '1'

    const data = await getMatchResults({
      startDate,
      endDate,
      leagueId,
      pageNo,
      pageSize,
      forceRefresh,
    })

    sendJson(req, res, 200, {
      code: 0,
      message: 'success',
      data,
    })
  } catch (err) {
    console.error('[sporttery] 获取赛果接口失败:', err)
    sendJson(req, res, 502, {
      code: 502,
      message: err instanceof Error ? err.message : '获取比赛赛果失败，请稍后重试',
    })
  }

  return true
}
