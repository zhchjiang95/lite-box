/**
 * 印章生成器核心渲染引擎
 * - 统一几何布局计算（支持圆形公章、椭圆发票章、方形个人私章/篆刻、长方形审核/日期章）
 * - 高清 Canvas 2D 渲染 + 物理拟真印泥做旧算法（纯透明通道镂空，预览与高清导出纹理一致）
 * - 纯矢量 SVG 生成器（支持可选 SVG 拟真肌理滤镜）
 * - 本地自定义字体加载器 & 图片在线盖章合成
 */

import { canvasToBlob } from '@/lib/file'
import { FONT_OPTIONS, resolveExportDimensions, type ExportSizeMode, type SealConfig } from './types'

/** 渲染逻辑坐标盒信息 */
export interface SealMetrics {
  /** 逻辑画布总宽（含旋转外接盒与留白） */
  viewW: number
  /** 逻辑画布总高 */
  viewH: number
  /** 未旋转时的印章本体宽 */
  sealW: number
  /** 未旋转时的印章本体高 */
  sealH: number
  /** 画布中心 X */
  cx: number
  /** 画布中心 Y */
  cy: number
}

/** 根据配置解析最终 CSS font-family */
export function resolveFontFamily(fontId: string, customFontFamily?: string | null): string {
  if (fontId === 'custom' && customFontFamily) {
    return `"${customFontFamily}", "Songti SC", "SimSun", serif`
  }
  return FONT_OPTIONS.find((f) => f.id === fontId)?.family ?? FONT_OPTIONS[0].family
}

/** 计算逻辑画布尺寸（动态适配宽高比与旋转角度，绝不裁切边角） */
export function computeSealMetrics(config: SealConfig): SealMetrics {
  const aspect = Math.max(0.35, Math.min(3.5, config.physicalWidthMm / Math.max(1, config.physicalHeightMm)))
  const baseLong = 520
  let sealW = baseLong
  let sealH = baseLong
  if (aspect >= 1) {
    sealW = baseLong
    sealH = Math.round(baseLong / aspect)
  } else {
    sealH = baseLong
    sealW = Math.round(baseLong * aspect)
  }

  const rad = (config.rotation * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const rotW = sealW * cos + sealH * sin
  const rotH = sealW * sin + sealH * cos
  const pad = 38

  const viewW = Math.ceil(rotW + pad * 2)
  const viewH = Math.ceil(rotH + pad * 2)
  return {
    viewW,
    viewH,
    sealW,
    sealH,
    cx: viewW / 2,
    cy: viewH / 2,
  }
}

/** 构造标准共线五角星顶点（外半径 R，内半径遵循黄金比例使对边共线） */
function buildStarPoints(cx: number, cy: number, outerR: number): [number, number][] {
  const innerR = outerR * 0.38196601125
  const pts: [number, number][] = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR
    const angle = -Math.PI / 2 + (i * Math.PI) / 5
    pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)])
  }
  return pts
}

/** 在 Canvas 上绘制五角星路径 */
function traceStarPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, outerR: number) {
  const pts = buildStarPoints(cx, cy, outerR)
  ctx.beginPath()
  pts.forEach(([x, y], idx) => {
    if (idx === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.closePath()
}

/** 构造圆角矩形路径（兼容所有浏览器） */
function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.arcTo(x + w, y, x + w, y + rr, rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr)
  ctx.lineTo(x + rr, y + h)
  ctx.arcTo(x, y + h, x, y + h - rr, rr)
  ctx.lineTo(x, y + rr)
  ctx.arcTo(x, y, x + rr, y, rr)
  ctx.closePath()
}

/** 沿椭圆上半弧按真实弧长均匀采样每个字符的位置与切线角 */
interface ArcCharPose {
  char: string
  x: number
  y: number
  rotRad: number
}

function sampleEllipseTopArc(
  chars: string[],
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  spanDeg: number,
): ArcCharPose[] {
  if (chars.length === 0) return []
  if (chars.length === 1) {
    return [{ char: chars[0], x: cx, y: cy - ry, rotRad: 0 }]
  }

  // 在 Canvas 坐标系 (+x 右, +y 下) 中，椭圆顶部对应参数角 t = 1.5 * PI
  const halfSpan = (Math.min(250, Math.max(60, spanDeg)) * Math.PI) / 360
  const tStart = 1.5 * Math.PI - halfSpan
  const tEnd = 1.5 * Math.PI + halfSpan

  const steps = 360
  const ts = new Float64Array(steps + 1)
  const cum = new Float64Array(steps + 1)
  let prevX = cx + rx * Math.cos(tStart)
  let prevY = cy + ry * Math.sin(tStart)
  ts[0] = tStart
  cum[0] = 0

  for (let i = 1; i <= steps; i++) {
    const t = tStart + ((tEnd - tStart) * i) / steps
    const x = cx + rx * Math.cos(t)
    const y = cy + ry * Math.sin(t)
    ts[i] = t
    cum[i] = cum[i - 1] + Math.hypot(x - prevX, y - prevY)
    prevX = x
    prevY = y
  }

  const totalLen = cum[steps]
  const poses: ArcCharPose[] = []

  for (let idx = 0; idx < chars.length; idx++) {
    const targetLen = (totalLen * idx) / (chars.length - 1)
    // 二分查找对应弧长区段
    let lo = 0
    let hi = steps
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1
      if (cum[mid] < targetLen) lo = mid
      else hi = mid
    }
    const segLen = cum[hi] - cum[lo]
    const ratio = segLen > 1e-6 ? (targetLen - cum[lo]) / segLen : 0
    const t = ts[lo] + (ts[hi] - ts[lo]) * ratio

    const x = cx + rx * Math.cos(t)
    const y = cy + ry * Math.sin(t)
    // 椭圆切线方向：(-rx * sin t, ry * cos t)
    const dx = -rx * Math.sin(t)
    const dy = ry * Math.cos(t)
    const rotRad = Math.atan2(dy, dx)
    poses.push({ char: chars[idx], x, y, rotRad })
  }

  return poses
}

/** 个人方章网格单元 */
interface PersonalCell {
  char: string
  x: number
  y: number
  w: number
  h: number
}

/** 计算个人方章每个字的精确格子位置（支持 1–9 字传统竖排/现代横排） */
function computePersonalCells(
  rawText: string,
  innerX: number,
  innerY: number,
  innerW: number,
  innerH: number,
  flow: SealConfig['personalFlow'],
  threeCharLayout: SealConfig['threeCharLayout'],
): PersonalCell[] {
  const chars = Array.from(rawText.replace(/\s+/g, '')).slice(0, 9)
  const n = chars.length
  if (n === 0) return []

  const gap = Math.round(innerW * 0.03)

  if (n === 1) {
    return [{ char: chars[0], x: innerX, y: innerY, w: innerW, h: innerH }]
  }

  if (n === 2) {
    const colW = (innerW - gap) / 2
    if (flow === 'traditional') {
      // 传统右→左双列通高
      return [
        { char: chars[0], x: innerX + colW + gap, y: innerY, w: colW, h: innerH },
        { char: chars[1], x: innerX, y: innerY, w: colW, h: innerH },
      ]
    }
    // 现代左→右
    return [
      { char: chars[0], x: innerX, y: innerY, w: colW, h: innerH },
      { char: chars[1], x: innerX + colW + gap, y: innerY, w: colW, h: innerH },
    ]
  }

  if (n === 3) {
    const colW = (innerW - gap) / 2
    const rowH = (innerH - gap) / 2
    if (flow === 'traditional') {
      if (threeCharLayout === 'left-two') {
        // 右一左二（经典三字姓名章：右列大姓通高，左列上名下名）
        return [
          { char: chars[0], x: innerX + colW + gap, y: innerY, w: colW, h: innerH },
          { char: chars[1], x: innerX, y: innerY, w: colW, h: rowH },
          { char: chars[2], x: innerX, y: innerY + rowH + gap, w: colW, h: rowH },
        ]
      }
      // 右二左一（右列两字，左列一字通高，如「张明 | 远」或「李白 | 印」）
      return [
        { char: chars[0], x: innerX + colW + gap, y: innerY, w: colW, h: rowH },
        { char: chars[1], x: innerX + colW + gap, y: innerY + rowH + gap, w: colW, h: rowH },
        { char: chars[2], x: innerX, y: innerY, w: colW, h: innerH },
      ]
    }
    // 现代模式：左一右二或左二右一
    return [
      { char: chars[0], x: innerX, y: innerY, w: colW, h: innerH },
      { char: chars[1], x: innerX + colW + gap, y: innerY, w: colW, h: rowH },
      { char: chars[2], x: innerX + colW + gap, y: innerY + rowH + gap, w: colW, h: rowH },
    ]
  }

  if (n === 4) {
    const colW = (innerW - gap) / 2
    const rowH = (innerH - gap) / 2
    if (flow === 'traditional') {
      // 传统田字格：右上 → 右下 → 左上 → 左下
      return [
        { char: chars[0], x: innerX + colW + gap, y: innerY, w: colW, h: rowH },
        { char: chars[1], x: innerX + colW + gap, y: innerY + rowH + gap, w: colW, h: rowH },
        { char: chars[2], x: innerX, y: innerY, w: colW, h: rowH },
        { char: chars[3], x: innerX, y: innerY + rowH + gap, w: colW, h: rowH },
      ]
    }
    // 现代田字格：左上 → 右上 → 左下 → 右下
    return [
      { char: chars[0], x: innerX, y: innerY, w: colW, h: rowH },
      { char: chars[1], x: innerX + colW + gap, y: innerY, w: colW, h: rowH },
      { char: chars[2], x: innerX, y: innerY + rowH + gap, w: colW, h: rowH },
      { char: chars[3], x: innerX + colW + gap, y: innerY + rowH + gap, w: colW, h: rowH },
    ]
  }

  // 5–6 字：3 列 × 2 行；7–9 字：3 列 × 3 行
  const cols = 3
  const rows = n <= 6 ? 2 : 3
  const colW = (innerW - gap * (cols - 1)) / cols
  const rowH = (innerH - gap * (rows - 1)) / rows
  const cells: PersonalCell[] = []

  for (let i = 0; i < n; i++) {
    let col: number
    let row: number
    if (flow === 'traditional') {
      col = cols - 1 - Math.floor(i / rows)
      row = i % rows
    } else {
      row = Math.floor(i / cols)
      col = i % cols
    }
    cells.push({
      char: chars[i],
      x: innerX + col * (colW + gap),
      y: innerY + row * (rowH + gap),
      w: colW,
      h: rowH,
    })
  }
  return cells
}

/** 在指定最大宽度内自动水平压缩绘制单行文字 */
function drawFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  baseScaleX = 1,
  letterSpacing = 0,
) {
  const trimmed = text.trim()
  if (!trimmed) return

  if (letterSpacing <= 0.1) {
    const measured = ctx.measureText(trimmed).width * baseScaleX
    const scaleX = measured > maxWidth && measured > 0 ? (maxWidth / measured) * baseScaleX : baseScaleX
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(scaleX, 1)
    ctx.fillText(trimmed, 0, 0)
    ctx.restore()
    return
  }

  const chars = Array.from(trimmed)
  const widths = chars.map((ch) => ctx.measureText(ch).width * baseScaleX)
  const totalW = widths.reduce((a, b) => a + b, 0) + letterSpacing * Math.max(0, chars.length - 1)
  const fitRatio = totalW > maxWidth && totalW > 0 ? maxWidth / totalW : 1

  ctx.save()
  ctx.translate(x, y)
  ctx.scale(fitRatio, 1)
  let cursor = -totalW / 2
  for (let i = 0; i < chars.length; i++) {
    const w = widths[i]
    ctx.save()
    ctx.translate(cursor + w / 2, 0)
    ctx.scale(baseScaleX, 1)
    ctx.fillText(chars[i], 0, 0)
    ctx.restore()
    cursor += w + letterSpacing
  }
  ctx.restore()
}

// ============================================================================
// Canvas 2D 四大印章核心绘制
// ============================================================================

function drawCompanySeal(
  ctx: CanvasRenderingContext2D,
  config: SealConfig,
  metrics: SealMetrics,
  fontFamily: string,
) {
  const { cx, cy, sealW } = metrics
  const R = sealW / 2
  const bw = Math.max(2, config.borderWidth)

  ctx.strokeStyle = config.color
  ctx.fillStyle = config.color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // 1. 外圆边框
  ctx.lineWidth = bw
  ctx.beginPath()
  ctx.arc(cx, cy, R - bw / 2, 0, Math.PI * 2)
  ctx.stroke()

  // 2. 可选内细圈
  const innerRingR = R - bw - 8
  if (config.showInnerRing) {
    ctx.lineWidth = Math.max(2, bw * 0.24)
    ctx.beginPath()
    ctx.arc(cx, cy, innerRingR, 0, Math.PI * 2)
    ctx.stroke()
  }

  // 3. 顶部弧形环绕单位名称
  const mainChars = Array.from(config.mainText.trim())
  if (mainChars.length > 0) {
    const ringPadding = config.showInnerRing ? 14 : 6
    const textR = R - bw - ringPadding - config.mainFontSize * 0.56
    ctx.font = `${config.fontWeight} ${config.mainFontSize}px ${fontFamily}`

    const spanRad = (config.ringSpanDeg * Math.PI) / 180
    const startAngle = -Math.PI / 2 - spanRad / 2
    const step = mainChars.length > 1 ? spanRad / (mainChars.length - 1) : 0

    mainChars.forEach((ch, idx) => {
      const angle = mainChars.length === 1 ? -Math.PI / 2 : startAngle + step * idx
      const x = cx + textR * Math.cos(angle)
      const y = cy + textR * Math.sin(angle)
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(angle + Math.PI / 2)
      ctx.scale(config.textStretchX, 1)
      ctx.fillText(ch, 0, 0)
      ctx.restore()
    })
  }

  // 4. 中心图徽（有副标题时略微上移，保持经典公章黄金重心）
  const hasSub = config.subText.trim().length > 0
  const emblemY = hasSub ? cy - 6 : cy
  if (config.emblem === 'star') {
    traceStarPath(ctx, cx, emblemY, config.emblemSize)
    ctx.fill()
  } else if (config.emblem === 'hollow-star') {
    traceStarPath(ctx, cx, emblemY, config.emblemSize)
    ctx.lineWidth = Math.max(3, config.emblemSize * 0.085)
    ctx.lineJoin = 'miter'
    ctx.stroke()
  } else if (config.emblem === 'double-star') {
    ctx.lineWidth = Math.max(2.5, bw * 0.28)
    ctx.beginPath()
    ctx.arc(cx, emblemY, config.emblemSize * 1.12, 0, Math.PI * 2)
    ctx.stroke()
    traceStarPath(ctx, cx, emblemY, config.emblemSize * 0.84)
    ctx.fill()
  }

  // 5. 下方水平副标题（支持多行换行）
  if (hasSub) {
    const lines = config.subText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 2)
    ctx.font = `${config.fontWeight} ${config.subFontSize}px ${fontFamily}`
    const lineH = config.subFontSize * 1.16
    const startY = cy + config.subOffsetY - ((lines.length - 1) * lineH) / 2
    lines.forEach((line, i) => {
      const ly = startY + i * lineH
      const dy = Math.abs(ly - cy)
      const chordHalf = Math.sqrt(Math.max(400, (R - bw - 26) ** 2 - dy ** 2))
      drawFittedText(ctx, line, cx, ly, chordHalf * 1.72, 0.88)
    })
  }

  // 6. 底部弧形防伪编码
  const codeChars = Array.from(config.codeText.trim())
  if (config.showCode && codeChars.length > 0) {
    const codeFontSize = Math.max(16, Math.round(R * 0.095))
    const codeR = R - bw - (config.showInnerRing ? 18 : 10) - codeFontSize * 0.5
    ctx.font = `600 ${codeFontSize}px "SFMono-Regular", "Consolas", "Arial", sans-serif`

    const spanRad = (config.codeSpanDeg * Math.PI) / 180
    // 沿底部从左到右排列：角度从 PI/2 + span/2 递减至 PI/2 - span/2
    const startAngle = Math.PI / 2 + spanRad / 2
    const step = codeChars.length > 1 ? spanRad / (codeChars.length - 1) : 0

    codeChars.forEach((ch, idx) => {
      const angle = codeChars.length === 1 ? Math.PI / 2 : startAngle - step * idx
      const x = cx + codeR * Math.cos(angle)
      const y = cy + codeR * Math.sin(angle)
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(angle - Math.PI / 2)
      ctx.scale(0.86, 1)
      ctx.fillText(ch, 0, 0)
      ctx.restore()
    })
  }
}

function drawOvalSeal(
  ctx: CanvasRenderingContext2D,
  config: SealConfig,
  metrics: SealMetrics,
  fontFamily: string,
) {
  const { cx, cy, sealW, sealH } = metrics
  const rx = sealW / 2
  const ry = sealH / 2
  const bw = Math.max(2, config.borderWidth)

  ctx.strokeStyle = config.color
  ctx.fillStyle = config.color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // 1. 外椭圆框
  ctx.lineWidth = bw
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx - bw / 2, ry - bw / 2, 0, 0, Math.PI * 2)
  ctx.stroke()

  // 2. 可选内细椭圆框
  if (config.showInnerRing) {
    ctx.lineWidth = Math.max(2, bw * 0.24)
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx - bw - 7, ry - bw - 7, 0, 0, Math.PI * 2)
    ctx.stroke()
  }

  // 3. 顶部沿椭圆弧长等距排布单位名称
  const mainChars = Array.from(config.mainText.trim())
  if (mainChars.length > 0) {
    const pad = bw + (config.showInnerRing ? 14 : 6) + config.mainFontSize * 0.56
    const trx = Math.max(40, rx - pad)
    const try_ = Math.max(30, ry - pad * 0.94)
    const poses = sampleEllipseTopArc(mainChars, cx, cy, trx, try_, Math.min(205, config.ringSpanDeg))
    ctx.font = `${config.fontWeight} ${config.mainFontSize}px ${fontFamily}`

    for (const pose of poses) {
      ctx.save()
      ctx.translate(pose.x, pose.y)
      ctx.rotate(pose.rotRad)
      ctx.scale(config.textStretchX, 1)
      ctx.fillText(pose.char, 0, 0)
      ctx.restore()
    }
  }

  // 4. 中部统一社会信用代码 / 税号
  if (config.showCode && config.codeText.trim()) {
    ctx.font = `700 ${config.taxFontSize}px "Arial", "Helvetica Neue", "PingFang SC", sans-serif`
    drawFittedText(
      ctx,
      config.codeText.trim(),
      cx,
      cy + ry * 0.04,
      (rx - bw - 26) * 1.88,
      0.86,
      config.taxLetterSpacing,
    )
  }

  // 5. 底部主名称（如「发票专用章」）
  if (config.subText.trim()) {
    const subY = cy + ry * 0.48
    // 计算该高度处椭圆弦长
    const normY = (subY - cy) / (ry - bw - 16)
    const chordFactor = Math.sqrt(Math.max(0.2, 1 - normY * normY))
    const maxW = (rx - bw - 24) * 1.8 * chordFactor
    ctx.font = `${config.fontWeight} ${config.subFontSize}px ${fontFamily}`
    drawFittedText(ctx, config.subText.trim(), cx, subY, maxW, 0.92, 2)
  }
}

function drawPersonalSeal(
  ctx: CanvasRenderingContext2D,
  config: SealConfig,
  metrics: SealMetrics,
  fontFamily: string,
) {
  const { cx, cy, sealW, sealH } = metrics
  const x0 = cx - sealW / 2
  const y0 = cy - sealH / 2
  const bw = Math.max(2, config.borderWidth)
  const r = config.cornerRadius
  const isBaiwen = config.carveStyle === 'baiwen'

  ctx.strokeStyle = config.color
  ctx.fillStyle = config.color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // 1. 外框或白文实心印底
  if (isBaiwen) {
    traceRoundedRect(ctx, x0, y0, sealW, sealH, r)
    ctx.fill()
    if (config.personalFrame === 'double') {
      // 白文双框：用透明线镂空出一道精致内沟
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.strokeStyle = '#000'
      ctx.lineWidth = Math.max(4, bw * 0.42)
      const inset = bw * 0.85
      traceRoundedRect(ctx, x0 + inset, y0 + inset, sealW - inset * 2, sealH - inset * 2, Math.max(0, r - inset * 0.5))
      ctx.stroke()
      ctx.restore()
    }
  } else {
    if (config.personalFrame !== 'none') {
      ctx.lineWidth = bw
      traceRoundedRect(ctx, x0 + bw / 2, y0 + bw / 2, sealW - bw, sealH - bw, r)
      ctx.stroke()
      if (config.personalFrame === 'double') {
        const inset = bw + 11
        ctx.lineWidth = Math.max(2.5, bw * 0.3)
        traceRoundedRect(ctx, x0 + inset, y0 + inset, sealW - inset * 2, sealH - inset * 2, Math.max(0, r - 6))
        ctx.stroke()
      }
    }
  }

  // 2. 计算内部文字网格
  const frameInset =
    config.personalFrame === 'none'
      ? 0
      : config.personalFrame === 'double'
        ? bw + 16
        : bw
  const pad = frameInset + config.innerPadding
  const innerX = x0 + pad
  const innerY = y0 + pad
  const innerW = Math.max(40, sealW - pad * 2)
  const innerH = Math.max(40, sealH - pad * 2)

  const cells = computePersonalCells(
    config.mainText,
    innerX,
    innerY,
    innerW,
    innerH,
    config.personalFlow,
    config.threeCharLayout,
  )

  if (cells.length === 0) return

  // 白文使用 destination-out 真透明抠空文字，贴在任意底纸上自然透底
  ctx.save()
  if (isBaiwen) {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = '#000'
  } else {
    ctx.fillStyle = config.color
  }

  for (const cell of cells) {
    const baseSize = Math.min(cell.w, cell.h) * 0.94
    ctx.font = `${config.fontWeight} ${baseSize}px ${fontFamily}`
    const m = ctx.measureText(cell.char)
    const glyphW = Math.max(baseSize * 0.5, m.width)
    const targetW = cell.w * 0.92
    const targetH = cell.h * 0.92
    // 适度拉伸以填满通高格（如 2 字 / 3 字印章）
    const scaleX = Math.min(1.18, Math.max(0.65, targetW / glyphW))
    const scaleY = Math.min(1.65, Math.max(0.75, targetH / baseSize))

    ctx.save()
    ctx.translate(cell.x + cell.w / 2, cell.y + cell.h / 2)
    ctx.scale(scaleX, scaleY)
    ctx.fillText(cell.char, 0, baseSize * 0.03)
    ctx.restore()
  }
  ctx.restore()
}

function drawRectSeal(
  ctx: CanvasRenderingContext2D,
  config: SealConfig,
  metrics: SealMetrics,
  fontFamily: string,
) {
  const { cx, cy, sealW, sealH } = metrics
  const x0 = cx - sealW / 2
  const y0 = cy - sealH / 2
  const bw = Math.max(2, config.borderWidth)
  const r = config.cornerRadius

  ctx.strokeStyle = config.color
  ctx.fillStyle = config.color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // 1. 边框
  ctx.save()
  ctx.lineWidth = bw
  if (config.rectBorderStyle === 'dashed') {
    ctx.setLineDash([bw * 1.9, bw * 1.1])
  }
  traceRoundedRect(ctx, x0 + bw / 2, y0 + bw / 2, sealW - bw, sealH - bw, r)
  ctx.stroke()
  ctx.restore()

  if (config.rectBorderStyle === 'double') {
    const inset = bw + 8
    ctx.lineWidth = Math.max(2, bw * 0.28)
    traceRoundedRect(ctx, x0 + inset, y0 + inset, sealW - inset * 2, sealH - inset * 2, Math.max(0, r - 5))
    ctx.stroke()
  }

  const inset = config.rectBorderStyle === 'double' ? bw + 14 : bw + 8
  const innerX = x0 + inset
  const innerY = y0 + inset
  const innerW = sealW - inset * 2
  const innerH = sealH - inset * 2

  if (config.rectLayout === 'dated') {
    // 三段式经典日期章：顶部标题 + 中部日期 + 底部部门/附注
    const topH = innerH * 0.31
    const midH = innerH * 0.40
    const botH = innerH - topH - midH
    const div1Y = innerY + topH
    const div2Y = innerY + topH + midH

    ctx.lineWidth = Math.max(2, bw * 0.28)
    ctx.beginPath()
    ctx.moveTo(innerX - 2, div1Y)
    ctx.lineTo(innerX + innerW + 2, div1Y)
    ctx.moveTo(innerX - 2, div2Y)
    ctx.lineTo(innerX + innerW + 2, div2Y)
    ctx.stroke()

    // 顶栏
    const topFs = Math.round(topH * 0.72)
    ctx.font = `${config.fontWeight} ${topFs}px ${fontFamily}`
    drawFittedText(ctx, config.mainText || '已 审 核', cx, innerY + topH / 2 + 1, innerW * 0.9, 1, 4)

    // 中栏（日期）
    const midFs = Math.round(midH * 0.68)
    ctx.font = `700 ${midFs}px "SFMono-Regular", "Consolas", "Arial", sans-serif`
    drawFittedText(ctx, config.codeText || '2026.11.26', cx, div1Y + midH / 2 + 1, innerW * 0.92, 0.95, 2)

    // 底栏
    const botFs = Math.round(botH * 0.66)
    ctx.font = `${config.fontWeight} ${botFs}px ${fontFamily}`
    drawFittedText(ctx, config.rectExtraText || '综合管理部', cx, div2Y + botH / 2 + 1, innerW * 0.9, 1, 2)
  } else {
    // 单栏大字（带可选下方小字附注）
    const hasExtra = config.rectExtraText.trim().length > 0
    if (hasExtra) {
      const mainFs = Math.round(innerH * 0.46)
      ctx.font = `${config.fontWeight} ${mainFs}px ${fontFamily}`
      drawFittedText(ctx, config.mainText || '样 稿', cx, innerY + innerH * 0.36, innerW * 0.9, 0.96, 3)

      const extraFs = Math.max(14, Math.round(innerH * 0.19))
      ctx.font = `600 ${extraFs}px ${fontFamily}`
      drawFittedText(ctx, config.rectExtraText.trim(), cx, innerY + innerH * 0.77, innerW * 0.9, 0.96, 2)
    } else {
      const mainFs = Math.round(innerH * 0.62)
      ctx.font = `${config.fontWeight} ${mainFs}px ${fontFamily}`
      drawFittedText(ctx, config.mainText || '已 审 核', cx, cy + 2, innerW * 0.9, 0.96, 4)
    }
  }
}

/** 可选叠加斜向「样例」演示标签 */
function drawSampleWatermark(ctx: CanvasRenderingContext2D, config: SealConfig, metrics: SealMetrics) {
  if (!config.showSampleMark) return
  const { cx, cy, sealW, sealH } = metrics
  const minSide = Math.min(sealW, sealH)
  const fs = Math.max(24, Math.round(minSide * 0.16))
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((-24 * Math.PI) / 180)
  ctx.globalAlpha = 0.28
  ctx.strokeStyle = config.color
  ctx.fillStyle = config.color
  ctx.lineWidth = 3
  const boxW = fs * 3.1
  const boxH = fs * 1.45
  traceRoundedRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, 10)
  ctx.stroke()
  ctx.font = `700 ${fs}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('样 例', 0, 1)
  ctx.restore()
}

// ============================================================================
// 确定性物理印泥做旧引擎（纸纹斑驳、边缘微残缺、按压深浅）
// ============================================================================

/** 快速二维整数哈希 → [0, 1) */
function hash2D(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** 二维平滑值噪声 */
function valueNoise2D(x: number, y: number, seed: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)

  const a = hash2D(ix, iy, seed)
  const b = hash2D(ix + 1, iy, seed)
  const c = hash2D(ix, iy + 1, seed)
  const d = hash2D(ix + 1, iy + 1, seed)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

/** 对已绘制印章的离屏画布施加确定性印泥做旧效果（直接作用在透明通道上） */
function applyInkAging(ctx: CanvasRenderingContext2D, width: number, height: number, aging: number, seed: number) {
  if (aging <= 0) return
  const strength = Math.min(1, Math.max(0, aging / 100))
  const img = ctx.getImageData(0, 0, width, height)
  const data = img.data

  // 按归一化 UV 采样，确保 600px 预览与 2048px 导出纹理完全一致
  const invW = 1 / Math.max(1, width)
  const invH = 1 / Math.max(1, height)

  // 随机压印轻重梯度方向
  const angle = hash2D(7, 13, seed) * Math.PI * 2
  const gx = Math.cos(angle)
  const gy = Math.sin(angle)

  // 斑驳阈值（strength 越高越容易露白）
  const cutThreshold = 0.16 + strength * 0.36
  const edgeThreshold = 0.28 + strength * 0.38

  for (let y = 0; y < height; y++) {
    const v = y * invH
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const alpha = data[idx + 3]
      if (alpha === 0) continue

      const u = x * invW

      // 三层多尺度纸纹噪声：大块压印斑 + 中等纸纤维 + 细微油墨颗粒
      const nCoarse = valueNoise2D(u * 26, v * 26, seed)
      const nMid = valueNoise2D(u * 78, v * 78, seed + 101)
      const nFine = valueNoise2D(u * 210, v * 210, seed + 307)
      const grain = nCoarse * 0.48 + nMid * 0.34 + nFine * 0.18

      // 轻微手盖受力不均梯度
      const pressure = 1 - strength * 0.22 * (0.5 + 0.5 * ((u - 0.5) * gx + (v - 0.5) * gy))

      // 边缘半透明抗锯齿像素更易磨损残缺
      if (alpha < 235) {
        if (grain < edgeThreshold) {
          data[idx + 3] = 0
          continue
        }
      }

      if (grain < cutThreshold) {
        // 丝滑过渡镂空，避免生硬方点
        const soft = Math.max(0, (grain - (cutThreshold - 0.09)) / 0.09)
        data[idx + 3] = Math.round(alpha * soft * soft * pressure)
      } else {
        // 实墨区域保留自然油墨浓淡变化
        const density = 0.84 + 0.16 * nMid
        data[idx + 3] = Math.min(255, Math.round(alpha * density * pressure))
      }
    }
  }

  ctx.putImageData(img, 0, 0)
}

/**
 * 渲染印章到目标 Canvas
 * @param canvas 目标 Canvas
 * @param config 印章配置
 * @param targetWidth 输出像素宽（高度按逻辑宽高比自动匹配）
 * @param customFontFamily 自定义本地字体名
 */
export function renderSealToCanvas(
  canvas: HTMLCanvasElement,
  config: SealConfig,
  targetWidth?: number,
  customFontFamily?: string | null,
): SealMetrics {
  const metrics = computeSealMetrics(config)
  const outW = targetWidth ?? metrics.viewW
  const scale = outW / metrics.viewW
  const outH = Math.max(1, Math.round(metrics.viewH * scale))

  if (canvas.width !== outW) canvas.width = outW
  if (canvas.height !== outH) canvas.height = outH

  const ctx = canvas.getContext('2d', { willReadFrequently: config.aging > 0 })
  if (!ctx) return metrics

  ctx.clearRect(0, 0, outW, outH)

  // 使用离屏画布执行白文 destination-out 与做旧处理，保证透明通道纯净
  const off = document.createElement('canvas')
  off.width = outW
  off.height = outH
  const octx = off.getContext('2d', { willReadFrequently: config.aging > 0 })!

  octx.save()
  octx.scale(scale, scale)

  // 绕中心旋转整个印章
  if (Math.abs(config.rotation) > 0.01) {
    octx.translate(metrics.cx, metrics.cy)
    octx.rotate((config.rotation * Math.PI) / 180)
    octx.translate(-metrics.cx, -metrics.cy)
  }

  const fontFamily = resolveFontFamily(config.fontId, customFontFamily)

  switch (config.type) {
    case 'company':
      drawCompanySeal(octx, config, metrics, fontFamily)
      break
    case 'oval':
      drawOvalSeal(octx, config, metrics, fontFamily)
      break
    case 'personal':
      drawPersonalSeal(octx, config, metrics, fontFamily)
      break
    case 'rect':
      drawRectSeal(octx, config, metrics, fontFamily)
      break
  }

  drawSampleWatermark(octx, config, metrics)
  octx.restore()

  // 施加物理印泥做旧纹理
  if (config.aging > 0) {
    applyInkAging(octx, outW, outH, config.aging, config.agingSeed)
  }

  ctx.drawImage(off, 0, 0)
  return metrics
}

/** 导出高清透明底 PNG Blob */
export async function exportSealPngBlob(
  config: SealConfig,
  mode: ExportSizeMode,
  customFontFamily?: string | null,
): Promise<{ blob: Blob; width: number; height: number }> {
  const { width } = resolveExportDimensions(config, mode)
  const canvas = document.createElement('canvas')
  renderSealToCanvas(canvas, config, width, customFontFamily)
  const blob = await canvasToBlob(canvas, 'image/png')
  return { blob, width: canvas.width, height: canvas.height }
}

// ============================================================================
// 矢量 SVG 导出生成器
// ============================================================================

function escXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function fmt(n: number): string {
  return Number(n.toFixed(2)).toString()
}

/** 生成与当前配置一致的矢量 SVG 字符串（当 aging > 0 时自动附加 SVG 印泥滤镜） */
export function buildSealSvgString(config: SealConfig, customFontFamily?: string | null): string {
  const metrics = computeSealMetrics(config)
  const { viewW, viewH, sealW, sealH, cx, cy } = metrics
  const fontFamily = resolveFontFamily(config.fontId, customFontFamily)
  const color = escXml(config.color)
  const parts: string[] = []
  const defs: string[] = []

  // 若开启做旧，使用 SVG 噪点滤镜模拟印泥肌理
  const useFilter = config.aging > 0
  if (useFilter) {
    const strength = Math.min(1, config.aging / 100)
    const dispScale = fmt(1.2 + strength * 4.5)
    const slope = fmt(2.2 - strength * 0.7)
    const intercept = fmt(-0.35 + strength * 0.22)
    defs.push(`
    <filter id="seal-aging" x="-8%" y="-8%" width="116%" height="116%">
      <feTurbulence type="fractalNoise" baseFrequency="0.065" numOctaves="3" seed="${config.agingSeed % 9999}" result="noise" />
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="${dispScale}" xChannelSelector="R" yChannelSelector="G" result="roughened" />
      <feTurbulence type="fractalNoise" baseFrequency="0.16" numOctaves="2" seed="${(config.agingSeed + 37) % 9999}" result="specks" />
      <feColorMatrix in="specks" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 ${slope} ${intercept}" result="maskNoise" />
      <feComposite in="roughened" in2="maskNoise" operator="in" />
    </filter>`)
  }

  const bw = Math.max(2, config.borderWidth)

  if (config.type === 'company') {
    const R = sealW / 2
    parts.push(`<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(R - bw / 2)}" fill="none" stroke="${color}" stroke-width="${fmt(bw)}" />`)
    if (config.showInnerRing) {
      parts.push(
        `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(R - bw - 8)}" fill="none" stroke="${color}" stroke-width="${fmt(Math.max(2, bw * 0.24))}" />`,
      )
    }

    const mainChars = Array.from(config.mainText.trim())
    if (mainChars.length > 0) {
      const ringPadding = config.showInnerRing ? 14 : 6
      const textR = R - bw - ringPadding - config.mainFontSize * 0.56
      const spanRad = (config.ringSpanDeg * Math.PI) / 180
      const startAngle = -Math.PI / 2 - spanRad / 2
      const step = mainChars.length > 1 ? spanRad / (mainChars.length - 1) : 0
      mainChars.forEach((ch, idx) => {
        const angle = mainChars.length === 1 ? -Math.PI / 2 : startAngle + step * idx
        const x = cx + textR * Math.cos(angle)
        const y = cy + textR * Math.sin(angle)
        const deg = ((angle + Math.PI / 2) * 180) / Math.PI
        parts.push(
          `<text x="0" y="0" transform="translate(${fmt(x)},${fmt(y)}) rotate(${fmt(deg)}) scale(${fmt(config.textStretchX)},1)" fill="${color}" font-family="${escXml(fontFamily)}" font-size="${fmt(config.mainFontSize)}" font-weight="${config.fontWeight}" text-anchor="middle" dominant-baseline="central">${escXml(ch)}</text>`,
        )
      })
    }

    const hasSub = config.subText.trim().length > 0
    const emblemY = hasSub ? cy - 6 : cy
    if (config.emblem === 'star') {
      const pts = buildStarPoints(cx, emblemY, config.emblemSize)
        .map(([px, py]) => `${fmt(px)},${fmt(py)}`)
        .join(' ')
      parts.push(`<polygon points="${pts}" fill="${color}" />`)
    } else if (config.emblem === 'hollow-star') {
      const pts = buildStarPoints(cx, emblemY, config.emblemSize)
        .map(([px, py]) => `${fmt(px)},${fmt(py)}`)
        .join(' ')
      parts.push(
        `<polygon points="${pts}" fill="none" stroke="${color}" stroke-width="${fmt(Math.max(3, config.emblemSize * 0.085))}" stroke-linejoin="miter" />`,
      )
    } else if (config.emblem === 'double-star') {
      const pts = buildStarPoints(cx, emblemY, config.emblemSize * 0.84)
        .map(([px, py]) => `${fmt(px)},${fmt(py)}`)
        .join(' ')
      parts.push(
        `<circle cx="${fmt(cx)}" cy="${fmt(emblemY)}" r="${fmt(config.emblemSize * 1.12)}" fill="none" stroke="${color}" stroke-width="${fmt(Math.max(2.5, bw * 0.28))}" />`,
      )
      parts.push(`<polygon points="${pts}" fill="${color}" />`)
    }

    if (hasSub) {
      const lines = config.subText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 2)
      const lineH = config.subFontSize * 1.16
      const startY = cy + config.subOffsetY - ((lines.length - 1) * lineH) / 2
      lines.forEach((line, i) => {
        const ly = startY + i * lineH
        parts.push(
          `<text x="0" y="0" transform="translate(${fmt(cx)},${fmt(ly)}) scale(0.88,1)" fill="${color}" font-family="${escXml(fontFamily)}" font-size="${fmt(config.subFontSize)}" font-weight="${config.fontWeight}" text-anchor="middle" dominant-baseline="central">${escXml(line)}</text>`,
        )
      })
    }

    const codeChars = Array.from(config.codeText.trim())
    if (config.showCode && codeChars.length > 0) {
      const codeFontSize = Math.max(16, Math.round(R * 0.095))
      const codeR = R - bw - (config.showInnerRing ? 18 : 10) - codeFontSize * 0.5
      const spanRad = (config.codeSpanDeg * Math.PI) / 180
      const startAngle = Math.PI / 2 + spanRad / 2
      const step = codeChars.length > 1 ? spanRad / (codeChars.length - 1) : 0
      codeChars.forEach((ch, idx) => {
        const angle = codeChars.length === 1 ? Math.PI / 2 : startAngle - step * idx
        const x = cx + codeR * Math.cos(angle)
        const y = cy + codeR * Math.sin(angle)
        const deg = ((angle - Math.PI / 2) * 180) / Math.PI
        parts.push(
          `<text x="0" y="0" transform="translate(${fmt(x)},${fmt(y)}) rotate(${fmt(deg)}) scale(0.86,1)" fill="${color}" font-family="Consolas, Arial, sans-serif" font-size="${fmt(codeFontSize)}" font-weight="600" text-anchor="middle" dominant-baseline="central">${escXml(ch)}</text>`,
        )
      })
    }
  } else if (config.type === 'oval') {
    const rx = sealW / 2
    const ry = sealH / 2
    parts.push(
      `<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(rx - bw / 2)}" ry="${fmt(ry - bw / 2)}" fill="none" stroke="${color}" stroke-width="${fmt(bw)}" />`,
    )
    if (config.showInnerRing) {
      parts.push(
        `<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(rx - bw - 7)}" ry="${fmt(ry - bw - 7)}" fill="none" stroke="${color}" stroke-width="${fmt(Math.max(2, bw * 0.24))}" />`,
      )
    }

    const mainChars = Array.from(config.mainText.trim())
    if (mainChars.length > 0) {
      const pad = bw + (config.showInnerRing ? 14 : 6) + config.mainFontSize * 0.56
      const poses = sampleEllipseTopArc(
        mainChars,
        cx,
        cy,
        Math.max(40, rx - pad),
        Math.max(30, ry - pad * 0.94),
        Math.min(205, config.ringSpanDeg),
      )
      for (const pose of poses) {
        const deg = (pose.rotRad * 180) / Math.PI
        parts.push(
          `<text x="0" y="0" transform="translate(${fmt(pose.x)},${fmt(pose.y)}) rotate(${fmt(deg)}) scale(${fmt(config.textStretchX)},1)" fill="${color}" font-family="${escXml(fontFamily)}" font-size="${fmt(config.mainFontSize)}" font-weight="${config.fontWeight}" text-anchor="middle" dominant-baseline="central">${escXml(pose.char)}</text>`,
        )
      }
    }

    if (config.showCode && config.codeText.trim()) {
      parts.push(
        `<text x="0" y="0" transform="translate(${fmt(cx)},${fmt(cy + ry * 0.04)}) scale(0.86,1)" fill="${color}" font-family="Arial, Helvetica, sans-serif" font-size="${fmt(config.taxFontSize)}" font-weight="700" letter-spacing="${fmt(config.taxLetterSpacing)}" text-anchor="middle" dominant-baseline="central">${escXml(config.codeText.trim())}</text>`,
      )
    }

    if (config.subText.trim()) {
      parts.push(
        `<text x="0" y="0" transform="translate(${fmt(cx)},${fmt(cy + ry * 0.48)}) scale(0.92,1)" fill="${color}" font-family="${escXml(fontFamily)}" font-size="${fmt(config.subFontSize)}" font-weight="${config.fontWeight}" letter-spacing="2" text-anchor="middle" dominant-baseline="central">${escXml(config.subText.trim())}</text>`,
      )
    }
  } else if (config.type === 'personal') {
    const x0 = cx - sealW / 2
    const y0 = cy - sealH / 2
    const r = config.cornerRadius
    const isBaiwen = config.carveStyle === 'baiwen'

    const frameInset =
      config.personalFrame === 'none' ? 0 : config.personalFrame === 'double' ? bw + 16 : bw
    const pad = frameInset + config.innerPadding
    const cells = computePersonalCells(
      config.mainText,
      x0 + pad,
      y0 + pad,
      Math.max(40, sealW - pad * 2),
      Math.max(40, sealH - pad * 2),
      config.personalFlow,
      config.threeCharLayout,
    )

    const buildGlyphNodes = (fillVal: string) =>
      cells
        .map((cell) => {
          const baseSize = Math.min(cell.w, cell.h) * 0.92
          const scaleX = Math.min(1.15, Math.max(0.7, (cell.w * 0.9) / baseSize))
          const scaleY = Math.min(1.6, Math.max(0.78, (cell.h * 0.9) / baseSize))
          return `<text x="0" y="0" transform="translate(${fmt(cell.x + cell.w / 2)},${fmt(cell.y + cell.h / 2)}) scale(${fmt(scaleX)},${fmt(scaleY)})" fill="${fillVal}" font-family="${escXml(fontFamily)}" font-size="${fmt(baseSize)}" font-weight="${config.fontWeight}" text-anchor="middle" dominant-baseline="central">${escXml(cell.char)}</text>`
        })
        .join('\n')

    if (isBaiwen) {
      // SVG 遮罩实现真透明阴刻镂空
      const maskInnerStroke =
        config.personalFrame === 'double'
          ? `<rect x="${fmt(x0 + bw * 0.85)}" y="${fmt(y0 + bw * 0.85)}" width="${fmt(sealW - bw * 1.7)}" height="${fmt(sealH - bw * 1.7)}" rx="${fmt(Math.max(0, r - bw * 0.4))}" fill="none" stroke="#000" stroke-width="${fmt(Math.max(4, bw * 0.42))}" />`
          : ''
      defs.push(`
    <mask id="baiwen-cutout">
      <rect x="0" y="0" width="${viewW}" height="${viewH}" fill="#fff" />
      ${maskInnerStroke}
      ${buildGlyphNodes('#000')}
    </mask>`)
      parts.push(
        `<rect x="${fmt(x0)}" y="${fmt(y0)}" width="${fmt(sealW)}" height="${fmt(sealH)}" rx="${fmt(r)}" fill="${color}" mask="url(#baiwen-cutout)" />`,
      )
    } else {
      if (config.personalFrame !== 'none') {
        parts.push(
          `<rect x="${fmt(x0 + bw / 2)}" y="${fmt(y0 + bw / 2)}" width="${fmt(sealW - bw)}" height="${fmt(sealH - bw)}" rx="${fmt(r)}" fill="none" stroke="${color}" stroke-width="${fmt(bw)}" />`,
        )
        if (config.personalFrame === 'double') {
          const inset = bw + 11
          parts.push(
            `<rect x="${fmt(x0 + inset)}" y="${fmt(y0 + inset)}" width="${fmt(sealW - inset * 2)}" height="${fmt(sealH - inset * 2)}" rx="${fmt(Math.max(0, r - 6))}" fill="none" stroke="${color}" stroke-width="${fmt(Math.max(2.5, bw * 0.3))}" />`,
          )
        }
      }
      parts.push(buildGlyphNodes(color))
    }
  } else if (config.type === 'rect') {
    const x0 = cx - sealW / 2
    const y0 = cy - sealH / 2
    const r = config.cornerRadius
    const dashAttr =
      config.rectBorderStyle === 'dashed' ? ` stroke-dasharray="${fmt(bw * 1.9)} ${fmt(bw * 1.1)}"` : ''

    parts.push(
      `<rect x="${fmt(x0 + bw / 2)}" y="${fmt(y0 + bw / 2)}" width="${fmt(sealW - bw)}" height="${fmt(sealH - bw)}" rx="${fmt(r)}" fill="none" stroke="${color}" stroke-width="${fmt(bw)}"${dashAttr} />`,
    )
    if (config.rectBorderStyle === 'double') {
      const inset = bw + 8
      parts.push(
        `<rect x="${fmt(x0 + inset)}" y="${fmt(y0 + inset)}" width="${fmt(sealW - inset * 2)}" height="${fmt(sealH - inset * 2)}" rx="${fmt(Math.max(0, r - 5))}" fill="none" stroke="${color}" stroke-width="${fmt(Math.max(2, bw * 0.28))}" />`,
      )
    }

    const inset = config.rectBorderStyle === 'double' ? bw + 14 : bw + 8
    const innerX = x0 + inset
    const innerY = y0 + inset
    const innerW = sealW - inset * 2
    const innerH = sealH - inset * 2

    if (config.rectLayout === 'dated') {
      const topH = innerH * 0.31
      const midH = innerH * 0.4
      const botH = innerH - topH - midH
      const div1Y = innerY + topH
      const div2Y = innerY + topH + midH
      const ruleW = Math.max(2, bw * 0.28)
      parts.push(
        `<line x1="${fmt(innerX - 2)}" y1="${fmt(div1Y)}" x2="${fmt(innerX + innerW + 2)}" y2="${fmt(div1Y)}" stroke="${color}" stroke-width="${fmt(ruleW)}" />`,
      )
      parts.push(
        `<line x1="${fmt(innerX - 2)}" y1="${fmt(div2Y)}" x2="${fmt(innerX + innerW + 2)}" y2="${fmt(div2Y)}" stroke="${color}" stroke-width="${fmt(ruleW)}" />`,
      )
      parts.push(
        `<text x="${fmt(cx)}" y="${fmt(innerY + topH / 2 + 1)}" fill="${color}" font-family="${escXml(fontFamily)}" font-size="${fmt(topH * 0.72)}" font-weight="${config.fontWeight}" letter-spacing="4" text-anchor="middle" dominant-baseline="central">${escXml(config.mainText || '已 审 核')}</text>`,
      )
      parts.push(
        `<text x="${fmt(cx)}" y="${fmt(div1Y + midH / 2 + 1)}" fill="${color}" font-family="Consolas, Arial, sans-serif" font-size="${fmt(midH * 0.68)}" font-weight="700" letter-spacing="2" text-anchor="middle" dominant-baseline="central">${escXml(config.codeText || '2026.11.26')}</text>`,
      )
      parts.push(
        `<text x="${fmt(cx)}" y="${fmt(div2Y + botH / 2 + 1)}" fill="${color}" font-family="${escXml(fontFamily)}" font-size="${fmt(botH * 0.66)}" font-weight="${config.fontWeight}" letter-spacing="2" text-anchor="middle" dominant-baseline="central">${escXml(config.rectExtraText || '综合管理部')}</text>`,
      )
    } else if (config.rectExtraText.trim()) {
      parts.push(
        `<text x="${fmt(cx)}" y="${fmt(innerY + innerH * 0.36)}" fill="${color}" font-family="${escXml(fontFamily)}" font-size="${fmt(innerH * 0.46)}" font-weight="${config.fontWeight}" letter-spacing="3" text-anchor="middle" dominant-baseline="central">${escXml(config.mainText || '样 稿')}</text>`,
      )
      parts.push(
        `<text x="${fmt(cx)}" y="${fmt(innerY + innerH * 0.77)}" fill="${color}" font-family="${escXml(fontFamily)}" font-size="${fmt(Math.max(14, innerH * 0.19))}" font-weight="600" letter-spacing="2" text-anchor="middle" dominant-baseline="central">${escXml(config.rectExtraText.trim())}</text>`,
      )
    } else {
      parts.push(
        `<text x="${fmt(cx)}" y="${fmt(cy + 2)}" fill="${color}" font-family="${escXml(fontFamily)}" font-size="${fmt(innerH * 0.62)}" font-weight="${config.fontWeight}" letter-spacing="4" text-anchor="middle" dominant-baseline="central">${escXml(config.mainText || '已 审 核')}</text>`,
      )
    }
  }

  if (config.showSampleMark) {
    const minSide = Math.min(sealW, sealH)
    const fs = Math.max(24, Math.round(minSide * 0.16))
    const boxW = fs * 3.1
    const boxH = fs * 1.45
    parts.push(`
      <g transform="translate(${fmt(cx)},${fmt(cy)}) rotate(-24)" opacity="0.28">
        <rect x="${fmt(-boxW / 2)}" y="${fmt(-boxH / 2)}" width="${fmt(boxW)}" height="${fmt(boxH)}" rx="10" fill="none" stroke="${color}" stroke-width="3" />
        <text x="0" y="1" fill="${color}" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="${fmt(fs)}" font-weight="700" text-anchor="middle" dominant-baseline="central">样 例</text>
      </g>`)
  }

  const rotAttr =
    Math.abs(config.rotation) > 0.01 ? ` transform="rotate(${fmt(config.rotation)} ${fmt(cx)} ${fmt(cy)})"` : ''
  const filterAttr = useFilter ? ' filter="url(#seal-aging)"' : ''

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${viewW}" height="${viewH}" viewBox="0 0 ${viewW} ${viewH}">`,
    defs.length > 0 ? `  <defs>${defs.join('\n')}\n  </defs>` : '',
    `  <g${filterAttr}>`,
    `    <g${rotAttr}>`,
    parts.map((p) => `      ${p}`).join('\n'),
    `    </g>`,
    `  </g>`,
    `</svg>`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** 导出矢量 SVG Blob */
export function exportSealSvgBlob(config: SealConfig, customFontFamily?: string | null): Blob {
  const svg = buildSealSvgString(config, customFontFamily)
  return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
}

// ============================================================================
// 本地自定义字体加载器（纯浏览器 FontFace API，零网络上传）
// ============================================================================

let customFontSeq = 0

export interface CustomFontAsset {
  familyName: string
  displayName: string
}

export async function loadCustomFontFile(file: File): Promise<CustomFontAsset> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!['ttf', 'otf', 'woff', 'woff2'].includes(ext)) {
    throw new Error('仅支持 .ttf / .otf / .woff / .woff2 字体文件')
  }
  const buffer = await file.arrayBuffer()
  const familyName = `LiteBoxSealFont_${++customFontSeq}_${Date.now()}`
  const face = new FontFace(familyName, buffer)
  await face.load()
  document.fonts.add(face)
  const displayName = file.name.replace(/\.(ttf|otf|woff2?)$/i, '')
  return { familyName, displayName }
}

// ============================================================================
// 在线文档图片盖章合成（正片叠底真实透字效果）
// ============================================================================

export interface StampOverlayOptions {
  /** 印章中心在底图中的归一化 X 坐标（0–1） */
  normX: number
  /** 印章中心在底图中的归一化 Y 坐标（0–1） */
  normY: number
  /** 印章宽度占底图宽度的比例（0.05–0.75） */
  widthRatio: number
  /** 印泥不透明度（0.4–1） */
  opacity: number
  /** 是否启用正片叠底（透出黑字，更像真实印章） */
  multiply: boolean
}

export async function exportStampedDocumentPng(
  baseImage: HTMLImageElement,
  config: SealConfig,
  overlay: StampOverlayOptions,
  customFontFamily?: string | null,
): Promise<Blob> {
  const docW = baseImage.naturalWidth || baseImage.width
  const docH = baseImage.naturalHeight || baseImage.height
  const canvas = document.createElement('canvas')
  canvas.width = docW
  canvas.height = docH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建合成画布')

  ctx.drawImage(baseImage, 0, 0, docW, docH)

  // 按目标覆盖尺寸高分辨率渲染印章，保证边缘锐利
  const sealDrawW = Math.max(64, Math.round(docW * overlay.widthRatio))
  const sealCanvas = document.createElement('canvas')
  renderSealToCanvas(sealCanvas, config, Math.max(sealDrawW, 600), customFontFamily)
  const sealDrawH = (sealDrawW * sealCanvas.height) / sealCanvas.width

  ctx.save()
  ctx.globalAlpha = overlay.opacity
  if (overlay.multiply) {
    ctx.globalCompositeOperation = 'multiply'
  }
  const dx = overlay.normX * docW - sealDrawW / 2
  const dy = overlay.normY * docH - sealDrawH / 2
  ctx.drawImage(sealCanvas, dx, dy, sealDrawW, sealDrawH)
  ctx.restore()

  return canvasToBlob(canvas, 'image/png')
}
