import { zip } from 'fflate'
import { decodeImageFile } from '@/lib/image'
import { encodeBmp24, encodeIco, type IcoFrame } from './encoders'
import {
  FORMAT_MAP,
  convertedFileName,
  type ConvertItem,
  type ConvertOptions,
  type ConvertResult,
} from './types'

/** 探测当前浏览器是否支持 AVIF 编码（缓存结果） */
let avifPromise: Promise<boolean> | null = null
export function detectAvifSupport(): Promise<boolean> {
  if (avifPromise) return avifPromise
  avifPromise = (async () => {
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        const c = new OffscreenCanvas(2, 2)
        c.getContext('2d')?.fillRect(0, 0, 2, 2)
        const b = await c.convertToBlob({ type: 'image/avif', quality: 0.8 })
        return b.type === 'image/avif'
      }
      const c = document.createElement('canvas')
      c.width = 2
      c.height = 2
      return await new Promise<boolean>((resolve) => {
        c.toBlob((b) => resolve(b?.type === 'image/avif'), 'image/avif', 0.8)
      })
    } catch {
      return false
    }
  })()
  return avifPromise
}

export interface DecodedSource {
  bitmap: ImageBitmap
  width: number
  height: number
  previewUrl: string
}

/**
 * 统一解码输入图片为 ImageBitmap（内置最新版 heic-to WASM 支持 iPhone 15/16 10-bit HDR HEIC）
 */
export async function decodeInputFile(file: File): Promise<DecodedSource> {
  const decoded = await decodeImageFile(file)
  return {
    bitmap: decoded.bitmap,
    width: decoded.width,
    height: decoded.height,
    previewUrl: decoded.previewUrl,
  }
}

/** 兼容 OffscreenCanvas 与普通 Canvas 导出 Blob */
async function renderCanvasToBlob(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void,
  mime: string,
  quality?: number,
): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法初始化 2D 画布上下文')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    draw(ctx)
    const blob = await canvas.convertToBlob({ type: mime, quality })
    canvas.width = 0
    canvas.height = 0
    return blob
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法初始化 2D 画布上下文')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  draw(ctx)
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片编码失败'))), mime, quality),
  )
  canvas.width = 0
  canvas.height = 0
  return blob
}

/** 计算非 ICO 目标输出尺寸 */
function computeTargetSize(srcW: number, srcH: number, opts: ConvertOptions) {
  if (opts.scaleMode === 'scale') {
    const factor = Math.max(0.1, Math.min(4, opts.scaleFactor))
    return {
      width: Math.max(1, Math.round(srcW * factor)),
      height: Math.max(1, Math.round(srcH * factor)),
    }
  }
  if (opts.scaleMode === 'max' && opts.maxDimension > 0) {
    const longest = Math.max(srcW, srcH)
    if (longest > opts.maxDimension) {
      const k = opts.maxDimension / longest
      return {
        width: Math.max(1, Math.round(srcW * k)),
        height: Math.max(1, Math.round(srcH * k)),
      }
    }
  }
  return { width: srcW, height: srcH }
}

/** 将已解码的 ImageBitmap 转换为目标格式 */
export async function convertBitmap(
  bitmap: ImageBitmap,
  opts: ConvertOptions,
  avifSupported: boolean,
): Promise<ConvertResult> {
  const start = performance.now()
  const format = opts.format === 'avif' && !avifSupported ? 'webp' : opts.format
  const info = FORMAT_MAP[format]

  // 1. 多尺寸 ICO 封装
  if (format === 'ico') {
    const sizes = [...new Set(opts.icoSizes)].sort((a, b) => a - b)
    if (!sizes.length) throw new Error('请至少选择一个 ICO 图标尺寸')

    const frames: IcoFrame[] = []
    let largestPngBlob: Blob | null = null

    for (const size of sizes) {
      const pngBlob = await renderCanvasToBlob(
        size,
        size,
        (ctx) => {
          const sw = bitmap.width
          const sh = bitmap.height
          const scale = opts.icoFit === 'cover' ? Math.max(size / sw, size / sh) : Math.min(size / sw, size / sh)
          const dw = sw * scale
          const dh = sh * scale
          ctx.drawImage(bitmap, (size - dw) / 2, (size - dh) / 2, dw, dh)
        },
        'image/png',
      )
      largestPngBlob = pngBlob
      const buf = await pngBlob.arrayBuffer()
      frames.push({ size, pngBytes: new Uint8Array(buf) })
    }

    const icoBlob = encodeIco(frames)
    const maxSize = sizes[sizes.length - 1]
    return {
      blob: icoBlob,
      format: 'ico',
      mime: info.mime,
      width: maxSize,
      height: maxSize,
      icoSizes: sizes,
      // 预览图使用最大尺寸 PNG，避免部分浏览器对多帧 ICO 只显示 16px 缩略帧
      previewUrl: URL.createObjectURL(largestPngBlob!),
      durationMs: Math.max(1, Math.round(performance.now() - start)),
    }
  }

  const { width, height } = computeTargetSize(bitmap.width, bitmap.height, opts)

  // 2. 标准 24-bit BMP 二进制编码
  if (format === 'bmp') {
    const bg = opts.background === 'transparent' ? '#ffffff' : opts.background
    let imageData: ImageData
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(bitmap, 0, 0, width, height)
      imageData = ctx.getImageData(0, 0, width, height)
      canvas.width = 0
      canvas.height = 0
    } else {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(bitmap, 0, 0, width, height)
      imageData = ctx.getImageData(0, 0, width, height)
      canvas.width = 0
      canvas.height = 0
    }
    const bmpBlob = encodeBmp24(imageData)
    return {
      blob: bmpBlob,
      format: 'bmp',
      mime: info.mime,
      width,
      height,
      previewUrl: URL.createObjectURL(bmpBlob),
      durationMs: Math.max(1, Math.round(performance.now() - start)),
    }
  }

  // 3. PNG / JPG / WebP / AVIF 原生编码
  const quality = info.lossy ? Math.max(0.1, Math.min(1, opts.quality / 100)) : undefined
  const blob = await renderCanvasToBlob(
    width,
    height,
    (ctx) => {
      if (!info.alpha) {
        ctx.fillStyle = opts.background === 'transparent' ? '#ffffff' : opts.background
        ctx.fillRect(0, 0, width, height)
      }
      ctx.drawImage(bitmap, 0, 0, width, height)
    },
    info.mime,
    quality,
  )

  return {
    blob,
    format,
    mime: info.mime,
    width,
    height,
    previewUrl: URL.createObjectURL(blob),
    durationMs: Math.max(1, Math.round(performance.now() - start)),
  }
}

/** 批量将已完成转换的文件打包为 ZIP */
export async function packConvertedZip(items: ConvertItem[]): Promise<Blob> {
  const ready = items.filter((it) => it.status === 'done' && it.result)
  if (!ready.length) throw new Error('没有可打包的已完成文件')

  const entries: Record<string, Uint8Array> = {}
  const usedNames = new Map<string, number>()

  for (const item of ready) {
    const res = item.result!
    const baseName = convertedFileName(item.file.name, res.format)
    const count = usedNames.get(baseName) ?? 0
    let finalName = baseName
    if (count > 0) {
      const dot = baseName.lastIndexOf('.')
      finalName = dot > 0 ? `${baseName.slice(0, dot)}-${count + 1}${baseName.slice(dot)}` : `${baseName}-${count + 1}`
    }
    usedNames.set(baseName, count + 1)
    entries[finalName] = new Uint8Array(await res.blob.arrayBuffer())
  }

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 0 }, (err, data) => {
      if (err) reject(err)
      else resolve(data)
    })
  })
  const zipBuf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
  return new Blob([zipBuf], { type: 'application/zip' })
}
