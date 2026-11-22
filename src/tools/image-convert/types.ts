/** 图片格式转换：类型、格式定义与辅助函数 */

export type TargetFormat = 'png' | 'jpeg' | 'webp' | 'avif' | 'bmp' | 'ico'
export type IcoFit = 'contain' | 'cover'
export type ScaleMode = 'original' | 'scale' | 'max'

export interface FormatInfo {
  id: TargetFormat
  label: string
  ext: string
  mime: string
  /** 简短特性提示 */
  tag: string
  /** 是否支持透明通道 */
  alpha: boolean
  /** 是否支持画质滑块调节 */
  lossy: boolean
}

export const FORMAT_LIST: FormatInfo[] = [
  { id: 'png', label: 'PNG', ext: 'png', mime: 'image/png', tag: '无损透明', alpha: true, lossy: false },
  { id: 'jpeg', label: 'JPG', ext: 'jpg', mime: 'image/jpeg', tag: '通用小体积', alpha: false, lossy: true },
  { id: 'webp', label: 'WebP', ext: 'webp', mime: 'image/webp', tag: '网页首选', alpha: true, lossy: true },
  { id: 'avif', label: 'AVIF', ext: 'avif', mime: 'image/avif', tag: '极致压缩', alpha: true, lossy: true },
  { id: 'bmp', label: 'BMP', ext: 'bmp', mime: 'image/bmp', tag: '无损位图', alpha: false, lossy: false },
  { id: 'ico', label: 'ICO', ext: 'ico', mime: 'image/x-icon', tag: '多尺寸图标', alpha: true, lossy: false },
]

export const FORMAT_MAP = Object.fromEntries(FORMAT_LIST.map((f) => [f.id, f])) as Record<TargetFormat, FormatInfo>

export const ICO_SIZES = [16, 32, 48, 64, 128, 256] as const
export type IcoSize = (typeof ICO_SIZES)[number]

export interface ConvertOptions {
  /** 目标格式 */
  format: TargetFormat
  /** 有损格式画质（10 - 100） */
  quality: number
  /** 不支持透明的格式（JPG / BMP）的背景填充色 */
  background: string
  /** ICO 多尺寸选择 */
  icoSizes: IcoSize[]
  /** ICO 正方形裁切方式 */
  icoFit: IcoFit
  /** 输出尺寸模式（非 ICO 时生效） */
  scaleMode: ScaleMode
  /** 指定缩放倍率 */
  scaleFactor: number
  /** 限制最大边长 */
  maxDimension: number
}

export const defaultConvertOptions: ConvertOptions = {
  format: 'webp',
  quality: 90,
  background: '#ffffff',
  icoSizes: [16, 32, 48, 256],
  icoFit: 'contain',
  scaleMode: 'original',
  scaleFactor: 1,
  maxDimension: 1920,
}

export interface ConvertResult {
  blob: Blob
  format: TargetFormat
  mime: string
  width: number
  height: number
  /** ICO 导出包含的全部尺寸 */
  icoSizes?: number[]
  /** 预览图 URL（ICO 时为最大帧 PNG，保证所有浏览器稳定渲染） */
  previewUrl: string
  durationMs: number
}

export interface ConvertItem {
  id: string
  file: File
  /** 识别出的源格式标签 */
  sourceLabel: string
  /** 是否为 HEIC / HEIF */
  isHeic: boolean
  /** 解码后的源图预览 URL（HEIC 解码完成后生成） */
  sourcePreviewUrl: string
  originalWidth: number
  originalHeight: number
  status: 'decoding' | 'converting' | 'done' | 'error'
  error?: string
  result?: ConvertResult
  version: number
}

/** 判断文件是否为 HEIC / HEIF（部分系统不会填写 file.type，需结合扩展名判断） */
export function isHeicFile(file: File): boolean {
  const type = file.type.toLowerCase()
  if (type === 'image/heic' || type === 'image/heif' || type === 'image/heic-sequence' || type === 'image/heif-sequence') {
    return true
  }
  return /\.(heic|heif)$/i.test(file.name)
}

/** 判断是否为支持的输入图片文件 */
export function isSupportedInputImage(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return /\.(png|jpe?g|webp|avif|gif|bmp|ico|svg|heic|heif)$/i.test(file.name)
}

/** 识别输入文件的简短格式名称 */
export function detectSourceLabel(file: File): string {
  if (isHeicFile(file)) return /\.heif$/i.test(file.name) ? 'HEIF' : 'HEIC'
  const type = file.type.toLowerCase()
  if (type === 'image/jpeg' || type === 'image/jpg') return 'JPG'
  if (type === 'image/png') return 'PNG'
  if (type === 'image/webp') return 'WebP'
  if (type === 'image/avif') return 'AVIF'
  if (type === 'image/gif') return 'GIF'
  if (type === 'image/bmp' || type === 'image/x-ms-bmp') return 'BMP'
  if (type === 'image/x-icon' || type === 'image/vnd.microsoft.icon') return 'ICO'
  if (type === 'image/svg+xml') return 'SVG'
  const ext = file.name.split('.').pop()?.toUpperCase()
  return ext && ext.length <= 5 ? ext : 'IMG'
}

/** 生成转换后的文件名 */
export function convertedFileName(originalName: string, format: TargetFormat): string {
  const base = originalName.replace(/\.[^.]+$/, '') || 'converted'
  return `${base}.${FORMAT_MAP[format].ext}`
}
