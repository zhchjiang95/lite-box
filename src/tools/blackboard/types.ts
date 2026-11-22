/** 演示黑板 / 手绘白板：类型定义、板面主题与色板预设 */

/** 固定 16:9 逻辑画布坐标尺寸（编辑与全屏投屏 100% 等比精准对齐） */
export const BOARD_W = 1920
export const BOARD_H = 1080

export type BoardThemeId = 'chalk-green' | 'dark' | 'white' | 'warm'
export type BoardPattern = 'none' | 'grid' | 'dots' | 'lines'
export type DrawTool =
  | 'select'
  | 'pen'
  | 'highlighter'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'text'
  | 'eraser'
  | 'laser'

export type TextFontStyle = 'sans' | 'serif' | 'mono'

export interface Pt {
  x: number
  y: number
}

export interface StrokeItem {
  id: string
  kind: 'stroke'
  points: Pt[]
  color: string
  width: number
  highlighter?: boolean
  chalk?: boolean
}

export interface ShapeItem {
  id: string
  kind: 'shape'
  shape: 'arrow' | 'rect' | 'ellipse' | 'line'
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  width: number
}

export interface TextItem {
  id: string
  kind: 'text'
  x: number
  y: number
  text: string
  color: string
  fontSize: number
  bold: boolean
  fontStyle: TextFontStyle
}

export interface ImageItem {
  id: string
  kind: 'image'
  x: number
  y: number
  w: number
  h: number
  dataUrl: string
}

export type BoardElement = StrokeItem | ShapeItem | TextItem | ImageItem

export interface BoardTheme {
  id: BoardThemeId
  label: string
  bg: string
  bgGradientTo: string
  patternColor: string
  isDark: boolean
  defaultColor: string
  swatches: string[]
}

export const BOARD_THEMES: BoardTheme[] = [
  {
    id: 'chalk-green',
    label: '复古绿黑板',
    bg: '#1c3b2e',
    bgGradientTo: '#132a21',
    patternColor: 'rgba(255, 255, 255, 0.08)',
    isDark: true,
    defaultColor: '#f8fafc',
    swatches: ['#f8fafc', '#fde047', '#fda4af', '#7dd3fc', '#86efac', '#fdba74', '#d8b4fe'],
  },
  {
    id: 'dark',
    label: '暗夜黑板',
    bg: '#111827',
    bgGradientTo: '#090d16',
    patternColor: 'rgba(255, 255, 255, 0.07)',
    isDark: true,
    defaultColor: '#f8fafc',
    swatches: ['#f8fafc', '#38bdf8', '#fb7185', '#facc15', '#4ade80', '#fb923c', '#c084fc'],
  },
  {
    id: 'white',
    label: '极简白板',
    bg: '#ffffff',
    bgGradientTo: '#f8fafc',
    patternColor: 'rgba(15, 23, 42, 0.07)',
    isDark: false,
    defaultColor: '#0f172a',
    swatches: ['#0f172a', '#dc2626', '#2563eb', '#16a34a', '#ea580c', '#9333ea', '#64748b'],
  },
  {
    id: 'warm',
    label: '暖米纸板',
    bg: '#fbf7ef',
    bgGradientTo: '#f4ede0',
    patternColor: 'rgba(120, 90, 50, 0.09)',
    isDark: false,
    defaultColor: '#292524',
    swatches: ['#292524', '#b91c1c', '#1d4ed8', '#15803d', '#c2410c', '#7e22ce', '#78716c'],
  },
]

export const BOARD_THEME_MAP = Object.fromEntries(BOARD_THEMES.map((t) => [t.id, t])) as Record<
  BoardThemeId,
  BoardTheme
>

export const FONT_FAMILY_MAP: Record<TextFontStyle, string> = {
  sans: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Inter, sans-serif',
  serif: '"Kaiti SC", "STKaiti", "Songti SC", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
}

export const STROKE_WIDTHS = [
  { label: '细', value: 4 },
  { label: '中', value: 7 },
  { label: '粗', value: 12 },
  { label: '特粗', value: 20 },
] as const

export const TEXT_SIZES = [
  { label: '正文', value: 38 },
  { label: '小标题', value: 54 },
  { label: '大标题', value: 78 },
  { label: '巨幅字', value: 112 },
] as const
