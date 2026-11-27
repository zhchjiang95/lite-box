/**
 * 轻匣（LiteBox）轻量访问日志与按 IP / 功能维度统计模块（零第三方依赖）
 *
 * 核心能力：
 * - 按天轮转落盘：
 *   1) access-YYYY-MM-DD.jsonl  每条有效请求的明细（时间、真实IP、方法、脱敏路径、归类功能、状态码、耗时、UA摘要）
 *   2) stats-YYYY-MM-DD.json    按 IP 与功能聚合的使用次数、首次/末次访问时间与错误/鉴权失败计数（重启自动续接）
 * - 默认过滤 .js/.css/.png/.woff2 等静态碎片噪音，聚焦业务 API、页面工具、WebSocket 频道与异常/越权请求
 * - 自动脱敏 query 中的 token 参数，防止明文口令落盘
 * - 启动与跨天自动清理超过 retentionDays 的过期日志，严控磁盘空间
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { sendJson } from './http.mjs'

const STATIC_NOISE_EXTS = new Set([
  '.js',
  '.mjs',
  '.css',
  '.map',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.avif',
  '.gif',
  '.svg',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.wasm',
  '.webmanifest',
])

const pad2 = (n) => String(n).padStart(2, '0')

/** 格式化本地日期 YYYY-MM-DD */
export function formatLocalDate(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 格式化本地时间 YYYY-MM-DD HH:mm:ss */
export function formatLocalDateTime(d = new Date()) {
  return `${formatLocalDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

/**
 * 提取客户端真实 IP
 * trustProxy=false（默认，直接端口转发）时强制取 TCP 底层远端地址，杜绝伪造 X-Forwarded-For 绕过限次；
 * trustProxy=true（前置 Nginx/Caddy 反代）时才读取 X-Forwarded-For / X-Real-IP。
 */
export function extractClientIp(req, trustProxy = false) {
  let raw = ''
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for']
    if (typeof xff === 'string' && xff.trim()) {
      raw = xff.split(',')[0].trim()
    } else if (typeof req.headers['x-real-ip'] === 'string' && req.headers['x-real-ip'].trim()) {
      raw = req.headers['x-real-ip'].trim()
    }
  }
  if (!raw) {
    raw = req.socket?.remoteAddress || 'unknown'
  }
  if (raw.startsWith('::ffff:')) return raw.slice(7)
  if (raw === '::1') return '127.0.0.1'
  return raw || 'unknown'
}

/** 判断是否本机环回 IP */
export function isLoopbackIp(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost'
}

/** 脱敏路径与查询串中的敏感参数（如 token） */
export function sanitizeRequestTarget(rawUrl) {
  try {
    const u = new URL(rawUrl || '/', 'http://localhost')
    for (const key of ['token', 'key', 'password', 'secret']) {
      if (u.searchParams.has(key)) {
        u.searchParams.set(key, '***')
      }
    }
    const q = u.searchParams.toString()
    return q ? `${u.pathname}?${q}` : u.pathname
  } catch {
    return String(rawUrl || '/').slice(0, 200)
  }
}

/** 将请求归类为易读的中文功能名与标准化接口 Key */
export function classifyFeature(method, pathname, parsedUrl) {
  // 1. 磁力流媒体
  if (pathname.startsWith('/api/magnet/')) {
    if (pathname === '/api/magnet/status') return { feature: '磁力播放 · 状态检测', endpoint: 'GET /api/magnet/status', isPollNoise: false }
    if (pathname === '/api/magnet/auth') return { feature: '磁力播放 · 口令验证', endpoint: 'POST /api/magnet/auth', isPollNoise: false }
    if (pathname === '/api/magnet/tasks' && method === 'POST') return { feature: '磁力播放 · 解析任务', endpoint: 'POST /api/magnet/tasks', isPollNoise: false }
    if (pathname === '/api/magnet/tasks' && method === 'GET') return { feature: '磁力播放 · 进度查询', endpoint: 'GET /api/magnet/tasks', isPollNoise: true }
    if (pathname === '/api/magnet/cache/clear') return { feature: '磁力播放 · 清空缓存', endpoint: 'POST /api/magnet/cache/clear', isPollNoise: false }
    if (/^\/api\/magnet\/tasks\/[a-f0-9]{40}\/stop$/i.test(pathname)) return { feature: '磁力播放 · 停止下载', endpoint: 'POST /api/magnet/tasks/:hash/stop', isPollNoise: false }
    if (/^\/api\/magnet\/tasks\/[a-f0-9]{40}$/i.test(pathname)) return { feature: '磁力播放 · 删除任务', endpoint: 'DELETE /api/magnet/tasks/:hash', isPollNoise: false }
    if (pathname.startsWith('/api/magnet/stream/')) return { feature: '磁力播放 · 原生流媒', endpoint: 'GET /api/magnet/stream', isPollNoise: false }
    if (pathname.startsWith('/api/magnet/transcode/')) return { feature: '磁力播放 · FFmpeg转码', endpoint: 'GET /api/magnet/transcode', isPollNoise: false }
    if (pathname.startsWith('/api/magnet/subtitle/')) return { feature: '磁力播放 · 字幕提取', endpoint: 'GET /api/magnet/subtitle', isPollNoise: false }
    return { feature: '磁力播放 · 其他接口', endpoint: `${method} /api/magnet/*`, isPollNoise: false }
  }

  // 2. 文字转语音
  if (pathname.startsWith('/api/tts/')) {
    if (pathname === '/api/tts/synthesize') return { feature: '文字转语音 · 合成MP3', endpoint: 'POST /api/tts/synthesize', isPollNoise: false }
    if (pathname === '/api/tts/auth') return { feature: '文字转语音 · 口令解锁', endpoint: 'POST /api/tts/auth', isPollNoise: false }
    if (pathname === '/api/tts/preview') return { feature: '文字转语音 · 试听样音', endpoint: 'GET /api/tts/preview', isPollNoise: false }
    if (pathname === '/api/tts/voices') return { feature: '文字转语音 · 音色列表', endpoint: 'GET /api/tts/voices', isPollNoise: false }
    if (pathname === '/api/tts/status') return { feature: '文字转语音 · 状态检测', endpoint: 'GET /api/tts/status', isPollNoise: false }
    return { feature: '文字转语音 · 其他接口', endpoint: `${method} /api/tts/*`, isPollNoise: false }
  }

  // 2.5 视频与直播流代理
  if (pathname.startsWith('/api/stream/')) {
    if (pathname === '/api/stream/proxy') return { feature: '视频直播 · 跨域代理', endpoint: 'GET /api/stream/proxy', isPollNoise: true }
    if (pathname === '/api/stream/auth') return { feature: '视频直播 · 代理口令', endpoint: 'POST /api/stream/auth', isPollNoise: false }
    if (pathname === '/api/stream/status') return { feature: '视频直播 · 状态检测', endpoint: 'GET /api/stream/status', isPollNoise: false }
    return { feature: '视频直播 · 其他接口', endpoint: `${method} /api/stream/*`, isPollNoise: false }
  }

  // 3. 网速测试
  if (pathname.startsWith('/api/speedtest/')) {
    if (pathname === '/api/speedtest/down') return { feature: '网速测试 · 下行测速', endpoint: 'GET /api/speedtest/down', isPollNoise: false }
    if (pathname === '/api/speedtest/up') return { feature: '网速测试 · 上行测速', endpoint: 'POST /api/speedtest/up', isPollNoise: false }
    if (pathname === '/api/speedtest/ping') return { feature: '网速测试 · 延迟探针', endpoint: 'GET /api/speedtest/ping', isPollNoise: true }
    return { feature: '网速测试 · 其他', endpoint: `${method} /api/speedtest/*`, isPollNoise: false }
  }

  // 4. 竞彩赛果
  if (pathname === '/api/sporttery/results' || pathname === '/api/matches/results') {
    return { feature: '竞彩赛果 · 数据查询', endpoint: 'GET /api/sporttery/results', isPollNoise: false }
  }

  // 5. 运维统计
  if (pathname.startsWith('/api/admin/logs')) {
    return { feature: '系统运维 · 日志统计', endpoint: `${method} ${pathname}`, isPollNoise: false }
  }

  // 6. 局域网 WebSocket 信令
  if (pathname === '/ws/lan') {
    const ch = parsedUrl?.searchParams?.get('channel') || 'transfer'
    const labelMap = {
      transfer: '隔空快传',
      screen: '无线投屏',
      clipboard: '共享剪贴板',
    }
    return {
      feature: `局域网互联 · ${labelMap[ch] || ch}`,
      endpoint: `WS /ws/lan?channel=${ch}`,
      isPollNoise: false,
    }
  }

  // 7. 工具页面访问（SPA 直达路由）
  const toolMatch = pathname.match(/^\/tools\/([a-z0-9-]+)$/i)
  if (toolMatch) {
    return { feature: `工具页 · ${toolMatch[1]}`, endpoint: `GET /tools/${toolMatch[1]}`, isPollNoise: false }
  }
  const catMatch = pathname.match(/^\/category\/([a-z0-9-]+)$/i)
  if (catMatch) {
    return { feature: `分类页 · ${catMatch[1]}`, endpoint: `GET /category/${catMatch[1]}`, isPollNoise: false }
  }
  if (pathname === '/' || pathname === '/index.html') {
    return { feature: '首页访问', endpoint: 'GET /', isPollNoise: false }
  }
  if (pathname === '/healthz') {
    return { feature: '健康检查', endpoint: 'GET /healthz', isPollNoise: true }
  }
  if (pathname.startsWith('/api/')) {
    return { feature: '未知 API 路径', endpoint: `${method} ${pathname}`, isPollNoise: false }
  }
  return { feature: '静态资源/其他页面', endpoint: `${method} ${pathname}`, isPollNoise: false }
}

/** 精简 User-Agent，方便日志一眼看清终端类型 */
function simplifyUserAgent(ua) {
  const s = String(ua || '')
  if (!s) return 'unknown'
  const browser =
    s.includes('Edg/') ? 'Edge'
    : s.includes('Chrome/') ? 'Chrome'
    : s.includes('Firefox/') ? 'Firefox'
    : s.includes('Safari/') && !s.includes('Chrome') ? 'Safari'
    : s.includes('PotPlayer') ? 'PotPlayer'
    : s.includes('VLC') ? 'VLC'
    : s.includes('IINA') ? 'IINA'
    : s.includes('curl/') ? 'curl'
    : s.slice(0, 24)
  const os =
    s.includes('Windows') ? 'Win'
    : s.includes('Mac OS X') || s.includes('Macintosh') ? 'macOS'
    : s.includes('iPhone') || s.includes('iPad') ? 'iOS'
    : s.includes('Android') ? 'Android'
    : s.includes('Linux') ? 'Linux'
    : ''
  return os ? `${browser}/${os}` : browser
}

/** 构造空白每日统计结构 */
function createEmptyDayStats(dateStr) {
  return {
    date: dateStr,
    updatedAt: formatLocalDateTime(),
    totalRequests: 0,
    byFeature: {},
    byIp: {},
  }
}

/** 创建服务端访问日志与统计管理器 */
export function createAccessLogger(options) {
  const {
    enabled = true,
    dir,
    retentionDays = 14,
    consoleOutput = true,
    logStaticAssets = false,
    statsToken = '',
    trustProxy = false,
  } = options

  let currentDate = formatLocalDate()
  let dayStats = createEmptyDayStats(currentDate)
  let dirty = false
  const recentRecords = [] // 内存中保留最近 200 条记录供快速查询
  const MAX_RECENT = 200

  function getJsonlPath(dateStr) {
    return path.join(dir, `access-${dateStr}.jsonl`)
  }

  function getStatsPath(dateStr) {
    return path.join(dir, `stats-${dateStr}.json`)
  }

  /** 启动时确保日志目录存在、续接当日统计、并清扫过期旧日志 */
  function initSync() {
    if (!enabled) return
    try {
      fs.mkdirSync(dir, { recursive: true })
      const todayFile = getStatsPath(currentDate)
      if (fs.existsSync(todayFile)) {
        const parsed = JSON.parse(fs.readFileSync(todayFile, 'utf8'))
        if (parsed && parsed.date === currentDate && parsed.byIp && parsed.byFeature) {
          dayStats = parsed
        }
      }
      cleanupExpiredLogsSync()
    } catch (err) {
      console.warn('[AccessLogger] 初始化日志目录失败:', err.message)
    }
  }

  /** 清理超过 retentionDays 天的旧日志文件（严控磁盘占用） */
  function cleanupExpiredLogsSync() {
    if (!enabled) return
    const cutoffMs = Date.now() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000
    try {
      for (const name of fs.readdirSync(dir)) {
        const m = name.match(/^(?:access|stats)-(\d{4}-\d{2}-\d{2})\.(?:jsonl|json)$/)
        if (!m) continue
        const fileDateMs = Date.parse(`${m[1]}T00:00:00`)
        if (Number.isFinite(fileDateMs) && fileDateMs < cutoffMs) {
          fs.rmSync(path.join(dir, name), { force: true })
        }
      }
    } catch {
      // 忽略单个文件删除失败
    }
  }

  /** 将内存聚合统计安全刷盘（原子写入防中断损坏） */
  function flushStatsSync() {
    if (!enabled || !dirty) return
    dirty = false
    dayStats.updatedAt = formatLocalDateTime()
    const target = getStatsPath(currentDate)
    const tmp = `${target}.tmp`
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(tmp, JSON.stringify(dayStats, null, 2), 'utf8')
      fs.renameSync(tmp, target)
    } catch {
      // Windows 极少数重命名占用时直接覆盖写
      try {
        fs.writeFileSync(target, JSON.stringify(dayStats, null, 2), 'utf8')
      } catch {
        // 忽略
      }
    }
  }

  /** 检测跨天并切换日志文件 */
  function rotateIfNeeded(now) {
    const today = formatLocalDate(now)
    if (today !== currentDate) {
      flushStatsSync()
      currentDate = today
      dayStats = createEmptyDayStats(currentDate)
      cleanupExpiredLogsSync()
    }
  }

  /** 判断是否忽略静态碎片文件 */
  function shouldSkip(pathname, statusCode) {
    if (logStaticAssets) return false
    // 4xx/5xx 异常请求一律记录，便于排查扫描与越权尝试
    if (statusCode >= 400) return false
    const ext = path.extname(pathname).toLowerCase()
    if (ext && STATIC_NOISE_EXTS.has(ext)) return true
    if (pathname === '/sw.js' || pathname === '/registerSW.js' || pathname === '/robots.txt') {
      return true
    }
    return false
  }

  /** 记录一条访问事件（HTTP 或 WebSocket） */
  function recordEvent({ ip, method, rawUrl, pathname, parsedUrl, statusCode, durationMs, bytes, userAgent }) {
    if (!enabled) return
    if (shouldSkip(pathname, statusCode)) return

    const now = new Date()
    rotateIfNeeded(now)
    const timeStr = formatLocalDateTime(now)
    const { feature, endpoint, isPollNoise } = classifyFeature(method, pathname, parsedUrl)
    const safeUrl = sanitizeRequestTarget(rawUrl)
    const uaShort = simplifyUserAgent(userAgent)

    // 1. 更新按 IP 与按功能聚合统计
    dayStats.totalRequests += 1

    if (!dayStats.byFeature[feature]) {
      dayStats.byFeature[feature] = { count: 0, ips: [], lastAt: timeStr }
    }
    const featEntry = dayStats.byFeature[feature]
    featEntry.count += 1
    featEntry.lastAt = timeStr
    if (!featEntry.ips.includes(ip) && featEntry.ips.length < 500) {
      featEntry.ips.push(ip)
    }

    if (!dayStats.byIp[ip]) {
      dayStats.byIp[ip] = {
        totalCount: 0,
        errorCount: 0,
        authFailCount: 0,
        firstSeen: timeStr,
        lastSeen: timeStr,
        lastUa: uaShort,
        features: {},
        endpoints: {},
      }
    }
    const ipEntry = dayStats.byIp[ip]
    ipEntry.totalCount += 1
    ipEntry.lastSeen = timeStr
    ipEntry.lastUa = uaShort
    if (statusCode === 401 || statusCode === 403) ipEntry.authFailCount += 1
    else if (statusCode >= 400) ipEntry.errorCount += 1

    if (!ipEntry.features[feature]) {
      ipEntry.features[feature] = { count: 0, lastAt: timeStr }
    }
    ipEntry.features[feature].count += 1
    ipEntry.features[feature].lastAt = timeStr
    ipEntry.endpoints[endpoint] = (ipEntry.endpoints[endpoint] || 0) + 1
    dirty = true

    // 2. 高频轮询（如磁力 2.5s 进度查询、ping）照常记入汇总次数，但默认不刷爆控制台与明细（除非出错）
    if (isPollNoise && statusCode < 400) return

    const entry = {
      time: timeStr,
      ip,
      method,
      path: safeUrl,
      feature,
      status: statusCode,
      durationMs: Math.round(durationMs),
      bytes: bytes || 0,
      ua: uaShort,
    }

    recentRecords.unshift(entry)
    if (recentRecords.length > MAX_RECENT) recentRecords.length = MAX_RECENT

    // 异步追加写入每日 JSONL 明细文件
    fsp.appendFile(getJsonlPath(currentDate), `${JSON.stringify(entry)}\n`, 'utf8').catch(() => {})

    if (consoleOutput) {
      const statusTag = statusCode >= 400 ? `!${statusCode}` : String(statusCode)
      console.log(
        `[${timeStr}] ${ip} | ${feature} | ${method} ${safeUrl} -> ${statusTag} (${entry.durationMs}ms) [${uaShort}]`,
      )
    }
  }

  /** 包装 HTTP 请求自动记录耗时与状态码 */
  function attachHttpRequest(req, res, pathname, parsedUrl) {
    if (!enabled) return
    const startHr = process.hrtime.bigint()
    const ip = extractClientIp(req, trustProxy)
    const method = req.method || 'GET'
    const rawUrl = req.url || '/'
    const userAgent = req.headers['user-agent'] || ''

    res.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startHr) / 1e6
      const contentLen = Number(res.getHeader('content-length')) || 0
      recordEvent({
        ip,
        method,
        rawUrl,
        pathname,
        parsedUrl,
        statusCode: res.statusCode || 200,
        durationMs,
        bytes: contentLen,
        userAgent,
      })
    })
  }

  /** 记录 WebSocket 连接事件 */
  function logWsConnect(req) {
    if (!enabled) return
    try {
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
      recordEvent({
        ip: extractClientIp(req, trustProxy),
        method: 'WS',
        rawUrl: req.url || '/ws/lan',
        pathname: parsedUrl.pathname,
        parsedUrl,
        statusCode: 101,
        durationMs: 0,
        bytes: 0,
        userAgent: req.headers['user-agent'] || '',
      })
    } catch {
      // 忽略异常 URL
    }
  }

  /** 校验查看统计接口权限（有口令验口令，无口令仅允许本机 127.0.0.1 访问防外网泄密） */
  function verifyStatsAccess(req, parsedUrl) {
    const ip = extractClientIp(req, trustProxy)
    if (statsToken) {
      const candidate =
        String(req.headers['x-log-token'] || '').trim() ||
        String(parsedUrl.searchParams.get('token') || '').trim()
      if (!candidate) return false
      const a = Buffer.from(candidate, 'utf8')
      const b = Buffer.from(statsToken, 'utf8')
      if (a.length !== b.length) return false
      return crypto.timingSafeEqual(a, b)
    }
    return isLoopbackIp(ip)
  }

  /** 处理运维日志统计查询接口 GET /api/admin/logs/summary */
  function handleAdminRoutes(req, res, pathname, parsedUrl) {
    if (pathname !== '/api/admin/logs/summary' || req.method !== 'GET') return false

    if (!verifyStatsAccess(req, parsedUrl)) {
      sendJson(req, res, 401, {
        code: 401,
        message: statsToken
          ? '需要运维口令（X-Log-Token 或 ?token=）'
          : '未配置统计口令时，仅允许本机 127.0.0.1 查看访问日志统计',
      })
      return true
    }

    const reqDate = (parsedUrl.searchParams.get('date') || currentDate).trim()
    const recentLimit = Math.min(200, Math.max(0, Number(parsedUrl.searchParams.get('recent')) || 30))

    if (!/^\d{4}-\d{2}-\d{2}$/.test(reqDate)) {
      sendJson(req, res, 400, { code: 400, message: 'date 参数格式必须为 YYYY-MM-DD' })
      return true
    }

    let statsData = null
    if (reqDate === currentDate) {
      statsData = {
        ...dayStats,
        uniqueIps: Object.keys(dayStats.byIp).length,
      }
    } else {
      const target = getStatsPath(reqDate)
      if (fs.existsSync(target)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(target, 'utf8'))
          statsData = { ...parsed, uniqueIps: Object.keys(parsed.byIp || {}).length }
        } catch {
          statsData = null
        }
      }
    }

    // 列出当前日志目录中已保存的日期清单
    let availableDates = []
    try {
      availableDates = fs
        .readdirSync(dir)
        .map((n) => n.match(/^stats-(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
        .filter(Boolean)
        .sort()
        .reverse()
    } catch {
      availableDates = []
    }

    sendJson(req, res, 200, {
      enabled,
      logDir: dir,
      retentionDays,
      date: reqDate,
      availableDates,
      stats: statsData,
      recent: reqDate === currentDate ? recentRecords.slice(0, recentLimit) : [],
    })
    return true
  }

  initSync()

  // 每 15 秒将内存统计刷盘一次，避免高频磁盘 IO 同时保证数据新鲜
  const flushTimer = enabled
    ? setInterval(() => {
        flushStatsSync()
      }, 15 * 1000)
    : null
  flushTimer?.unref()

  return {
    attachHttpRequest,
    logWsConnect,
    handleAdminRoutes,
    flushStatsSync,
    getSummary() {
      return {
        enabled,
        dir,
        retentionDays,
        todayRequests: dayStats.totalRequests,
        todayUniqueIps: Object.keys(dayStats.byIp).length,
      }
    },
    close() {
      if (flushTimer) clearInterval(flushTimer)
      flushStatsSync()
    },
  }
}
