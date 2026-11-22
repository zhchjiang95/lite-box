/**
 * 轻匣（LiteBox）独立 Node.js 生产部署服务（零第三方依赖，基于 Node.js 原生模块）
 *
 * 静态目录自动探测优先级：
 *   1. 环境变量 DIST_DIR（显式指定前端构建产物路径）
 *   2. ./public（适合将 server/ 单独拷贝到服务器部署，并将前端 dist/ 内容放入 server/public/）
 *   3. ../dist（在当前仓库内直接启动时，自动读取上级目录的 dist/）
 *
 * 特性：
 * - Brotli (br) 优先 + Gzip 自动内容压缩与内存热缓存（JS/CSS/WASM 传输体积立减 70%~80%）
 * - SPA History 路由回退（刷新 /tools/:id、/category/:id 不 404），缺失静态资源准确返回 404
 * - 针对 PWA 优化缓存头：带哈希资源 1 年 immutable 强缓存，sw.js / index.html / manifest 实时更新
 * - ETag 304 协商缓存、HEAD 请求、路径穿越防护、安全响应头与 /healthz 健康检查
 */

import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const brotliCompress = promisify(zlib.brotliCompress)
const gzipCompress = promisify(zlib.gzip)

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 自动解析静态资源根目录 */
function resolveDistDir() {
  if (process.env.DIST_DIR) {
    return path.resolve(process.cwd(), process.env.DIST_DIR)
  }
  const localPublic = path.resolve(__dirname, 'public')
  if (fs.existsSync(path.join(localPublic, 'index.html'))) {
    return localPublic
  }
  return path.resolve(__dirname, '..', 'dist')
}

const DIST_DIR = resolveDistDir()
const INDEX_HTML = path.join(DIST_DIR, 'index.html')

const PORT = Number(process.env.PORT) || 3000
const HOST = process.env.HOST || '0.0.0.0'
const ENABLE_COMPRESSION = process.env.ENABLE_COMPRESSION !== 'false'

/** 内存压缩缓存上限（64 MB），避免高并发下重复压缩消耗 CPU，同时限制内存占用 */
const MAX_CACHE_BYTES = 64 * 1024 * 1024
/** 小于 1 KB 的文件压缩收益极低，直接原文发送 */
const MIN_COMPRESS_BYTES = 1024

/** 静态资源 MIME 类型映射（覆盖 .mjs / .wasm / .webmanifest 等现代 Web 关键后缀） */
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

/** 适合启用 Brotli / Gzip 压缩的文件后缀（跳过已自带压缩的图片与字体） */
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

/** 不可长期强缓存的 PWA 关键入口文件，确保发版后客户端立刻感知更新 */
const NO_CACHE_FILES = new Set(['index.html', 'sw.js', 'registerSW.js', 'manifest.webmanifest'])

/** 压缩结果内存缓存：key -> { mtimeMs, buffer } */
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

/** 根据请求头 Accept-Encoding 选择最优压缩算法（优先 br，其次 gzip） */
function pickEncoding(req, ext, fileSize) {
  if (!ENABLE_COMPRESSION) return null
  if (fileSize < MIN_COMPRESS_BYTES) return null
  if (!COMPRESSIBLE_EXTS.has(ext)) return null

  const accept = String(req.headers['accept-encoding'] || '').toLowerCase()
  if (accept.includes('br')) return 'br'
  if (accept.includes('gzip')) return 'gzip'
  return null
}

/** 计算文件对应的 Cache-Control 响应头 */
function getCacheControl(filePath) {
  const rel = path.relative(DIST_DIR, filePath).split(path.sep).join('/')
  const base = path.basename(filePath)

  if (NO_CACHE_FILES.has(base)) {
    return 'no-cache, no-store, must-revalidate'
  }
  // Vite 构建的 assets/ 目录文件均带内容哈希，可安全设置 1 年不可变强缓存
  if (rel.startsWith('assets/') && !base.startsWith('workbox-')) {
    return 'public, max-age=31536000, immutable'
  }
  // 其他静态图标、robots.txt 等默认缓存 1 天，配合 ETag 协商校验
  return 'public, max-age=86400'
}

/** 构造弱 ETag，配合 If-None-Match 返回 304 */
function buildEtag(stat) {
  return `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
}

/** 通用安全响应头 */
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
}

/** 将请求 URL 安全映射到静态目录内的绝对路径，防御路径穿越 */
function resolveSafeFilePath(urlPathname) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPathname)
  } catch {
    return null
  }
  const cleanRel = decoded.replace(/^\/+/, '')
  const resolved = path.resolve(DIST_DIR, cleanRel)
  if (resolved !== DIST_DIR && !resolved.startsWith(DIST_DIR + path.sep)) {
    return null
  }
  return resolved
}

/** 发送静态文件（含 ETag 304、HEAD、Brotli/Gzip 压缩与内存热缓存） */
async function sendStaticFile(req, res, filePath, statusCode = 200) {
  const stat = await fsp.stat(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const mime = MIME_TYPES[ext] || 'application/octet-stream'
  const etag = buildEtag(stat)
  const cacheControl = getCacheControl(filePath)

  setSecurityHeaders(res)
  res.setHeader('Content-Type', mime)
  res.setHeader('Cache-Control', cacheControl)
  res.setHeader('ETag', etag)
  res.setHeader('Last-Modified', stat.mtime.toUTCString())
  res.setHeader('Vary', 'Accept-Encoding')

  // ETag 命中直接返回 304 Not Modified
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

  // 尝试命中内存压缩缓存，未命中则压缩并缓存
  const cacheKey = `${filePath}::${encoding}`
  let compressed = compressedCache.get(cacheKey)
  if (!compressed || compressed.mtimeMs !== stat.mtimeMs) {
    const raw = await fsp.readFile(filePath)
    const buf =
      encoding === 'br'
        ? await brotliCompress(raw, {
            params: {
              [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
            },
          })
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

/** 启动前校验静态构建产物是否存在 */
if (!fs.existsSync(INDEX_HTML)) {
  console.error(`❌ 未找到前端构建产物：${INDEX_HTML}`)
  console.error('   请在前端根目录执行 `pnpm build`，或将 dist/ 内容放入 server/public/，或通过 DIST_DIR 指定目录。')
  process.exit(1)
}

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method || 'GET'
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const pathname = parsedUrl.pathname

    // 健康检查接口（供 Docker / K8s / 反向代理探活）
    if (pathname === '/healthz') {
      const body = JSON.stringify({
        ok: true,
        service: 'litebox-server',
        compression: ENABLE_COMPRESSION ? 'br+gzip' : 'disabled',
        uptimeSec: Math.floor(process.uptime()),
      })
      setSecurityHeaders(res)
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body),
      })
      res.end(method === 'HEAD' ? undefined : body)
      return
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' })
      res.end('Method Not Allowed')
      return
    }

    const safePath = resolveSafeFilePath(pathname)
    if (!safePath) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Forbidden')
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
      // 文件不存在，继续走下一步判断
    }

    // 2. 带有文件扩展名的缺失路径准确返回 404，避免把 HTML 当 JS/图片返回
    if (path.extname(pathname) !== '') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end('Not Found')
      return
    }

    // 3. SPA History 路由回退（刷新 /tools/:id、/category/:id 正常渲染）
    await sendStaticFile(req, res, INDEX_HTML, 200)
  } catch (err) {
    console.error('[LiteBox Server Error]', err)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Internal Server Error')
    } else {
      res.end()
    }
  }
})

server.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST
  console.log(`
  🚀 轻匣（LiteBox）独立生产服务已启动
  ➜  本地访问:   http://${displayHost}:${PORT}
  ➜  健康检查:   http://${displayHost}:${PORT}/healthz
  ➜  静态目录:   ${DIST_DIR}
  ➜  内容压缩:   ${ENABLE_COMPRESSION ? '已启用 Brotli (优先) + Gzip + 内存热缓存' : '已关闭（由前置代理接管）'}
`)
})

/** 优雅关闭服务 */
const shutdown = (signal) => {
  console.log(`\n收到 ${signal} 信号，正在优雅关闭服务...`)
  server.close(() => {
    console.log('服务已安全退出。')
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 5000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
