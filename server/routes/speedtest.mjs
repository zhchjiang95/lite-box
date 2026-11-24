/**
 * 局域网 / 自建服务器测速接口模块
 * - GET  /api/speedtest/ping
 * - GET  /api/speedtest/down?bytes=4194304
 * - POST /api/speedtest/up
 */

import crypto from 'node:crypto'
import { sendJson, sendText, setSecurityHeaders } from '../lib/http.mjs'

/** 预生成 1MB 不可压缩随机字节块，循环流式下发（零实时 CPU 开销，防链路压缩虚高） */
const SPEEDTEST_CHUNK = crypto.randomBytes(1024 * 1024)
/** 单次下载/上传测速最大字节上限（64 MB） */
const SPEEDTEST_MAX_BYTES = 64 * 1024 * 1024

/**
 * 处理 /api/speedtest/* 路由
 * @returns {boolean} 是否已匹配并接管响应
 */
export function handleSpeedtestRoutes(req, res, pathname, parsedUrl) {
  if (!pathname.startsWith('/api/speedtest/')) return false

  const method = req.method || 'GET'
  setSecurityHeaders(res)
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.setHeader('Pragma', 'no-cache')

  // 1. 延迟探针
  if (pathname === '/api/speedtest/ping') {
    sendJson(req, res, 200, { ok: true, serverTime: Date.now() })
    return true
  }

  // 2. 下行带宽测速：按请求 bytes 参数流式输出不可压缩随机数据
  if (pathname === '/api/speedtest/down') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendText(req, res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' })
      return true
    }
    const rawBytes = Number(parsedUrl.searchParams.get('bytes')) || 4 * 1024 * 1024
    const totalBytes = Math.max(1024, Math.min(SPEEDTEST_MAX_BYTES, Math.floor(rawBytes)))
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': totalBytes,
      'Content-Encoding': 'identity',
    })
    if (method === 'HEAD') {
      res.end()
      return true
    }

    let remaining = totalBytes
    let aborted = false
    req.on('close', () => {
      aborted = true
    })

    const pump = () => {
      while (remaining > 0 && !aborted) {
        const size = Math.min(remaining, SPEEDTEST_CHUNK.byteLength)
        const slice = size === SPEEDTEST_CHUNK.byteLength ? SPEEDTEST_CHUNK : SPEEDTEST_CHUNK.subarray(0, size)
        remaining -= size
        const ok = res.write(slice)
        if (!ok) {
          res.once('drain', pump)
          return
        }
      }
      if (!aborted) res.end()
    }
    pump()
    return true
  }

  // 3. 上行带宽测速：纯内存丢弃接收流并回报实际字节数与耗时
  if (pathname === '/api/speedtest/up') {
    if (method !== 'POST') {
      sendText(req, res, 405, 'Method Not Allowed', { Allow: 'POST' })
      return true
    }
    const started = performance.now()
    let received = 0
    let tooLarge = false

    req.on('data', (chunk) => {
      received += chunk.byteLength
      if (received > SPEEDTEST_MAX_BYTES && !tooLarge) {
        tooLarge = true
        sendJson(req, res, 413, { ok: false, error: 'Payload too large' })
        req.destroy()
      }
    })
    req.on('end', () => {
      if (tooLarge || res.writableEnded) return
      const durationMs = Math.max(1, performance.now() - started)
      sendJson(req, res, 200, {
        ok: true,
        receivedBytes: received,
        durationMs: Math.round(durationMs),
      })
    })
    return true
  }

  sendJson(req, res, 404, { ok: false, error: 'Unknown speedtest endpoint' })
  return true
}
