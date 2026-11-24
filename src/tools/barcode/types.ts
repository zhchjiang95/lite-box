/** 条形码生成：制式规范、GS1 校验位算法、样式配置与预设 */

export type BarcodeFormat =
  | 'CODE128'
  | 'CODE128B'
  | 'CODE128C'
  | 'EAN13'
  | 'EAN8'
  | 'UPC'
  | 'CODE39'
  | 'ITF14'
  | 'ITF'
  | 'MSI'
  | 'pharmacode'
  | 'codabar'

export type BarcodeSubMode = 'single' | 'batch'
export type BarcodeFontFamily = 'monospace' | 'sans-serif' | 'serif'
export type BarcodeTextAlign = 'left' | 'center' | 'right'
export type BarcodeTextPosition = 'bottom' | 'top'

export interface BarcodeFormatMeta {
  id: BarcodeFormat
  label: string
  category: 'general' | 'retail' | 'industrial'
  desc: string
  rule: string
  sample: string
  placeholder: string
  /** 若为 GS1 校验制式，记录主干长度与含校验码总长度 */
  gs1Lengths?: { body: number; full: number }
}

export const BARCODE_FORMATS: BarcodeFormatMeta[] = [
  {
    id: 'CODE128',
    label: 'CODE 128',
    category: 'general',
    desc: '通用全能首选（快递/资产/仓储）',
    rule: '支持 ASCII 字母、数字与符号，自动压缩编码',
    sample: 'LB-2026-88019',
    placeholder: '输入字母、数字或符号，如 LB-2026-88019',
  },
  {
    id: 'EAN13',
    label: 'EAN-13',
    category: 'retail',
    desc: '国际零售商品条码（中国 69 码）',
    rule: '12 位（自动补校验位）或 13 位纯数字',
    sample: '6901234567892',
    placeholder: '输入 12 或 13 位数字，如 690123456789',
    gs1Lengths: { body: 12, full: 13 },
  },
  {
    id: 'EAN8',
    label: 'EAN-8',
    category: 'retail',
    desc: '小型商品包装条码',
    rule: '7 位（自动补校验位）或 8 位纯数字',
    sample: '69012342',
    placeholder: '输入 7 或 8 位数字，如 6901234',
    gs1Lengths: { body: 7, full: 8 },
  },
  {
    id: 'UPC',
    label: 'UPC-A',
    category: 'retail',
    desc: '北美商超通用商品条码',
    rule: '11 位（自动补校验位）或 12 位纯数字',
    sample: '012345678905',
    placeholder: '输入 11 或 12 位数字，如 01234567890',
    gs1Lengths: { body: 11, full: 12 },
  },
  {
    id: 'CODE39',
    label: 'CODE 39',
    category: 'industrial',
    desc: '工业/医疗/资产管理标准',
    rule: '大写字母 A-Z、数字 0-9 及 - . $ / + % 空格',
    sample: 'ASSET-0924',
    placeholder: '如 ASSET-0924（小写将自动转大写）',
  },
  {
    id: 'ITF14',
    label: 'ITF-14',
    category: 'industrial',
    desc: '物流运输外箱条码',
    rule: '13 位（自动补校验位）或 14 位纯数字',
    sample: '10012345678902',
    placeholder: '输入 13 或 14 位数字',
    gs1Lengths: { body: 13, full: 14 },
  },
  {
    id: 'CODE128C',
    label: 'CODE 128C',
    category: 'general',
    desc: '高密度纯数字条码',
    rule: '偶数位纯数字（如 12345678）',
    sample: '202611240088',
    placeholder: '输入偶数位纯数字',
  },
  {
    id: 'CODE128B',
    label: 'CODE 128B',
    category: 'general',
    desc: '标准 ASCII 文本条码',
    rule: '支持大小写字母、数字与常见标点',
    sample: 'LiteBox_01',
    placeholder: '输入标准 ASCII 文本',
  },
  {
    id: 'ITF',
    label: 'ITF (交插二五)',
    category: 'industrial',
    desc: '仓储物流纯数字条码',
    rule: '任意偶数位纯数字',
    sample: '1234567890',
    placeholder: '输入偶数位纯数字',
  },
  {
    id: 'MSI',
    label: 'MSI',
    category: 'industrial',
    desc: '商超货架/库存标签',
    rule: '任意长度纯数字',
    sample: '1048576',
    placeholder: '输入纯数字',
  },
  {
    id: 'codabar',
    label: 'Codabar',
    category: 'industrial',
    desc: '血库/快递/图书馆借阅码',
    rule: '数字与 - $ : / . +（起止可选 A-D）',
    sample: 'A12345678B',
    placeholder: '如 A12345678B',
  },
  {
    id: 'pharmacode',
    label: 'Pharmacode',
    category: 'industrial',
    desc: '医药包装防错条码',
    rule: '整数范围 3 ~ 131070',
    sample: '12345',
    placeholder: '输入 3 ~ 131070 之间的整数',
  },
]

export const BARCODE_FORMAT_MAP = Object.fromEntries(BARCODE_FORMATS.map((f) => [f.id, f])) as Record<
  BarcodeFormat,
  BarcodeFormatMeta
>

export interface BarcodeStyleConfig {
  format: BarcodeFormat
  /** 单条基准宽度（1 - 5） */
  barWidth: number
  /** 条码主体高度（30 - 200） */
  height: number
  /** 四周静区留白（0 - 40） */
  margin: number
  /** 条纹颜色 */
  lineColor: string
  /** 背景色（支持 transparent） */
  background: string
  /** 是否显示人类可读文字（HRI） */
  displayValue: boolean
  /** 自定义覆盖显示文字（留空时显示条码原始编码） */
  customText: string
  /** 字体族 */
  font: BarcodeFontFamily
  /** 是否加粗 */
  bold: boolean
  /** 文字字号（10 - 36） */
  fontSize: number
  /** 文字与条纹间距（0 - 24） */
  textMargin: number
  /** 文字对齐 */
  textAlign: BarcodeTextAlign
  /** 文字位置 */
  textPosition: BarcodeTextPosition
  /** 导出 PNG 高清倍率（1 / 2 / 3） */
  exportScale: 1 | 2 | 3
}

export const DEFAULT_BARCODE_STYLE: BarcodeStyleConfig = {
  format: 'CODE128',
  barWidth: 2.2,
  height: 92,
  margin: 16,
  lineColor: '#111827',
  background: '#ffffff',
  displayValue: true,
  customText: '',
  font: 'monospace',
  bold: false,
  fontSize: 16,
  textMargin: 6,
  textAlign: 'center',
  textPosition: 'bottom',
  exportScale: 2,
}

export const BARCODE_STYLE_PRESETS: {
  id: string
  name: string
  colors: [string, string]
  patch: Partial<BarcodeStyleConfig>
}[] = [
  {
    id: 'classic',
    name: '经典印刷黑',
    colors: ['#111827', '#ffffff'],
    patch: { lineColor: '#111827', background: '#ffffff', displayValue: true, bold: false, margin: 16 },
  },
  {
    id: 'transparent',
    name: '透明底贴纸',
    colors: ['#0f172a', 'transparent'],
    patch: { lineColor: '#0f172a', background: 'transparent', displayValue: true, margin: 12 },
  },
  {
    id: 'navy',
    name: '工业深蓝',
    colors: ['#1e3a8a', '#f8fafc'],
    patch: { lineColor: '#1e3a8a', background: '#f8fafc', displayValue: true, bold: true, margin: 18 },
  },
  {
    id: 'dark',
    name: '暗夜极客',
    colors: ['#f8fafc', '#0f172a'],
    patch: { lineColor: '#f8fafc', background: '#0f172a', displayValue: true, margin: 18 },
  },
]

export const LINE_COLOR_PRESETS = ['#111827', '#000000', '#1e3a8a', '#065f46', '#991b1b', '#f8fafc']
export const BG_COLOR_PRESETS = ['transparent', '#ffffff', '#f8fafc', '#fffbeb', '#f0fdf4', '#0f172a']

/** 计算 GS1 Modulo-10 校验位（适用于 EAN-13 / EAN-8 / UPC-A / ITF-14） */
export function computeGs1CheckDigit(digitsBody: string): string {
  let sum = 0
  // 从右向左（不含校验位），奇数位权重 3，偶数位权重 1
  for (let i = 0; i < digitsBody.length; i++) {
    const d = Number(digitsBody[digitsBody.length - 1 - i])
    sum += d * (i % 2 === 0 ? 3 : 1)
  }
  return String((10 - (sum % 10)) % 10)
}

export interface NormalizeCheckResult {
  /** 实际传给 JsBarcode 编码的值 */
  encodedValue: string
  /** 若自动补全了校验位，给出提示 */
  autoCompletedNote?: string
  /** 若校验位错误，提供一键修正值 */
  suggestedFix?: string
  /** 校验错误文案 */
  error?: string
}

/** 根据所选制式规范化输入并给出清晰中文错误提示 / 校验位修正建议 */
export function validateAndNormalizeBarcode(raw: string, format: BarcodeFormat): NormalizeCheckResult {
  const trimmed = raw.trim()
  if (!trimmed) return { encodedValue: '', error: '请输入条码内容' }

  const meta = BARCODE_FORMAT_MAP[format]

  // 1. GS1 定长数字制式（EAN-13 / EAN-8 / UPC-A / ITF-14）
  if (meta.gs1Lengths) {
    const { body, full } = meta.gs1Lengths
    if (!/^\d+$/.test(trimmed)) {
      return { encodedValue: trimmed, error: `${meta.label} 仅支持纯数字（${body} 或 ${full} 位）` }
    }
    if (trimmed.length === body) {
      const check = computeGs1CheckDigit(trimmed)
      const completed = trimmed + check
      return {
        encodedValue: completed,
        autoCompletedNote: `已自动补全第 ${full} 位校验码「${check}」→ ${completed}`,
      }
    }
    if (trimmed.length === full) {
      const expected = computeGs1CheckDigit(trimmed.slice(0, body))
      const actual = trimmed[body]
      if (expected !== actual) {
        const fixed = trimmed.slice(0, body) + expected
        return {
          encodedValue: trimmed,
          suggestedFix: fixed,
          error: `第 ${full} 位校验码错误：当前为「${actual}」，正确应为「${expected}」`,
        }
      }
      return { encodedValue: trimmed }
    }
    return {
      encodedValue: trimmed,
      error: `${meta.label} 需要 ${body} 位（自动补校验位）或 ${full} 位数字，当前为 ${trimmed.length} 位`,
    }
  }

  // 2. CODE 39 自动大写并校验字符集
  if (format === 'CODE39') {
    const upper = trimmed.toUpperCase()
    if (!/^[0-9A-Z\-. $/+%]+$/.test(upper)) {
      return {
        encodedValue: upper,
        error: 'CODE 39 仅支持大写字母 A-Z、数字 0-9 及 - . $ / + % 空格',
      }
    }
    return { encodedValue: upper }
  }

  // 3. 偶数位纯数字（CODE128C / ITF）
  if (format === 'CODE128C' || format === 'ITF') {
    if (!/^\d+$/.test(trimmed) || trimmed.length % 2 !== 0) {
      return { encodedValue: trimmed, error: `${meta.label} 需要偶数位纯数字（如 6 位、8 位、12 位）` }
    }
    return { encodedValue: trimmed }
  }

  // 4. MSI 纯数字
  if (format === 'MSI') {
    if (!/^\d+$/.test(trimmed)) {
      return { encodedValue: trimmed, error: 'MSI 仅支持纯数字' }
    }
    return { encodedValue: trimmed }
  }

  // 5. Pharmacode 3 ~ 131070
  if (format === 'pharmacode') {
    if (!/^\d+$/.test(trimmed)) return { encodedValue: trimmed, error: 'Pharmacode 仅支持整数（3 ~ 131070）' }
    const n = Number(trimmed)
    if (n < 3 || n > 131070) return { encodedValue: trimmed, error: 'Pharmacode 数值必须在 3 ~ 131070 之间' }
    return { encodedValue: trimmed }
  }

  // 6. Codabar
  if (format === 'codabar') {
    const upper = trimmed.toUpperCase()
    if (!/^[A-D]?[0-9\-$:/.+]+[A-D]?$/.test(upper)) {
      return { encodedValue: upper, error: 'Codabar 仅支持数字、- $ : / . +（首尾可选起止符 A-D）' }
    }
    return { encodedValue: upper }
  }

  // 7. CODE128 / CODE128B（标准 ASCII）
  if (!/^[\x20-\x7E]+$/.test(trimmed)) {
    return { encodedValue: trimmed, error: `${meta.label} 仅支持标准英文、数字与半角符号（不支持中文）` }
  }
  return { encodedValue: trimmed }
}

/** 按指定制式随机生成一个合法测试条码 */
export function generateRandomSample(format: BarcodeFormat): string {
  const randDigits = (len: number) =>
    Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join('')

  switch (format) {
    case 'EAN13': {
      const body = '690' + randDigits(9)
      return body + computeGs1CheckDigit(body)
    }
    case 'EAN8': {
      const body = '69' + randDigits(5)
      return body + computeGs1CheckDigit(body)
    }
    case 'UPC': {
      const body = '0' + randDigits(10)
      return body + computeGs1CheckDigit(body)
    }
    case 'ITF14': {
      const body = '1690' + randDigits(9)
      return body + computeGs1CheckDigit(body)
    }
    case 'CODE128C':
    case 'ITF':
      return randDigits(12)
    case 'MSI':
      return randDigits(8)
    case 'pharmacode':
      return String(Math.floor(100 + Math.random() * 90000))
    case 'codabar':
      return `A${randDigits(8)}B`
    case 'CODE39':
      return `SKU-${randDigits(6)}`
    case 'CODE128B':
      return `LiteBox_${randDigits(4)}`
    case 'CODE128':
    default:
      return `LB-${new Date().getFullYear()}-${randDigits(5)}`
  }
}

/** 解析 hex 评估对比度与静区可读性 */
function hexLuminance(hex: string): number | null {
  const clean = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null
  const [r, g, b] = [0, 2, 4].map((i) => {
    const s = parseInt(clean.slice(i, i + 2), 16) / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function evaluateBarcodeReadability(style: BarcodeStyleConfig): string[] {
  const warnings: string[] = []
  if (style.margin < 8) {
    warnings.push('四周留白（静区）小于 8px，部分红外扫码枪可能无法识别起止边缘')
  }
  if (style.background !== 'transparent') {
    const l1 = hexLuminance(style.lineColor)
    const l2 = hexLuminance(style.background)
    if (l1 !== null && l2 !== null) {
      const contrast = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
      if (contrast < 4) {
        warnings.push('条纹与背景对比度偏低，建议增强色差以保证扫码枪秒扫')
      } else if (l1 > l2) {
        warnings.push('当前为深底浅条（反色），实体激光扫码枪通常只支持浅底深条')
      }
    }
  }
  return warnings
}
