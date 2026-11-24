/**
 * 竞彩足球赛果大宽表：类型定义、接口请求与 Excel/CSV 导出引擎
 */

/** 严格匹配 15 列大宽表字段 */
export interface MatchResultRow {
  matchId: number | string
  matchNumStr: string
  matchDate: string
  /** 1. 赛季 */
  season: string
  /** 2. 联赛 */
  league: string
  leagueColor: string
  /** 3. 主队 */
  homeTeam: string
  /** 4. 客队 */
  awayTeam: string
  /** 5. 全场比分 */
  score: string
  /** 半场比分 */
  halfScore: string
  /** 6. 比分赔率 */
  scoreOdds: string
  /** 7. 胜/平/负 */
  hadResult: string
  /** 8. 胜平负赔率 */
  hadOdds: string
  /** 9. 让球胜/平/负 */
  hhadResult: string
  /** 10. 让球赔率 */
  hhadOdds: string
  /** 11. 总进球 */
  ttgResult: string
  /** 12. 总进球赔率 */
  ttgOdds: string
  /** 13. 半全场 */
  hafuResult: string
  /** 14. 半全场赔率 */
  hafuOdds: string
  /** 15. 是否单关 */
  isSingle: string
}

export interface LeagueOption {
  leagueId: string
  leagueName: string
  leagueAbbName: string
  count: number
}

export interface MatchResultsResponse {
  total: number
  pageNo: number
  pageSize: number
  queryStartDate?: string
  queryEndDate?: string
  lastUpdateTime: string
  fromCache?: boolean
  results: MatchResultRow[]
  leagueList: { leagueId: string; leagueName: string; leagueAbbName: string }[]
}

export interface FetchMatchResultsParams {
  startDate: string
  endDate: string
  leagueId?: string
  pageNo?: number
  pageSize?: number
  refresh?: boolean
  signal?: AbortSignal
}

/** 格式化日期 YYYY-MM-DD */
export function formatYYYYMMDD(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 请求后端赛果大宽表代理接口 */
export async function fetchMatchResults(params: FetchMatchResultsParams): Promise<MatchResultsResponse> {
  const qs = new URLSearchParams()
  qs.set('startDate', params.startDate)
  qs.set('endDate', params.endDate)
  if (params.leagueId) qs.set('leagueId', params.leagueId)
  qs.set('pageNo', String(params.pageNo ?? 1))
  qs.set('pageSize', String(params.pageSize ?? 40))
  if (params.refresh) qs.set('refresh', '1')

  const response = await fetch(`/api/sporttery/results?${qs.toString()}`, {
    cache: 'no-store',
    signal: params.signal,
  })

  const ct = response.headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    throw new Error('未连接到后端赛果服务（请确认已运行 server/index.mjs，开发期由 Vite 自动代理 /api）')
  }

  const json = (await response.json()) as { code?: number; message?: string; data?: MatchResultsResponse }
  if (!response.ok || json.code !== 0 || !json.data) {
    throw new Error(json.message || `获取赛果失败 (HTTP ${response.status})`)
  }
  return json.data
}

/** 将赔率字符串解析为可比较数值（无效时返回 -1 排至末尾） */
export function parseOddsNumber(raw: string): number {
  const num = Number.parseFloat(raw)
  return Number.isFinite(num) ? num : -1
}

/** 15 列标准 Excel 表头（严格对应 A–O 列） */
export const WIDE_TABLE_HEADERS = [
  '赛季',
  '日期/场次',
  '联赛',
  '主队',
  '客队',
  '比分',
  '半场',
  '比分赔率',
  '胜/平/负',
  '胜平负赔率',
  '让球胜/平/负',
  '让球赔率',
  '总进球',
  '总进球赔率',
  '半全场',
  '半全场赔率',
  '是否单关',
]

function rowToExportCells(row: MatchResultRow): string[] {
  return [
    row.season,
    [row.matchDate, row.matchNumStr].filter(Boolean).join(' '),
    row.league,
    row.homeTeam,
    row.awayTeam,
    row.score,
    row.halfScore,
    row.scoreOdds,
    row.hadResult,
    row.hadOdds,
    row.hhadResult,
    row.hhadOdds,
    row.ttgResult,
    row.ttgOdds,
    row.hafuResult,
    row.hafuOdds,
    row.isSingle,
  ]
}

/** 生成带 UTF-8 BOM 的 Excel 兼容 CSV 字符串 */
export function buildResultsCsv(rows: MatchResultRow[]): string {
  const escapeCsv = (cell: string) => {
    const s = String(cell ?? '')
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [
    WIDE_TABLE_HEADERS.map(escapeCsv).join(','),
    ...rows.map((r) => rowToExportCells(r).map(escapeCsv).join(',')),
  ]
  return '\uFEFF' + lines.join('\r\n')
}

/** 生成制表符分隔文本（直接粘贴进 Excel / WPS / 飞书表格自动分列） */
export function buildResultsTsv(rows: MatchResultRow[]): string {
  const clean = (cell: string) => String(cell ?? '').replace(/[\t\r\n]+/g, ' ')
  return [
    WIDE_TABLE_HEADERS.map(clean).join('\t'),
    ...rows.map((r) => rowToExportCells(r).map(clean).join('\t')),
  ].join('\n')
}

/** 从已加载赛果中去重提取联赛选项并按场次降序排列 */
export function extractLeagues(list: MatchResultRow[]): LeagueOption[] {
  const map = new Map<string, number>()
  for (const item of list) {
    const name = (item.league || '').trim()
    if (name && name !== '--') {
      map.set(name, (map.get(name) || 0) + 1)
    }
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({
      leagueId: name,
      leagueName: name,
      leagueAbbName: name,
      count,
    }))
}
