import { PDFDocument, StandardFonts, degrees, rgb, type PDFPage } from 'pdf-lib'
import { zip } from 'fflate'
import { openPdfDocument, parsePageRanges } from '@/lib/pdf'
import {
  FONT_STACKS,
  formatPageNumber,
  type PdfWatermarkOptions,
  type RedactMark,
} from './types'

interface StampImageAsset {
  pngBytes: Uint8Array
  /** 在 PDF 点坐标系中的逻辑宽高（pt） */
  widthPt: number
  heightPt: number
  /** 用于右侧实时 Canvas 预览的源画布 */
  previewCanvas: HTMLCanvasElement
}

/** 将 HEX 转为 pdf-lib rgb() */
function hexToRgb(hex: string) {
  const clean = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return rgb(0.3, 0.3, 0.35)
  return rgb(
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255,
  )
}

/**
 * 将任意中文/英文/Emoji 多行文字以 3× 超清分辨率渲染为透明 PNG 印章
 * 优势：无需下载十几 MB 中文字体文件，整个 PDF 仅嵌入 1 份几 KB 透明图对象，矢量级清晰且支持离线。
 */
async function buildTextStampAsset(
  text: string,
  fontSizePt: number,
  fontStyle: PdfWatermarkOptions['fontStyle'],
  bold: boolean,
  color: string,
  dpiScale = 3,
): Promise<StampImageAsset | null> {
  const lines = text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
  if (!lines.length) return null

  const weight = bold ? '700' : '400'
  const lineHeightPt = fontSizePt * 1.32
  const fontCss = `${weight} ${fontSizePt * dpiScale}px ${FONT_STACKS[fontStyle]}`

  const measureCanvas = document.createElement('canvas')
  const mctx = measureCanvas.getContext('2d')!
  mctx.font = fontCss

  let maxPxW = 0
  for (const line of lines) {
    const w = mctx.measureText(line).width
    if (w > maxPxW) maxPxW = w
  }

  const padPx = Math.ceil(fontSizePt * dpiScale * 0.25)
  const canvasW = Math.max(8, Math.ceil(maxPxW + padPx * 2))
  const canvasH = Math.max(8, Math.ceil(lines.length * lineHeightPt * dpiScale + padPx * 2))

  const canvas = document.createElement('canvas')
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext('2d')!
  ctx.font = fontCss
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const startY = canvasH / 2 - ((lines.length - 1) * lineHeightPt * dpiScale) / 2
  lines.forEach((line, i) => {
    ctx.fillText(line, canvasW / 2, startY + i * lineHeightPt * dpiScale)
  })

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('水印印章生成失败'))), 'image/png'),
  )

  return {
    pngBytes: new Uint8Array(await blob.arrayBuffer()),
    widthPt: canvasW / dpiScale,
    heightPt: canvasH / dpiScale,
    previewCanvas: canvas,
  }
}

/** 将上传的 Logo ImageBitmap 转为标准 PNG 印章资产 */
async function buildLogoStampAsset(logo: ImageBitmap, logoWidthPt: number): Promise<StampImageAsset> {
  const maxSide = 900
  const k = Math.min(1, maxSide / Math.max(logo.width, logo.height))
  const cw = Math.max(1, Math.round(logo.width * k))
  const ch = Math.max(1, Math.round(logo.height * k))

  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(logo, 0, 0, cw, ch)

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Logo 水印生成失败'))), 'image/png'),
  )
  return {
    pngBytes: new Uint8Array(await blob.arrayBuffer()),
    widthPt: logoWidthPt,
    heightPt: (logo.height / logo.width) * logoWidthPt,
    previewCanvas: canvas,
  }
}

/** 计算给定页面（0-based）是否应应用水印 */
export function shouldApplyWatermarkOnPage(pageIndex0: number, totalPages: number, opts: PdfWatermarkOptions): boolean {
  if (!opts.enableWatermark) return false
  if (opts.scope === 'all') return true
  if (opts.scope === 'skip-first') return pageIndex0 > 0
  const parsed = parsePageRanges(opts.customRange, totalPages)
  return parsed.ok ? parsed.indexSet.has(pageIndex0) : false
}

/** 计算给定页面（0-based）的页码文本（返回 null 表示该页不显示页码） */
export function getPageNumberTextForPage(pageIndex0: number, totalPages: number, opts: PdfWatermarkOptions): string | null {
  if (!opts.enablePageNum) return null
  if (opts.pageNumSkipFirst && pageIndex0 === 0) return null
  const effectiveIndex = opts.pageNumSkipFirst ? pageIndex0 - 1 : pageIndex0
  const effectiveTotal = opts.pageNumSkipFirst ? Math.max(1, totalPages - 1) : totalPages
  const displayNum = Math.max(1, opts.pageNumStart) + effectiveIndex
  const displayTotal = Math.max(1, opts.pageNumStart) + effectiveTotal - 1
  return formatPageNumber(displayNum, displayTotal, opts.pageNumStyle)
}

interface Placement {
  /** 印章中心在“左上角为原点（Canvas 坐标系，单位 pt）”中的位置 */
  cx: number
  cy: number
}

/** 统一计算单页的水印中心点列表（前端预览与 pdf-lib 导出共用同一套坐标，100% 一致） */
function computeStampCenters(
  pageW: number,
  pageH: number,
  stampW: number,
  stampH: number,
  opts: PdfWatermarkOptions,
): Placement[] {
  const rad = (opts.angle * Math.PI) / 180

  if (opts.layout === 'tile') {
    const diag = Math.hypot(pageW, pageH)
    const stepX = stampW + Math.max(20, opts.gapX)
    const stepY = stampH + Math.max(20, opts.gapY)
    const cols = Math.ceil(diag / stepX) + 2
    const rows = Math.ceil(diag / stepY) + 2
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const list: Placement[] = []

    for (let r = -Math.ceil(rows / 2); r <= Math.ceil(rows / 2); r++) {
      const staggerX = opts.stagger && Math.abs(r) % 2 === 1 ? stepX / 2 : 0
      const ly = r * stepY
      for (let c = -Math.ceil(cols / 2); c <= Math.ceil(cols / 2); c++) {
        const lx = c * stepX + staggerX
        // 将局部网格坐标绕页面中心旋转 rad
        const cx = pageW / 2 + lx * cos - ly * sin
        const cy = pageH / 2 + lx * sin + ly * cos
        // 裁剪掉完全在页面外围的冗余印章，减小 PDF 指令体积
        const boundR = Math.hypot(stampW, stampH) / 2
        if (cx + boundR < 0 || cx - boundR > pageW || cy + boundR < 0 || cy - boundR > pageH) continue
        list.push({ cx, cy })
      }
    }
    return list
  }

  // 单点九宫格定位
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const rotW = stampW * cos + stampH * sin
  const rotH = stampW * sin + stampH * cos
  const m = Math.max(0, opts.margin)
  const row = opts.anchor[0]
  const col = opts.anchor[1]

  let cx = pageW / 2
  let cy = pageH / 2
  if (col === 'l') cx = m + rotW / 2
  else if (col === 'r') cx = pageW - m - rotW / 2
  if (row === 't') cy = m + rotH / 2
  else if (row === 'b') cy = pageH - m - rotH / 2

  return [{ cx, cy }]
}

/**
 * 在右侧预览 Canvas 上实时绘制水印与页码覆盖层（与最终 pdf-lib 输出坐标完全一致）
 */
export function drawPreviewOverlay(
  canvas: HTMLCanvasElement,
  pageW: number,
  pageH: number,
  pageIndex0: number,
  totalPages: number,
  opts: PdfWatermarkOptions,
  logo: ImageBitmap | null,
) {
  const ctx = canvas.getContext('2d')!
  const scaleX = canvas.width / Math.max(1, pageW)
  const scaleY = canvas.height / Math.max(1, pageH)
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  ctx.save()
  ctx.scale(scaleX, scaleY)

  // 1. 水印层预览
  if (shouldApplyWatermarkOnPage(pageIndex0, totalPages, opts)) {
    ctx.save()
    ctx.globalAlpha = Math.max(0.03, Math.min(1, opts.opacity / 100))

    let stampW = 0
    let stampH = 0
    const lines = opts.text
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0)

    if (opts.watermarkType === 'image' && logo) {
      stampW = opts.logoWidth
      stampH = (logo.height / logo.width) * opts.logoWidth
    } else if (opts.watermarkType === 'text' && lines.length) {
      const weight = opts.bold ? '700' : '400'
      ctx.font = `${weight} ${opts.fontSize}px ${FONT_STACKS[opts.fontStyle]}`
      for (const l of lines) {
        const mw = ctx.measureText(l).width
        if (mw > stampW) stampW = mw
      }
      stampH = lines.length * opts.fontSize * 1.32
    }

    if (stampW > 0 && stampH > 0) {
      const placements = computeStampCenters(pageW, pageH, stampW, stampH, opts)
      const rad = (opts.angle * Math.PI) / 180
      for (const p of placements) {
        ctx.save()
        ctx.translate(p.cx, p.cy)
        ctx.rotate(rad)
        if (opts.watermarkType === 'image' && logo) {
          ctx.drawImage(logo, -stampW / 2, -stampH / 2, stampW, stampH)
        } else {
          ctx.fillStyle = opts.color
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          const lh = opts.fontSize * 1.32
          const sy = -((lines.length - 1) * lh) / 2
          lines.forEach((l, i) => ctx.fillText(l, 0, sy + i * lh))
        }
        ctx.restore()
      }
    }
    ctx.restore()
  }

  // 2. 页码层预览
  const pageNumText = getPageNumberTextForPage(pageIndex0, totalPages, opts)
  if (pageNumText) {
    ctx.save()
    ctx.font = `500 ${opts.pageNumSize}px ${FONT_STACKS.sans}`
    ctx.fillStyle = opts.pageNumColor
    ctx.textBaseline = 'middle'
    const m = opts.pageNumMargin
    const isTop = opts.pageNumPos[0] === 't'
    const col = opts.pageNumPos[1]
    const y = isTop ? m + opts.pageNumSize * 0.5 : pageH - m - opts.pageNumSize * 0.5
    let x = pageW / 2
    if (col === 'l') {
      ctx.textAlign = 'left'
      x = m
    } else if (col === 'r') {
      ctx.textAlign = 'right'
      x = pageW - m
    } else {
      ctx.textAlign = 'center'
    }
    ctx.fillText(pageNumText, x, y)
    ctx.restore()
  }

  ctx.restore()
}

/** 获取作用在指定页码（1-based）上的全部打码遮挡块 */
export function getRedactionsForPage(marks: RedactMark[], pageNum1: number): RedactMark[] {
  return marks.filter((m) => m.applyAllPages || m.page === pageNum1)
}

/**
 * 将 PDF.js 视图归一化坐标（左上角原点，已含旋转）换算为 pdf-lib 未旋转页面坐标系（左下角原点）
 * 确保 0° / 90° / 180° / 270° 旋转的 PDF 页面打码位置 100% 精准零偏差
 */
function viewportNormRectToPdf(
  mark: RedactMark,
  page: PDFPage,
): { x: number; y: number; w: number; h: number } {
  const { width: rawW, height: rawH } = page.getSize()
  const rot = ((page.getRotation().angle % 360) + 360) % 360

  // 归一化矩形的 4 个角（视图坐标系：u 向右 0..1，v 向下 0..1）
  const u1 = mark.x
  const u2 = mark.x + mark.w
  const v1 = mark.y
  const v2 = mark.y + mark.h

  const mapPoint = (u: number, v: number): [number, number] => {
    switch (rot) {
      case 90:
        return [v * rawW, u * rawH]
      case 180:
        return [(1 - u) * rawW, v * rawH]
      case 270:
        return [(1 - v) * rawW, (1 - u) * rawH]
      case 0:
      default:
        return [u * rawW, (1 - v) * rawH]
    }
  }

  const pts = [mapPoint(u1, v1), mapPoint(u2, v1), mapPoint(u2, v2), mapPoint(u1, v2)]
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** 在 PDF 页面上写入纯色矢量打码块 */
function drawRedactionVectorOnPdfPage(page: PDFPage, mark: RedactMark) {
  const rect = viewportNormRectToPdf(mark, page)
  const fill = hexToRgb(mark.color)
  if (mark.shape === 'ellipse') {
    page.drawEllipse({
      x: rect.x + rect.w / 2,
      y: rect.y + rect.h / 2,
      xScale: rect.w / 2,
      yScale: rect.h / 2,
      color: fill,
      opacity: 1,
    })
  } else {
    page.drawRectangle({
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
      color: fill,
      opacity: 1,
    })
  }
}

/**
 * 将包含打码块的单页以高清位图烘焙（防复制彻底抹除底层敏感文字），
 * 返回可直接覆盖整页的 PNG 字节以及展示视图尺寸
 */
async function bakeRedactedPageToPng(
  pdfJsDoc: Awaited<ReturnType<typeof openPdfDocument>>['doc'],
  pageNum1: number,
  pageMarks: RedactMark[],
): Promise<{ pngBytes: Uint8Array; viewW: number; viewH: number }> {
  const page = await pdfJsDoc.getPage(pageNum1)
  const baseVp = page.getViewport({ scale: 1 })
  // 2.4× 高清倍率（上限 2400px 防超大图内存飙升），既清晰锐利又兼顾文件体积
  const renderScale = Math.min(2.4, 2400 / Math.max(baseVp.width, baseVp.height))
  const vp = page.getViewport({ scale: renderScale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(vp.width))
  canvas.height = Math.max(1, Math.round(vp.height))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise
  page.cleanup()

  // 将所有打码色块直接烧录进像素，彻底销毁底层敏感信息
  for (const m of pageMarks) {
    ctx.save()
    ctx.fillStyle = m.color
    const px = m.x * canvas.width
    const py = m.y * canvas.height
    const pw = m.w * canvas.width
    const ph = m.h * canvas.height
    if (m.shape === 'ellipse') {
      ctx.beginPath()
      ctx.ellipse(px + pw / 2, py + ph / 2, pw / 2, ph / 2, 0, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillRect(px, py, pw, ph)
    }
    ctx.restore()
  }

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`第 ${pageNum1} 页脱敏烘焙失败`))), 'image/jpeg', 0.94),
  )
  canvas.width = 0
  canvas.height = 0
  return {
    pngBytes: new Uint8Array(await blob.arrayBuffer()),
    viewW: baseVp.width,
    viewH: baseVp.height,
  }
}

/**
 * 使用 pdf-lib 为单份 PDF 真正写入打码遮挡、水印与页码
 * - 普通模式：保留原 PDF 全部矢量文字与链接，以矢量纯色块覆盖
 * - 防复制物理抹除模式（opts.flattenRedactedPages）：仅对存在打码块的页面进行高清位图烘焙替换，无打码页仍保持原矢量无损
 */
export async function applyWatermarkToPdf(
  rawBytes: Uint8Array,
  opts: PdfWatermarkOptions,
  logo: ImageBitmap | null,
  redactions: RedactMark[] = [],
): Promise<Blob> {
  let pdfDoc: PDFDocument
  try {
    pdfDoc = await PDFDocument.load(rawBytes, { ignoreEncryption: false })
  } catch {
    throw new Error('该 PDF 已加密或受权限保护，无法直接修改')
  }

  const totalPages = pdfDoc.getPageCount()

  // 0. 若开启“物理抹除底层文字”且存在打码块，仅将有打码的页面替换为烘焙后的干净图像页
  let openedForBake: Awaited<ReturnType<typeof openPdfDocument>> | null = null
  const bakedPageIndices = new Set<number>()
  if (opts.flattenRedactedPages && redactions.length > 0) {
    try {
      openedForBake = await openPdfDocument(rawBytes)
      for (let i = 0; i < totalPages; i++) {
        const pageMarks = getRedactionsForPage(redactions, i + 1)
        if (!pageMarks.length) continue
        const baked = await bakeRedactedPageToPng(openedForBake.doc, i + 1, pageMarks)
        const embImg = await pdfDoc.embedJpg(baked.pngBytes)
        // 删除原含敏感文字的页面并在原索引插入纯净位图页
        pdfDoc.removePage(i)
        const freshPage = pdfDoc.insertPage(i, [baked.viewW, baked.viewH])
        freshPage.drawImage(embImg, {
          x: 0,
          y: 0,
          width: baked.viewW,
          height: baked.viewH,
        })
        bakedPageIndices.add(i)
      }
    } finally {
      if (openedForBake) await openedForBake.destroy()
    }
  }

  const pages = pdfDoc.getPages()

  // 1. 构建并全局嵌入一次水印印章对象（全文档复用，体积几乎不膨胀）
  let stampAsset: StampImageAsset | null = null
  if (opts.enableWatermark) {
    if (opts.watermarkType === 'image' && logo) {
      stampAsset = await buildLogoStampAsset(logo, opts.logoWidth)
    } else if (opts.watermarkType === 'text' && opts.text.trim()) {
      stampAsset = await buildTextStampAsset(opts.text, opts.fontSize, opts.fontStyle, opts.bold, opts.color, 3)
    }
  }
  const embeddedStamp = stampAsset ? await pdfDoc.embedPng(stampAsset.pngBytes) : null

  // 2. 准备页码字体（纯 ASCII 直接用原生 Helvetica 矢量字体；含中文用 3× 清晰透明 PNG 印章）
  const isAsciiPageNum =
    opts.pageNumStyle === 'n' || opts.pageNumStyle === '-n-' || opts.pageNumStyle === 'n/total'
  const helvetica = opts.enablePageNum && isAsciiPageNum ? await pdfDoc.embedFont(StandardFonts.Helvetica) : null
  const pageNumRgb = hexToRgb(opts.pageNumColor)

  // 3. 逐页绘制打码遮挡（矢量模式）、水印与页码
  const opacity = Math.max(0.03, Math.min(1, opts.opacity / 100))
  // PDF 坐标系 Y 轴朝上，逆时针为正；因此 Canvas 顺时针角度 angle 在 PDF 中取 -angle
  const pdfAngleDeg = -opts.angle
  const radPdf = (pdfAngleDeg * Math.PI) / 180

  for (let i = 0; i < totalPages; i++) {
    const page = pages[i]
    const { width: pageW, height: pageH } = page.getSize()

    // 写入纯色打码遮挡（若该页已经位图烘焙则无需重复画）
    if (!bakedPageIndices.has(i) && redactions.length > 0) {
      const pageMarks = getRedactionsForPage(redactions, i + 1)
      for (const mark of pageMarks) {
        drawRedactionVectorOnPdfPage(page, mark)
      }
    }

    // 写入水印
    if (embeddedStamp && stampAsset && shouldApplyWatermarkOnPage(i, totalPages, opts)) {
      const placements = computeStampCenters(pageW, pageH, stampAsset.widthPt, stampAsset.heightPt, opts)
      const hw = stampAsset.widthPt / 2
      const hh = stampAsset.heightPt / 2
      const cos = Math.cos(radPdf)
      const sin = Math.sin(radPdf)

      for (const p of placements) {
        // 将 Canvas 中心点 (cx, cy) 换算为 PDF 坐标系中心点 (cx, pageH - cy)
        const pdfCx = p.cx
        const pdfCy = pageH - p.cy
        // pdf-lib drawImage 绕左下角 (x, y) 旋转；反推左下角位置使图片精确居中于 (pdfCx, pdfCy)
        const x = pdfCx - (hw * cos - hh * sin)
        const y = pdfCy - (hw * sin + hh * cos)

        page.drawImage(embeddedStamp, {
          x,
          y,
          width: stampAsset.widthPt,
          height: stampAsset.heightPt,
          rotate: degrees(pdfAngleDeg),
          opacity,
        })
      }
    }

    // 写入页码
    const pageNumText = getPageNumberTextForPage(i, totalPages, opts)
    if (pageNumText) {
      const m = opts.pageNumMargin
      const isTop = opts.pageNumPos[0] === 't'
      const col = opts.pageNumPos[1]

      if (helvetica) {
        const tw = helvetica.widthOfTextAtSize(pageNumText, opts.pageNumSize)
        const x = col === 'l' ? m : col === 'r' ? pageW - m - tw : (pageW - tw) / 2
        const y = isTop ? pageH - m - opts.pageNumSize : m
        page.drawText(pageNumText, {
          x,
          y,
          size: opts.pageNumSize,
          font: helvetica,
          color: pageNumRgb,
        })
      } else {
        // 中文页码：3× 超清透明 PNG 印章精确落位
        const numAsset = await buildTextStampAsset(pageNumText, opts.pageNumSize, 'sans', false, opts.pageNumColor, 3)
        if (numAsset) {
          const embNum = await pdfDoc.embedPng(numAsset.pngBytes)
          const x =
            col === 'l' ? m : col === 'r' ? pageW - m - numAsset.widthPt : (pageW - numAsset.widthPt) / 2
          const y = isTop ? pageH - m - numAsset.heightPt : m - numAsset.heightPt * 0.2
          page.drawImage(embNum, {
            x,
            y,
            width: numAsset.widthPt,
            height: numAsset.heightPt,
          })
          numAsset.previewCanvas.width = 0
          numAsset.previewCanvas.height = 0
        }
      }
    }
  }

  if (stampAsset) {
    stampAsset.previewCanvas.width = 0
    stampAsset.previewCanvas.height = 0
  }

  const saved = await pdfDoc.save()
  const buf = saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer
  return new Blob([buf], { type: 'application/pdf' })
}

/** 批量为多份 PDF 加打码/水印/页码并打包 ZIP */
export async function applyWatermarkBatchZip(
  items: { name: string; bytes: Uint8Array; redactions?: RedactMark[] }[],
  opts: PdfWatermarkOptions,
  logo: ImageBitmap | null,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {}
  const used = new Map<string, number>()

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const blob = await applyWatermarkToPdf(it.bytes, opts, logo, it.redactions ?? [])
    const base = it.name.replace(/\.pdf$/i, '') || `doc-${i + 1}`
    const suffix = it.redactions?.length && !opts.enableWatermark && !opts.enablePageNum ? '打码' : '处理'
    const rawName = `${base}-${suffix}.pdf`
    const count = used.get(rawName) ?? 0
    const finalName = count > 0 ? `${base}-${suffix}-${count + 1}.pdf` : rawName
    used.set(rawName, count + 1)
    entries[finalName] = new Uint8Array(await blob.arrayBuffer())
    onProgress?.(i + 1, items.length)
  }

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data)))
  })
  const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
  return new Blob([buf], { type: 'application/zip' })
}
