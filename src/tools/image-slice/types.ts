/** 长图切分：类型定义与常用社媒比例预设 */

export type SliceMode = 'ratio' | 'height' | 'count' | 'manual'
export type LastPageMode = 'keep' | 'pad' | 'merge'
export type ExportFormat = 'png' | 'jpeg' | 'webp'

export interface RatioPreset {
  id: string
  label: string
  /** 宽 / 高 比例 */
  ratio: number
  hint: string
}

export const RATIO_PRESETS: RatioPreset[] = [
  { id: '3:4', label: '3:4', ratio: 3 / 4, hint: '小红书' },
  { id: '4:5', label: '4:5', ratio: 4 / 5, hint: '竖图' },
  { id: '1:1', label: '1:1', ratio: 1, hint: '方形' },
  { id: '9:16', label: '9:16', ratio: 9 / 16, hint: '手机屏' },
  { id: '16:9', label: '16:9', ratio: 16 / 9, hint: '宽屏' },
]

export interface SliceOptions {
  mode: SliceMode
  /** 比例预设 ID */
  ratioId: string
  /** 固定高度模式下的每张像素高度 */
  sliceHeight: number
  /** 等份模式下的切分张数 */
  sliceCount: number
  /** 末页处理策略：keep 保留剩余高度 / pad 补底色至标准高度 / merge 过矮时并入上一页 */
  lastPageMode: LastPageMode
  /** 相邻页重叠像素（0 - 120），便于阅读衔接 */
  overlapPx: number
  /** 末页补边或 JPG 导出的背景色 */
  background: string
  /** 导出格式 */
  format: ExportFormat
  /** JPG / WebP 质量 */
  quality: number
}

export const defaultSliceOptions: SliceOptions = {
  mode: 'ratio',
  ratioId: '3:4',
  sliceHeight: 1600,
  sliceCount: 4,
  lastPageMode: 'keep',
  overlapPx: 0,
  background: '#ffffff',
  format: 'png',
  quality: 92,
}

/** 单个分页切片的垂直坐标范围（原图像素） */
export interface SliceSegment {
  index: number
  /** 起始 Y（包含） */
  startY: number
  /** 结束 Y（不包含） */
  endY: number
  /** 实际输出高度（可能因末页补边大于 endY - startY） */
  outHeight: number
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
