/** 正则提取与批量替换：类型定义、常用提取预设、脱敏/清洗替换预设与示例文本 */

export type WorkMode = 'extract' | 'replace'
export type SortMode = 'none' | 'asc' | 'desc' | 'length-asc' | 'length-desc' | 'numeric'
export type OutputFormat = 'newline' | 'comma' | 'semicolon' | 'tab' | 'json' | 'csv'

export interface RegexFlags {
  i: boolean
  m: boolean
  s: boolean
  u: boolean
}

export interface ExtractPreset {
  id: string
  label: string
  desc: string
  pattern: string
  flags: Partial<RegexFlags>
  /** 可选默认输出模板（为空表示直接输出完整匹配 $&） */
  template?: string
}

/** 常用一键提取预设 */
export const EXTRACT_PRESETS: ExtractPreset[] = [
  {
    id: 'email',
    label: '电子邮箱',
    desc: '提取所有标准 Email 地址',
    pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',
    flags: { i: true },
  },
  {
    id: 'phone',
    label: '手机号',
    desc: '中国大陆 11 位手机号码',
    pattern: '(?<!\\d)1[3-9]\\d{9}(?!\\d)',
    flags: {},
  },
  {
    id: 'url',
    label: '网址 URL',
    desc: '提取 http / https 完整链接',
    pattern: 'https?:\\/\\/[\\w\\-]+(?:\\.[\\w\\-]+)+(?:[\\w.,@?^=%&:/~+#\\-]*[\\w@?^=%&/~+#\\-])?',
    flags: { i: true },
  },
  {
    id: 'ipv4',
    label: 'IPv4 地址',
    desc: '精准匹配 0.0.0.0 ~ 255.255.255.255',
    pattern: '\\b(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\b',
    flags: {},
  },
  {
    id: 'number',
    label: '数字 / 金额',
    desc: '整数、小数与负数（不含单位）',
    pattern: '-?\\d+(?:\\.\\d+)?',
    flags: {},
  },
  {
    id: 'idcard',
    label: '身份证号',
    desc: '18 位二代居民身份证号',
    pattern: '(?<!\\d)[1-9]\\d{5}(?:19|20)\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\d{3}[\\dXx](?!\\d)',
    flags: {},
  },
  {
    id: 'date',
    label: '日期',
    desc: '匹配 YYYY-MM-DD / YYYY/MM/DD / 中文日期',
    pattern: '(?:19|20)\\d{2}(?:[-/.年])(?:0?[1-9]|1[0-2])(?:[-/.月])(?:0?[1-9]|[12]\\d|3[01])日?',
    flags: {},
  },
  {
    id: 'domain',
    label: '域名',
    desc: '提取常见主域名与子域名',
    pattern: '(?<!@)\\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.)+[a-zA-Z]{2,}\\b',
    flags: { i: true },
  },
  {
    id: 'hex-color',
    label: 'HEX 色值',
    desc: '匹配 #RGB / #RRGGBB / #RRGGBBAA',
    pattern: '#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\\b',
    flags: {},
  },
  {
    id: 'chinese',
    label: '中文片段',
    desc: '提取连续汉字词句',
    pattern: '[\\u4e00-\\u9fa5]+',
    flags: {},
  },
]

/** 提取模式配置 */
export interface ExtractOptions {
  presetId: string
  pattern: string
  flags: RegexFlags
  /** 自定义输出模板（留空表示完整匹配，支持 $&、$1、$2、$<name>） */
  template: string
  dedupe: boolean
  trimEach: boolean
  ignoreEmpty: boolean
  sort: SortMode
  format: OutputFormat
}

export const defaultExtractOptions: ExtractOptions = {
  presetId: 'email',
  pattern: EXTRACT_PRESETS[0].pattern,
  flags: { i: true, m: true, s: false, u: false },
  template: '',
  dedupe: true,
  trimEach: true,
  ignoreEmpty: true,
  sort: 'none',
  format: 'newline',
}

/** 单条批量替换规则 */
export interface ReplaceRule {
  id: string
  name: string
  enabled: boolean
  /** true = 正则表达式，false = 纯字面文本 */
  isRegex: boolean
  pattern: string
  replacement: string
  ignoreCase: boolean
  multiline: boolean
  /** 是否解析替换内容中的 \n、\t、\\ 转义符 */
  unescapeReplacement: boolean
}

export interface ReplacePreset {
  label: string
  name: string
  isRegex: boolean
  pattern: string
  replacement: string
  ignoreCase?: boolean
  multiline?: boolean
}

/** 常用一键添加的批量替换规则预设 */
export const REPLACE_PRESETS: ReplacePreset[] = [
  {
    label: '手机号脱敏',
    name: '手机号中间 4 位脱敏',
    isRegex: true,
    pattern: '(?<!\\d)(1[3-9]\\d)\\d{4}(\\d{4})(?!\\d)',
    replacement: '$1****$2',
  },
  {
    label: '邮箱脱敏',
    name: '邮箱用户名脱敏',
    isRegex: true,
    pattern: '([a-zA-Z0-9._%+-]{1,2})[a-zA-Z0-9._%+-]*(@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})',
    replacement: '$1***$2',
    ignoreCase: true,
  },
  {
    label: '身份证脱敏',
    name: '身份证中间 8 位脱敏',
    isRegex: true,
    pattern: '(?<!\\d)([1-9]\\d{5})\\d{8}(\\d{3}[\\dXx])(?!\\d)',
    replacement: '$1********$2',
  },
  {
    label: '去除空行',
    name: '删除空白行',
    isRegex: true,
    pattern: '^\\s*[\\r\\n]+',
    replacement: '',
    multiline: true,
  },
  {
    label: '清理 HTML 标签',
    name: '剥离 HTML 标签保留纯文本',
    isRegex: true,
    pattern: '<\\/?[^>]+>',
    replacement: '',
  },
  {
    label: '合并多余空格',
    name: '连续空格/Tab 合并为单个空格',
    isRegex: true,
    pattern: '[ \\t]{2,}',
    replacement: ' ',
  },
  {
    label: '斜杠日期转横杠',
    name: 'YYYY/MM/DD 统一为 YYYY-MM-DD',
    isRegex: true,
    pattern: '\\b((?:19|20)\\d{2})\\/(\\d{1,2})\\/(\\d{1,2})\\b',
    replacement: '$1-$2-$3',
  },
]

/** 内置示例杂乱文本，方便一键体验所有预设 */
export const SAMPLE_MESSY_TEXT = `[2026-11-20 09:15:22] 工单 #A1024 客户：张伟，手机 13812345678，备用 18698765432
联系邮箱：zhang.wei@example.com / support@litebox.dev（重复 zhang.wei@example.com）
登录 IP：192.168.1.105，回调节点 10.24.0.88，异常来源 203.0.113.42
订单页面：https://shop.litebox.dev/order/9981?ref=app&lang=zh-CN
文档地址：http://docs.example.org/guide/regex-intro
实付金额：¥1299.50，优惠 -150.00，实收 1149.50，预约日期 2026/11/25（2026年12月01日回访）
主题配色：#6366f1、#0ea5e9、#f43f5e
证件核验：11010519900307651X  <span class="tag">已实名</span>`
