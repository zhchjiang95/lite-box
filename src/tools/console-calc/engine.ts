/**
 * 控制台计算器核心表达式解析与高精度求值引擎
 * - 100% 纯 TypeScript 递归下降解析器（零 eval / 零 new Function，安全且可精确定位错误）
 * - 十进制精确加减乘除 + 浮点尾噪自动消除（0.1 + 0.2 === 0.3）
 * - 支持：
 *   1. 常规算术（+ - * / ^ ** 阶乘! 括号、隐式乘法如 2pi / 3(4+5)）
 *   2. 智能百分比与取模：200 + 15% = 230、200 - 20% = 160、50% = 0.5；10 % 3 = 1
 *   3. 中文/英文数量级后缀：1.5万 / 1.5w / 2k / 3千 / 1.2亿 / 5m / 2b
 *   4. 变量赋值（含中文变量名，如 单价 = 199）与内置引用（ans / _ / #1 / $1）
 *   5. 程序员多进制字面量（0xFF / 0b1010 / 0o77）与位运算（& | << >> ~）
 *   6. 30+ 科学数学、统计、组合与进制函数，支持 DEG / RAD 角度切换与 30deg 后缀
 *   7. 类似 DevTools Console 的输入中容错预览（尾随未写完的运算符仍可柔和预览前段结果）
 */

export type AngleUnit = 'deg' | 'rad'

export interface EvalContext {
  /** 用户自定义变量表 */
  variables: Record<string, number>
  /** 历史记录数值列表（按时间正序，索引 0 对应 #1 / $1） */
  historyValues: number[]
  /** 最近一次有效计算结果（对应 ans / _） */
  lastAnswer?: number
  /** 三角函数角度模式 */
  angleUnit: AngleUnit
}

export interface EvalSuccess {
  ok: true
  value: number
  /** 若本次是赋值语句，返回被赋值的变量名 */
  assignedVar?: string
  /** 是否为输入未完成时的部分预览（例如末尾多了 + 或未闭合括号） */
  partial?: boolean
  /** 若使用了进制输出函数（hex/bin/oct），附带首选展示文本 */
  preferredDisplay?: string
  /** 若执行了内置命令 */
  command?: 'clear' | 'reset' | 'help'
}

export interface EvalFailure {
  ok: false
  error: string
  /** 当表达式为空或纯注释时为 true */
  empty?: boolean
}

export type EvalResult = EvalSuccess | EvalFailure

// ======================== 高精度十进制辅助运算 ========================

/** 将有限浮点数转成规范十进制字符串（展开科学计数法，避免 1e-7 干扰） */
function toPlainDecimalString(num: number): string {
  if (!Number.isFinite(num)) return String(num)
  const s = String(num)
  if (!/[eE]/.test(s)) return s
  const [mantissa, expStr] = s.split(/[eE]/)
  const exp = Number(expStr)
  const neg = mantissa.startsWith('-')
  const unsigned = neg ? mantissa.slice(1) : mantissa
  const [intPart, fracPart = ''] = unsigned.split('.')
  const digits = intPart + fracPart
  const decimalPos = intPart.length + exp
  let result: string
  if (decimalPos <= 0) {
    result = '0.' + '0'.repeat(-decimalPos) + digits
  } else if (decimalPos >= digits.length) {
    result = digits + '0'.repeat(decimalPos - digits.length)
  } else {
    result = digits.slice(0, decimalPos) + '.' + digits.slice(decimalPos)
  }
  return neg ? '-' + result : result
}

/** 清理双精度运算常见尾噪（如 0.30000000000000004 → 0.3，-0 → 0） */
export function cleanFloat(n: number): number {
  if (!Number.isFinite(n)) return n
  if (Object.is(n, -0) || Math.abs(n) === 0) return 0
  // 12 位有效数字足够覆盖日常与财务计算，同时消除 IEEE-754 末位毛刺
  const rounded = Number(n.toPrecision(13))
  if (Math.abs(n - rounded) <= Math.abs(n) * 1e-12) {
    return Object.is(rounded, -0) ? 0 : rounded
  }
  return n
}

/** 尝试用 BigInt 进行无误差十进制加减乘（超出安全规模自动退回 cleanFloat） */
function parseScaledBigInt(n: number): { int: bigint; scale: number } | null {
  if (!Number.isFinite(n)) return null
  const plain = toPlainDecimalString(n)
  if (plain.length > 28) return null
  const neg = plain.startsWith('-')
  const unsigned = neg ? plain.slice(1) : plain
  const [intPart, fracPart = ''] = unsigned.split('.')
  const trimmedFrac = fracPart.replace(/0+$/, '')
  const rawDigits = (intPart + trimmedFrac).replace(/^0+(?=\d)/, '') || '0'
  const val = BigInt(rawDigits)
  return { int: neg ? -val : val, scale: trimmedFrac.length }
}

function scaledBigIntToNumber(int: bigint, scale: number): number {
  if (scale <= 0) return Number(int)
  const neg = int < 0n
  const digits = (neg ? -int : int).toString()
  let str: string
  if (digits.length <= scale) {
    str = '0.' + '0'.repeat(scale - digits.length) + digits
  } else {
    const split = digits.length - scale
    str = digits.slice(0, split) + '.' + digits.slice(split)
  }
  return Number(neg ? '-' + str : str)
}

function exactAdd(a: number, b: number): number {
  const sa = parseScaledBigInt(a)
  const sb = parseScaledBigInt(b)
  if (!sa || !sb) return cleanFloat(a + b)
  const scale = Math.max(sa.scale, sb.scale)
  if (scale > 20) return cleanFloat(a + b)
  const va = sa.int * 10n ** BigInt(scale - sa.scale)
  const vb = sb.int * 10n ** BigInt(scale - sb.scale)
  return cleanFloat(scaledBigIntToNumber(va + vb, scale))
}

function exactSub(a: number, b: number): number {
  return exactAdd(a, -b)
}

function exactMul(a: number, b: number): number {
  const sa = parseScaledBigInt(a)
  const sb = parseScaledBigInt(b)
  if (!sa || !sb) return cleanFloat(a * b)
  const scale = sa.scale + sb.scale
  if (scale > 24) return cleanFloat(a * b)
  return cleanFloat(scaledBigIntToNumber(sa.int * sb.int, scale))
}

function exactDiv(a: number, b: number): number {
  if (b === 0) throw new Error('除数不能为 0')
  const sa = parseScaledBigInt(a)
  const sb = parseScaledBigInt(b)
  if (!sa || !sb || sb.int === 0n) return cleanFloat(a / b)
  // 放大相同倍数后做除法，消除 0.3 / 0.1 = 2.9999999999999996
  const scale = Math.max(sa.scale, sb.scale)
  if (scale <= 15) {
    const va = Number(sa.int * 10n ** BigInt(scale - sa.scale))
    const vb = Number(sb.int * 10n ** BigInt(scale - sb.scale))
    if (Number.isSafeInteger(va) && Number.isSafeInteger(vb)) {
      return cleanFloat(va / vb)
    }
  }
  return cleanFloat(a / b)
}

// ======================== 词法分析器 ========================

type TokenType =
  | 'NUMBER'
  | 'IDENT'
  | 'HIST_REF'
  | 'OP'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'PERCENT'
  | 'BANG'
  | 'ASSIGN'
  | 'EOF'

interface Token {
  type: TokenType
  value: string
  numValue?: number
  /** 若数字带角度后缀（如 30deg / 1rad），记录原单位 */
  angleSuffix?: AngleUnit
  pos: number
}

/** 数量级后缀映射 */
const UNIT_MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  K: 1e3,
  千: 1e3,
  w: 1e4,
  W: 1e4,
  万: 1e4,
  m: 1e6,
  M: 1e6,
  百万: 1e6,
  亿: 1e8,
  b: 1e9,
  B: 1e9,
}

/** 内置数学常量 */
export const MATH_CONSTANTS: Record<string, { value: number; desc: string }> = {
  pi: { value: Math.PI, desc: '圆周率 π ≈ 3.14159265' },
  π: { value: Math.PI, desc: '圆周率 π' },
  e: { value: Math.E, desc: '自然常数 e ≈ 2.71828182' },
  tau: { value: Math.PI * 2, desc: '2π ≈ 6.2831853' },
  phi: { value: (1 + Math.sqrt(5)) / 2, desc: '黄金比例 φ ≈ 1.61803398' },
}

/** 标准化全角字符、乘除号与移除行尾注释 */
export function normalizeExpression(raw: string): string {
  // 去掉 // 注释（注意避免误伤 http:// 等，但计算器中 // 即注释）
  let s = raw.replace(/\/\/.*$/, '')
  // 仅当 # 后面不是数字（即非 #1 历史引用）时，允许作行尾注释
  s = s.replace(/(?:^|\s)#(?!\d).*$/, '')
  return s
    .replace(/[＋]/g, '+')
    .replace(/[－—–]/g, '-')
    .replace(/[×✕✖＊]/g, '*')
    .replace(/[÷／]/g, '/')
    .replace(/[（【［]/g, '(')
    .replace(/[）】］]/g, ')')
    .replace(/[，、]/g, ',')
    .replace(/[＝]/g, '=')
    .replace(/[％]/g, '%')
    .replace(/[！]/g, '!')
    .replace(/[＾]/g, '^')
    .replace(/√\s*\(/g, 'sqrt(')
    .replace(/√(\d+(?:\.\d+)?)/g, 'sqrt($1)')
    .trim()
}

function isIdentStart(ch: string): boolean {
  return /[a-zA-Z_$\u4e00-\u9fa5π]/.test(ch)
}

function isIdentPart(ch: string): boolean {
  return /[a-zA-Z0-9_$\u4e00-\u9fa5π]/.test(ch)
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const len = input.length

  while (i < len) {
    const ch = input[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }

    const start = i

    // 历史引用：#1、#2 或 $1、$2
    if ((ch === '#' || ch === '$') && i + 1 < len && /\d/.test(input[i + 1])) {
      i++
      let digits = ''
      while (i < len && /\d/.test(input[i])) digits += input[i++]
      tokens.push({ type: 'HIST_REF', value: digits, pos: start })
      continue
    }

    // 数字字面量（支持 0x / 0b / 0o 进制、千分位逗号、小数、科学计数法、单位后缀、角度后缀）
    if (/\d/.test(ch) || (ch === '.' && i + 1 < len && /\d/.test(input[i + 1]))) {
      // 多进制整数：0x / 0b / 0o
      if (ch === '0' && i + 1 < len && /[xXbBoO]/.test(input[i + 1])) {
        const prefix = input[i + 1].toLowerCase()
        i += 2
        const validRegex = prefix === 'x' ? /[0-9a-fA-F_]/ : prefix === 'b' ? /[01_]/ : /[0-7_]/
        let body = ''
        while (i < len && validRegex.test(input[i])) body += input[i++]
        const cleanBody = body.replace(/_/g, '')
        if (!cleanBody) throw new Error(`位置 ${start + 1}：无效的进制数字`)
        const radix = prefix === 'x' ? 16 : prefix === 'b' ? 2 : 8
        const numVal = parseInt(cleanBody, radix)
        tokens.push({ type: 'NUMBER', value: input.slice(start, i), numValue: numVal, pos: start })
        continue
      }

      let rawNum = ''
      let hasDot = false
      while (i < len) {
        const c = input[i]
        if (/\d/.test(c)) {
          rawNum += c
          i++
        } else if (c === '.' && !hasDot) {
          hasDot = true
          rawNum += c
          i++
        } else if (c === '_' && /\d/.test(input[i + 1] ?? '')) {
          i++
        } else if (
          c === ',' &&
          !hasDot &&
          /^\d{3}(?!\d)/.test(input.slice(i + 1)) &&
          // 如果当前位于函数参数括号内，不吞掉逗号（保留为参数分隔符），除非前面刚读了数字且后面严格是 3 位数字且不在函数调用内
          !isInsideFunctionCall(tokens)
        ) {
          // 千分位逗号（如 12,345.67）
          i++
        } else {
          break
        }
      }

      // 科学计数法（如 1.2e5 / 3e-4）
      if (i < len && (input[i] === 'e' || input[i] === 'E')) {
        const next1 = input[i + 1]
        const next2 = input[i + 2]
        if (/\d/.test(next1 ?? '') || ((next1 === '+' || next1 === '-') && /\d/.test(next2 ?? ''))) {
          rawNum += input[i++]
          if (input[i] === '+' || input[i] === '-') rawNum += input[i++]
          while (i < len && /\d/.test(input[i])) rawNum += input[i++]
        }
      }

      let numVal = Number(rawNum)
      if (Number.isNaN(numVal)) throw new Error(`位置 ${start + 1}：无法解析数字 "${rawNum}"`)

      // 检查紧邻的角度后缀（deg / rad）
      let angleSuffix: AngleUnit | undefined
      const rest = input.slice(i)
      if (/^(deg|°)(?![a-zA-Z0-9_\u4e00-\u9fa5])/i.test(rest)) {
        const m = rest.match(/^(deg|°)/i)!
        angleSuffix = 'deg'
        i += m[0].length
      } else if (/^rad(?![a-zA-Z0-9_\u4e00-\u9fa5])/i.test(rest)) {
        angleSuffix = 'rad'
        i += 3
      } else {
        // 检查数量级单位后缀（百万、万、千、亿、k、w、m、b）
        const unitMatch = rest.match(/^(百万|[万千亿]|[kKwWmMbB])(?![a-zA-Z0-9_\u4e00-\u9fa5])/)
        if (unitMatch) {
          const mult = UNIT_MULTIPLIERS[unitMatch[1]]
          if (mult) {
            numVal = exactMul(numVal, mult)
            i += unitMatch[1].length
          }
        }
      }

      tokens.push({ type: 'NUMBER', value: input.slice(start, i), numValue: numVal, angleSuffix, pos: start })
      continue
    }

    // 标识符（变量名、函数名、关键字 mod/xor）
    if (isIdentStart(ch)) {
      let ident = ''
      while (i < len && isIdentPart(input[i])) ident += input[i++]
      const lower = ident.toLowerCase()
      if (lower === 'mod') {
        tokens.push({ type: 'OP', value: 'mod', pos: start })
      } else if (lower === 'xor') {
        tokens.push({ type: 'OP', value: 'xor', pos: start })
      } else {
        tokens.push({ type: 'IDENT', value: ident, pos: start })
      }
      continue
    }

    // 双字符运算符
    const two = input.slice(i, i + 2)
    if (two === '**' || two === '<<' || two === '>>') {
      tokens.push({ type: 'OP', value: two === '**' ? '^' : two, pos: start })
      i += 2
      continue
    }

    // 单字符符号
    switch (ch) {
      case '+':
      case '-':
      case '*':
      case '/':
      case '^':
      case '&':
      case '|':
      case '~':
        tokens.push({ type: 'OP', value: ch, pos: start })
        i++
        break
      case '(':
        tokens.push({ type: 'LPAREN', value: ch, pos: start })
        i++
        break
      case ')':
        tokens.push({ type: 'RPAREN', value: ch, pos: start })
        i++
        break
      case ',':
        tokens.push({ type: 'COMMA', value: ch, pos: start })
        i++
        break
      case '%':
        tokens.push({ type: 'PERCENT', value: ch, pos: start })
        i++
        break
      case '!':
        tokens.push({ type: 'BANG', value: ch, pos: start })
        i++
        break
      case '=':
        tokens.push({ type: 'ASSIGN', value: ch, pos: start })
        i++
        break
      default:
        throw new Error(`位置 ${start + 1}：无法识别的字符 "${ch}"`)
    }
  }

  tokens.push({ type: 'EOF', value: '', pos: len })
  return tokens
}

/** 判断当前词法位置是否处于函数调用括号内，避免把 max(1, 200) 的逗号当成千分位 */
function isInsideFunctionCall(tokens: Token[]): boolean {
  let depth = 0
  for (let idx = tokens.length - 1; idx >= 0; idx--) {
    const t = tokens[idx]
    if (t.type === 'RPAREN') depth++
    else if (t.type === 'LPAREN') {
      if (depth === 0) {
        return idx > 0 && tokens[idx - 1].type === 'IDENT'
      }
      depth--
    }
  }
  return false
}

// ======================== 内置数学与程序员函数库 ========================

export interface CalcFunctionMeta {
  name: string
  signature: string
  desc: string
  category: 'math' | 'trig' | 'stats' | 'prog'
  example: string
}

export const BUILTIN_FUNCTION_DOCS: CalcFunctionMeta[] = [
  { name: 'sqrt', signature: 'sqrt(x)', desc: '平方根', category: 'math', example: 'sqrt(144)' },
  { name: 'cbrt', signature: 'cbrt(x)', desc: '立方根', category: 'math', example: 'cbrt(27)' },
  { name: 'pow', signature: 'pow(x, y)', desc: '幂运算 x^y', category: 'math', example: 'pow(2, 10)' },
  { name: 'abs', signature: 'abs(x)', desc: '绝对值', category: 'math', example: 'abs(-42.5)' },
  { name: 'round', signature: 'round(x, d?)', desc: '四舍五入（可选小数位）', category: 'math', example: 'round(3.14159, 2)' },
  { name: 'floor', signature: 'floor(x)', desc: '向下取整', category: 'math', example: 'floor(9.9)' },
  { name: 'ceil', signature: 'ceil(x)', desc: '向上取整', category: 'math', example: 'ceil(9.1)' },
  { name: 'ln', signature: 'ln(x)', desc: '自然对数 logₑ', category: 'math', example: 'ln(e^3)' },
  { name: 'log', signature: 'log(x, base?)', desc: '常用对数（默认底 10）', category: 'math', example: 'log(1000)' },
  { name: 'log2', signature: 'log2(x)', desc: '以 2 为底对数', category: 'math', example: 'log2(1024)' },
  { name: 'exp', signature: 'exp(x)', desc: 'e 的 x 次幂', category: 'math', example: 'exp(2)' },
  { name: 'fact', signature: 'fact(n)', desc: '阶乘（同 n!）', category: 'math', example: 'fact(6)' },
  { name: 'sin', signature: 'sin(x)', desc: '正弦（遵循 DEG/RAD）', category: 'trig', example: 'sin(30)' },
  { name: 'cos', signature: 'cos(x)', desc: '余弦（遵循 DEG/RAD）', category: 'trig', example: 'cos(60)' },
  { name: 'tan', signature: 'tan(x)', desc: '正切（遵循 DEG/RAD）', category: 'trig', example: 'tan(45)' },
  { name: 'asin', signature: 'asin(x)', desc: '反正弦', category: 'trig', example: 'asin(0.5)' },
  { name: 'acos', signature: 'acos(x)', desc: '反余弦', category: 'trig', example: 'acos(0.5)' },
  { name: 'atan', signature: 'atan(x)', desc: '反正切', category: 'trig', example: 'atan(1)' },
  { name: 'sum', signature: 'sum(a, b, ...)', desc: '多值求和', category: 'stats', example: 'sum(12, 34, 56)' },
  { name: 'avg', signature: 'avg(a, b, ...)', desc: '平均值（别名 mean）', category: 'stats', example: 'avg(88, 92, 96)' },
  { name: 'median', signature: 'median(a, ...)', desc: '中位数', category: 'stats', example: 'median(10, 50, 20)' },
  { name: 'min', signature: 'min(a, b, ...)', desc: '最小值', category: 'stats', example: 'min(18, 9, 25)' },
  { name: 'max', signature: 'max(a, b, ...)', desc: '最大值', category: 'stats', example: 'max(18, 9, 25)' },
  { name: 'gcd', signature: 'gcd(a, b)', desc: '最大公约数', category: 'stats', example: 'gcd(48, 18)' },
  { name: 'lcm', signature: 'lcm(a, b)', desc: '最小公倍数', category: 'stats', example: 'lcm(12, 18)' },
  { name: 'ncr', signature: 'nCr(n, r)', desc: '组合数 C(n, r)', category: 'stats', example: 'nCr(10, 3)' },
  { name: 'npr', signature: 'nPr(n, r)', desc: '排列数 P(n, r)', category: 'stats', example: 'nPr(10, 3)' },
  { name: 'mod', signature: 'mod(a, b)', desc: '取余数', category: 'prog', example: 'mod(100, 7)' },
  { name: 'hex', signature: 'hex(n)', desc: '以十六进制展示', category: 'prog', example: 'hex(255)' },
  { name: 'bin', signature: 'bin(n)', desc: '以二进制展示', category: 'prog', example: 'bin(42)' },
  { name: 'oct', signature: 'oct(n)', desc: '以八进制展示', category: 'prog', example: 'oct(511)' },
  { name: 'clamp', signature: 'clamp(x, lo, hi)', desc: '区间限幅', category: 'prog', example: 'clamp(120, 0, 100)' },
]

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new Error('阶乘仅支持非负整数')
  if (n > 170) throw new Error('阶乘结果超出最大数值范围（最大支持 170!）')
  let acc = 1
  for (let i = 2; i <= n; i++) acc *= i
  return acc
}

function gcdTwo(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a))
  let y = Math.abs(Math.trunc(b))
  while (y !== 0) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

interface ParsedNumber {
  value: number
  isPercent?: boolean
  preferredDisplay?: string
}

// ======================== 递归下降解析器 ========================

class ExpressionParser {
  private pos = 0
  private tokens: Token[]
  private ctx: EvalContext
  public preferredDisplay?: string

  constructor(tokens: Token[], ctx: EvalContext) {
    this.tokens = tokens
    this.ctx = ctx
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]
  }

  private consume(): Token {
    return this.tokens[this.pos++]
  }

  private toRad(val: number, suffix?: AngleUnit): number {
    const unit = suffix ?? this.ctx.angleUnit
    return unit === 'deg' ? (val * Math.PI) / 180 : val
  }

  private fromRad(rad: number): number {
    return this.ctx.angleUnit === 'deg' ? cleanFloat((rad * 180) / Math.PI) : cleanFloat(rad)
  }

  public parseTop(): { value: number; assignedVar?: string } {
    // 赋值语句检测：IDENT = expr
    if (this.peek(0).type === 'IDENT' && this.peek(1).type === 'ASSIGN') {
      const varName = this.consume().value
      this.consume() // '='
      const lower = varName.toLowerCase()
      if (lower in MATH_CONSTANTS || lower === 'ans' || lower === '_') {
        throw new Error(`"${varName}" 是内置常量/关键字，不能重新赋值`)
      }
      const res = this.parseBitOr()
      if (this.peek().type !== 'EOF') {
        throw new Error(`多余的符号 "${this.peek().value}"`)
      }
      return { value: res.value, assignedVar: varName }
    }

    const res = this.parseBitOr()
    if (this.peek().type !== 'EOF') {
      throw new Error(`位置 ${this.peek().pos + 1} 存在无法解析的符号 "${this.peek().value}"`)
    }
    return { value: res.value }
  }

  /** 按位或 | 与 xor */
  private parseBitOr(): ParsedNumber {
    let left = this.parseBitAnd()
    while (this.peek().type === 'OP' && (this.peek().value === '|' || this.peek().value === 'xor')) {
      const op = this.consume().value
      const right = this.parseBitAnd()
      left = { value: op === '|' ? (left.value | right.value) : (left.value ^ right.value) }
    }
    return left
  }

  /** 按位与 & */
  private parseBitAnd(): ParsedNumber {
    let left = this.parseShift()
    while (this.peek().type === 'OP' && this.peek().value === '&') {
      this.consume()
      const right = this.parseShift()
      left = { value: left.value & right.value }
    }
    return left
  }

  /** 位移 << >> */
  private parseShift(): ParsedNumber {
    let left = this.parseAddSub()
    while (this.peek().type === 'OP' && (this.peek().value === '<<' || this.peek().value === '>>')) {
      const op = this.consume().value
      const right = this.parseAddSub()
      left = { value: op === '<<' ? (left.value << right.value) : (left.value >> right.value) }
    }
    return left
  }

  /** 加减（支持直觉百分比：200 + 15% = 230、200 - 20% = 160） */
  private parseAddSub(): ParsedNumber {
    let left = this.parseMulDiv()
    while (this.peek().type === 'OP' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.consume().value
      const right = this.parseMulDiv()
      if (right.isPercent) {
        const delta = exactMul(left.value, right.value)
        left = { value: op === '+' ? exactAdd(left.value, delta) : exactSub(left.value, delta) }
      } else {
        left = { value: op === '+' ? exactAdd(left.value, right.value) : exactSub(left.value, right.value) }
      }
    }
    return left
  }

  /** 乘除、取模与隐式乘法 */
  private parseMulDiv(): ParsedNumber {
    let left = this.parsePower()
    while (true) {
      const next = this.peek()

      // 显式 * / mod
      if (next.type === 'OP' && (next.value === '*' || next.value === '/' || next.value === 'mod')) {
        const op = this.consume().value
        const right = this.parsePower()
        if (op === '*') left = { value: exactMul(left.value, right.value) }
        else if (op === '/') left = { value: exactDiv(left.value, right.value) }
        else {
          if (right.value === 0) throw new Error('取模除数不能为 0')
          left = { value: cleanFloat(left.value % right.value) }
        }
        continue
      }

      // 智能 % 判定：仅当 % 后面紧跟着可以作为右操作数的 token 时，按取模处理（如 10 % 3）
      if (next.type === 'PERCENT' && this.canStartPrimary(this.peek(1))) {
        this.consume()
        const right = this.parsePower()
        if (right.value === 0) throw new Error('取模除数不能为 0')
        left = { value: cleanFloat(left.value % right.value) }
        continue
      }

      // 隐式乘法：例如 2pi、3(4+5)、(1+2)(3+4)、2sqrt(9)
      if (next.type === 'LPAREN' || next.type === 'IDENT' || next.type === 'HIST_REF') {
        const right = this.parsePower()
        left = { value: exactMul(left.value, right.value) }
        continue
      }

      break
    }
    return left
  }

  private canStartPrimary(t: Token): boolean {
    return (
      t.type === 'NUMBER' ||
      t.type === 'IDENT' ||
      t.type === 'HIST_REF' ||
      t.type === 'LPAREN' ||
      (t.type === 'OP' && (t.value === '+' || t.value === '-' || t.value === '~'))
    )
  }

  /** 幂运算（右结合：2^3^2 = 2^(3^2) = 512） */
  private parsePower(): ParsedNumber {
    const base = this.parseUnary()
    if (this.peek().type === 'OP' && this.peek().value === '^') {
      this.consume()
      const exp = this.parsePower()
      const val = Math.pow(base.value, exp.value)
      if (Number.isNaN(val)) throw new Error('无效的幂运算结果（如负数开偶次方）')
      return { value: cleanFloat(val) }
    }
    return base
  }

  /** 一元正负与按位取反 ~ */
  private parseUnary(): ParsedNumber {
    const t = this.peek()
    if (t.type === 'OP' && (t.value === '+' || t.value === '-' || t.value === '~')) {
      this.consume()
      const operand = this.parseUnary()
      if (t.value === '+') return operand
      if (t.value === '-') return { value: operand.value === 0 ? 0 : -operand.value, isPercent: operand.isPercent }
      return { value: ~operand.value }
    }
    return this.parsePostfix()
  }

  /** 后缀运算：阶乘 ! 与百分号 %（当其后不接右操作数时） */
  private parsePostfix(): ParsedNumber {
    let node = this.parsePrimary()
    while (true) {
      const next = this.peek()
      if (next.type === 'BANG') {
        this.consume()
        node = { value: factorial(node.value) }
      } else if (next.type === 'PERCENT' && !this.canStartPrimary(this.peek(1))) {
        this.consume()
        node = { value: exactDiv(node.value, 100), isPercent: true }
      } else {
        break
      }
    }
    return node
  }

  /** 基础原子：数字、括号、历史引用、变量、函数调用 */
  private parsePrimary(): ParsedNumber {
    const t = this.peek()

    if (t.type === 'NUMBER') {
      this.consume()
      return { value: t.numValue! }
    }

    if (t.type === 'HIST_REF') {
      this.consume()
      const idx = Number(t.value) - 1
      if (idx < 0 || idx >= this.ctx.historyValues.length) {
        throw new Error(`历史记录 #${t.value} 不存在（当前共 ${this.ctx.historyValues.length} 条）`)
      }
      return { value: this.ctx.historyValues[idx] }
    }

    if (t.type === 'LPAREN') {
      this.consume()
      const inner = this.parseBitOr()
      if (this.peek().type !== 'RPAREN') {
        throw new Error('缺少闭合右括号 ")"')
      }
      this.consume()
      return { value: inner.value }
    }

    if (t.type === 'IDENT') {
      this.consume()
      const name = t.value
      const lower = name.toLowerCase()

      // 函数调用：IDENT(...)
      if (this.peek().type === 'LPAREN') {
        return this.parseFunctionCall(name)
      }

      // 优先查找上次结果 ans / _
      if (lower === 'ans' || lower === '_') {
        if (this.ctx.lastAnswer === undefined) {
          throw new Error('暂无上一次计算结果，请先回车完成一条计算')
        }
        return { value: this.ctx.lastAnswer }
      }

      // 用户自定义变量（区分精确名或小写兜底）
      if (Object.prototype.hasOwnProperty.call(this.ctx.variables, name)) {
        return { value: this.ctx.variables[name] }
      }
      if (Object.prototype.hasOwnProperty.call(this.ctx.variables, lower)) {
        return { value: this.ctx.variables[lower] }
      }

      // 内置常量
      if (lower in MATH_CONSTANTS) {
        return { value: MATH_CONSTANTS[lower].value }
      }

      throw new Error(`未定义的变量或函数 "${name}"`)
    }

    throw new Error(t.type === 'EOF' ? '表达式不完整' : `位置 ${t.pos + 1}：意外的符号 "${t.value}"`)
  }

  /** 解析并执行函数调用 */
  private parseFunctionCall(rawName: string): ParsedNumber {
    this.consume() // '('
    const args: { value: number; angleSuffix?: AngleUnit }[] = []

    if (this.peek().type !== 'RPAREN') {
      while (true) {
        // 如果参数是单个带角度后缀的数字，保留其后缀信息
        const maybeNum = this.peek()
        const isSingleAngleNum =
          maybeNum.type === 'NUMBER' &&
          maybeNum.angleSuffix !== undefined &&
          (this.peek(1).type === 'COMMA' || this.peek(1).type === 'RPAREN')
        const val = this.parseBitOr().value
        args.push({ value: val, angleSuffix: isSingleAngleNum ? maybeNum.angleSuffix : undefined })
        if (this.peek().type === 'COMMA') {
          this.consume()
        } else {
          break
        }
      }
    }

    if (this.peek().type !== 'RPAREN') {
      throw new Error(`函数 ${rawName}(...) 缺少右括号 ")"`)
    }
    this.consume()

    const fn = rawName.toLowerCase()
    const requireArgs = (min: number, max = min) => {
      if (args.length < min || args.length > max) {
        throw new Error(
          min === max ? `${rawName}() 需要 ${min} 个参数` : `${rawName}() 需要 ${min}~${max} 个参数`,
        )
      }
    }

    const v0 = args[0]?.value
    const v1 = args[1]?.value

    switch (fn) {
      case 'sqrt':
        requireArgs(1)
        if (v0 < 0) throw new Error('sqrt() 不能对负数开平方')
        return { value: cleanFloat(Math.sqrt(v0)) }
      case 'cbrt':
        requireArgs(1)
        return { value: cleanFloat(Math.cbrt(v0)) }
      case 'abs':
        requireArgs(1)
        return { value: cleanFloat(Math.abs(v0)) }
      case 'floor':
        requireArgs(1)
        return { value: Math.floor(v0) }
      case 'ceil':
        requireArgs(1)
        return { value: Math.ceil(v0) }
      case 'trunc':
        requireArgs(1)
        return { value: Math.trunc(v0) }
      case 'round': {
        requireArgs(1, 2)
        const digits = args.length === 2 ? Math.trunc(v1) : 0
        const factor = Math.pow(10, digits)
        return { value: cleanFloat(Math.round(v0 * factor) / factor) }
      }
      case 'pow':
        requireArgs(2)
        return { value: cleanFloat(Math.pow(v0, v1)) }
      case 'exp':
        requireArgs(1)
        return { value: cleanFloat(Math.exp(v0)) }
      case 'ln':
        requireArgs(1)
        if (v0 <= 0) throw new Error('ln() 参数必须大于 0')
        return { value: cleanFloat(Math.log(v0)) }
      case 'log':
      case 'log10':
        requireArgs(1, 2)
        if (v0 <= 0) throw new Error('log() 参数必须大于 0')
        if (args.length === 2) {
          if (v1 <= 0 || v1 === 1) throw new Error('对数底数必须大于 0 且不等于 1')
          return { value: cleanFloat(Math.log(v0) / Math.log(v1)) }
        }
        return { value: cleanFloat(Math.log10(v0)) }
      case 'log2':
        requireArgs(1)
        if (v0 <= 0) throw new Error('log2() 参数必须大于 0')
        return { value: cleanFloat(Math.log2(v0)) }
      case 'sin':
        requireArgs(1)
        return { value: cleanFloat(Math.sin(this.toRad(v0, args[0].angleSuffix))) }
      case 'cos':
        requireArgs(1)
        return { value: cleanFloat(Math.cos(this.toRad(v0, args[0].angleSuffix))) }
      case 'tan':
        requireArgs(1)
        return { value: cleanFloat(Math.tan(this.toRad(v0, args[0].angleSuffix))) }
      case 'asin':
        requireArgs(1)
        if (v0 < -1 || v0 > 1) throw new Error('asin() 参数必须在 [-1, 1] 之间')
        return { value: this.fromRad(Math.asin(v0)) }
      case 'acos':
        requireArgs(1)
        if (v0 < -1 || v0 > 1) throw new Error('acos() 参数必须在 [-1, 1] 之间')
        return { value: this.fromRad(Math.acos(v0)) }
      case 'atan':
        requireArgs(1)
        return { value: this.fromRad(Math.atan(v0)) }
      case 'sinh':
        requireArgs(1)
        return { value: cleanFloat(Math.sinh(v0)) }
      case 'cosh':
        requireArgs(1)
        return { value: cleanFloat(Math.cosh(v0)) }
      case 'tanh':
        requireArgs(1)
        return { value: cleanFloat(Math.tanh(v0)) }
      case 'fact':
      case 'factorial':
        requireArgs(1)
        return { value: factorial(v0) }
      case 'mod':
        requireArgs(2)
        if (v1 === 0) throw new Error('mod() 除数不能为 0')
        return { value: cleanFloat(((v0 % v1) + v1) % v1) }
      case 'min':
        requireArgs(1, 999)
        return { value: Math.min(...args.map((a) => a.value)) }
      case 'max':
        requireArgs(1, 999)
        return { value: Math.max(...args.map((a) => a.value)) }
      case 'sum':
        requireArgs(1, 999)
        return { value: args.reduce((acc, a) => exactAdd(acc, a.value), 0) }
      case 'avg':
      case 'mean':
        requireArgs(1, 999)
        return { value: exactDiv(args.reduce((acc, a) => exactAdd(acc, a.value), 0), args.length) }
      case 'median': {
        requireArgs(1, 999)
        const sorted = args.map((a) => a.value).sort((a, b) => a - b)
        const mid = Math.floor(sorted.length / 2)
        return {
          value: sorted.length % 2 === 1 ? sorted[mid] : exactDiv(exactAdd(sorted[mid - 1], sorted[mid]), 2),
        }
      }
      case 'gcd':
        requireArgs(2, 999)
        return { value: args.slice(1).reduce((acc, a) => gcdTwo(acc, a.value), Math.abs(Math.trunc(v0))) }
      case 'lcm':
        requireArgs(2, 999)
        return {
          value: args.slice(1).reduce((acc, a) => {
            const g = gcdTwo(acc, a.value)
            return g === 0 ? 0 : Math.abs(Math.trunc((acc * Math.trunc(a.value)) / g))
          }, Math.abs(Math.trunc(v0))),
        }
      case 'ncr':
      case 'comb': {
        requireArgs(2)
        const n = Math.trunc(v0)
        const r = Math.trunc(v1)
        if (n < 0 || r < 0 || r > n) throw new Error('nCr(n, r) 需要满足 0 ≤ r ≤ n')
        const k = Math.min(r, n - r)
        let res = 1
        for (let i = 1; i <= k; i++) res = (res * (n - k + i)) / i
        return { value: Math.round(res) }
      }
      case 'npr':
      case 'perm': {
        requireArgs(2)
        const n = Math.trunc(v0)
        const r = Math.trunc(v1)
        if (n < 0 || r < 0 || r > n) throw new Error('nPr(n, r) 需要满足 0 ≤ r ≤ n')
        let res = 1
        for (let i = 0; i < r; i++) res *= n - i
        return { value: res }
      }
      case 'clamp': {
        requireArgs(3)
        const lo = Math.min(v1, args[2].value)
        const hi = Math.max(v1, args[2].value)
        return { value: Math.min(hi, Math.max(lo, v0)) }
      }
      case 'hex': {
        requireArgs(1)
        const iv = Math.trunc(v0)
        this.preferredDisplay = (iv < 0 ? '-0x' : '0x') + Math.abs(iv).toString(16).toUpperCase()
        return { value: iv }
      }
      case 'bin': {
        requireArgs(1)
        const iv = Math.trunc(v0)
        this.preferredDisplay = (iv < 0 ? '-0b' : '0b') + Math.abs(iv).toString(2)
        return { value: iv }
      }
      case 'oct': {
        requireArgs(1)
        const iv = Math.trunc(v0)
        this.preferredDisplay = (iv < 0 ? '-0o' : '0o') + Math.abs(iv).toString(8)
        return { value: iv }
      }
      case 'rand': {
        requireArgs(0, 2)
        if (args.length === 0) return { value: cleanFloat(Math.random()) }
        if (args.length === 1) return { value: cleanFloat(Math.random() * v0) }
        return { value: cleanFloat(v0 + Math.random() * (v1 - v0)) }
      }
      default:
        throw new Error(`未知函数 "${rawName}()"`)
    }
  }
}

// ======================== 对外统一求值入口 ========================

/**
 * 严格求值（用于按下回车提交计算或草稿纸逐行求值）
 */
export function evaluateExpression(rawInput: string, ctx: EvalContext): EvalResult {
  const normalized = normalizeExpression(rawInput)
  if (!normalized) return { ok: false, error: '', empty: true }

  // 内置控制台命令
  const cmd = normalized.toLowerCase()
  if (cmd === 'clear' || cmd === 'cls') return { ok: true, value: 0, command: 'clear' }
  if (cmd === 'reset') return { ok: true, value: 0, command: 'reset' }

  try {
    const tokens = tokenize(normalized)
    const parser = new ExpressionParser(tokens, ctx)
    const { value, assignedVar } = parser.parseTop()
    if (!Number.isFinite(value)) {
      return { ok: false, error: '结果超出数值范围（Infinity / NaN）' }
    }
    return {
      ok: true,
      value: cleanFloat(value),
      assignedVar,
      preferredDisplay: parser.preferredDisplay,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '表达式语法错误',
    }
  }
}

/**
 * 控制台实时预览求值（类似 Chrome DevTools Eager Evaluation）
 * 当用户正在输入中（如 "12 + 34 +" 或 "sqrt(16"），自动尝试温和补全并给出实时预览结果
 */
export function evaluatePreview(rawInput: string, ctx: EvalContext): EvalResult {
  const exact = evaluateExpression(rawInput, ctx)
  if (exact.ok || exact.empty) return exact

  // 尝试 1：去除末尾未输入完的二元运算符、逗号或赋值号（如 "12 + 34 *" → 预览 "12 + 34"）
  const normalized = normalizeExpression(rawInput)
  // 去掉末尾游离运算符、空白与逗号
  let trimmed = normalized.replace(/[+\-*/^&|,=\s]+$/g, '').trim()
  if (!trimmed) return exact

  // 自动补全未闭合括号
  const openCount = (trimmed.match(/\(/g) ?? []).length
  const closeCount = (trimmed.match(/\)/g) ?? []).length
  if (openCount > closeCount) {
    // 去掉刚打完函数名但还没填参数的尾巴（如 "10 + sqrt("）
    const withoutEmptyParen = trimmed
      .replace(/[a-zA-Z_$\u4e00-\u9fa5]*\(\s*$/, '')
      .replace(/[+\-*/^&|,=\s]+$/, '')
      .trim()
    if (withoutEmptyParen && withoutEmptyParen !== trimmed) {
      const retry = evaluateExpression(withoutEmptyParen, ctx)
      if (retry.ok) return { ...retry, partial: true }
    }
    trimmed = trimmed + ')'.repeat(openCount - closeCount)
  }

  if (trimmed !== normalized) {
    const retry = evaluateExpression(trimmed, ctx)
    if (retry.ok) {
      return { ...retry, partial: true }
    }
  }

  return exact
}

// ======================== 多维结果格式化与洞察 ========================

/** 将数字按设定精度与千分位开关格式化 */
export function formatResultValue(
  value: number,
  options?: { precision?: number | 'auto'; thousands?: boolean; preferredDisplay?: string },
): string {
  if (options?.preferredDisplay) return options.preferredDisplay
  if (!Number.isFinite(value)) return String(value)

  const precision = options?.precision ?? 'auto'
  const thousands = options?.thousands ?? true

  // 极大/极小数值使用科学计数法，防止页面撑爆
  if (value !== 0 && (Math.abs(value) >= 1e15 || Math.abs(value) < 1e-9)) {
    return value.toExponential(precision === 'auto' ? 6 : Math.min(10, precision))
  }

  let str: string
  if (precision === 'auto') {
    str = toPlainDecimalString(cleanFloat(value))
  } else {
    str = value.toFixed(precision)
  }

  if (!thousands) return str
  const neg = str.startsWith('-')
  const unsigned = neg ? str.slice(1) : str
  const [intPart, fracPart] = unsigned.split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return (neg ? '-' : '') + (fracPart !== undefined ? `${grouped}.${fracPart}` : grouped)
}

/** 转为简洁中文数量级读法（如 125000 → 约 12.5 万） */
export function formatChineseScale(value: number): string | null {
  const abs = Math.abs(value)
  if (!Number.isFinite(abs) || abs < 10000 || abs >= 1e16) return null
  const sign = value < 0 ? '-' : ''
  if (abs >= 1e8) {
    return `${sign}${cleanFloat(abs / 1e8)} 亿`
  }
  return `${sign}${cleanFloat(abs / 1e4)} 万`
}

/** 轻量人民币大写转换（供计算结果直接附带财务参考，支持最大万亿级） */
export function formatRmbUpperSimple(value: number): string | null {
  if (!Number.isFinite(value) || value < 0 || value >= 1e12) return null
  const rounded = Math.round(value * 100)
  if (rounded === 0) return '零元整'
  const digits = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
  const units = ['', '拾', '佰', '仟']
  const bigUnits = ['', '万', '亿']

  const intVal = Math.floor(rounded / 100)
  const jiao = Math.floor((rounded % 100) / 10)
  const fen = rounded % 10

  const convertSection = (sec: number): string => {
    let str = ''
    let zeroFlag = false
    for (let i = 0; i < 4; i++) {
      const d = Math.floor(sec / Math.pow(10, 3 - i)) % 10
      if (d === 0) {
        if (str) zeroFlag = true
      } else {
        if (zeroFlag) {
          str += '零'
          zeroFlag = false
        }
        str += digits[d] + units[3 - i]
      }
    }
    return str
  }

  let intStr = ''
  if (intVal > 0) {
    let temp = intVal
    let unitIdx = 0
    let needZero = false
    while (temp > 0) {
      const sec = temp % 10000
      if (sec > 0) {
        const secStr = convertSection(sec)
        intStr = secStr + bigUnits[unitIdx] + (needZero ? '零' : '') + intStr
        needZero = sec < 1000
      } else if (intStr) {
        needZero = true
      }
      temp = Math.floor(temp / 10000)
      unitIdx++
    }
    intStr += '元'
  }

  let fracStr = ''
  if (jiao === 0 && fen === 0) {
    fracStr = '整'
  } else {
    if (jiao > 0) fracStr += digits[jiao] + '角'
    else if (intStr) fracStr += '零'
    if (fen > 0) fracStr += digits[fen] + '分'
  }

  return intStr + fracStr
}

/** 整数多进制表示 */
export function formatRadices(value: number): { hex: string; bin: string; oct: string } | null {
  if (!Number.isInteger(value) || !Number.isSafeInteger(value) || Math.abs(value) > 0xffffffffffff) {
    return null
  }
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const binRaw = abs.toString(2)
  // 二进制每 4 位空格分组更易读
  const binGrouped = binRaw.replace(/\B(?=(\d{4})+(?!\d))/g, ' ')
  return {
    hex: `${sign}0x${abs.toString(16).toUpperCase()}`,
    bin: `${sign}0b${binGrouped}`,
    oct: `${sign}0o${abs.toString(8)}`,
  }
}

/** 草稿纸模式：逐行求值（跨行共享变量与 ans / #n 历史引用） */
export interface ScratchpadLineResult {
  lineNumber: number
  raw: string
  result: EvalResult
}

export function evaluateScratchpad(
  text: string,
  angleUnit: AngleUnit,
): { lines: ScratchpadLineResult[]; variables: Record<string, number>; totalSum: number; validCount: number } {
  const rawLines = text.split(/\r?\n/)
  const variables: Record<string, number> = {}
  const historyValues: number[] = []
  let lastAnswer: number | undefined
  let totalSum = 0
  let validCount = 0

  const lines: ScratchpadLineResult[] = rawLines.map((raw, idx) => {
    const res = evaluateExpression(raw, { variables, historyValues, lastAnswer, angleUnit })
    if (res.ok && !res.command) {
      if (res.assignedVar) {
        variables[res.assignedVar] = res.value
      }
      historyValues.push(res.value)
      lastAnswer = res.value
      // 仅对非纯变量声明行或所有有效数值行求和：这里统计所有有效结果行，方便对账
      if (!res.assignedVar) {
        totalSum = exactAdd(totalSum, res.value)
        validCount++
      }
    }
    return { lineNumber: idx + 1, raw, result: res }
  })

  return { lines, variables, totalSum, validCount }
}
