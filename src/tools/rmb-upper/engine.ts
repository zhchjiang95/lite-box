/**
 * 人民币金额大写转换与反向解析核心引擎
 * - 严格遵循中国人民银行《支付结算办法》与财政部《会计基础工作规范》
 * - 全程基于纯字符串与 BigInt 分位运算，最高支持 16 位整数（9999 万亿），彻底杜绝浮点精度误差
 */

export interface RmbOptions {
  /** 是否添加“人民币”前缀 */
  prefix: boolean
  /** 货币主单位：元（税务发票/银行通用）或 圆（传统支票） */
  yuanChar: '元' | '圆'
  /** 整字样式：整 或 正 */
  zhengChar: '整' | '正'
  /** 有角无分时是否在“角”后加“整/正”（银行与发票通常推荐开启） */
  zhengAfterJiao: boolean
  /** 金额以 10~19 开头时是否写“壹拾”（严格遵循防涂改规范，默认开启） */
  strictYiShi: boolean
}

export const defaultRmbOptions: RmbOptions = {
  prefix: true,
  yuanChar: '元',
  zhengChar: '整',
  zhengAfterJiao: true,
  strictYiShi: true,
}

const DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'] as const
const INNER_UNITS = ['', '拾', '佰', '仟'] as const
const SECTION_UNITS = ['', '万', '亿', '万亿'] as const

/** 支票 / 发票金额填写格位定义（从千亿到分，共 14 格） */
export const CHECK_COLUMNS = ['千', '百', '十', '亿', '千', '百', '十', '万', '千', '百', '十', '元', '角', '分'] as const

export interface RmbConvertResult {
  valid: boolean
  error?: string
  /** 清洗并四舍五入至分后的标准数字字符串（如 12345.67） */
  normalized: string
  /** 千分位格式化金额（如 ¥12,345.67） */
  formattedNumeric: string
  /** 最终财务大写结果 */
  upper: string
  /** 不含“人民币”前缀的纯大写 */
  upperPlain: string
  /** 是否发生了超过 2 位小数的四舍五入 */
  wasRounded: boolean
  /** 是否为负数（红字发票 / 退款） */
  isNegative: boolean
  /** 以“分”为单位的精确 BigInt（用于批量求和无误差） */
  cents: bigint
  /** 支票数位格填充数组（长度 14，与 CHECK_COLUMNS 一一对应） */
  checkCells: string[]
}

/**
 * 清洗用户输入并精确四舍五入到小数点后 2 位（纯字符串运算，无浮点误差）
 */
function parseAndRoundToCents(raw: string): {
  ok: true
  negative: boolean
  intStr: string
  jiao: number
  fen: number
  wasRounded: boolean
} | {
  ok: false
  error: string
} {
  // 去除货币符号、空白、千分位逗号、中文逗号与“元/块”后缀
  const cleaned = raw
    .trim()
    .replace(/[¥￥$,，\s_元圆块]/g, '')

  if (!cleaned) {
    return { ok: false, error: '请输入金额数字' }
  }

  const match = /^([+-])?(\d+)?(?:\.(\d*))?$/.exec(cleaned)
  if (!match || (!match[2] && !match[3])) {
    return { ok: false, error: '金额格式不正确，请输入有效阿拉伯数字（如 12345.67）' }
  }

  const negative = match[1] === '-'
  const rawInt = (match[2] ?? '0').replace(/^0+(?=\d)/, '') || '0'
  const rawDec = match[3] ?? ''

  if (rawInt.length > 16) {
    return { ok: false, error: '整数部分最多支持 16 位（最大 9999 万亿）' }
  }

  let intBig = BigInt(rawInt)
  let jiao = rawDec.length >= 1 ? Number(rawDec[0]) : 0
  let fen = rawDec.length >= 2 ? Number(rawDec[1]) : 0
  let wasRounded = false

  // 第 3 位小数起四舍五入
  if (rawDec.length > 2) {
    const third = Number(rawDec[2])
    const hasTrailingNonZero = /[1-9]/.test(rawDec.slice(2))
    wasRounded = hasTrailingNonZero
    if (third >= 5) {
      fen += 1
      if (fen >= 10) {
        fen = 0
        jiao += 1
        if (jiao >= 10) {
          jiao = 0
          intBig += 1n
        }
      }
    }
  }

  const intStr = intBig.toString()
  if (intStr.length > 16) {
    return { ok: false, error: '四舍五入后超出 16 位整数上限' }
  }

  const isZero = intBig === 0n && jiao === 0 && fen === 0
  return {
    ok: true,
    negative: negative && !isZero,
    intStr,
    jiao,
    fen,
    wasRounded,
  }
}

/** 转换 4 位以内的整数段（1 ~ 9999） */
function convertSection(secStr: string, isHighestSection: boolean, strictYiShi: boolean): string {
  const padded = secStr.padStart(4, '0')
  let result = ''
  let zeroPending = false

  for (let i = 0; i < 4; i++) {
    const digit = Number(padded[i])
    const unitIdx = 3 - i
    if (digit === 0) {
      if (result.length > 0) zeroPending = true
    } else {
      if (zeroPending) {
        result += '零'
        zeroPending = false
      }
      // 仅在非严格模式下省略段首“壹拾”中的“壹”
      if (!(digit === 1 && unitIdx === 1 && result.length === 0 && isHighestSection && !strictYiShi)) {
        result += DIGITS[digit]
      }
      result += INNER_UNITS[unitIdx]
    }
  }
  return result
}

/** 整数部分转财务大写（不含“元”） */
function integerToUpper(intStr: string, strictYiShi: boolean): string {
  if (intStr === '0') return ''

  // 从低位每 4 位切分
  const sections: string[] = []
  for (let end = intStr.length; end > 0; end -= 4) {
    sections.unshift(intStr.slice(Math.max(0, end - 4), end))
  }

  const totalSec = sections.length
  let out = ''
  let needZeroBeforeNext = false

  for (let i = 0; i < totalSec; i++) {
    const secStr = sections[i]
    const secVal = Number(secStr)
    const unit = SECTION_UNITS[totalSec - 1 - i]

    if (secVal === 0) {
      if (out.length > 0) needZeroBeforeNext = true
      continue
    }

    if (out.length > 0 && (needZeroBeforeNext || secVal < 1000)) {
      out += '零'
    }
    needZeroBeforeNext = false

    const isHighest = out.length === 0
    out += convertSection(secStr, isHighest, strictYiShi) + unit

    // 若本段以 0 结尾（如 10 万），与下一非零段衔接时需补“零”（如 107000 -> 壹拾万零柒仟）
    if (secVal % 10 === 0) {
      needZeroBeforeNext = true
    }
  }
  return out
}

/** 千分位格式化金额字符串 */
export function formatThousands(intStr: string, jiao: number, fen: number, negative: boolean): string {
  const withCommas = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}¥${withCommas}.${jiao}${fen}`
}

/** 构造 14 格支票/发票数位格（千亿 ~ 分，首位之前添“¥”） */
function buildCheckCells(intStr: string, jiao: number, fen: number): string[] {
  const cells = Array<string>(CHECK_COLUMNS.length).fill('')
  // 超过 12 位整数（千亿以上）超出常规支票格位，全部留空提示
  if (intStr.length > 12) return cells

  const fullDigits = `${intStr}${jiao}${fen}`
  const startIdx = CHECK_COLUMNS.length - fullDigits.length
  for (let i = 0; i < fullDigits.length; i++) {
    cells[startIdx + i] = fullDigits[i]
  }
  if (startIdx > 0) {
    cells[startIdx - 1] = '¥'
  }
  return cells
}

/** 主函数：阿拉伯数字金额 → 财务规范人民币大写 */
export function numberToRmbUpper(raw: string, opts: RmbOptions = defaultRmbOptions): RmbConvertResult {
  const parsed = parseAndRoundToCents(raw)
  if (!parsed.ok) {
    return {
      valid: false,
      error: parsed.error,
      normalized: '',
      formattedNumeric: '',
      upper: '',
      upperPlain: '',
      wasRounded: false,
      isNegative: false,
      cents: 0n,
      checkCells: Array<string>(CHECK_COLUMNS.length).fill(''),
    }
  }

  const { negative, intStr, jiao, fen, wasRounded } = parsed
  const intIsZero = intStr === '0'
  const decIsZero = jiao === 0 && fen === 0

  let body = ''
  if (intIsZero && decIsZero) {
    body = `零${opts.yuanChar}${opts.zhengChar}`
  } else {
    const intUpper = integerToUpper(intStr, opts.strictYiShi)
    if (!intIsZero) {
      body += `${intUpper}${opts.yuanChar}`
    }

    if (decIsZero) {
      body += opts.zhengChar
    } else if (jiao > 0 && fen === 0) {
      body += `${DIGITS[jiao]}角${opts.zhengAfterJiao ? opts.zhengChar : ''}`
    } else if (jiao === 0 && fen > 0) {
      body += `${intIsZero ? '' : '零'}${DIGITS[fen]}分`
    } else {
      body += `${DIGITS[jiao]}角${DIGITS[fen]}分`
    }
  }

  const upperPlain = `${negative ? '负' : ''}${body}`
  const upper = `${opts.prefix ? '人民币' : ''}${upperPlain}`
  const normalized = `${negative ? '-' : ''}${intStr}.${jiao}${fen}`
  const absCents = BigInt(intStr) * 100n + BigInt(jiao * 10 + fen)
  const cents = negative ? -absCents : absCents

  return {
    valid: true,
    normalized,
    formattedNumeric: formatThousands(intStr, jiao, fen, negative),
    upper,
    upperPlain,
    wasRounded,
    isNegative: negative,
    cents,
    checkCells: buildCheckCells(intStr, jiao, fen),
  }
}

/** BigInt 分位转标准小数字符串（用于批量求和） */
export function centsToDecimalString(cents: bigint): string {
  const neg = cents < 0n
  const abs = neg ? -cents : cents
  const yuan = abs / 100n
  const rem = Number(abs % 100n)
  const jiao = Math.floor(rem / 10)
  const fen = rem % 10
  return `${neg ? '-' : ''}${yuan.toString()}.${jiao}${fen}`
}

/** 反向解析结果：汉字大写金额 → 阿拉伯数字 */
export interface RmbReverseResult {
  valid: boolean
  error?: string
  numeric: string
  formattedNumeric: string
  /** 重新按严格财务规范格式化后的推荐大写，便于核对对方合同是否写规范 */
  canonicalUpper: string
  isCanonical: boolean
}

const CHAR_TO_DIGIT: Record<string, number> = {
  零: 0, 〇: 0,
  壹: 1, 一: 1,
  贰: 2, 貳: 2, 二: 2, 两: 2, 兩: 2,
  叁: 3, 參: 3, 三: 3,
  肆: 4, 四: 4,
  伍: 5, 五: 5,
  陆: 6, 陸: 6, 六: 6,
  柒: 7, 七: 7,
  捌: 8, 八: 8,
  玖: 9, 九: 9,
}

const CHAR_TO_SMALL_UNIT: Record<string, bigint> = {
  拾: 10n, 十: 10n,
  佰: 100n, 百: 100n,
  仟: 1000n, 千: 1000n,
}

/** 反向解析：将中文大写人民币金额转为精确阿拉伯数字，用于合同/发票核对 */
export function rmbUpperToNumber(raw: string, opts: RmbOptions = defaultRmbOptions): RmbReverseResult {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { valid: false, error: '请输入大写人民币金额', numeric: '', formattedNumeric: '', canonicalUpper: '', isCanonical: false }
  }

  let s = trimmed
    .replace(/\s+/g, '')
    .replace(/^人民币/, '')
    .replace(/[整正]+$/, '')

  let negative = false
  if (s.startsWith('负') || s.startsWith('負')) {
    negative = true
    s = s.slice(1)
  }

  if (!s) {
    return { valid: false, error: '无法识别有效金额内容', numeric: '', formattedNumeric: '', canonicalUpper: '', isCanonical: false }
  }

  // 拆分“元/圆”前后的整数与角分部分
  const yuanIdx = s.search(/[元圆圓]/)
  const intPartStr = yuanIdx >= 0 ? s.slice(0, yuanIdx) : s.search(/[角分]/) >= 0 ? '' : s
  const decPartStr = yuanIdx >= 0 ? s.slice(yuanIdx + 1) : s.search(/[角分]/) >= 0 ? s : ''

  // 1. 解析整数部分（支持万亿、亿、万层级）
  let totalYuan = 0n
  if (intPartStr) {
    // 先按“万亿”拆分
    const parseBelowWanYi = (chunk: string): bigint | null => {
      let acc = 0n
      let section = 0n
      let curDigit: bigint | null = null

      for (const ch of chunk) {
        if (ch in CHAR_TO_DIGIT) {
          const d = CHAR_TO_DIGIT[ch]
          if (d === 0) {
            curDigit = null
          } else {
            curDigit = BigInt(d)
          }
        } else if (ch in CHAR_TO_SMALL_UNIT) {
          const unit = CHAR_TO_SMALL_UNIT[ch]
          const factor = curDigit ?? 1n
          section += factor * unit
          curDigit = null
        } else if (ch === '万' || ch === '萬') {
          section += curDigit ?? 0n
          acc += (section === 0n ? 1n : section) * 10_000n
          section = 0n
          curDigit = null
        } else if (ch === '亿' || ch === '億') {
          section += curDigit ?? 0n
          acc += (section === 0n ? 1n : section) * 100_000_000n
          section = 0n
          curDigit = null
        } else {
          return null
        }
      }
      return acc + section + (curDigit ?? 0n)
    }

    const wyIdx = intPartStr.indexOf('万亿')
    if (wyIdx >= 0) {
      const high = parseBelowWanYi(intPartStr.slice(0, wyIdx))
      const low = parseBelowWanYi(intPartStr.slice(wyIdx + 2))
      if (high === null || low === null) {
        return { valid: false, error: '整数部分包含无法识别的字符', numeric: '', formattedNumeric: '', canonicalUpper: '', isCanonical: false }
      }
      totalYuan = high * 1_000_000_000_000n + low
    } else {
      const val = parseBelowWanYi(intPartStr)
      if (val === null) {
        return { valid: false, error: '整数部分包含无法识别的字符', numeric: '', formattedNumeric: '', canonicalUpper: '', isCanonical: false }
      }
      totalYuan = val
    }
  }

  // 2. 解析角、分部分
  let jiao = 0
  let fen = 0
  if (decPartStr) {
    let pendingDigit: number | null = null
    for (const ch of decPartStr) {
      if (ch in CHAR_TO_DIGIT) {
        const d = CHAR_TO_DIGIT[ch]
        pendingDigit = d === 0 ? null : d
      } else if (ch === '角') {
        if (pendingDigit === null) {
          return { valid: false, error: '“角”前缺少有效数字', numeric: '', formattedNumeric: '', canonicalUpper: '', isCanonical: false }
        }
        jiao = pendingDigit
        pendingDigit = null
      } else if (ch === '分') {
        if (pendingDigit === null) {
          return { valid: false, error: '“分”前缺少有效数字', numeric: '', formattedNumeric: '', canonicalUpper: '', isCanonical: false }
        }
        fen = pendingDigit
        pendingDigit = null
      } else {
        return { valid: false, error: `小数部分包含无法识别的字符「${ch}」`, numeric: '', formattedNumeric: '', canonicalUpper: '', isCanonical: false }
      }
    }
  }

  const isZero = totalYuan === 0n && jiao === 0 && fen === 0
  const neg = negative && !isZero
  const numeric = `${neg ? '-' : ''}${totalYuan.toString()}.${jiao}${fen}`
  const check = numberToRmbUpper(numeric, opts)

  if (!check.valid) {
    return { valid: false, error: check.error, numeric: '', formattedNumeric: '', canonicalUpper: '', isCanonical: false }
  }

  const normalizedInput = trimmed.replace(/\s+/g, '')
  const isCanonical = normalizedInput === check.upper || normalizedInput === check.upperPlain

  return {
    valid: true,
    numeric: check.normalized,
    formattedNumeric: check.formattedNumeric,
    canonicalUpper: check.upper,
    isCanonical,
  }
}

/** 财务大写汉字对照表（方便手写填单查字） */
export const UPPER_CHAR_TABLE: { num: string; upper: string; pinyin: string }[] = [
  { num: '0', upper: '零', pinyin: 'líng' },
  { num: '1', upper: '壹', pinyin: 'yī' },
  { num: '2', upper: '贰', pinyin: 'èr' },
  { num: '3', upper: '叁', pinyin: 'sān' },
  { num: '4', upper: '肆', pinyin: 'sì' },
  { num: '5', upper: '伍', pinyin: 'wǔ' },
  { num: '6', upper: '陆', pinyin: 'lù' },
  { num: '7', upper: '柒', pinyin: 'qī' },
  { num: '8', upper: '捌', pinyin: 'bā' },
  { num: '9', upper: '玖', pinyin: 'jiǔ' },
  { num: '十', upper: '拾', pinyin: 'shí' },
  { num: '百', upper: '佰', pinyin: 'bǎi' },
  { num: '千', upper: '仟', pinyin: 'qiān' },
  { num: '万', upper: '万', pinyin: 'wàn' },
  { num: '亿', upper: '亿', pinyin: 'yì' },
  { num: '元', upper: '元 / 圆', pinyin: 'yuán' },
]

/** 常用测试与演示金额快捷按钮 */
export const QUICK_AMOUNTS = [
  '12345.67',
  '100000',
  '107000.53',
  '16409.02',
  '325.04',
  '0.50',
  '100000000.00',
] as const
