import * as UPNGMod from 'upng-js'
import {
  qualityToPngColors,
  resolveTargetMime,
  type CompressOptions,
  type CompressResult,
  type ConcreteMime,
} from './types'

// 兼容 Vite 开发态与生产构建的 CJS/ESM 导出形态
const UPNG = ((UPNGMod as unknown as { default?: typeof UPNGMod }).default ?? UPNGMod) as typeof UPNGMod

export interface WorkerRequest {
  id: number
  file: File
  options: CompressOptions
  avifSupported: boolean
}

export interface WorkerResponse {
  id: number
  ok: true
  result: CompressResult
}

export interface WorkerErrorResponse {
  id: number
  ok: false
  error: string
}

/** 计算等比缩放后的目标尺寸（仅缩小不放大） */
function calcTargetSize(w: number, h: number, limitSize: boolean, maxDimension: number) {
  if (!limitSize || maxDimension <= 0) return { width: w, height: h, resized: false }
  const longest = Math.max(w, h)
  if (longest <= maxDimension) return { width: w, height: h, resized: false }
  const scale = maxDimension / longest
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    resized: true,
  }
}

/** 使用 OffscreenCanvas + UPNG 在 Worker 中执行单张图片压缩 */
async function compressInWorker(
  file: File,
  options: CompressOptions,
  avifSupported: boolean,
): Promise<CompressResult> {
  const start = performance.now()
  const bitmap = await createImageBitmap(file)
  const originalWidth = bitmap.width
  const originalHeight = bitmap.height

  try {
    const { width, height, resized } = calcTargetSize(
      originalWidth,
      originalHeight,
      options.limitSize,
      options.maxDimension,
    )
    const targetMime: ConcreteMime = resolveTargetMime(file.type, options.format, avifSupported)

    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { willReadFrequently: targetMime === 'image/png' })
    if (!ctx) throw new Error('无法初始化 2D 渲染上下文')

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    // JPG 不支持透明通道，先填充用户指定的背景色避免出现黑底
    if (targetMime === 'image/jpeg') {
      ctx.fillStyle = options.jpegBg === 'transparent' ? '#ffffff' : options.jpegBg
      ctx.fillRect(0, 0, width, height)
    }
    ctx.drawImage(bitmap, 0, 0, width, height)

    let blob: Blob
    if (targetMime === 'image/png') {
      const cnum = qualityToPngColors(options.quality)
      if (cnum === 0) {
        // 100% 画质：使用原生无损 PNG 编码
        blob = await canvas.convertToBlob({ type: 'image/png' })
      } else {
        // <100% 画质：使用 UPNG 色彩量化（类似 TinyPNG），大幅压缩 PNG 体积
        const imageData = ctx.getImageData(0, 0, width, height)
        const rgbaBuf = imageData.data.buffer.slice(
          imageData.data.byteOffset,
          imageData.data.byteOffset + imageData.data.byteLength,
        )
        const encoded = UPNG.encode([rgbaBuf], width, height, cnum)
        blob = new Blob([encoded], { type: 'image/png' })
      }
    } else {
      blob = await canvas.convertToBlob({
        type: targetMime,
        quality: Math.max(0.05, Math.min(1, options.quality / 100)),
      })
    }

    // 释放画布显存
    canvas.width = 0
    canvas.height = 0

    // 判断格式与尺寸未变化时，若压缩后反而更大则按配置保留原图
    const sameFormat =
      file.type === targetMime || (file.type === 'image/jpg' && targetMime === 'image/jpeg')
    const keptOriginal = options.keepSmaller && sameFormat && !resized && blob.size >= file.size
    const finalBlob = keptOriginal ? file : blob

    return {
      blob: finalBlob,
      mime: targetMime,
      width,
      height,
      originalWidth,
      originalHeight,
      keptOriginal,
      durationMs: Math.max(1, Math.round(performance.now() - start)),
    }
  } finally {
    bitmap.close()
  }
}

self.addEventListener('message', async (e: MessageEvent<WorkerRequest>) => {
  const { id, file, options, avifSupported } = e.data
  try {
    const result = await compressInWorker(file, options, avifSupported)
    const msg: WorkerResponse = { id, ok: true, result }
    self.postMessage(msg)
  } catch (err) {
    const msg: WorkerErrorResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : '图片压缩失败',
    }
    self.postMessage(msg)
  }
})
