import { zip } from 'fflate'
import {
  FORMAT_EXT,
  FORMAT_MIME,
  RATIO_PRESETS,
  type SliceOptions,
  type SliceSegment,
} from './types'

/** 计算按比例或固定高度模式下的标准单页高度 */
export function getStandardPageHeight(srcW: number, srcH: number, opts: SliceOptions): number {
  if (opts.mode === 'ratio') {
    const preset = RATIO_PRESETS.find((p) => p.id === opts.ratioId) ?? RATIO_PRESETS[0]
    return Math.max(64, Math.round(srcW / preset.ratio))
  }
  if (opts.mode === 'height') {
    return Math.max(64, Math.round(opts.sliceHeight))
  }
  if (opts.mode === 'count') {
    return Math.max(64, Math.round(srcH / Math.max(1, opts.sliceCount)))
  }
  return Math.max(64, Math.round(srcH / 3))
}

/** 根据模式自动生成水平切线位置数组（原图 Y 坐标，不含 0 和 srcH） */
export function generateAutoCuts(srcW: number, srcH: number, opts: SliceOptions): number[] {
  if (opts.mode === 'count') {
    const n = Math.max(1, Math.min(30, Math.round(opts.sliceCount)))
    const cuts: number[] = []
    for (let i = 1; i < n; i++) {
      cuts.push(Math.round((srcH * i) / n))
    }
    return cuts
  }

  const pageH = getStandardPageHeight(srcW, srcH, opts)
  if (pageH >= srcH) return []

  const cuts: number[] = []
  let y = pageH
  // 限制最多切 60 页，防止误输极小高度卡顿
  while (y < srcH && cuts.length < 60) {
    cuts.push(y)
    y += pageH
  }

  // 若开启“末页过矮自动并入上一页”且最后一段不足标准高度 22%，撤回最后一条切线
  if (opts.lastPageMode === 'merge' && cuts.length > 0) {
    const tail = srcH - cuts[cuts.length - 1]
    if (tail < pageH * 0.22) {
      cuts.pop()
    }
  }
  return cuts
}

/** 将切线数组（升序 Y 坐标）转为分页区间列表 */
export function cutsToSegments(srcW: number, srcH: number, cuts: number[], opts: SliceOptions): SliceSegment[] {
  const sorted = [...cuts]
    .map((y) => Math.max(16, Math.min(srcH - 16, Math.round(y))))
    .sort((a, b) => a - b)
    .filter((y, i, arr) => i === 0 || y - arr[i - 1] >= 16)

  const bounds = [0, ...sorted, srcH]
  const stdH = opts.mode === 'ratio' || opts.mode === 'height' ? getStandardPageHeight(srcW, srcH, opts) : 0
  const overlap = Math.max(0, Math.round(opts.overlapPx))

  return bounds.slice(0, -1).map((rawStart, i) => {
    const rawEnd = bounds[i + 1]
    // 非首页向上延伸 overlapPx，提供阅读上下文衔接
    const startY = i === 0 ? 0 : Math.max(0, rawStart - overlap)
    const endY = rawEnd
    const contentH = Math.max(1, endY - startY)
    const isLast = i === bounds.length - 2
    const outHeight = isLast && opts.lastPageMode === 'pad' && stdH > contentH ? stdH : contentH
    return {
      index: i + 1,
      startY,
      endY,
      outHeight,
    }
  })
}

/**
 * 智能避字吸附：在每条切线附近 ±searchPx 范围内，寻找水平行像素方差最小的“纯色空白缝隙”，
 * 避免切线把文字或图标从中间拦腰切断。
 */
export function snapCutsToWhitespace(bitmap: ImageBitmap, cuts: number[], searchPx = 90): number[] {
  if (!cuts.length) return []
  // 水平降采样到最大 320px 宽，垂直保持精简比例，几毫秒即可扫描完超长截图
  const maxW = 320
  const scaleX = Math.min(1, maxW / bitmap.width)
  const scaleY = Math.min(1, 6000 / bitmap.height)
  const sw = Math.max(16, Math.round(bitmap.width * scaleX))
  const sh = Math.max(16, Math.round(bitmap.height * scaleY))

  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0, sw, sh)
  const { data } = ctx.getImageData(0, 0, sw, sh)
  canvas.width = 0
  canvas.height = 0

  // 计算每一行水平灰度梯度与方差之和（空白纯色行能量接近 0，文字/图形行能量很高）
  const rowEnergy = new Float32Array(sh)
  for (let y = 0; y < sh; y++) {
    const rowOff = y * sw * 4
    let sum = 0
    let sumSq = 0
    let edge = 0
    let prevLum = 0
    for (let x = 0; x < sw; x++) {
      const idx = rowOff + x * 4
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
      sum += lum
      sumSq += lum * lum
      if (x > 0) edge += Math.abs(lum - prevLum)
      prevLum = lum
    }
    const mean = sum / sw
    const variance = sumSq / sw - mean * mean
    rowEnergy[y] = variance + (edge / sw) * 14
  }

  // 对每条切线在搜索窗内找最小能量行（优先靠近原切线，且保证前后行同样干净）
  const winScaled = Math.max(4, Math.round(searchPx * scaleY))
  return cuts.map((origY) => {
    const center = Math.round(origY * scaleY)
    const lo = Math.max(2, center - winScaled)
    const hi = Math.min(sh - 3, center + winScaled)
    let bestRow = center
    let bestScore = Infinity
    for (let r = lo; r <= hi; r++) {
      // 取连续 3 行均值，确保空白带有一定厚度而非单像素噪点
      const band = (rowEnergy[r - 1] + rowEnergy[r] * 2 + rowEnergy[r + 1]) / 4
      // 距离原切线越远施加轻微惩罚，避免无故大跳
      const distPenalty = Math.abs(r - center) * 0.35
      const score = band + distPenalty
      if (score < bestScore) {
        bestScore = score
        bestRow = r
      }
    }
    return Math.max(16, Math.min(bitmap.height - 16, Math.round(bestRow / scaleY)))
  })
}

/** 采样原图底边平均色（用于末页一键取同色补边） */
export function sampleBottomEdgeColor(bitmap: ImageBitmap): string {
  const canvas = document.createElement('canvas')
  const w = Math.min(120, bitmap.width)
  canvas.width = w
  canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, bitmap.height - 1, bitmap.width, 1, 0, 0, w, 1)
  const { data } = ctx.getImageData(0, 0, w, 1)
  canvas.width = 0
  canvas.height = 0
  let r = 0
  let g = 0
  let b = 0
  for (let i = 0; i < w; i++) {
    r += data[i * 4]
    g += data[i * 4 + 1]
    b += data[i * 4 + 2]
  }
  const toHex = (n: number) => Math.round(n / w).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/** 渲染单个分页切片为 Blob */
export async function renderSliceBlob(
  bitmap: ImageBitmap,
  seg: SliceSegment,
  opts: SliceOptions,
  previewMaxW = 0,
): Promise<Blob> {
  const srcW = bitmap.width
  const contentH = seg.endY - seg.startY
  const scale = previewMaxW > 0 ? Math.min(1, previewMaxW / srcW) : 1
  const outW = Math.max(1, Math.round(srcW * scale))
  const outH = Math.max(1, Math.round(seg.outHeight * scale))
  const drawH = Math.max(1, Math.round(contentH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const fmt = previewMaxW > 0 ? 'png' : opts.format
  if (fmt === 'jpeg' || (outH > drawH && opts.background !== 'transparent')) {
    ctx.fillStyle = opts.background === 'transparent' ? '#ffffff' : opts.background
    ctx.fillRect(0, 0, outW, outH)
  }

  ctx.drawImage(bitmap, 0, seg.startY, srcW, contentH, 0, 0, outW, drawH)

  const mime = FORMAT_MIME[fmt]
  const q = fmt === 'png' ? undefined : Math.max(0.1, Math.min(1, opts.quality / 100))
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('切片导出失败'))), mime, q),
  )
  canvas.width = 0
  canvas.height = 0
  return blob
}

/** 生成有序单页文件名 */
export function sliceFileName(originalName: string, index: number, total: number, format: SliceOptions['format']) {
  const base = originalName.replace(/\.[^.]+$/, '') || 'slice'
  const padLen = total >= 10 ? 2 : 1
  return `${base}-P${String(index).padStart(padLen, '0')}.${FORMAT_EXT[format]}`
}

/** 渲染全分辨率全部切分页并打包 ZIP */
export async function exportSlicesZip(
  bitmap: ImageBitmap,
  originalName: string,
  segments: SliceSegment[],
  opts: SliceOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {}
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const blob = await renderSliceBlob(bitmap, seg, opts, 0)
    const name = sliceFileName(originalName, seg.index, segments.length, opts.format)
    entries[name] = new Uint8Array(await blob.arrayBuffer())
    onProgress?.(i + 1, segments.length)
  }

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data)))
  })
  const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
  return new Blob([buf], { type: 'application/zip' })
}
