/** 图片压缩：类型定义与纯函数配置 */

export type OutputFormat = 'original' | 'image/webp' | 'image/jpeg' | 'image/png' | 'image/avif'
export type ConcreteMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif'

export interface CompressOptions {
  /** 输出格式：original 表示尽量保持原图格式 */
  format: OutputFormat
  /** 压缩画质 10 - 100（PNG 在 <100 时启用智能调色板量化） */
  quality: number
  /** 是否限制最大边长 */
  limitSize: boolean
  /** 最大宽高像素（仅缩小不放大） */
  maxDimension: number
  /** 未变更格式与尺寸时，若压缩后体积更大则保留原文件 */
  keepSmaller: boolean
  /** 转为不支持透明的 JPG 时的背景填充色 */
  jpegBg: string
}

export const defaultOptions: CompressOptions = {
  format: 'original',
  quality: 80,
  limitSize: false,
  maxDimension: 1920,
  keepSmaller: true,
  jpegBg: '#ffffff',
}

export interface CompressPreset {
  id: string
  label: string
  hint: string
  quality: number
  format?: OutputFormat
}

export const presets: CompressPreset[] = [
  { id: 'balanced', label: '均衡', hint: '80% · 体积与画质兼顾', quality: 80 },
  { id: 'extreme', label: '极致', hint: '60% · 大幅瘦身', quality: 60 },
  { id: 'high', label: '高清', hint: '92% · 肉眼几乎无损', quality: 92 },
]

export interface CompressResult {
  blob: Blob
  mime: ConcreteMime
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  /** 是否因压缩后未变小而保留原图 */
  keptOriginal: boolean
  /** 处理耗时（毫秒） */
  durationMs: number
}

export interface CompressItem {
  id: string
  file: File
  /** 送入 Worker 压缩的标准图片文件（HEIC 照片预解码为 PNG 后缓存于此） */
  workFile: File
  originalUrl: string
  originalWidth: number
  originalHeight: number
  status: 'pending' | 'processing' | 'done' | 'error'
  error?: string
  /** 压缩后的结果 */
  result?: CompressResult
  compressedUrl?: string
  /** 任务版本号，用于丢弃过期的并发结果 */
  version: number
}

/** 根据画质计算 PNG 智能量化色彩数（100% 时返回 0 表示无损） */
export function qualityToPngColors(quality: number): number {
  if (quality >= 100) return 0
  return Math.max(16, Math.min(256, Math.round((quality / 100) * 256)))
}

/** 解析目标输出 MIME */
export function resolveTargetMime(
  sourceMime: string,
  format: OutputFormat,
  avifSupported: boolean,
): ConcreteMime {
  if (format !== 'original') {
    if (format === 'image/avif' && !avifSupported) return 'image/webp'
    return format
  }
  if (sourceMime === 'image/jpeg' || sourceMime === 'image/jpg') return 'image/jpeg'
  if (sourceMime === 'image/png') return 'image/png'
  if (sourceMime === 'image/webp') return 'image/webp'
  if (sourceMime === 'image/avif' && avifSupported) return 'image/avif'
  // GIF / BMP / SVG 等非直接编码格式，默认转为高压缩比且支持透明的 PNG
  return 'image/png'
}

/** MIME 转简短显示标签 */
export function mimeLabel(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'JPG'
    case 'image/png':
      return 'PNG'
    case 'image/webp':
      return 'WebP'
    case 'image/avif':
      return 'AVIF'
    case 'image/gif':
      return 'GIF'
    case 'image/svg+xml':
      return 'SVG'
    default:
      return mime.replace('image/', '').toUpperCase() || 'IMG'
  }
}

/** MIME 转文件扩展名 */
export function mimeToExt(mime: ConcreteMime): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'image/avif':
      return 'avif'
  }
}

/** 生成输出文件名（保留原名主体并更新扩展名） */
export function outputFileName(originalName: string, targetMime: ConcreteMime): string {
  const base = originalName.replace(/\.[^.]+$/, '') || 'compressed'
  return `${base}.${mimeToExt(targetMime)}`
}

/** 计算压缩节省百分比（正数表示变小，负数表示变大） */
export function savedPercent(originalSize: number, compressedSize: number): number {
  if (originalSize <= 0) return 0
  return Math.round(((originalSize - compressedSize) / originalSize) * 100)
}
