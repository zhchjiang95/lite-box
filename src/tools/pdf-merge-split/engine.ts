import { PDFDocument, degrees } from 'pdf-lib'
import { zip } from 'fflate'
import type { PdfPageCard } from './types'

/** 将 Uint8Array 转为标准 PDF Blob */
function toPdfBlob(bytes: Uint8Array): Blob {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return new Blob([buf], { type: 'application/pdf' })
}

/** 缓存已通过 pdf-lib 解析的源文档，避免批量拆分时重复反序列化 */
async function loadSourceDocs(
  pages: PdfPageCard[],
  rawBytesMap: Map<string, Uint8Array>,
): Promise<Map<string, PDFDocument>> {
  const neededIds = new Set(pages.map((p) => p.fileId))
  const loaded = new Map<string, PDFDocument>()

  for (const fileId of neededIds) {
    const raw = rawBytesMap.get(fileId)
    if (!raw) throw new Error('找不到原始 PDF 数据，请重新上传文件')
    try {
      const doc = await PDFDocument.load(raw, { ignoreEncryption: false })
      loaded.set(fileId, doc)
    } catch {
      throw new Error('部分 PDF 已加密或受权限保护，暂无法在本地修改其页面结构')
    }
  }
  return loaded
}

/** 根据给定的页面卡片列表组装为一份新的 PDF（无损保留原矢量与文字，叠加用户旋转） */
async function composePdfBytes(
  pages: PdfPageCard[],
  sourceDocs: Map<string, PDFDocument>,
): Promise<Uint8Array> {
  const outDoc = await PDFDocument.create()
  for (const card of pages) {
    const srcDoc = sourceDocs.get(card.fileId)
    if (!srcDoc) continue
    const [copied] = await outDoc.copyPages(srcDoc, [card.sourcePageIndex])
    if (card.rotation % 360 !== 0) {
      const existing = copied.getRotation().angle
      copied.setRotation(degrees((existing + card.rotation) % 360))
    }
    outDoc.addPage(copied)
  }
  return outDoc.save()
}

/** 合并导出为单份 PDF */
export async function exportMergedPdf(
  pages: PdfPageCard[],
  rawBytesMap: Map<string, Uint8Array>,
): Promise<Blob> {
  if (!pages.length) throw new Error('至少需要 1 个页面才能导出')
  const sourceDocs = await loadSourceDocs(pages, rawBytesMap)
  const bytes = await composePdfBytes(pages, sourceDocs)
  return toPdfBlob(bytes)
}

/** 按页码范围分组导出（支持每组拆成独立 PDF 打包 ZIP，或提取合并为 1 份 PDF） */
export async function exportByRanges(
  allPages: PdfPageCard[],
  rawBytesMap: Map<string, Uint8Array>,
  groups: number[][],
  combined: boolean,
  baseName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ blob: Blob; isZip: boolean; fileCount: number }> {
  if (!groups.length) throw new Error('请先输入有效的页码范围')

  if (combined || groups.length === 1) {
    const flat = groups.flat().map((i) => allPages[i]).filter(Boolean)
    const blob = await exportMergedPdf(flat, rawBytesMap)
    onProgress?.(1, 1)
    return { blob, isZip: false, fileCount: 1 }
  }

  const allNeeded = groups.flat().map((i) => allPages[i]).filter(Boolean)
  const sourceDocs = await loadSourceDocs(allNeeded, rawBytesMap)
  const entries: Record<string, Uint8Array> = {}
  const cleanBase = baseName.replace(/\.pdf$/i, '') || 'split'

  for (let i = 0; i < groups.length; i++) {
    const indices = groups[i]
    const slice = indices.map((idx) => allPages[idx]).filter(Boolean)
    if (!slice.length) continue
    const bytes = await composePdfBytes(slice, sourceDocs)
    const first = indices[0] + 1
    const last = indices[indices.length - 1] + 1
    const tag = first === last ? `P${first}` : `P${first}-${last}`
    entries[`${cleanBase}-${String(i + 1).padStart(2, '0')}-${tag}.pdf`] = bytes
    onProgress?.(i + 1, groups.length)
  }

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data)))
  })
  const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
  return {
    blob: new Blob([buf], { type: 'application/zip' }),
    isZip: true,
    fileCount: Object.keys(entries).length,
  }
}

/** 按固定页数（每 N 页一份，N=1 即逐页拆分）拆分为多份 PDF 并打包 ZIP */
export async function exportByFixedSize(
  allPages: PdfPageCard[],
  rawBytesMap: Map<string, Uint8Array>,
  pagesPerFile: number,
  baseName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ blob: Blob; isZip: boolean; fileCount: number }> {
  const step = Math.max(1, Math.round(pagesPerFile))
  const groups: number[][] = []
  for (let i = 0; i < allPages.length; i += step) {
    const g: number[] = []
    for (let j = i; j < Math.min(allPages.length, i + step); j++) {
      g.push(j)
    }
    groups.push(g)
  }
  return exportByRanges(allPages, rawBytesMap, groups, false, baseName, onProgress)
}
