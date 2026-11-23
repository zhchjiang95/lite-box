/**
 * 二维码核心生成与离线解码引擎
 * - 矩阵生成：qrcode（QRCode.create 同步拿到精确的布尔矩阵）
 * - 渲染输出：自研 Canvas 2D 高清渲染器 + 等价无损矢量 SVG 构建器
 * - 批量打包：fflate 无损 ZIP 导出（支持 PNG / SVG）
 * - 离线解码：优先尝试 BarcodeDetector（若浏览器原生提供），通用兜底使用 jsQR 多尺度 + 反色识别
 */

import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { zipSync, strToU8 } from 'fflate'
import { canvasToBlob } from '@/lib/file'
import { decodeImageFile } from '@/lib/image'
import type { GradientAngle, LogoAsset, QrStyleConfig } from './types'

export interface QrMatrix {
  size: number
  data: Uint8Array
}

export interface DecodePoint {
  x: number
  y: number
}

export interface QrDecodeResult {
  text: string
  /** 四顶点坐标（归一化到原图像素坐标） */
  location: [DecodePoint, DecodePoint, DecodePoint, DecodePoint] | null
  /** 图像宽高 */
  width: number
  height: number
  /** 预览 URL（调用方负责释放） */
  previewUrl: string
  /** 使用的解码引擎名称 */
  engine: 'BarcodeDetector' | 'jsQR'
}

/** 同步生成二维码布尔矩阵 */
export function createQrMatrix(text: string, ecLevel: QrStyleConfig['ecLevel']): QrMatrix {
  const qr = QRCode.create(text, { errorCorrectionLevel: ecLevel })
  return {
    size: qr.modules.size,
    data: qr.modules.data,
  }
}

/** 判断坐标 (r, c) 是否位于三个 7×7 定位码眼（含外框与中心瞳孔）区域 */
function isInFinderPattern(r: number, c: number, size: number): boolean {
  const inTopLeft = r < 7 && c < 7
  const inTopRight = r < 7 && c >= size - 7
  const inBottomLeft = r >= size - 7 && c < 7
  return inTopLeft || inTopRight || inBottomLeft
}

/** 判断坐标是否落在中心 Logo 安全清空区（避免码点与 Logo 边缘打架） */
function isInLogoClearArea(r: number, c: number, size: number, logoScale: number, hasLogo: boolean): boolean {
  if (!hasLogo) return false
  // 给 Logo 四周留出 1 格左右的安全留白
  const clearModules = Math.ceil(size * logoScale) + 2
  const half = clearModules / 2
  const center = size / 2
  return Math.abs(r + 0.5 - center) < half && Math.abs(c + 0.5 - center) < half
}

/** 将角度映射为渐变起止点（归一化 [0..1]） */
function angleToUnitPoints(angle: GradientAngle): [number, number, number, number] {
  switch (angle) {
    case 0:
      return [0, 0.5, 1, 0.5]
    case 45:
      return [0, 1, 1, 0]
    case 90:
      return [0.5, 0, 0.5, 1]
    case 135:
    default:
      return [0, 0, 1, 1]
  }
}

/** 计算二维码总画布布局（支持底部说明文字） */
function computeLayout(size: number, style: QrStyleConfig, canvasWidth: number) {
  const totalModules = size + style.margin * 2
  const cellSize = canvasWidth / totalModules
  const qrHeight = canvasWidth
  const captionText = style.caption.trim()
  const captionHeight = captionText ? Math.round(canvasWidth * 0.115) : 0
  const totalHeight = qrHeight + captionHeight
  return { totalModules, cellSize, qrHeight, captionText, captionHeight, totalHeight }
}

/** 绘制圆角矩形路径（支持四角独立圆角） */
function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: [number, number, number, number],
) {
  const [tl, tr, br, bl] = radii
  ctx.beginPath()
  ctx.moveTo(x + tl, y)
  ctx.lineTo(x + w - tr, y)
  if (tr > 0) ctx.quadraticCurveTo(x + w, y, x + w, y + tr)
  ctx.lineTo(x + w, y + h - br)
  if (br > 0) ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h)
  ctx.lineTo(x + bl, y + h)
  if (bl > 0) ctx.quadraticCurveTo(x, y + h, x, y + h - bl)
  ctx.lineTo(x, y + tl)
  if (tl > 0) ctx.quadraticCurveTo(x, y, x + tl, y)
  ctx.closePath()
}

/** 生成 SVG 四角独立圆角矩形的 d 路径 */
function svgRoundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  radii: [number, number, number, number],
): string {
  const f = (n: number) => Number(n.toFixed(2))
  const [tl, tr, br, bl] = radii.map(f)
  const x1 = f(x)
  const y1 = f(y)
  const x2 = f(x + w)
  const y2 = f(y + h)
  return [
    `M${f(x1 + tl)},${y1}`,
    `L${f(x2 - tr)},${y1}`,
    tr > 0 ? `Q${x2},${y1} ${x2},${f(y1 + tr)}` : '',
    `L${x2},${f(y2 - br)}`,
    br > 0 ? `Q${x2},${y2} ${f(x2 - br)},${y2}` : '',
    `L${f(x1 + bl)},${y2}`,
    bl > 0 ? `Q${x1},${y2} ${x1},${f(y2 - bl)}` : '',
    `L${x1},${f(y1 + tl)}`,
    tl > 0 ? `Q${x1},${y1} ${f(x1 + tl)},${y1}` : '',
    'Z',
  ]
    .filter(Boolean)
    .join(' ')
}

/** Canvas 绘制单个 7×7 定位码眼 */
function drawFinderEyeCanvas(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cell: number,
  eyeStyle: QrStyleConfig['eyeStyle'],
  fill: string | CanvasGradient,
) {
  const outerSize = cell * 7
  const innerHoleSize = cell * 5
  const pupilSize = cell * 3

  ctx.save()
  ctx.fillStyle = fill

  if (eyeStyle === 'circle') {
    const cx = x + outerSize / 2
    const cy = y + outerSize / 2
    // 使用奇偶填充绘制标准环形外框（透明底也能干净镂空）
    ctx.beginPath()
    ctx.arc(cx, cy, outerSize / 2, 0, Math.PI * 2)
    ctx.arc(cx, cy, innerHoleSize / 2, 0, Math.PI * 2, true)
    ctx.fill('evenodd')
    // 内瞳圆点
    ctx.beginPath()
    ctx.arc(cx, cy, pupilSize / 2, 0, Math.PI * 2)
    ctx.fill()
  } else {
    const outerR = eyeStyle === 'rounded' ? cell * 1.9 : 0
    const holeR = eyeStyle === 'rounded' ? cell * 1.15 : 0
    const pupilR = eyeStyle === 'rounded' ? cell * 0.85 : 0

    // 外框使用 path + evenodd 镂空，确保透明背景下码眼中间也是完全透明
    ctx.beginPath()
    addRoundedRectSubpath(ctx, x, y, outerSize, outerSize, outerR, false)
    addRoundedRectSubpath(ctx, x + cell, y + cell, innerHoleSize, innerHoleSize, holeR, true)
    ctx.fill('evenodd')

    // 内瞳
    traceRoundedRect(ctx, x + cell * 2, y + cell * 2, pupilSize, pupilSize, [pupilR, pupilR, pupilR, pupilR])
    ctx.fill()
  }

  ctx.restore()
}

/** 向当前路径追加圆角矩形子路径（支持逆时针用于 evenodd 镂空） */
function addRoundedRectSubpath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  ccw: boolean,
) {
  const radius = Math.min(r, w / 2, h / 2)
  if (!ccw) {
    ctx.moveTo(x + radius, y)
    ctx.lineTo(x + w - radius, y)
    if (radius > 0) ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
    ctx.lineTo(x + w, y + h - radius)
    if (radius > 0) ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
    ctx.lineTo(x + radius, y + h)
    if (radius > 0) ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
    ctx.lineTo(x, y + radius)
    if (radius > 0) ctx.quadraticCurveTo(x, y, x + radius, y)
    ctx.closePath()
  } else {
    ctx.moveTo(x + radius, y)
    if (radius > 0) ctx.quadraticCurveTo(x, y, x, y + radius)
    ctx.lineTo(x, y + h - radius)
    if (radius > 0) ctx.quadraticCurveTo(x, y + h, x + radius, y + h)
    ctx.lineTo(x + w - radius, y + h)
    if (radius > 0) ctx.quadraticCurveTo(x + w, y + h, x + w, y + h - radius)
    ctx.lineTo(x + w, y + radius)
    if (radius > 0) ctx.quadraticCurveTo(x + w, y, x + w - radius, y)
    ctx.lineTo(x + radius, y)
    ctx.closePath()
  }
}

/** 渲染高质量二维码到指定 Canvas */
export function renderQrToCanvas(
  canvas: HTMLCanvasElement,
  matrix: QrMatrix,
  style: QrStyleConfig,
  logo: LogoAsset | null,
  targetWidth: number,
): void {
  const { size, data } = matrix
  const { cellSize, qrHeight, captionText, captionHeight, totalHeight } = computeLayout(size, style, targetWidth)

  canvas.width = targetWidth
  canvas.height = totalHeight
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, targetWidth, totalHeight)

  // 1. 背景填充（透明底时跳过）
  if (style.bgColor !== 'transparent') {
    ctx.fillStyle = style.bgColor
    ctx.fillRect(0, 0, targetWidth, totalHeight)
  }

  // 2. 前景色画刷（纯色或线性渐变）
  let fgFill: string | CanvasGradient = style.fgColor
  if (style.useGradient) {
    const [x1, y1, x2, y2] = angleToUnitPoints(style.gradientAngle)
    const grad = ctx.createLinearGradient(x1 * targetWidth, y1 * qrHeight, x2 * targetWidth, y2 * qrHeight)
    grad.addColorStop(0, style.fgColor)
    grad.addColorStop(1, style.fgColorEnd)
    fgFill = grad
  }

  const eyeFill: string | CanvasGradient = style.customEyeColor ? style.eyeColor : fgFill
  const offset = style.margin * cellSize

  // 辅助读取数据点（剔除定位眼与 Logo 安全清空区）
  const hasLogo = Boolean(logo)
  const isDataDark = (r: number, c: number) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return false
    if (isInFinderPattern(r, c, size)) return false
    if (isInLogoClearArea(r, c, size, style.logoScale, hasLogo)) return false
    return Boolean(data[r * size + c])
  }

  // 3. 绘制三个 7×7 定位码眼
  const finderCoords: [number, number][] = [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]
  for (const [fr, fc] of finderCoords) {
    drawFinderEyeCanvas(ctx, offset + fc * cellSize, offset + fr * cellSize, cellSize, style.eyeStyle, eyeFill)
  }

  // 4. 绘制数据码点
  ctx.fillStyle = fgFill
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isDataDark(r, c)) continue
      const x = offset + c * cellSize
      const y = offset + r * cellSize

      if (style.dotStyle === 'square') {
        // 微微放大 0.35px 消除小数坐标的抗锯齿缝隙
        ctx.fillRect(x - 0.15, y - 0.15, cellSize + 0.3, cellSize + 0.3)
      } else if (style.dotStyle === 'rounded') {
        const pad = cellSize * 0.08
        const s = cellSize - pad * 2
        const rad = s * 0.34
        traceRoundedRect(ctx, x + pad, y + pad, s, s, [rad, rad, rad, rad])
        ctx.fill()
      } else if (style.dotStyle === 'dots') {
        ctx.beginPath()
        ctx.arc(x + cellSize / 2, y + cellSize / 2, cellSize * 0.43, 0, Math.PI * 2)
        ctx.fill()
      } else if (style.dotStyle === 'diamond') {
        const cx = x + cellSize / 2
        const cy = y + cellSize / 2
        const half = cellSize * 0.48
        ctx.beginPath()
        ctx.moveTo(cx, cy - half)
        ctx.lineTo(cx + half, cy)
        ctx.lineTo(cx, cy + half)
        ctx.lineTo(cx - half, cy)
        ctx.closePath()
        ctx.fill()
      } else if (style.dotStyle === 'fluid') {
        // 液态连接：无相邻方向自动圆角，有相邻方向平直无缝衔接
        const top = isDataDark(r - 1, c)
        const right = isDataDark(r, c + 1)
        const bottom = isDataDark(r + 1, c)
        const left = isDataDark(r, c - 1)
        const rad = cellSize * 0.48
        const radii: [number, number, number, number] = [
          !top && !left ? rad : 0,
          !top && !right ? rad : 0,
          !bottom && !right ? rad : 0,
          !bottom && !left ? rad : 0,
        ]
        traceRoundedRect(ctx, x - 0.2, y - 0.2, cellSize + 0.4, cellSize + 0.4, radii)
        ctx.fill()
      }
    }
  }

  // 5. 绘制中心 Logo（带安全背板）
  if (logo) {
    const qrInnerSize = size * cellSize
    const logoSize = qrInnerSize * style.logoScale
    const pad = Math.max(cellSize * 0.55, logoSize * 0.1)
    const boxSize = logoSize + pad * 2
    const cx = targetWidth / 2
    const cy = qrHeight / 2
    const bx = cx - boxSize / 2
    const by = cy - boxSize / 2
    const lx = cx - logoSize / 2
    const ly = cy - logoSize / 2

    ctx.save()
    // 衬底：若背景透明则用纯白衬底，否则沿用当前背景色
    ctx.fillStyle = style.bgColor === 'transparent' ? '#ffffff' : style.bgColor
    if (style.logoShape === 'circle') {
      ctx.beginPath()
      ctx.arc(cx, cy, boxSize / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      const boxR = boxSize * 0.22
      traceRoundedRect(ctx, bx, by, boxSize, boxSize, [boxR, boxR, boxR, boxR])
      ctx.fill()
    }

    // 裁切区域绘制 Logo（等比居中 cover/contain 自适应）
    ctx.beginPath()
    if (style.logoShape === 'circle') {
      ctx.arc(cx, cy, logoSize / 2, 0, Math.PI * 2)
    } else {
      const imgR = logoSize * 0.18
      traceRoundedRect(ctx, lx, ly, logoSize, logoSize, [imgR, imgR, imgR, imgR])
    }
    ctx.clip()

    const iw = logo.image.naturalWidth || logo.image.width
    const ih = logo.image.naturalHeight || logo.image.height
    const scale = Math.min(logoSize / iw, logoSize / ih)
    const dw = iw * scale
    const dh = ih * scale
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(logo.image, cx - dw / 2, cy - dh / 2, dw, dh)
    ctx.restore()
  }

  // 6. 绘制底部说明文字
  if (captionText && captionHeight > 0) {
    ctx.save()
    const fontSize = Math.round(targetWidth * 0.046)
    ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = style.customEyeColor ? style.eyeColor : style.fgColor
    ctx.fillText(captionText, targetWidth / 2, qrHeight + captionHeight * 0.42, targetWidth * 0.9)
    ctx.restore()
  }
}

/** XML 文本转义 */
function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 构建与 Canvas 完全一致的无损矢量 SVG 字符串 */
export function buildQrSvgString(
  matrix: QrMatrix,
  style: QrStyleConfig,
  logo: LogoAsset | null,
  viewWidth = 1024,
): string {
  const { size, data } = matrix
  const { cellSize, qrHeight, captionText, captionHeight, totalHeight } = computeLayout(size, style, viewWidth)
  const f = (n: number) => Number(n.toFixed(2))
  const offset = style.margin * cellSize

  const defs: string[] = []
  let fgFillAttr = style.fgColor
  if (style.useGradient) {
    const [x1, y1, x2, y2] = angleToUnitPoints(style.gradientAngle)
    defs.push(
      `<linearGradient id="qr-fg-grad" x1="${x1 * 100}%" y1="${y1 * 100}%" x2="${x2 * 100}%" y2="${y2 * 100}%">` +
        `<stop offset="0%" stop-color="${style.fgColor}"/>` +
        `<stop offset="100%" stop-color="${style.fgColorEnd}"/>` +
        `</linearGradient>`,
    )
    fgFillAttr = 'url(#qr-fg-grad)'
  }

  const eyeFillAttr = style.customEyeColor ? style.eyeColor : fgFillAttr
  const hasLogo = Boolean(logo)

  const isDataDark = (r: number, c: number) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return false
    if (isInFinderPattern(r, c, size)) return false
    if (isInLogoClearArea(r, c, size, style.logoScale, hasLogo)) return false
    return Boolean(data[r * size + c])
  }

  const parts: string[] = []

  // 背景
  if (style.bgColor !== 'transparent') {
    parts.push(`<rect width="${viewWidth}" height="${totalHeight}" fill="${style.bgColor}"/>`)
  }

  // 三个定位码眼
  const finderCoords: [number, number][] = [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]
  const eyePaths: string[] = []
  for (const [fr, fc] of finderCoords) {
    const x = offset + fc * cellSize
    const y = offset + fr * cellSize
    const outer = cellSize * 7
    const hole = cellSize * 5
    const pupil = cellSize * 3

    if (style.eyeStyle === 'circle') {
      const cx = f(x + outer / 2)
      const cy = f(y + outer / 2)
      const rOut = f(outer / 2)
      const rIn = f(hole / 2)
      const rPupil = f(pupil / 2)
      // SVG 外环 + 镂空内圆（evenodd）+ 实心瞳孔
      eyePaths.push(
        `<path fill-rule="evenodd" d="M${cx - rOut},${cy} a${rOut},${rOut} 0 1,0 ${rOut * 2},0 a${rOut},${rOut} 0 1,0 -${rOut * 2},0 M${cx - rIn},${cy} a${rIn},${rIn} 0 1,0 ${rIn * 2},0 a${rIn},${rIn} 0 1,0 -${rIn * 2},0"/>`,
      )
      eyePaths.push(`<circle cx="${cx}" cy="${cy}" r="${rPupil}"/>`)
    } else {
      const outerR = style.eyeStyle === 'rounded' ? cellSize * 1.9 : 0
      const holeR = style.eyeStyle === 'rounded' ? cellSize * 1.15 : 0
      const pupilR = style.eyeStyle === 'rounded' ? cellSize * 0.85 : 0
      const dOuter = svgRoundedRectPath(x, y, outer, outer, [outerR, outerR, outerR, outerR])
      const dHole = svgRoundedRectPath(x + cellSize, y + cellSize, hole, hole, [holeR, holeR, holeR, holeR])
      const dPupil = svgRoundedRectPath(x + cellSize * 2, y + cellSize * 2, pupil, pupil, [
        pupilR,
        pupilR,
        pupilR,
        pupilR,
      ])
      eyePaths.push(`<path fill-rule="evenodd" d="${dOuter} ${dHole}"/>`)
      eyePaths.push(`<path d="${dPupil}"/>`)
    }
  }
  parts.push(`<g fill="${eyeFillAttr}">${eyePaths.join('')}</g>`)

  // 数据码点（合并为一个 <path> 大幅缩小 SVG 体积并保证矢量无缝）
  const dSegments: string[] = []
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isDataDark(r, c)) continue
      const x = offset + c * cellSize
      const y = offset + r * cellSize

      if (style.dotStyle === 'square') {
        const s = f(cellSize + 0.15)
        dSegments.push(`M${f(x)},${f(y)}h${s}v${s}h-${s}Z`)
      } else if (style.dotStyle === 'rounded') {
        const pad = cellSize * 0.08
        const s = cellSize - pad * 2
        const rad = s * 0.34
        dSegments.push(svgRoundedRectPath(x + pad, y + pad, s, s, [rad, rad, rad, rad]))
      } else if (style.dotStyle === 'dots') {
        const cx = f(x + cellSize / 2)
        const cy = f(y + cellSize / 2)
        const rad = f(cellSize * 0.43)
        dSegments.push(`M${f(cx - rad)},${cy}a${rad},${rad} 0 1,0 ${f(rad * 2)},0a${rad},${rad} 0 1,0 -${f(rad * 2)},0`)
      } else if (style.dotStyle === 'diamond') {
        const cx = f(x + cellSize / 2)
        const cy = f(y + cellSize / 2)
        const half = f(cellSize * 0.48)
        dSegments.push(`M${cx},${f(cy - half)}L${f(cx + half)},${cy}L${cx},${f(cy + half)}L${f(cx - half)},${cy}Z`)
      } else if (style.dotStyle === 'fluid') {
        const top = isDataDark(r - 1, c)
        const right = isDataDark(r, c + 1)
        const bottom = isDataDark(r + 1, c)
        const left = isDataDark(r, c - 1)
        const rad = cellSize * 0.48
        dSegments.push(
          svgRoundedRectPath(x - 0.1, y - 0.1, cellSize + 0.2, cellSize + 0.2, [
            !top && !left ? rad : 0,
            !top && !right ? rad : 0,
            !bottom && !right ? rad : 0,
            !bottom && !left ? rad : 0,
          ]),
        )
      }
    }
  }
  parts.push(`<path fill="${fgFillAttr}" d="${dSegments.join(' ')}"/>`)

  // 中心 Logo（内联 dataURL，脱离网页仍独立可用）
  if (logo) {
    const qrInnerSize = size * cellSize
    const logoSize = qrInnerSize * style.logoScale
    const pad = Math.max(cellSize * 0.55, logoSize * 0.1)
    const boxSize = logoSize + pad * 2
    const cx = viewWidth / 2
    const cy = qrHeight / 2
    const boxFill = style.bgColor === 'transparent' ? '#ffffff' : style.bgColor

    if (style.logoShape === 'circle') {
      defs.push(`<clipPath id="qr-logo-clip"><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(logoSize / 2)}"/></clipPath>`)
      parts.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(boxSize / 2)}" fill="${boxFill}"/>`)
    } else {
      const imgR = f(logoSize * 0.18)
      const boxR = f(boxSize * 0.22)
      defs.push(
        `<clipPath id="qr-logo-clip"><rect x="${f(cx - logoSize / 2)}" y="${f(cy - logoSize / 2)}" width="${f(logoSize)}" height="${f(logoSize)}" rx="${imgR}"/></clipPath>`,
      )
      parts.push(
        `<rect x="${f(cx - boxSize / 2)}" y="${f(cy - boxSize / 2)}" width="${f(boxSize)}" height="${f(boxSize)}" rx="${boxR}" fill="${boxFill}"/>`,
      )
    }

    parts.push(
      `<image href="${logo.dataUrl}" x="${f(cx - logoSize / 2)}" y="${f(cy - logoSize / 2)}" width="${f(logoSize)}" height="${f(logoSize)}" preserveAspectRatio="xMidYMid meet" clip-path="url(#qr-logo-clip)"/>`,
    )
  }

  // 底部说明文字
  if (captionText && captionHeight > 0) {
    const fontSize = Math.round(viewWidth * 0.046)
    const textFill = style.customEyeColor ? style.eyeColor : style.fgColor
    parts.push(
      `<text x="${viewWidth / 2}" y="${f(qrHeight + captionHeight * 0.45)}" text-anchor="middle" dominant-baseline="middle" font-family="-apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei, sans-serif" font-size="${fontSize}" font-weight="600" fill="${textFill}">${escapeXml(captionText)}</text>`,
    )
  }

  const defsTag = defs.length ? `<defs>${defs.join('')}</defs>` : ''
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewWidth} ${totalHeight}" width="${viewWidth}" height="${totalHeight}">${defsTag}${parts.join('')}</svg>`
}

/** 导出高清 PNG Blob */
export async function exportQrPngBlob(
  matrix: QrMatrix,
  style: QrStyleConfig,
  logo: LogoAsset | null,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  renderQrToCanvas(canvas, matrix, style, logo, style.exportSize)
  try {
    return await canvasToBlob(canvas, 'image/png')
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

/** 导出 SVG Blob */
export function exportQrSvgBlob(matrix: QrMatrix, style: QrStyleConfig, logo: LogoAsset | null): Blob {
  const svg = buildQrSvgString(matrix, style, logo, style.exportSize)
  return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
}

/** 加载并标准化上传的 Logo 文件（自动缩放到 512px 内转 PNG dataURL，兼顾清晰度与 SVG 体积） */
export async function loadLogoAsset(file: File): Promise<LogoAsset> {
  const decoded = await decodeImageFile(file)
  try {
    const maxSide = 512
    const scale = Math.min(1, maxSide / Math.max(decoded.width, decoded.height))
    const w = Math.max(1, Math.round(decoded.width * scale))
    const h = Math.max(1, Math.round(decoded.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(decoded.bitmap, 0, 0, w, h)
    const dataUrl = canvas.toDataURL('image/png')
    canvas.width = 0
    canvas.height = 0

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Logo 图片加载失败'))
      el.src = dataUrl
    })

    return { image, dataUrl, name: file.name }
  } finally {
    decoded.bitmap.close()
    URL.revokeObjectURL(decoded.previewUrl)
  }
}

/** 清理批量导出文件名中的非法字符 */
function sanitizeFilename(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\r\n]+/g, '_')
    .trim()
    .slice(0, 48)
  return cleaned || fallback
}

export interface BatchQrItem {
  filename: string
  content: string
}

/** 解析批量多行文本：支持 `自定义名称 | 二维码内容` 或纯每行一个内容 */
export function parseBatchLines(raw: string): BatchQrItem[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const used = new Map<string, number>()
  return lines.map((line, index) => {
    const pipeIdx = line.indexOf('|')
    let baseName = ''
    let content = line
    if (pipeIdx > 0 && pipeIdx < line.length - 1) {
      baseName = line.slice(0, pipeIdx).trim()
      content = line.slice(pipeIdx + 1).trim()
    }
    const rawName = sanitizeFilename(baseName || content.replace(/^https?:\/\//i, ''), `qr-${index + 1}`)
    const count = used.get(rawName) ?? 0
    used.set(rawName, count + 1)
    const uniqueName = count === 0 ? rawName : `${rawName}-${count + 1}`
    return { filename: uniqueName, content }
  })
}

/** 批量生成二维码并打包为 ZIP */
export async function exportBatchQrZip(
  items: BatchQrItem[],
  style: QrStyleConfig,
  logo: LogoAsset | null,
  format: 'png' | 'svg',
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const files: Record<string, Uint8Array> = {}
  const canvas = document.createElement('canvas')

  try {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const matrix = createQrMatrix(item.content, style.ecLevel)
      if (format === 'svg') {
        const svg = buildQrSvgString(matrix, style, logo, style.exportSize)
        files[`${item.filename}.svg`] = strToU8(svg)
      } else {
        renderQrToCanvas(canvas, matrix, style, logo, style.exportSize)
        const blob = await canvasToBlob(canvas, 'image/png')
        files[`${item.filename}.png`] = new Uint8Array(await blob.arrayBuffer())
      }
      onProgress?.(i + 1, items.length)
      // 每 6 张让出一帧避免阻塞 UI 进度条刷新
      if (i % 6 === 5) {
        await new Promise((r) => setTimeout(r, 0))
      }
    }
  } finally {
    canvas.width = 0
    canvas.height = 0
  }

  const zipped = zipSync(files, { level: format === 'svg' ? 6 : 0 })
  return new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' })
}

/** 浏览器原生 BarcodeDetector 的宽松类型声明 */
interface NativeBarcodeDetector {
  detect(source: ImageBitmapSource): Promise<
    Array<{
      rawValue: string
      cornerPoints?: Array<{ x: number; y: number }>
    }>
  >
}

interface NativeBarcodeDetectorCtor {
  new (options?: { formats?: string[] }): NativeBarcodeDetector
  getSupportedFormats?: () => Promise<string[]>
}

/** 从 Canvas 图像数据中运行 jsQR（含多尺度与反色兜底） */
function decodeBitmapWithJsQr(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): { text: string; location: [DecodePoint, DecodePoint, DecodePoint, DecodePoint] } | null {
  const maxDim = Math.max(width, height)
  // 依次尝试适合识别的分辨率：超大照片先缩放到 1280px 往往比原图噪点更少、识别更快
  const targets: number[] = []
  if (maxDim > 1400) targets.push(1280)
  targets.push(Math.min(maxDim, 2200))
  if (maxDim > 800) targets.push(720)
  if (maxDim < 400) targets.push(Math.min(800, maxDim * 2))

  const uniqueTargets = Array.from(new Set(targets))
  const canvas = document.createElement('canvas')

  try {
    for (const targetMax of uniqueTargets) {
      const scale = targetMax / maxDim
      const w = Math.max(1, Math.round(width * scale))
      const h = Math.max(1, Math.round(height * scale))
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.imageSmoothingEnabled = scale < 1
      ctx.drawImage(bitmap, 0, 0, w, h)
      const imgData = ctx.getImageData(0, 0, w, h)

      const res = jsQR(imgData.data, w, h, { inversionAttempts: 'attemptBoth' })
      if (res && res.data) {
        const invScale = 1 / scale
        const loc = res.location
        return {
          text: res.data,
          location: [
            { x: loc.topLeftCorner.x * invScale, y: loc.topLeftCorner.y * invScale },
            { x: loc.topRightCorner.x * invScale, y: loc.topRightCorner.y * invScale },
            { x: loc.bottomRightCorner.x * invScale, y: loc.bottomRightCorner.y * invScale },
            { x: loc.bottomLeftCorner.x * invScale, y: loc.bottomLeftCorner.y * invScale },
          ],
        }
      }
    }
    return null
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

/** 离线解码任意图片文件中的二维码（支持 PNG / JPG / WebP / SVG / iPhone HEIC） */
export async function decodeQrFromImageFile(file: File): Promise<QrDecodeResult> {
  const decoded = await decodeImageFile(file)
  try {
    // 1. 若浏览器支持原生 BarcodeDetector（如 Chrome macOS/Android），优先尝试
    const DetectorCtor = (window as unknown as { BarcodeDetector?: NativeBarcodeDetectorCtor }).BarcodeDetector
    if (DetectorCtor) {
      try {
        const supported = DetectorCtor.getSupportedFormats ? await DetectorCtor.getSupportedFormats() : ['qr_code']
        if (supported.includes('qr_code')) {
          const detector = new DetectorCtor({ formats: ['qr_code'] })
          const hits = await detector.detect(decoded.bitmap)
          const first = hits.find((h) => h.rawValue)
          if (first) {
            const pts = first.cornerPoints
            const location: [DecodePoint, DecodePoint, DecodePoint, DecodePoint] | null =
              pts && pts.length === 4
                ? [
                    { x: pts[0].x, y: pts[0].y },
                    { x: pts[1].x, y: pts[1].y },
                    { x: pts[2].x, y: pts[2].y },
                    { x: pts[3].x, y: pts[3].y },
                  ]
                : null
            return {
              text: first.rawValue,
              location,
              width: decoded.width,
              height: decoded.height,
              previewUrl: decoded.previewUrl,
              engine: 'BarcodeDetector',
            }
          }
        }
      } catch {
        // 原生识别异常时静默降级至 jsQR
      }
    }

    // 2. 通用离线解码：jsQR 多尺度 + 反色尝试
    const fallback = decodeBitmapWithJsQr(decoded.bitmap, decoded.width, decoded.height)
    if (fallback) {
      return {
        text: fallback.text,
        location: fallback.location,
        width: decoded.width,
        height: decoded.height,
        previewUrl: decoded.previewUrl,
        engine: 'jsQR',
      }
    }

    URL.revokeObjectURL(decoded.previewUrl)
    throw new Error('未在图片中检测到二维码，请确保二维码清晰完整、对比度充足')
  } finally {
    decoded.bitmap.close()
  }
}

/** 从摄像头视频帧中解码单帧二维码 */
export function decodeQrFromVideoFrame(
  video: HTMLVideoElement,
  scratchCanvas: HTMLCanvasElement,
): { text: string; location: [DecodePoint, DecodePoint, DecodePoint, DecodePoint]; width: number; height: number } | null {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return null

  const scale = Math.min(1, 960 / Math.max(vw, vh))
  const w = Math.round(vw * scale)
  const h = Math.round(vh * scale)
  if (scratchCanvas.width !== w || scratchCanvas.height !== h) {
    scratchCanvas.width = w
    scratchCanvas.height = h
  }
  const ctx = scratchCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  ctx.drawImage(video, 0, 0, w, h)
  const imgData = ctx.getImageData(0, 0, w, h)
  const res = jsQR(imgData.data, w, h, { inversionAttempts: 'attemptBoth' })
  if (!res || !res.data) return null

  const loc = res.location
  return {
    text: res.data,
    width: w,
    height: h,
    location: [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner],
  }
}
