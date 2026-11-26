import { zipSync } from 'fflate'

export type ImageOutputFormat = 'png' | 'jpeg' | 'webp'
export type MaxEdgePreset = 'original' | '1920' | '1280' | '720'
export type BatchMode = 'count' | 'interval' | 'fps'

export interface CaptureOptions {
  format: ImageOutputFormat
  /** 0.5 – 1.0，仅 jpeg/webp 生效 */
  quality: number
  /** 输出最大边尺寸限制 */
  maxEdge: MaxEdgePreset
  /** 是否在右下角绘制精确时间码水印 */
  stampTimecode: boolean
}

export interface CapturedFrame {
  id: string
  timeSec: number
  timecode: string
  width: number
  height: number
  size: number
  format: ImageOutputFormat
  fileName: string
  blob: Blob
  url: string
}

export interface VideoInfo {
  name: string
  stem: string
  size: number
  duration: number
  width: number
  height: number
}

const MIME_BY_FORMAT: Record<ImageOutputFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

const EXT_BY_FORMAT: Record<ImageOutputFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
}

/** 批量抽帧单次上限，防止超长视频一次抽出数千张导致浏览器内存溢出 */
export const MAX_BATCH_FRAMES = 300

const pad2 = (n: number) => String(Math.floor(n)).padStart(2, '0')
const pad3 = (n: number) => String(Math.floor(n)).padStart(3, '0')

/** 将秒数格式化为精确时间码 HH:MM:SS.mmm（不足 1 小时默认仍可选择保留或精简） */
export function formatTimecode(sec: number, alwaysHours = false): string {
  const safe = Number.isFinite(sec) ? Math.max(0, sec) : 0
  const totalMs = Math.round(safe * 1000)
  const h = Math.floor(totalMs / 3_600_000)
  const m = Math.floor((totalMs % 3_600_000) / 60_000)
  const s = Math.floor((totalMs % 60_000) / 1000)
  const ms = totalMs % 1000
  if (h > 0 || alwaysHours) {
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(ms)}`
  }
  return `${pad2(m)}:${pad2(s)}.${pad3(ms)}`
}

/** 构造文件名安全的短时间码，如 01m23s450ms */
export function formatFileTimeTag(sec: number): string {
  const safe = Number.isFinite(sec) ? Math.max(0, sec) : 0
  const totalMs = Math.round(safe * 1000)
  const h = Math.floor(totalMs / 3_600_000)
  const m = Math.floor((totalMs % 3_600_000) / 60_000)
  const s = Math.floor((totalMs % 60_000) / 1000)
  const ms = totalMs % 1000
  return h > 0 ? `${pad2(h)}h${pad2(m)}m${pad2(s)}s${pad3(ms)}` : `${pad2(m)}m${pad2(s)}s${pad3(ms)}`
}

/** 解析用户输入的时间码字符串（支持 "83.5"、"01:23.5"、"01:02:03.250"） */
export function parseTimecodeInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const val = Number(trimmed)
    return Number.isFinite(val) ? val : null
  }
  const parts = trimmed.split(':')
  if (parts.length < 2 || parts.length > 3) return null
  const nums = parts.map((p) => Number(p))
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null
  if (parts.length === 2) {
    return nums[0] * 60 + nums[1]
  }
  return nums[0] * 3600 + nums[1] * 60 + nums[2]
}

/** 清理视频基础文件名用于导出图片与 ZIP */
export function sanitizeFileStem(name: string): string {
  const base = name.replace(/\.[^.]+$/, '')
  const cleaned = base.replace(/[\\/:*?"<>|]+/g, '_').trim()
  return cleaned || 'video'
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`
}

/** 计算输出画布目标宽高 */
export function computeTargetSize(
  srcW: number,
  srcH: number,
  maxEdge: MaxEdgePreset,
): { width: number; height: number } {
  const w = Math.max(1, Math.round(srcW))
  const h = Math.max(1, Math.round(srcH))
  if (maxEdge === 'original') return { width: w, height: h }
  const limit = Number(maxEdge)
  const longest = Math.max(w, h)
  if (!Number.isFinite(limit) || longest <= limit) {
    return { width: w, height: h }
  }
  const ratio = limit / longest
  return {
    width: Math.max(2, Math.round(w * ratio)),
    height: Math.max(2, Math.round(h * ratio)),
  }
}

/** 根据模式与区间计算批量抽帧时间戳数组（严格升序、去重、不超过上限） */
export function computeBatchTimestamps(params: {
  duration: number
  startSec: number
  endSec: number
  mode: BatchMode
  /** count=张数，interval=间隔秒数，fps=每秒帧数 */
  value: number
}): { timestamps: number[]; truncated: boolean } {
  const duration = Math.max(0, params.duration)
  if (duration <= 0) return { timestamps: [], truncated: false }

  // 避免精确卡在视频最后一毫秒导致部分编码器解码黑帧，末尾留 0.02s 安全余量
  const safeMax = Math.max(0, duration - 0.02)
  const start = Math.min(safeMax, Math.max(0, params.startSec))
  const end = Math.min(safeMax, Math.max(start, params.endSec))
  const span = Math.max(0, end - start)

  const raw: number[] = []
  let truncated = false

  if (params.mode === 'count') {
    const count = Math.min(MAX_BATCH_FRAMES, Math.max(1, Math.round(params.value)))
    if (count === 1 || span < 0.001) {
      raw.push(start)
    } else {
      for (let i = 0; i < count; i++) {
        raw.push(start + (span * i) / (count - 1))
      }
    }
  } else if (params.mode === 'interval') {
    const step = Math.max(0.05, params.value)
    let t = start
    while (t <= end + 1e-6) {
      if (raw.length >= MAX_BATCH_FRAMES) {
        truncated = true
        break
      }
      raw.push(Math.min(end, t))
      t += step
    }
  } else {
    // fps 模式
    const fps = Math.min(60, Math.max(0.1, params.value))
    const step = 1 / fps
    let t = start
    while (t <= end + 1e-6) {
      if (raw.length >= MAX_BATCH_FRAMES) {
        truncated = true
        break
      }
      raw.push(Math.min(end, t))
      t += step
    }
  }

  // 保留毫秒精度去重
  const seen = new Set<number>()
  const timestamps: number[] = []
  for (const t of raw) {
    const msKey = Math.round(t * 1000)
    if (!seen.has(msKey)) {
      seen.add(msKey)
      timestamps.push(msKey / 1000)
    }
  }
  return { timestamps, truncated }
}

/** 将视频当前帧绘制到 Canvas 并编码为指定格式 Blob */
export async function captureVideoFrame(
  video: HTMLVideoElement,
  stem: string,
  options: CaptureOptions,
  explicitTimeSec?: number,
): Promise<CapturedFrame> {
  const srcW = video.videoWidth
  const srcH = video.videoHeight
  if (!srcW || !srcH) {
    throw new Error('视频画面尚未就绪，请等待解码完成后重试')
  }

  const { width, height } = computeTargetSize(srcW, srcH, options.maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('浏览器 Canvas 上下文创建失败')
  }

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(video, 0, 0, width, height)

  const timeSec = explicitTimeSec ?? video.currentTime
  const timecode = formatTimecode(timeSec)

  // 可选右下角专业半透明时间码水印
  if (options.stampTimecode) {
    const fontSize = Math.max(14, Math.round(Math.min(width, height) * 0.032))
    ctx.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`
    const padX = Math.round(fontSize * 0.55)
    const padY = Math.round(fontSize * 0.32)
    const margin = Math.round(fontSize * 0.7)
    const metrics = ctx.measureText(timecode)
    const boxW = Math.ceil(metrics.width + padX * 2)
    const boxH = Math.ceil(fontSize + padY * 2)
    const bx = width - boxW - margin
    const by = height - boxH - margin

    ctx.fillStyle = 'rgba(0, 0, 0, 0.62)'
    ctx.beginPath()
    ctx.roundRect(bx, by, boxW, boxH, Math.round(fontSize * 0.28))
    ctx.fill()

    ctx.fillStyle = '#f8fafc'
    ctx.textBaseline = 'middle'
    ctx.fillText(timecode, bx + padX, by + boxH / 2 + 1)
  }

  const mime = MIME_BY_FORMAT[options.format]
  const quality = options.format === 'png' ? undefined : options.quality
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b)
        else reject(new Error('图片编码失败，请尝试切换 PNG 或 JPEG 格式'))
      },
      mime,
      quality,
    )
  })

  const ext = EXT_BY_FORMAT[options.format]
  const timeTag = formatFileTimeTag(timeSec)
  const fileName = `${stem}_${timeTag}.${ext}`

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timeSec,
    timecode,
    width,
    height,
    size: blob.size,
    format: options.format,
    fileName,
    blob,
    url: URL.createObjectURL(blob),
  }
}

/** 将当前帧直接以 PNG 写入系统剪贴板（兼容微信/文档直接 Ctrl+V 粘贴） */
export async function copyVideoFrameToClipboard(
  video: HTMLVideoElement,
  options: CaptureOptions,
): Promise<void> {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('当前浏览器环境不支持复制图片到剪贴板，请使用导出下载')
  }
  const pngFrame = await captureVideoFrame(video, 'clip', { ...options, format: 'png' })
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngFrame.blob })])
  } finally {
    URL.revokeObjectURL(pngFrame.url)
  }
}

/** 精确 Seek 视频到指定秒数，等待解码帧就绪 */
export function seekVideoTo(
  video: HTMLVideoElement,
  targetTime: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('已取消抽帧', 'AbortError'))
      return
    }

    const clamped = Math.max(0, Math.min(video.duration || targetTime, targetTime))

    const waitPaintedFrame = () => {
      // 若浏览器支持 requestVideoFrameCallback 或 rAF，多等 1 个渲染节拍确保最新帧已经提交纹理
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => resolve())
      } else {
        resolve()
      }
    }

    if (Math.abs(video.currentTime - clamped) < 0.001 && video.readyState >= 2) {
      waitPaintedFrame()
      return
    }

    let settled = false
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      signal?.removeEventListener('abort', onAbort)
      clearTimeout(timer)
    }

    const onSeeked = () => {
      if (settled) return
      settled = true
      cleanup()
      waitPaintedFrame()
    }

    const onError = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('视频定位失败，可能包含损坏帧或不受支持的编码'))
    }

    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new DOMException('已取消抽帧', 'AbortError'))
    }

    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      // 某些视频关键帧间隔极大时容错放行，避免整批卡死
      resolve()
    }, 6000)

    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onError, { once: true })
    signal?.addEventListener('abort', onAbort, { once: true })
    video.currentTime = clamped
  })
}

/** 使用独立离屏 <video> 批量按时间点抽帧（不打断主播放器预览） */
export async function extractBatchFrames(params: {
  videoUrl: string
  stem: string
  timestamps: number[]
  options: CaptureOptions
  signal: AbortSignal
  onFrame: (frame: CapturedFrame, index: number, total: number) => void
}): Promise<CapturedFrame[]> {
  const { videoUrl, stem, timestamps, options, signal, onFrame } = params
  if (timestamps.length === 0) return []

  const offscreen = document.createElement('video')
  offscreen.muted = true
  offscreen.playsInline = true
  offscreen.preload = 'auto'
  offscreen.src = videoUrl

  try {
    // 等待元数据与首帧可解码
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('已取消抽帧', 'AbortError'))
        return
      }
      const onLoaded = () => {
        cleanup()
        resolve()
      }
      const onErr = () => {
        cleanup()
        reject(new Error('离屏视频加载失败'))
      }
      const onAbort = () => {
        cleanup()
        reject(new DOMException('已取消抽帧', 'AbortError'))
      }
      const cleanup = () => {
        offscreen.removeEventListener('loadeddata', onLoaded)
        offscreen.removeEventListener('error', onErr)
        signal.removeEventListener('abort', onAbort)
      }
      offscreen.addEventListener('loadeddata', onLoaded, { once: true })
      offscreen.addEventListener('error', onErr, { once: true })
      signal.addEventListener('abort', onAbort, { once: true })
      offscreen.load()
    })

    const results: CapturedFrame[] = []
    for (let i = 0; i < timestamps.length; i++) {
      if (signal.aborted) {
        throw new DOMException('已取消抽帧', 'AbortError')
      }
      const targetSec = timestamps[i]
      await seekVideoTo(offscreen, targetSec, signal)
      const frame = await captureVideoFrame(offscreen, stem, options, targetSec)
      results.push(frame)
      onFrame(frame, i + 1, timestamps.length)
    }
    return results
  } finally {
    offscreen.pause()
    offscreen.removeAttribute('src')
    offscreen.load()
  }
}

/** 将多张截图高速打包为标准 ZIP（图片采用 level 0 无二次压缩，速度极快） */
export async function packFramesToZip(frames: CapturedFrame[]): Promise<Blob> {
  const filesMap: Record<string, Uint8Array> = {}
  const usedNames = new Map<string, number>()

  for (const frame of frames) {
    let name = frame.fileName
    const count = usedNames.get(name) ?? 0
    if (count > 0) {
      const dot = name.lastIndexOf('.')
      name = dot > 0 ? `${name.slice(0, dot)}_${count}${name.slice(dot)}` : `${name}_${count}`
    }
    usedNames.set(frame.fileName, count + 1)
    filesMap[name] = new Uint8Array(await frame.blob.arrayBuffer())
  }

  const zipped = zipSync(filesMap, { level: 0 })
  return new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
}

/** 将多帧合成为高清电影分镜缩略图拼图板（Contact Sheet）PNG */
export async function renderContactSheet(params: {
  frames: CapturedFrame[]
  videoInfo: VideoInfo
  columns: number
}): Promise<Blob> {
  const { frames, videoInfo } = params
  if (frames.length === 0) {
    throw new Error('没有可用于拼图的截图帧')
  }

  const cols = Math.min(Math.max(2, params.columns), Math.min(6, frames.length))
  const rows = Math.ceil(frames.length / cols)

  // 根据视频比例确定单格宽度，保持整图高清清晰（总宽约 2000–2400px）
  const padding = 32
  const gap = 16
  const headerH = 96
  const cellW = Math.round((2240 - padding * 2 - gap * (cols - 1)) / cols)
  const aspect = videoInfo.width > 0 && videoInfo.height > 0 ? videoInfo.height / videoInfo.width : 9 / 16
  const cellH = Math.max(90, Math.round(cellW * Math.min(1.8, Math.max(0.4, aspect))))

  const canvasW = padding * 2 + cols * cellW + (cols - 1) * gap
  const canvasH = headerH + padding + rows * cellH + (rows - 1) * gap + padding

  const canvas = document.createElement('canvas')
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 上下文不可用')

  // 深色胶片质感背景
  ctx.fillStyle = '#0f1117'
  ctx.fillRect(0, 0, canvasW, canvasH)

  // 顶部元数据栏
  ctx.fillStyle = '#f8fafc'
  ctx.font = '700 28px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ctx.textBaseline = 'top'
  ctx.fillText(videoInfo.name, padding, 24, canvasW - padding * 2)

  ctx.fillStyle = '#94a3b8'
  ctx.font = '500 18px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  const metaLine = `${videoInfo.width}×${videoInfo.height}   |   时长 ${formatTimecode(videoInfo.duration)}   |   体积 ${formatBytes(videoInfo.size)}   |   共 ${frames.length} 帧`
  ctx.fillText(metaLine, padding, 64, canvasW - padding * 2)

  // 逐帧绘制缩略图与左下角时间码徽章
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = padding + col * (cellW + gap)
    const y = headerH + padding + row * (cellH + gap)

    const bitmap = await createImageBitmap(frame.blob)
    try {
      ctx.save()
      ctx.beginPath()
      ctx.roundRect(x, y, cellW, cellH, 10)
      ctx.clip()
      ctx.drawImage(bitmap, x, y, cellW, cellH)
      ctx.restore()
    } finally {
      bitmap.close()
    }

    // 细边框
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.roundRect(x, y, cellW, cellH, 10)
    ctx.stroke()

    // 左下角时间码标签
    const label = frame.timecode
    ctx.font = '600 16px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    const lw = Math.ceil(ctx.measureText(label).width + 16)
    const lh = 26
    const lx = x + 10
    const ly = y + cellH - lh - 10
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)'
    ctx.beginPath()
    ctx.roundRect(lx, ly, lw, lh, 6)
    ctx.fill()
    ctx.fillStyle = '#f8fafc'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, lx + 8, ly + lh / 2 + 0.5)
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('分镜拼图生成失败'))), 'image/png')
  })
}
