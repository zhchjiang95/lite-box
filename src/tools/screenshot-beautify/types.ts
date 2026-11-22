/** 截图美化与套壳：类型、渐变预设与画幅定义 */

export type BgMode = 'gradient' | 'solid' | 'transparent'
export type FrameStyle = 'none' | 'mac-light' | 'mac-dark' | 'browser-light' | 'browser-dark' | 'glass'
export type CanvasAspect = 'auto' | '16:9' | '4:3' | '3:2' | '1:1' | '3:4'
export type ExportFormat = 'png' | 'jpeg' | 'webp'

export interface GradientPreset {
  id: string
  name: string
  /** 渐变色标（支持 2~3 色） */
  colors: string[]
  /** 默认角度 */
  angle: number
}

export const GRADIENT_PRESETS: GradientPreset[] = [
  { id: 'aurora', name: '极光紫蓝', colors: ['#6366f1', '#a855f7', '#ec4899'], angle: 135 },
  { id: 'ocean', name: '深海青蓝', colors: ['#0ea5e9', '#3b82f6', '#6366f1'], angle: 135 },
  { id: 'sunset', name: '落日珊瑚', colors: ['#f97316', '#ec4899', '#8b5cf6'], angle: 125 },
  { id: 'mint', name: '薄荷微风', colors: ['#10b981', '#06b6d4', '#3b82f6'], angle: 135 },
  { id: 'peach', name: '蜜桃奶昔', colors: ['#fda4af', '#fdba74', '#fef08a'], angle: 135 },
  { id: 'lavender', name: '薰衣草雾', colors: ['#c4b5fd', '#f5d0fe', '#bfdbfe'], angle: 135 },
  { id: 'midnight', name: '暗夜霓虹', colors: ['#0f172a', '#312e81', '#581c87'], angle: 135 },
  { id: 'obsidian', name: '碳黑金属', colors: ['#18181b', '#27272a', '#3f3f46'], angle: 145 },
  { id: 'forest', name: '翡翠森林', colors: ['#064e3b', '#0f766e', '#0891b2'], angle: 135 },
  { id: 'rose', name: '玫瑰金', colors: ['#fecdd3', '#fbcfe8', '#ddd6fe'], angle: 120 },
  { id: 'amber', name: '暖阳琥珀', colors: ['#f59e0b', '#ef4444', '#db2777'], angle: 135 },
  { id: 'frost', name: '极简霜灰', colors: ['#f1f5f9', '#e2e8f0', '#cbd5e1'], angle: 135 },
]

export const ASPECT_OPTIONS: { id: CanvasAspect; label: string; ratio: number | null }[] = [
  { id: 'auto', label: '自适应', ratio: null },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
]

export const FRAME_OPTIONS: { id: FrameStyle; label: string }[] = [
  { id: 'mac-light', label: 'macOS 亮' },
  { id: 'mac-dark', label: 'macOS 暗' },
  { id: 'browser-light', label: '浏览器亮' },
  { id: 'browser-dark', label: '浏览器暗' },
  { id: 'glass', label: '玻璃外框' },
  { id: 'none', label: '无边框' },
]

export interface BeautifyOptions {
  bgMode: BgMode
  gradientId: string
  gradientAngle: number
  solidColor: string
  /** 是否在渐变背景上叠加细腻胶片颗粒噪点 */
  noise: boolean
  /** 窗口套壳风格 */
  frame: FrameStyle
  /** 窗口标题或浏览器地址栏文字 */
  windowTitle: string
  /** 画幅比例 */
  aspect: CanvasAspect
  /** 外部留白（相对于基准宽度的百分比 0 - 24） */
  paddingPct: number
  /** 截图/窗口圆角（px，按基准宽度自适应） */
  radius: number
  /** 多层柔和阴影强度（0 - 100） */
  shadow: number
  /** 截图四周内衬留白（px，0 - 48） */
  inset: number
  /** 内衬背景色 */
  insetColor: string
  /** 导出倍率（1 或 2） */
  exportScale: number
  /** 导出格式 */
  format: ExportFormat
  /** JPG / WebP 质量 */
  quality: number
}

export const defaultBeautifyOptions: BeautifyOptions = {
  bgMode: 'gradient',
  gradientId: 'aurora',
  gradientAngle: 135,
  solidColor: '#e2e8f0',
  noise: true,
  frame: 'mac-dark',
  windowTitle: 'litebox.app',
  aspect: 'auto',
  paddingPct: 10,
  radius: 18,
  shadow: 65,
  inset: 0,
  insetColor: '#ffffff',
  exportScale: 1,
  format: 'png',
  quality: 94,
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
