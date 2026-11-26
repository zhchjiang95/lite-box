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

  const rawCacheDir = parseStr(process.env.MAGNET_CACHE_DIR, magnetFile.cacheDir, '')
  const cacheDir = rawCacheDir
    ? path.resolve(rawCacheDir)
    : path.resolve(path.join(os.tmpdir(), 'litebox-magnet'))

  const rawDistDir = parseStr(process.env.DIST_DIR, fileConfig.distDir, '')

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
    magnet: {
      enabled: parseBool(process.env.ENABLE_MAGNET, magnetFile.enabled, true),
      token: parseStr(process.env.MAGNET_TOKEN, magnetFile.token, ''),
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
  }
}

export const serverConfig = loadServerConfig()
