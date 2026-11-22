import { zip } from 'fflate'
import { FORMAT_EXT, FORMAT_MIME, type SplitOptions, type TilePreview } from './types'

export interface SplitGeometry {
  /** 合成逻辑总画布尺寸（像素） */
  totalW: number
  totalH: number
  /** 单个切片输出尺寸（像素） */
  tileW: number
  tileH: number
  /** 相邻切片之间被跳过的缝隙像素 */
  gutterX: number
  gutterY: number
  /** 原图绘制到逻辑总画布上的目标矩形 */
  drawX: number
  drawY: number
  drawW: number
  drawH: number
  /** 在 square-cover 模式下，逻辑总画布在原图上的归一化选区（用于原图切线预览） */
  cropRect: { x: number; y: number; w: number; h: number }
}

/**
 * 计算九宫格切图的精确几何布局
 * 所有切片渲染与原图切线预览共用同一套公式，保证所见即所得
 */
export function computeSplitGeometry(srcW: number, srcH: number, opts: SplitOptions): SplitGeometry {
  const { rows, cols, fitMode, panX, panY, gutterPct } = opts
  const targetRatio = cols / rows
  const srcRatio = srcW / srcH

  let totalW = srcW
  let totalH = srcH
  let drawX = 0
  let drawY = 0
  let drawW = srcW
  let drawH = srcH
  let cropRect = { x: 0, y: 0, w: 1, h: 1 }

  if (fitMode === 'square-cover') {
    if (srcRatio > targetRatio) {
      // 原图更宽：高度撑满，按 panX 水平取景
      totalH = srcH
      totalW = Math.max(cols, Math.round(srcH * targetRatio))
      const freeX = srcW - totalW
      const offsetX = Math.round(freeX * Math.max(0, Math.min(1, panX)))
      drawX = -offsetX
      drawY = 0
      cropRect = { x: offsetX / srcW, y: 0, w: totalW / srcW, h: 1 }
    } else {
      // 原图更高：宽度撑满，按 panY 垂直取景
      totalW = srcW
      totalH = Math.max(rows, Math.round(srcW / targetRatio))
      const freeY = srcH - totalH
      const offsetY = Math.round(freeY * Math.max(0, Math.min(1, panY)))
      drawX = 0
      drawY = -offsetY
      cropRect = { x: 0, y: offsetY / srcH, w: 1, h: totalH / srcH }
    }
  } else if (fitMode === 'square-contain') {
    if (srcRatio > targetRatio) {
      // 原图更宽：上下补边
      totalW = srcW
      totalH = Math.max(rows, Math.round(srcW / targetRatio))
      drawX = 0
      drawY = Math.round((totalH - srcH) / 2)
    } else {
      // 原图更高：左右补边
      totalH = srcH
      totalW = Math.max(cols, Math.round(srcH * targetRatio))
      drawX = Math.round((totalW - srcW) / 2)
      drawY = 0
    }
  }

  // 计算每格尺寸与缝隙
  const gutterFrac = Math.max(0, Math.min(0.1, gutterPct / 100))
  const cellSpanW = totalW / (cols + (cols - 1) * gutterFrac)
  const cellSpanH = totalH / (rows + (rows - 1) * gutterFrac)
  const gutterX = cellSpanW * gutterFrac
  const gutterY = cellSpanH * gutterFrac

  // 应用单格最大边长限制（保持纵横比，仅缩小不放大）
  let scale = 1
  if (opts.maxTileSide > 0) {
    const longest = Math.max(cellSpanW, cellSpanH)
    if (longest > opts.maxTileSide) scale = opts.maxTileSide / longest
  }

  const tileW = Math.max(1, Math.round(cellSpanW * scale))
  const tileH = Math.max(1, Math.round(cellSpanH * scale))

  return {
    totalW,
    totalH,
    tileW,
    tileH,
    gutterX,
    gutterY,
    drawX,
    drawY,
    drawW,
    drawH,
    cropRect,
  }
}

/** 渲染单个切片到 Canvas 并导出 Blob */
export async function renderSingleTileBlob(
  bitmap: ImageBitmap,
  opts: SplitOptions,
  row: number,
  col: number,
  previewMaxSide = 0,
): Promise<{ blob: Blob; width: number; height: number }> {
  const geo = computeSplitGeometry(bitmap.width, bitmap.height, opts)
  const cellSpanW = (geo.totalW - (opts.cols - 1) * geo.gutterX) / opts.cols
  const cellSpanH = (geo.totalH - (opts.rows - 1) * geo.gutterY) / opts.rows

  let outW = geo.tileW
  let outH = geo.tileH
  if (previewMaxSide > 0) {
    const k = Math.min(1, previewMaxSide / Math.max(outW, outH))
    outW = Math.max(1, Math.round(outW * k))
    outH = Math.max(1, Math.round(outH * k))
  }

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // JPG 不支持透明，优先填充底色；square-contain 透明之外也需填充底色
  const fmt = previewMaxSide > 0 ? 'png' : opts.format
  const needFillBg =
    fmt === 'jpeg' || (opts.fitMode === 'square-contain' && opts.background !== 'transparent')
  if (needFillBg) {
    ctx.fillStyle = opts.background === 'transparent' ? '#ffffff' : opts.background
    ctx.fillRect(0, 0, outW, outH)
  }

  ctx.save()
  if (opts.radiusPct > 0) {
    const r = (Math.min(outW, outH) * opts.radiusPct) / 100
    ctx.beginPath()
    ctx.roundRect(0, 0, outW, outH, r)
    ctx.clip()
  }

  // 该格在逻辑总画布中的左上起点
  const cellX = col * (cellSpanW + geo.gutterX)
  const cellY = row * (cellSpanH + geo.gutterY)
  const sx = outW / cellSpanW
  const sy = outH / cellSpanH

  ctx.scale(sx, sy)
  ctx.translate(-cellX, -cellY)
  ctx.drawImage(bitmap, geo.drawX, geo.drawY, geo.drawW, geo.drawH)
  ctx.restore()

  const mime = FORMAT_MIME[fmt]
  const q = fmt === 'png' ? undefined : Math.max(0.1, Math.min(1, opts.quality / 100))
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('切片导出失败'))), mime, q),
  )
  canvas.width = 0
  canvas.height = 0
  return { blob, width: outW, height: outH }
}

/** 生成用于界面「九宫格发图效果预览」的轻量切片列表 */
export async function generatePreviewTiles(bitmap: ImageBitmap, opts: SplitOptions): Promise<TilePreview[]> {
  const list: TilePreview[] = []
  // 网格格子多时进一步降低单格预览分辨率，保持毫秒级响应
  const previewSide = opts.rows * opts.cols > 16 ? 220 : 360
  let idx = 1
  for (let r = 0; r < opts.rows; r++) {
    for (let c = 0; c < opts.cols; c++) {
      const { blob, width, height } = await renderSingleTileBlob(bitmap, opts, r, c, previewSide)
      list.push({
        index: idx++,
        row: r,
        col: c,
        url: URL.createObjectURL(blob),
        width,
        height,
      })
    }
  }
  return list
}

/** 生成规范有序的单张切片文件名（如 photo-01.png） */
export function tileFileName(originalName: string, index: number, total: number, format: SplitOptions['format']) {
  const base = originalName.replace(/\.[^.]+$/, '') || 'grid'
  const padLen = total >= 10 ? 2 : 1
  return `${base}-${String(index).padStart(padLen, '0')}.${FORMAT_EXT[format]}`
}

/** 渲染全分辨率全部切片并打包为 ZIP */
export async function exportSplitZip(
  bitmap: ImageBitmap,
  originalName: string,
  opts: SplitOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const total = opts.rows * opts.cols
  const entries: Record<string, Uint8Array> = {}
  let idx = 1

  for (let r = 0; r < opts.rows; r++) {
    for (let c = 0; c < opts.cols; c++) {
      const { blob } = await renderSingleTileBlob(bitmap, opts, r, c, 0)
      const name = tileFileName(originalName, idx, total, opts.format)
      entries[name] = new Uint8Array(await blob.arrayBuffer())
      onProgress?.(idx, total)
      idx++
    }
  }

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data)))
  })
  const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
  return new Blob([buf], { type: 'application/zip' })
}
