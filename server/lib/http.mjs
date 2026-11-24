/**
 * 公共 HTTP 响应与并发控制工具模块（零第三方依赖）
 */

/** 写入通用安全响应头 */
export function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
}

/** 发送 JSON 响应（自动处理 HEAD 与 Content-Length） */
export function sendJson(req, res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload)
  setSecurityHeaders(res)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

/** 发送纯文本响应 */
export function sendText(req, res, statusCode, text, extraHeaders = {}) {
  setSecurityHeaders(res)
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...extraHeaders,
  })
  res.end(req.method === 'HEAD' ? undefined : text)
}

/**
 * 轻量并发池执行器（按固定顺序返回结果，限制同时在飞请求数防止上游风控）
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
export async function runWithConcurrency(items, concurrency, worker) {
  if (items.length === 0) return []
  const results = new Array(items.length)
  let nextIndex = 0
  const workerCount = Math.max(1, Math.min(concurrency, items.length))

  const runners = Array.from({ length: workerCount }, async () => {
    while (true) {
      const current = nextIndex++
      if (current >= items.length) break
      results[current] = await worker(items[current], current)
    }
  })

  await Promise.all(runners)
  return results
}
