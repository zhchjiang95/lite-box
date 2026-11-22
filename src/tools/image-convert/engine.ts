import { zip } from 'fflate'
import { encodeBmp24, encodeIco, type IcoFrame } from './encoders'
import {
  FORMAT_MAP,
  convertedFileName,
  isHeicFile,
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

/** 使用 HTMLImageElement 解码 SVG（支持缺少显式宽高的矢量图） */
async function decodeSvgToBitmap(file: File): Promise<{ bitmap: ImageBitmap; previewUrl: string }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('SVG 无法解析，请检查文件是否完整'))
      el.src = url
    })
    const w = img.naturalWidth || 1024
    const h = img.naturalHeight || 1024
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, w, h)
    const bitmap = await createImageBitmap(canvas)
    canvas.width = 0
    canvas.height = 0
    return { bitmap, previewUrl: url }
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
}

export interface DecodedSource {
  bitmap: ImageBitmap
  width: number
  height: number
  previewUrl: string
}

/**
 * 统一解码输入图片为 ImageBitmap
 * - SVG：通过 HTMLImageElement 栅格化解码
 * - HEIC/HEIF：优先尝试浏览器原生解码（如新版 Safari），失败时按需动态加载 heic2any 解码
 * - 其他常见格式：原生 createImageBitmap
 */
export async function decodeInputFile(file: File): Promise<DecodedSource> {
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)
  if (isSvg) {
    const { bitmap, previewUrl } = await decodeSvgToBitmap(file)
    return { bitmap, width: bitmap.width, height: bitmap.height, previewUrl }
  }

  // 优先走浏览器原生解码（速度快且零额外下载）
  try {
    const bitmap = await createImageBitmap(file)
    const previewUrl = URL.createObjectURL(file)
    return { bitmap, width: bitmap.width, height: bitmap.height, previewUrl }
  } catch (nativeErr) {
    if (!isHeicFile(file)) {
      throw new Error('无法解析此图片，可能文件已损坏或格式不受支持')
    }
    // 按需动态加载 heic2any，避免非 HEIC 用户承担额外包体积
    try {
      const { default: heic2any } = await import('heic2any')
      const output = await heic2any({ blob: file, toType: 'image/png' })
      const pngBlob = Array.isArray(output) ? output[0] : output
      const bitmap = await createImageBitmap(pngBlob)
      const previewUrl = URL.createObjectURL(pngBlob)
      return { bitmap, width: bitmap.width, height: bitmap.height, previewUrl }
    } catch {
      console.error('[image-convert] HEIC 解码失败:', nativeErr)
      throw new Error('HEIC / HEIF 解码失败，可能为不受支持的编码变体')
    }
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
