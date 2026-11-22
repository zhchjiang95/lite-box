/** 图片裁剪与缩放：类型与预设定义 */

export type WorkMode = 'crop' | 'batch'
export type ExportFormat = 'png' | 'jpeg' | 'webp'

/** 归一化裁剪框（相对于变换后外接画布的 0..1 坐标） */
export interface NormalizedCrop {
  x: number
  y: number
  w: number
  h: number
}

/** 单图变换参数 */
export interface TransformState {
  /** 90° 步进旋转（0 / 90 / 180 / 270） */
  baseRotate: number
  /** 精细角度微调（-45 ~ +45） */
  fineRotate: number
  /** 水平翻转 */
  flipX: boolean
  /** 垂直翻转 */
  flipY: boolean
}

export const defaultTransform: TransformState = {
  baseRotate: 0,
  fineRotate: 0,
  flipX: false,
  flipY: false,
}

export interface AspectPreset {
  id: string
  label: string
  /** 宽 / 高 比例，null 表示自由比例 */
  ratio: number | null
  /** 分类：常用比例 或 证件照标准 */
  group: 'common' | 'idphoto'
  /** 证件照等预设附带的标准导出像素（300 DPI） */
  outputSize?: { width: number; height: number }
  hint?: string
}

export const ASPECT_PRESETS: AspectPreset[] = [
  { id: 'free', label: '自由', ratio: null, group: 'common' },
  { id: '1:1', label: '1:1', ratio: 1, group: 'common', hint: '头像' },
  { id: '4:3', label: '4:3', ratio: 4 / 3, group: 'common' },
  { id: '3:4', label: '3:4', ratio: 3 / 4, group: 'common', hint: '小红书' },
  { id: '16:9', label: '16:9', ratio: 16 / 9, group: 'common', hint: '封面' },
  { id: '9:16', label: '9:16', ratio: 9 / 16, group: 'common', hint: '壁纸' },
  { id: '3:2', label: '3:2', ratio: 3 / 2, group: 'common' },
  { id: '2:3', label: '2:3', ratio: 2 / 3, group: 'common' },
  // 标准 300 DPI 证件照尺寸
  { id: 'id-1', label: '一寸', ratio: 295 / 413, group: 'idphoto', outputSize: { width: 295, height: 413 }, hint: '25×35mm' },
  { id: 'id-s2', label: '小二寸', ratio: 413 / 531, group: 'idphoto', outputSize: { width: 413, height: 531 }, hint: '35×45mm' },
  { id: 'id-2', label: '二寸', ratio: 413 / 579, group: 'idphoto', outputSize: { width: 413, height: 579 }, hint: '35×49mm' },
  { id: 'id-passport', label: '护照', ratio: 390 / 567, group: 'idphoto', outputSize: { width: 390, height: 567 }, hint: '33×48mm' },
]

export type BatchResizeMode = 'percent' | 'width' | 'height' | 'exact' | 'max'
export type BatchFit = 'cover' | 'contain' | 'fill'

export interface BatchResizeOptions {
  mode: BatchResizeMode
  /** 百分比模式：10 - 200 */
  percent: number
  /** 固定宽度或指定宽 */
  width: number
  /** 固定高度或指定高 */
  height: number
  /** 限制最大边长 */
  maxDimension: number
  /** 指定宽高模式下的适配方式 */
  fit: BatchFit
  /** 批量统一旋转（0 / 90 / 180 / 270） */
  rotate: number
  flipX: boolean
  flipY: boolean
  /** 输出格式 */
  format: 'original' | ExportFormat
  quality: number
  background: string
}

export const defaultBatchOptions: BatchResizeOptions = {
  mode: 'percent',
  percent: 50,
  width: 1280,
  height: 720,
  maxDimension: 1920,
  fit: 'cover',
  rotate: 0,
  flipX: false,
  flipY: false,
  format: 'original',
  quality: 90,
  background: '#ffffff',
}

export interface BatchItem {
  id: string
  file: File
  url: string
  width: number
  height: number
  status: 'processing' | 'done' | 'error'
  error?: string
  outWidth?: number
  outHeight?: number
  outBlob?: Blob
  outMime?: string
  version: number
}

export const FORMAT_MIME: Record<ExportFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export const FORMAT_EXT: Record<ExportFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
}
