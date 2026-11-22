/** 摄影作品分享框：模板、艺术字体、品牌徽标与四向布局类型定义 */

export type BarPosition = 'bottom' | 'top' | 'left' | 'right'
export type FrameTheme = 'classic-light' | 'gallery-dark' | 'polaroid' | 'blur-glass' | 'film-strip' | 'overlay'
export type ArtFontId = 'modern' | 'editorial' | 'handwriting' | 'film-mono' | 'cinema' | 'typewriter'
export type BrandBadgeId =
  | 'auto'
  | 'none'
  | 'leica'
  | 'hasselblad'
  | 'fujifilm'
  | 'sony'
  | 'canon'
  | 'nikon'
  | 'apple'
  | 'ricoh'
  | 'film35'
export type ExportFormat = 'jpeg' | 'png' | 'webp'

export interface PhotoExifFields {
  /** 相机型号（如 LEICA M11 / iPhone 15 Pro） */
  camera: string
  /** 镜头或副标题（如 APO-SUMMICRON-M 1:2/50） */
  lens: string
  /** 焦距（如 50mm） */
  focalLength: string
  /** 光圈（如 f/2.0） */
  aperture: string
  /** 快门（如 1/1000s） */
  shutter: string
  /** ISO（如 ISO 100） */
  iso: string
  /** 拍摄日期（如 2026.11.22） */
  date: string
  /** 地点 / 作者签名 / 作品名（可选） */
  caption: string
  /** 原始厂商名，用于自动匹配品牌标 */
  make: string
}

export interface PhotoFrameOptions {
  /** 画框主题风格 */
  theme: FrameTheme
  /** 参数信息栏所在方位：上 / 下 / 左 / 右 */
  position: BarPosition
  /** 艺术字体 */
  font: ArtFontId
  /** 品牌徽标 */
  brand: BrandBadgeId
  /** 是否在信息栏点缀照片自动提取的主色调色点 */
  showPaletteDots: boolean
  /** 是否显示拍摄日期 */
  showDate: boolean
  /** 是否显示镜头信息 */
  showLens: boolean
  /** 画框外边距比例（0 - 12%） */
  borderPct: number
  /** 信息栏厚度比例（10 - 24%） */
  barSizePct: number
  /** 照片内圆角（0 - 40px 基准） */
  photoRadius: number
  /** 照片柔和阴影（0 - 100%） */
  photoShadow: number
  /** 字体大小倍率（0.75 - 1.35） */
  fontScale: number
  /** 导出格式与质量 */
  format: ExportFormat
  quality: number
}

export const defaultFrameOptions: PhotoFrameOptions = {
  theme: 'classic-light',
  position: 'bottom',
  font: 'editorial',
  brand: 'auto',
  showPaletteDots: true,
  showDate: true,
  showLens: true,
  borderPct: 4,
  barSizePct: 14,
  photoRadius: 6,
  photoShadow: 30,
  fontScale: 1,
  format: 'jpeg',
  quality: 94,
}

export const FRAME_THEMES: { id: FrameTheme; label: string; desc: string }[] = [
  { id: 'classic-light', label: '经典画廊白', desc: '纯白相纸，经典徕卡范' },
  { id: 'gallery-dark', label: '暗夜画廊黑', desc: '深邃炭黑，夜景大片绝配' },
  { id: 'polaroid', label: '复古拍立得', desc: '暖白相纸，宽底落款感' },
  { id: 'blur-glass', label: '弥散毛玻璃', desc: '原图柔焦沉浸背景' },
  { id: 'film-strip', label: '35mm 胶片', desc: '复古电影齿孔与胶卷号' },
  { id: 'overlay', label: '无框悬浮', desc: '照片边缘柔暗角叠加' },
]

export interface ArtFontOption {
  id: ArtFontId
  label: string
  sample: string
  /** 主标题 / 型号字体栈 */
  displayFamily: string
  /** 参数数字字体栈 */
  metaFamily: string
  /** 是否偏向宽字距大写电影感 */
  uppercase?: boolean
  /** 是否斜体艺术手写感 */
  italic?: boolean
}

export const ART_FONTS: ArtFontOption[] = [
  {
    id: 'modern',
    label: '现代极简',
    sample: 'Leica M11',
    displayFamily: '"Inter", "PingFang SC", -apple-system, sans-serif',
    metaFamily: '"Inter", "PingFang SC", -apple-system, sans-serif',
  },
  {
    id: 'editorial',
    label: '画廊衬线',
    sample: 'Editorial',
    displayFamily: '"Playfair Display", "Songti SC", "STSong", Georgia, serif',
    metaFamily: '"Inter", "PingFang SC", sans-serif',
  },
  {
    id: 'handwriting',
    label: '艺术手写',
    sample: 'Signature',
    displayFamily: '"Caveat", "Dancing Script", "Kaiti SC", "STKaiti", cursive',
    metaFamily: '"Inter", "PingFang SC", sans-serif',
    italic: true,
  },
  {
    id: 'film-mono',
    label: '机械等宽',
    sample: 'ISO 400',
    displayFamily: '"Space Mono", "JetBrains Mono", ui-monospace, monospace',
    metaFamily: '"Space Mono", "JetBrains Mono", ui-monospace, monospace',
  },
  {
    id: 'cinema',
    label: '电影宽字',
    sample: 'CINEMA',
    displayFamily: '"Cinzel", "Songti SC", Georgia, serif',
    metaFamily: '"Inter", "PingFang SC", sans-serif',
    uppercase: true,
  },
  {
    id: 'typewriter',
    label: '复古纪实',
    sample: '1984.11',
    displayFamily: '"Courier Prime", "FangSong", "STFangsong", ui-monospace, serif',
    metaFamily: '"Courier Prime", ui-monospace, monospace',
  },
]

export const BRAND_OPTIONS: { id: BrandBadgeId; label: string }[] = [
  { id: 'auto', label: '自动识别' },
  { id: 'leica', label: 'Leica 徕卡' },
  { id: 'hasselblad', label: 'Hasselblad' },
  { id: 'fujifilm', label: 'FUJIFILM' },
  { id: 'sony', label: 'SONY' },
  { id: 'canon', label: 'Canon' },
  { id: 'nikon', label: 'Nikon' },
  { id: 'apple', label: 'iPhone' },
  { id: 'ricoh', label: 'RICOH GR' },
  { id: 'film35', label: '35MM 胶片' },
  { id: 'none', label: '不显示' },
]

export const SAMPLE_EXIFS: { label: string; data: PhotoExifFields }[] = [
  {
    label: 'Leica M11',
    data: {
      camera: 'LEICA M11',
      lens: 'APO-SUMMICRON-M 1:2/50 ASPH.',
      focalLength: '50mm',
      aperture: 'f/2.0',
      shutter: '1/1000s',
      iso: 'ISO 64',
      date: '2026.11.22',
      caption: 'Sunset Over The Ridge',
      make: 'Leica',
    },
  },
  {
    label: '富士 X100VI',
    data: {
      camera: 'FUJIFILM X100VI',
      lens: 'FUJINON 23mm F2 · Classic Neg.',
      focalLength: '23mm',
      aperture: 'f/2.8',
      shutter: '1/500s',
      iso: 'ISO 400',
      date: '2026.11.22',
      caption: '街角光影',
      make: 'FUJIFILM',
    },
  },
  {
    label: 'iPhone 15 Pro',
    data: {
      camera: 'iPhone 15 Pro',
      lens: 'Main Camera · 24mm f/1.78',
      focalLength: '24mm',
      aperture: 'f/1.8',
      shutter: '1/320s',
      iso: 'ISO 80',
      date: '2026.11.22',
      caption: 'Shot on iPhone',
      make: 'Apple',
    },
  },
]

export const FORMAT_MIME: Record<ExportFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

export const FORMAT_EXT: Record<ExportFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
}
