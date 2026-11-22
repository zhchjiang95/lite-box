/** 九宫格切图：类型定义与快捷网格预设 */

export type FitMode = 'square-cover' | 'square-contain' | 'original'
export type ExportFormat = 'png' | 'jpeg' | 'webp'

export interface SplitOptions {
  /** 行数 1 - 8 */
  rows: number
  /** 列数 1 - 8 */
  cols: number
  /**
   * 构图适配方式：
   * - square-cover：每格严格 1:1 正方形，在原图上居中裁切（支持拖拽平移取景）
   * - square-contain：每格严格 1:1 正方形，原图完整保留并在外侧补边
   * - original：按原图宽高直接等分切图
   */
  fitMode: FitMode
  /** square-cover 时的取景平移比例（0..1，0.5 表示居中） */
  panX: number
  panY: number
  /** square-contain / JPG 时的填充底色 */
  background: string
  /** 模拟宫格缝隙裁切比例（0 - 6%，让朋友圈带缝显示时线条更顺滑） */
  gutterPct: number
  /** 单格圆角比例（0 - 25%） */
  radiusPct: number
  /** 导出格式 */
  format: ExportFormat
  /** JPG / WebP 质量 */
  quality: number
  /** 单格最大边长（0 表示保持原始分辨率） */
  maxTileSide: number
}

export const defaultSplitOptions: SplitOptions = {
  rows: 3,
  cols: 3,
  fitMode: 'square-cover',
  panX: 0.5,
  panY: 0.5,
  background: '#ffffff',
  gutterPct: 0,
  radiusPct: 0,
  format: 'png',
  quality: 92,
  maxTileSide: 0,
}

export interface GridPreset {
  id: string
  label: string
  rows: number
  cols: number
  hint: string
}

export const GRID_PRESETS: GridPreset[] = [
  { id: '3x3', label: '3×3', rows: 3, cols: 3, hint: '九宫格' },
  { id: '2x2', label: '2×2', rows: 2, cols: 2, hint: '四宫格' },
  { id: '2x3', label: '2×3', rows: 2, cols: 3, hint: '六宫格' },
  { id: '1x3', label: '1×3', rows: 1, cols: 3, hint: '横三连' },
  { id: '3x1', label: '3×1', rows: 3, cols: 1, hint: '竖三连' },
]

export interface TilePreview {
  index: number
  row: number
  col: number
  url: string
  width: number
  height: number
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
