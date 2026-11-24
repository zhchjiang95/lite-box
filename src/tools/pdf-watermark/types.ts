/** PDF 加水印与页码：类型定义与快捷模板 */

export type WatermarkType = 'text' | 'image'
export type WatermarkLayout = 'tile' | 'single'
export type AnchorPos = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br'
export type FontStyle = 'sans' | 'serif' | 'mono'
export type PageNumStyle = 'n/total' | 'n' | '-n-' | 'zh-n' | 'zh-n/total'
export type PageNumPos = 'bl' | 'bc' | 'br' | 'tl' | 'tc' | 'tr'
export type ApplyScope = 'all' | 'skip-first' | 'custom'
export type RedactShape = 'rect' | 'ellipse'
export type RedactTool = 'select' | 'rect' | 'ellipse'

/** 单个 PDF 打码遮挡块（归一化页面坐标 0..1，相对当前页面展示宽高） */
export interface RedactMark {
  id: string
  /** 归属页码（1-based） */
  page: number
  /** 是否同步应用到该文档的全部页面（如统一遮挡页眉/编号） */
  applyAllPages: boolean
  /** 遮挡形状：矩形或圆形/椭圆 */
  shape: RedactShape
  x: number
  y: number
  w: number
  h: number
  /** 纯色填充（如 #000000 机密涂黑、#ffffff 涂改液白底） */
  color: string
}

export const REDACT_COLOR_PRESETS = ['#000000', '#ffffff', '#1e293b', '#64748b', '#dc2626', '#2563eb']

export interface PdfWatermarkOptions {
  /** 是否启用水印层 */
  enableWatermark: boolean
  watermarkType: WatermarkType
  layout: WatermarkLayout
  /** 文字水印内容（支持中文、英文、Emoji 及多行） */
  text: string
  fontStyle: FontStyle
  bold: boolean
  color: string
  /** 水印字号（pt，12 - 96） */
  fontSize: number
  /** 图片 Logo 宽度（pt，40 - 360） */
  logoWidth: number
  /** 不透明度（5 - 100） */
  opacity: number
  /** 旋转角度（-90 ~ +90） */
  angle: number
  /** 平铺水平/垂直间距（pt） */
  gapX: number
  gapY: number
  /** 错行交错排布 */
  stagger: boolean
  /** 单点模式锚点 */
  anchor: AnchorPos
  /** 单点模式边距（pt） */
  margin: number

  /** 是否启用页码层 */
  enablePageNum: boolean
  pageNumStyle: PageNumStyle
  pageNumPos: PageNumPos
  pageNumSize: number
  pageNumMargin: number
  pageNumColor: string
  /** 起始编号（默认 1） */
  pageNumStart: number
  /** 页码是否跳过封面首页 */
  pageNumSkipFirst: boolean

  /** 水印生效页面范围 */
  scope: ApplyScope
  customRange: string

  /** 打码导出时是否对含遮挡块的页面进行高清栅格化以物理抹除底层文字（防复制/防移开） */
  flattenRedactedPages: boolean
}

export const defaultPdfWatermarkOptions: PdfWatermarkOptions = {
  enableWatermark: true,
  watermarkType: 'text',
  layout: 'tile',
  text: '内部资料 · 请勿外传',
  fontStyle: 'sans',
  bold: true,
  color: '#64748b',
  fontSize: 28,
  logoWidth: 140,
  opacity: 25,
  angle: -35,
  gapX: 110,
  gapY: 110,
  stagger: true,
  anchor: 'mc',
  margin: 36,

  enablePageNum: false,
  pageNumStyle: 'n/total',
  pageNumPos: 'bc',
  pageNumSize: 10,
  pageNumMargin: 22,
  pageNumColor: '#475569',
  pageNumStart: 1,
  pageNumSkipFirst: false,

  scope: 'all',
  customRange: '1-5',
  flattenRedactedPages: false,
}

export const PDF_WM_PRESETS: { id: string; label: string; desc: string; patch: Partial<PdfWatermarkOptions> }[] = [
  {
    id: 'confidential',
    label: '内部保密',
    desc: '淡红斜铺全页',
    patch: {
      enableWatermark: true,
      watermarkType: 'text',
      layout: 'tile',
      text: '内部资料 · 请勿外传',
      color: '#dc2626',
      fontSize: 26,
      opacity: 20,
      angle: -35,
      gapX: 110,
      gapY: 110,
      stagger: true,
    },
  },
  {
    id: 'contract',
    label: '合同防盗',
    desc: '双行灰字平铺',
    patch: {
      enableWatermark: true,
      watermarkType: 'text',
      layout: 'tile',
      text: '仅供本业务签约使用\n复印及他用无效',
      color: '#475569',
      fontSize: 22,
      opacity: 24,
      angle: -30,
      gapX: 100,
      gapY: 100,
      stagger: true,
    },
  },
  {
    id: 'draft',
    label: '审阅草稿',
    desc: '居中大字印章',
    patch: {
      enableWatermark: true,
      watermarkType: 'text',
      layout: 'single',
      text: 'DRAFT · 审阅稿',
      color: '#94a3b8',
      fontSize: 54,
      opacity: 28,
      angle: -30,
      anchor: 'mc',
    },
  },
]

export const FONT_STACKS: Record<FontStyle, string> = {
  sans: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Inter, sans-serif',
  serif: '"Songti SC", "STSong", "Noto Serif SC", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
}

export const ANCHOR_GRID: { id: AnchorPos; label: string }[] = [
  { id: 'tl', label: '左上' },
  { id: 'tc', label: '上中' },
  { id: 'tr', label: '右上' },
  { id: 'ml', label: '左中' },
  { id: 'mc', label: '正中' },
  { id: 'mr', label: '右中' },
  { id: 'bl', label: '左下' },
  { id: 'bc', label: '下中' },
  { id: 'br', label: '右下' },
]

export const PAGENUM_STYLES: { value: PageNumStyle; label: string }[] = [
  { value: 'n/total', label: '1 / 10' },
  { value: 'n', label: '1' },
  { value: '-n-', label: '- 1 -' },
  { value: 'zh-n', label: '第 1 页' },
  { value: 'zh-n/total', label: '第 1 页 / 共 10 页' },
]

export const PAGENUM_POSITIONS: { id: PageNumPos; label: string }[] = [
  { id: 'tl', label: '顶左' },
  { id: 'tc', label: '顶中' },
  { id: 'tr', label: '顶右' },
  { id: 'bl', label: '底左' },
  { id: 'bc', label: '底中' },
  { id: 'br', label: '底右' },
]

/** 格式化页码显示文本 */
export function formatPageNumber(num: number, total: number, style: PageNumStyle): string {
  switch (style) {
    case 'n':
      return String(num)
    case '-n-':
      return `- ${num} -`
    case 'n/total':
      return `${num} / ${total}`
    case 'zh-n':
      return `第 ${num} 页`
    case 'zh-n/total':
      return `第 ${num} 页 / 共 ${total} 页`
  }
}
