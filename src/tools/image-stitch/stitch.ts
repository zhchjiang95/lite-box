/** 图片拼接：布局计算与绘制（纯函数，便于测试与后续迁移到 Worker） */

export type StitchMode = 'vertical' | 'horizontal' | 'grid'
export type Align = 'start' | 'center' | 'end'
export type CellRatio = 'auto' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16'
export type Fit = 'cover' | 'contain'

export interface StitchOptions {
  mode: StitchMode
  /** 宫格列数 */
  columns: number
  /** 图片间距 */
  gap: number
  /** 外边距 */
  padding: number
  /** 圆角 */
  radius: number
  /** 背景色，transparent 为透明 */
  background: string
  /** 横/纵向时是否统一尺寸（纵向统一宽度、横向统一高度） */
  unify: boolean
  /** 不统一尺寸时的对齐方式 */
  align: Align
  /** 宫格单元格比例 */
  cellRatio: CellRatio
  /** 宫格填充方式 */
  fit: Fit
}

export interface Size {
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface StitchLayout {
  width: number
  height: number
  rects: Rect[]
}

export const defaultOptions: StitchOptions = {
  mode: 'vertical',
  columns: 3,
  gap: 0,
  padding: 0,
  radius: 0,
  background: '#ffffff',
  unify: true,
  align: 'center',
  cellRatio: 'auto',
  fit: 'cover',
}

const alignOffset = (free: number, align: Align) => (align === 'start' ? 0 : align === 'center' ? free / 2 : free)

/** 计算拼接布局（原始像素尺寸，未缩放） */
export function computeLayout(sizes: Size[], o: StitchOptions): StitchLayout {
  const n = sizes.length
  if (!n) return { width: 0, height: 0, rects: [] }
  const { gap, padding: p } = o
  const rects: Rect[] = []

  if (o.mode === 'vertical') {
    // 统一宽度时取最小宽度，避免小图被放大模糊
    const maxW = Math.max(...sizes.map((s) => s.width))
    const baseW = o.unify ? Math.min(...sizes.map((s) => s.width)) : maxW
    let y = p
    for (const s of sizes) {
      const w = o.unify ? baseW : s.width
      const h = o.unify ? (s.height * baseW) / s.width : s.height
      rects.push({ x: p + (o.unify ? 0 : alignOffset(baseW - w, o.align)), y, w, h })
      y += h + gap
    }
    return { width: baseW + p * 2, height: y - gap + p, rects }
  }

  if (o.mode === 'horizontal') {
    const maxH = Math.max(...sizes.map((s) => s.height))
    const baseH = o.unify ? Math.min(...sizes.map((s) => s.height)) : maxH
    let x = p
    for (const s of sizes) {
      const h = o.unify ? baseH : s.height
      const w = o.unify ? (s.width * baseH) / s.height : s.width
      rects.push({ x, y: p + (o.unify ? 0 : alignOffset(baseH - h, o.align)), w, h })
      x += w + gap
    }
    return { width: x - gap + p, height: baseH + p * 2, rects }
  }

  // 宫格：单元格宽度取最小图宽（上限 1600），高度由比例决定
  const cols = Math.max(1, Math.min(o.columns, n))
  const rows = Math.ceil(n / cols)
  const cellW = Math.min(1600, Math.min(...sizes.map((s) => s.width)))
  let ratio: number // 高 / 宽
  if (o.cellRatio === 'auto') ratio = sizes[0].height / sizes[0].width
  else {
    const [a, b] = o.cellRatio.split(':').map(Number)
    ratio = b / a
  }
  const cellH = cellW * ratio
  for (let i = 0; i < n; i++) {
    const c = i % cols
    const r = Math.floor(i / cols)
    rects.push({ x: p + c * (cellW + gap), y: p + r * (cellH + gap), w: cellW, h: cellH })
  }
  return {
    width: p * 2 + cols * cellW + (cols - 1) * gap,
    height: p * 2 + rows * cellH + (rows - 1) * gap,
    rects,
  }
}

/** 浏览器 canvas 尺寸限制（iOS Safari 面积限制约 1677 万像素） */
const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)
export const CANVAS_MAX_SIDE = isIOS ? 8192 : 16384
export const CANVAS_MAX_AREA = isIOS ? 16_000_000 : 200_000_000

/** 计算安全缩放比例，保证不超过浏览器 canvas 限制 */
export function safeScale(width: number, height: number, desired = 1) {
  const w = width * desired
  const h = height * desired
  const k = Math.min(1, CANVAS_MAX_SIDE / w, CANVAS_MAX_SIDE / h, Math.sqrt(CANVAS_MAX_AREA / (w * h)))
  return desired * k
}

/** 绘制圆角裁剪路径 */
function roundRectPath(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  const rr = Math.min(radius, r.w / 2, r.h / 2)
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(r.x, r.y, r.w, r.h, rr)
  else ctx.rect(r.x, r.y, r.w, r.h)
}

/**
 * 按布局绘制到 canvas
 * @param scale 整体缩放（预览时 < 1 以提升速度）
 */
export function renderStitch(
  canvas: HTMLCanvasElement,
  sources: (ImageBitmap | HTMLImageElement)[],
  sizes: Size[],
  layout: StitchLayout,
  o: StitchOptions,
  scale: number,
) {
  const W = Math.max(1, Math.round(layout.width * scale))
  const H = Math.max(1, Math.round(layout.height * scale))
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, W, H)
  if (o.background !== 'transparent') {
    ctx.fillStyle = o.background
    ctx.fillRect(0, 0, W, H)
  }
  ctx.save()
  ctx.scale(scale, scale)
  layout.rects.forEach((r, i) => {
    const src = sources[i]
    const s = sizes[i]
    if (!src || !s) return
    ctx.save()
    let dst: Rect = r
    if (o.mode === 'grid') {
      // 宫格按 cover / contain 适配单元格
      const k = o.fit === 'cover' ? Math.max(r.w / s.width, r.h / s.height) : Math.min(r.w / s.width, r.h / s.height)
      const dw = s.width * k
      const dh = s.height * k
      dst = { x: r.x + (r.w - dw) / 2, y: r.y + (r.h - dh) / 2, w: dw, h: dh }
    }
    // cover 时裁剪到单元格；contain 时圆角作用于图片本身
    const clipRect = o.mode === 'grid' && o.fit === 'cover' ? r : dst
    if (o.radius > 0) {
      roundRectPath(ctx, clipRect, o.radius)
      ctx.clip()
    } else if (o.mode === 'grid' && o.fit === 'cover') {
      ctx.beginPath()
      ctx.rect(r.x, r.y, r.w, r.h)
      ctx.clip()
    }
    ctx.drawImage(src, dst.x, dst.y, dst.w, dst.h)
    ctx.restore()
  })
  ctx.restore()
}
