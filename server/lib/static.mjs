/**
 * 静态资源托管与压缩热缓存模块（零第三方依赖）
 * - Brotli (br) 优先 + Gzip 自动压缩与 64MB 内存热缓存
 * - PWA 友好缓存头：assets/* 1 年 immutable，index.html / sw.js / manifest 禁止强缓存
 * - ETag 304 协商缓存、HEAD 请求、路径穿越防护与 SPA History 回退
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { promisify } from 'node:util'
import { sendText, setSecurityHeaders } from './http.mjs'

const brotliCompress = promisify(zlib.brotliCompress)
const gzipCompress = promisify(zlib.gzip)

/** 内存压缩缓存上限（64 MB） */
const MAX_CACHE_BYTES = 64 * 1024 * 1024
/** 小于 1 KB 的文件直接原文发送 */
const MIN_COMPRESS_BYTES = 1024

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

const COMPRESSIBLE_EXTS = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.webmanifest',
  '.svg',
  '.wasm',
  '.txt',
  '.xml',
  '.map',
])

const NO_CACHE_FILES = new Set(['index.html', 'sw.js', 'registerSW.js', 'manifest.webmanifest'])

/** 自动解析前端静态产物目录：DIST_DIR -> ./public -> ../dist */
export function resolveDistDir(serverDir) {
  if (process.env.DIST_DIR) {
    return path.resolve(process.cwd(), process.env.DIST_DIR)
  }
  const localPublic = path.resolve(serverDir, 'public')
  if (fs.existsSync(path.join(localPublic, 'index.html'))) {
    return localPublic
  }
  return path.resolve(serverDir, '..', 'dist')
}

/** 创建静态托管处理器 */
export function createStaticHandler({ distDir, enableCompression = true }) {
  const indexHtml = path.join(distDir, 'index.html')
  const hasDist = fs.existsSync(indexHtml)

  const compressedCache = new Map()
  let cachedTotalBytes = 0

  function setCompressedCache(key, mtimeMs, buffer) {
    if (buffer.byteLength > 8 * 1024 * 1024) return
    const existing = compressedCache.get(key)
    if (existing) {
      cachedTotalBytes -= existing.buffer.byteLength
      compressedCache.delete(key)
    }
    while (cachedTotalBytes + buffer.byteLength > MAX_CACHE_BYTES && compressedCache.size > 0) {
      const oldestKey = compressedCache.keys().next().value
      const oldest = compressedCache.get(oldestKey)
      cachedTotalBytes -= oldest.buffer.byteLength
      compressedCache.delete(oldestKey)
    }
    compressedCache.set(key, { mtimeMs, buffer })
    cachedTotalBytes += buffer.byteLength
  }

  function pickEncoding(req, ext, fileSize) {
    if (!enableCompression || fileSize < MIN_COMPRESS_BYTES || !COMPRESSIBLE_EXTS.has(ext)) {
      return null
    }
    const accept = String(req.headers['accept-encoding'] || '').toLowerCase()
    if (accept.includes('br')) return 'br'
    if (accept.includes('gzip')) return 'gzip'
    return null
  }

  function getCacheControl(filePath) {
    const rel = path.relative(distDir, filePath).split(path.sep).join('/')
    const base = path.basename(filePath)
    if (NO_CACHE_FILES.has(base)) return 'no-cache, no-store, must-revalidate'
    if (rel.startsWith('assets/') && !base.startsWith('workbox-')) return 'public, max-age=31536000, immutable'
    return 'public, max-age=86400'
  }

  function buildEtag(stat) {
    return `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
  }

  function resolveSafeFilePath(urlPathname) {
    let decoded
    try {
      decoded = decodeURIComponent(urlPathname)
    } catch {
      return null
    }
    const cleanRel = decoded.replace(/^\/+/, '')
    const resolved = path.resolve(distDir, cleanRel)
    if (resolved !== distDir && !resolved.startsWith(distDir + path.sep)) {
      return null
    }
    return resolved
  }

  async function sendStaticFile(req, res, filePath, statusCode = 200) {
    const stat = await fsp.stat(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const mime = MIME_TYPES[ext] || 'application/octet-stream'
    const etag = buildEtag(stat)

    setSecurityHeaders(res)
    res.setHeader('Content-Type', mime)
    res.setHeader('Cache-Control', getCacheControl(filePath))
    res.setHeader('ETag', etag)
    res.setHeader('Last-Modified', stat.mtime.toUTCString())
    res.setHeader('Vary', 'Accept-Encoding')

    if (statusCode === 200 && req.headers['if-none-match'] === etag) {
      res.writeHead(304)
      res.end()
      return
    }

    const encoding = pickEncoding(req, ext, stat.size)
    if (!encoding) {
      res.setHeader('Content-Length', stat.size)
      res.writeHead(statusCode)
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      fs.createReadStream(filePath).pipe(res)
      return
    }

    const cacheKey = `${filePath}::${encoding}`
    let compressed = compressedCache.get(cacheKey)
    if (!compressed || compressed.mtimeMs !== stat.mtimeMs) {
      const raw = await fsp.readFile(filePath)
      const buf =
        encoding === 'br'
          ? await brotliCompress(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
          : await gzipCompress(raw, { level: 6 })
      setCompressedCache(cacheKey, stat.mtimeMs, buf)
      compressed = { mtimeMs: stat.mtimeMs, buffer: buf }
    }

    res.setHeader('Content-Encoding', encoding)
    res.setHeader('Content-Length', compressed.buffer.byteLength)
    res.writeHead(statusCode)
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(compressed.buffer)
  }

  async function handle(req, res, pathname) {
    const method = req.method || 'GET'
    if (!hasDist) {
      sendText(
        req,
        res,
        503,
        '未找到前端构建产物 dist/index.html，请先执行 pnpm build；当前 /api/* 与 /ws/lan 后端接口可正常供开发联调。',
      )
      return
    }

    if (method !== 'GET' && method !== 'HEAD') {
      sendText(req, res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' })
      return
    }

    const safePath = resolveSafeFilePath(pathname)
    if (!safePath) {
      sendText(req, res, 403, 'Forbidden')
      return
    }

    // 1. 优先匹配真实静态文件
    let targetFile = safePath
    try {
      const st = await fsp.stat(targetFile)
      if (st.isDirectory()) {
        targetFile = path.join(targetFile, 'index.html')
        await fsp.access(targetFile)
      }
      await sendStaticFile(req, res, targetFile, 200)
      return
    } catch {
      // 文件不存在，进入下一步判断
    }

    // 2. 带有文件扩展名的缺失路径准确返回 404，避免把 HTML 当 JS/图片返回
    if (path.extname(pathname) !== '') {
      sendText(req, res, 404, 'Not Found', { 'Cache-Control': 'no-store' })
      return
    }

    // 3. SPA History 路由回退
    await sendStaticFile(req, res, indexHtml, 200)
  }

  return { hasDist, distDir, indexHtml, handle }
}
