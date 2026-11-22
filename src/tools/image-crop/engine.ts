import { zip } from 'fflate'
import {
  FORMAT_EXT,
  FORMAT_MIME,
  type BatchItem,
  type BatchResizeOptions,
  type ExportFormat,
  type NormalizedCrop,
  type TransformState,
} from './types'

/** 计算旋转后的外接画布尺寸 */
export function getRotatedBounds(srcW: number, srcH: number, totalDeg: number) {
  const rad = (totalDeg * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  return {
    width: Math.max(1, Math.round(srcW * cos + srcH * sin)),
    height: Math.max(1, Math.round(srcW * sin + srcH * cos)),
    rad,
  }
}

/** 计算给定宽高比在变换画布内的居中最大裁剪框（归一化坐标） */
export function fitCropToRatio(boundsW: number, boundsH: number, ratio: number | null): NormalizedCrop {
  if (!ratio || ratio <= 0) {
    return { x: 0, y: 0, w: 1, h: 1 }
  }
  const stageRatio = boundsW / boundsH
  if (stageRatio > ratio) {
    // 画布更宽：高度撑满，宽度居中
    const w = ratio / stageRatio
    return { x: (1 - w) / 2, y: 0, w, h: 1 }
  }
  // 画布更高：宽度撑满，高度居中
  const h = stageRatio / ratio
  return { x: 0, y: (1 - h) / 2, w: 1, h }
}

/** 在预览 canvas 上绘制经旋转与翻转后的整张图像（自动限幅保证交互 60fps） */
export function renderTransformedPreview(
  canvas: HTMLCanvasElement,
  bitmap: ImageBitmap,
  transform: TransformState,
  maxPreviewSide = 1600,
) {
  const totalDeg = transform.baseRotate + transform.fineRotate
  const { width: bw, height: bh, rad } = getRotatedBounds(bitmap.width, bitmap.height, totalDeg)
  const scale = Math.min(1, maxPreviewSide / Math.max(bw, bh))
  const pw = Math.max(1, Math.round(bw * scale))
  const ph = Math.max(1, Math.round(bh * scale))

  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw
    canvas.height = ph
  }
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, pw, ph)

  ctx.save()
  ctx.translate(pw / 2, ph / 2)
  ctx.scale((transform.flipX ? -1 : 1) * scale, (transform.flipY ? -1 : 1) * scale)
  ctx.rotate(rad)
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
  ctx.restore()
}

export interface CropExportParams {
  bitmap: ImageBitmap
  transform: TransformState
  crop: NormalizedCrop
  outWidth: number
  outHeight: number
  format: ExportFormat
  quality: number
  /** 非透明格式填充底色 */
  background: string
  /** 是否裁切为圆形透明输出（仅 PNG / WebP 支持透明） */
  circleMask: boolean
}

/** 使用单次精确矩阵从原分辨率 ImageBitmap 渲染并导出裁剪结果 */
export async function exportCroppedImage(params: CropExportParams): Promise<Blob> {
  const { bitmap, transform, crop, outWidth, outHeight, format, quality, background, circleMask } = params
  const totalDeg = transform.baseRotate + transform.fineRotate
  const { width: bw, height: bh, rad } = getRotatedBounds(bitmap.width, bitmap.height, totalDeg)

  const cx = crop.x * bw
  const cy = crop.y * bh
  const cw = Math.max(1, crop.w * bw)
  const ch = Math.max(1, crop.h * bh)

  const w = Math.max(1, Math.round(outWidth))
  const h = Math.max(1, Math.round(outHeight))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // JPG 不支持透明通道，先铺底色
  if (format === 'jpeg') {
    ctx.fillStyle = background === 'transparent' ? '#ffffff' : background
    ctx.fillRect(0, 0, w, h)
  }

  ctx.save()
  if (circleMask) {
    ctx.beginPath()
    ctx.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()
  }

  // 与预览完全一致的坐标映射：缩放至目标尺寸 -> 扣掉裁剪左上偏移 -> 移至变换中心 -> 翻转旋转 -> 绘制原图
  ctx.scale(w / cw, h / ch)
  ctx.translate(-cx, -cy)
  ctx.translate(bw / 2, bh / 2)
  ctx.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1)
  ctx.rotate(rad)
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
  ctx.restore()

  const mime = FORMAT_MIME[format]
  const q = format === 'png' ? undefined : Math.max(0.1, Math.min(1, quality / 100))
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('导出失败：输出尺寸可能过大'))), mime, q),
  )
  canvas.width = 0
  canvas.height = 0
  return blob
}

/** 计算批量缩放后的目标像素尺寸 */
export function computeBatchSize(srcW: number, srcH: number, opts: BatchResizeOptions) {
  const swapped = opts.rotate % 180 !== 0
  const rw = swapped ? srcH : srcW
  const rh = swapped ? srcW : srcH

  switch (opts.mode) {
    case 'percent': {
      const k = Math.max(0.05, Math.min(4, opts.percent / 100))
      return { width: Math.max(1, Math.round(rw * k)), height: Math.max(1, Math.round(rh * k)) }
    }
    case 'width': {
      const targetW = Math.max(1, Math.round(opts.width))
      return { width: targetW, height: Math.max(1, Math.round((rh * targetW) / rw)) }
    }
    case 'height': {
      const targetH = Math.max(1, Math.round(opts.height))
      return { width: Math.max(1, Math.round((rw * targetH) / rh)), height: targetH }
    }
    case 'exact': {
      return {
        width: Math.max(1, Math.round(opts.width)),
        height: Math.max(1, Math.round(opts.height)),
      }
    }
    case 'max': {
      const longest = Math.max(rw, rh)
      if (longest <= opts.maxDimension) return { width: rw, height: rh }
      const k = opts.maxDimension / longest
      return { width: Math.max(1, Math.round(rw * k)), height: Math.max(1, Math.round(rh * k)) }
    }
  }
}

/** 决定批量缩放单图的实际导出格式 */
function resolveBatchExportFormat(sourceMime: string, fmt: BatchResizeOptions['format']): ExportFormat {
  if (fmt !== 'original') return fmt
  if (sourceMime === 'image/jpeg' || sourceMime === 'image/jpg') return 'jpeg'
  if (sourceMime === 'image/webp') return 'webp'
  return 'png'
}

/** 对批量队列中的单张图片执行缩放与变换 */
export async function processBatchItem(
  bitmap: ImageBitmap,
  sourceMime: string,
  opts: BatchResizeOptions,
): Promise<{ blob: Blob; width: number; height: number; mime: string }> {
  const { width, height } = computeBatchSize(bitmap.width, bitmap.height, opts)
  const fmt = resolveBatchExportFormat(sourceMime, opts.format)
  const mime = FORMAT_MIME[fmt]

  const { width: bw, height: bh, rad } = getRotatedBounds(bitmap.width, bitmap.height, opts.rotate)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const needBg = fmt === 'jpeg' || (opts.mode === 'exact' && opts.fit === 'contain' && opts.background !== 'transparent')
  if (needBg) {
    ctx.fillStyle = opts.background === 'transparent' ? '#ffffff' : opts.background
    ctx.fillRect(0, 0, width, height)
  }

  // 计算将旋转后图像映射到目标画布的缩放比例
  let sx = width / bw
  let sy = height / bh
  if (opts.mode === 'exact') {
    if (opts.fit === 'cover') {
      const k = Math.max(sx, sy)
      sx = k
      sy = k
    } else if (opts.fit === 'contain') {
      const k = Math.min(sx, sy)
      sx = k
      sy = k
    }
  }

  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.scale((opts.flipX ? -1 : 1) * sx, (opts.flipY ? -1 : 1) * sy)
  ctx.rotate(rad)
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
  ctx.restore()

  const q = fmt === 'png' ? undefined : Math.max(0.1, Math.min(1, opts.quality / 100))
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('缩放导出失败'))), mime, q),
  )
  canvas.width = 0
  canvas.height = 0
  return { blob, width, height, mime }
}

/** 批量缩放输出文件名 */
export function batchOutputName(originalName: string, mime: string) {
  const base = originalName.replace(/\.[^.]+$/, '') || 'resized'
  const ext = mime === 'image/jpeg' ? FORMAT_EXT.jpeg : mime === 'image/webp' ? FORMAT_EXT.webp : FORMAT_EXT.png
  return `${base}.${ext}`
}

/** 将批量缩放完成的图片打包为 ZIP */
export async function packResizedZip(items: BatchItem[]): Promise<Blob> {
  const ready = items.filter((it) => it.status === 'done' && it.outBlob && it.outMime)
  if (!ready.length) throw new Error('没有可打包的已完成图片')

  const entries: Record<string, Uint8Array> = {}
  const used = new Map<string, number>()

  for (const item of ready) {
    const baseName = batchOutputName(item.file.name, item.outMime!)
    const n = used.get(baseName) ?? 0
    let finalName = baseName
    if (n > 0) {
      const dot = baseName.lastIndexOf('.')
      finalName = dot > 0 ? `${baseName.slice(0, dot)}-${n + 1}${baseName.slice(dot)}` : `${baseName}-${n + 1}`
    }
    used.set(baseName, n + 1)
    entries[finalName] = new Uint8Array(await item.outBlob!.arrayBuffer())
  }

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data)))
  })
  const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
  return new Blob([buf], { type: 'application/zip' })
}
