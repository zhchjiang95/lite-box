import { zip } from 'fflate'
import type { PDFDocumentProxy } from '@/lib/pdf'

export type ExportFormat = 'png' | 'jpeg' | 'webp'
export type OutputLayout = 'pages' | 'long'

export interface PdfToImageOptions {
  layout: OutputLayout
  format: ExportFormat
  /** 清晰度倍率（1 / 1.5 / 2 / 3，对应 72 / 108 / 144 / 216 DPI） */
  scale: number
  /** JPG / WebP 质量（50 - 100） */
  quality: number
  /** 页面背景色（transparent 仅 PNG/WebP 生效，默认纯白避免暗色背景下文字不可见） */
  background: string
  /** 合成长图模式下的页间距（px） */
  longGap: number
}

export const defaultPdfToImageOptions: PdfToImageOptions = {
  layout: 'pages',
  format: 'png',
  scale: 2,
  quality: 92,
  background: '#ffffff',
  longGap: 16,
}

export const FORMAT_MIME: Record<ExportFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export const FORMAT_EXT: Record<ExportFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
}

/** 渲染单页 PDF 到独立 Canvas */
async function renderPageToCanvas(
  doc: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  background: string,
  forceOpaque: boolean,
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  const w = Math.max(1, Math.round(viewport.width))
  const h = Math.max(1, Math.round(viewport.height))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  if (forceOpaque || background !== 'transparent') {
    ctx.fillStyle = background === 'transparent' ? '#ffffff' : background
    ctx.fillRect(0, 0, w, h)
  }

  await page.render({ canvas, viewport }).promise
  page.cleanup()
  return canvas
}

/** 将单页 PDF（1-based）按配置高清渲染为 Blob */
export async function renderSinglePageBlob(
  doc: PDFDocumentProxy,
  pageNumber: number,
  opts: PdfToImageOptions,
  forcePng = false,
): Promise<{ blob: Blob; width: number; height: number }> {
  const fmt: ExportFormat = forcePng ? 'png' : opts.format
  const canvas = await renderPageToCanvas(doc, pageNumber, opts.scale, opts.background, fmt === 'jpeg')
  const width = canvas.width
  const height = canvas.height
  const mime = FORMAT_MIME[fmt]
  const q = fmt === 'png' ? undefined : Math.max(0.1, Math.min(1, opts.quality / 100))

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`第 ${pageNumber} 页导出失败`))), mime, q),
  )
  canvas.width = 0
  canvas.height = 0
  return { blob, width, height }
}

/** 生成规范有序的单页图片文件名 */
export function pageImageName(pdfName: string, pageNumber: number, totalPages: number, format: ExportFormat) {
  const base = pdfName.replace(/\.pdf$/i, '') || 'pdf'
  const pad = totalPages >= 100 ? 3 : totalPages >= 10 ? 2 : 1
  return `${base}-P${String(pageNumber).padStart(pad, '0')}.${FORMAT_EXT[format]}`
}

/** 批量渲染指定页码（1-based 数组）为图片并打包 ZIP */
export async function exportPagesToZip(
  doc: PDFDocumentProxy,
  pdfName: string,
  pageNumbers: number[],
  opts: PdfToImageOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {}
  const total = doc.numPages

  for (let i = 0; i < pageNumbers.length; i++) {
    const pNum = pageNumbers[i]
    const { blob } = await renderSinglePageBlob(doc, pNum, opts)
    const filename = pageImageName(pdfName, pNum, total, opts.format)
    entries[filename] = new Uint8Array(await blob.arrayBuffer())
    onProgress?.(i + 1, pageNumbers.length)
  }

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data)))
  })
  const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
  return new Blob([buf], { type: 'application/zip' })
}

/** 浏览器 Canvas 极限安全保护（兼容桌面端与 iOS Safari） */
const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)
const MAX_SIDE = isIOS ? 8192 : 16384
const MAX_AREA = isIOS ? 16_000_000 : 120_000_000

/** 将指定页码（1-based 数组）纵向拼接为一张超清长图 */
export async function exportPagesToLongImage(
  doc: PDFDocumentProxy,
  pageNumbers: number[],
  opts: PdfToImageOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<{ blob: Blob; width: number; height: number; scaledDown: boolean }> {
  if (!pageNumbers.length) throw new Error('请至少选择 1 个页面')

  // 1. 先探测每页尺寸，计算合成总尺寸并校验是否在浏览器画布安全限制内
  const rawSizes: { w: number; h: number }[] = []
  let maxW = 0
  for (const pNum of pageNumbers) {
    const page = await doc.getPage(pNum)
    const vp = page.getViewport({ scale: opts.scale })
    rawSizes.push({ w: vp.width, h: vp.height })
    if (vp.width > maxW) maxW = vp.width
    page.cleanup()
  }

  // 统一宽度至最大页宽等比排布
  const gap = Math.max(0, Math.round(opts.longGap))
  const normHeights = rawSizes.map((s) => (s.h * maxW) / Math.max(1, s.w))
  const rawTotalH = normHeights.reduce((a, b) => a + b, 0) + gap * Math.max(0, pageNumbers.length - 1)

  const safeK = Math.min(1, MAX_SIDE / maxW, MAX_SIDE / rawTotalH, Math.sqrt(MAX_AREA / (maxW * rawTotalH)))
  const outW = Math.max(1, Math.round(maxW * safeK))
  const outH = Math.max(1, Math.round(rawTotalH * safeK))
  const outGap = Math.round(gap * safeK)

  const longCanvas = document.createElement('canvas')
  longCanvas.width = outW
  longCanvas.height = outH
  const ctx = longCanvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // 填充缝隙与底色（若长图有缝隙则默认浅灰衬托纸张边界，透明底除外）
  if (opts.format === 'jpeg' || opts.background !== 'transparent') {
    ctx.fillStyle = outGap > 0 && opts.background.toLowerCase() === '#ffffff' ? '#e5e7eb' : opts.background === 'transparent' ? '#ffffff' : opts.background
    ctx.fillRect(0, 0, outW, outH)
  }

  // 2. 逐页渲染并绘制到长图画布后立即释放单页显存
  let cursorY = 0
  for (let i = 0; i < pageNumbers.length; i++) {
    const pNum = pageNumbers[i]
    const drawH = Math.max(1, Math.round(normHeights[i] * safeK))
    const pageScale = (outW / Math.max(1, rawSizes[i].w)) * opts.scale
    const pageCanvas = await renderPageToCanvas(
      doc,
      pNum,
      pageScale,
      opts.background,
      opts.format === 'jpeg' || outGap > 0,
    )
    ctx.drawImage(pageCanvas, 0, cursorY, outW, drawH)
    pageCanvas.width = 0
    pageCanvas.height = 0
    cursorY += drawH + outGap
    onProgress?.(i + 1, pageNumbers.length)
  }

  const mime = FORMAT_MIME[opts.format]
  const q = opts.format === 'png' ? undefined : Math.max(0.1, Math.min(1, opts.quality / 100))
  const blob = await new Promise<Blob>((resolve, reject) =>
    longCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('长图导出失败，请降低倍率或减少页数'))), mime, q),
  )
  longCanvas.width = 0
  longCanvas.height = 0

  return { blob, width: outW, height: outH, scaledDown: safeK < 0.999 }
}
