/**
 * 视频转 GIF 动图核心引擎（基于 gifenc 纯 JS 极速编码器）
 * - 离屏 <video> 精确时间点抽帧 + 胶片时间轴缩略图提取
 * - 支持原比例 / 1:1 / 16:9 / 4:3 / 9:16 居中裁切
 * - 支持逐帧独立调色板（高画质）与全局共享调色板（更小体积）
 * - 内置 4×4 Bayer 有序抖动算法消除渐变色带，同时保持极佳 LZW 压缩率
 * - 支持倍速、倒放、往返乒乓循环（Boomerang）及表情包配文烧录
 */

import { applyPalette, GIFEncoder, quantize, type PaletteColor } from 'gifenc'

export type CropAspect = 'original' | '1:1' | '16:9' | '4:3' | '9:16'
export type PaletteMode = 'per-frame' | 'global'
export type LoopMode = 'infinite' | 'once' | 'boomerang'
export type CaptionPosition = 'bottom' | 'top'

export interface GifEncodeConfig {
  /** 截取起点（秒） */
  startSec: number
  /** 截取终点（秒） */
  endSec: number
  /** 目标宽度（px，高度按裁切比例自动计算） */
  width: number
  /** 目标帧率（fps） */
  fps: number
  /** 播放倍速（0.5–3） */
  speed: number
  /** 裁切画幅 */
  cropAspect: CropAspect
  /** 调色板色彩上限（64 / 128 / 256） */
  maxColors: number
  /** 调色板策略 */
  paletteMode: PaletteMode
  /** 是否开启 4×4 有序抖动抗色带 */
  dither: boolean
  /** 循环模式（无限 / 单次 / 往返回弹） */
  loopMode: LoopMode
  /** 是否倒放 */
  reverse: boolean
  /** 可选配文字幕 */
  captionText: string
  /** 配文位置 */
  captionPosition: CaptionPosition
}

export interface GifPreset {
  id: string
  name: string
  desc: string
  patch: Partial<GifEncodeConfig>
}

export const GIF_PRESETS: GifPreset[] = [
  {
    id: 'wechat',
    name: '微信表情包',
    desc: '320px · 12fps · 轻量',
    patch: { width: 320, fps: 12, maxColors: 128, paletteMode: 'global', dither: true },
  },
  {
    id: 'doc',
    name: '文档 / 演示',
    desc: '640px · 12fps · 均衡',
    patch: { width: 640, fps: 12, maxColors: 256, paletteMode: 'per-frame', dither: true },
  },
  {
    id: 'hd',
    name: '高清动图',
    desc: '800px · 15fps · 锐利',
    patch: { width: 800, fps: 15, maxColors: 256, paletteMode: 'per-frame', dither: true },
  },
  {
    id: 'smooth',
    name: '丝滑高帧',
    desc: '480px · 20fps · 流畅',
    patch: { width: 480, fps: 20, maxColors: 192, paletteMode: 'per-frame', dither: false },
  },
]

export const DEFAULT_GIF_CONFIG: GifEncodeConfig = {
  startSec: 0,
  endSec: 5,
  width: 540,
  fps: 12,
  speed: 1,
  cropAspect: 'original',
  maxColors: 256,
  paletteMode: 'per-frame',
  dither: true,
  loopMode: 'infinite',
  reverse: false,
  captionText: '',
  captionPosition: 'bottom',
}

/** 计算输出画幅与源视频居中裁切区域 */
export function computeGifGeometry(
  srcW: number,
  srcH: number,
  targetWidth: number,
  cropAspect: CropAspect,
): { outW: number; outH: number; sx: number; sy: number; sw: number; sh: number } {
  const safeSrcW = Math.max(1, srcW)
  const safeSrcH = Math.max(1, srcH)
  const srcRatio = safeSrcW / safeSrcH

  let targetRatio = srcRatio
  if (cropAspect === '1:1') targetRatio = 1
  else if (cropAspect === '16:9') targetRatio = 16 / 9
  else if (cropAspect === '4:3') targetRatio = 4 / 3
  else if (cropAspect === '9:16') targetRatio = 9 / 16

  let sx = 0
  let sy = 0
  let sw = safeSrcW
  let sh = safeSrcH

  if (cropAspect !== 'original') {
    if (srcRatio > targetRatio) {
      sw = safeSrcH * targetRatio
      sx = (safeSrcW - sw) / 2
    } else {
      sh = safeSrcW / targetRatio
      sy = (safeSrcH - sh) / 2
    }
  }

  const outW = Math.max(64, Math.min(1280, Math.round(targetWidth / 2) * 2))
  const outH = Math.max(64, Math.round(outW / targetRatio / 2) * 2)
  return { outW, outH, sx, sy, sw, sh }
}

/** 估算输出总帧数与 GIF 实际播放时长 */
export function estimateGifFrames(config: GifEncodeConfig): {
  baseFrames: number
  totalFrames: number
  outputDurationSec: number
} {
  const clipDur = Math.max(0.1, config.endSec - config.startSec)
  const playDur = clipDur / Math.max(0.25, config.speed)
  const baseFrames = Math.max(2, Math.round(playDur * config.fps))
  const totalFrames = config.loopMode === 'boomerang' && baseFrames > 2 ? baseFrames * 2 - 2 : baseFrames
  const outputDurationSec = totalFrames / Math.max(1, config.fps)
  return { baseFrames, totalFrames, outputDurationSec }
}

/** 将秒数格式化为 00:05.2 */
export function formatTimeShort(sec: number): string {
  const safe = Math.max(0, sec)
  const m = Math.floor(safe / 60)
  const s = safe - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`
}

/** 精确 seek 离屏 video 到指定时间戳 */
function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const clamped = Math.max(0, Math.min(Math.max(0, (video.duration || 0) - 0.02), timeSec))
    if (Math.abs(video.currentTime - clamped) < 0.008 && video.readyState >= 2) {
      resolve()
      return
    }
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const fail = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('视频定位抽帧失败'))
    }
    const timer = window.setTimeout(done, 1500)
    const cleanup = () => {
      window.clearTimeout(timer)
      video.removeEventListener('seeked', done)
      video.removeEventListener('error', fail)
    }
    video.addEventListener('seeked', done, { once: true })
    video.addEventListener('error', fail, { once: true })
    video.currentTime = clamped
  })
}

/** 创建加载完毕的离屏 <video> 元素 */
async function createOffscreenVideo(videoUrl: string): Promise<HTMLVideoElement> {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.crossOrigin = 'anonymous'
  video.src = videoUrl

  await new Promise<void>((resolve, reject) => {
    const onLoaded = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('视频加载失败，可能格式不受浏览器支持'))
    }
    const cleanup = () => {
      video.removeEventListener('loadeddata', onLoaded)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('loadeddata', onLoaded, { once: true })
    video.addEventListener('error', onError, { once: true })
    video.load()
  })

  return video
}

/** 提取视频胶片缩略图条（用于时间轴直观框选片段） */
export async function extractVideoFilmstrip(
  videoUrl: string,
  durationSec: number,
  count = 10,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!durationSec || durationSec <= 0) return []
  const video = await createOffscreenVideo(videoUrl)
  const thumbs: string[] = []
  try {
    const thumbH = 56
    const ratio = (video.videoWidth || 16) / Math.max(1, video.videoHeight || 9)
    const thumbW = Math.max(40, Math.min(120, Math.round(thumbH * ratio)))
    const canvas = document.createElement('canvas')
    canvas.width = thumbW
    canvas.height = thumbH
    const ctx = canvas.getContext('2d')!

    for (let i = 0; i < count; i++) {
      if (signal?.aborted) break
      const t = ((i + 0.5) / count) * durationSec
      await seekVideo(video, t)
      ctx.drawImage(video, 0, 0, thumbW, thumbH)
      thumbs.push(canvas.toDataURL('image/jpeg', 0.65))
    }
  } finally {
    video.src = ''
    video.load()
  }
  return thumbs
}

// ============================================================================
// 4×4 Bayer 有序抖动（消除渐变色带，同时保持极佳 LZW 压缩体积）
// ============================================================================

const BAYER_4X4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
]

function applyOrderedBayerDither(rgba: Uint8ClampedArray, width: number, height: number, maxColors: number) {
  // 色彩越少抖动步幅略大，256 色时轻度抖动即可消除天空/皮肤渐变条纹
  const spread = maxColors <= 64 ? 16 : maxColors <= 128 ? 11 : 7
  for (let y = 0; y < height; y++) {
    const rowOffset = (y & 3) << 2
    const yBase = y * width
    for (let x = 0; x < width; x++) {
      const i = (yBase + x) << 2
      const threshold = (BAYER_4X4[rowOffset | (x & 3)] / 16 - 0.5) * spread
      let r = rgba[i] + threshold
      let g = rgba[i + 1] + threshold
      let b = rgba[i + 2] + threshold
      rgba[i] = r < 0 ? 0 : r > 255 ? 255 : r
      rgba[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g
      rgba[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b
    }
  }
}

/** 绘制顶部或底部高对比度表情包 / 演示配文 */
function drawCaptionOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
  position: CaptionPosition,
) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2)
  if (lines.length === 0) return

  const fontSize = Math.max(15, Math.min(44, Math.round(width * 0.062)))
  const lineH = Math.round(fontSize * 1.24)
  const margin = Math.max(10, Math.round(height * 0.055))

  ctx.save()
  ctx.font = `800 ${fontSize}px "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(3, Math.round(fontSize * 0.17))
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.92)'
  ctx.fillStyle = '#ffffff'

  const baseY =
    position === 'top'
      ? margin + fontSize * 0.55
      : height - margin - fontSize * 0.55 - (lines.length - 1) * lineH

  lines.forEach((line, idx) => {
    const y = baseY + idx * lineH
    const maxW = width * 0.92
    ctx.strokeText(line, width / 2, y, maxW)
    ctx.fillText(line, width / 2, y, maxW)
  })
  ctx.restore()
}

export interface GifEncodeProgress {
  stage: 'extracting' | 'encoding'
  current: number
  total: number
  percent: number
}

export interface GifEncodeResult {
  blob: Blob
  width: number
  height: number
  frameCount: number
  durationSec: number
  elapsedMs: number
}

/**
 * 将本地视频指定片段编码为高画质 GIF 动图
 */
export async function encodeVideoToGif(
  videoUrl: string,
  config: GifEncodeConfig,
  onProgress?: (p: GifEncodeProgress) => void,
  signal?: AbortSignal,
): Promise<GifEncodeResult> {
  const t0 = performance.now()
  const video = await createOffscreenVideo(videoUrl)

  try {
    const geom = computeGifGeometry(video.videoWidth, video.videoHeight, config.width, config.cropAspect)
    const { baseFrames } = estimateGifFrames(config)

    // 构造所有待抽取的源视频时间戳
    const clipSpan = Math.max(0.05, config.endSec - config.startSec)
    const timestamps: number[] = []
    for (let i = 0; i < baseFrames; i++) {
      const ratio = baseFrames > 1 ? i / (baseFrames - 1) : 0
      timestamps.push(config.startSec + ratio * clipSpan)
    }
    if (config.reverse) {
      timestamps.reverse()
    }

    const canvas = document.createElement('canvas')
    canvas.width = geom.outW
    canvas.height = geom.outH
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    const delayMs = Math.max(20, Math.round(1000 / Math.max(1, config.fps)))
    const repeat = config.loopMode === 'once' ? -1 : 0
    const needsAllFramesInMem = config.paletteMode === 'global' || config.loopMode === 'boomerang'

    const gif = GIFEncoder()

    if (!needsAllFramesInMem) {
      // 流式单帧模式（逐帧独立调色板 + 非往返）：内存极省，抽一帧编一帧
      for (let i = 0; i < timestamps.length; i++) {
        if (signal?.aborted) throw new Error('已取消生成')
        await seekVideo(video, timestamps[i])
        ctx.drawImage(video, geom.sx, geom.sy, geom.sw, geom.sh, 0, 0, geom.outW, geom.outH)
        if (config.captionText.trim()) {
          drawCaptionOverlay(ctx, geom.outW, geom.outH, config.captionText, config.captionPosition)
        }
        const imgData = ctx.getImageData(0, 0, geom.outW, geom.outH)
        if (config.dither) {
          applyOrderedBayerDither(imgData.data, geom.outW, geom.outH, config.maxColors)
        }
        const palette = quantize(imgData.data, config.maxColors, { format: 'rgb565' })
        const index = applyPalette(imgData.data, palette, 'rgb565')
        gif.writeFrame(index, geom.outW, geom.outH, {
          palette,
          delay: delayMs,
          repeat: i === 0 ? repeat : undefined,
        })

        onProgress?.({
          stage: 'encoding',
          current: i + 1,
          total: timestamps.length,
          percent: Math.round(((i + 1) / timestamps.length) * 100),
        })
        // 让出主线程保持进度条与取消按钮丝滑响应
        await new Promise((r) => setTimeout(r, 0))
      }

      gif.finish()
      const rawBytes = gif.bytes()
      const blob = new Blob([new Uint8Array(rawBytes)], { type: 'image/gif' })
      return {
        blob,
        width: geom.outW,
        height: geom.outH,
        frameCount: timestamps.length,
        durationSec: (timestamps.length * delayMs) / 1000,
        elapsedMs: Math.round(performance.now() - t0),
      }
    }

    // 缓冲帧模式（全局共享调色板 或 往返乒乓循环）
    const capturedFrames: Uint8ClampedArray[] = []
    for (let i = 0; i < timestamps.length; i++) {
      if (signal?.aborted) throw new Error('已取消生成')
      await seekVideo(video, timestamps[i])
      ctx.drawImage(video, geom.sx, geom.sy, geom.sw, geom.sh, 0, 0, geom.outW, geom.outH)
      if (config.captionText.trim()) {
        drawCaptionOverlay(ctx, geom.outW, geom.outH, config.captionText, config.captionPosition)
      }
      const imgData = ctx.getImageData(0, 0, geom.outW, geom.outH)
      if (config.dither) {
        applyOrderedBayerDither(imgData.data, geom.outW, geom.outH, config.maxColors)
      }
      capturedFrames.push(new Uint8ClampedArray(imgData.data))

      onProgress?.({
        stage: 'extracting',
        current: i + 1,
        total: timestamps.length,
        percent: Math.round(((i + 1) / timestamps.length) * 50),
      })
      await new Promise((r) => setTimeout(r, 0))
    }

    // 若为全局调色板，跨帧均匀抽样最多 8 帧像素构建高代表性共享色板
    let globalPalette: PaletteColor[] | null = null
    if (config.paletteMode === 'global') {
      const sampleCount = Math.min(8, capturedFrames.length)
      const pixelStride = Math.max(1, Math.floor((geom.outW * geom.outH) / 24000))
      const sampledBytes: number[] = []
      for (let s = 0; s < sampleCount; s++) {
        const frameIdx = Math.min(
          capturedFrames.length - 1,
          Math.floor((s * capturedFrames.length) / sampleCount),
        )
        const buf = capturedFrames[frameIdx]
        for (let p = 0; p < buf.length; p += pixelStride * 4) {
          sampledBytes.push(buf[p], buf[p + 1], buf[p + 2], 255)
        }
      }
      globalPalette = quantize(new Uint8Array(sampledBytes), config.maxColors, { format: 'rgb565' })
    }

    // 生成最终播放帧序列（往返模式追加倒序中间帧形成无缝回弹）
    const frameOrder: number[] = capturedFrames.map((_, idx) => idx)
    if (config.loopMode === 'boomerang' && capturedFrames.length > 2) {
      for (let i = capturedFrames.length - 2; i >= 1; i--) {
        frameOrder.push(i)
      }
    }

    // 逐帧调色板缓存（往返复用已量化结果，提速近 2 倍）
    const perFrameCache = new Map<number, { palette: PaletteColor[]; index: Uint8Array }>()

    for (let i = 0; i < frameOrder.length; i++) {
      if (signal?.aborted) throw new Error('已取消生成')
      const srcIdx = frameOrder[i]
      const rgba = capturedFrames[srcIdx]

      if (globalPalette) {
        const index = applyPalette(rgba, globalPalette, 'rgb565')
        gif.writeFrame(index, geom.outW, geom.outH, {
          palette: i === 0 ? globalPalette : undefined,
          delay: delayMs,
          repeat: i === 0 ? repeat : undefined,
        })
      } else {
        let cached = perFrameCache.get(srcIdx)
        if (!cached) {
          const palette = quantize(rgba, config.maxColors, { format: 'rgb565' })
          const index = applyPalette(rgba, palette, 'rgb565')
          cached = { palette, index }
          perFrameCache.set(srcIdx, cached)
        }
        gif.writeFrame(cached.index, geom.outW, geom.outH, {
          palette: cached.palette,
          delay: delayMs,
          repeat: i === 0 ? repeat : undefined,
        })
      }

      onProgress?.({
        stage: 'encoding',
        current: i + 1,
        total: frameOrder.length,
        percent: 50 + Math.round(((i + 1) / frameOrder.length) * 50),
      })
      await new Promise((r) => setTimeout(r, 0))
    }

    gif.finish()
    const rawBytes = gif.bytes()
    const blob = new Blob([new Uint8Array(rawBytes)], { type: 'image/gif' })
    return {
      blob,
      width: geom.outW,
      height: geom.outH,
      frameCount: frameOrder.length,
      durationSec: (frameOrder.length * delayMs) / 1000,
      elapsedMs: Math.round(performance.now() - t0),
    }
  } finally {
    video.src = ''
    video.load()
  }
}
