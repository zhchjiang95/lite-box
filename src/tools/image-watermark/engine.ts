import { zip } from 'fflate'
import { FONT_FAMILIES, type ExportFormat, type ImageEntry, type WatermarkOptions } from './types'

interface StampMetrics {
  width: number
  height: number
  lines: string[]
  fontSize: number
  lineHeight: number
  font: string
}

/** 测量单个水印单元（多行文字或图片 Logo）的像素包围盒 */
function measureStamp(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: WatermarkOptions,
  logo: ImageBitmap | null,
): StampMetrics | null {
  const shortSide = Math.min(w, h)

  if (opts.type === 'image') {
    if (!logo) return null
    const targetW = Math.max(8, (shortSide * opts.logoSizePct) / 100)
    const scale = targetW / logo.width
    return {
      width: targetW,
      height: Math.max(8, logo.height * scale),
      lines: [],
      fontSize: 0,
      lineHeight: 0,
      font: '',
    }
  }

  const lines = opts.text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
  if (!lines.length) return null

  const fontSize = Math.max(10, (shortSide * opts.fontSizePct) / 100)
  const lineHeight = fontSize * 1.32
  const weight = opts.bold ? '700' : '400'
  const font = `${weight} ${fontSize}px ${FONT_FAMILIES[opts.fontStyle]}`
  ctx.font = font

  let maxLineW = 0
  for (const line of lines) {
    const m = ctx.measureText(line)
    if (m.width > maxLineW) maxLineW = m.width
  }

  return {
    width: Math.max(10, maxLineW),
    height: lines.length * lineHeight,
    lines,
    fontSize,
    lineHeight,
    font,
  }
}

/** 在当前坐标系原点 (0, 0) 居中绘制单个水印单元 */
function drawStampAtOrigin(
  ctx: CanvasRenderingContext2D,
  metrics: StampMetrics,
  opts: WatermarkOptions,
  logo: ImageBitmap | null,
) {
  if (opts.type === 'image' && logo) {
    ctx.drawImage(logo, -metrics.width / 2, -metrics.height / 2, metrics.width, metrics.height)
    return
  }

  ctx.font = metrics.font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = opts.color

  if (opts.shadow) {
    const blur = Math.max(2, metrics.fontSize * 0.14)
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
    ctx.shadowBlur = blur
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = Math.max(1, metrics.fontSize * 0.05)
  } else {
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
  }

  const startY = -((metrics.lines.length - 1) * metrics.lineHeight) / 2
  metrics.lines.forEach((line, i) => {
    ctx.fillText(line, 0, startY + i * metrics.lineHeight)
  })
}

/**
 * 将原图与水印渲染到指定 Canvas
 * @param scale 缩放比例（预览时降采样保证 60fps，导出时传 1 保持全分辨率）
 */
export function renderWatermarkedCanvas(
  canvas: HTMLCanvasElement,
  source: ImageBitmap,
  opts: WatermarkOptions,
  logo: ImageBitmap | null,
  scale = 1,
) {
  const w = Math.max(1, Math.round(source.width * scale))
  const h = Math.max(1, Math.round(source.height * scale))
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }

  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(source, 0, 0, w, h)

  const metrics = measureStamp(ctx, w, h, opts, logo)
  if (!metrics) return

  const shortSide = Math.min(w, h)
  const rad = (opts.angle * Math.PI) / 180

  ctx.save()
  ctx.globalAlpha = Math.max(0.02, Math.min(1, opts.opacity / 100))
  ctx.globalCompositeOperation = opts.blendMode

  if (opts.layout === 'tile') {
    // 以画布中心旋转后，在覆盖整个外接对角线的网格区域内铺满，确保任意角度四角均无空白
    const diag = Math.hypot(w, h)
    const gapX = Math.max(8, (shortSide * opts.gapXPct) / 100)
    const gapY = Math.max(8, (shortSide * opts.gapYPct) / 100)
    const stepX = metrics.width + gapX
    const stepY = metrics.height + gapY

    const cols = Math.ceil(diag / stepX) + 2
    const rows = Math.ceil(diag / stepY) + 2

    ctx.translate(w / 2, h / 2)
    ctx.rotate(rad)

    for (let r = -Math.ceil(rows / 2); r <= Math.ceil(rows / 2); r++) {
      // 砖墙错行排布：奇数行水平偏移半个步长
      const staggerX = opts.stagger && Math.abs(r) % 2 === 1 ? stepX / 2 : 0
      const y = r * stepY
      for (let c = -Math.ceil(cols / 2); c <= Math.ceil(cols / 2); c++) {
        const x = c * stepX + staggerX
        ctx.save()
        ctx.translate(x, y)
        drawStampAtOrigin(ctx, metrics, opts, logo)
        ctx.restore()
      }
    }
  } else {
    // 单点模式：九宫格锚点 + 安全边距 + 用户自由拖拽微调偏移
    const margin = (shortSide * opts.marginPct) / 100
    const cos = Math.abs(Math.cos(rad))
    const sin = Math.abs(Math.sin(rad))
    const rotW = metrics.width * cos + metrics.height * sin
    const rotH = metrics.width * sin + metrics.height * cos

    const col = opts.anchor[1] // l / c / r
    const row = opts.anchor[0] // t / m / b

    let cx = w / 2
    let cy = h / 2
    if (col === 'l') cx = margin + rotW / 2
    else if (col === 'r') cx = w - margin - rotW / 2

    if (row === 't') cy = margin + rotH / 2
    else if (row === 'b') cy = h - margin - rotH / 2

    cx += opts.offsetX * w
    cy += opts.offsetY * h

    ctx.translate(cx, cy)
    ctx.rotate(rad)
    drawStampAtOrigin(ctx, metrics, opts, logo)
  }

  ctx.restore()
}

/** 决定单图导出格式与 MIME */
export function resolveExportMime(sourceMime: string, fmt: ExportFormat): { mime: string; ext: string } {
  if (fmt === 'png') return { mime: 'image/png', ext: 'png' }
  if (fmt === 'jpeg') return { mime: 'image/jpeg', ext: 'jpg' }
  if (fmt === 'webp') return { mime: 'image/webp', ext: 'webp' }
  if (sourceMime === 'image/jpeg' || sourceMime === 'image/jpg') return { mime: 'image/jpeg', ext: 'jpg' }
  if (sourceMime === 'image/webp') return { mime: 'image/webp', ext: 'webp' }
  return { mime: 'image/png', ext: 'png' }
}

/** 导出单张全分辨率带水印图片 */
export async function exportWatermarkedBlob(
  entry: ImageEntry,
  opts: WatermarkOptions,
  logo: ImageBitmap | null,
  forcePng = false,
): Promise<{ blob: Blob; filename: string }> {
  const { mime, ext } = forcePng
    ? { mime: 'image/png', ext: 'png' }
    : resolveExportMime(entry.file.type, opts.format)

  const canvas = document.createElement('canvas')
  renderWatermarkedCanvas(canvas, entry.bitmap, opts, logo, 1)
  const q = mime === 'image/png' ? undefined : Math.max(0.1, Math.min(1, opts.quality / 100))
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片导出失败'))), mime, q),
  )
  canvas.width = 0
  canvas.height = 0

  const base = entry.name.replace(/\.[^.]+$/, '') || 'watermarked'
  return { blob, filename: `${base}-水印.${ext}` }
}

/** 批量为全部图片添加水印并打包为 ZIP */
export async function exportBatchWatermarkZip(
  entries: ImageEntry[],
  opts: WatermarkOptions,
  logo: ImageBitmap | null,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const files: Record<string, Uint8Array> = {}
  const used = new Map<string, number>()

  for (let i = 0; i < entries.length; i++) {
    const { blob, filename } = await exportWatermarkedBlob(entries[i], opts, logo)
    const count = used.get(filename) ?? 0
    let finalName = filename
    if (count > 0) {
      const dot = filename.lastIndexOf('.')
      finalName = dot > 0 ? `${filename.slice(0, dot)}-${count + 1}${filename.slice(dot)}` : `${filename}-${count + 1}`
    }
    used.set(filename, count + 1)
    files[finalName] = new Uint8Array(await blob.arrayBuffer())
    onProgress?.(i + 1, entries.length)
  }

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data)))
  })
  const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
  return new Blob([buf], { type: 'application/zip' })
}
