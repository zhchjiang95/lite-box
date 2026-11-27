/**
 * 手写签名核心笔锋引擎与高清导出模块（零第三方依赖）
 * - 基于书写速度与手写笔压感动态计算平滑笔宽（支持钢笔 / 签字笔 / 毛笔三种物理笔触）
 * - 采用二次贝塞尔细分 + 法向量双侧轮廓生成算法，同时驱动 Canvas 2D 高清渲染与无损矢量 SVG 导出
 * - 支持自动紧致裁切透明留白（导出贴合签名外接盒，方便直接贴入 Word / WPS / PDF 合同）
 * - 支持本地签名库持久化（localStorage，纯本机存储不上传）
 */

import { canvasToBlob } from '@/lib/file'

export type PenStyle = 'fountain' | 'ballpoint' | 'brush'
export type CanvasGuide = 'baseline' | 'grid' | 'blank'
export type ExportBgMode = 'transparent' | 'white'

/** 单个采样点（使用逻辑画布坐标） */
export interface StrokePoint {
  x: number
  y: number
  /** 时间戳（ms） */
  t: number
  /** 压感（0–1，鼠标默认 0.5） */
  pressure: number
}

/** 一条完整笔画 */
export interface SignatureStroke {
  points: StrokePoint[]
  color: string
  baseWidth: number
  penStyle: PenStyle
  smoothing: number
}

/** 本地保存的签名记录 */
export interface SavedSignature {
  id: string
  name: string
  createdAt: number
  canvasWidth: number
  canvasHeight: number
  strokes: SignatureStroke[]
  previewDataUrl: string
}

/** 常用签字墨水配色 */
export const INK_COLORS: { name: string; hex: string }[] = [
  { name: '纯黑签字墨', hex: '#0F172A' },
  { name: '钢笔蓝黑', hex: '#1E3A8A' },
  { name: '商务签字蓝', hex: '#1D4ED8' },
  { name: '朱砂红', hex: '#C62328' },
  { name: '深墨绿', hex: '#14532D' },
  { name: '纯白（深底用）', hex: '#FFFFFF' },
]

export const PEN_STYLES: { id: PenStyle; label: string; desc: string }[] = [
  { id: 'fountain', label: '钢笔锋', desc: '快细慢粗 · 自然笔锋' },
  { id: 'ballpoint', label: '签字笔', desc: '均匀利落 · 正式合同' },
  { id: 'brush', label: '毛笔韵', desc: '顿挫鲜明 · 书法质感' },
]

/** 细分后的带半径路径点 */
interface RibbonPoint {
  x: number
  y: number
  r: number
}

/** 根据笔触类型、速度与压感计算当前点半径 */
function computePointRadius(
  baseWidth: number,
  penStyle: PenStyle,
  velocityPxPerMs: number,
  pressure: number,
  progress: number,
): number {
  const half = Math.max(0.6, baseWidth / 2)
  // 归一化速度：0（极慢/停顿）→ 1（快速挥洒）
  const vNorm = Math.min(1, velocityPxPerMs / 2.6)
  // 真实压感修正（手写笔会输出 != 0.5 的真实值）
  const hasRealPressure = Math.abs(pressure - 0.5) > 0.04
  const pFactor = hasRealPressure ? 0.55 + pressure * 0.9 : 1

  let widthFactor = 1
  if (penStyle === 'ballpoint') {
    widthFactor = 1.04 - vNorm * 0.18
  } else if (penStyle === 'fountain') {
    widthFactor = 1.22 - vNorm * 0.62
  } else {
    // brush 毛笔：起落顿笔饱满、行笔急处极细
    widthFactor = 1.48 - vNorm * 0.92
  }

  // 起笔与收锋柔顺收尖
  let taper = 1
  if (progress < 0.08) {
    const k = progress / 0.08
    taper = penStyle === 'ballpoint' ? 0.78 + 0.22 * k : 0.48 + 0.52 * k
  } else if (progress > 0.86) {
    const k = (1 - progress) / 0.14
    taper = penStyle === 'ballpoint' ? 0.68 + 0.32 * k : 0.22 + 0.78 * k
  }

  const minRatio = penStyle === 'brush' ? 0.16 : penStyle === 'fountain' ? 0.28 : 0.65
  const finalFactor = Math.max(minRatio, widthFactor * pFactor * taper)
  return Math.max(0.45, half * finalFactor)
}

/** 将一条笔画转换为平滑细分后的带半径中心线 */
function buildRibbonPoints(stroke: SignatureStroke): RibbonPoint[] {
  const raw = stroke.points
  if (raw.length === 0) return []
  if (raw.length === 1) {
    return [{ x: raw[0].x, y: raw[0].y, r: Math.max(1, stroke.baseWidth * 0.52) }]
  }

  // 1. 指数移动平均平滑（减弱鼠标手抖）
  const alpha = Math.max(0.18, Math.min(1, 1 - stroke.smoothing * 0.72))
  const smoothed: StrokePoint[] = [raw[0]]
  for (let i = 1; i < raw.length; i++) {
    const prev = smoothed[i - 1]
    const cur = raw[i]
    smoothed.push({
      x: prev.x + (cur.x - prev.x) * alpha,
      y: prev.y + (cur.y - prev.y) * alpha,
      t: cur.t,
      pressure: prev.pressure + (cur.pressure - prev.pressure) * 0.4,
    })
  }
  // 锚定最后一个点确保收笔精准落位
  smoothed[smoothed.length - 1] = raw[raw.length - 1]

  // 2. 沿二次贝塞尔中点曲线细分采样
  const ribbon: RibbonPoint[] = []
  let prevVel = 0.35
  let prevR = stroke.baseWidth * 0.45
  const totalPts = smoothed.length

  for (let i = 0; i < totalPts; i++) {
    const p0 = i === 0 ? smoothed[0] : {
      x: (smoothed[i - 1].x + smoothed[i].x) / 2,
      y: (smoothed[i - 1].y + smoothed[i].y) / 2,
      t: (smoothed[i - 1].t + smoothed[i].t) / 2,
      pressure: (smoothed[i - 1].pressure + smoothed[i].pressure) / 2,
    }
    const ctrl = smoothed[i]
    const p2 =
      i === totalPts - 1
        ? smoothed[totalPts - 1]
        : {
            x: (smoothed[i].x + smoothed[i + 1].x) / 2,
            y: (smoothed[i].y + smoothed[i + 1].y) / 2,
            t: (smoothed[i].t + smoothed[i + 1].t) / 2,
            pressure: (smoothed[i].pressure + smoothed[i + 1].pressure) / 2,
          }

    const dist = Math.hypot(p2.x - p0.x, p2.y - p0.y)
    const dt = Math.max(1, p2.t - p0.t)
    const instVel = dist / dt
    prevVel = prevVel * 0.68 + instVel * 0.32

    const progress = totalPts > 1 ? i / (totalPts - 1) : 1
    const targetR = computePointRadius(stroke.baseWidth, stroke.penStyle, prevVel, ctrl.pressure, progress)
    const nextR = prevR * 0.55 + targetR * 0.45

    const steps = Math.max(1, Math.min(12, Math.ceil(dist / 2.5)))
    for (let s = 0; s <= steps; s++) {
      if (i > 0 && s === 0) continue
      const u = s / steps
      const inv = 1 - u
      const x = inv * inv * p0.x + 2 * inv * u * ctrl.x + u * u * p2.x
      const y = inv * inv * p0.y + 2 * inv * u * ctrl.y + u * u * p2.y
      const r = prevR + (nextR - prevR) * u
      ribbon.push({ x, y, r })
    }
    prevR = nextR
  }

  return ribbon
}

/** 从带半径中心线生成闭合多边形外轮廓（供 Canvas 填充与无损矢量 SVG 共用） */
export function buildStrokeOutline(stroke: SignatureStroke): [number, number][] {
  const pts = buildRibbonPoints(stroke)
  if (pts.length === 0) return []

  // 单点圆点
  if (pts.length === 1 || (pts.length === 2 && Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) < 0.5)) {
    const p = pts[0]
    const circle: [number, number][] = []
    const segs = 12
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2
      circle.push([p.x + Math.cos(a) * p.r, p.y + Math.sin(a) * p.r])
    }
    return circle
  }

  const left: [number, number][] = []
  const right: [number, number][] = []

  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)]
    const next = pts[Math.min(pts.length - 1, i + 1)]
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    // 单位法向量
    const nx = -dy / len
    const ny = dx / len
    const cur = pts[i]
    left.push([cur.x + nx * cur.r, cur.y + ny * cur.r])
    right.push([cur.x - nx * cur.r, cur.y - ny * cur.r])
  }

  // 起笔半圆帽 + 左侧轮廓 + 收笔半圆帽 + 右侧逆序轮廓
  const outline: [number, number][] = []
  const first = pts[0]
  const second = pts[1]
  const startAngle = Math.atan2(first.y - second.y, first.x - second.x)
  for (let i = 0; i <= 6; i++) {
    const a = startAngle - Math.PI / 2 + (i / 6) * Math.PI
    outline.push([first.x + Math.cos(a) * first.r, first.y + Math.sin(a) * first.r])
  }

  for (let i = 0; i < left.length; i++) outline.push(left[i])

  const last = pts[pts.length - 1]
  const prevLast = pts[pts.length - 2]
  const endAngle = Math.atan2(last.y - prevLast.y, last.x - prevLast.x)
  for (let i = 0; i <= 6; i++) {
    const a = endAngle - Math.PI / 2 + (i / 6) * Math.PI
    outline.push([last.x + Math.cos(a) * last.r, last.y + Math.sin(a) * last.r])
  }

  for (let i = right.length - 1; i >= 0; i--) outline.push(right[i])

  return outline
}

/** 在 Canvas 上绘制单条笔画 */
export function drawStrokeOnCanvas(ctx: CanvasRenderingContext2D, stroke: SignatureStroke) {
  const poly = buildStrokeOutline(stroke)
  if (poly.length < 3) return
  ctx.save()
  ctx.fillStyle = stroke.color
  ctx.beginPath()
  ctx.moveTo(poly[0][0], poly[0][1])
  for (let i = 1; i < poly.length; i++) {
    ctx.lineTo(poly[i][0], poly[i][1])
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** 在已设置好变换矩阵的 Canvas 上绘制全部笔画（调用方负责先 clearRect 与 setTransform） */
export function renderSignatureOnCanvas(
  ctx: CanvasRenderingContext2D,
  strokes: SignatureStroke[],
) {
  for (const stroke of strokes) {
    drawStrokeOnCanvas(ctx, stroke)
  }
}

/** 计算全部笔画的紧致外接边界盒（用于自动裁切透明边距） */
export function computeStrokesBounds(
  strokes: SignatureStroke[],
  fallbackW: number,
  fallbackH: number,
): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const stroke of strokes) {
    const pad = stroke.baseWidth * 0.85
    for (const p of stroke.points) {
      if (p.x - pad < minX) minX = p.x - pad
      if (p.y - pad < minY) minY = p.y - pad
      if (p.x + pad > maxX) maxX = p.x + pad
      if (p.y + pad > maxY) maxY = p.y + pad
    }
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: fallbackW, maxY: fallbackH, width: fallbackW, height: fallbackH }
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(16, maxX - minX),
    height: Math.max(16, maxY - minY),
  }
}

export interface SignatureExportOptions {
  canvasWidth: number
  canvasHeight: number
  /** 是否自动裁切多余透明留白（推荐开启） */
  autoTrim: boolean
  /** 裁切后的外圈留白（逻辑像素） */
  padding: number
  /** 导出高清倍率（1 / 2 / 3） */
  scale: number
  /** 背景模式（透明 / 纯白） */
  background: ExportBgMode
}

/** 导出高清透明底（或白底）PNG */
export async function exportSignaturePngBlob(
  strokes: SignatureStroke[],
  options: SignatureExportOptions,
): Promise<{ blob: Blob; width: number; height: number }> {
  if (strokes.length === 0) {
    throw new Error('请先手写签名再导出')
  }

  const { canvasWidth, canvasHeight, autoTrim, padding, scale, background } = options
  const bounds = autoTrim
    ? computeStrokesBounds(strokes, canvasWidth, canvasHeight)
    : { minX: 0, minY: 0, maxX: canvasWidth, maxY: canvasHeight, width: canvasWidth, height: canvasHeight }

  const pad = autoTrim ? Math.max(0, padding) : 0
  const logicalW = Math.ceil(bounds.width + pad * 2)
  const logicalH = Math.ceil(bounds.height + pad * 2)

  const outW = Math.max(32, Math.round(logicalW * scale))
  const outH = Math.max(32, Math.round(logicalH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建导出画布')

  if (background === 'white') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, outW, outH)
  }

  ctx.save()
  ctx.scale(scale, scale)
  ctx.translate(-bounds.minX + pad, -bounds.minY + pad)
  for (const stroke of strokes) {
    drawStrokeOnCanvas(ctx, stroke)
  }
  ctx.restore()

  const blob = await canvasToBlob(canvas, 'image/png')
  return { blob, width: outW, height: outH }
}

function fmtNum(n: number): string {
  return Number(n.toFixed(1)).toString()
}

/** 导出无损矢量 SVG（完整保留钢笔/毛笔压感笔锋轮廓） */
export function buildSignatureSvgString(
  strokes: SignatureStroke[],
  options: Omit<SignatureExportOptions, 'scale'>,
): string {
  const { canvasWidth, canvasHeight, autoTrim, padding, background } = options
  const bounds = autoTrim
    ? computeStrokesBounds(strokes, canvasWidth, canvasHeight)
    : { minX: 0, minY: 0, maxX: canvasWidth, maxY: canvasHeight, width: canvasWidth, height: canvasHeight }

  const pad = autoTrim ? Math.max(0, padding) : 0
  const viewW = Math.ceil(bounds.width + pad * 2)
  const viewH = Math.ceil(bounds.height + pad * 2)
  const ox = -bounds.minX + pad
  const oy = -bounds.minY + pad

  const paths = strokes
    .map((stroke) => {
      const poly = buildStrokeOutline(stroke)
      if (poly.length < 3) return ''
      const d =
        `M${fmtNum(poly[0][0] + ox)} ${fmtNum(poly[0][1] + oy)}` +
        poly
          .slice(1)
          .map(([x, y]) => `L${fmtNum(x + ox)} ${fmtNum(y + oy)}`)
          .join('') +
        'Z'
      return `  <path d="${d}" fill="${stroke.color}" />`
    })
    .filter(Boolean)

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${viewW}" height="${viewH}" viewBox="0 0 ${viewW} ${viewH}">`,
    background === 'white' ? `  <rect width="100%" height="100%" fill="#ffffff" />` : '',
    ...paths,
    `</svg>`,
  ]
    .filter(Boolean)
    .join('\n')
}

export function exportSignatureSvgBlob(
  strokes: SignatureStroke[],
  options: Omit<SignatureExportOptions, 'scale'>,
): Blob {
  if (strokes.length === 0) throw new Error('请先手写签名再导出')
  return new Blob([buildSignatureSvgString(strokes, options)], { type: 'image/svg+xml;charset=utf-8' })
}

// ============================================================================
// 本地签名库持久化（仅存于本机 localStorage）
// ============================================================================

const VAULT_STORAGE_KEY = 'litebox:signature-pad:vault-v1'

export function loadSavedSignatures(): SavedSignature[] {
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function persistSavedSignatures(list: SavedSignature[]) {
  try {
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(list.slice(0, 12)))
  } catch {
    // 忽略存储空间不足
  }
}

/** 生成用于签名库列表的小巧预览 DataURL */
export function buildSignaturePreviewDataUrl(
  strokes: SignatureStroke[],
  canvasWidth: number,
  canvasHeight: number,
): string {
  const bounds = computeStrokesBounds(strokes, canvasWidth, canvasHeight)
  const pad = 12
  const logicalW = bounds.width + pad * 2
  const logicalH = bounds.height + pad * 2
  const maxW = 280
  const maxH = 120
  const scale = Math.min(maxW / logicalW, maxH / logicalH, 1.5)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(40, Math.round(logicalW * scale))
  canvas.height = Math.max(24, Math.round(logicalH * scale))
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.translate(-bounds.minX + pad, -bounds.minY + pad)
  for (const s of strokes) drawStrokeOnCanvas(ctx, s)
  return canvas.toDataURL('image/png')
}
