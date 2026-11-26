/**
 * 轻匣（LiteBox）独立 Node.js 后端与静态部署服务（零第三方依赖）
 *
 * 目录架构：
 * - lib/config.mjs      统一配置文件（server/config.json）与环境变量合并加载器
 * - lib/logger.mjs      按天轮转访问日志、按 IP/功能维度聚合统计与运维查询接口
 * - lib/http.mjs        公共响应封装、安全头与并发控制
 * - lib/cache.mjs       通用 TTL + 容量上限内存缓存
 * - lib/static.mjs      Brotli/Gzip 静态托管、PWA 缓存头与 SPA 回退
 * - routes/speedtest.mjs  /api/speedtest/* 局域网与自建节点网速测试
 * - routes/sporttery.mjs  /api/sporttery/results 体彩赛果大宽表数据代理与缓存
 * - routes/magnet.mjs     /api/magnet/* 磁力/种子按需流媒体、ffmpeg 兼容转码与省磁盘缓存管理
 * - routes/tts.mjs        /api/tts/* Edge 神经语音高清 MP3 与同步 SRT 字幕合成（零磁盘占用）
 * - signaling.mjs       /ws/lan 局域网发现、WebRTC 信令与极端网络中转兜底
 */

import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sharedCache } from './lib/cache.mjs'
import { serverConfig } from './lib/config.mjs'
import { sendJson, sendText } from './lib/http.mjs'
import { createAccessLogger } from './lib/logger.mjs'
import { createStaticHandler, resolveDistDir } from './lib/static.mjs'
import { handleSpeedtestRoutes } from './routes/speedtest.mjs'
import { handleSportteryRoutes } from './routes/sporttery.mjs'
import {
  closeMagnetService,
  getMagnetSummary,
  handleMagnetRoutes,
} from './routes/magnet.mjs'
import { getTtsSummary, handleTtsRoutes } from './routes/tts.mjs'
import { attachLanSignaling } from './signaling.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = serverConfig.port
const HOST = serverConfig.host
const ENABLE_COMPRESSION = serverConfig.enableCompression

const staticHandler = createStaticHandler({
  distDir: serverConfig.distDir ? path.resolve(serverConfig.distDir) : resolveDistDir(__dirname),
  enableCompression: ENABLE_COMPRESSION,
})

const accessLogger = createAccessLogger({
  enabled: serverConfig.logging.enabled,
  dir: serverConfig.logging.dir,
  retentionDays: serverConfig.logging.retentionDays,
  consoleOutput: serverConfig.logging.console,
  logStaticAssets: serverConfig.logging.logStaticAssets,
  statsToken: serverConfig.logging.statsToken,
  trustProxy: serverConfig.trustProxy,
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

    // 挂载访问日志与按 IP/功能维度聚合统计
    accessLogger.attachHttpRequest(req, res, pathname, parsedUrl)

    // 1. 健康检查接口（供 Docker / K8s / 反向代理探活）
    if (pathname === '/healthz') {
      sendJson(req, res, 200, {
        ok: true,
        service: 'litebox-server',
        distReady: staticHandler.hasDist,
        compression: ENABLE_COMPRESSION ? 'br+gzip' : 'disabled',
        cache: sharedCache.getStats(),
        signaling: signalingHandle?.getStats() ?? { onlineDevices: 0, activeRooms: 0 },
        magnet: getMagnetSummary(),
        tts: getTtsSummary(),
        logging: accessLogger.getSummary(),
        uptimeSec: Math.floor(process.uptime()),
      })
      return
    }

    // 2. 业务 API 路由分发
    if (accessLogger.handleAdminRoutes(req, res, pathname, parsedUrl)) return
    if (handleSpeedtestRoutes(req, res, pathname, parsedUrl)) return
    if (await handleSportteryRoutes(req, res, pathname, parsedUrl)) return
    if (await handleMagnetRoutes(req, res, pathname, parsedUrl)) return
    if (await handleTtsRoutes(req, res, pathname, parsedUrl)) return

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
// 记录 WebSocket 局域网信令接入（快传/投屏/共享剪贴板）
server.on('upgrade', (req) => {
  accessLogger.logWsConnect(req)
})

server.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST
  const magnetSum = getMagnetSummary()
  const logSum = accessLogger.getSummary()
  console.log(`
  🚀 轻匣（LiteBox）独立后端与静态服务已启动
  ➜  配置文件:   ${serverConfig.configLoaded ? `已加载 ${serverConfig.configPath}` : `未检测到 config.json（可复制 config.example.json 进行配置）`}
  ➜  本地访问:   http://${displayHost}:${PORT}
  ➜  无线信令:   ws://${displayHost}:${PORT}/ws/lan
  ➜  网速测试:   http://${displayHost}:${PORT}/api/speedtest/ping
  ➜  赛果接口:   http://${displayHost}:${PORT}/api/sporttery/results
  ➜  磁力流媒:   http://${displayHost}:${PORT}/api/magnet/status（${magnetSum.enabled ? (magnetSum.requiresAuth ? '口令已保护' : '未设口令') : '已禁用'} | 缓存: ${magnetSum.cacheDir}）
  ➜  语音配音:   http://${displayHost}:${PORT}/api/tts/status（Edge Neural TTS · 纯内存零落盘）
  ➜  访问日志:   ${logSum.enabled ? `${logSum.dir}（保留 ${logSum.retentionDays} 天 | 统计接口: /api/admin/logs/summary）` : '已关闭'}
  ➜  健康检查:   http://${displayHost}:${PORT}/healthz
  ➜  静态目录:   ${staticHandler.distDir}${staticHandler.hasDist ? '' : '（未构建，仅 API 与信令可用）'}
  ➜  内容压缩:   ${ENABLE_COMPRESSION ? '已启用 Brotli (优先) + Gzip + 内存热缓存' : '已关闭（由前置代理接管）'}
`)
})

/** 优雅关闭服务 */
const shutdown = async (signal) => {
  console.log(`\n收到 ${signal} 信号，正在优雅关闭服务...`)
  sharedCache.close()
  signalingHandle?.close()
  accessLogger.close()
  await closeMagnetService().catch(() => {})
  server.close(() => {
    console.log('服务已安全退出。')
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 5000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
