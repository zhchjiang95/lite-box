/**
 * 统一图片识别与本地解码工具
 * - 支持常见位图（JPG / PNG / WebP / AVIF / GIF / BMP / ICO）、SVG 矢量图
 * - 完整支持 iPhone 14/15/16（iOS 17/18+）拍摄的 10-bit HDR HEIC / HEIF 照片
 * - heic-to（内置新版 libheif WASM）按需动态加载，非 HEIC 场景零额外开销
 */

/** 通用图片文件选择 accept 属性 */
export const IMAGE_ACCEPT = 'image/*,.heic,.heif,.hif,.ico,.bmp,.svg'

/** 判断文件是否为 HEIC / HEIF 格式（兼容浏览器未填充 MIME 的情况） */
export function isHeicLike(file: File): boolean {
  const type = file.type.toLowerCase()
  if (
    type === 'image/heic' ||
    type === 'image/heif' ||
    type === 'image/heic-sequence' ||
    type === 'image/heif-sequence'
  ) {
    return true
  }
  return /\.(heic|heif|hif)$/i.test(file.name)
}

/** 判断文件是否为支持的图片文件 */
export function isImageLike(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return /\.(png|jpe?g|webp|avif|gif|bmp|ico|svg|heic|heif|hif)$/i.test(file.name)
}

export interface DecodedImage {
  bitmap: ImageBitmap
  width: number
  height: number
  /** 可直接赋给 <img src> 展示的预览 URL（调用方负责在卸载时 revokeObjectURL） */
  previewUrl: string
  /** 可直接送给 Canvas / Worker 的浏览器标准图片 Blob（HEIC 时为转换后的标准图，常规图为原 File） */
  standardBlob: Blob
  isHeic: boolean
}

/** 将 ImageBitmap 转为浏览器通用的 <img> 可预览 Blob（预览上限 2048px 兼顾清晰度与速度） */
async function bitmapToPreviewBlob(bitmap: ImageBitmap, maxSide = 2048): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('生成预览图失败'))), 'image/jpeg', 0.92),
  )
  canvas.width = 0
  canvas.height = 0
  return blob
}

/** 使用 HTMLImageElement 解码 SVG（兼容未写死宽高的矢量文件） */
async function decodeSvg(file: File): Promise<DecodedImage> {
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
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
    const bitmap = await createImageBitmap(canvas)
    canvas.width = 0
    canvas.height = 0
    return { bitmap, width: w, height: h, previewUrl: url, standardBlob: file, isHeic: false }
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
}

/** 使用新版 heic-to（libheif WASM）解码 HEIC / HEIF（支持 iPhone 15/16 10-bit HDR 照片） */
async function decodeWithHeicTo(file: File): Promise<DecodedImage> {
  const { heicTo } = await import('heic-to')
  // 直接解码为 ImageBitmap，避免中间 PNG 编解码开销，速度更快、画质无损
  const bitmap = await heicTo({ blob: file, type: 'bitmap' })
  // Chrome / Firefox / Edge 的 <img> 无法直接渲染 HEIC 原始 Blob，需生成标准预览图
  const previewBlob = await bitmapToPreviewBlob(bitmap)
  const previewUrl = URL.createObjectURL(previewBlob)
  return {
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    previewUrl,
    standardBlob: previewBlob,
    isHeic: true,
  }
}

/**
 * 统一解码任意支持的图片文件（含 iPhone 15/16 HEIC/HEIF 与 SVG）
 * 调用方需负责释放返回的 bitmap.close() 与 URL.revokeObjectURL(previewUrl)
 */
export async function decodeImageFile(file: File): Promise<DecodedImage> {
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)
  if (isSvg) return decodeSvg(file)

  const heicHint = isHeicLike(file)

  // 1. 优先尝试浏览器原生 createImageBitmap（常规格式秒开；部分新版 Safari 也原生支持 HEIC）
  try {
    const bitmap = await createImageBitmap(file)
    if (heicHint) {
      // 即使是支持原生解码的浏览器，也统一转一份标准预览图确保 <img> 与后续导出稳定
      const previewBlob = await bitmapToPreviewBlob(bitmap)
      return {
        bitmap,
        width: bitmap.width,
        height: bitmap.height,
        previewUrl: URL.createObjectURL(previewBlob),
        standardBlob: previewBlob,
        isHeic: true,
      }
    }
    return {
      bitmap,
      width: bitmap.width,
      height: bitmap.height,
      previewUrl: URL.createObjectURL(file),
      standardBlob: file,
      isHeic: false,
    }
  } catch {
    // 2. 原生解码失败：检测是否为 HEIC / HEIF（即使扩展名被改成 .jpg 也能靠文件头魔数识别）
    try {
      if (heicHint) {
        return await decodeWithHeicTo(file)
      }
      const { isHeic } = await import('heic-to')
      if (await isHeic(file)) {
        return await decodeWithHeicTo(file)
      }
    } catch (heicErr) {
      console.error('[decodeImageFile] HEIC 解码失败:', heicErr)
      throw new Error('HEIC / HEIF 解码失败，请确认照片文件未损坏')
    }
    throw new Error('无法解析此图片，可能文件已损坏或格式不受支持')
  }
}

/** 将 HEIC 文件转为全分辨率 PNG File（供需要标准图片输入的后台 Worker 使用） */
export async function decodeHeicToPngFile(file: File): Promise<File> {
  const { heicTo } = await import('heic-to')
  const pngBlob = await heicTo({ blob: file, type: 'image/png' })
  const nextName = file.name.replace(/\.(heic|heif|hif)$/i, '.png')
  return new File([pngBlob], nextName, { type: 'image/png', lastModified: file.lastModified })
}
