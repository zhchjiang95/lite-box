/**
 * 视频与直播流跨域代理模块（零第三方依赖）
 *
 * 路由：
 * - GET  /api/stream/status    探活与鉴权/并发配置状态
 * - POST /api/stream/auth      校验代理口令
 * - GET  /api/stream/proxy     流式跨域中转（自动重写 M3U8 清单相对/绝对路径，支持 Range 与自定义 Referer/UA）
 *
 * 安全防护：
 * - 口令鉴权：支持 stream.token（或继承 adminToken），使用常量时间比对
 * - SSRF 防护：仅放行 http/https，默认拦截环回/私网/链路本地 IP（跳转目标逐跳校验），
 *   如需代理局域网摄像头或内网 IPTV 源，可在 server/config.json 中设置 stream.allowPrivateIp = true
 * - 零落盘流式管道：实时透传 .ts / .flv / .mp4 字节流，客户端断开即立刻销毁上游连接防止句柄泄漏
 */

import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { serverConfig } from '../lib/config.mjs'
import { sendJson, setSecurityHeaders } from '../lib/http.mjs'

const MAX_REDIRECTS = 5
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

let activeStreams = 0

/** 常量时间口令校验 */
function verifyToken(candidate, expected) {
  if (!expected) return true
  if (typeof candidate !== 'string' || !candidate) return false
  const a = Buffer.from(candidate)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/** 从请求头或查询参数提取口令 */
function extractToken(req, parsedUrl) {
  const headerToken = req.headers['x-stream-token']
  if (typeof headerToken === 'string' && headerToken.trim()) return headerToken.trim()
  const auth = req.headers.authorization
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim()
  }
  const q = parsedUrl.searchParams.get('token')
  return q ? q.trim() : ''
}

/** 读取轻量 JSON Body */
async function readJsonBody(req, maxBytes = 8192) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** 判断 IPv4 是否属于环回、私网、保留或云元数据段 */
function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true // 链路本地 / 云元数据 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a >= 224) return true // 多播与保留
  return false
}

/** 判断 IPv6 是否属于环回、ULA 私网或链路本地 */
function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  if (lower.startsWith('::ffff:')) {
    return isPrivateIPv4(lower.slice(7))
  }
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // fc00::/7 唯一本地地址
  if (/^fe[89ab]/.test(lower)) return true // fe80::/10 链路本地
  return false
}

/** 判断 IP 地址是否为非公网地址 */
function isPrivateIp(ip) {
  const ver = net.isIP(ip)
  if (ver === 4) return isPrivateIPv4(ip)
  if (ver === 6) return isPrivateIPv6(ip)
  return true
}

/** 校验目标 URL 合法性并执行 DNS 解析 SSRF 检查 */
async function validateTargetUrl(rawUrl, allowPrivateIp) {
  let target
  try {
    target = new URL(rawUrl)
  } catch {
    throw Object.assign(new Error('无效的流媒体地址'), { statusCode: 400 })
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw Object.assign(new Error('仅支持 http:// 或 https:// 协议'), { statusCode: 400 })
  }

  if (target.username || target.password) {
    throw Object.assign(new Error('地址不支持内嵌账号密码'), { statusCode: 400 })
  }

  const host = target.hostname.replace(/^\[|\]$/g, '')
  if (!allowPrivateIp) {
    const lowerHost = host.toLowerCase()
    if (lowerHost === 'localhost' || lowerHost.endsWith('.local') || lowerHost.endsWith('.internal')) {
      throw Object.assign(new Error('安全策略已拦截内网或本机地址（可在 server/config.json 开启 stream.allowPrivateIp）'), {
        statusCode: 403,
      })
    }

    if (net.isIP(host)) {
      if (isPrivateIp(host)) {
        throw Object.assign(new Error('安全策略已拦截私网/环回 IP（可在 server/config.json 开启 stream.allowPrivateIp）'), {
          statusCode: 403,
        })
      }
    } else {
      let resolved
      try {
        resolved = await dns.lookup(host, { all: true })
      } catch {
        throw Object.assign(new Error(`域名解析失败：${host}`), { statusCode: 502 })
      }
      if (!resolved.length || resolved.some((r) => isPrivateIp(r.address))) {
        throw Object.assign(new Error('安全策略已拦截解析到私网/环回段的域名'), { statusCode: 403 })
      }
    }
  }

  return target
}

/** 构造指向本服务代理接口的重写地址 */
function buildProxyHref(targetUrl, token, referer, ua) {
  const sp = new URLSearchParams()
  sp.set('url', targetUrl)
  if (token) sp.set('token', token)
  if (referer) sp.set('referer', referer)
  if (ua) sp.set('ua', ua)
  return `/api/stream/proxy?${sp.toString()}`
}

/** 判断响应是否为 M3U8 播放列表 */
function isM3u8Response(finalUrl, contentType, firstChunkStr) {
  const ct = String(contentType || '').toLowerCase()
  if (
    ct.includes('mpegurl') ||
    ct.includes('vnd.apple.mpegurl') ||
    ct.includes('application/x-mpegurl')
  ) {
    return true
  }
  const pathname = new URL(finalUrl).pathname.toLowerCase()
  if (pathname.endsWith('.m3u8') || pathname.endsWith('.m3u')) {
    return true
  }
  if (firstChunkStr && firstChunkStr.trimStart().startsWith('#EXTM3U')) {
    return true
  }
  return false
}

/**
 * 重写 M3U8 清单中的所有相对/绝对 URL：
 * - 普通资源行（子 m3u8 / .ts / .m4s 分片）
 * - 标签内 URI="..."（如 #EXT-X-KEY、#EXT-X-MAP、#EXT-X-MEDIA、#EXT-X-I-FRAME-STREAM-INF）
 */
export function rewriteM3u8Manifest(manifestText, baseUrl, token, referer, ua) {
  const lines = manifestText.split(/\r?\n/)
  const out = lines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed) return line

    if (trimmed.startsWith('#')) {
      // 重写标签属性中的 URI="..."
      if (!trimmed.includes('URI="')) return line
      return line.replace(/URI="([^"]+)"/g, (full, rawUri) => {
        try {
          const abs = new URL(rawUri, baseUrl).toString()
          return `URI="${buildProxyHref(abs, token, referer, ua)}"`
        } catch {
          return full
        }
      })
    }

    try {
      const abs = new URL(trimmed, baseUrl).toString()
      return buildProxyHref(abs, token, referer, ua)
    } catch {
      return line
    }
  })

  return out.join('\n')
}

/** 发起受控上游 HTTP/HTTPS 请求（手动逐跳跟随重定向并校验 SSRF） */
async function requestUpstream(rawUrl, options) {
  let currentUrl = rawUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const target = await validateTargetUrl(currentUrl, options.allowPrivateIp)
    const client = target.protocol === 'https:' ? https : http

    const headers = {
      'User-Agent': options.ua || DEFAULT_UA,
      Accept: '*/*',
      'Accept-Encoding': 'identity',
    }
    if (options.referer) headers.Referer = options.referer
    if (options.range) headers.Range = options.range

    const { upstreamReq, upstreamRes } = await new Promise((resolve, reject) => {
      const uReq = client.request(
        target,
        {
          method: 'GET',
          headers,
          timeout: 15000,
        },
        (uRes) => resolve({ upstreamReq: uReq, upstreamRes: uRes }),
      )
      uReq.on('timeout', () => {
        uReq.destroy(Object.assign(new Error('上游流媒体连接超时'), { statusCode: 504 }))
      })
      uReq.on('error', (err) => {
        reject(Object.assign(new Error(`上游连接失败：${err.message}`), { statusCode: 502 }))
      })
      uReq.end()
    })

    const code = upstreamRes.statusCode || 502
    const loc = upstreamRes.headers.location
    if (code >= 300 && code < 400 && loc) {
      upstreamRes.resume()
      upstreamReq.destroy()
      currentUrl = new URL(loc, target).toString()
      continue
    }

    return { upstreamReq, upstreamRes, finalUrl: target.toString() }
  }

  throw Object.assign(new Error('上游重定向次数过多'), { statusCode: 502 })
}

/** 获取流媒体代理健康摘要（供 /healthz 与启动横幅使用） */
export function getStreamSummary() {
  return {
    enabled: serverConfig.stream.enabled,
    requiresAuth: Boolean(serverConfig.stream.token),
    allowPrivateIp: serverConfig.stream.allowPrivateIp,
    activeStreams,
    maxConcurrent: serverConfig.stream.maxConcurrent,
  }
}

/**
 * 处理 /api/stream/* 路由
 * @returns {Promise<boolean>}
 */
export async function handleStreamRoutes(req, res, pathname, parsedUrl) {
  if (!pathname.startsWith('/api/stream/')) return false

  // CORS 预检放行（兼容播放器 Range / 自定义头）
  if (req.method === 'OPTIONS') {
    setSecurityHeaders(res)
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type, X-Stream-Token, Authorization',
      'Access-Control-Max-Age': '86400',
    })
    res.end()
    return true
  }

  // 1. 状态检测
  if (pathname === '/api/stream/status' && (req.method === 'GET' || req.method === 'HEAD')) {
    sendJson(req, res, 200, {
      ok: true,
      ...getStreamSummary(),
    })
    return true
  }

  if (!serverConfig.stream.enabled) {
    sendJson(req, res, 503, {
      code: 503,
      message: '后端流媒体代理未启用（可在 server/config.json 设置 stream.enabled = true）',
    })
    return true
  }

  // 2. 口令验证
  if (pathname === '/api/stream/auth' && req.method === 'POST') {
    let body = {}
    try {
      body = await readJsonBody(req)
    } catch (err) {
      sendJson(req, res, 400, { code: 400, message: err.message })
      return true
    }
    const token =
      (typeof body.token === 'string' ? body.token.trim() : '') || extractToken(req, parsedUrl)
    if (!verifyToken(token, serverConfig.stream.token)) {
      sendJson(req, res, 401, { code: 401, message: '代理口令不正确' })
      return true
    }
    sendJson(req, res, 200, { ok: true, requiresAuth: Boolean(serverConfig.stream.token) })
    return true
  }

  // 3. 流媒体跨域代理
  if (pathname === '/api/stream/proxy' && req.method === 'GET') {
    const token = extractToken(req, parsedUrl)
    if (!verifyToken(token, serverConfig.stream.token)) {
      sendJson(req, res, 401, {
        code: 401,
        message: '后端代理需要有效口令（请在播放器代理设置中输入口令）',
      })
      return true
    }

    const rawUrl = (parsedUrl.searchParams.get('url') || '').trim()
    if (!rawUrl) {
      sendJson(req, res, 400, { code: 400, message: '缺少目标 url 参数' })
      return true
    }

    if (activeStreams >= serverConfig.stream.maxConcurrent) {
      sendJson(req, res, 429, {
        code: 429,
        message: `流媒体代理并发已达上限（${serverConfig.stream.maxConcurrent}）`,
      })
      return true
    }

    const referer = (parsedUrl.searchParams.get('referer') || '').trim()
    const ua = (parsedUrl.searchParams.get('ua') || '').trim()
    const range = typeof req.headers.range === 'string' ? req.headers.range : ''

    activeStreams++
    let released = false
    const release = () => {
      if (!released) {
        released = true
        activeStreams = Math.max(0, activeStreams - 1)
      }
    }

    try {
      const { upstreamReq, upstreamRes, finalUrl } = await requestUpstream(rawUrl, {
        allowPrivateIp: serverConfig.stream.allowPrivateIp,
        referer,
        ua,
        range,
      })

      const status = upstreamRes.statusCode || 200
      const contentType = upstreamRes.headers['content-type'] || 'application/octet-stream'

      // 客户端提前断开时立即掐断上游流（避免直播 HTTP-FLV 无限连接泄漏）
      const abortUpstream = () => {
        upstreamRes.destroy()
        upstreamReq.destroy()
        release()
      }
      req.once('close', abortUpstream)
      res.once('close', abortUpstream)

      // 嗅探是否为 M3U8 清单：按文件扩展名或 MIME 直接判定，或检视首个字节块
      const likelyPlaylist = isM3u8Response(finalUrl, contentType, '')
      if (likelyPlaylist && status >= 200 && status < 300) {
        const chunks = []
        let total = 0
        for await (const chunk of upstreamRes) {
          total += chunk.length
          if (total > MAX_PLAYLIST_BYTES) {
            upstreamRes.destroy()
            sendJson(req, res, 502, { code: 502, message: 'M3U8 播放列表体积异常过大' })
            release()
            return true
          }
          chunks.push(chunk)
        }
        const rawText = Buffer.concat(chunks).toString('utf8')
        const rewritten = rewriteM3u8Manifest(rawText, finalUrl, token, referer, ua)
        const bodyBuf = Buffer.from(rewritten, 'utf8')
        setSecurityHeaders(res)
        res.writeHead(200, {
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Content-Length': bodyBuf.length,
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        })
        res.end(bodyBuf)
        release()
        return true
      }

      // 常规媒体流（.ts / .flv / .mp4 / 音频分片等）：零缓冲直通管道
      const outHeaders = {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      }
      if (upstreamRes.headers['content-length']) {
        outHeaders['Content-Length'] = upstreamRes.headers['content-length']
      }
      if (upstreamRes.headers['content-range']) {
        outHeaders['Content-Range'] = upstreamRes.headers['content-range']
      }
      if (upstreamRes.headers['accept-ranges']) {
        outHeaders['Accept-Ranges'] = upstreamRes.headers['accept-ranges']
      }

      setSecurityHeaders(res)
      res.writeHead(status, outHeaders)
      upstreamRes.on('end', release)
      upstreamRes.on('error', () => {
        if (!res.writableEnded) res.end()
        release()
      })
      upstreamRes.pipe(res)
      return true
    } catch (err) {
      release()
      const statusCode = err?.statusCode || 502
      if (!res.headersSent) {
        sendJson(req, res, statusCode, {
          code: statusCode,
          message: err instanceof Error ? err.message : '流媒体代理请求失败',
        })
      } else if (!res.writableEnded) {
        res.end()
      }
      return true
    }
  }

  return false
}
