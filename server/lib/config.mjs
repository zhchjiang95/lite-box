/**
 * 轻匣（LiteBox）服务端统一配置加载器（零第三方依赖）
 *
 * 加载优先级：环境变量（process.env） > server/config.json > 内置默认值
 * 可通过环境变量 CONFIG_PATH 指定自定义 JSON 配置文件路径。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = path.resolve(__dirname, '..')

/** 解析布尔值（兼容环境变量字符串与 JSON 布尔值） */
function parseBool(envVal, fileVal, defaultVal) {
  if (envVal !== undefined && envVal !== '') {
    const normalized = String(envVal).trim().toLowerCase()
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
      return false
    }
    return true
  }
  if (typeof fileVal === 'boolean') return fileVal
  return defaultVal
}

/** 解析数值（兼容环境变量字符串与 JSON 数值） */
function parseNum(envVal, fileVal, defaultVal) {
  if (envVal !== undefined && envVal !== '') {
    const n = Number(envVal)
    if (Number.isFinite(n)) return n
  }
  if (typeof fileVal === 'number' && Number.isFinite(fileVal)) return fileVal
  return defaultVal
}

/** 解析字符串 */
function parseStr(envVal, fileVal, defaultVal) {
  if (envVal !== undefined) return String(envVal).trim()
  if (typeof fileVal === 'string') return fileVal.trim()
  return defaultVal
}

/** 加载并合并服务端配置 */
export function loadServerConfig() {
  const configPath = process.env.CONFIG_PATH
    ? path.resolve(process.env.CONFIG_PATH)
    : path.join(SERVER_ROOT, 'config.json')

  let fileConfig = {}
  let configLoaded = false

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        fileConfig = parsed
        configLoaded = true
      } else {
        console.warn(`⚠️  配置文件根结构必须是 JSON 对象，已忽略：${configPath}`)
      }
    } catch (err) {
      console.error(`❌ 解析配置文件失败：${configPath}`)
      console.error(`   错误详情：${err.message}`)
      console.error('   请检查 JSON 语法（Windows 路径请使用正斜杠 "D:/LiteBoxCache" 或双反斜杠 "D:\\\\LiteBoxCache"）。')
      process.exit(1)
    }
  }

  const magnetFile =
    fileConfig.magnet && typeof fileConfig.magnet === 'object' ? fileConfig.magnet : {}
  const ttsFile = fileConfig.tts && typeof fileConfig.tts === 'object' ? fileConfig.tts : {}
  const streamFile =
    fileConfig.stream && typeof fileConfig.stream === 'object' ? fileConfig.stream : {}
  const logFile =
    fileConfig.logging && typeof fileConfig.logging === 'object' ? fileConfig.logging : {}

  const rawLogDir = parseStr(process.env.LOG_DIR, logFile.dir, '')
  const logDir = rawLogDir ? path.resolve(SERVER_ROOT, rawLogDir) : path.join(SERVER_ROOT, 'logs')

  const rawCacheDir = parseStr(process.env.MAGNET_CACHE_DIR, magnetFile.cacheDir, '')
  const cacheDir = rawCacheDir
    ? path.resolve(rawCacheDir)
    : path.resolve(path.join(os.tmpdir(), 'litebox-magnet'))

  const rawDistDir = parseStr(process.env.DIST_DIR, fileConfig.distDir, '')
  const adminToken = parseStr(process.env.ADMIN_TOKEN, fileConfig.adminToken, '')
  const magnetToken = parseStr(process.env.MAGNET_TOKEN, magnetFile.token, '') || adminToken
  const ttsToken = parseStr(process.env.TTS_TOKEN, ttsFile.token, '') || adminToken
  const streamToken = parseStr(process.env.STREAM_TOKEN, streamFile.token, '') || adminToken
  const statsToken =
    parseStr(process.env.LOG_STATS_TOKEN, logFile.statsToken, '') ||
    adminToken ||
    magnetToken ||
    ttsToken ||
    streamToken

  return {
    configPath,
    configLoaded,
    port: parseNum(process.env.PORT, fileConfig.port, 3000),
    host: parseStr(process.env.HOST, fileConfig.host, '0.0.0.0') || '0.0.0.0',
    distDir: rawDistDir,
    enableCompression: parseBool(
      process.env.ENABLE_COMPRESSION,
      fileConfig.enableCompression,
      true,
    ),
    // 直接端口转发保持 false 防止伪造 X-Forwarded-For 绕过按 IP 限次；前置 Nginx/Caddy 反代时再设为 true
    trustProxy: parseBool(process.env.TRUST_PROXY, fileConfig.trustProxy, false),
    adminToken,
    magnet: {
      enabled: parseBool(process.env.ENABLE_MAGNET, magnetFile.enabled, true),
      token: magnetToken,
      cacheDir,
      idleMinutes: Math.max(2, parseNum(process.env.MAGNET_IDLE_MINUTES, magnetFile.idleMinutes, 30)),
      maxTasks: Math.max(
        1,
        Math.min(10, parseNum(process.env.MAGNET_MAX_TASKS, magnetFile.maxTasks, 2)),
      ),
      uploadLimitBytes: parseNum(
        process.env.MAGNET_UPLOAD_LIMIT,
        magnetFile.uploadLimitBytes,
        512 * 1024,
      ),
      downloadLimitBytes: parseNum(
        process.env.MAGNET_DOWNLOAD_LIMIT,
        magnetFile.downloadLimitBytes,
        -1,
      ),
      ffmpegPath: parseStr(process.env.FFMPEG_PATH, magnetFile.ffmpegPath, 'ffmpeg') || 'ffmpeg',
    },
    tts: {
      enabled: parseBool(process.env.ENABLE_TTS, ttsFile.enabled, true),
      token: ttsToken,
      // 每 IP 每自然天免费合成次数（0=必须输口令，-1=不限次）
      dailyFreeLimit: parseNum(process.env.TTS_DAILY_FREE_LIMIT, ttsFile.dailyFreeLimit, 3),
      // 免费匿名访客单次合成字数上限
      freeMaxChars: Math.max(
        100,
        Math.min(20000, parseNum(process.env.TTS_FREE_MAX_CHARS, ttsFile.freeMaxChars, 1000)),
      ),
      // 口令解锁后的单次最大字数上限
      maxChars: Math.max(
        500,
        Math.min(50000, parseNum(process.env.TTS_MAX_CHARS, ttsFile.maxChars, 15000)),
      ),
    },
    stream: {
      enabled: parseBool(process.env.ENABLE_STREAM_PROXY, streamFile.enabled, true),
      token: streamToken,
      // 默认拦截私网/本机 IP 防止 SSRF；如需中转局域网摄像头或内网 IPTV 源可改为 true
      allowPrivateIp: parseBool(
        process.env.STREAM_ALLOW_PRIVATE_IP,
        streamFile.allowPrivateIp,
        false,
      ),
      maxConcurrent: Math.max(
        1,
        Math.min(64, parseNum(process.env.STREAM_MAX_CONCURRENT, streamFile.maxConcurrent, 16)),
      ),
    },
    logging: {
      enabled: parseBool(process.env.LOG_ENABLED, logFile.enabled, true),
      dir: logDir,
      retentionDays: Math.max(
        1,
        Math.min(365, parseNum(process.env.LOG_RETENTION_DAYS, logFile.retentionDays, 14)),
      ),
      console: parseBool(process.env.LOG_CONSOLE, logFile.console, true),
      logStaticAssets: parseBool(process.env.LOG_STATIC_ASSETS, logFile.logStaticAssets, false),
      statsToken,
    },
  }
}

export const serverConfig = loadServerConfig()
