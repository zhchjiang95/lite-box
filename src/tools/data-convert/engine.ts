/**
 * JSON 与 TypeScript / Zod / YAML / TOML / CSV / TSV 双向互转核心引擎
 * - 解析支持：JSON、YAML (js-yaml)、TOML (smol-toml)、CSV / TSV (RFC 4180 状态机)
 * - 输出支持：TypeScript (合并异构数组推断可选属性与联合类型)、Zod Schema、JSON、YAML、TOML、CSV
 * - 额外支持：格式自动识别、嵌套对象展平/反展平、表格预览数据提取、按需轻量语法高亮
 */

import { load as loadYaml, dump as dumpYaml } from 'js-yaml'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import hljs from 'highlight.js/lib/core'
import langJson from 'highlight.js/lib/languages/json'
import langTs from 'highlight.js/lib/languages/typescript'
import langYaml from 'highlight.js/lib/languages/yaml'
import langIni from 'highlight.js/lib/languages/ini'

hljs.registerLanguage('json', langJson)
hljs.registerLanguage('typescript', langTs)
hljs.registerLanguage('yaml', langYaml)
hljs.registerLanguage('ini', langIni)

export type SourceFormat = 'json' | 'yaml' | 'toml' | 'csv' | 'tsv'
export type TargetFormat = 'typescript' | 'zod' | 'json' | 'yaml' | 'toml' | 'csv'

export interface ConvertOptions {
  /** TypeScript / Zod 根类型名称 */
  rootName: string
  /** TypeScript 使用 interface 还是 type */
  tsKind: 'interface' | 'type'
  /** 是否添加 export 前缀 */
  tsExport: boolean
  /** 是否添加 readonly 修饰 */
  tsReadonly: boolean
  /** 是否将全部字段标记为可选 */
  tsAllOptional: boolean
  /** JSON / YAML 缩进空格数（0 表示 JSON 压缩） */
  indent: 0 | 2 | 4
  /** JSON / YAML 是否按 Key 字母排序 */
  sortKeys: boolean
  /** CSV 分隔符 */
  csvDelimiter: ',' | ';' | '\t'
  /** CSV 解析时自动推断数字/布尔/null */
  csvInferTypes: boolean
  /** CSV 互转时自动按点号展平/反展平嵌套对象（如 user.name） */
  csvFlatten: boolean
}

export const DEFAULT_CONVERT_OPTIONS: ConvertOptions = {
  rootName: 'Root',
  tsKind: 'interface',
  tsExport: true,
  tsReadonly: false,
  tsAllOptional: false,
  indent: 2,
  sortKeys: false,
  csvDelimiter: ',',
  csvInferTypes: true,
  csvFlatten: true,
}

export interface ConvertResult {
  ok: true
  output: string
  parsedData: unknown
  notices: string[]
  stats: {
    lines: number
    bytes: number
    itemCount?: number
  }
}

export interface ConvertError {
  ok: false
  error: string
  empty?: boolean
}

export type ConvertResponse = ConvertResult | ConvertError

export const SOURCE_FORMATS: { id: SourceFormat; label: string; ext: string }[] = [
  { id: 'json', label: 'JSON', ext: '.json' },
  { id: 'yaml', label: 'YAML', ext: '.yaml' },
  { id: 'toml', label: 'TOML', ext: '.toml' },
  { id: 'csv', label: 'CSV', ext: '.csv' },
  { id: 'tsv', label: 'TSV', ext: '.tsv' },
]

export const TARGET_FORMATS: { id: TargetFormat; label: string; ext: string; mime: string }[] = [
  { id: 'typescript', label: 'TypeScript', ext: 'ts', mime: 'text/typescript;charset=utf-8' },
  { id: 'zod', label: 'Zod Schema', ext: 'ts', mime: 'text/typescript;charset=utf-8' },
  { id: 'json', label: 'JSON', ext: 'json', mime: 'application/json;charset=utf-8' },
  { id: 'yaml', label: 'YAML', ext: 'yaml', mime: 'text/yaml;charset=utf-8' },
  { id: 'toml', label: 'TOML', ext: 'toml', mime: 'text/plain;charset=utf-8' },
  { id: 'csv', label: 'CSV (Excel)', ext: 'csv', mime: 'text/csv;charset=utf-8' },
]

export const SAMPLE_INPUTS: Record<SourceFormat, string> = {
  json: JSON.stringify(
    {
      code: 0,
      message: 'ok',
      meta: {
        request_id: 'req_20261124_9a3f',
        cached: false,
        took_ms: 18,
      },
      users: [
        {
          id: 1001,
          name: '林深',
          role: 'admin',
          active: true,
          tags: ['frontend', 'design'],
          profile: { city: '杭州', level: 5 },
        },
        {
          id: 1002,
          name: '苏明',
          role: 'editor',
          active: false,
          nickname: 'Mingo',
          tags: ['docs'],
          profile: { city: '上海', level: 3, verified: true },
        },
      ],
    },
    null,
    2,
  ),
  yaml: [
    'app:',
    '  name: LiteBox',
    '  version: 2.1.0',
    '  offline: true',
    'server:',
    '  host: 0.0.0.0',
    '  port: 3000',
    '  compression:',
    '    - br',
    '    - gzip',
    'tools:',
    '  - id: data-convert',
    '    category: dev',
    '    enabled: true',
    '  - id: qrcode',
    '    category: generate',
    '    enabled: true',
    '    badge: new',
  ].join('\n'),
  toml: [
    'title = "LiteBox 配置清单"',
    'port = 3000',
    'debug = false',
    '',
    '[database]',
    'host = "127.0.0.1"',
    'ports = [5432, 5433]',
    'max_connections = 100',
    '',
    '[[plugins]]',
    'name = "speedtest"',
    'enabled = true',
    '',
    '[[plugins]]',
    'name = "sporttery"',
    'enabled = true',
    'cache_ttl = 300',
  ].join('\n'),
  csv: [
    'id,name,department,salary,active,contact.email',
    '101,张敏,研发部,28500,true,zhangmin@example.com',
    '102,王磊,产品部,24000,true,wanglei@example.com',
    '103,"陈思, 架构师",研发部,36000,false,chensi@example.com',
    '104,周悦,设计部,22000,true,zhouyue@example.com',
  ].join('\n'),
  tsv: [
    'sku\tname\tprice\tstock',
    'LB-001\t机械键盘\t499\t32',
    'LB-002\t人体工学鼠标\t299\t65',
    'LB-003\t4K 显示器\t2199\t12',
  ].join('\n'),
}

// ======================== 格式自动侦测 ========================

/** 根据文本特征自动猜测最可能的源数据格式 */
export function detectSourceFormat(raw: string): SourceFormat {
  const trimmed = raw.trim()
  if (!trimmed) return 'json'

  // 1. 尝试 JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed)
      return 'json'
    } catch {
      // 可能是不完整的 JSON，仍偏向 JSON 方便报精准语法错误
      return 'json'
    }
  }

  // 2. 检测 TOML 特征：[section] 或 key = value
  if (/^\s*\[{1,2}[A-Za-z0-9_.-]+\]{1,2}\s*$/m.test(trimmed) || /^\s*[A-Za-z0-9_-]+\s*=\s*.+$/m.test(trimmed)) {
    try {
      parseToml(trimmed)
      return 'toml'
    } catch {
      // 继续尝试其他格式
    }
  }

  // 3. 检测 TSV（首行有多个制表符且行结构一致）
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length >= 2 && lines[0].includes('\t') && lines[1].includes('\t')) {
    return 'tsv'
  }

  // 4. 检测 CSV（多行逗号分隔且非 YAML `key: value` 结构）
  if (
    lines.length >= 2 &&
    lines[0].includes(',') &&
    !/^\s*[\w-]+\s*:\s*/.test(lines[0]) &&
    !lines[0].trimStart().startsWith('- ')
  ) {
    return 'csv'
  }

  // 5. 默认尝试 YAML
  return 'yaml'
}

// ======================== RFC 4180 CSV / TSV 解析与序列化 ========================

/** 标准 RFC 4180 CSV/TSV 二维数组解析器 */
function parseDelimitedMatrix(input: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  // 去除可能存在的 UTF-8 BOM
  const text = input.startsWith('\uFEFF') ? input.slice(1) : input

  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
        } else {
          inQuotes = false
          i++
        }
      } else {
        field += ch
        i++
      }
    } else {
      if (ch === '"' && field === '') {
        inQuotes = true
        i++
      } else if (ch === delimiter) {
        row.push(field)
        field = ''
        i++
      } else if (ch === '\r' && text[i + 1] === '\n') {
        row.push(field)
        rows.push(row)
        row = []
        field = ''
        i += 2
      } else if (ch === '\n' || ch === '\r') {
        row.push(field)
        rows.push(row)
        row = []
        field = ''
        i++
      } else {
        field += ch
        i++
      }
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''))
}

/** 将单元格字符串按规则自动转为原生数值/布尔/null */
function inferCellValue(raw: string, inferTypes: boolean): unknown {
  if (!inferTypes) return raw
  const t = raw.trim()
  if (t === '') return ''
  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null') return null
  // 避免把带前导 0 的编号（如 00123）或超长订单号强转为 number 丢精度
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(t)) {
    const n = Number(t)
    if (Number.isFinite(n) && (t.includes('.') || Number.isSafeInteger(n))) {
      return n
    }
  }
  return raw
}

/** 按点号路径向嵌套对象赋值（防止 __proto__/constructor 污染） */
function setNestedPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.').filter(Boolean)
  if (parts.length <= 1) {
    target[path] = value
    return
  }
  let cur: Record<string, unknown> = target
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return
    if (typeof cur[key] !== 'object' || cur[key] === null || Array.isArray(cur[key])) {
      cur[key] = {}
    }
    cur = cur[key] as Record<string, unknown>
  }
  const leaf = parts[parts.length - 1]
  if (leaf !== '__proto__' && leaf !== 'constructor' && leaf !== 'prototype') {
    cur[leaf] = value
  }
}

/** 解析 CSV/TSV 为对象数组 */
function parseCsvToObjects(text: string, delimiter: string, inferTypes: boolean, unflatten: boolean): Record<string, unknown>[] {
  const matrix = parseDelimitedMatrix(text, delimiter)
  if (matrix.length === 0) return []
  const headers = matrix[0].map((h, i) => h.trim() || `col_${i + 1}`)
  const records: Record<string, unknown>[] = []

  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r]
    const obj: Record<string, unknown> = {}
    headers.forEach((header, idx) => {
      const val = inferCellValue(cells[idx] ?? '', inferTypes)
      if (unflatten && header.includes('.')) {
        setNestedPath(obj, header, val)
      } else {
        obj[header] = val
      }
    })
    records.push(obj)
  }
  return records
}

/** 递归将嵌套对象展平为 `a.b` 点号键值（用于导出扁平 CSV） */
function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      const nested = flattenObject(v as Record<string, unknown>, key)
      if (Object.keys(nested).length === 0) {
        out[key] = '{}'
      } else {
        Object.assign(out, nested)
      }
    } else {
      out[key] = v
    }
  }
  return out
}

/** 序列化任意 JSON 数据为 CSV */
function serializeToCsv(data: unknown, opts: ConvertOptions, notices: string[]): string {
  let list: unknown[]
  if (Array.isArray(data)) {
    list = data
  } else if (data !== null && typeof data === 'object') {
    // 若顶层对象恰好包含单个核心对象数组字段且用户希望转表，保留顶层单行同时提示
    list = [data]
    notices.push('输入为单个对象，已转换为 1 行 CSV 记录')
  } else {
    list = [{ value: data }]
  }

  if (list.length === 0) return ''

  const rows: Record<string, unknown>[] = list.map((item) => {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      return opts.csvFlatten
        ? flattenObject(item as Record<string, unknown>)
        : (item as Record<string, unknown>)
    }
    return { value: item }
  })

  // 收集全部列头（保留首次出现顺序）
  const headerSet = new Set<string>()
  for (const r of rows) {
    Object.keys(r).forEach((k) => headerSet.add(k))
  }
  const headers = Array.from(headerSet)
  const delim = opts.csvDelimiter

  const escapeCell = (val: unknown): string => {
    if (val === null || val === undefined) return ''
    const str =
      val instanceof Date
        ? val.toISOString()
        : typeof val === 'object'
          ? JSON.stringify(val)
          : String(val)
    if (str.includes(delim) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  return [
    headers.map(escapeCell).join(delim),
    ...rows.map((r) => headers.map((h) => escapeCell(r[h])).join(delim)),
  ].join('\n')
}

// ======================== 递归 Key 排序 & TOML 兼容清洗 ========================

function sortKeysDeep(val: unknown): unknown {
  if (Array.isArray(val)) return val.map(sortKeysDeep)
  if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(val as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((val as Record<string, unknown>)[key])
    }
    return out
  }
  return val
}

/** TOML 1.0 规范不支持 null / undefined，递归清理并统计跳过数量 */
function sanitizeForToml(val: unknown, counter: { stripped: number }): unknown {
  if (val === null || val === undefined) {
    counter.stripped++
    return undefined
  }
  if (Array.isArray(val)) {
    return val.map((item) => sanitizeForToml(item, counter)).filter((item) => item !== undefined)
  }
  if (typeof val === 'object' && !(val instanceof Date)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      const cleaned = sanitizeForToml(v, counter)
      if (cleaned !== undefined) out[k] = cleaned
    }
    return out
  }
  return val
}

// ======================== TypeScript & Zod AST 级类型推断引擎 ========================

type InferredType =
  | { kind: 'primitive'; name: 'string' | 'number' | 'boolean' | 'null' | 'unknown' }
  | { kind: 'array'; element: InferredType }
  | { kind: 'object'; fields: Map<string, { type: InferredType; optional: boolean }> }
  | { kind: 'union'; members: InferredType[] }

/** 合并两个推断类型（用于合并数组内异构对象、识别可选字段与联合类型） */
function mergeTypes(a: InferredType, b: InferredType): InferredType {
  if (a.kind === 'primitive' && b.kind === 'primitive' && a.name === b.name) return a
  if (a.kind === 'primitive' && a.name === 'unknown') return b
  if (b.kind === 'primitive' && b.name === 'unknown') return a

  if (a.kind === 'array' && b.kind === 'array') {
    return { kind: 'array', element: mergeTypes(a.element, b.element) }
  }

  if (a.kind === 'object' && b.kind === 'object') {
    const merged = new Map<string, { type: InferredType; optional: boolean }>()
    const allKeys = new Set([...a.fields.keys(), ...b.fields.keys()])
    for (const k of allKeys) {
      const fa = a.fields.get(k)
      const fb = b.fields.get(k)
      if (fa && fb) {
        merged.set(k, { type: mergeTypes(fa.type, fb.type), optional: fa.optional || fb.optional })
      } else if (fa) {
        merged.set(k, { type: fa.type, optional: true })
      } else if (fb) {
        merged.set(k, { type: fb.type, optional: true })
      }
    }
    return { kind: 'object', fields: merged }
  }

  // 展平并去重联合类型成员
  const rawMembers = [
    ...(a.kind === 'union' ? a.members : [a]),
    ...(b.kind === 'union' ? b.members : [b]),
  ]
  const deduped: InferredType[] = []
  for (const m of rawMembers) {
    if (m.kind === 'object') {
      const idx = deduped.findIndex((x) => x.kind === 'object')
      if (idx >= 0) {
        deduped[idx] = mergeTypes(deduped[idx], m)
        continue
      }
    }
    if (m.kind === 'array') {
      const idx = deduped.findIndex((x) => x.kind === 'array')
      if (idx >= 0) {
        deduped[idx] = mergeTypes(deduped[idx], m)
        continue
      }
    }
    if (m.kind === 'primitive' && deduped.some((x) => x.kind === 'primitive' && x.name === m.name)) {
      continue
    }
    deduped.push(m)
  }

  return deduped.length === 1 ? deduped[0] : { kind: 'union', members: deduped }
}

function inferType(value: unknown): InferredType {
  if (value === null || value === undefined) return { kind: 'primitive', name: 'null' }
  if (typeof value === 'string' || value instanceof Date) return { kind: 'primitive', name: 'string' }
  if (typeof value === 'number') return { kind: 'primitive', name: 'number' }
  if (typeof value === 'boolean') return { kind: 'primitive', name: 'boolean' }
  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: 'array', element: { kind: 'primitive', name: 'unknown' } }
    let elem = inferType(value[0])
    for (let i = 1; i < value.length; i++) {
      elem = mergeTypes(elem, inferType(value[i]))
    }
    return { kind: 'array', element: elem }
  }
  if (typeof value === 'object') {
    const fields = new Map<string, { type: InferredType; optional: boolean }>()
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      fields.set(k, { type: inferType(v), optional: false })
    }
    return { kind: 'object', fields }
  }
  return { kind: 'primitive', name: 'unknown' }
}

/** 转为合法的 PascalCase 类型名（并对常见英文复数做轻度单数化） */
function toPascalName(raw: string, singularize = false): string {
  const parts = raw
    .replace(/[^a-zA-Z0-9_\-\s]/g, ' ')
    .split(/[_\-\s]+/)
    .filter(Boolean)
  if (!parts.length) return 'Item'
  let name = parts.map((p) => p[0].toUpperCase() + p.slice(1)).join('')
  if (/^\d/.test(name)) name = `T${name}`
  if (singularize && name.length > 3) {
    if (name.endsWith('ies')) name = name.slice(0, -3) + 'y'
    else if (name.endsWith('s') && !name.endsWith('ss')) name = name.slice(0, -1)
  }
  return name
}

function formatTsKey(key: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `'${key.replace(/'/g, "\\'")}'`
}

/** 生成整洁的分层 TypeScript 接口 / 类型代码 */
function generateTypeScript(data: unknown, opts: ConvertOptions): string {
  const rootName = toPascalName(opts.rootName || 'Root')
  const exp = opts.tsExport ? 'export ' : ''
  const ro = opts.tsReadonly ? 'readonly ' : ''
  const usedNames = new Set<string>()
  const declarations: string[] = []

  const allocName = (preferred: string): string => {
    let candidate = preferred
    let idx = 2
    while (usedNames.has(candidate)) {
      candidate = `${preferred}${idx++}`
    }
    usedNames.add(candidate)
    return candidate
  }

  const emitTypeExpr = (node: InferredType, hintName: string, isArrayItem = false): string => {
    switch (node.kind) {
      case 'primitive':
        return node.name
      case 'array': {
        const inner = emitTypeExpr(node.element, toPascalName(hintName, true), true)
        return inner.includes('|') ? `(${inner})[]` : `${inner}[]`
      }
      case 'union':
        return node.members.map((m) => emitTypeExpr(m, hintName, isArrayItem)).join(' | ')
      case 'object': {
        if (node.fields.size === 0) return 'Record<string, unknown>'
        const typeName = allocName(toPascalName(hintName, isArrayItem))
        emitObjectDecl(typeName, node)
        return typeName
      }
    }
  }

  const emitObjectDecl = (name: string, node: Extract<InferredType, { kind: 'object' }>) => {
    const lines: string[] = []
    for (const [key, field] of node.fields.entries()) {
      const optMark = opts.tsAllOptional || field.optional ? '?' : ''
      const fieldExpr = emitTypeExpr(field.type, key, false)
      lines.push(`  ${ro}${formatTsKey(key)}${optMark}: ${fieldExpr};`)
    }
    if (opts.tsKind === 'interface') {
      declarations.push(`${exp}interface ${name} {\n${lines.join('\n')}\n}`)
    } else {
      declarations.push(`${exp}type ${name} = {\n${lines.join('\n')}\n};`)
    }
  }

  const rootType = inferType(data)
  if (rootType.kind === 'object') {
    const name = allocName(rootName)
    emitObjectDecl(name, rootType)
  } else {
    const expr = emitTypeExpr(rootType, `${rootName}Item`, rootType.kind === 'array')
    declarations.push(`${exp}type ${allocName(rootName)} = ${expr};`)
  }

  // 把根类型放在最前面，子类型紧随其后，阅读最直观
  const rootDecl = declarations.pop()
  return rootDecl ? [rootDecl, ...declarations].join('\n\n') : ''
}

/** 生成标准 Zod Schema 校验代码 */
function generateZodSchema(data: unknown, opts: ConvertOptions): string {
  const rootName = toPascalName(opts.rootName || 'Root')
  const schemaName = `${rootName}Schema`
  const exp = opts.tsExport ? 'export ' : ''

  const renderZod = (node: InferredType, depth: number): string => {
    const pad = '  '.repeat(depth)
    const innerPad = '  '.repeat(depth + 1)
    switch (node.kind) {
      case 'primitive':
        if (node.name === 'null') return 'z.null()'
        if (node.name === 'unknown') return 'z.unknown()'
        return `z.${node.name}()`
      case 'array':
        return `z.array(${renderZod(node.element, depth)})`
      case 'union': {
        const nonNull = node.members.filter((m) => !(m.kind === 'primitive' && m.name === 'null'))
        const hasNull = nonNull.length !== node.members.length
        if (nonNull.length === 1 && hasNull) {
          return `${renderZod(nonNull[0], depth)}.nullable()`
        }
        const parts = node.members.map((m) => renderZod(m, depth))
        return `z.union([${parts.join(', ')}])`
      }
      case 'object': {
        if (node.fields.size === 0) return 'z.record(z.string(), z.unknown())'
        const entries: string[] = []
        for (const [k, field] of node.fields.entries()) {
          const expr = renderZod(field.type, depth + 1)
          const suffix = opts.tsAllOptional || field.optional ? '.optional()' : ''
          entries.push(`${innerPad}${formatTsKey(k)}: ${expr}${suffix},`)
        }
        return `z.object({\n${entries.join('\n')}\n${pad}})`
      }
    }
  }

  const rootType = inferType(data)
  return [
    `import { z } from 'zod';`,
    '',
    `${exp}const ${schemaName} = ${renderZod(rootType, 0)};`,
    '',
    `${exp}type ${rootName} = z.infer<typeof ${schemaName}>;`,
  ].join('\n')
}

// ======================== 统一转换主入口 ========================

export function convertData(
  rawInput: string,
  sourceFormat: SourceFormat,
  targetFormat: TargetFormat,
  opts: ConvertOptions,
): ConvertResponse {
  if (!rawInput.trim()) {
    return { ok: false, error: '', empty: true }
  }

  const notices: string[] = []
  let parsed: unknown

  // 1. 解析源格式
  try {
    switch (sourceFormat) {
      case 'json':
        parsed = JSON.parse(rawInput)
        break
      case 'yaml':
        parsed = loadYaml(rawInput)
        if (parsed === undefined) throw new Error('YAML 内容为空')
        break
      case 'toml':
        parsed = parseToml(rawInput)
        break
      case 'csv':
        parsed = parseCsvToObjects(rawInput, opts.csvDelimiter, opts.csvInferTypes, opts.csvFlatten)
        break
      case 'tsv':
        parsed = parseCsvToObjects(rawInput, '\t', opts.csvInferTypes, opts.csvFlatten)
        break
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '语法解析失败'
    return { ok: false, error: `${sourceFormat.toUpperCase()} 解析失败：${msg}` }
  }

  // 2. 序列化为目标格式
  try {
    const normalized = opts.sortKeys && (targetFormat === 'json' || targetFormat === 'yaml') ? sortKeysDeep(parsed) : parsed
    let output = ''

    switch (targetFormat) {
      case 'json':
        output = JSON.stringify(normalized, null, opts.indent === 0 ? undefined : opts.indent)
        break
      case 'yaml':
        output = dumpYaml(normalized, {
          indent: opts.indent === 0 ? 2 : opts.indent,
          lineWidth: -1,
          noRefs: true,
        }).trimEnd()
        break
      case 'toml': {
        const counter = { stripped: 0 }
        let rootObj: Record<string, unknown>
        if (Array.isArray(parsed)) {
          rootObj = { items: sanitizeForToml(parsed, counter) }
          notices.push('TOML 根节点必须为表对象，已自动将顶层数组包装在 items = [...] 下')
        } else if (parsed !== null && typeof parsed === 'object') {
          rootObj = sanitizeForToml(parsed, counter) as Record<string, unknown>
        } else {
          rootObj = { value: sanitizeForToml(parsed, counter) }
          notices.push('TOML 根节点必须为表对象，已自动包装在 value 键下')
        }
        if (counter.stripped > 0) {
          notices.push(`TOML 规范不支持 null，已自动省略 ${counter.stripped} 个空值字段`)
        }
        output = stringifyToml(rootObj).trimEnd()
        break
      }
      case 'csv':
        output = serializeToCsv(parsed, opts, notices)
        break
      case 'typescript':
        output = generateTypeScript(parsed, opts)
        break
      case 'zod':
        output = generateZodSchema(parsed, opts)
        break
    }

    return {
      ok: true,
      output,
      parsedData: parsed,
      notices,
      stats: {
        lines: output ? output.split('\n').length : 0,
        bytes: new Blob([output]).size,
        itemCount: Array.isArray(parsed)
          ? parsed.length
          : parsed !== null && typeof parsed === 'object'
            ? Object.keys(parsed as Record<string, unknown>).length
            : undefined,
      },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '目标格式生成失败'
    return { ok: false, error: `转换为 ${targetFormat.toUpperCase()} 失败：${msg}` }
  }
}

/** 提取二维表格预览数据（当解析结果是对象数组，或顶层包含对象数组时自动展示） */
export function extractTablePreview(data: unknown): { headers: string[]; rows: string[][]; label: string } | null {
  let records: unknown[] | null = null
  let label = '顶层数组'

  if (Array.isArray(data) && data.length > 0 && data.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x))) {
    records = data
  } else if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    // 尝试自动找出第一个非空对象数组字段（方便直接预览 API 响应里的 users/items/list！）
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (Array.isArray(v) && v.length > 0 && v.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x))) {
        records = v
        label = `字段 "${k}"`
        break
      }
    }
  }

  if (!records || records.length === 0) return null

  const flatRows = records.slice(0, 200).map((item) => flattenObject(item as Record<string, unknown>))
  const headerSet = new Set<string>()
  for (const r of flatRows) Object.keys(r).forEach((k) => headerSet.add(k))
  const headers = Array.from(headerSet)
  if (!headers.length) return null

  const rows = flatRows.map((r) =>
    headers.map((h) => {
      const v = r[h]
      if (v === null || v === undefined) return ''
      if (typeof v === 'object') return JSON.stringify(v)
      return String(v)
    }),
  )
  return { headers, rows, label }
}

/** 对输出结果进行轻量语法高亮（HTML 安全转义后由 hljs 着色） */
export function highlightOutput(code: string, format: TargetFormat): string {
  if (!code) return ''
  // 超过 80KB 的超长文本跳过语法高亮避免主线程卡顿
  if (code.length > 80_000 || format === 'csv') {
    return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
  const langMap: Record<Exclude<TargetFormat, 'csv'>, string> = {
    json: 'json',
    typescript: 'typescript',
    zod: 'typescript',
    yaml: 'yaml',
    toml: 'ini',
  }
  try {
    return hljs.highlight(code, { language: langMap[format] }).value
  } catch {
    return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}
