/**
 * 印章生成器类型定义、预设模板、字体与配色常量
 */

/** 印章大类 */
export type SealType = 'company' | 'oval' | 'personal' | 'rect'

/** 圆形公章中心图徽 */
export type CenterEmblem = 'star' | 'hollow-star' | 'double-star' | 'none'

/** 个人方章雕刻风格：朱文（阳刻红字） / 白文（阴刻镂空） */
export type PersonalCarveStyle = 'zhuwen' | 'baiwen'

/** 个人方章边框样式 */
export type FrameStyle = 'single' | 'double' | 'none'

/** 个人方章排版方向：传统竖排（右→左，上→下） / 现代横排（左→右，上→下） */
export type PersonalFlow = 'traditional' | 'modern'

/** 个人方章 3 字排布偏好 */
export type ThreeCharLayout = 'right-two' | 'left-two'

/** 条形章版式 */
export type RectLayout = 'single' | 'dated'

/** 条形章边框线型 */
export type RectBorderStyle = 'single' | 'double' | 'dashed'

/** 预览画布底衬模式 */
export type PreviewBackdrop = 'checker' | 'paper' | 'contract' | 'custom'

/** 导出分辨率模式 */
export type ExportSizeMode = '512' | '1024' | '2048' | 'print300'

/** 印章完整配置 */
export interface SealConfig {
  /** 印章大类 */
  type: SealType
  /** 主文字（公司名 / 个人姓名 / 条形章主标题） */
  mainText: string
  /** 副标题（如「合同专用章」「发票专用章」/ 条形章附注） */
  subText: string
  /** 编码 / 税号 / 日期（公章 13 位防伪码 / 椭圆章 18 位税号 / 日期章日期） */
  codeText: string
  /** 印泥颜色（HEX） */
  color: string
  /** 字体栈键名（或 custom） */
  fontId: string
  /** 字体粗细（400 / 600 / 700） */
  fontWeight: number
  /** 物理标称宽度（mm，用于 300 DPI 打印尺寸换算与标尺显示） */
  physicalWidthMm: number
  /** 物理标称高度（mm） */
  physicalHeightMm: number

  // —— 通用排版与特效 ——
  /** 边框线宽（相对基准画布 600px 的比例值） */
  borderWidth: number
  /** 整体旋转角度（-35° ~ +35°） */
  rotation: number
  /** 真实印泥做旧强度（0–100，0 表示极致锐利纯净） */
  aging: number
  /** 做旧随机种子（用于保持预览与导出一致） */
  agingSeed: number
  /** 是否叠加斜向「样例」演示水印 */
  showSampleMark: boolean

  // —— 圆形公章专属 ——
  /** 主文字环绕总角度（160° ~ 300°） */
  ringSpanDeg: number
  /** 主文字字号 */
  mainFontSize: number
  /** 主文字横向压缩比（实体公章通常偏瘦长，0.55 ~ 1.15） */
  textStretchX: number
  /** 副标题字号 */
  subFontSize: number
  /** 副标题垂直偏移（相对中心向下，0 ~ 140） */
  subOffsetY: number
  /** 是否显示内细圈 */
  showInnerRing: boolean
  /** 中心图徽类型 */
  emblem: CenterEmblem
  /** 中心图徽大小（30 ~ 110） */
  emblemSize: number
  /** 是否显示底部防伪编码 */
  showCode: boolean
  /** 底部编码弧度跨度（50° ~ 140°） */
  codeSpanDeg: number

  // —— 椭圆发票章专属 ——
  /** 椭圆章税号字号 */
  taxFontSize: number
  /** 椭圆章税号字距 */
  taxLetterSpacing: number

  // —— 个人方形私章专属 ——
  /** 雕刻风格：朱文（阳刻） / 白文（阴刻） */
  carveStyle: PersonalCarveStyle
  /** 边框样式：单框 / 双框 / 无框 */
  personalFrame: FrameStyle
  /** 排版顺序：传统竖排 / 现代横排 */
  personalFlow: PersonalFlow
  /** 3 字时左右列分配 */
  threeCharLayout: ThreeCharLayout
  /** 边角圆角（0 ~ 48） */
  cornerRadius: number
  /** 印文内边距（12 ~ 72） */
  innerPadding: number

  // —— 长方形条形/审核/日期章专属 ——
  /** 版式：单栏大字 / 日期三段章 */
  rectLayout: RectLayout
  /** 边框样式 */
  rectBorderStyle: RectBorderStyle
  /** 英文或小号副标题（单栏模式）/ 底部经办人（日期模式） */
  rectExtraText: string
}

/** 内置印泥色彩预设 */
export interface InkPreset {
  name: string
  hex: string
}

export const INK_PRESETS: InkPreset[] = [
  { name: '公章正红', hex: '#D4282D' },
  { name: '朱砂印泥', hex: '#C62328' },
  { name: '古风暗朱', hex: '#9E1F24' },
  { name: '财务靛蓝', hex: '#1D4ED8' },
  { name: '签核黛绿', hex: '#15803D' },
  { name: '纯墨黑', hex: '#18181B' },
]

/** 精选字体预设（全部基于本地离线字体栈回退，同时支持拖入本地 .ttf/.otf/.woff2） */
export interface FontOption {
  id: string
  label: string
  hint: string
  family: string
}

export const FONT_OPTIONS: FontOption[] = [
  {
    id: 'song',
    label: '标准宋体',
    hint: '公章 / 发票章经典',
    family: '"Songti SC", "SimSun", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", serif',
  },
  {
    id: 'fangsong',
    label: '公文仿宋',
    hint: '清秀正式公文感',
    family: '"FangSong", "STFangsong", "FangSong_GB2312", "Songti SC", serif',
  },
  {
    id: 'hei',
    label: '现代黑体',
    hint: '条形章 / 审阅章醒目',
    family: '"PingFang SC", "Microsoft YaHei", "Heiti SC", "SimHei", "Noto Sans CJK SC", sans-serif',
  },
  {
    id: 'kai',
    label: '楷书印体',
    hint: '个人私章 / 书画雅致',
    family: '"Kaiti SC", "STKaiti", "KaiTi", "DFKai-SB", "BiauKai", serif',
  },
  {
    id: 'lishu',
    label: '隶书古韵',
    hint: '闲章 / 传统金石味',
    family: '"Baoli SC", "LiSu", "STLiti", "Hannotate SC", "Kaiti SC", serif',
  },
  {
    id: 'mono',
    label: '机械等宽',
    hint: '日期章 / 编码整齐',
    family: '"SFMono-Regular", "Consolas", "Menlo", "PingFang SC", monospace',
  },
]

/** 快捷场景模板预设 */
export interface SealPreset {
  id: string
  name: string
  tag: string
  type: SealType
  patch: Partial<SealConfig>
}

/** 格式化今天日期（YYYY.MM.DD） */
export function getTodayDotDate(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`
}

/** 默认配置（圆形企业公章） */
export const DEFAULT_SEAL_CONFIG: SealConfig = {
  type: 'company',
  mainText: '轻匣数字科技有限公司',
  subText: '合同专用章',
  codeText: '1101050082026',
  color: '#D4282D',
  fontId: 'song',
  fontWeight: 700,
  physicalWidthMm: 42,
  physicalHeightMm: 42,

  borderWidth: 14,
  rotation: 0,
  aging: 22,
  agingSeed: 202611,
  showSampleMark: false,

  ringSpanDeg: 245,
  mainFontSize: 54,
  textStretchX: 0.78,
  subFontSize: 38,
  subOffsetY: 96,
  showInnerRing: true,
  emblem: 'star',
  emblemSize: 72,
  showCode: true,
  codeSpanDeg: 82,

  taxFontSize: 28,
  taxLetterSpacing: 3,

  carveStyle: 'zhuwen',
  personalFrame: 'single',
  personalFlow: 'traditional',
  threeCharLayout: 'right-two',
  cornerRadius: 12,
  innerPadding: 34,

  rectLayout: 'dated',
  rectBorderStyle: 'double',
  rectExtraText: '质量检验部',
}

/** 精选场景模板库（覆盖企业、财务、个人、办公全场景） */
export const SEAL_PRESETS: SealPreset[] = [
  {
    id: 'company-official',
    name: '标准企业公章',
    tag: '圆形 42mm',
    type: 'company',
    patch: {
      type: 'company',
      mainText: '轻匣数字科技有限公司',
      subText: '',
      codeText: '1101050082026',
      color: '#D4282D',
      fontId: 'song',
      fontWeight: 700,
      physicalWidthMm: 42,
      physicalHeightMm: 42,
      borderWidth: 15,
      ringSpanDeg: 248,
      mainFontSize: 56,
      textStretchX: 0.78,
      showInnerRing: false,
      emblem: 'star',
      emblemSize: 78,
      showCode: true,
      codeSpanDeg: 80,
      aging: 24,
      rotation: 0,
    },
  },
  {
    id: 'company-contract',
    name: '合同专用章',
    tag: '圆形 42mm',
    type: 'company',
    patch: {
      type: 'company',
      mainText: '轻匣数字科技有限公司',
      subText: '合同专用章',
      codeText: '1101050082026',
      color: '#D4282D',
      fontId: 'song',
      fontWeight: 700,
      physicalWidthMm: 42,
      physicalHeightMm: 42,
      borderWidth: 14,
      ringSpanDeg: 242,
      mainFontSize: 54,
      textStretchX: 0.78,
      subFontSize: 38,
      subOffsetY: 96,
      showInnerRing: true,
      emblem: 'star',
      emblemSize: 70,
      showCode: true,
      codeSpanDeg: 82,
      aging: 22,
      rotation: 0,
    },
  },
  {
    id: 'oval-invoice',
    name: '发票专用章',
    tag: '椭圆 40×30mm',
    type: 'oval',
    patch: {
      type: 'oval',
      mainText: '轻匣数字科技有限公司',
      subText: '发票专用章',
      codeText: '91110105MA01L8X92K',
      color: '#D4282D',
      fontId: 'song',
      fontWeight: 700,
      physicalWidthMm: 40,
      physicalHeightMm: 30,
      borderWidth: 12,
      mainFontSize: 40,
      textStretchX: 0.76,
      subFontSize: 36,
      taxFontSize: 27,
      taxLetterSpacing: 2.5,
      showInnerRing: false,
      showCode: true,
      aging: 20,
      rotation: 0,
    },
  },
  {
    id: 'personal-zhuwen',
    name: '法人朱文私章',
    tag: '方章 20mm',
    type: 'personal',
    patch: {
      type: 'personal',
      mainText: '张明远印',
      subText: '',
      color: '#C62328',
      fontId: 'kai',
      fontWeight: 700,
      physicalWidthMm: 20,
      physicalHeightMm: 20,
      borderWidth: 18,
      carveStyle: 'zhuwen',
      personalFrame: 'single',
      personalFlow: 'traditional',
      cornerRadius: 12,
      innerPadding: 34,
      aging: 28,
      rotation: 0,
    },
  },
  {
    id: 'personal-baiwen',
    name: '书画白文篆印',
    tag: '阴刻 22mm',
    type: 'personal',
    patch: {
      type: 'personal',
      mainText: '清风明月',
      subText: '',
      color: '#9E1F24',
      fontId: 'lishu',
      fontWeight: 700,
      physicalWidthMm: 22,
      physicalHeightMm: 22,
      borderWidth: 14,
      carveStyle: 'baiwen',
      personalFrame: 'single',
      personalFlow: 'traditional',
      cornerRadius: 18,
      innerPadding: 36,
      aging: 38,
      rotation: -3,
    },
  },
  {
    id: 'rect-approved',
    name: '审核日期章',
    tag: '条形 50×24mm',
    type: 'rect',
    patch: {
      type: 'rect',
      mainText: '已 审 核',
      subText: '',
      codeText: getTodayDotDate(),
      rectExtraText: '综合管理部',
      color: '#1D4ED8',
      fontId: 'hei',
      fontWeight: 700,
      physicalWidthMm: 50,
      physicalHeightMm: 24,
      borderWidth: 10,
      rectLayout: 'dated',
      rectBorderStyle: 'double',
      cornerRadius: 14,
      aging: 18,
      rotation: -6,
    },
  },
  {
    id: 'rect-paid',
    name: '财务付讫章',
    tag: '条形 48×20mm',
    type: 'rect',
    patch: {
      type: 'rect',
      mainText: '银 行 付 讫',
      subText: 'PAID · 财务专用',
      codeText: getTodayDotDate(),
      rectExtraText: 'PAID · 财务专用',
      color: '#D4282D',
      fontId: 'hei',
      fontWeight: 700,
      physicalWidthMm: 48,
      physicalHeightMm: 20,
      borderWidth: 12,
      rectLayout: 'single',
      rectBorderStyle: 'double',
      cornerRadius: 10,
      aging: 22,
      rotation: -8,
    },
  },
  {
    id: 'rect-draft',
    name: '绝密 / 样稿章',
    tag: '斜签 50×22mm',
    type: 'rect',
    patch: {
      type: 'rect',
      mainText: '样 稿 仅 供 参 考',
      subText: '',
      rectExtraText: 'DRAFT · DO NOT DISTRIBUTE',
      color: '#9E1F24',
      fontId: 'hei',
      fontWeight: 700,
      physicalWidthMm: 54,
      physicalHeightMm: 22,
      borderWidth: 12,
      rectLayout: 'single',
      rectBorderStyle: 'dashed',
      cornerRadius: 12,
      aging: 26,
      rotation: -14,
    },
  },
]

/** 根据配置估算输出像素（给定分辨率模式） */
export function resolveExportDimensions(
  config: SealConfig,
  mode: ExportSizeMode,
): { width: number; height: number } {
  const aspect = config.physicalWidthMm / Math.max(1, config.physicalHeightMm)
  if (mode === 'print300') {
    // 300 DPI: 1 inch = 25.4 mm
    const mmToPx = 300 / 25.4
    // 预留少量外边距避免旋转时裁切
    const padFactor = Math.abs(config.rotation) > 0.5 ? 1.18 : 1.06
    const w = Math.max(128, Math.round(config.physicalWidthMm * mmToPx * padFactor))
    const h = Math.max(128, Math.round(config.physicalHeightMm * mmToPx * padFactor))
    return { width: w, height: h }
  }
  const longSide = Number(mode) || 1024
  if (aspect >= 1) {
    return { width: longSide, height: Math.max(200, Math.round(longSide / aspect)) }
  }
  return { width: Math.max(200, Math.round(longSide * aspect)), height: longSide }
}
