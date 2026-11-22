import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// 配置本地打包的 PDF.js Worker，完全离线运行不依赖外网 CDN
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export type { PDFDocumentProxy }

/** 判断是否为 PDF 文件 */
export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

export interface OpenedPdf {
  doc: PDFDocumentProxy
  /** 彻底销毁文档及其关联的 Worker 资源 */
  destroy: () => Promise<void>
}

/** 打开 PDF 文档用于页面信息读取与 Canvas 渲染（传入副本避免原 Uint8Array 被 Worker 分离） */
export async function openPdfDocument(bytes: Uint8Array): Promise<OpenedPdf> {
  const loadingTask = pdfjsLib.getDocument({
    data: bytes.slice(),
    // 禁用远程字体请求报错，提升纯离线兼容性
    useSystemFonts: true,
  })
  const doc = await loadingTask.promise
  return {
    doc,
    destroy: () => loadingTask.destroy(),
  }
}

/** 将 PDF 指定页（1-based）渲染为 PNG DataURL（用于缩略图或高清弹窗预览） */
export async function renderPdfPageToDataUrl(
  doc: PDFDocumentProxy,
  pageNumber: number,
  targetWidth = 320,
): Promise<string> {
  const page = await doc.getPage(pageNumber)
  const baseViewport = page.getViewport({ scale: 1 })
  const scale = Math.max(0.2, Math.min(3, targetWidth / Math.max(1, baseViewport.width)))
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(viewport.width))
  canvas.height = Math.max(1, Math.round(viewport.height))

  await page.render({ canvas, viewport }).promise
  const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
  canvas.width = 0
  canvas.height = 0
  page.cleanup()
  return dataUrl
}

export interface ParsedRangeResult {
  ok: true
  /** 按逗号分组的 0-based 页面索引数组（例如 "1-3, 5" => [[0,1,2], [4]]） */
  groups: number[][]
  /** 所有命中页面的 0-based 索引集合 */
  indexSet: Set<number>
}

export interface ParsedRangeError {
  ok: false
  error: string
}

/**
 * 解析页码范围表达式，例如 "1-3, 5, 8-10"（支持中英文逗号、顿号、分号）
 * 返回 0-based 页面索引分组，便于按段拆分为多份 PDF 或提取为单份 PDF。
 */
export function parsePageRanges(input: string, totalPages: number): ParsedRangeResult | ParsedRangeError {
  const cleaned = input.trim()
  if (!cleaned) return { ok: false, error: '请输入页码范围，例如 1-3, 5, 8-10' }
  if (totalPages <= 0) return { ok: false, error: '当前没有可用页面' }

  const parts = cleaned
    .split(/[,，、;；\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (!parts.length) return { ok: false, error: '请输入有效的页码范围' }

  const groups: number[][] = []
  const indexSet = new Set<number>()

  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)\s*[-~—至到]\s*(\d+)$/)
    if (rangeMatch) {
      const start = Number(rangeMatch[1])
      const end = Number(rangeMatch[2])
      if (start < 1 || end < 1 || start > totalPages || end > totalPages) {
        return { ok: false, error: `页码 "${part}" 超出范围（共 ${totalPages} 页）` }
      }
      const group: number[] = []
      const step = start <= end ? 1 : -1
      for (let p = start; step > 0 ? p <= end : p >= end; p += step) {
        group.push(p - 1)
        indexSet.add(p - 1)
      }
      groups.push(group)
      continue
    }

    if (/^\d+$/.test(part)) {
      const p = Number(part)
      if (p < 1 || p > totalPages) {
        return { ok: false, error: `页码 "${p}" 超出范围（共 ${totalPages} 页）` }
      }
      groups.push([p - 1])
      indexSet.add(p - 1)
      continue
    }

    return { ok: false, error: `无法识别页码片段 "${part}"，请使用如 1-3, 5 的格式` }
  }

  return { ok: true, groups, indexSet }
}
