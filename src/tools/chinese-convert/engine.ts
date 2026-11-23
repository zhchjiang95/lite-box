/**
 * 繁简转换与汉字拼音标注核心引擎
 * - OpenCC (opencc-js) 按需动态加载并缓存转换器实例，精准处理一简对多繁与两岸三地词汇差异
 * - pinyin-pro 提供精准分词注音、姓氏多音字模式、Ruby 注音卡片、首字母提取与声韵母拆解
 */

import { pinyin } from 'pinyin-pro'

export type ConvertMode = 'opencc' | 'pinyin'

export type OpenCcPresetId =
  | 'cn-to-t'
  | 'cn-to-tw'
  | 'cn-to-twp'
  | 'cn-to-hk'
  | 't-to-cn'
  | 'twp-to-cn'
  | 'hk-to-cn'

export interface OpenCcPreset {
  id: OpenCcPresetId
  label: string
  shortLabel: string
  desc: string
  from: string
  to: string
}

export const OPENCC_PRESETS: OpenCcPreset[] = [
  { id: 'cn-to-t', label: '简体 → 通用繁体', shortLabel: '简 → 繁', desc: 'OpenCC 标准繁体字形', from: 'cn', to: 't' },
  { id: 'cn-to-tw', label: '简体 → 台湾正体', shortLabel: '简 → 台繁', desc: '台湾标准正体字形', from: 'cn', to: 'tw' },
  {
    id: 'cn-to-twp',
    label: '简体 → 台湾正体 + 用语',
    shortLabel: '简 → 台(含词)',
    desc: '连带转换地域词汇（软件→軟體、服务器→伺服器）',
    from: 'cn',
    to: 'twp',
  },
  { id: 'cn-to-hk', label: '简体 → 香港繁体', shortLabel: '简 → 港繁', desc: '香港常用繁体字形', from: 'cn', to: 'hk' },
  { id: 't-to-cn', label: '通用繁体 → 大陆简体', shortLabel: '繁 → 简', desc: '标准繁体转大陆简体', from: 't', to: 'cn' },
  {
    id: 'twp-to-cn',
    label: '台湾正体 + 用语 → 简体',
    shortLabel: '台(含词) → 简',
    desc: '还原台湾词汇为大陆习惯用语（滑鼠→鼠标）',
    from: 'twp',
    to: 'cn',
  },
  { id: 'hk-to-cn', label: '香港繁体 → 大陆简体', shortLabel: '港繁 → 简', desc: '香港繁体转大陆简体', from: 'hk', to: 'cn' },
]

export type PinyinSubMode = 'full' | 'ruby' | 'initials' | 'detail'
export type ToneStyle = 'symbol' | 'num' | 'none'
export type LetterCase = 'lower' | 'capitalize' | 'upper'
export type SeparatorKind = 'space' | 'dash' | 'underscore' | 'none'

export interface PinyinOptions {
  subMode: PinyinSubMode
  toneType: ToneStyle
  letterCase: LetterCase
  separator: SeparatorKind
  surnameMode: boolean
  vForU: boolean
  keepNonChinese: boolean
}

export const defaultPinyinOptions: PinyinOptions = {
  subMode: 'full',
  toneType: 'symbol',
  letterCase: 'lower',
  separator: 'space',
  surnameMode: false,
  vForU: false,
  keepNonChinese: true,
}

export interface RubyToken {
  origin: string
  pinyin: string
  isHanzi: boolean
  isNewline: boolean
}

export interface CharDetailItem {
  char: string
  pinyin: string
  initial: string
  final: string
  toneNum: number
  polyphones: string[]
}

/** 缓存已初始化的 OpenCC 转换器，避免重复构建 Trie */
const converterCache = new Map<OpenCcPresetId, (text: string) => string>()

export async function runOpenCcConvert(text: string, presetId: OpenCcPresetId): Promise<string> {
  if (!text) return ''
  let fn = converterCache.get(presetId)
  if (!fn) {
    const preset = OPENCC_PRESETS.find((p) => p.id === presetId) ?? OPENCC_PRESETS[0]
    const OpenCC = await import('opencc-js')
    fn = OpenCC.Converter({ from: preset.from, to: preset.to })
    converterCache.set(presetId, fn)
  }
  return fn(text)
}

/** 对比简繁转换前后每个位置的变动字符数（同长度段落逐字标亮，词长变化时仍安全展示） */
export function buildChangedSegments(source: string, converted: string): {
  changedCount: number
  segments: { text: string; changed: boolean }[]
} {
  if (!converted) return { changedCount: 0, segments: [] }
  const srcChars = Array.from(source)
  const dstChars = Array.from(converted)

  // 当长度相等（绝大多数简繁转换）时逐字精确标红/标蓝
  if (srcChars.length === dstChars.length) {
    let changedCount = 0
    const segments: { text: string; changed: boolean }[] = []
    for (let i = 0; i < dstChars.length; i++) {
      const ch = dstChars[i]
      const changed = srcChars[i] !== ch
      if (changed) changedCount += 1
      const last = segments[segments.length - 1]
      if (last && last.changed === changed) last.text += ch
      else segments.push({ text: ch, changed })
    }
    return { changedCount, segments }
  }

  // 词汇长度发生增减（如地域用语替换）时粗略统计变化字符并整段展示
  const srcSet = new Map<string, number>()
  for (const c of srcChars) srcSet.set(c, (srcSet.get(c) ?? 0) + 1)
  let unchanged = 0
  for (const c of dstChars) {
    const left = srcSet.get(c) ?? 0
    if (left > 0) {
      unchanged += 1
      srcSet.set(c, left - 1)
    }
  }
  const changedCount = Math.max(Math.abs(srcChars.length - dstChars.length), dstChars.length - unchanged)
  return {
    changedCount,
    segments: [{ text: converted, changed: false }],
  }
}

function formatCase(str: string, letterCase: LetterCase): string {
  if (!str) return str
  if (letterCase === 'upper') return str.toUpperCase()
  if (letterCase === 'capitalize') return str.charAt(0).toUpperCase() + str.slice(1)
  return str.toLowerCase()
}

function getSepString(sep: SeparatorKind): string {
  if (sep === 'space') return ' '
  if (sep === 'dash') return '-'
  if (sep === 'underscore') return '_'
  return ''
}

const HANZI_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

/** 执行汉字转拼音（完整拼音 / 首字母），逐行保留原段落换行结构 */
export function convertToPinyinText(text: string, opts: PinyinOptions): string {
  if (!text) return ''
  const sep = getSepString(opts.separator)
  const lines = text.split('\n')

  return lines
    .map((line) => {
      if (!line.trim()) return ''
      const arr = pinyin(line, {
        type: 'all',
        toneType: opts.subMode === 'initials' ? 'none' : opts.toneType,
        mode: opts.surnameMode ? 'surname' : 'normal',
        v: opts.vForU,
        nonZh: 'consecutive',
      })

      const tokens: string[] = []
      for (const item of arr) {
        if (!item.isZh) {
          if (!opts.keepNonChinese) continue
          const raw = item.origin.trim()
          if (raw) tokens.push(raw)
          continue
        }
        const py = opts.subMode === 'initials' ? (item.first || item.pinyin.charAt(0)) : item.pinyin
        if (py) tokens.push(formatCase(py, opts.letterCase))
      }
      return tokens.join(sep)
    })
    .join('\n')
}

/** 生成语文课本式 Ruby 注音 Token 流 */
export function buildRubyTokens(text: string, opts: PinyinOptions): RubyToken[] {
  if (!text) return []
  const result: RubyToken[] = []
  const lines = text.split('\n')

  lines.forEach((line, lineIdx) => {
    const items = pinyin(line, {
      type: 'all',
      toneType: opts.toneType,
      mode: opts.surnameMode ? 'surname' : 'normal',
      v: opts.vForU,
    })
    for (const it of items) {
      result.push({
        origin: it.origin,
        pinyin: it.isZh ? formatCase(it.pinyin, opts.letterCase) : '',
        isHanzi: it.isZh,
        isNewline: false,
      })
    }
    if (lineIdx < lines.length - 1) {
      result.push({ origin: '\n', pinyin: '', isHanzi: false, isNewline: true })
    }
  })

  return result
}

/** 生成标准 HTML <ruby> 标签代码（方便嵌入网页或教学讲义） */
export function buildRubyHtmlSnippet(tokens: RubyToken[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return tokens
    .map((t) => {
      if (t.isNewline) return '<br />'
      if (!t.isHanzi) return esc(t.origin)
      return `<ruby>${esc(t.origin)}<rt>${esc(t.pinyin)}</rt></ruby>`
    })
    .join('')
}

/** 拆解文本中去重或前 120 个汉字的声母、韵母、声调与全部多音读法 */
export function buildCharDetailList(text: string, surnameMode: boolean): CharDetailItem[] {
  if (!text) return []
  const items = pinyin(text.slice(0, 600), {
    type: 'all',
    toneType: 'symbol',
    mode: surnameMode ? 'surname' : 'normal',
  })

  const out: CharDetailItem[] = []
  const seen = new Set<string>()

  for (const it of items) {
    if (!it.isZh || !HANZI_RE.test(it.origin)) continue
    const key = `${it.origin}:${it.pinyin}`
    if (seen.has(key)) continue
    seen.add(key)

    const allReads = pinyin(it.origin, { multiple: true, type: 'array', toneType: 'symbol' })
    const uniqueReads = Array.from(new Set(allReads))

    out.push({
      char: it.origin,
      pinyin: it.pinyin,
      initial: it.initial || '零声母',
      final: it.final || '—',
      toneNum: it.num,
      polyphones: uniqueReads,
    })
    if (out.length >= 80) break
  }
  return out
}

export const SAMPLE_TEXTS: { label: string; text: string }[] = [
  {
    label: '两岸用语测试',
    text: '在浏览器本地运行这款轻量化软件，无需上传文件到远程服务器，鼠标点击即可完成处理，保护内存与数据隐私。\n头发发白、发财致富、皇后与太后、干活与干净、面包与里面。',
  },
  {
    label: '古诗注音示例',
    text: '静夜思 · 李白\n床前明月光，疑是地上霜。\n举头望明月，低头思故乡。',
  },
  {
    label: '多音字与姓氏',
    text: '重庆银行的行长单先生、解女士与区老师一起参加音乐会，大家感到非常快乐。',
  },
]
