/**
 * 轻匣（LiteBox）独立 Node.js 后端与静态部署服务（零第三方依赖）
 *
 * 目录架构：
 * - lib/http.mjs        公共响应封装、安全头与并发控制
 * - lib/cache.mjs       通用 TTL + 容量上限内存缓存
 * - lib/static.mjs      Brotli/Gzip 静态托管、PWA 缓存头与 SPA 回退
 * - routes/speedtest.mjs  /api/speedtest/* 局域网与自建节点网速测试
 * - routes/sporttery.mjs  /api/sporttery/results 体彩赛果大宽表数据代理与缓存
 * - signaling.mjs       /ws/lan 局域网发现、WebRTC 信令与极端网络中转兜底
 */

import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sharedCache } from './lib/cache.mjs'
import { sendJson, sendText } from './lib/http.mjs'
import { createStaticHandler, resolveDistDir } from './lib/static.mjs'
import { handleSpeedtestRoutes } from './routes/speedtest.mjs'
import { handleSportteryRoutes } from './routes/sporttery.mjs'
import { attachLanSignaling } from './signaling.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = Number(process.env.PORT) || 3000
const HOST = process.env.HOST || '0.0.0.0'
const ENABLE_COMPRESSION = process.env.ENABLE_COMPRESSION !== 'false'

const staticHandler = createStaticHandler({
  distDir: resolveDistDir(__dirname),
  enableCompression: ENABLE_COMPRESSION,
})

if (!staticHandler.hasDist) {
  console.warn(`⚠️  未找到前端构建产物：${staticHandler.indexHtml}`)
  console.warn('   静态页面访问将返回 503 提示，但 /api/* 与 /ws/lan 接口可正常供 pnpm dev 联调使用。')
}

let signalingHandle = null

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const pathname = parsedUrl.pathname

    // 1. 健康检查接口（供 Docker / K8s / 反向代理探活）
    if (pathname === '/healthz') {
      sendJson(req, res, 200, {
        ok: true,
        service: 'litebox-server',
        distReady: staticHandler.hasDist,
        compression: ENABLE_COMPRESSION ? 'br+gzip' : 'disabled',
        cache: sharedCache.getStats(),
        signaling: signalingHandle?.getStats() ?? { onlineDevices: 0, activeRooms: 0 },
        uptimeSec: Math.floor(process.uptime()),
      })
      return
    }

    // 2. 业务 API 路由分发
    if (handleSpeedtestRoutes(req, res, pathname, parsedUrl)) return
    if (await handleSportteryRoutes(req, res, pathname, parsedUrl)) return

    // 未知 /api/* 路径明确返回 404 JSON，避免落入 SPA 回退返回 index.html
    if (pathname.startsWith('/api/')) {
      sendJson(req, res, 404, { code: 404, message: `接口不存在: ${req.method} ${pathname}` })
      return
    }

    // 3. 前端静态资源托管与 SPA 回退
    await staticHandler.handle(req, res, pathname)
  } catch (err) {
    console.error('[LiteBox Server Error]', err)
    if (!res.headersSent) {
      sendText(req, res, 500, 'Internal Server Error')
    } else {
      res.end()
    }
  }
})

signalingHandle = attachLanSignaling(server)

server.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST
  console.log(`
  🚀 轻匣（LiteBox）独立后端与静态服务已启动
  ➜  本地访问:   http://${displayHost}:${PORT}
  ➜  无线信令:   ws://${displayHost}:${PORT}/ws/lan
  ➜  网速测试:   http://${displayHost}:${PORT}/api/speedtest/ping
  ➜  赛果接口:   http://${displayHost}:${PORT}/api/sporttery/results
  ➜  健康检查:   http://${displayHost}:${PORT}/healthz
  ➜  静态目录:   ${staticHandler.distDir}${staticHandler.hasDist ? '' : '（未构建，仅 API 与信令可用）'}
  ➜  内容压缩:   ${ENABLE_COMPRESSION ? '已启用 Brotli (优先) + Gzip + 内存热缓存' : '已关闭（由前置代理接管）'}
`)
})

/** 优雅关闭服务 */
const shutdown = (signal) => {
  console.log(`\n收到 ${signal} 信号，正在优雅关闭服务...`)
  sharedCache.close()
  signalingHandle?.close()
  server.close(() => {
    console.log('服务已安全退出。')
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 5000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
