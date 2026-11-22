/**
 * 身份证 / 证件正反面 A4 排版核心引擎
 * - 严格按物理毫米尺寸（1 mm = 72 / 25.4 pt）计算 A4 排版坐标
 * - 纯 JS 单应性矩阵（Homography）+ 双线性插值实现四点透视拉直
 * - 扫描增白去底灰 / 黑白复印机打印滤镜
 * - 导出 1:1 标准 A4 PDF（pdf-lib）、300 DPI 高清 A4 图片、一键调用浏览器打印
 */

import { PDFDocument, rgb } from 'pdf-lib'
import { canvasToBlob } from '@/lib/file'
import {
  getActiveDocSpec,
  type CardEditState,
  type CardSide,
  type CardSource,
  type Point2D,
  type PrintOptions,
  type RectNorm,
} from './types'

/** 物理毫米转 PDF 点（1 inch = 25.4 mm = 72 pt） */
export const MM_TO_PT = 72 / 25.4
/** A4 纵向物理尺寸（mm） */
export const A4_PORTRAIT_W_MM = 210
export const A4_PORTRAIT_H_MM = 297
/** 打印级 300 DPI 对应每毫米像素数 */
export const PRINT_PX_PER_MM = 300 / 25.4

/** A4 页面上的单个证件槽位（单位：mm） */
export interface LayoutSlot {
  side: CardSide
  xMm: number
  yMm: number
  wMm: number
  hMm: number
  radiusMm: number
}

/** 完整 A4 排版几何描述 */
export interface A4LayoutPlan {
  pageWmm: number
  pageHmm: number
  orientation: 'portrait' | 'landscape'
  cardWmm: number
  cardHmm: number
  slots: LayoutSlot[]
  cutLine?: { x1Mm: number; y1Mm: number; x2Mm: number; y2Mm: number }
  overflowWarning: boolean
}

/** 根据目标宽高比计算居中最大矩形选区（归一化 0~1） */
export function computeCenteredRect(srcW: number, srcH: number, targetAspect: number): RectNorm {
  const srcAspect = srcW / Math.max(1, srcH)
  if (srcAspect > targetAspect) {
    const w = targetAspect / srcAspect
    return { x: (1 - w) / 2, y: 0, w, h: 1 }
  }
  const h = srcAspect / targetAspect
  return { x: 0, y: (1 - h) / 2, w: 1, h }
}

/** 为刚导入的图片生成默认裁切与四点透视初始状态 */
export function createDefaultCardEdit(
  srcW: number,
  srcH: number,
  targetAspect: number,
  rotation90: 0 | 90 | 180 | 270 = 0,
): CardEditState {
  const rotW = rotation90 === 90 || rotation90 === 270 ? srcH : srcW
  const rotH = rotation90 === 90 || rotation90 === 270 ? srcW : srcH
  const rect = computeCenteredRect(rotW, rotH, targetAspect)
  // 四点初始位置略微内缩 4%，方便用户直接拖拽角点
  const padX = rect.w * 0.04
  const padY = rect.h * 0.04
  const x0 = Math.max(0.02, rect.x + padX)
  const y0 = Math.max(0.02, rect.y + padY)
  const x1 = Math.min(0.98, rect.x + rect.w - padX)
  const y1 = Math.min(0.98, rect.y + rect.h - padY)
  return {
    mode: 'rect',
    rotation90,
    fineAngle: 0,
    rect,
    quad: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  }
}

/** 将源 ImageBitmap 顺时针旋转 0/90/180/270° 并绘制到离屏 Canvas（可限制最大边以提升预览流畅度） */
export function buildRotatedSourceCanvas(
  bitmap: ImageBitmap,
  rotation90: 0 | 90 | 180 | 270,
  maxSide?: number,
): HTMLCanvasElement {
  const swap = rotation90 === 90 || rotation90 === 270
  const rawW = swap ? bitmap.height : bitmap.width
  const rawH = swap ? bitmap.width : bitmap.height
  const scale = maxSide ? Math.min(1, maxSide / Math.max(rawW, rawH)) : 1
  const outW = Math.max(1, Math.round(rawW * scale))
  const outH = Math.max(1, Math.round(rawH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  ctx.save()
  ctx.translate(outW / 2, outH / 2)
  ctx.rotate((rotation90 * Math.PI) / 180)
  const drawW = swap ? outH : outW
  const drawH = swap ? outW : outH
  ctx.drawImage(bitmap, -drawW / 2, -drawH / 2, drawW, drawH)
  ctx.restore()
  return canvas
}

/**
 * 求解 8 元线性方程组 A·x = b（部分主元高斯消元法）
 * 用于精确求解 3×3 单应性透视变换矩阵（Homography）
 */
function solveLinear8(A: number[][], b: number[]): number[] | null {
  const n = 8
  const M = A.map((row, i) => [...row, b[i]])

  for (let col = 0; col < n; col++) {
    let pivotRow = col
    let maxVal = Math.abs(M[col][col])
    for (let r = col + 1; r < n; r++) {
      const val = Math.abs(M[r][col])
      if (val > maxVal) {
        maxVal = val
        pivotRow = r
      }
    }
    if (maxVal < 1e-10) return null
    if (pivotRow !== col) {
      const tmp = M[col]
      M[col] = M[pivotRow]
      M[pivotRow] = tmp
    }

    const pivot = M[col][col]
    for (let j = col; j <= n; j++) M[col][j] /= pivot

    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = M[r][col]
      if (Math.abs(factor) < 1e-12) continue
      for (let j = col; j <= n; j++) {
        M[r][j] -= factor * M[col][j]
      }
    }
  }
  return M.map((row) => row[n])
}

/**
 * 计算将目标矩形 (0,0)-(outW,0)-(outW,outH)-(0,outH) 映射到源图四边形的逆单应性矩阵
 */
function computeInverseHomography(
  outW: number,
  outH: number,
  dstQuadPx: [Point2D, Point2D, Point2D, Point2D],
): number[] | null {
  const srcCorners: [Point2D, Point2D, Point2D, Point2D] = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ]
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const x = srcCorners[i].x
    const y = srcCorners[i].y
    const u = dstQuadPx[i].x
    const v = dstQuadPx[i].y
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u])
    b.push(u)
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v])
    b.push(v)
  }
  return solveLinear8(A, b)
}

/**
 * 执行四点透视拉直（逆向映射 + 双线性插值）
 * 边缘越界像素填充纯白，确保打印到白纸上干净无杂边
 */
function warpPerspectiveToCanvas(
  srcCanvas: HTMLCanvasElement,
  quadNorm: [Point2D, Point2D, Point2D, Point2D],
  outW: number,
  outH: number,
): HTMLCanvasElement {
  const sw = srcCanvas.width
  const sh = srcCanvas.height
  const quadPx: [Point2D, Point2D, Point2D, Point2D] = [
    { x: quadNorm[0].x * sw, y: quadNorm[0].y * sh },
    { x: quadNorm[1].x * sw, y: quadNorm[1].y * sh },
    { x: quadNorm[2].x * sw, y: quadNorm[2].y * sh },
    { x: quadNorm[3].x * sw, y: quadNorm[3].y * sh },
  ]

  const outCanvas = document.createElement('canvas')
  outCanvas.width = outW
  outCanvas.height = outH
  const outCtx = outCanvas.getContext('2d')!

  const h = computeInverseHomography(outW, outH, quadPx)
  if (!h) {
    // 退化四边形兜底：直接铺满绘制
    outCtx.fillStyle = '#ffffff'
    outCtx.fillRect(0, 0, outW, outH)
    outCtx.drawImage(srcCanvas, 0, 0, outW, outH)
    return outCanvas
  }

  const srcCtx = srcCanvas.getContext('2d')!
  const srcData = srcCtx.getImageData(0, 0, sw, sh).data
  const outImg = outCtx.createImageData(outW, outH)
  const dst = outImg.data

  const [h0, h1, h2, h3, h4, h5, h6, h7] = h
  const maxX = sw - 1
  const maxY = sh - 1

  for (let dy = 0; dy < outH; dy++) {
    const rowOffset = dy * outW * 4
    const hy0 = h1 * dy + h2
    const hy3 = h4 * dy + h5
    const hy6 = h7 * dy + 1

    for (let dx = 0; dx < outW; dx++) {
      const denom = h6 * dx + hy6
      const sx = (h0 * dx + hy0) / denom
      const sy = (h3 * dx + hy3) / denom
      const idx = rowOffset + dx * 4

      if (sx < 0 || sy < 0 || sx > maxX || sy > maxY) {
        dst[idx] = 255
        dst[idx + 1] = 255
        dst[idx + 2] = 255
        dst[idx + 3] = 255
        continue
      }

      const x0 = sx | 0
      const y0 = sy | 0
      const x1 = x0 < maxX ? x0 + 1 : maxX
      const y1 = y0 < maxY ? y0 + 1 : maxY
      const fx = sx - x0
      const fy = sy - y0
      const fx1 = 1 - fx
      const fy1 = 1 - fy

      const w00 = fx1 * fy1
      const w10 = fx * fy1
      const w01 = fx1 * fy
      const w11 = fx * fy

      const i00 = (y0 * sw + x0) * 4
      const i10 = (y0 * sw + x1) * 4
      const i01 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4

      dst[idx] = srcData[i00] * w00 + srcData[i10] * w10 + srcData[i01] * w01 + srcData[i11] * w11
      dst[idx + 1] =
        srcData[i00 + 1] * w00 + srcData[i10 + 1] * w10 + srcData[i01 + 1] * w01 + srcData[i11 + 1] * w11
      dst[idx + 2] =
        srcData[i00 + 2] * w00 + srcData[i10 + 2] * w10 + srcData[i01 + 2] * w01 + srcData[i11 + 2] * w11
      dst[idx + 3] = 255
    }
  }

  outCtx.putImageData(outImg, 0, 0)
  return outCanvas
}

/** 执行常规比例裁剪 + 微调旋转 */
function cropRectToCanvas(
  srcCanvas: HTMLCanvasElement,
  rect: RectNorm,
  fineAngleDeg: number,
  outW: number,
  outH: number,
): HTMLCanvasElement {
  const sw = srcCanvas.width
  const sh = srcCanvas.height
  const outCanvas = document.createElement('canvas')
  outCanvas.width = outW
  outCanvas.height = outH
  const ctx = outCanvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, outW, outH)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const cx = (rect.x + rect.w / 2) * sw
  const cy = (rect.y + rect.h / 2) * sh
  const cw = Math.max(1, rect.w * sw)
  const ch = Math.max(1, rect.h * sh)

  ctx.save()
  ctx.translate(outW / 2, outH / 2)
  ctx.scale(outW / cw, outH / ch)
  if (Math.abs(fineAngleDeg) > 0.01) {
    ctx.rotate((fineAngleDeg * Math.PI) / 180)
  }
  ctx.drawImage(srcCanvas, -cx, -cy)
  ctx.restore()
  return outCanvas
}

/** 打印增强滤镜：扫描增白去底灰 / 黑白复印机 / 亮度对比度微调 */
function applyCardFilterInPlace(canvas: HTMLCanvasElement, opts: PrintOptions) {
  const needFilter = opts.filter !== 'original' || opts.brightness !== 0 || opts.contrast !== 0
  if (!needFilter) return

  const ctx = canvas.getContext('2d')!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data

  const brightOffset = opts.brightness * 1.8
  const contrastFactor = (100 + opts.contrast * 1.6) / 100

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i]
    let g = d[i + 1]
    let b = d[i + 2]

    if (opts.filter === 'scan') {
      // 扫描增白去底灰：提亮浅灰背景至纯净纸白，同时略微加深文字笔划对比度
      const luma = 0.299 * r + 0.587 * g + 0.114 * b
      // 柔和的 S 曲线拉伸白点（约 215 以上推向 255，暗部保持清晰）
      const whiteLift = luma > 155 ? ((luma - 155) / 100) * 34 : 0
      r = (r - 120) * 1.18 + 128 + whiteLift
      g = (g - 120) * 1.18 + 128 + whiteLift
      b = (b - 120) * 1.18 + 128 + whiteLift
    } else if (opts.filter === 'bw') {
      // 黑白复印机：高对比度灰度，白底干净省墨且保留人像灰阶层次
      let gray = 0.299 * r + 0.587 * g + 0.114 * b
      // 将 [32, 212] 线性拉伸至 [0, 255]
      gray = ((gray - 32) / 180) * 255
      // 柔和增强文字清晰度
      gray = gray < 0 ? 0 : gray > 255 ? 255 : gray
      r = g = b = gray
    }

    // 叠加用户手动亮度与对比度微调
    if (opts.brightness !== 0 || opts.contrast !== 0) {
      r = (r - 128) * contrastFactor + 128 + brightOffset
      g = (g - 128) * contrastFactor + 128 + brightOffset
      b = (b - 128) * contrastFactor + 128 + brightOffset
    }

    d[i] = r < 0 ? 0 : r > 255 ? 255 : r
    d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g
    d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b
  }

  ctx.putImageData(img, 0, 0)
}

/** 对处理好的证件 Canvas 进行标准圆角裁切（透明背景） */
function applyRoundedCorners(srcCanvas: HTMLCanvasElement, radiusPx: number): HTMLCanvasElement {
  if (radiusPx <= 0.5) return srcCanvas
  const out = document.createElement('canvas')
  out.width = srcCanvas.width
  out.height = srcCanvas.height
  const ctx = out.getContext('2d')!
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(0, 0, out.width, out.height, radiusPx)
  ctx.clip()
  ctx.drawImage(srcCanvas, 0, 0)
  ctx.restore()
  srcCanvas.width = 0
  srcCanvas.height = 0
  return out
}

/**
 * 渲染单面证件到指定像素宽高（包含旋转、裁剪/透视拉直、打印滤镜、标准圆角）
 */
export function renderProcessedCard(
  source: CardSource,
  opts: PrintOptions,
  outW: number,
  outH: number,
  options?: { maxSourceSide?: number; applyRadius?: boolean },
): HTMLCanvasElement {
  const srcCanvas = buildRotatedSourceCanvas(source.bitmap, source.edit.rotation90, options?.maxSourceSide)
  let cardCanvas: HTMLCanvasElement

  if (source.edit.mode === 'perspective') {
    cardCanvas = warpPerspectiveToCanvas(srcCanvas, source.edit.quad, outW, outH)
  } else {
    cardCanvas = cropRectToCanvas(srcCanvas, source.edit.rect, source.edit.fineAngle, outW, outH)
  }
  srcCanvas.width = 0
  srcCanvas.height = 0

  applyCardFilterInPlace(cardCanvas, opts)

  if (options?.applyRadius !== false && opts.roundCorners) {
    const spec = getActiveDocSpec(opts)
    if (spec.radiusMm > 0) {
      const radiusPx = (spec.radiusMm / spec.widthMm) * outW
      cardCanvas = applyRoundedCorners(cardCanvas, radiusPx)
    }
  }
  return cardCanvas
}

/** 计算 A4 纸张上的精确物理毫米排版坐标 */
export function computeA4Layout(opts: PrintOptions): A4LayoutPlan {
  const spec = getActiveDocSpec(opts)
  const scale = opts.scalePercent / 100
  const cardW = spec.widthMm * scale
  const cardH = spec.heightMm * scale
  const radiusMm = opts.roundCorners ? spec.radiusMm * scale : 0
  const gap = opts.gapMm

  const landscape = opts.layout === 'landscape-pair'
  const pageW = landscape ? A4_PORTRAIT_H_MM : A4_PORTRAIT_W_MM
  const pageH = landscape ? A4_PORTRAIT_W_MM : A4_PORTRAIT_H_MM
  const slots: LayoutSlot[] = []
  let cutLine: A4LayoutPlan['cutLine']
  let overflowWarning = false

  if (opts.layout === 'vertical-center') {
    const totalH = cardH * 2 + gap
    const x = (pageW - cardW) / 2
    const y1 = (pageH - totalH) / 2
    const y2 = y1 + cardH + gap
    slots.push(
      { side: 'front', xMm: x, yMm: y1, wMm: cardW, hMm: cardH, radiusMm },
      { side: 'back', xMm: x, yMm: y2, wMm: cardW, hMm: cardH, radiusMm },
    )
    overflowWarning = x < 4 || y1 < 4 || y2 + cardH > pageH - 4
  } else if (opts.layout === 'double-set') {
    // 优先采用上下两套（每套为左右并排，A4 横向中线一刀切为两张 A5 复印件）
    const horizontalGap = Math.min(gap, Math.max(8, pageW - cardW * 2 - 20))
    const fitsRow = cardW * 2 + horizontalGap <= pageW - 12
    const halfH = pageH / 2

    if (fitsRow) {
      const x1 = (pageW - (cardW * 2 + horizontalGap)) / 2
      const x2 = x1 + cardW + horizontalGap
      const yTop = (halfH - cardH) / 2
      const yBot = halfH + yTop
      slots.push(
        { side: 'front', xMm: x1, yMm: yTop, wMm: cardW, hMm: cardH, radiusMm },
        { side: 'back', xMm: x2, yMm: yTop, wMm: cardW, hMm: cardH, radiusMm },
        { side: 'front', xMm: x1, yMm: yBot, wMm: cardW, hMm: cardH, radiusMm },
        { side: 'back', xMm: x2, yMm: yBot, wMm: cardW, hMm: cardH, radiusMm },
      )
      cutLine = { x1Mm: 10, y1Mm: halfH, x2Mm: pageW - 10, y2Mm: halfH }
      overflowWarning = x1 < 4 || yTop < 4
    } else {
      // 护照/户口本等宽幅证件在双份模式自动纵向堆叠两套并提示是否超边
      const subGap = Math.min(gap, 10)
      const setH = cardH * 2 + subGap
      const x = (pageW - cardW) / 2
      const y1 = (halfH - setH) / 2
      const y2 = halfH + y1
      slots.push(
        { side: 'front', xMm: x, yMm: y1, wMm: cardW, hMm: cardH, radiusMm },
        { side: 'back', xMm: x, yMm: y1 + cardH + subGap, wMm: cardW, hMm: cardH, radiusMm },
        { side: 'front', xMm: x, yMm: y2, wMm: cardW, hMm: cardH, radiusMm },
        { side: 'back', xMm: x, yMm: y2 + cardH + subGap, wMm: cardW, hMm: cardH, radiusMm },
      )
      cutLine = { x1Mm: 10, y1Mm: halfH, x2Mm: pageW - 10, y2Mm: halfH }
      overflowWarning = x < 4 || y1 < 3 || setH > halfH - 4
    }
  } else if (opts.layout === 'horizontal-portrait') {
    const safeGap = Math.min(gap, Math.max(6, pageW - cardW * 2 - 12))
    const totalW = cardW * 2 + safeGap
    const x1 = (pageW - totalW) / 2
    const x2 = x1 + cardW + safeGap
    const y = (pageH - cardH) / 2
    slots.push(
      { side: 'front', xMm: x1, yMm: y, wMm: cardW, hMm: cardH, radiusMm },
      { side: 'back', xMm: x2, yMm: y, wMm: cardW, hMm: cardH, radiusMm },
    )
    overflowWarning = x1 < 4 || y < 4
  } else {
    // landscape-pair: 横向 A4 并排
    const totalW = cardW * 2 + gap
    const x1 = (pageW - totalW) / 2
    const x2 = x1 + cardW + gap
    const y = (pageH - cardH) / 2
    slots.push(
      { side: 'front', xMm: x1, yMm: y, wMm: cardW, hMm: cardH, radiusMm },
      { side: 'back', xMm: x2, yMm: y, wMm: cardW, hMm: cardH, radiusMm },
    )
    overflowWarning = x1 < 4 || y < 4
  }

  return {
    pageWmm: pageW,
    pageHmm: pageH,
    orientation: landscape ? 'landscape' : 'portrait',
    cardWmm: cardW,
    cardHmm: cardH,
    slots,
    cutLine,
    overflowWarning,
  }
}

/** 构造带可选日期的水印文字 */
export function buildWatermarkDisplayText(opts: PrintOptions): string {
  const base = opts.watermarkText.trim()
  if (!base) return ''
  if (!opts.watermarkIncludeDate) return base
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return `${base}\n${dateStr}`
}

/** 在指定画布上下文上绘制防盗用途签注水印（按像素/毫米比例精确缩放） */
export function drawWatermarkLayer(
  ctx: CanvasRenderingContext2D,
  layout: A4LayoutPlan,
  opts: PrintOptions,
  pxPerMm: number,
) {
  if (!opts.enableWatermark) return
  const text = buildWatermarkDisplayText(opts)
  if (!text) return

  const lines = text.split('\n').filter(Boolean)
  if (!lines.length) return

  const fontSizePx = (opts.watermarkFontSize / MM_TO_PT) * pxPerMm
  const lineHeight = fontSizePx * 1.38
  const rad = (opts.watermarkAngle * Math.PI) / 180

  const paintTiledRegion = (rx: number, ry: number, rw: number, rh: number, radiusPx: number, dense: boolean) => {
    ctx.save()
    ctx.beginPath()
    if (radiusPx > 0.5) {
      ctx.roundRect(rx, ry, rw, rh, radiusPx)
    } else {
      ctx.rect(rx, ry, rw, rh)
    }
    ctx.clip()

    ctx.globalAlpha = opts.watermarkOpacity / 100
    ctx.fillStyle = opts.watermarkColor
    ctx.font = `600 ${fontSizePx}px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const maxLineW = Math.max(...lines.map((l) => ctx.measureText(l).width), fontSizePx * 2)
    const blockH = lines.length * lineHeight
    const stepX = maxLineW + (dense ? fontSizePx * 1.8 : fontSizePx * 4.2)
    const stepY = blockH + (dense ? fontSizePx * 2.2 : fontSizePx * 4.5)

    const cx = rx + rw / 2
    const cy = ry + rh / 2
    const diag = Math.hypot(rw, rh)
    const cols = Math.ceil(diag / stepX) + 2
    const rows = Math.ceil(diag / stepY) + 2

    ctx.translate(cx, cy)
    ctx.rotate(rad)

    for (let r = -rows; r <= rows; r++) {
      const staggerX = Math.abs(r) % 2 === 1 ? stepX * 0.5 : 0
      for (let c = -cols; c <= cols; c++) {
        const px = c * stepX + staggerX
        const py = r * stepY
        lines.forEach((line, idx) => {
          const offsetY = (idx - (lines.length - 1) / 2) * lineHeight
          ctx.fillText(line, px, py + offsetY)
        })
      }
    }
    ctx.restore()
  }

  if (opts.watermarkScope === 'cards') {
    for (const slot of layout.slots) {
      paintTiledRegion(
        slot.xMm * pxPerMm,
        slot.yMm * pxPerMm,
        slot.wMm * pxPerMm,
        slot.hMm * pxPerMm,
        slot.radiusMm * pxPerMm,
        true,
      )
    }
  } else {
    paintTiledRegion(0, 0, layout.pageWmm * pxPerMm, layout.pageHmm * pxPerMm, 0, false)
  }
}

/**
 * 将整个 A4 排版渲染到 Canvas（可用于实时预览，也可用于 300 DPI 高清图导出与直接打印）
 */
export function renderA4SheetToCanvas(
  canvas: HTMLCanvasElement,
  cards: { front: CardSource | null; back: CardSource | null },
  opts: PrintOptions,
  pxPerMm: number,
  options?: { isPreview?: boolean; maxSourceSide?: number },
): A4LayoutPlan {
  const layout = computeA4Layout(opts)
  const spec = getActiveDocSpec(opts)
  const outW = Math.max(1, Math.round(layout.pageWmm * pxPerMm))
  const outH = Math.max(1, Math.round(layout.pageHmm * pxPerMm))

  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')!

  // 1. 纯白 A4 纸底
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, outW, outH)

  // 2. 分别渲染正面/反面一次并复用到全部槽位（双份排版无需重复计算）
  const cardPxW = Math.max(40, Math.round(layout.cardWmm * pxPerMm))
  const cardPxH = Math.max(40, Math.round(layout.cardHmm * pxPerMm))
  const rendered: Partial<Record<CardSide, HTMLCanvasElement>> = {}

  if (cards.front) {
    rendered.front = renderProcessedCard(cards.front, opts, cardPxW, cardPxH, {
      maxSourceSide: options?.maxSourceSide,
    })
  }
  if (cards.back) {
    rendered.back = renderProcessedCard(cards.back, opts, cardPxW, cardPxH, {
      maxSourceSide: options?.maxSourceSide,
    })
  }

  // 3. 绘制每个证件槽位
  for (const slot of layout.slots) {
    const x = slot.xMm * pxPerMm
    const y = slot.yMm * pxPerMm
    const w = slot.wMm * pxPerMm
    const h = slot.hMm * pxPerMm
    const r = slot.radiusMm * pxPerMm
    const imgCanvas = rendered[slot.side]

    if (imgCanvas) {
      ctx.drawImage(imgCanvas, x, y, w, h)
      if (opts.cardBorder) {
        ctx.save()
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)'
        ctx.lineWidth = Math.max(1, 0.25 * pxPerMm)
        ctx.beginPath()
        if (r > 0.5) ctx.roundRect(x, y, w, h, r)
        else ctx.rect(x, y, w, h)
        ctx.stroke()
        ctx.restore()
      }
    } else if (options?.isPreview) {
      // 预览模式下未上传的一侧显示友好虚线占位提示
      ctx.save()
      ctx.fillStyle = '#f8fafc'
      ctx.strokeStyle = '#cbd5e1'
      ctx.lineWidth = Math.max(1, 0.45 * pxPerMm)
      ctx.setLineDash([4 * pxPerMm * 0.4, 3 * pxPerMm * 0.4])
      ctx.beginPath()
      if (r > 0.5) ctx.roundRect(x, y, w, h, r)
      else ctx.rect(x, y, w, h)
      ctx.fill()
      ctx.stroke()

      ctx.setLineDash([])
      ctx.fillStyle = '#94a3b8'
      const labelSize = Math.max(11, Math.min(w * 0.08, 4.6 * pxPerMm))
      ctx.font = `500 ${labelSize}px "PingFang SC", "Microsoft YaHei", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const title = slot.side === 'front' ? spec.frontLabel : spec.backLabel
      ctx.fillText(title, x + w / 2, y + h / 2 - labelSize * 0.65)
      ctx.font = `400 ${labelSize * 0.78}px ui-monospace, SFMono-Regular, monospace`
      ctx.fillStyle = '#cbd5e1'
      ctx.fillText(`${layout.cardWmm.toFixed(1)} × ${layout.cardHmm.toFixed(1)} mm`, x + w / 2, y + h / 2 + labelSize * 0.8)
      ctx.restore()
    }
  }

  // 释放临时证件画布
  rendered.front && ((rendered.front.width = 0), (rendered.front.height = 0))
  rendered.back && ((rendered.back.width = 0), (rendered.back.height = 0))

  // 4. 绘制双份模式下的裁剪参考虚线
  if (layout.cutLine && opts.cutGuides) {
    ctx.save()
    ctx.strokeStyle = '#94a3b8'
    ctx.lineWidth = Math.max(1, 0.3 * pxPerMm)
    ctx.setLineDash([3 * pxPerMm, 2.5 * pxPerMm])
    ctx.beginPath()
    ctx.moveTo(layout.cutLine.x1Mm * pxPerMm, layout.cutLine.y1Mm * pxPerMm)
    ctx.lineTo(layout.cutLine.x2Mm * pxPerMm, layout.cutLine.y2Mm * pxPerMm)
    ctx.stroke()
    ctx.restore()
  }

  // 5. 绘制防盗用途签注水印层
  drawWatermarkLayer(ctx, layout, opts, pxPerMm)

  return layout
}

/** 导出严格 1:1 真实物理尺寸的 A4 PDF */
export async function exportIdCardPdf(
  cards: { front: CardSource | null; back: CardSource | null },
  opts: PrintOptions,
): Promise<Blob> {
  const layout = computeA4Layout(opts)
  const pdfDoc = await PDFDocument.create()
  const pageWpt = layout.pageWmm * MM_TO_PT
  const pageHpt = layout.pageHmm * MM_TO_PT
  const page = pdfDoc.addPage([pageWpt, pageHpt])

  // 纯白背景
  page.drawRectangle({ x: 0, y: 0, width: pageWpt, height: pageHpt, color: rgb(1, 1, 1) })

  // 1. 按 300 DPI 渲染并嵌入正/反面高清 PNG（带标准圆角透明边与打印滤镜）
  const cardPxW = Math.max(60, Math.round(layout.cardWmm * PRINT_PX_PER_MM))
  const cardPxH = Math.max(60, Math.round(layout.cardHmm * PRINT_PX_PER_MM))
  const embedded: Partial<Record<CardSide, Awaited<ReturnType<PDFDocument['embedPng']>>>> = {}

  for (const side of ['front', 'back'] as const) {
    const src = cards[side]
    if (!src) continue
    const cardCanvas = renderProcessedCard(src, opts, cardPxW, cardPxH)
    const pngBlob = await canvasToBlob(cardCanvas, 'image/png')
    cardCanvas.width = 0
    cardCanvas.height = 0
    embedded[side] = await pdfDoc.embedPng(new Uint8Array(await pngBlob.arrayBuffer()))
  }

  // 2. 按精确毫米坐标绘制全部槽位
  for (const slot of layout.slots) {
    const img = embedded[slot.side]
    if (!img) continue
    const xPt = slot.xMm * MM_TO_PT
    const yPt = (layout.pageHmm - slot.yMm - slot.hMm) * MM_TO_PT
    const wPt = slot.wMm * MM_TO_PT
    const hPt = slot.hMm * MM_TO_PT
    page.drawImage(img, { x: xPt, y: yPt, width: wPt, height: hPt })

    if (opts.cardBorder) {
      page.drawRectangle({
        x: xPt,
        y: yPt,
        width: wPt,
        height: hPt,
        borderColor: rgb(0.58, 0.64, 0.72),
        borderOpacity: 0.45,
        borderWidth: 0.6,
      })
    }
  }

  // 3. 矢量绘制双份裁剪虚线
  if (layout.cutLine && opts.cutGuides) {
    page.drawLine({
      start: { x: layout.cutLine.x1Mm * MM_TO_PT, y: (layout.pageHmm - layout.cutLine.y1Mm) * MM_TO_PT },
      end: { x: layout.cutLine.x2Mm * MM_TO_PT, y: (layout.pageHmm - layout.cutLine.y2Mm) * MM_TO_PT },
      thickness: 0.75,
      color: rgb(0.58, 0.64, 0.72),
      dashArray: [6, 5],
    })
  }

  // 4. 如有中文防盗水印，生成 200 DPI 透明水印 PNG 叠加（完美支持中文且文件极轻）
  if (opts.enableWatermark && buildWatermarkDisplayText(opts)) {
    const wmPxPerMm = 200 / 25.4
    const wmCanvas = document.createElement('canvas')
    wmCanvas.width = Math.round(layout.pageWmm * wmPxPerMm)
    wmCanvas.height = Math.round(layout.pageHmm * wmPxPerMm)
    const wmCtx = wmCanvas.getContext('2d')!
    drawWatermarkLayer(wmCtx, layout, opts, wmPxPerMm)
    const wmBlob = await canvasToBlob(wmCanvas, 'image/png')
    wmCanvas.width = 0
    wmCanvas.height = 0
    const wmPng = await pdfDoc.embedPng(new Uint8Array(await wmBlob.arrayBuffer()))
    page.drawImage(wmPng, { x: 0, y: 0, width: pageWpt, height: pageHpt })
  }

  pdfDoc.setTitle('证件 A4 排版打印')
  pdfDoc.setCreator('轻匣 LiteBox（纯本地生成）')

  const pdfBytes = await pdfDoc.save()
  const copy = new Uint8Array(pdfBytes.byteLength)
  copy.set(pdfBytes)
  return new Blob([copy.buffer], { type: 'application/pdf' })
}

/** 导出 300 DPI 高清 A4 图片（PNG 或 JPG） */
export async function exportIdCardImage(
  cards: { front: CardSource | null; back: CardSource | null },
  opts: PrintOptions,
  format: 'png' | 'jpeg' = 'png',
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  renderA4SheetToCanvas(canvas, cards, opts, PRINT_PX_PER_MM)
  const blob = await canvasToBlob(canvas, format === 'png' ? 'image/png' : 'image/jpeg', 0.95)
  canvas.width = 0
  canvas.height = 0
  return blob
}

/** 直接调用浏览器原生打印（零弹窗拦截，严格按 A4 毫米尺寸出纸） */
export async function printIdCardA4(
  cards: { front: CardSource | null; back: CardSource | null },
  opts: PrintOptions,
): Promise<void> {
  const layout = computeA4Layout(opts)
  const blob = await exportIdCardImage(cards, opts, 'jpeg')
  const imgUrl = URL.createObjectURL(blob)

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.style.opacity = '0'
  iframe.style.pointerEvents = 'none'
  document.body.appendChild(iframe)

  const cleanup = () => {
    URL.revokeObjectURL(imgUrl)
    iframe.remove()
  }

  const doc = iframe.contentDocument
  if (!doc || !iframe.contentWindow) {
    cleanup()
    throw new Error('当前浏览器无法唤起打印窗口，请先导出 PDF 后打印')
  }

  doc.open()
  doc.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>证件 A4 打印</title>
  <style>
    @page { size: ${layout.pageWmm}mm ${layout.pageHmm}mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: ${layout.pageWmm}mm; height: ${layout.pageHmm}mm; background: #fff; overflow: hidden; }
    img { display: block; width: ${layout.pageWmm}mm; height: ${layout.pageHmm}mm; object-fit: contain; }
  </style>
</head>
<body>
  <img id="sheet" src="${imgUrl}" />
</body>
</html>`)
  doc.close()

  await new Promise<void>((resolve, reject) => {
    const img = doc.getElementById('sheet') as HTMLImageElement | null
    if (!img) {
      cleanup()
      reject(new Error('打印预览生成失败'))
      return
    }
    img.onload = () => {
      const win = iframe.contentWindow!
      win.addEventListener('afterprint', cleanup, { once: true })
      // 兜底回收，防止部分浏览器不触发 afterprint
      setTimeout(cleanup, 60_000)
      win.focus()
      win.print()
      resolve()
    }
    img.onerror = () => {
      cleanup()
      reject(new Error('打印图片加载失败'))
    }
  })
}
