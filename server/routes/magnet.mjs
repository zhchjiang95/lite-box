/**
 * 磁力链接 / .torrent 种子边下边播流媒体路由模块（方案 B）
 *
 * 核心特性：
 * - 按需动态加载 webtorrent（未安装时优雅降级，不影响其余零依赖接口正常启动）
 * - 省磁盘模式：拉取元数据后立即取消全部文件默认下载，仅在播放时按 HTTP Range 按需拉取目标分片
 * - 磁盘保护：自定义缓存目录 + 空闲超时自动销毁删盘 + 最大任务数 LRU 淘汰 + 启动/退出自动清扫
 * - 格式兼容：原生 MP4/WebM 零开销 206 Range 直出 + 自动探测本机 ffmpeg 提供 remux/compat 实时流式转码 + 外置播放器直链
 * - 安全防护：支持显式开关 ENABLE_MAGNET、强口令 MAGNET_TOKEN（timingSafeEqual 防时序攻击）、上传限速、防命令注入
 */

import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { serverConfig } from '../lib/config.mjs'
import { sendJson, sendText, setSecurityHeaders } from '../lib/http.mjs'

const {
  enabled: ENABLE_MAGNET,
  token: MAGNET_TOKEN,
  cacheDir: MAGNET_CACHE_DIR,
  idleMinutes: MAGNET_IDLE_MINUTES,
  maxTasks: MAGNET_MAX_TASKS,
  uploadLimitBytes: MAGNET_UPLOAD_LIMIT,
  downloadLimitBytes: MAGNET_DOWNLOAD_LIMIT,
  ffmpegPath: FFMPEG_PATH,
} = serverConfig.magnet

const MAX_BODY_BYTES = 12 * 1024 * 1024 // 允许最大 12MB 请求体（容纳大体积 .torrent 种子）
const INFO_HASH_RE = /^[a-f0-9]{40}$/i

/** 公共活跃 Tracker 补充列表（显著加速磁力链冷启动元数据拉取） */
const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.bittor.pw:1337/announce',
  'udp://public.popcorn-tracker.org:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
]

const VIDEO_EXT_MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.ogg': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.ts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.rmvb': 'application/vnd.rn-realmedia-vbr',
}

const BROWSER_NATIVE_EXTS = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.ogg'])
const AUDIO_EXT_MIME = {
  '.mp3': 'audio/mpeg',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.opus': 'audio/opus',
}
const SUBTITLE_EXTS = new Set(['.vtt', '.srt', '.ass', '.ssa'])

/** 探测宿主机 ffmpeg 可用性 */
function detectFfmpeg() {
  try {
    const res = spawnSync(FFMPEG_PATH, ['-version'], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
    })
    if (res.status === 0 && res.stdout) {
      const firstLine = res.stdout.split(/\r?\n/)[0]?.trim() || 'ffmpeg'
      return { available: true, version: firstLine }
    }
  } catch {
    // 宿主机未安装 ffmpeg
  }
  return { available: false, version: null }
}

const ffmpegInfo = detectFfmpeg()

/** 懒加载 WebTorrent 模块状态 */
let webTorrentCtor = null
let webTorrentLoadError = null
let webTorrentChecked = false
let clientInstance = null

/** 活跃任务元数据表 Map<infoHash, TaskEntry> */
const tasks = new Map()

/** 定时清理句柄 */
let idleSweepTimer = null

/** 确保并清扫上次残留的临时缓存目录 */
function resetCacheRootSync() {
  if (!ENABLE_MAGNET) return
  try {
    fs.mkdirSync(MAGNET_CACHE_DIR, { recursive: true })
    for (const entry of fs.readdirSync(MAGNET_CACHE_DIR)) {
      const full = path.join(MAGNET_CACHE_DIR, entry)
      try {
        fs.rmSync(full, { recursive: true, force: true })
      } catch {
        // 忽略单个占用文件
      }
    }
  } catch (err) {
    console.warn('[Magnet] 初始化缓存目录失败:', err.message)
  }
}

resetCacheRootSync()

/** 延迟动态加载 webtorrent，未安装时不阻塞主服务 */
async function ensureWebTorrentClient() {
  if (!ENABLE_MAGNET) return null
  if (clientInstance) return clientInstance
  if (!webTorrentChecked) {
    webTorrentChecked = true
    try {
      const mod = await import('webtorrent')
      webTorrentCtor = mod.default || mod
    } catch (err) {
      webTorrentLoadError = err?.message || 'webtorrent 未安装'
      return null
    }
  }
  if (!webTorrentCtor) return null

  fs.mkdirSync(MAGNET_CACHE_DIR, { recursive: true })
  const opts = {
    dht: true,
    lsd: true,
    tracker: true,
  }
  if (Number.isFinite(MAGNET_UPLOAD_LIMIT) && MAGNET_UPLOAD_LIMIT > 0) {
    opts.uploadLimit = MAGNET_UPLOAD_LIMIT
  }
  if (Number.isFinite(MAGNET_DOWNLOAD_LIMIT) && MAGNET_DOWNLOAD_LIMIT > 0) {
    opts.downloadLimit = MAGNET_DOWNLOAD_LIMIT
  }
  clientInstance = new webTorrentCtor(opts)
  clientInstance.on('error', (err) => {
    console.error('[Magnet Client Error]', err?.message || err)
  })

  // 启动空闲巡检定时器（每分钟检查一次）
  if (!idleSweepTimer) {
    idleSweepTimer = setInterval(() => {
      sweepIdleTasks().catch(() => {})
    }, 60 * 1000)
    idleSweepTimer.unref()
  }
  return clientInstance
}

/** 递归统计目录实际磁盘占用字节数 */
function computeDirBytesSync(dirPath) {
  let total = 0
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        total += computeDirBytesSync(full)
      } else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size
        } catch {
          // 文件可能正在被清理
        }
      }
    }
  } catch {
    return 0
  }
  return total
}

/** 读取缓存目录占用与所在盘符剩余空间（Windows / macOS / Linux 通用） */
function getDiskStats() {
  const cacheBytes = computeDirBytesSync(MAGNET_CACHE_DIR)
  let diskFreeBytes = null
  let diskTotalBytes = null
  try {
    if (typeof fs.statfsSync === 'function') {
      fs.mkdirSync(MAGNET_CACHE_DIR, { recursive: true })
      const st = fs.statfsSync(MAGNET_CACHE_DIR)
      diskFreeBytes = Number(st.bavail) * Number(st.bsize)
      diskTotalBytes = Number(st.blocks) * Number(st.bsize)
    }
  } catch {
    // 某些特殊文件系统不支持 statfs
  }
  return { cacheBytes, diskFreeBytes, diskTotalBytes }
}

/** 恒定时间比对口令 */
function verifyToken(req, parsedUrl) {
  if (!MAGNET_TOKEN) return true
  const headerToken = String(req.headers['x-magnet-token'] || '').trim()
  const queryToken = String(parsedUrl.searchParams.get('token') || '').trim()
  const candidate = headerToken || queryToken
  if (!candidate) return false

  const a = Buffer.from(candidate, 'utf8')
  const b = Buffer.from(MAGNET_TOKEN, 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/** 读取 JSON 请求体 */
function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let received = 0
    req.on('data', (chunk) => {
      received += chunk.length
      if (received > maxBytes) {
        reject(new Error('请求体过大（上限 12MB）'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8').trim()
        resolve(text ? JSON.parse(text) : {})
      } catch {
        reject(new Error('JSON 请求体格式错误'))
      }
    })
    req.on('error', reject)
  })
}

/** 分析文件媒体类型 */
function classifyFile(fileName) {
  const ext = path.extname(fileName).toLowerCase()
  if (VIDEO_EXT_MIME[ext]) {
    return {
      kind: 'video',
      mime: VIDEO_EXT_MIME[ext],
      browserNativePlayable: BROWSER_NATIVE_EXTS.has(ext),
      ext,
    }
  }
  if (SUBTITLE_EXTS.has(ext)) {
    return {
      kind: 'subtitle',
      mime: ext === '.vtt' ? 'text/vtt; charset=utf-8' : 'text/plain; charset=utf-8',
      browserNativePlayable: ext === '.vtt' || ext === '.srt',
      ext,
    }
  }
  if (AUDIO_EXT_MIME[ext]) {
    return {
      kind: 'audio',
      mime: AUDIO_EXT_MIME[ext],
      browserNativePlayable: true,
      ext,
    }
  }
  return {
    kind: 'other',
    mime: 'application/octet-stream',
    browserNativePlayable: false,
    ext,
  }
}

/** 取消种子内所有文件的自动后台下载，严格按需拉流（省磁盘核心！） */
function deselectAllTorrentFiles(torrent) {
  try {
    if (torrent.pieces && torrent.pieces.length > 0) {
      torrent.deselect(0, torrent.pieces.length - 1, 0)
    }
    if (Array.isArray(torrent.files)) {
      for (const f of torrent.files) {
        if (typeof f.deselect === 'function') {
          f.deselect()
        }
      }
    }
  } catch {
    // 忽略元数据尚未就绪时的状态
  }
}

/** 仅聚焦当前播放的文件，释放其他文件的下载优先级 */
function focusSingleFile(task, fileIndex) {
  const { torrent } = task
  if (!torrent || !Array.isArray(torrent.files)) return
  if (task.activeFileIndex === fileIndex) return
  deselectAllTorrentFiles(torrent)
  const target = torrent.files[fileIndex]
  if (target && typeof target.select === 'function') {
    // 给予当前播放文件正常优先级，同时 createReadStream 会给予播放位置最高关键片优先级
    target.select()
  }
  task.activeFileIndex = fileIndex
}

/** 序列化单个任务供前端展示 */
function serializeTask(task) {
  const { torrent } = task
  const now = Date.now()
  const idleLimitMs = MAGNET_IDLE_MINUTES * 60 * 1000
  const idleRemainingSec = Math.max(0, Math.floor((idleLimitMs - (now - task.lastAccessAt)) / 1000))

  const files = Array.isArray(torrent.files)
    ? torrent.files.map((f, index) => {
        const meta = classifyFile(f.name)
        return {
          index,
          name: f.name,
          path: f.path,
          length: f.length || 0,
          downloaded: f.downloaded || 0,
          progress: Number.isFinite(f.progress) ? f.progress : 0,
          kind: meta.kind,
          ext: meta.ext,
          mime: meta.mime,
          browserNativePlayable: meta.browserNativePlayable,
        }
      })
    : []

  return {
    infoHash: task.infoHash,
    name: torrent.name || task.fallbackName || `磁力任务 ${task.infoHash.slice(0, 8)}`,
    ready: Boolean(torrent.ready && files.length > 0),
    progress: Number.isFinite(torrent.progress) ? torrent.progress : 0,
    downloaded: torrent.downloaded || 0,
    uploaded: torrent.uploaded || 0,
    length: torrent.length || 0,
    downloadSpeed: torrent.downloadSpeed || 0,
    uploadSpeed: torrent.uploadSpeed || 0,
    numPeers: torrent.numPeers || 0,
    activeFileIndex: task.activeFileIndex,
    activeTranscodes: task.transcodeProcs.size,
    createdAt: task.createdAt,
    lastAccessAt: task.lastAccessAt,
    idleRemainingSec,
    files,
  }
}

/** 彻底销毁单个任务并立即释放磁盘缓存 */
async function destroyTask(infoHash) {
  const hash = infoHash.toLowerCase()
  const task = tasks.get(hash)
  if (!task) return false
  tasks.delete(hash)

  // 1. 强杀该任务关联的所有 ffmpeg 子进程
  for (const proc of task.transcodeProcs) {
    try {
      proc.kill('SIGKILL')
    } catch {
      // 忽略已退出进程
    }
  }
  task.transcodeProcs.clear()

  // 2. 销毁 torrent 实例及存储
  await new Promise((resolve) => {
    try {
      task.torrent.destroy({ destroyStore: true }, () => resolve())
      setTimeout(resolve, 1500).unref()
    } catch {
      resolve()
    }
  })

  // 3. 兜底删除该任务专属缓存文件夹（Windows 可能有短暂句柄释放延迟，重试一次）
  try {
    await fsp.rm(task.storePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  } catch {
    // 忽略极少数被占用文件，后续清空缓存会再次清扫
  }
  return true
}

/** 巡检并自动清理空闲超时任务 */
async function sweepIdleTasks() {
  const now = Date.now()
  const limitMs = MAGNET_IDLE_MINUTES * 60 * 1000
  for (const [hash, task] of tasks.entries()) {
    // 正在流式传输或转码时不淘汰
    if (task.activeStreams > 0 || task.transcodeProcs.size > 0) {
      task.lastAccessAt = now
      continue
    }
    if (now - task.lastAccessAt >= limitMs) {
      console.log(`[Magnet] 任务 ${hash.slice(0, 8)} 空闲超过 ${MAGNET_IDLE_MINUTES} 分钟，自动清理释放磁盘`)
      await destroyTask(hash)
    }
  }
}

/** 超出最大并发任务上限时，LRU 淘汰最久未使用的任务 */
async function evictOldestIfNeeded(excludeHash = '') {
  while (tasks.size >= MAGNET_MAX_TASKS) {
    let oldestHash = null
    let oldestAt = Infinity
    for (const [hash, task] of tasks.entries()) {
      if (hash === excludeHash) continue
      if (task.lastAccessAt < oldestAt) {
        oldestAt = task.lastAccessAt
        oldestHash = hash
      }
    }
    if (!oldestHash) break
    console.log(`[Magnet] 达到最大任务数 ${MAGNET_MAX_TASKS}，自动清理最旧任务 ${oldestHash.slice(0, 8)} 释放磁盘`)
    await destroyTask(oldestHash)
  }
}

/** 从磁力链提取 infoHash（用于提前去重） */
function extractInfoHashFromMagnet(magnet) {
  const hexMatch = magnet.match(/xt=urn:btih:([a-f0-9]{40})/i)
  if (hexMatch) return hexMatch[1].toLowerCase()
  return null
}

/** 解析 Range 头（支持 bytes=start-end / bytes=start- / bytes=-suffix） */
function parseByteRange(rangeHeader, fileSize) {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) return null
  const firstRange = rangeHeader.slice(6).split(',')[0].trim()
  const [startStr, endStr] = firstRange.split('-')

  let start
  let end
  if (startStr === '' && endStr !== '') {
    const suffix = Number(endStr)
    if (!Number.isInteger(suffix) || suffix <= 0) return 'invalid'
    start = Math.max(0, fileSize - suffix)
    end = fileSize - 1
  } else {
    start = Number(startStr)
    end = endStr === '' ? fileSize - 1 : Number(endStr)
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end) {
      return 'invalid'
    }
    if (start >= fileSize) return 'unsatisfiable'
    end = Math.min(end, fileSize - 1)
  }
  return { start, end }
}

/** 将 SRT 字幕转为浏览器原生支持的 WEBVTT */
function srtToVtt(rawText) {
  const cleaned = rawText
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
  if (cleaned.trimStart().startsWith('WEBVTT')) return cleaned
  const converted = cleaned.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2 --> $3.$4',
  )
  return `WEBVTT\n\n${converted}\n`
}

/** 从流中收集文本（用于字幕，限制最大 4MB） */
function readStreamToText(stream, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    stream.on('data', (chunk) => {
      total += chunk.length
      if (total > maxBytes) {
        stream.destroy()
        reject(new Error('字幕文件过大'))
        return
      }
      chunks.push(chunk)
    })
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    stream.on('error', reject)
  })
}

/** 新增磁力或 .torrent 任务 */
async function addMagnetTask({ magnet, torrentBase64, fileName }) {
  const client = await ensureWebTorrentClient()
  if (!client) {
    throw new Error(webTorrentLoadError || '后端尚未安装 webtorrent 模块')
  }

  let torrentInput
  let fallbackName = ''
  if (torrentBase64) {
    const buf = Buffer.from(torrentBase64, 'base64')
    if (buf.length < 16) throw new Error('无效的 .torrent 种子文件内容')
    torrentInput = buf
    fallbackName = fileName || '本地种子任务'
  } else if (magnet) {
    const trimmed = magnet.trim()
    if (!/^magnet:\?/i.test(trimmed)) {
      throw new Error('请输入以 magnet:? 开头的标准磁力链接')
    }
    const existingHash = extractInfoHashFromMagnet(trimmed)
    if (existingHash && tasks.has(existingHash)) {
      const existing = tasks.get(existingHash)
      existing.lastAccessAt = Date.now()
      return serializeTask(existing)
    }
    const dnMatch = trimmed.match(/[?&]dn=([^&]+)/i)
    if (dnMatch) {
      try {
        fallbackName = decodeURIComponent(dnMatch[1].replace(/\+/g, ' '))
      } catch {
        fallbackName = ''
      }
    }
    torrentInput = trimmed
  } else {
    throw new Error('请提供 magnet 磁力链接或 .torrent 种子文件')
  }

  // 若已达任务上限，提前清理最久未访问的任务
  await evictOldestIfNeeded()

  const tempSubDir = path.join(
    MAGNET_CACHE_DIR,
    `job-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
  )
  await fsp.mkdir(tempSubDir, { recursive: true })

  return await new Promise((resolve, reject) => {
    let settled = false
    const finish = (err, data) => {
      if (settled) return
      settled = true
      clearTimeout(metaTimer)
      if (err) reject(err)
      else resolve(data)
    }

    let torrent
    try {
      torrent = client.add(torrentInput, {
        path: tempSubDir,
        announce: PUBLIC_TRACKERS,
        // 避免刚添加就把整个种子全部下到磁盘
        deselect: true,
      })
    } catch (err) {
      fsp.rm(tempSubDir, { recursive: true, force: true }).catch(() => {})
      finish(err)
      return
    }

    const bindTask = () => {
      const hash = (torrent.infoHash || '').toLowerCase()
      if (!hash) return null
      if (tasks.has(hash)) {
        const existing = tasks.get(hash)
        existing.lastAccessAt = Date.now()
        return existing
      }
      const entry = {
        infoHash: hash,
        torrent,
        storePath: tempSubDir,
        fallbackName,
        createdAt: Date.now(),
        lastAccessAt: Date.now(),
        activeFileIndex: null,
        activeStreams: 0,
        transcodeProcs: new Set(),
      }
      tasks.set(hash, entry)
      return entry
    }

    torrent.on('infoHash', () => {
      bindTask()
    })

    torrent.on('metadata', () => {
      // 拿到文件清单后立即取消全量下载，严格按播放按需拉片
      deselectAllTorrentFiles(torrent)
    })

    torrent.on('ready', () => {
      deselectAllTorrentFiles(torrent)
      const entry = bindTask()
      if (entry) {
        finish(null, serializeTask(entry))
      }
    })

    torrent.on('error', (err) => {
      const hash = (torrent.infoHash || '').toLowerCase()
      if (hash && tasks.has(hash)) {
        destroyTask(hash).catch(() => {})
      } else {
        fsp.rm(tempSubDir, { recursive: true, force: true }).catch(() => {})
      }
      finish(err instanceof Error ? err : new Error(String(err)))
    })

    // 若 3.5 秒内元数据尚未拉回（常见于冷门磁力 DHT 寻源中），先返回排队中的任务，由前端轮询刷新
    const metaTimer = setTimeout(() => {
      const entry = bindTask()
      if (entry) {
        finish(null, serializeTask(entry))
      } else {
        finish(new Error('无法解析该磁力链接，请检查格式是否正确'))
      }
    }, 3500)
  })
}

/** 处理原生 HTTP 206 Range 边下边播流媒体 */
function handleNativeStream(req, res, task, file, fileIndex) {
  const fileSize = file.length
  const meta = classifyFile(file.name)
  task.lastAccessAt = Date.now()
  focusSingleFile(task, fileIndex)

  const rangeHeader = req.headers.range
  const parsedRange = parseByteRange(rangeHeader, fileSize)

  if (parsedRange === 'invalid' || parsedRange === 'unsatisfiable') {
    setSecurityHeaders(res)
    res.writeHead(416, {
      'Content-Range': `bytes */${fileSize}`,
      'Accept-Ranges': 'bytes',
    })
    res.end()
    return
  }

  const start = parsedRange ? parsedRange.start : 0
  const end = parsedRange ? parsedRange.end : Math.max(0, fileSize - 1)
  const chunkLength = fileSize > 0 ? end - start + 1 : 0
  const statusCode = parsedRange ? 206 : 200

  setSecurityHeaders(res)
  const headers = {
    'Content-Type': meta.mime,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunkLength,
    'Cache-Control': 'no-store',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
  }
  if (parsedRange) {
    headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`
  }

  res.writeHead(statusCode, headers)
  if (req.method === 'HEAD' || fileSize === 0) {
    res.end()
    return
  }

  task.activeStreams += 1
  const stream = file.createReadStream({ start, end })
  let cleaned = false

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    task.activeStreams = Math.max(0, task.activeStreams - 1)
    task.lastAccessAt = Date.now()
    try {
      stream.destroy()
    } catch {
      // 忽略
    }
  }

  stream.on('error', (err) => {
    cleanup()
    if (!res.headersSent) {
      sendText(req, res, 500, `流读取失败: ${err.message}`)
    } else {
      res.destroy()
    }
  })

  req.on('close', cleanup)
  res.on('close', cleanup)
  res.on('finish', cleanup)

  stream.pipe(res)
}

/** 处理本机 ffmpeg 实时转封装 / 兼容转码流（专治 MKV / AC3 / H.265 浏览器黑屏无声） */
function handleFfmpegTranscode(req, res, task, file, fileIndex, mode) {
  if (!ffmpegInfo.available) {
    sendJson(req, res, 503, {
      code: 503,
      message: '宿主机未检测到 ffmpeg，无法开启兼容转码模式。请安装 ffmpeg 或使用外置播放器（PotPlayer / VLC / IINA）打开直链。',
    })
    return
  }

  task.lastAccessAt = Date.now()
  focusSingleFile(task, fileIndex)

  // remux：视频流直接复制（极低 CPU），仅将音频转为 AAC 立体声并封装为流式 fMP4
  // compat：视频软解重编为 H.264 8-bit yuv420p + AAC（兼容 H.265/HEVC/AVI/RMVB 等任意格式）
  const isCompat = mode === 'compat'
  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    'pipe:0',
    ...(isCompat
      ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p']
      : ['-c:v', 'copy']),
    '-c:a',
    'aac',
    '-ac',
    '2',
    '-b:a',
    '192k',
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof',
    '-f',
    'mp4',
    'pipe:1',
  ]

  setSecurityHeaders(res)
  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Cache-Control': 'no-store',
    'Transfer-Encoding': 'chunked',
  })

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  const inputStream = file.createReadStream()
  const proc = spawn(FFMPEG_PATH, ffmpegArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
  })

  task.transcodeProcs.add(proc)
  let cleaned = false

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    task.transcodeProcs.delete(proc)
    task.lastAccessAt = Date.now()
    try {
      inputStream.destroy()
    } catch {
      // 忽略
    }
    try {
      if (!proc.killed) proc.kill('SIGKILL')
    } catch {
      // 忽略
    }
  }

  inputStream.on('error', cleanup)
  proc.stdin.on('error', () => {
    // 浏览器断开或 ffmpeg 提前退出时忽略 EPIPE
  })
  proc.stderr.on('data', (chunk) => {
    const msg = chunk.toString('utf8').trim()
    if (msg) console.warn(`[Magnet ffmpeg] ${msg}`)
  })
  proc.on('error', (err) => {
    console.error('[Magnet ffmpeg spawn error]', err.message)
    cleanup()
    if (!res.writableEnded) res.end()
  })
  proc.on('close', () => {
    cleanup()
    if (!res.writableEnded) res.end()
  })

  req.on('close', cleanup)
  res.on('close', cleanup)

  inputStream.pipe(proc.stdin)
  proc.stdout.pipe(res)
}

/**
 * 磁力流媒体统一路由入口
 * @returns {Promise<boolean>} 是否命中路由
 */
export async function handleMagnetRoutes(req, res, pathname, parsedUrl) {
  if (!pathname.startsWith('/api/magnet/')) return false

  // 1. 状态探针（允许未鉴权访问，用于前端判断是否安装 webtorrent、是否需要输入口令）
  if (pathname === '/api/magnet/status' && (req.method === 'GET' || req.method === 'HEAD')) {
    if (ENABLE_MAGNET && !webTorrentChecked) {
      await ensureWebTorrentClient()
    }
    const authorized = verifyToken(req, parsedUrl)
    const disk = authorized ? getDiskStats() : { cacheBytes: 0, diskFreeBytes: null, diskTotalBytes: null }

    sendJson(req, res, 200, {
      enabled: ENABLE_MAGNET,
      available: Boolean(ENABLE_MAGNET && clientInstance),
      requiresAuth: Boolean(MAGNET_TOKEN),
      authorized,
      loadError: webTorrentLoadError,
      installHint: 'cd server && pnpm install',
      ffmpegAvailable: ffmpegInfo.available,
      ffmpegVersion: ffmpegInfo.version,
      cacheDir: authorized ? MAGNET_CACHE_DIR : undefined,
      cacheBytes: disk.cacheBytes,
      diskFreeBytes: disk.diskFreeBytes,
      diskTotalBytes: disk.diskTotalBytes,
      maxTasks: MAGNET_MAX_TASKS,
      idleMinutes: MAGNET_IDLE_MINUTES,
      uploadLimitBytes: MAGNET_UPLOAD_LIMIT,
      activeTaskCount: tasks.size,
    })
    return true
  }

  if (!ENABLE_MAGNET) {
    sendJson(req, res, 403, {
      code: 403,
      message: '服务端已通过 ENABLE_MAGNET=false 关闭磁力流媒体功能',
    })
    return true
  }

  // 2. 口令验证接口
  if (pathname === '/api/magnet/auth' && req.method === 'POST') {
    if (!verifyToken(req, parsedUrl)) {
      sendJson(req, res, 401, { code: 401, message: '访问口令错误，请检查 MAGNET_TOKEN 配置' })
      return true
    }
    sendJson(req, res, 200, { ok: true })
    return true
  }

  // 以下所有接口强制校验口令
  if (!verifyToken(req, parsedUrl)) {
    sendJson(req, res, 401, {
      code: 401,
      message: '需要访问口令（请先在页面顶部输入服务端 MAGNET_TOKEN 解锁）',
    })
    return true
  }

  const client = await ensureWebTorrentClient()
  if (!client) {
    sendJson(req, res, 503, {
      code: 503,
      message: `磁力引擎尚未就绪：${webTorrentLoadError || '请在 server 目录执行 pnpm install 安装 webtorrent'}`,
    })
    return true
  }

  // 3. 任务列表 + 实时磁盘状态
  if (pathname === '/api/magnet/tasks' && req.method === 'GET') {
    const list = Array.from(tasks.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(serializeTask)
    sendJson(req, res, 200, {
      tasks: list,
      disk: getDiskStats(),
    })
    return true
  }

  // 4. 添加磁力链或 .torrent 种子
  if (pathname === '/api/magnet/tasks' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req)
      const created = await addMagnetTask({
        magnet: body.magnet,
        torrentBase64: body.torrentBase64,
        fileName: body.fileName,
      })
      sendJson(req, res, 200, { task: created, disk: getDiskStats() })
    } catch (err) {
      sendJson(req, res, 400, { code: 400, message: err?.message || '添加磁力任务失败' })
    }
    return true
  }

  // 5. 一键清空所有任务与磁盘缓存
  if (pathname === '/api/magnet/cache/clear' && req.method === 'POST') {
    const allHashes = Array.from(tasks.keys())
    for (const h of allHashes) {
      await destroyTask(h)
    }
    resetCacheRootSync()
    sendJson(req, res, 200, {
      ok: true,
      clearedTasks: allHashes.length,
      disk: getDiskStats(),
    })
    return true
  }

  // 6. 删除单个任务并释放磁盘
  const deleteMatch = pathname.match(/^\/api\/magnet\/tasks\/([a-f0-9]{40})$/i)
  if (deleteMatch && req.method === 'DELETE') {
    const hash = deleteMatch[1].toLowerCase()
    const existed = await destroyTask(hash)
    sendJson(req, res, existed ? 200 : 404, {
      ok: existed,
      message: existed ? '已停止并清理磁盘缓存' : '任务不存在或已被清理',
      disk: getDiskStats(),
    })
    return true
  }

  // 7. 视频 / 音频原生 206 Range 流式播放
  const streamMatch = pathname.match(/^\/api\/magnet\/stream\/([a-f0-9]{40})\/(\d+)$/i)
  if (streamMatch && (req.method === 'GET' || req.method === 'HEAD')) {
    const hash = streamMatch[1].toLowerCase()
    const fileIndex = Number(streamMatch[2])
    const task = tasks.get(hash)
    if (!task || !INFO_HASH_RE.test(hash)) {
      sendJson(req, res, 404, { code: 404, message: '磁力任务不存在或已超时清理' })
      return true
    }
    const file = task.torrent.files?.[fileIndex]
    if (!file) {
      sendJson(req, res, 404, { code: 404, message: '目标文件索引不存在或元数据尚未就绪' })
      return true
    }
    handleNativeStream(req, res, task, file, fileIndex)
    return true
  }

  // 8. 本机 ffmpeg 兼容转封装 / 转码流
  const transcodeMatch = pathname.match(/^\/api\/magnet\/transcode\/([a-f0-9]{40})\/(\d+)$/i)
  if (transcodeMatch && (req.method === 'GET' || req.method === 'HEAD')) {
    const hash = transcodeMatch[1].toLowerCase()
    const fileIndex = Number(transcodeMatch[2])
    const mode = parsedUrl.searchParams.get('mode') === 'compat' ? 'compat' : 'remux'
    const task = tasks.get(hash)
    if (!task) {
      sendJson(req, res, 404, { code: 404, message: '磁力任务不存在或已超时清理' })
      return true
    }
    const file = task.torrent.files?.[fileIndex]
    if (!file) {
      sendJson(req, res, 404, { code: 404, message: '目标文件索引不存在' })
      return true
    }
    handleFfmpegTranscode(req, res, task, file, fileIndex, mode)
    return true
  }

  // 9. 种子内字幕实时读取并转换为 WebVTT
  const subMatch = pathname.match(/^\/api\/magnet\/subtitle\/([a-f0-9]{40})\/(\d+)$/i)
  if (subMatch && req.method === 'GET') {
    const hash = subMatch[1].toLowerCase()
    const fileIndex = Number(subMatch[2])
    const task = tasks.get(hash)
    if (!task) {
      sendText(req, res, 404, 'Subtitle task not found')
      return true
    }
    const file = task.torrent.files?.[fileIndex]
    if (!file) {
      sendText(req, res, 404, 'Subtitle file not found')
      return true
    }
    task.lastAccessAt = Date.now()
    try {
      const raw = await readStreamToText(file.createReadStream())
      const vtt = srtToVtt(raw)
      setSecurityHeaders(res)
      res.writeHead(200, {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(vtt),
      })
      res.end(vtt)
    } catch (err) {
      sendText(req, res, 500, `字幕读取失败: ${err.message}`)
    }
    return true
  }

  return false
}

/** 优雅关闭磁力引擎并清空全部临时缓存 */
export async function closeMagnetService() {
  if (idleSweepTimer) {
    clearInterval(idleSweepTimer)
    idleSweepTimer = null
  }
  const allHashes = Array.from(tasks.keys())
  for (const h of allHashes) {
    await destroyTask(h)
  }
  if (clientInstance) {
    await new Promise((resolve) => {
      try {
        clientInstance.destroy(() => resolve())
        setTimeout(resolve, 1500).unref()
      } catch {
        resolve()
      }
    })
    clientInstance = null
  }
  resetCacheRootSync()
}

export function getMagnetSummary() {
  return {
    enabled: ENABLE_MAGNET,
    requiresAuth: Boolean(MAGNET_TOKEN),
    ffmpegAvailable: ffmpegInfo.available,
    cacheDir: MAGNET_CACHE_DIR,
    activeTasks: tasks.size,
  }
}
