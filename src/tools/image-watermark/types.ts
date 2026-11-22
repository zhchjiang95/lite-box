/** 图片加水印：类型定义与常用模板 */

export type WatermarkType = 'text' | 'image'
export type LayoutMode = 'tile' | 'single'
export type AnchorPos = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br'
export type FontStyle = 'sans' | 'serif' | 'mono'
export type BlendMode = 'source-over' | 'overlay' | 'soft-light' | 'multiply' | 'screen'
export type ExportFormat = 'original' | 'png' | 'jpeg' | 'webp'

export interface WatermarkOptions {
  /** 水印类型：文字 或 图片 Logo */
  type: WatermarkType
  /** 排布模式：全屏平铺 或 单点定位 */
  layout: LayoutMode
  /** 文字内容（支持换行） */
  text: string
  /** 字体风格 */
  fontStyle: FontStyle
  /** 是否加粗 */
  bold: boolean
  /** 文字颜色 */
  color: string
  /** 是否添加柔和阴影/描边以增强复杂背景可读性 */
  shadow: boolean
  /** 文字大小（相对图片短边的百分比 1.5 - 15） */
  fontSizePct: number
  /** Logo 大小（相对图片短边的百分比 5 - 60） */
  logoSizePct: number
  /** 不透明度 5 - 100 */
  opacity: number
  /** 旋转角度 -90 ~ +90（单点模式支持 -180 ~ +180） */
  angle: number
  /** 平铺水平间距（相对短边百分比 4 - 60） */
  gapXPct: number
  /** 平铺垂直间距（相对短边百分比 4 - 60） */
  gapYPct: number
  /** 平铺是否错行交错排布（砖墙式） */
  stagger: boolean
  /** 单点模式九宫格锚点 */
  anchor: AnchorPos
  /** 单点模式边缘留白（相对短边百分比 0 - 20） */
  marginPct: number
  /** 单点模式自由拖拽微调偏移（相对画布宽高的归一化偏移 -0.5..0.5） */
  offsetX: number
  offsetY: number
  /** 混合模式 */
  blendMode: BlendMode
  /** 导出格式 */
  format: ExportFormat
  /** JPG / WebP 质量 */
  quality: number
}

export const defaultWatermarkOptions: WatermarkOptions = {
  type: 'text',
  layout: 'tile',
  text: '仅供办理业务使用\n复印/他用无效',
  fontStyle: 'sans',
  bold: true,
  color: '#ffffff',
  shadow: true,
  fontSizePct: 4,
  logoSizePct: 20,
  opacity: 35,
  angle: -30,
  gapXPct: 18,
  gapYPct: 18,
  stagger: true,
  anchor: 'br',
  marginPct: 4,
  offsetX: 0,
  offsetY: 0,
  blendMode: 'source-over',
  format: 'original',
  quality: 92,
}

export interface WatermarkPreset {
  id: string
  label: string
  desc: string
  patch: Partial<WatermarkOptions>
}

export const WATERMARK_PRESETS: WatermarkPreset[] = [
  {
    id: 'id-protect',
    label: '证件防盗',
    desc: '斜向错行全屏平铺',
    patch: {
      type: 'text',
      layout: 'tile',
      text: '仅供办理相关业务使用\n他用无效 · 严禁复印',
      color: '#ffffff',
      shadow: true,
      bold: true,
      fontSizePct: 3.8,
      opacity: 36,
      angle: -30,
      gapXPct: 18,
      gapYPct: 18,
      stagger: true,
      blendMode: 'source-over',
    },
  },
  {
    id: 'copyright',
    label: '角标版权',
    desc: '右下角精致署名',
    patch: {
      type: 'text',
      layout: 'single',
      text: '© 原创摄影 · 请勿盗图',
      color: '#ffffff',
      shadow: true,
      bold: false,
      fontSizePct: 3.2,
      opacity: 75,
      angle: 0,
      anchor: 'br',
      marginPct: 4,
      offsetX: 0,
      offsetY: 0,
      blendMode: 'source-over',
    },
  },
  {
    id: 'confidential',
    label: '内部保密',
    desc: '淡红警示斜铺',
    patch: {
      type: 'text',
      layout: 'tile',
      text: '内部资料 · 请勿外传',
      color: '#ef4444',
      shadow: false,
      bold: true,
      fontSizePct: 4.2,
      opacity: 28,
      angle: -35,
      gapXPct: 20,
      gapYPct: 20,
      stagger: true,
      blendMode: 'multiply',
    },
  },
]

export const FONT_FAMILIES: Record<FontStyle, string> = {
  sans: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Inter, -apple-system, sans-serif',
  serif: '"Songti SC", "STSong", "Noto Serif SC", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
}

export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'source-over', label: '正常' },
  { value: 'overlay', label: '叠加' },
  { value: 'soft-light', label: '柔光' },
  { value: 'multiply', label: '正片叠底' },
  { value: 'screen', label: '滤色' },
]

export const ANCHOR_GRID: { id: AnchorPos; label: string }[] = [
  { id: 'tl', label: '左上' },
  { id: 'tc', label: '上中' },
  { id: 'tr', label: '右上' },
  { id: 'ml', label: '左中' },
  { id: 'mc', label: '居中' },
  { id: 'mr', label: '右中' },
  { id: 'bl', label: '左下' },
  { id: 'bc', label: '下中' },
  { id: 'br', label: '右下' },
]

export interface ImageEntry {
  id: string
  file: File
  name: string
  size: number
  url: string
  bitmap: ImageBitmap
  width: number
  height: number
}
