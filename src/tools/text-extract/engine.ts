/**
 * 正则提取与批量替换核心引擎
 * - 安全构造与执行正则（防零宽死循环、命中上限保护、精准语法报错）
 * - 支持捕获组 $1/$2/$&/$<name> 格式化、去重、多策略排序与 TXT/CSV/JSON 输出
 * - 支持多条替换规则流水线串联执行、每条规则独立命中统计与替换变动 Diff 高亮
 */

import type { ExtractOptions, OutputFormat, RegexFlags, ReplaceRule, SortMode } from './types'

/** 单次最大匹配数保护，避免极端文本或通配正则卡死主线程 */
const MAX_MATCHES = 50_000

/** 单条提取命中明细 */
export interface MatchItem {
  index: number
  /** 原文起始字符偏移 */
  start: number
  /** 原文结束字符偏移 */
  end: number
  /** 1-based 行号 */
  line: number
  /** 1-based 列号 */
  col: number
  /** 完整匹配原文 */
  raw: string
  /** 经捕获组模板格式化后的值 */
  value: string
  /** 编号捕获组列表 */
  groups: string[]
  /** 命名捕获组 */
  namedGroups?: Record<string, string>
}

export interface ExtractResult {
  error: string | null
  truncated: boolean
  /** 原文全部命中明细 */
  matches: MatchItem[]
  /** 经过去重、裁剪与排序后的最终列表 */
  values: string[]
  /** 按所选输出格式拼接后的最终字符串 */
  formattedText: string
}

/** 构造正则标志位字符串（始终包含 g 以便遍历全部匹配） */
export function buildFlagsString(flags: RegexFlags): string {
  return `g${flags.i ? 'i' : ''}${flags.m ? 'm' : ''}${flags.s ? 's' : ''}${flags.u ? 'u' : ''}`
}

/** 将正则字面字符转义（用于纯文本查找模式） */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 解析替换模板中的 \n、\r、\t、\\ 常用转义字符 */
export function unescapeCommon(str: string): string {
  return str.replace(/\\([nrt\\])/g, (_, ch: string) => {
    if (ch === 'n') return '\n'
    if (ch === 'r') return '\r'
    if (ch === 't') return '\t'
    return '\\'
  })
}

/** 计算每个换行符偏移，便于 O(log N) 查询任意偏移对应的行号与列号 */
function buildLineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1)
  }
  return starts
}

function offsetToLineCol(lineStarts: number[], offset: number): { line: number; col: number } {
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lineStarts[mid] <= offset) lo = mid + 1
    else hi = mid - 1
  }
  const idx = Math.max(0, hi)
  return { line: idx + 1, col: offset - lineStarts[idx] + 1 }
}

/** 使用捕获组模板格式化单次匹配结果（支持 $&、$1..$99、$<name>、$$、\n、\t） */
function formatMatchWithTemplate(match: RegExpExecArray, template: string): string {
  if (!template) return match[0]
  const unescaped = unescapeCommon(template)
  return unescaped.replace(/\$\$|\$&|\$<([^>]+)>|\$(\d{1,2})/g, (token, named: string | undefined, num: string | undefined) => {
    if (token === '$$') return '$'
    if (token === '$&') return match[0]
    if (named !== undefined) return match.groups?.[named] ?? ''
    if (num !== undefined) {
      const idx = Number(num)
      return match[idx] ?? ''
    }
    return token
  })
}

/** 按指定策略对提取结果排序 */
function sortValues(values: string[], mode: SortMode): string[] {
  if (mode === 'none') return values
  const copy = [...values]
  switch (mode) {
    case 'asc':
      return copy.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
    case 'desc':
      return copy.sort((a, b) => b.localeCompare(a, 'zh-CN', { numeric: true }))
    case 'length-asc':
      return copy.sort((a, b) => a.length - b.length || a.localeCompare(b))
    case 'length-desc':
      return copy.sort((a, b) => b.length - a.length || a.localeCompare(b))
    case 'numeric':
      return copy.sort((a, b) => {
        const na = Number(a.replace(/,/g, ''))
        const nb = Number(b.replace(/,/g, ''))
        const aValid = !Number.isNaN(na)
        const bValid = !Number.isNaN(nb)
        if (aValid && bValid) return na - nb
        if (aValid) return -1
        if (bValid) return 1
        return a.localeCompare(b)
      })
  }
}

/** 将提取列表按目标格式序列化 */
function formatValues(values: string[], format: OutputFormat): string {
  switch (format) {
    case 'newline':
      return values.join('\n')
    case 'comma':
      return values.join(', ')
    case 'semicolon':
      return values.join('; ')
    case 'tab':
      return values.join('\t')
    case 'json':
      return JSON.stringify(values, null, 2)
    case 'csv': {
      const escapeCsv = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
      return ['序号,提取结果', ...values.map((v, i) => `${i + 1},${escapeCsv(v)}`)].join('\n')
    }
  }
}

/** 执行正则提取 */
export function runExtraction(text: string, opts: ExtractOptions): ExtractResult {
  if (!opts.pattern) {
    return { error: null, truncated: false, matches: [], values: [], formattedText: '' }
  }

  let regex: RegExp
  try {
    regex = new RegExp(opts.pattern, buildFlagsString(opts.flags))
  } catch (err) {
    return {
      error: err instanceof Error ? `正则表达式语法有误：${err.message}` : '正则表达式语法有误',
      truncated: false,
      matches: [],
      values: [],
      formattedText: '',
    }
  }

  if (!text) {
    return { error: null, truncated: false, matches: [], values: [], formattedText: '' }
  }

  const lineStarts = buildLineStarts(text)
  const matches: MatchItem[] = []
  let truncated = false
  let m: RegExpExecArray | null

  while ((m = regex.exec(text)) !== null) {
    const raw = m[0]
    const start = m.index
    const end = start + raw.length
    const { line, col } = offsetToLineCol(lineStarts, start)

    let val = formatMatchWithTemplate(m, opts.template)
    if (opts.trimEach) val = val.trim()

    matches.push({
      index: matches.length + 1,
      start,
      end,
      line,
      col,
      raw,
      value: val,
      groups: m.slice(1).map((g) => g ?? ''),
      namedGroups: m.groups ? { ...m.groups } : undefined,
    })

    if (matches.length >= MAX_MATCHES) {
      truncated = true
      break
    }

    // 防止零宽匹配（如 ^、$、(?=...)）陷入死循环
    if (raw.length === 0) {
      regex.lastIndex += 1
      if (regex.lastIndex > text.length) break
    }
  }

  let values = matches.map((item) => item.value)
  if (opts.ignoreEmpty) {
    values = values.filter((v) => v.length > 0)
  }
  if (opts.dedupe) {
    const seen = new Set<string>()
    values = values.filter((v) => {
      if (seen.has(v)) return false
      seen.add(v)
      return true
    })
  }
  values = sortValues(values, opts.sort)

  return {
    error: null,
    truncated,
    matches,
    values,
    formattedText: formatValues(values, opts.format),
  }
}

/** 单条替换规则的执行统计 */
export interface RuleExecStat {
  ruleId: string
  count: number
  error: string | null
}

export interface ReplaceResult {
  output: string
  totalReplacements: number
  stats: RuleExecStat[]
  hasError: boolean
}

/** 按顺序流水线执行全部启用的批量替换规则 */
export function runBatchReplace(text: string, rules: ReplaceRule[]): ReplaceResult {
  let current = text
  let totalReplacements = 0
  let hasError = false
  const stats: RuleExecStat[] = []

  for (const rule of rules) {
    if (!rule.enabled || !rule.pattern) {
      stats.push({ ruleId: rule.id, count: 0, error: null })
      continue
    }

    let regex: RegExp
    try {
      const source = rule.isRegex ? rule.pattern : escapeRegExp(rule.pattern)
      const flags = `g${rule.ignoreCase ? 'i' : ''}${rule.multiline ? 'm' : ''}`
      regex = new RegExp(source, flags)
    } catch (err) {
      hasError = true
      stats.push({
        ruleId: rule.id,
        count: 0,
        error: err instanceof Error ? err.message : '正则语法错误',
      })
      continue
    }

    const rep = rule.unescapeReplacement ? unescapeCommon(rule.replacement) : rule.replacement
    let count = 0

    if (rule.isRegex) {
      current = current.replace(regex, (...args) => {
        count += 1
        // 复用原生 replace 的 $1/$&/$<name> 语义：在单次匹配片段上直接替换
        const matchStr = args[0] as string
        const singleFlags = `${rule.ignoreCase ? 'i' : ''}${rule.multiline ? 'm' : ''}`
        // 避免带前后瞻断言的正则在单片段失配，手动展开替换模板
        const groupsCount = args.length - 3
        const lastArg = args[args.length - 1]
        const namedGroups = typeof lastArg === 'object' && lastArg !== null ? (lastArg as Record<string, string>) : undefined
        const numGroupsLen = namedGroups ? groupsCount - 1 : groupsCount

        void singleFlags
        return rep.replace(/\$\$|\$&|\$<([^>]+)>|\$(\d{1,2})/g, (token, named?: string, num?: string) => {
          if (token === '$$') return '$'
          if (token === '$&') return matchStr
          if (named !== undefined) return namedGroups?.[named] ?? ''
          if (num !== undefined) {
            const idx = Number(num)
            if (idx >= 1 && idx <= numGroupsLen) return (args[idx] as string | undefined) ?? ''
            return ''
          }
          return token
        })
      })
    } else {
      current = current.replace(regex, () => {
        count += 1
        return rep
      })
    }

    totalReplacements += count
    stats.push({ ruleId: rule.id, count, error: null })
  }

  return {
    output: current,
    totalReplacements,
    stats,
    hasError,
  }
}

/** 轻量按行对比（用于批量替换结果页展示增删行高亮） */
export interface LineDiffRow {
  type: 'same' | 'del' | 'add'
  oldLine?: number
  newLine?: number
  text: string
}

/** 简单高效的行级 LCS Diff（超长文本自动降级避免卡顿） */
export function computeLineDiff(before: string, after: string, maxLines = 600): LineDiffRow[] | null {
  const a = before.split('\n')
  const b = after.split('\n')
  if (a.length > maxLines || b.length > maxLines) return null

  const n = a.length
  const m = b.length
  // dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const rows: LineDiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: 'same', oldLine: i + 1, newLine: j + 1, text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', oldLine: i + 1, text: a[i] })
      i++
    } else {
      rows.push({ type: 'add', newLine: j + 1, text: b[j] })
      j++
    }
  }
  while (i < n) {
    rows.push({ type: 'del', oldLine: i + 1, text: a[i] })
    i++
  }
  while (j < m) {
    rows.push({ type: 'add', newLine: j + 1, text: b[j] })
    j++
  }
  return rows
}
