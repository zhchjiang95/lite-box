/** 二维码生成与识别：类型定义、内容构造器与美学预设 */

export type QrMode = 'generate' | 'decode'
export type GenerateSubMode = 'single' | 'batch'

export type PayloadType = 'text' | 'wifi' | 'vcard' | 'email' | 'sms'
export type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H'
export type DotStyle = 'square' | 'rounded' | 'dots' | 'fluid' | 'diamond'
export type EyeStyle = 'square' | 'rounded' | 'circle'
export type GradientAngle = 0 | 45 | 90 | 135
export type LogoShape = 'rounded' | 'circle'

export interface WifiPayload {
  ssid: string
  password: string
  encryption: 'WPA' | 'WEP' | 'nopass'
  hidden: boolean
}

export interface VCardPayload {
  name: string
  phone: string
  email: string
  org: string
  title: string
  url: string
  note: string
}

export interface EmailPayload {
  to: string
  subject: string
  body: string
}

export interface SmsPayload {
  phone: string
  message: string
}

export interface QrStyleConfig {
  /** 容错率 */
  ecLevel: ErrorCorrectionLevel
  /** 四周留白（模块数） */
  margin: number
  /** 导出尺寸（px） */
  exportSize: number
  /** 码点形状 */
  dotStyle: DotStyle
  /** 定位码眼形状 */
  eyeStyle: EyeStyle
  /** 前景色 */
  fgColor: string
  /** 是否开启前景渐变 */
  useGradient: boolean
  /** 渐变终点色 */
  fgColorEnd: string
  /** 渐变角度 */
  gradientAngle: GradientAngle
  /** 是否使用独立码眼色 */
  customEyeColor: boolean
  /** 独立码眼色 */
  eyeColor: string
  /** 背景色（支持 transparent） */
  bgColor: string
  /** 底部说明文字（留空不显示） */
  caption: string
  /** 中心 Logo 占二维码边长比例（0.14 - 0.26） */
  logoScale: number
  /** Logo 裁切形状 */
  logoShape: LogoShape
}

export interface LogoAsset {
  /** 可直接渲染的 Image 元素 */
  image: HTMLImageElement
  /** 内联到 SVG 的 dataURL */
  dataUrl: string
  /** 预览 URL（与 dataUrl 一致，避免额外生命周期问题） */
  name: string
}

export interface QrStylePreset {
  id: string
  name: string
  previewColors: [string, string, string]
  patch: Partial<QrStyleConfig>
}

export const DEFAULT_QR_STYLE: QrStyleConfig = {
  ecLevel: 'M',
  margin: 2,
  exportSize: 1024,
  dotStyle: 'rounded',
  eyeStyle: 'rounded',
  fgColor: '#111827',
  useGradient: false,
  fgColorEnd: '#4f46e5',
  gradientAngle: 135,
  customEyeColor: false,
  eyeColor: '#111827',
  bgColor: '#ffffff',
  caption: '',
  logoScale: 0.2,
  logoShape: 'rounded',
}

/** 6 套开箱即用的高颜值预设 */
export const QR_STYLE_PRESETS: QrStylePreset[] = [
  {
    id: 'classic',
    name: '经典极简',
    previewColors: ['#111827', '#111827', '#ffffff'],
    patch: {
      dotStyle: 'square',
      eyeStyle: 'square',
      fgColor: '#111827',
      useGradient: false,
      customEyeColor: false,
      bgColor: '#ffffff',
    },
  },
  {
    id: 'aurora',
    name: '极光液态',
    previewColors: ['#4f46e5', '#06b6d4', '#ffffff'],
    patch: {
      dotStyle: 'fluid',
      eyeStyle: 'rounded',
      fgColor: '#4f46e5',
      useGradient: true,
      fgColorEnd: '#06b6d4',
      gradientAngle: 135,
      customEyeColor: true,
      eyeColor: '#3730a3',
      bgColor: '#ffffff',
    },
  },
  {
    id: 'emerald',
    name: '翡翠圆点',
    previewColors: ['#059669', '#0d9488', '#f0fdf4'],
    patch: {
      dotStyle: 'dots',
      eyeStyle: 'circle',
      fgColor: '#059669',
      useGradient: true,
      fgColorEnd: '#0d9488',
      gradientAngle: 135,
      customEyeColor: true,
      eyeColor: '#065f46',
      bgColor: '#ffffff',
    },
  },
  {
    id: 'sunset',
    name: '落日菱格',
    previewColors: ['#ea580c', '#e11d48', '#fff7ed'],
    patch: {
      dotStyle: 'diamond',
      eyeStyle: 'rounded',
      fgColor: '#ea580c',
      useGradient: true,
      fgColorEnd: '#e11d48',
      gradientAngle: 45,
      customEyeColor: true,
      eyeColor: '#9a3412',
      bgColor: '#fffbf5',
    },
  },
  {
    id: 'midnight',
    name: '暗夜霓虹',
    previewColors: ['#38bdf8', '#a855f7', '#0f172a'],
    patch: {
      dotStyle: 'rounded',
      eyeStyle: 'rounded',
      fgColor: '#38bdf8',
      useGradient: true,
      fgColorEnd: '#a855f7',
      gradientAngle: 135,
      customEyeColor: false,
      bgColor: '#0f172a',
    },
  },
  {
    id: 'slate',
    name: '商务雅灰',
    previewColors: ['#1e293b', '#334155', '#f8fafc'],
    patch: {
      dotStyle: 'rounded',
      eyeStyle: 'square',
      fgColor: '#1e293b',
      useGradient: false,
      customEyeColor: false,
      bgColor: '#f8fafc',
    },
  },
]

export const EC_LEVEL_OPTIONS: { value: ErrorCorrectionLevel; label: string; desc: string }[] = [
  { value: 'L', label: 'L (7%)', desc: '体积最简，适合纯链接' },
  { value: 'M', label: 'M (15%)', desc: '日常均衡推荐' },
  { value: 'Q', label: 'Q (25%)', desc: '较强抗污损能力' },
  { value: 'H', label: 'H (30%)', desc: '最高容错，嵌入 Logo 必选' },
]

export const DOT_STYLE_OPTIONS: { value: DotStyle; label: string }[] = [
  { value: 'square', label: '经典方格' },
  { value: 'rounded', label: '圆角方格' },
  { value: 'dots', label: '精致圆点' },
  { value: 'fluid', label: '液态连接' },
  { value: 'diamond', label: '菱形点阵' },
]

export const EYE_STYLE_OPTIONS: { value: EyeStyle; label: string }[] = [
  { value: 'square', label: '方正' },
  { value: 'rounded', label: '圆角' },
  { value: 'circle', label: '圆形' },
]

export const FG_PRESETS = ['#111827', '#1e293b', '#4f46e5', '#0284c7', '#059669', '#ea580c', '#e11d48', '#7c3aed']
export const BG_PRESETS = ['transparent', '#ffffff', '#f8fafc', '#fffbf5', '#f0fdf4', '#0f172a', '#18181b']

/** 转义 Wi-Fi 二维码中的保留字符 */
function escapeWifiValue(str: string): string {
  return str.replace(/([\\;,:"])/g, '\\$1')
}

/** 根据不同模板拼装标准二维码内容串 */
export function buildWifiPayload(wifi: WifiPayload): string {
  const ssid = wifi.ssid.trim()
  if (!ssid) return ''
  const parts = [`T:${wifi.encryption}`, `S:${escapeWifiValue(ssid)}`]
  if (wifi.encryption !== 'nopass' && wifi.password) {
    parts.push(`P:${escapeWifiValue(wifi.password)}`)
  }
  if (wifi.hidden) {
    parts.push('H:true')
  }
  return `WIFI:${parts.join(';')};;`
}

/** 构造 vCard 3.0 电子名片字符串 */
export function buildVCardPayload(card: VCardPayload): string {
  const name = card.name.trim()
  const hasAny = [name, card.phone, card.email, card.org, card.title, card.url, card.note].some((v) => v.trim())
  if (!hasAny) return ''
  const lines = ['BEGIN:VCARD', 'VERSION:3.0']
  if (name) {
    lines.push(`N:;${name};;;`)
    lines.push(`FN:${name}`)
  }
  if (card.org.trim()) lines.push(`ORG:${card.org.trim()}`)
  if (card.title.trim()) lines.push(`TITLE:${card.title.trim()}`)
  if (card.phone.trim()) lines.push(`TEL;TYPE=CELL:${card.phone.trim()}`)
  if (card.email.trim()) lines.push(`EMAIL:${card.email.trim()}`)
  if (card.url.trim()) lines.push(`URL:${card.url.trim()}`)
  if (card.note.trim()) lines.push(`NOTE:${card.note.trim().replace(/\n/g, '\\n')}`)
  lines.push('END:VCARD')
  return lines.join('\n')
}

/** 构造 mailto 邮件协议串 */
export function buildEmailPayload(email: EmailPayload): string {
  const to = email.to.trim()
  if (!to) return ''
  const params = new URLSearchParams()
  if (email.subject.trim()) params.set('subject', email.subject.trim())
  if (email.body.trim()) params.set('body', email.body.trim())
  const query = params.toString()
  return query ? `mailto:${to}?${query}` : `mailto:${to}`
}

/** 构造短信或电话协议串 */
export function buildSmsPayload(sms: SmsPayload): string {
  const phone = sms.phone.trim()
  if (!phone) return ''
  const msg = sms.message.trim()
  return msg ? `SMSTO:${phone}:${msg}` : `tel:${phone}`
}

/** 解码结果语义解析结构 */
export type ParsedQrContent =
  | { kind: 'url'; url: string }
  | { kind: 'wifi'; ssid: string; password: string; encryption: string; hidden: boolean }
  | { kind: 'vcard'; name?: string; phone?: string; email?: string; org?: string; title?: string; url?: string }
  | { kind: 'email'; to: string; subject?: string; body?: string }
  | { kind: 'tel'; phone: string }
  | { kind: 'sms'; phone: string; message?: string }
  | { kind: 'text' }

/** 识别解码后字符串的语义类型，方便展示友好交互卡片 */
export function parseQrContent(raw: string): ParsedQrContent {
  const trimmed = raw.trim()

  // URL 检测（仅放行 http/https 避免 javascript: 风险）
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    return { kind: 'url', url: trimmed }
  }

  // Wi-Fi 解析
  if (/^WIFI:/i.test(trimmed)) {
    const body = trimmed.slice(5)
    const readField = (key: string) => {
      const m = body.match(new RegExp(`(?:^|;)${key}:((?:\\\\.|[^;])*)`, 'i'))
      return m ? m[1].replace(/\\([\\;,:"])/g, '$1') : ''
    }
    return {
      kind: 'wifi',
      ssid: readField('S') || '未命名网络',
      password: readField('P'),
      encryption: readField('T') || 'nopass',
      hidden: readField('H').toLowerCase() === 'true',
    }
  }

  // vCard 解析
  if (/^BEGIN:VCARD/i.test(trimmed)) {
    const get = (prefix: string) => {
      const m = trimmed.match(new RegExp(`^${prefix}(?:;[^:]*)?:(.*)$`, 'im'))
      return m ? m[1].trim() : undefined
    }
    return {
      kind: 'vcard',
      name: get('FN') || get('N')?.replace(/;/g, ' ').trim(),
      phone: get('TEL'),
      email: get('EMAIL'),
      org: get('ORG'),
      title: get('TITLE'),
      url: get('URL'),
    }
  }

  // 邮件解析
  if (/^mailto:/i.test(trimmed)) {
    const [addr, query = ''] = trimmed.slice(7).split('?')
    const params = new URLSearchParams(query)
    return {
      kind: 'email',
      to: decodeURIComponent(addr),
      subject: params.get('subject') || undefined,
      body: params.get('body') || undefined,
    }
  }

  // 电话解析
  if (/^tel:/i.test(trimmed)) {
    return { kind: 'tel', phone: trimmed.slice(4) }
  }

  // 短信解析
  if (/^SMSTO:/i.test(trimmed)) {
    const rest = trimmed.slice(6)
    const idx = rest.indexOf(':')
    return idx >= 0
      ? { kind: 'sms', phone: rest.slice(0, idx), message: rest.slice(idx + 1) }
      : { kind: 'sms', phone: rest }
  }

  return { kind: 'text' }
}

/** 解析 #rrggbb 或 #rgb 为 RGB 数值，用于对比度校验 */
function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, '')
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16),
      parseInt(clean[1] + clean[1], 16),
      parseInt(clean[2] + clean[2], 16),
    ]
  }
  if (clean.length === 6) {
    return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)]
  }
  return null
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** 计算前景与背景对比度与反色提示 */
export function evaluateReadability(style: QrStyleConfig, hasLogo: boolean): {
  contrast: number | null
  inverted: boolean
  warnings: string[]
} {
  const warnings: string[] = []
  let contrast: number | null = null
  let inverted = false

  if (style.bgColor !== 'transparent') {
    const fgRgb = hexToRgb(style.fgColor)
    const bgRgb = hexToRgb(style.bgColor)
    if (fgRgb && bgRgb) {
      const l1 = relativeLuminance(fgRgb)
      const l2 = relativeLuminance(bgRgb)
      contrast = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
      if (l1 > l2) {
        inverted = true
      }
      if (contrast < 3.2) {
        warnings.push('前景色与背景色对比度偏低，部分老旧扫码器可能不易识别')
      } else if (inverted) {
        warnings.push('当前为深底浅码（反色），主流微信/相机可识别，但印刷场景建议浅底深码')
      }
    }
  }

  if (hasLogo && (style.ecLevel === 'L' || style.ecLevel === 'M')) {
    warnings.push('嵌入中心 Logo 建议将容错等级调至 H（30%），以确保任意手机都能秒扫')
  }

  return { contrast, inverted, warnings }
}
