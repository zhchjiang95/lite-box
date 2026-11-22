/** Favicon 图标生成：类型、输出规格与渐变预设 */

export type SourceMode = 'image' | 'text'
export type BgStyle = 'transparent' | 'solid' | 'gradient'
export type ImageFit = 'contain' | 'cover'

export interface GradientOption {
  id: string
  name: string
  from: string
  to: string
}

export const ICON_GRADIENTS: GradientOption[] = [
  { id: 'violet', name: '紫青极光', from: '#8b5cf6', to: '#06b6d4' },
  { id: 'indigo', name: '靛蓝深空', from: '#6366f1', to: '#3b82f6' },
  { id: 'sunset', name: '落日玫瑰', from: '#f97316', to: '#ec4899' },
  { id: 'emerald', name: '翡翠青柠', from: '#10b981', to: '#06b6d4' },
  { id: 'amber', name: '暖阳琥珀', from: '#f59e0b', to: '#ef4444' },
  { id: 'dark', name: '极夜炭黑', from: '#1e1f26', to: '#3f3f46' },
  { id: 'rose', name: '樱花粉雾', from: '#f43f5e', to: '#a855f7' },
  { id: 'sky', name: '晴空微蓝', from: '#38bdf8', to: '#818cf8' },
]

export interface FaviconOptions {
  sourceMode: SourceMode
  /** 文字 / Emoji 模式内容（建议 1~2 字符） */
  text: string
  textColor: string
  /** 文字字号比例（相对画布 30 - 85%） */
  textScalePct: number
  /** 背景风格 */
  bgStyle: BgStyle
  bgColor: string
  gradientId: string
  /** 图标圆角（0 - 50%，22% 为经典 iOS 风格，50% 为正圆） */
  radiusPct: number
  /** 内容四周留白（0 - 30%） */
  paddingPct: number
  /** 图片适配方式 */
  imageFit: ImageFit
  /** 网站信息（写入 site.webmanifest 与预览） */
  siteName: string
  shortName: string
  themeColor: string
  /** HTML 引入路径前缀（如 / 或 /icons/） */
  pathPrefix: string
}

export const defaultFaviconOptions: FaviconOptions = {
  sourceMode: 'text',
  text: '轻',
  textColor: '#ffffff',
  textScalePct: 58,
  bgStyle: 'gradient',
  bgColor: '#6366f1',
  gradientId: 'violet',
  radiusPct: 24,
  paddingPct: 8,
  imageFit: 'contain',
  siteName: '轻匣 · 本地工具箱',
  shortName: '轻匣',
  themeColor: '#6366f1',
  pathPrefix: '/',
}

export interface OutputSpec {
  filename: string
  size: number
  label: string
  usage: string
}

/** 全套标准 PNG 输出规格（favicon.ico 单独合并 16/32/48 生成） */
export const PNG_SPECS: OutputSpec[] = [
  { filename: 'favicon-16x16.png', size: 16, label: '16×16', usage: '经典标签页' },
  { filename: 'favicon-32x32.png', size: 32, label: '32×32', usage: '高清标签页' },
  { filename: 'apple-touch-icon.png', size: 180, label: '180×180', usage: 'iOS 主屏幕' },
  { filename: 'android-chrome-192x192.png', size: 192, label: '192×192', usage: 'Android / PWA' },
  { filename: 'android-chrome-512x512.png', size: 512, label: '512×512', usage: 'PWA 启动屏' },
]

export const ICO_FRAME_SIZES = [16, 32, 48] as const
