/**
 * Word (.docx) OOXML 元数据深度解析与隐私脱敏清理引擎
 * - 基于 fflate 无损解包/重封装，100% 保留原文档正文、样式、表格与图片排版
 * - 解析 docProps/core.xml、docProps/app.xml、docProps/custom.xml、word/comments.xml、word/document.xml（修订痕迹）与 word/media/
 */

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'

export interface MetadataField {
  key: string
  label: string
  value: string
  source: 'core' | 'app' | 'custom'
  sensitive: boolean
}

export interface CommentSnippet {
  id: string
  author: string
  date: string
  text: string
}

export interface PrivacyFinding {
  level: 'high' | 'medium'
  title: string
  detail: string
}

export interface DocxStats {
  pages: number | null
  words: number | null
  characters: number | null
  paragraphs: number | null
  totalTimeMin: number | null
  mediaCount: number
  mediaTotalBytes: number
  commentCount: number
  revisionInsertCount: number
  revisionDeleteCount: number
  revisionAuthors: string[]
}

export interface DocxInspection {
  fields: MetadataField[]
  stats: DocxStats
  comments: CommentSnippet[]
  findings: PrivacyFinding[]
  riskLevel: 'clean' | 'medium' | 'high'
  hasPeopleXml: boolean
}

export interface CleanOptions {
  /** 清空作者、最后修改人、所属公司、经理 */
  clearIdentity: boolean
  /** 清空创建/修改/打印时间、修订版本号与累计编辑时长 */
  clearTimestamps: boolean
  /** 清空创建软件名称、版本号与模板来源 */
  clearAppInfo: boolean
  /** 清空文档标题、主题、关键词、备注与类别 */
  clearDescriptive: boolean
  /** 清空自定义文档属性（custom.xml） */
  clearCustomProps: boolean
  /** 清除文档中的所有隐藏批注（comments.xml 与正文批注标记） */
  stripComments: boolean
}

export const defaultCleanOptions: CleanOptions = {
  clearIdentity: true,
  clearTimestamps: true,
  clearAppInfo: true,
  clearDescriptive: false,
  clearCustomProps: true,
  stripComments: false,
}

/** 判断文件是否为支持的 .docx（同时友好区分旧版 .doc） */
export function checkDocxFile(file: File): { ok: true } | { ok: false; reason: string } {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.doc') && !lower.endsWith('.docx')) {
    return {
      ok: false,
      reason: `「${file.name}」为旧版 Word 97-2003 二进制 .doc 格式，请先另存为 .docx 后再导入`,
    }
  }
  if (
    lower.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return { ok: true }
  }
  return { ok: false, reason: `「${file.name}」不是有效的 .docx Word 文档` }
}

/** 读取 XML 中指定本地标签名的首个文本值（兼容命名空间前缀差异） */
function getTagText(doc: Document, localName: string): string {
  const nodes = doc.getElementsByTagName('*')
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].localName === localName) {
      return (nodes[i].textContent ?? '').trim()
    }
  }
  return ''
}

/** 格式化 ISO 8601 时间戳为易读中文时间 */
function formatIsoDate(raw: string): string {
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function parseOptionalInt(raw: string): number | null {
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? Math.round(n) : null
}

/** 深度解析 .docx 文档的元数据、隐藏批注、修订痕迹与隐私风险 */
export function inspectDocxBytes(bytes: Uint8Array): DocxInspection {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch {
    throw new Error('无法解压此 .docx 文件，可能已损坏或设置了打开密码加密')
  }

  if (!entries['word/document.xml']) {
    throw new Error('缺少 word/document.xml，请确认文件为标准未加密的 .docx 文档')
  }

  const parser = new DOMParser()
  const fields: MetadataField[] = []
  const findings: PrivacyFinding[] = []
  const comments: CommentSnippet[] = []

  let pages: number | null = null
  let words: number | null = null
  let characters: number | null = null
  let paragraphs: number | null = null
  let totalTimeMin: number | null = null

  const pushField = (
    key: string,
    label: string,
    value: string,
    source: MetadataField['source'],
    sensitive: boolean,
  ) => {
    if (!value) return
    fields.push({ key, label, value, source, sensitive })
  }

  // 1. 解析 docProps/core.xml
  let creator = ''
  let lastModifiedBy = ''
  if (entries['docProps/core.xml']) {
    const coreDoc = parser.parseFromString(strFromU8(entries['docProps/core.xml']), 'application/xml')
    creator = getTagText(coreDoc, 'creator')
    lastModifiedBy = getTagText(coreDoc, 'lastModifiedBy')
    const title = getTagText(coreDoc, 'title')
    const subject = getTagText(coreDoc, 'subject')
    const keywords = getTagText(coreDoc, 'keywords')
    const description = getTagText(coreDoc, 'description')
    const category = getTagText(coreDoc, 'category')
    const revision = getTagText(coreDoc, 'revision')
    const created = formatIsoDate(getTagText(coreDoc, 'created'))
    const modified = formatIsoDate(getTagText(coreDoc, 'modified'))
    const lastPrinted = formatIsoDate(getTagText(coreDoc, 'lastPrinted'))

    pushField('creator', '文档作者（Creator）', creator, 'core', true)
    pushField('lastModifiedBy', '最后修改人', lastModifiedBy, 'core', true)
    pushField('created', '创建时间', created, 'core', true)
    pushField('modified', '最后修改时间', modified, 'core', true)
    pushField('lastPrinted', '最后打印时间', lastPrinted, 'core', true)
    pushField('revision', '修订版本号', revision, 'core', true)
    pushField('title', '文档标题', title, 'core', false)
    pushField('subject', '主题', subject, 'core', false)
    pushField('keywords', '关键词', keywords, 'core', false)
    pushField('category', '类别', category, 'core', false)
    pushField('description', '备注说明', description, 'core', false)
  }

  // 2. 解析 docProps/app.xml
  let company = ''
  let manager = ''
  let application = ''
  if (entries['docProps/app.xml']) {
    const appDoc = parser.parseFromString(strFromU8(entries['docProps/app.xml']), 'application/xml')
    company = getTagText(appDoc, 'Company')
    manager = getTagText(appDoc, 'Manager')
    application = getTagText(appDoc, 'Application')
    const appVersion = getTagText(appDoc, 'AppVersion')
    const template = getTagText(appDoc, 'Template')
    totalTimeMin = parseOptionalInt(getTagText(appDoc, 'TotalTime'))
    pages = parseOptionalInt(getTagText(appDoc, 'Pages'))
    words = parseOptionalInt(getTagText(appDoc, 'Words'))
    characters = parseOptionalInt(getTagText(appDoc, 'CharactersWithSpaces')) ?? parseOptionalInt(getTagText(appDoc, 'Characters'))
    paragraphs = parseOptionalInt(getTagText(appDoc, 'Paragraphs'))

    pushField('Company', '所属公司 / 组织', company, 'app', true)
    pushField('Manager', '负责人 / 经理', manager, 'app', true)
    pushField(
      'Application',
      '创建软件',
      application ? (appVersion ? `${application} (${appVersion})` : application) : '',
      'app',
      true,
    )
    pushField('Template', '使用模板', template, 'app', false)
    if (totalTimeMin !== null && totalTimeMin > 0) {
      pushField('TotalTime', '累计编辑时长', `${totalTimeMin} 分钟`, 'app', true)
    }
  }

  // 3. 解析 docProps/custom.xml
  let customCount = 0
  if (entries['docProps/custom.xml']) {
    const customDoc = parser.parseFromString(strFromU8(entries['docProps/custom.xml']), 'application/xml')
    const nodes = customDoc.getElementsByTagName('*')
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].localName === 'property') {
        const name = nodes[i].getAttribute('name') || `自定义属性 ${customCount + 1}`
        const val = (nodes[i].textContent ?? '').trim()
        if (val) {
          customCount += 1
          pushField(`custom:${name}`, `自定义 · ${name}`, val, 'custom', true)
        }
      }
    }
  }

  // 4. 解析隐藏批注 word/comments.xml
  if (entries['word/comments.xml']) {
    const cDoc = parser.parseFromString(strFromU8(entries['word/comments.xml']), 'application/xml')
    const nodes = cDoc.getElementsByTagName('*')
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].localName === 'comment') {
        const el = nodes[i]
        const id = el.getAttribute('w:id') || el.getAttribute('id') || String(comments.length + 1)
        const author = el.getAttribute('w:author') || el.getAttribute('author') || '匿名'
        const date = formatIsoDate(el.getAttribute('w:date') || el.getAttribute('date') || '')
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
        comments.push({ id, author, date, text })
      }
    }
  }

  // 5. 扫描 word/document.xml 中的修订痕迹（w:ins / w:del）
  let revisionInsertCount = 0
  let revisionDeleteCount = 0
  const revAuthorSet = new Set<string>()
  {
    const docXml = parser.parseFromString(strFromU8(entries['word/document.xml']), 'application/xml')
    const nodes = docXml.getElementsByTagName('*')
    for (let i = 0; i < nodes.length; i++) {
      const local = nodes[i].localName
      if (local === 'ins' || local === 'del') {
        if (local === 'ins') revisionInsertCount += 1
        else revisionDeleteCount += 1
        const author = nodes[i].getAttribute('w:author') || nodes[i].getAttribute('author')
        if (author) revAuthorSet.add(author)
      }
    }
  }

  // 6. 统计内嵌媒体文件
  let mediaCount = 0
  let mediaTotalBytes = 0
  for (const [entryPath, data] of Object.entries(entries)) {
    if (entryPath.startsWith('word/media/') && data.byteLength > 0) {
      mediaCount += 1
      mediaTotalBytes += data.byteLength
    }
  }

  const hasPeopleXml = Boolean(entries['word/people.xml'])

  // 7. 生成隐私体检结论
  const identityNames = Array.from(new Set([creator, lastModifiedBy].filter(Boolean)))
  if (identityNames.length > 0) {
    findings.push({
      level: 'high',
      title: '包含作者 / 修改人姓名',
      detail: identityNames.join('、'),
    })
  }
  if (company || manager) {
    findings.push({
      level: 'high',
      title: '包含所属公司或负责人信息',
      detail: [company, manager].filter(Boolean).join(' · '),
    })
  }
  if (comments.length > 0) {
    findings.push({
      level: 'high',
      title: `内含 ${comments.length} 条批注内容`,
      detail: '发给外部前请确认是否需要清除内部讨论批注',
    })
  }
  if (revisionInsertCount + revisionDeleteCount > 0) {
    findings.push({
      level: 'high',
      title: `检测到 ${revisionInsertCount + revisionDeleteCount} 处修订痕迹`,
      detail: revAuthorSet.size > 0 ? `修订人：${Array.from(revAuthorSet).join('、')}` : '包含增删修改历史记录',
    })
  }
  if (totalTimeMin && totalTimeMin > 0) {
    findings.push({
      level: 'medium',
      title: `记录了累计编辑时长（${totalTimeMin} 分钟）`,
      detail: '对外提交标书或合同时通常建议清零',
    })
  }
  if (customCount > 0) {
    findings.push({
      level: 'medium',
      title: `包含 ${customCount} 项自定义属性`,
      detail: '可能含有内部编号或 OA 系统写入的隐藏字段',
    })
  }
  if (application) {
    findings.push({
      level: 'medium',
      title: '记录了编辑软件与版本信息',
      detail: application,
    })
  }

  const riskLevel: DocxInspection['riskLevel'] = findings.some((f) => f.level === 'high')
    ? 'high'
    : findings.length > 0
      ? 'medium'
      : 'clean'

  return {
    fields,
    stats: {
      pages,
      words,
      characters,
      paragraphs,
      totalTimeMin,
      mediaCount,
      mediaTotalBytes,
      commentCount: comments.length,
      revisionInsertCount,
      revisionDeleteCount,
      revisionAuthors: Array.from(revAuthorSet),
    },
    comments,
    findings,
    riskLevel,
    hasPeopleXml,
  }
}

/** 删除 XML 文档中匹配指定本地名称列表的全部节点 */
function removeElementsByLocalNames(doc: Document, names: Set<string>) {
  const toRemove: Element[] = []
  const all = doc.getElementsByTagName('*')
  for (let i = 0; i < all.length; i++) {
    if (names.has(all[i].localName)) {
      toRemove.push(all[i])
    }
  }
  for (const el of toRemove) {
    el.parentNode?.removeChild(el)
  }
}

/**
 * 按勾选策略无损清理 .docx 隐藏隐私元数据并重新打包为标准 .docx Blob
 */
export function cleanDocxMetadata(bytes: Uint8Array, opts: CleanOptions): Uint8Array {
  const entries = unzipSync(bytes)
  const parser = new DOMParser()
  const serializer = new XMLSerializer()
  const out: Zippable = {}

  for (const [k, v] of Object.entries(entries)) {
    out[k] = v
  }

  // 1. 清理 docProps/core.xml
  if (entries['docProps/core.xml']) {
    const doc = parser.parseFromString(strFromU8(entries['docProps/core.xml']), 'application/xml')
    const targets = new Set<string>()
    if (opts.clearIdentity) {
      targets.add('creator')
      targets.add('lastModifiedBy')
    }
    if (opts.clearTimestamps) {
      targets.add('created')
      targets.add('modified')
      targets.add('lastPrinted')
      targets.add('revision')
    }
    if (opts.clearDescriptive) {
      targets.add('title')
      targets.add('subject')
      targets.add('keywords')
      targets.add('description')
      targets.add('category')
    }
    if (targets.size > 0) {
      removeElementsByLocalNames(doc, targets)
      out['docProps/core.xml'] = strToU8(serializer.serializeToString(doc))
    }
  }

  // 2. 清理 docProps/app.xml
  if (entries['docProps/app.xml']) {
    const doc = parser.parseFromString(strFromU8(entries['docProps/app.xml']), 'application/xml')
    const targets = new Set<string>()
    if (opts.clearIdentity) {
      targets.add('Company')
      targets.add('Manager')
    }
    if (opts.clearAppInfo) {
      targets.add('Application')
      targets.add('AppVersion')
      targets.add('Template')
    }
    if (opts.clearTimestamps) {
      targets.add('TotalTime')
    }
    if (targets.size > 0) {
      removeElementsByLocalNames(doc, targets)
      out['docProps/app.xml'] = strToU8(serializer.serializeToString(doc))
    }
  }

  // 3. 清理 docProps/custom.xml 中的自定义属性
  if (opts.clearCustomProps && entries['docProps/custom.xml']) {
    const doc = parser.parseFromString(strFromU8(entries['docProps/custom.xml']), 'application/xml')
    removeElementsByLocalNames(doc, new Set(['property']))
    out['docProps/custom.xml'] = strToU8(serializer.serializeToString(doc))
  }

  // 4. 清理 word/people.xml 中的人员账号列表
  if (opts.clearIdentity && entries['word/people.xml']) {
    const doc = parser.parseFromString(strFromU8(entries['word/people.xml']), 'application/xml')
    removeElementsByLocalNames(doc, new Set(['person']))
    out['word/people.xml'] = strToU8(serializer.serializeToString(doc))
  }

  // 5. 可选清除全部批注及正文批注引用标记
  if (opts.stripComments) {
    if (entries['word/comments.xml']) {
      const doc = parser.parseFromString(strFromU8(entries['word/comments.xml']), 'application/xml')
      removeElementsByLocalNames(doc, new Set(['comment']))
      out['word/comments.xml'] = strToU8(serializer.serializeToString(doc))
    }
    if (entries['word/document.xml']) {
      const doc = parser.parseFromString(strFromU8(entries['word/document.xml']), 'application/xml')
      removeElementsByLocalNames(
        doc,
        new Set(['commentRangeStart', 'commentRangeEnd', 'commentReference']),
      )
      out['word/document.xml'] = strToU8(serializer.serializeToString(doc))
    }
  }

  return zipSync(out, { level: 6 })
}

/** 批量清理多份 .docx 并打包为 ZIP */
export function cleanDocxBatchZip(
  files: { name: string; bytes: Uint8Array }[],
  opts: CleanOptions,
): Blob {
  const zipEntries: Zippable = {}
  const usedNames = new Set<string>()

  for (const f of files) {
    const cleaned = cleanDocxMetadata(f.bytes, opts)
    const base = f.name.replace(/\.docx$/i, '')
    let targetName = `${base}-已脱敏.docx`
    let seq = 2
    while (usedNames.has(targetName)) {
      targetName = `${base}-已脱敏(${seq++}).docx`
    }
    usedNames.add(targetName)
    zipEntries[targetName] = cleaned
  }

  const zipped = zipSync(zipEntries, { level: 0 })
  const copy = new Uint8Array(zipped.byteLength)
  copy.set(zipped)
  return new Blob([copy.buffer], { type: 'application/zip' })
}
