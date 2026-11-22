/** 身份证 / 证件正反面 A4 排版打印：类型定义与国标预设 */

export type CardSide = 'front' | 'back'
export type CropMode = 'perspective' | 'rect'
export type FilterMode = 'original' | 'scan' | 'bw'
export type LayoutMode = 'vertical-center' | 'double-set' | 'horizontal-portrait' | 'landscape-pair'
export type DocPresetId = 'id-card' | 'driver-license' | 'passport' | 'hukou' | 'custom'
export type WatermarkScope = 'cards' | 'page'

/** 归一化坐标点（0 ~ 1，相对于经过 90° 倍数旋转后的原图） */
export interface Point2D {
  x: number
  y: number
}

/** 归一化矩形选区（0 ~ 1） */
export interface RectNorm {
  x: number
  y: number
  w: number
  h: number
}

/** 单面证件的裁切与纠偏状态 */
export interface CardEditState {
  mode: CropMode
  /** 90° 倍数顺时针旋转 */
  rotation90: 0 | 90 | 180 | 270
  /** 常规裁剪模式下的精细纠偏角度（-15° ~ +15°） */
  fineAngle: number
  /** 常规比例裁剪框 */
  rect: RectNorm
  /** 四点透视拉直顶点，顺序：左上、右上、右下、左下 */
  quad: [Point2D, Point2D, Point2D, Point2D]
}

/** 已载入的证件单面数据 */
export interface CardSource {
  fileName: string
  bitmap: ImageBitmap
  width: number
  height: number
  previewUrl: string
  edit: CardEditState
}

/** 常见证件物理尺寸预设（单位：mm） */
export interface DocPreset {
  id: DocPresetId
  label: string
  shortLabel: string
  desc: string
  widthMm: number
  heightMm: number
  radiusMm: number
  frontLabel: string
  backLabel: string
}

export const DOC_PRESETS: DocPreset[] = [
  {
    id: 'id-card',
    label: '二代身份证 / 社保卡 / 银行卡',
    shortLabel: '身份证',
    desc: '国标 ISO ID-1 · 85.6 × 54.0 mm',
    widthMm: 85.6,
    heightMm: 54.0,
    radiusMm: 3.18,
    frontLabel: '正面（人像面）',
    backLabel: '反面（国徽面）',
  },
  {
    id: 'driver-license',
    label: '驾驶证 / 行驶证',
    shortLabel: '驾驶证',
    desc: '标准证芯 · 88.0 × 60.0 mm',
    widthMm: 88.0,
    heightMm: 60.0,
    radiusMm: 1.5,
    frontLabel: '主页',
    backLabel: '副页',
  },
  {
    id: 'passport',
    label: '护照信息页',
    shortLabel: '护照',
    desc: '单页展开 · 125.0 × 88.0 mm',
    widthMm: 125.0,
    heightMm: 88.0,
    radiusMm: 0,
    frontLabel: '信息页',
    backLabel: '备注 / 签证页',
  },
  {
    id: 'hukou',
    label: '户口本内页',
    shortLabel: '户口本',
    desc: '标准内页 · 143.0 × 105.0 mm',
    widthMm: 143.0,
    heightMm: 105.0,
    radiusMm: 0,
    frontLabel: '户主页',
    backLabel: '个人页',
  },
  {
    id: 'custom',
    label: '自定义尺寸',
    shortLabel: '自定义',
    desc: '自由设定毫米宽高',
    widthMm: 85.6,
    heightMm: 54.0,
    radiusMm: 2.0,
    frontLabel: '正面',
    backLabel: '反面',
  },
]

export const LAYOUT_OPTIONS: { id: LayoutMode; label: string; desc: string }[] = [
  { id: 'vertical-center', label: '标准上下居中', desc: 'A4 纵向 1:1 黄金居中（推荐）' },
  { id: 'double-set', label: '一页双份省纸', desc: '单张 A4 排两套，中线剪开' },
  { id: 'horizontal-portrait', label: '纵向左右并排', desc: 'A4 纵向居中左右排列' },
  { id: 'landscape-pair', label: '横向 A4 并排', desc: 'A4 横向左右舒展排列' },
]

export const WATERMARK_PRESETS: { label: string; text: string }[] = [
  { label: '入职办理', text: '仅供入职办理使用，复印及他用无效' },
  { label: '租房签约', text: '仅供房屋租赁签约使用，他用无效' },
  { label: '银行开户', text: '仅供银行开户业务使用，他用无效' },
  { label: '政务办理', text: '仅供本次政务事项办理，他用无效' },
]

/** 全局排版与输出参数 */
export interface PrintOptions {
  docPreset: DocPresetId
  customWidthMm: number
  customHeightMm: number
  layout: LayoutMode
  /** 物理尺寸倍率百分比（100 = 严格 1:1 原大） */
  scalePercent: number
  /** 正反面间距（mm） */
  gapMm: number
  /** 按证件国标自动裁切圆角，去除边缘桌角杂色 */
  roundCorners: boolean
  /** 绘制极细淡灰描边，防止白底证件打印后边界不清晰 */
  cardBorder: boolean
  /** 一页双份模式下显示中间虚线裁剪参考线 */
  cutGuides: boolean

  /** 打印增强滤镜 */
  filter: FilterMode
  brightness: number
  contrast: number

  /** 防盗用途签注水印 */
  enableWatermark: boolean
  watermarkText: string
  watermarkIncludeDate: boolean
  watermarkScope: WatermarkScope
  watermarkColor: string
  watermarkOpacity: number
  watermarkFontSize: number
  watermarkAngle: number
}

export const defaultPrintOptions: PrintOptions = {
  docPreset: 'id-card',
  customWidthMm: 85.6,
  customHeightMm: 54.0,
  layout: 'vertical-center',
  scalePercent: 100,
  gapMm: 18,
  roundCorners: true,
  cardBorder: true,
  cutGuides: true,

  filter: 'original',
  brightness: 0,
  contrast: 0,

  enableWatermark: false,
  watermarkText: '仅供办理业务使用，复印及他用无效',
  watermarkIncludeDate: false,
  watermarkScope: 'cards',
  watermarkColor: '#dc2626',
  watermarkOpacity: 30,
  watermarkFontSize: 12,
  watermarkAngle: -28,
}

/** 获取当前生效的证件物理尺寸（mm）与文案 */
export function getActiveDocSpec(opts: PrintOptions): DocPreset {
  const found = DOC_PRESETS.find((p) => p.id === opts.docPreset) ?? DOC_PRESETS[0]
  if (opts.docPreset !== 'custom') return found
  return {
    ...found,
    widthMm: Math.max(20, Math.min(200, opts.customWidthMm || 85.6)),
    heightMm: Math.max(20, Math.min(200, opts.customHeightMm || 54)),
  }
}
