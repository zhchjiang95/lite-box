/**
 * 演示黑板 1920×1080 逻辑坐标系渲染与命中检测引擎
 * - 贝塞尔中点平滑手绘笔画（支持粉笔柔和质感与半透明荧光高亮）
 * - 矢量箭头、矩形、椭圆、直线、多行文字与贴图渲染
 * - 激光笔渐隐拖尾绘制
 * - 精准对象边界计算与点击/橡皮擦命中检测
 */

import { canvasToBlob } from '@/lib/file'
import {
  BOARD_H,
  BOARD_THEME_MAP,
  BOARD_W,
  FONT_FAMILY_MAP,
  type BoardElement,
  type BoardPattern,
  type BoardThemeId,
  type Pt,
  type ShapeItem,
  type StrokeItem,
  type TextItem,
} from './types'

export interface LaserTrailPoint {
  x: number
  y: number
  t: number
}

export interface BoundingBox {
  x: number
  y: number
  w: number
  h: number
}

/** 测量多行文字在 1920×1080 逻辑画布中的实际包围盒 */
export function measureTextBox(ctx: CanvasRenderingContext2D, item: TextItem): BoundingBox {
  const lines = (item.text || ' ').split('\n')
  const lineH = item.fontSize * 1.35
  ctx.save()
  ctx.font = `${item.bold ? '700' : '500'} ${item.fontSize}px ${FONT_FAMILY_MAP[item.fontStyle]}`
  let maxW = item.fontSize * 1.2
  for (const line of lines) {
    const w = ctx.measureText(line || ' ').width
    if (w > maxW) maxW = w
  }
  ctx.restore()
  return {
    x: item.x,
    y: item.y,
    w: maxW,
    h: Math.max(lineH, lines.length * lineH),
  }
}

/** 计算任意元素的逻辑包围盒 */
export function getElementBounds(ctx: CanvasRenderingContext2D, el: BoardElement): BoundingBox {
  if (el.kind === 'image') {
    return { x: el.x, y: el.y, w: el.w, h: el.h }
  }
  if (el.kind === 'text') {
    return measureTextBox(ctx, el)
  }
  if (el.kind === 'shape') {
    const x = Math.min(el.x1, el.x2)
    const y = Math.min(el.y1, el.y2)
    const w = Math.max(12, Math.abs(el.x2 - el.x1))
    const h = Math.max(12, Math.abs(el.y2 - el.y1))
    return { x, y, w, h }
  }
  // stroke
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of el.points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 }
  const pad = el.width
  return {
    x: minX - pad,
    y: minY - pad,
    w: Math.max(16, maxX - minX + pad * 2),
    h: Math.max(16, maxY - minY + pad * 2),
  }
}

/** 点到线段的最短距离 */
function distPointToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** 命中检测：判断逻辑坐标点 pt 是否点中元素（用于选择和对象橡皮擦） */
export function hitTestElement(ctx: CanvasRenderingContext2D, el: BoardElement, pt: Pt, tolerance = 18): boolean {
  if (el.kind === 'image' || el.kind === 'text') {
    const b = getElementBounds(ctx, el)
    return (
      pt.x >= b.x - tolerance * 0.6 &&
      pt.x <= b.x + b.w + tolerance * 0.6 &&
      pt.y >= b.y - tolerance * 0.6 &&
      pt.y <= b.y + b.h + tolerance * 0.6
    )
  }

  if (el.kind === 'stroke') {
    const hitDist = Math.max(tolerance, el.width * 0.9)
    if (el.points.length === 1) {
      return Math.hypot(pt.x - el.points[0].x, pt.y - el.points[0].y) <= hitDist
    }
    for (let i = 1; i < el.points.length; i++) {
      if (distPointToSegment(pt, el.points[i - 1], el.points[i]) <= hitDist) return true
    }
    return false
  }

  // shape
  const hitDist = Math.max(tolerance, el.width * 1.1)
  if (el.shape === 'line' || el.shape === 'arrow') {
    return distPointToSegment(pt, { x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }) <= hitDist
  }
  const minX = Math.min(el.x1, el.x2)
  const maxX = Math.max(el.x1, el.x2)
  const minY = Math.min(el.y1, el.y2)
  const maxY = Math.max(el.y1, el.y2)
  if (el.shape === 'rect') {
    const nearLeft = distPointToSegment(pt, { x: minX, y: minY }, { x: minX, y: maxY }) <= hitDist
    const nearRight = distPointToSegment(pt, { x: maxX, y: minY }, { x: maxX, y: maxY }) <= hitDist
    const nearTop = distPointToSegment(pt, { x: minX, y: minY }, { x: maxX, y: minY }) <= hitDist
    const nearBot = distPointToSegment(pt, { x: minX, y: maxY }, { x: maxX, y: maxY }) <= hitDist
    return nearLeft || nearRight || nearTop || nearBot
  }
  // ellipse 轮廓近似命中
  const rx = Math.max(8, (maxX - minX) / 2)
  const ry = Math.max(8, (maxY - minY) / 2)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const norm = Math.hypot((pt.x - cx) / rx, (pt.y - cy) / ry)
  const band = hitDist / Math.min(rx, ry)
  return Math.abs(norm - 1) <= Math.max(0.18, band)
}

/** 移动单个元素的位置偏移量 */
export function translateElement(el: BoardElement, dx: number, dy: number): BoardElement {
  if (el.kind === 'text' || el.kind === 'image') {
    return { ...el, x: el.x + dx, y: el.y + dy }
  }
  if (el.kind === 'shape') {
    return { ...el, x1: el.x1 + dx, y1: el.y1 + dy, x2: el.x2 + dx, y2: el.y2 + dy }
  }
  return {
    ...el,
    points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
  }
}

/** 绘制黑板背景与辅助底纹 */
function drawBackground(ctx: CanvasRenderingContext2D, themeId: BoardThemeId, pattern: BoardPattern) {
  const theme = BOARD_THEME_MAP[themeId]
  const grad = ctx.createRadialGradient(BOARD_W * 0.5, BOARD_H * 0.42, 120, BOARD_W * 0.5, BOARD_H * 0.5, BOARD_W * 0.72)
  grad.addColorStop(0, theme.bg)
  grad.addColorStop(1, theme.bgGradientTo)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, BOARD_W, BOARD_H)

  // 复古绿黑板微妙粉笔灰暗角与木纹质感内框
  if (themeId === 'chalk-green') {
    ctx.save()
    const dusty = ctx.createRadialGradient(BOARD_W * 0.35, BOARD_H * 0.3, 60, BOARD_W * 0.5, BOARD_H * 0.5, BOARD_W * 0.65)
    dusty.addColorStop(0, 'rgba(255, 255, 255, 0.035)')
    dusty.addColorStop(1, 'rgba(0, 0, 0, 0.16)')
    ctx.fillStyle = dusty
    ctx.fillRect(0, 0, BOARD_W, BOARD_H)
    ctx.restore()
  }

  if (pattern === 'none') return

  ctx.save()
  ctx.strokeStyle = theme.patternColor
  ctx.fillStyle = theme.patternColor
  ctx.lineWidth = 1.5

  if (pattern === 'grid') {
    const step = 60
    ctx.beginPath()
    for (let x = step; x < BOARD_W; x += step) {
      ctx.moveTo(x, 0)
      ctx.lineTo(x, BOARD_H)
    }
    for (let y = step; y < BOARD_H; y += step) {
      ctx.moveTo(0, y)
      ctx.lineTo(BOARD_W, y)
    }
    ctx.stroke()
  } else if (pattern === 'lines') {
    const step = 72
    ctx.beginPath()
    for (let y = step; y < BOARD_H; y += step) {
      ctx.moveTo(48, y)
      ctx.lineTo(BOARD_W - 48, y)
    }
    ctx.stroke()
  } else if (pattern === 'dots') {
    const step = 54
    for (let x = step; x < BOARD_W; x += step) {
      for (let y = step; y < BOARD_H; y += step) {
        ctx.beginPath()
        ctx.arc(x, y, 2.2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  ctx.restore()
}

/** 绘制平滑自由手绘笔画（含荧光笔与粉笔质感） */
function drawStroke(ctx: CanvasRenderingContext2D, item: StrokeItem) {
  if (item.points.length === 0) return
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = item.color
  ctx.fillStyle = item.color
  ctx.lineWidth = item.highlighter ? item.width * 3.2 : item.width

  if (item.highlighter) {
    ctx.globalAlpha = 0.34
  } else if (item.chalk) {
    ctx.globalAlpha = 0.92
    ctx.shadowColor = item.color
    ctx.shadowBlur = 1.6
  }

  if (item.points.length === 1) {
    ctx.beginPath()
    ctx.arc(item.points[0].x, item.points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }

  ctx.beginPath()
  ctx.moveTo(item.points[0].x, item.points[0].y)
  for (let i = 1; i < item.points.length - 1; i++) {
    const midX = (item.points[i].x + item.points[i + 1].x) / 2
    const midY = (item.points[i].y + item.points[i + 1].y) / 2
    ctx.quadraticCurveTo(item.points[i].x, item.points[i].y, midX, midY)
  }
  const last = item.points[item.points.length - 1]
  ctx.lineTo(last.x, last.y)
  ctx.stroke()
  ctx.restore()
}

/** 绘制基础矢量图形（直线 / 箭头 / 矩形 / 椭圆） */
function drawShape(ctx: CanvasRenderingContext2D, item: ShapeItem) {
  ctx.save()
  ctx.strokeStyle = item.color
  ctx.fillStyle = item.color
  ctx.lineWidth = item.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (item.shape === 'line') {
    ctx.beginPath()
    ctx.moveTo(item.x1, item.y1)
    ctx.lineTo(item.x2, item.y2)
    ctx.stroke()
  } else if (item.shape === 'arrow') {
    const angle = Math.atan2(item.y2 - item.y1, item.x2 - item.x1)
    const headLen = Math.max(24, item.width * 3.8)
    const spread = Math.PI / 6.5

    ctx.beginPath()
    ctx.moveTo(item.x1, item.y1)
    ctx.lineTo(item.x2, item.y2)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(item.x2, item.y2)
    ctx.lineTo(item.x2 - headLen * Math.cos(angle - spread), item.y2 - headLen * Math.sin(angle - spread))
    ctx.moveTo(item.x2, item.y2)
    ctx.lineTo(item.x2 - headLen * Math.cos(angle + spread), item.y2 - headLen * Math.sin(angle + spread))
    ctx.stroke()
  } else if (item.shape === 'rect') {
    const x = Math.min(item.x1, item.x2)
    const y = Math.min(item.y1, item.y2)
    const w = Math.abs(item.x2 - item.x1)
    const h = Math.abs(item.y2 - item.y1)
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 8)
    ctx.stroke()
  } else if (item.shape === 'ellipse') {
    const cx = (item.x1 + item.x2) / 2
    const cy = (item.y1 + item.y2) / 2
    const rx = Math.max(2, Math.abs(item.x2 - item.x1) / 2)
    const ry = Math.max(2, Math.abs(item.y2 - item.y1) / 2)
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

/** 绘制多行文字对象 */
function drawText(ctx: CanvasRenderingContext2D, item: TextItem) {
  const lines = item.text.split('\n')
  const lineH = item.fontSize * 1.35
  ctx.save()
  ctx.font = `${item.bold ? '700' : '500'} ${item.fontSize}px ${FONT_FAMILY_MAP[item.fontStyle]}`
  ctx.fillStyle = item.color
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  lines.forEach((line, idx) => {
    ctx.fillText(line, item.x, item.y + idx * lineH)
  })
  ctx.restore()
}

/** 绘制演讲激光笔渐隐拖尾与发光红点 */
function drawLaserTrail(ctx: CanvasRenderingContext2D, trail: LaserTrailPoint[], now: number) {
  const maxAge = 850
  const alive = trail.filter((p) => now - p.t < maxAge)
  if (alive.length === 0) return

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let i = 1; i < alive.length; i++) {
    const p0 = alive[i - 1]
    const p1 = alive[i]
    const life = Math.max(0, 1 - (now - p1.t) / maxAge)
    ctx.strokeStyle = `rgba(244, 63, 94, ${life * 0.78})`
    ctx.lineWidth = Math.max(3, 14 * life)
    ctx.beginPath()
    ctx.moveTo(p0.x, p0.y)
    ctx.lineTo(p1.x, p1.y)
    ctx.stroke()
  }

  // 头部发光核心
  const head = alive[alive.length - 1]
  const headLife = Math.max(0, 1 - (now - head.t) / maxAge)
  ctx.shadowColor = '#f43f5e'
  ctx.shadowBlur = 28
  ctx.fillStyle = `rgba(244, 63, 94, ${headLife})`
  ctx.beginPath()
  ctx.arc(head.x, head.y, 12 * headLife + 3, 0, Math.PI * 2)
  ctx.fill()

  ctx.shadowBlur = 0
  ctx.fillStyle = `rgba(255, 255, 255, ${headLife * 0.95})`
  ctx.beginPath()
  ctx.arc(head.x, head.y, 5 * headLife + 1.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export interface RenderBoardParams {
  canvas: HTMLCanvasElement
  themeId: BoardThemeId
  pattern: BoardPattern
  elements: BoardElement[]
  draftElement: BoardElement | null
  selectedId: string | null
  editingTextId: string | null
  imageCache: Map<string, HTMLImageElement>
  laserTrail: LaserTrailPoint[]
  /** 导出高清 PNG 时传 true，不画选中框与激光笔 */
  forExport?: boolean
}

/** 渲染整块 1920×1080 演示黑板 */
export function renderBoard({
  canvas,
  themeId,
  pattern,
  elements,
  draftElement,
  selectedId,
  editingTextId,
  imageCache,
  laserTrail,
  forExport = false,
}: RenderBoardParams) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  if (forExport) {
    canvas.width = BOARD_W
    canvas.height = BOARD_H
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  } else {
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const targetW = Math.max(320, Math.round(rect.width * dpr))
    const targetH = Math.max(180, Math.round(rect.height * dpr))
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
    }
    ctx.setTransform(targetW / BOARD_W, 0, 0, targetH / BOARD_H, 0, 0)
  }

  drawBackground(ctx, themeId, pattern)

  const list = draftElement ? [...elements, draftElement] : elements

  // 先绘贴图，再绘笔画/图形/文字，确保批注永远浮在图片上方
  const images = list.filter((e) => e.kind === 'image')
  const others = list.filter((e) => e.kind !== 'image')

  for (const el of images) {
    const img = imageCache.get(el.id)
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.28)'
      ctx.shadowBlur = 18
      ctx.beginPath()
      ctx.roundRect(el.x, el.y, el.w, el.h, 12)
      ctx.clip()
      ctx.drawImage(img, el.x, el.y, el.w, el.h)
      ctx.restore()
    }
  }

  for (const el of others) {
    if (el.kind === 'text' && el.id === editingTextId && !forExport) continue
    if (el.kind === 'stroke') drawStroke(ctx, el)
    else if (el.kind === 'shape') drawShape(ctx, el)
    else if (el.kind === 'text') drawText(ctx, el)
  }

  // 选中虚线外框（图片右下角额外画缩放手柄）
  if (!forExport && selectedId) {
    const sel = elements.find((e) => e.id === selectedId)
    if (sel && sel.id !== editingTextId) {
      const box = getElementBounds(ctx, sel)
      ctx.save()
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 3
      ctx.setLineDash([10, 7])
      ctx.strokeRect(box.x - 10, box.y - 10, box.w + 20, box.h + 20)
      ctx.setLineDash([])

      if (sel.kind === 'image') {
        // 右下角缩放拖拽手柄
        ctx.fillStyle = '#38bdf8'
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(box.x + box.w + 10, box.y + box.h + 10, 12, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  if (!forExport && laserTrail.length > 0) {
    drawLaserTrail(ctx, laserTrail, performance.now())
  }
}

/** 导出 1920×1080 高清 PNG */
export async function exportBoardPng(
  themeId: BoardThemeId,
  pattern: BoardPattern,
  elements: BoardElement[],
  imageCache: Map<string, HTMLImageElement>,
): Promise<Blob> {
  const offscreen = document.createElement('canvas')
  renderBoard({
    canvas: offscreen,
    themeId,
    pattern,
    elements,
    draftElement: null,
    selectedId: null,
    editingTextId: null,
    imageCache,
    laserTrail: [],
    forExport: true,
  })
  const blob = await canvasToBlob(offscreen, 'image/png')
  offscreen.width = 0
  offscreen.height = 0
  return blob
}
