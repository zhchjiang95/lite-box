/**
 * Word (.docx) 文档结构化提取与两级 Myers Diff 对比引擎
 * - 直接解析 word/document.xml（含正文段落、标题、表格行及可选页眉页脚），自动跳过已删除修订 w:del
 * - 一级段落/表格行级 Myers Diff + 二级字符级精准红绿高亮（揪出合同中单个数字或字词的改动）
 * - 支持生成独立可打印的 HTML 审阅对比报告
 */

import { diffArrays, diffChars, type Change } from 'diff'
import { strFromU8, unzipSync } from 'fflate'

export type BlockKind = 'heading' | 'paragraph' | 'table-row' | 'header' | 'footer'

export interface DocBlock {
  index: number
  kind: BlockKind
  /** 语义定位标签（如 段落 #3、表格 1 · 行 2、页眉） */
  tag: string
  text: string
}

export interface ParsedDoc {
  name: string
  size: number
  blocks: DocBlock[]
  headerFooterBlocks: DocBlock[]
  charCount: number
  tableCount: number
  isSample?: boolean
}

export interface DiffOptions {
  ignoreWhitespace: boolean
  ignorePunctuation: boolean
  ignoreCase: boolean
  includeHeaderFooter: boolean
}

export const defaultDiffOptions: DiffOptions = {
  ignoreWhitespace: true,
  ignorePunctuation: false,
  ignoreCase: false,
  includeHeaderFooter: false,
}

export type DiffRowStatus = 'equal' | 'modified' | 'added' | 'removed'

export interface DiffRow {
  id: number
  status: DiffRowStatus
  leftBlock?: DocBlock
  rightBlock?: DocBlock
  /** 当 status === 'modified' 时的逐字红绿差异片段 */
  charChanges?: Change[]
}

export interface DocDiffSummary {
  rows: DiffRow[]
  changeRowIndices: number[]
  equalCount: number
  modifiedCount: number
  addedCount: number
  removedCount: number
  similarityPercent: number
}

/** 从 w:p 节点提取可见纯文本（自动跳过 w:del 历史删除修订，保留换行与制表符） */
function extractParagraphText(pNode: Element): string {
  const parts: string[] = []

  const walk = (node: Node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    const local = el.localName

    // 跳过 Word 历史删除修订、批注引用、域代码指令等不可见正文节点
    if (
      local === 'del' ||
      local === 'delText' ||
      local === 'instrText' ||
      local === 'commentReference' ||
      local === 'pPr' ||
      local === 'rPr'
    ) {
      return
    }

    if (local === 't') {
      parts.push(el.textContent ?? '')
      return
    }
    if (local === 'tab') {
      parts.push('\t')
      return
    }
    if (local === 'br' || local === 'cr') {
      parts.push('\n')
      return
    }

    const children = el.childNodes
    for (let i = 0; i < children.length; i++) {
      walk(children[i])
    }
  }

  walk(pNode)
  return parts.join('').replace(/\r\n/g, '\n').trim()
}

/** 判断段落是否为标题样式 */
function isHeadingParagraph(pNode: Element): boolean {
  const pPr = Array.from(pNode.childNodes).find(
    (n) => n.nodeType === Node.ELEMENT_NODE && (n as Element).localName === 'pPr',
  ) as Element | undefined
  if (!pPr) return false

  const pStyle = Array.from(pPr.childNodes).find(
    (n) => n.nodeType === Node.ELEMENT_NODE && (n as Element).localName === 'pStyle',
  ) as Element | undefined
  if (!pStyle) return false

  const val = (pStyle.getAttribute('w:val') || pStyle.getAttribute('val') || '').toLowerCase()
  return val.includes('heading') || val.includes('title') || val.includes('标题') || /^a\d$/.test(val)
}

/** 从单个 XML（页眉/页脚）中提取非空段落 */
function extractXmlParagraphs(xmlStr: string, kind: 'header' | 'footer', prefix: string): DocBlock[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlStr, 'application/xml')
  const blocks: DocBlock[] = []
  const all = doc.getElementsByTagName('*')
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === 'p') {
      const text = extractParagraphText(all[i])
      if (text) {
        blocks.push({
          index: blocks.length + 1,
          kind,
          tag: prefix,
          text,
        })
      }
    }
  }
  return blocks
}

/** 解析 .docx（同时兼容 .txt / .md 纯文本文件）为结构化段落与表格块 */
export async function parseDocForDiff(file: File): Promise<ParsedDoc> {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.doc') && !lower.endsWith('.docx')) {
    throw new Error(`「${file.name}」为旧版 .doc 格式，请先在 Word / WPS 中另存为 .docx 后再对比`)
  }

  // 兼容直接拖入纯文本或 Markdown 进行对比
  if (lower.endsWith('.txt') || lower.endsWith('.md')) {
    const content = await file.text()
    const blocks: DocBlock[] = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((text, idx) => ({
        index: idx + 1,
        kind: 'paragraph',
        tag: `第 ${idx + 1} 段`,
        text,
      }))
    return {
      name: file.name,
      size: file.size,
      blocks,
      headerFooterBlocks: [],
      charCount: blocks.reduce((s, b) => s + b.text.length, 0),
      tableCount: 0,
    }
  }

  if (
    !lower.endsWith('.docx') &&
    file.type !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    throw new Error(`「${file.name}」不是有效的 .docx Word 文档`)
  }

  const rawBytes = new Uint8Array(await file.arrayBuffer())
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(rawBytes)
  } catch {
    throw new Error(`无法解压「${file.name}」，可能已加密或文件已损坏`)
  }

  if (!entries['word/document.xml']) {
    throw new Error(`「${file.name}」缺少 word/document.xml，请确认是标准未加密的 .docx 文档`)
  }

  const parser = new DOMParser()
  const docXml = parser.parseFromString(strFromU8(entries['word/document.xml']), 'application/xml')

  let bodyEl: Element | null = null
  const allNodes = docXml.getElementsByTagName('*')
  for (let i = 0; i < allNodes.length; i++) {
    if (allNodes[i].localName === 'body') {
      bodyEl = allNodes[i]
      break
    }
  }
  if (!bodyEl) {
    throw new Error(`「${file.name}」正文结构异常`)
  }

  const blocks: DocBlock[] = []
  let paraSeq = 0
  let tableSeq = 0

  const visitBodyChild = (el: Element) => {
    const local = el.localName

    if (local === 'p') {
      const text = extractParagraphText(el)
      if (!text) return
      paraSeq += 1
      const heading = isHeadingParagraph(el)
      blocks.push({
        index: blocks.length + 1,
        kind: heading ? 'heading' : 'paragraph',
        tag: heading ? `标题 #${paraSeq}` : `段落 #${paraSeq}`,
        text,
      })
      return
    }

    if (local === 'tbl') {
      tableSeq += 1
      let rowSeq = 0
      const children = Array.from(el.childNodes)
      for (const child of children) {
        if (child.nodeType !== Node.ELEMENT_NODE) continue
        const tr = child as Element
        if (tr.localName !== 'tr') continue
        rowSeq += 1
        const cells: string[] = []
        const trChildren = Array.from(tr.childNodes)
        for (const tcNode of trChildren) {
          if (tcNode.nodeType !== Node.ELEMENT_NODE) continue
          const tc = tcNode as Element
          if (tc.localName !== 'tc') continue
          const cellLines: string[] = []
          const tcAll = tc.getElementsByTagName('*')
          for (let k = 0; k < tcAll.length; k++) {
            if (tcAll[k].localName === 'p') {
              const t = extractParagraphText(tcAll[k])
              if (t) cellLines.push(t)
            }
          }
          cells.push(cellLines.join(' / '))
        }
        const rowText = cells.join('  |  ').trim()
        if (rowText && rowText.replace(/\|/g, '').trim()) {
          blocks.push({
            index: blocks.length + 1,
            kind: 'table-row',
            tag: `表格 ${tableSeq} · 行 ${rowSeq}`,
            text: rowText,
          })
        }
      }
      return
    }

    // 兼容内容控件容器（w:sdt）内嵌段落与表格
    if (local === 'sdt') {
      const sdtContent = Array.from(el.childNodes).find(
        (n) => n.nodeType === Node.ELEMENT_NODE && (n as Element).localName === 'sdtContent',
      ) as Element | undefined
      if (sdtContent) {
        Array.from(sdtContent.childNodes).forEach((n) => {
          if (n.nodeType === Node.ELEMENT_NODE) visitBodyChild(n as Element)
        })
      }
    }
  }

  Array.from(bodyEl.childNodes).forEach((n) => {
    if (n.nodeType === Node.ELEMENT_NODE) visitBodyChild(n as Element)
  })

  // 提取页眉与页脚（可选参与对比）
  const headerFooterBlocks: DocBlock[] = []
  const hfPaths = Object.keys(entries)
    .filter((p) => /^word\/(?:header|footer)\d*\.xml$/i.test(p))
    .sort()

  for (const p of hfPaths) {
    const isHeader = p.toLowerCase().includes('header')
    const extracted = extractXmlParagraphs(
      strFromU8(entries[p]),
      isHeader ? 'header' : 'footer',
      isHeader ? '页眉' : '页脚',
    )
    headerFooterBlocks.push(...extracted)
  }

  return {
    name: file.name,
    size: file.size,
    blocks,
    headerFooterBlocks,
    charCount: blocks.reduce((s, b) => s + b.text.length, 0),
    tableCount: tableSeq,
  }
}

/** 构造用于对比匹配的归一化键 */
function normalizeForCompare(text: string, opts: DiffOptions): string {
  let s = text
  if (opts.ignoreCase) s = s.toLowerCase()
  if (opts.ignorePunctuation) {
    // 统一中英文常见标点并忽略标点差异
    s = s.replace(/[，。；：！？、“”‘’（）【】《》,.!?;:'"()[\]<>—–\-]/g, '')
  }
  if (opts.ignoreWhitespace) {
    s = s.replace(/[\s\u3000\u00A0]+/g, ' ').trim()
  }
  return s
}

/** 计算两段文字的快速字符相似度（用于判断是否适合配对为“修改行”） */
function quickCharSimilarity(a: string, b: string): number {
  if (!a && !b) return 1
  if (!a || !b) return 0
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  const setA = new Map<string, number>()
  for (const ch of a) setA.set(ch, (setA.get(ch) ?? 0) + 1)
  let shared = 0
  for (const ch of b) {
    const cnt = setA.get(ch) ?? 0
    if (cnt > 0) {
      shared += 1
      setA.set(ch, cnt - 1)
    }
  }
  return (2 * shared) / (a.length + b.length)
}

/** 执行两级 Myers Diff（段落/表格行对齐 + 修改段内部逐字高亮） */
export function computeDocDiff(docA: ParsedDoc, docB: ParsedDoc, opts: DiffOptions): DocDiffSummary {
  const listA = opts.includeHeaderFooter ? [...docA.blocks, ...docA.headerFooterBlocks] : docA.blocks
  const listB = opts.includeHeaderFooter ? [...docB.blocks, ...docB.headerFooterBlocks] : docB.blocks

  const keysA = listA.map((b) => normalizeForCompare(b.text, opts))
  const keysB = listB.map((b) => normalizeForCompare(b.text, opts))

  const parts = diffArrays(keysA, keysB)

  const rows: DiffRow[] = []
  let idxA = 0
  let idxB = 0
  let rowId = 1

  for (let p = 0; p < parts.length; p++) {
    const part = parts[p]
    const count = part.value.length

    if (!part.added && !part.removed) {
      for (let k = 0; k < count; k++) {
        rows.push({
          id: rowId++,
          status: 'equal',
          leftBlock: listA[idxA++],
          rightBlock: listB[idxB++],
        })
      }
      continue
    }

    // 紧邻的 removed + added 块智能配对为“修改段”，内部做逐字红绿高亮
    if (part.removed && p + 1 < parts.length && parts[p + 1].added) {
      const remBlocks = listA.slice(idxA, idxA + count)
      idxA += count
      const addCount = parts[p + 1].value.length
      const addBlocks = listB.slice(idxB, idxB + addCount)
      idxB += addCount
      p += 1

      const pairLen = Math.min(remBlocks.length, addBlocks.length)
      for (let k = 0; k < pairLen; k++) {
        const left = remBlocks[k]
        const right = addBlocks[k]
        // 若两段文字完全风马牛不相及（相似度 < 18%），拆分为独立删除+新增更清晰
        const sim = quickCharSimilarity(left.text, right.text)
        if (sim >= 0.18) {
          rows.push({
            id: rowId++,
            status: 'modified',
            leftBlock: left,
            rightBlock: right,
            charChanges: diffChars(left.text, right.text),
          })
        } else {
          rows.push({ id: rowId++, status: 'removed', leftBlock: left })
          rows.push({ id: rowId++, status: 'added', rightBlock: right })
        }
      }

      for (let k = pairLen; k < remBlocks.length; k++) {
        rows.push({ id: rowId++, status: 'removed', leftBlock: remBlocks[k] })
      }
      for (let k = pairLen; k < addBlocks.length; k++) {
        rows.push({ id: rowId++, status: 'added', rightBlock: addBlocks[k] })
      }
      continue
    }

    if (part.removed) {
      for (let k = 0; k < count; k++) {
        rows.push({ id: rowId++, status: 'removed', leftBlock: listA[idxA++] })
      }
    } else if (part.added) {
      for (let k = 0; k < count; k++) {
        rows.push({ id: rowId++, status: 'added', rightBlock: listB[idxB++] })
      }
    }
  }

  let equalCount = 0
  let modifiedCount = 0
  let addedCount = 0
  let removedCount = 0
  const changeRowIndices: number[] = []

  rows.forEach((r, idx) => {
    if (r.status === 'equal') equalCount += 1
    else {
      changeRowIndices.push(idx)
      if (r.status === 'modified') modifiedCount += 1
      else if (r.status === 'added') addedCount += 1
      else removedCount += 1
    }
  })

  // 按字符级别估算文档整体相似度
  let sameChars = 0
  let totalChars = 0
  for (const r of rows) {
    if (r.status === 'equal' && r.leftBlock) {
      sameChars += r.leftBlock.text.length * 2
      totalChars += r.leftBlock.text.length * 2
    } else if (r.status === 'modified' && r.charChanges) {
      for (const c of r.charChanges) {
        if (!c.added && !c.removed) {
          sameChars += c.value.length * 2
          totalChars += c.value.length * 2
        } else {
          totalChars += c.value.length
        }
      }
    } else if (r.status === 'removed' && r.leftBlock) {
      totalChars += r.leftBlock.text.length
    } else if (r.status === 'added' && r.rightBlock) {
      totalChars += r.rightBlock.text.length
    }
  }
  const similarityPercent = totalChars === 0 ? 100 : Math.round((sameChars / totalChars) * 1000) / 10

  return {
    rows,
    changeRowIndices,
    equalCount,
    modifiedCount,
    addedCount,
    removedCount,
    similarityPercent,
  }
}

/** 导出独立、美观、可直接打印/发给同事的 HTML 审阅对比报告 */
export function buildDiffHtmlReport(docA: ParsedDoc, docB: ParsedDoc, summary: DocDiffSummary): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const rowsHtml = summary.rows
    .map((row) => {
      if (row.status === 'equal') {
        return `<tr class="eq"><td class="tag">${esc(row.leftBlock?.tag ?? '')}</td><td colspan="2">${esc(row.leftBlock?.text ?? '')}</td></tr>`
      }
      if (row.status === 'removed') {
        return `<tr class="del"><td class="tag">${esc(row.leftBlock?.tag ?? '')}</td><td><del>${esc(row.leftBlock?.text ?? '')}</del></td><td class="empty">（已删除）</td></tr>`
      }
      if (row.status === 'added') {
        return `<tr class="add"><td class="tag">${esc(row.rightBlock?.tag ?? '')}</td><td class="empty">（新增）</td><td><ins>${esc(row.rightBlock?.text ?? '')}</ins></td></tr>`
      }
      const leftHtml = (row.charChanges ?? [])
        .filter((c) => !c.added)
        .map((c) => (c.removed ? `<del>${esc(c.value)}</del>` : esc(c.value)))
        .join('')
      const rightHtml = (row.charChanges ?? [])
        .filter((c) => !c.removed)
        .map((c) => (c.added ? `<ins>${esc(c.value)}</ins>` : esc(c.value)))
        .join('')
      return `<tr class="mod"><td class="tag">${esc(row.leftBlock?.tag ?? row.rightBlock?.tag ?? '')}</td><td>${leftHtml}</td><td>${rightHtml}</td></tr>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>文档对比报告 · ${esc(docA.name)} vs ${esc(docB.name)}</title>
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #0f172a; background: #f8fafc; margin: 0; padding: 28px; }
  .card { max-width: 1120px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(15,23,42,.06); }
  .head { padding: 20px 24px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
  h1 { margin: 0 0 8px; font-size: 18px; }
  .meta { font-size: 13px; color: #475569; display: flex; flex-wrap: wrap; gap: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; line-height: 1.7; }
  th { text-align: left; padding: 10px 14px; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; font-size: 12px; color: #475569; }
  td { padding: 10px 14px; border-bottom: 1px solid #f1f5f9; vertical-align: top; word-break: break-word; white-space: pre-wrap; }
  td.tag { width: 110px; color: #64748b; font-size: 11px; white-space: nowrap; }
  td.empty { color: #94a3b8; font-style: italic; }
  tr.del { background: #fef2f2; }
  tr.add { background: #f0fdf4; }
  tr.mod { background: #fffbeb; }
  del { background: #fecaca; color: #991b1b; text-decoration: line-through; padding: 1px 2px; border-radius: 3px; }
  ins { background: #bbf7d0; color: #166534; text-decoration: none; font-weight: 600; padding: 1px 2px; border-radius: 3px; }
</style>
</head>
<body>
  <div class="card">
    <div class="head">
      <h1>Word 文档内容对比报告</h1>
      <div class="meta">
        <span>原文档 A：<strong>${esc(docA.name)}</strong></span>
        <span>新文档 B：<strong>${esc(docB.name)}</strong></span>
        <span>相似度：<strong>${summary.similarityPercent}%</strong></span>
        <span>修改：${summary.modifiedCount} · 新增：${summary.addedCount} · 删除：${summary.removedCount}</span>
      </div>
    </div>
    <table>
      <thead>
        <tr><th>位置</th><th>原文档 A（旧版）</th><th>新文档 B（新版）</th></tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>
</body>
</html>`
}

/** 内置合同修订示例，方便一键体验逐段/逐字红绿比对效果 */
export function createSampleContractDocs(): { docA: ParsedDoc; docB: ParsedDoc } {
  const blocksA: DocBlock[] = [
    { index: 1, kind: 'heading', tag: '标题 #1', text: '技术服务合作协议（V1.0 草案）' },
    { index: 2, kind: 'paragraph', tag: '段落 #2', text: '甲方（委托方）：星辰数字科技有限公司；乙方（服务方）：轻匣软件工作室。' },
    { index: 3, kind: 'paragraph', tag: '段落 #3', text: '一、服务内容与交付周期：乙方应于本合同签订后 30 个工作日内完成全部前端功能研发与交付验收。' },
    { index: 4, kind: 'table-row', tag: '表格 1 · 行 1', text: '付款节点  |  比例  |  金额（人民币）' },
    { index: 5, kind: 'table-row', tag: '表格 1 · 行 2', text: '首付款（签约后 5 日内）  |  40%  |  ¥40,000.00' },
    { index: 6, kind: 'table-row', tag: '表格 1 · 行 3', text: '尾款（终验合格后 7 日内）  |  60%  |  ¥60,000.00' },
    { index: 7, kind: 'paragraph', tag: '段落 #4', text: '二、违约责任：如任意一方逾期履行超过 15 日，每逾期一日按合同总额的 0.5‰ 支付违约金，累计不超过合同总额的 10%。' },
    { index: 8, kind: 'paragraph', tag: '段落 #5', text: '三、保密条款：双方对合作过程中获知的商业机密承担永久保密义务。' },
    { index: 9, kind: 'paragraph', tag: '段落 #6', text: '四、争议解决：因本协议引起的争议，双方应友好协商解决；协商不成的，提交甲方所在地人民法院诉讼解决。' },
  ]

  const blocksB: DocBlock[] = [
    { index: 1, kind: 'heading', tag: '标题 #1', text: '技术服务合作协议（V2.0 修订版）' },
    { index: 2, kind: 'paragraph', tag: '段落 #2', text: '甲方（委托方）：星辰数字科技有限公司；乙方（服务方）：轻匣软件工作室。' },
    { index: 3, kind: 'paragraph', tag: '段落 #3', text: '一、服务内容与交付周期：乙方应于本合同签订并收到首付款后 45 个工作日内完成全部前端功能研发与交付验收。' },
    { index: 4, kind: 'table-row', tag: '表格 1 · 行 1', text: '付款节点  |  比例  |  金额（人民币）' },
    { index: 5, kind: 'table-row', tag: '表格 1 · 行 2', text: '首付款（签约后 3 日内）  |  50%  |  ¥50,000.00' },
    { index: 6, kind: 'table-row', tag: '表格 1 · 行 3', text: '尾款（终验合格后 7 日内）  |  50%  |  ¥50,000.00' },
    { index: 7, kind: 'paragraph', tag: '段落 #4', text: '二、违约责任：如任意一方逾期履行超过 15 日，每逾期一日按合同总额的 0.3‰ 支付违约金，累计不超过合同总额的 5%。' },
    { index: 8, kind: 'paragraph', tag: '段落 #5', text: '三、知识产权：项目终验并付清全部款项后，本项目定制开发源码的著作权归甲方所有。' },
    { index: 9, kind: 'paragraph', tag: '段落 #6', text: '四、保密条款：双方对合作过程中获知的商业机密承担 3 年保密义务。' },
    { index: 10, kind: 'paragraph', tag: '段落 #7', text: '五、争议解决：因本协议引起的争议，双方应友好协商解决；协商不成的，提交乙方所在地人民法院诉讼解决。' },
  ]

  return {
    docA: {
      name: '技术服务合作协议-V1.0.docx（示例）',
      size: 28400,
      blocks: blocksA,
      headerFooterBlocks: [],
      charCount: blocksA.reduce((s, b) => s + b.text.length, 0),
      tableCount: 1,
      isSample: true,
    },
    docB: {
      name: '技术服务合作协议-V2.0.docx（示例）',
      size: 31200,
      blocks: blocksB,
      headerFooterBlocks: [],
      charCount: blocksB.reduce((s, b) => s + b.text.length, 0),
      tableCount: 1,
      isSample: true,
    },
  }
}
