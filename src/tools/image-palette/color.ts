/** 色彩空间转换、WCAG 对比度、K-Means++ 主色调提取与色卡海报绘制 */

export interface RGB {
  r: number
  g: number
  b: number
}

export interface ColorDetail {
  rgb: RGB
  hex: string
  rgbStr: string
  hslStr: string
  oklchStr: string
  cmykStr: string
  /** 建议搭配的文字颜色（黑或白） */
  textOnColor: '#ffffff' | '#111827'
  /** 与白色和深黑的 WCAG 对比度 */
  contrastWhite: number
  contrastBlack: number
}

export interface Swatch extends ColorDetail {
  /** 该主色在画面中的占比（0 - 100） */
  ratio: number
}

const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)))

export function rgbToHex({ r, g, b }: RGB): string {
  const toHex = (n: number) => clampByte(n).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase()
}

export function hexToRgb(hex: string): RGB | null {
  const clean = hex.trim().replace(/^#/, '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

/** sRGB -> HSL */
export function rgbToHsl({ r, g, b }: RGB): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l: Math.round(l * 100) }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  h = Math.round(h * 60)
  if (h < 0) h += 360
  return { h, s: Math.round(s * 100), l: Math.round(l * 100) }
}

/** sRGB 伽马反变换到线性光 */
function srgbToLinear(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/** sRGB -> OKLCH（Björn Ottosson 标准变换矩阵） */
export function rgbToOklch({ r, g, b }: RGB): { l: number; c: number; h: number } {
  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)

  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const bv = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_

  const C = Math.hypot(a, bv)
  let H = (Math.atan2(bv, a) * 180) / Math.PI
  if (H < 0) H += 360

  return {
    l: Math.max(0, Math.min(1, L)),
    c: Math.max(0, C),
    h: C < 0.0005 ? 0 : H,
  }
}

/** sRGB -> CMYK */
export function rgbToCmyk({ r, g, b }: RGB): { c: number; m: number; y: number; k: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const k = 1 - Math.max(rn, gn, bn)
  if (k >= 0.999) return { c: 0, m: 0, y: 0, k: 100 }
  return {
    c: Math.round(((1 - rn - k) / (1 - k)) * 100),
    m: Math.round(((1 - gn - k) / (1 - k)) * 100),
    y: Math.round(((1 - bn - k) / (1 - k)) * 100),
    k: Math.round(k * 100),
  }
}

/** 计算 WCAG 2.1 相对亮度与对比度 */
function relativeLuminance({ r, g, b }: RGB): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2))
}

/** 构造完整色值详情对象 */
export function buildColorDetail(rgb: RGB): ColorDetail {
  const clean: RGB = { r: clampByte(rgb.r), g: clampByte(rgb.g), b: clampByte(rgb.b) }
  const hex = rgbToHex(clean)
  const hsl = rgbToHsl(clean)
  const oklch = rgbToOklch(clean)
  const cmyk = rgbToCmyk(clean)

  const lum = relativeLuminance(clean)
  const contrastWhite = contrastRatio(lum, 1)
  const contrastBlack = contrastRatio(lum, relativeLuminance({ r: 17, g: 24, b: 39 }))

  return {
    rgb: clean,
    hex,
    rgbStr: `rgb(${clean.r}, ${clean.g}, ${clean.b})`,
    hslStr: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
    oklchStr: `oklch(${(oklch.l * 100).toFixed(1)}% ${oklch.c.toFixed(3)} ${oklch.h.toFixed(1)})`,
    cmykStr: `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`,
    textOnColor: contrastWhite >= contrastBlack ? '#ffffff' : '#111827',
    contrastWhite,
    contrastBlack,
  }
}

/** HSL -> RGB（用于生成和谐衍生配色） */
function hslToRgb(h: number, s: number, l: number): RGB {
  const hn = ((h % 360) + 360) % 360
  const sn = Math.max(0, Math.min(100, s)) / 100
  const ln = Math.max(0, Math.min(100, l)) / 100
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1))
  const m = ln - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (hn < 60) [r, g, b] = [c, x, 0]
  else if (hn < 120) [r, g, b] = [x, c, 0]
  else if (hn < 180) [r, g, b] = [0, c, x]
  else if (hn < 240) [r, g, b] = [0, x, c]
  else if (hn < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

/** 基于当前选中色生成互补色、类似色、三等分色与 5 阶明暗色阶 */
export function buildHarmonies(rgb: RGB) {
  const { h, s, l } = rgbToHsl(rgb)
  return {
    complementary: [buildColorDetail(rgb), buildColorDetail(hslToRgb(h + 180, s, l))],
    analogous: [
      buildColorDetail(hslToRgb(h - 30, s, l)),
      buildColorDetail(rgb),
      buildColorDetail(hslToRgb(h + 30, s, l)),
    ],
    triadic: [
      buildColorDetail(rgb),
      buildColorDetail(hslToRgb(h + 120, s, l)),
      buildColorDetail(hslToRgb(h + 240, s, l)),
    ],
    shades: [18, 34, 50, 68, 86].map((lv) => buildColorDetail(hslToRgb(h, Math.min(s, 88), lv))),
  }
}

/** 加权欧氏距离（红均值感知近似，更符合人眼色差） */
function colorDistSq(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const rMean = (r1 + r2) / 2
  const dr = r1 - r2
  const dg = g1 - g2
  const db = b1 - b2
  return (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db
}

/**
 * 使用 K-Means++ 从 ImageBitmap 提取图片主色调
 * 说明：先降采样至最大 150px 边长，再进行确定性 K-Means++ 初始化与迭代聚类，速度极快且能兼顾占比与点睛高饱和色
 */
export function extractPalette(bitmap: ImageBitmap, count = 6): Swatch[] {
  const maxSide = 150
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  canvas.width = 0
  canvas.height = 0

  // 采样不透明像素（最多取 ~8000 个点保证毫秒级收敛）
  const totalPixels = w * h
  const stride = Math.max(1, Math.floor(totalPixels / 8000))
  const samples: number[] = []
  for (let i = 0; i < totalPixels; i += stride) {
    const idx = i * 4
    if (data[idx + 3] < 128) continue
    samples.push(data[idx], data[idx + 1], data[idx + 2])
  }
  const n = samples.length / 3
  if (n === 0) return []

  const k = Math.min(count, n)
  const centers: [number, number, number][] = []

  // 确定性 K-Means++ 初始化：首中心选样本中点，后续每次选择距已有中心最远的像素
  const mid = Math.floor(n / 2) * 3
  centers.push([samples[mid], samples[mid + 1], samples[mid + 2]])

  const minDists = new Float64Array(n).fill(Infinity)
  for (let c = 1; c < k; c++) {
    const [cr, cg, cb] = centers[c - 1]
    let bestIdx = 0
    let bestDist = -1
    for (let i = 0; i < n; i++) {
      const p = i * 3
      const d = colorDistSq(samples[p], samples[p + 1], samples[p + 2], cr, cg, cb)
      if (d < minDists[i]) minDists[i] = d
      if (minDists[i] > bestDist) {
        bestDist = minDists[i]
        bestIdx = i
      }
    }
    const bp = bestIdx * 3
    centers.push([samples[bp], samples[bp + 1], samples[bp + 2]])
  }

  // K-Means 迭代收敛（12 轮即可高度稳定）
  const assignments = new Int32Array(n)
  const sumR = new Float64Array(k)
  const sumG = new Float64Array(k)
  const sumB = new Float64Array(k)
  const counts = new Int32Array(k)

  for (let iter = 0; iter < 12; iter++) {
    sumR.fill(0)
    sumG.fill(0)
    sumB.fill(0)
    counts.fill(0)

    for (let i = 0; i < n; i++) {
      const p = i * 3
      const r = samples[p]
      const g = samples[p + 1]
      const b = samples[p + 2]
      let bestC = 0
      let bestD = Infinity
      for (let c = 0; c < k; c++) {
        const d = colorDistSq(r, g, b, centers[c][0], centers[c][1], centers[c][2])
        if (d < bestD) {
          bestD = d
          bestC = c
        }
      }
      assignments[i] = bestC
      sumR[bestC] += r
      sumG[bestC] += g
      sumB[bestC] += b
      counts[bestC]++
    }

    let moved = 0
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue
      const nr = sumR[c] / counts[c]
      const ng = sumG[c] / counts[c]
      const nb = sumB[c] / counts[c]
      moved += Math.abs(nr - centers[c][0]) + Math.abs(ng - centers[c][1]) + Math.abs(nb - centers[c][2])
      centers[c] = [nr, ng, nb]
    }
    if (moved < 1.5) break
  }

  // 按占比降序排列并合并极相近色
  const raw = centers
    .map((c, idx) => ({
      rgb: { r: c[0], g: c[1], b: c[2] },
      count: counts[idx],
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)

  const totalUsed = raw.reduce((s, x) => s + x.count, 0) || 1
  return raw.map((item) => ({
    ...buildColorDetail(item.rgb),
    ratio: Math.max(1, Math.round((item.count / totalUsed) * 100)),
  }))
}

/** 绘制高清色卡海报 PNG（上方原图 + 下方主色调色块条与 HEX 标注） */
export async function renderPaletteCardBlob(bitmap: ImageBitmap, swatches: Swatch[], title: string): Promise<Blob> {
  const cardW = 1200
  const pad = 48
  const innerW = cardW - pad * 2
  const imgRatio = bitmap.height / bitmap.width
  const imgH = Math.max(280, Math.min(720, Math.round(innerW * imgRatio)))
  const swatchH = 148
  const footerH = 44
  const cardH = pad + imgH + 28 + swatchH + 24 + footerH + pad - 12

  const canvas = document.createElement('canvas')
  canvas.width = cardW
  canvas.height = cardH
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // 卡片浅雅底色
  ctx.fillStyle = '#fafafa'
  ctx.fillRect(0, 0, cardW, cardH)

  // 绘制圆角原图（cover 填充）
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(pad, pad, innerW, imgH, 24)
  ctx.clip()
  const scale = Math.max(innerW / bitmap.width, imgH / bitmap.height)
  const dw = bitmap.width * scale
  const dh = bitmap.height * scale
  ctx.drawImage(bitmap, pad + (innerW - dw) / 2, pad + (imgH - dh) / 2, dw, dh)
  ctx.restore()

  // 绘制主色调色块列
  const topY = pad + imgH + 28
  const gap = 14
  const count = swatches.length
  const itemW = (innerW - gap * (count - 1)) / count

  swatches.forEach((sw, i) => {
    const x = pad + i * (itemW + gap)
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x, topY, itemW, swatchH, 16)
    ctx.fillStyle = sw.hex
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.08)'
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.fillStyle = sw.textOnColor
    ctx.textAlign = 'center'
    ctx.font = '700 18px "JetBrains Mono", ui-monospace, monospace'
    ctx.fillText(sw.hex, x + itemW / 2, topY + swatchH - 36)
    ctx.globalAlpha = 0.78
    ctx.font = '500 13px Inter, -apple-system, sans-serif'
    ctx.fillText(`${sw.ratio}%`, x + itemW / 2, topY + swatchH - 16)
    ctx.restore()
  })

  // 底部信息行
  const footY = topY + swatchH + 42
  ctx.fillStyle = '#52525b'
  ctx.font = '600 16px "PingFang SC", Inter, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(title.replace(/\.[^.]+$/, '') || 'Color Palette', pad, footY)
  ctx.fillStyle = '#a1a1aa'
  ctx.font = '500 14px "PingFang SC", Inter, sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText('由 轻匣 · 图片取色 本地生成', cardW - pad, footY)

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('色卡生成失败'))), 'image/png'),
  )
  canvas.width = 0
  canvas.height = 0
  return blob
}
