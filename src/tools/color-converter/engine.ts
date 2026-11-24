/**
 * 全色彩空间双向转换、OKLCH 11 阶色板、WCAG 2.1 无障碍对比度与自动达标修正引擎（零第三方依赖）
 * - 支持 HEX(3/4/6/8)、RGB/RGBA、HSL/HSLA、OKLCH、CMYK、HSV 及常见 CSS 命名色解析
 * - 精准实现 Björn Ottosson OKLab / OKLCH 正向与逆向矩阵变换，支持 sRGB 色域溢出检测
 */

export interface RGBA {
  r: number // 0 - 255
  g: number // 0 - 255
  b: number // 0 - 255
  a: number // 0 - 1
}

export interface HSL {
  h: number // 0 - 360
  s: number // 0 - 100
  l: number // 0 - 100
}

export interface HSV {
  h: number // 0 - 360
  s: number // 0 - 100
  v: number // 0 - 100
}

export interface OKLCH {
  l: number // 0 - 1
  c: number // 0 - 0.4
  h: number // 0 - 360
}

export interface CMYK {
  c: number // 0 - 100
  m: number // 0 - 100
  y: number // 0 - 100
  k: number // 0 - 100
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const clampByte = (v: number) => Math.round(clamp(v, 0, 255))

/** 常见 CSS 命名色速查表 */
const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  orange: '#ffa500',
  purple: '#800080',
  pink: '#ffc0cb',
  coral: '#ff7f50',
  tomato: '#ff6347',
  gold: '#ffd700',
  indigo: '#4b0082',
  violet: '#ee82ee',
  teal: '#008080',
  navy: '#000080',
  crimson: '#dc143c',
  turquoise: '#40e0d0',
  salmon: '#fa8072',
  skyblue: '#87ceeb',
  rebeccapurple: '#663399',
}

// ======================== sRGB 线性光与伽马变换 ========================

function srgbChannelToLinear(c255: number): number {
  const v = clamp(c255, 0, 255) / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function linearToSrgbChannel(lin: number): number {
  const v = clamp(lin, 0, 1)
  const s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  return clampByte(s * 255)
}

// ======================== RGB 与各色彩空间互转 ========================

export function rgbaToHex({ r, g, b, a }: RGBA, includeAlpha = false): string {
  const h = (n: number) => clampByte(n).toString(16).padStart(2, '0')
  const base = `#${h(r)}${h(g)}${h(b)}`
  if (includeAlpha || a < 0.999) {
    return `${base}${h(a * 255)}`.toUpperCase()
  }
  return base.toUpperCase()
}

export function rgbToHsl({ r, g, b }: Pick<RGBA, 'r' | 'g' | 'b'>): HSL {
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

export function hslToRgb({ h, s, l }: HSL): { r: number; g: number; b: number } {
  const hn = ((h % 360) + 360) % 360
  const sn = clamp(s, 0, 100) / 100
  const ln = clamp(l, 0, 100) / 100
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
  return {
    r: clampByte((r + m) * 255),
    g: clampByte((g + m) * 255),
    b: clampByte((b + m) * 255),
  }
}

export function rgbToHsv({ r, g, b }: Pick<RGBA, 'r' | 'g' | 'b'>): HSV {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  const v = max
  const s = max === 0 ? 0 : d / max
  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h = Math.round(h * 60)
    if (h < 0) h += 360
  }
  return { h, s: Math.round(s * 100), v: Math.round(v * 100) }
}

export function rgbToCmyk({ r, g, b }: Pick<RGBA, 'r' | 'g' | 'b'>): CMYK {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const k = 1 - Math.max(rn, gn, bn)
  if (k >= 0.9999) return { c: 0, m: 0, y: 0, k: 100 }
  return {
    c: Math.round(((1 - rn - k) / (1 - k)) * 100),
    m: Math.round(((1 - gn - k) / (1 - k)) * 100),
    y: Math.round(((1 - bn - k) / (1 - k)) * 100),
    k: Math.round(k * 100),
  }
}

export function cmykToRgb({ c, m, y, k }: CMYK): { r: number; g: number; b: number } {
  const cn = clamp(c, 0, 100) / 100
  const mn = clamp(m, 0, 100) / 100
  const yn = clamp(y, 0, 100) / 100
  const kn = clamp(k, 0, 100) / 100
  return {
    r: clampByte(255 * (1 - cn) * (1 - kn)),
    g: clampByte(255 * (1 - mn) * (1 - kn)),
    b: clampByte(255 * (1 - yn) * (1 - kn)),
  }
}

/** sRGB -> OKLCH */
export function rgbToOklch({ r, g, b }: Pick<RGBA, 'r' | 'g' | 'b'>): OKLCH {
  const lr = srgbChannelToLinear(r)
  const lg = srgbChannelToLinear(g)
  const lb = srgbChannelToLinear(b)

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
    l: clamp(L, 0, 1),
    c: Math.max(0, C),
    h: C < 0.0005 ? 0 : H,
  }
}

/** OKLCH -> sRGB（同时返回是否超出 sRGB 色域标记） */
export function oklchToRgb({ l, c, h }: OKLCH): { r: number; g: number; b: number; outOfGamut: boolean } {
  const L = clamp(l, 0, 1)
  const C = Math.max(0, c)
  const rad = (h * Math.PI) / 180
  const a = C * Math.cos(rad)
  const bv = C * Math.sin(rad)

  const l_ = L + 0.3963377774 * a + 0.2158037573 * bv
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bv
  const s_ = L - 0.0894841775 * a - 1.291485548 * bv

  const l3 = l_ * l_ * l_
  const m3 = m_ * m_ * m_
  const s3 = s_ * s_ * s_

  const lr = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3
  const lg = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3
  const lb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3

  const eps = 0.002
  const outOfGamut = lr < -eps || lr > 1 + eps || lg < -eps || lg > 1 + eps || lb < -eps || lb > 1 + eps

  return {
    r: linearToSrgbChannel(lr),
    g: linearToSrgbChannel(lg),
    b: linearToSrgbChannel(lb),
    outOfGamut,
  }
}

// ======================== 全格式智能解析器 ========================

function parseAlphaToken(raw: string | undefined): number {
  if (!raw) return 1
  const t = raw.trim()
  if (t.endsWith('%')) return clamp(Number.parseFloat(t) / 100, 0, 1)
  const n = Number.parseFloat(t)
  return Number.isFinite(n) ? clamp(n, 0, 1) : 1
}

/** 解析任意常见 CSS/设计色彩字符串为 RGBA */
export function parseAnyColor(raw: string): RGBA | null {
  const input = raw.trim().toLowerCase()
  if (!input) return null

  // 1. CSS 命名色
  if (NAMED_COLORS[input]) {
    return parseAnyColor(NAMED_COLORS[input])
  }

  // 2. HEX (#rgb, #rgba, #rrggbb, #rrggbbaa，允许省略 #)
  const hexMatch = input.match(/^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/)
  if (hexMatch) {
    const h = hexMatch[1]
    if (h.length === 3 || h.length === 4) {
      const r = parseInt(h[0] + h[0], 16)
      const g = parseInt(h[1] + h[1], 16)
      const b = parseInt(h[2] + h[2], 16)
      const a = h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1
      return { r, g, b, a }
    }
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    return { r, g, b, a }
  }

  // 3. rgb() / rgba()（支持逗号分隔与 CSS Color 4 空格+斜杠写法）
  const rgbMatch = input.match(/^rgba?\(\s*([^)]+)\s*\)$/)
  if (rgbMatch) {
    const parts = rgbMatch[1].replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean)
    if (parts.length >= 3) {
      const parseChannel = (tok: string) =>
        tok.endsWith('%') ? clampByte((Number.parseFloat(tok) / 100) * 255) : clampByte(Number.parseFloat(tok))
      const r = parseChannel(parts[0])
      const g = parseChannel(parts[1])
      const b = parseChannel(parts[2])
      if ([r, g, b].every((n) => Number.isFinite(n))) {
        return { r, g, b, a: parseAlphaToken(parts[3]) }
      }
    }
  }

  // 4. hsl() / hsla()
  const hslMatch = input.match(/^hsla?\(\s*([^)]+)\s*\)$/)
  if (hslMatch) {
    const parts = hslMatch[1].replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean)
    if (parts.length >= 3) {
      const h = Number.parseFloat(parts[0].replace(/deg$/i, ''))
      const s = Number.parseFloat(parts[1])
      const l = Number.parseFloat(parts[2])
      if ([h, s, l].every((n) => Number.isFinite(n))) {
        return { ...hslToRgb({ h, s, l }), a: parseAlphaToken(parts[3]) }
      }
    }
  }

  // 5. oklch(L C H [/ A])（支持 L 写成 0.55 或 55%）
  const oklchMatch = input.match(/^oklch\(\s*([^)]+)\s*\)$/)
  if (oklchMatch) {
    const parts = oklchMatch[1].replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean)
    if (parts.length >= 3) {
      const rawL = parts[0]
      const l = rawL.endsWith('%') ? Number.parseFloat(rawL) / 100 : Number.parseFloat(rawL)
      const c = Number.parseFloat(parts[1])
      const h = parts[2] === 'none' ? 0 : Number.parseFloat(parts[2].replace(/deg$/i, ''))
      if ([l, c, h].every((n) => Number.isFinite(n))) {
        const rgb = oklchToRgb({ l, c, h })
        return { r: rgb.r, g: rgb.g, b: rgb.b, a: parseAlphaToken(parts[3]) }
      }
    }
  }

  // 6. cmyk(C, M, Y, K)
  const cmykMatch = input.match(/^(?:device-)?cmyk\(\s*([^)]+)\s*\)$/)
  if (cmykMatch) {
    const parts = cmykMatch[1].split(/[\s,]+/).filter(Boolean)
    if (parts.length >= 4) {
      const vals = parts.slice(0, 4).map((p) => {
        const n = Number.parseFloat(p)
        return p.endsWith('%') || n > 1 ? n : n * 100
      })
      if (vals.every((n) => Number.isFinite(n))) {
        return { ...cmykToRgb({ c: vals[0], m: vals[1], y: vals[2], k: vals[3] }), a: 1 }
      }
    }
  }

  return null
}

// ======================== 完整色值格式输出 ========================

export interface FormattedColorCodes {
  hex: string
  hexAlpha: string
  rgb: string
  rgbCss4: string
  hsl: string
  oklch: string
  cmyk: string
  hsv: string
}

export function formatAllColorCodes(rgba: RGBA): FormattedColorCodes {
  const r = clampByte(rgba.r)
  const g = clampByte(rgba.g)
  const b = clampByte(rgba.b)
  const a = Math.round(clamp(rgba.a, 0, 1) * 100) / 100
  const hasAlpha = a < 0.999

  const hsl = rgbToHsl({ r, g, b })
  const hsv = rgbToHsv({ r, g, b })
  const cmyk = rgbToCmyk({ r, g, b })
  const oklch = rgbToOklch({ r, g, b })

  return {
    hex: rgbaToHex({ r, g, b, a: 1 }),
    hexAlpha: rgbaToHex({ r, g, b, a }, true),
    rgb: hasAlpha ? `rgba(${r}, ${g}, ${b}, ${a})` : `rgb(${r}, ${g}, ${b})`,
    rgbCss4: hasAlpha ? `rgb(${r} ${g} ${b} / ${Math.round(a * 100)}%)` : `rgb(${r} ${g} ${b})`,
    hsl: hasAlpha ? `hsla(${hsl.h}, ${hsl.s}%, ${hsl.l}%, ${a})` : `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
    oklch: hasAlpha
      ? `oklch(${(oklch.l * 100).toFixed(1)}% ${oklch.c.toFixed(3)} ${oklch.h.toFixed(1)} / ${Math.round(a * 100)}%)`
      : `oklch(${(oklch.l * 100).toFixed(1)}% ${oklch.c.toFixed(3)} ${oklch.h.toFixed(1)})`,
    cmyk: `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`,
    hsv: `hsv(${hsv.h}°, ${hsv.s}%, ${hsv.v}%)`,
  }
}

// ======================== OKLCH 11 阶色板与和谐配色 ========================

export interface ScaleStop {
  step: number
  hex: string
  oklch: string
  textColor: '#ffffff' | '#111827'
}

/** 基于 OKLCH 感知均匀亮度生成 Tailwind 风格 50–950 11 阶色板 */
export function buildOklchScale(rgba: RGBA): ScaleStop[] {
  const base = rgbToOklch(rgba)
  const targets: { step: number; l: number; chromaFactor: number }[] = [
    { step: 50, l: 0.972, chromaFactor: 0.16 },
    { step: 100, l: 0.935, chromaFactor: 0.32 },
    { step: 200, l: 0.865, chromaFactor: 0.56 },
    { step: 300, l: 0.775, chromaFactor: 0.78 },
    { step: 400, l: 0.675, chromaFactor: 0.94 },
    { step: 500, l: 0.585, chromaFactor: 1.0 },
    { step: 600, l: 0.505, chromaFactor: 0.98 },
    { step: 700, l: 0.43, chromaFactor: 0.88 },
    { step: 800, l: 0.355, chromaFactor: 0.72 },
    { step: 900, l: 0.285, chromaFactor: 0.56 },
    { step: 950, l: 0.21, chromaFactor: 0.42 },
  ]

  return targets.map((t) => {
    const c = base.c * t.chromaFactor
    const rgb = oklchToRgb({ l: t.l, c, h: base.h })
    const hex = rgbaToHex({ ...rgb, a: 1 })
    const actualOklch = rgbToOklch(rgb)
    const cw = computeContrastRatio({ ...rgb, a: 1 }, { r: 255, g: 255, b: 255, a: 1 })
    const cb = computeContrastRatio({ ...rgb, a: 1 }, { r: 17, g: 24, b: 39, a: 1 })
    return {
      step: t.step,
      hex,
      oklch: `oklch(${(actualOklch.l * 100).toFixed(1)}% ${actualOklch.c.toFixed(3)} ${actualOklch.h.toFixed(1)})`,
      textColor: cw >= cb ? '#ffffff' : '#111827',
    }
  })
}

/** 衍生和谐配色方案 */
export function buildColorHarmonies(rgba: RGBA) {
  const base = rgbToOklch(rgba)
  const shiftHue = (delta: number) => {
    const rgb = oklchToRgb({ l: base.l, c: base.c, h: (base.h + delta + 360) % 360 })
    return rgbaToHex({ ...rgb, a: 1 })
  }
  const cur = rgbaToHex({ ...rgba, a: 1 })
  return [
    { name: '互补色', colors: [cur, shiftHue(180)] },
    { name: '类似色', colors: [shiftHue(-30), cur, shiftHue(30)] },
    { name: '三等分色', colors: [cur, shiftHue(120), shiftHue(240)] },
    { name: '分裂互补', colors: [cur, shiftHue(150), shiftHue(210)] },
  ]
}

// ======================== WCAG 2.1 对比度与智能达标修正 ========================

/** 将半透明前景色按 Alpha 合成至不透明背景色上 */
export function compositeOver(fg: RGBA, bg: RGBA): { r: number; g: number; b: number } {
  const a = clamp(fg.a, 0, 1)
  return {
    r: clampByte(fg.r * a + bg.r * (1 - a)),
    g: clampByte(fg.g * a + bg.g * (1 - a)),
    b: clampByte(fg.b * a + bg.b * (1 - a)),
  }
}

export function relativeLuminance(rgb: Pick<RGBA, 'r' | 'g' | 'b'>): number {
  return (
    0.2126 * srgbChannelToLinear(rgb.r) +
    0.7152 * srgbChannelToLinear(rgb.g) +
    0.0722 * srgbChannelToLinear(rgb.b)
  )
}

/** 计算 WCAG 2.1 对比度（1.00 ~ 21.00） */
export function computeContrastRatio(fg: RGBA, bg: RGBA): number {
  const effectiveFg = fg.a < 0.999 ? compositeOver(fg, bg) : fg
  const l1 = relativeLuminance(effectiveFg)
  const l2 = relativeLuminance(bg)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2))
}

export interface WcagReport {
  ratio: number
  aaNormal: boolean // >= 4.5
  aaaNormal: boolean // >= 7.0
  aaLarge: boolean // >= 3.0
  aaaLarge: boolean // >= 4.5
  uiComponent: boolean // >= 3.0
  grade: 'AAA' | 'AA' | 'AA Large' | '不达标'
}

export function evaluateWcag(fg: RGBA, bg: RGBA): WcagReport {
  const ratio = computeContrastRatio(fg, bg)
  const aaNormal = ratio >= 4.5
  const aaaNormal = ratio >= 7.0
  const aaLarge = ratio >= 3.0
  const aaaLarge = ratio >= 4.5
  const uiComponent = ratio >= 3.0
  const grade = aaaNormal ? 'AAA' : aaNormal ? 'AA' : aaLarge ? 'AA Large' : '不达标'
  return { ratio, aaNormal, aaaNormal, aaLarge, aaaLarge, uiComponent, grade }
}

/**
 * 保持色相 H 不变，通过二分调节 OKLCH 亮度 L 自动搜索最接近原色且满足目标对比度的前景色
 */
export function suggestAccessibleForeground(fg: RGBA, bg: RGBA, targetRatio: number): RGBA | null {
  if (computeContrastRatio(fg, bg) >= targetRatio) return fg

  const base = rgbToOklch(fg)
  const bgLum = relativeLuminance(bg)

  const searchDirection = (towardsDark: boolean): { rgba: RGBA; dist: number } | null => {
    let lo = towardsDark ? 0 : base.l
    let hi = towardsDark ? base.l : 1
    let best: RGBA | null = null

    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      const rgb = oklchToRgb({ l: mid, c: base.c, h: base.h })
      const cand: RGBA = { r: rgb.r, g: rgb.g, b: rgb.b, a: 1 }
      const ratio = computeContrastRatio(cand, bg)
      if (ratio >= targetRatio) {
        best = cand
        if (towardsDark) lo = mid
        else hi = mid
      } else {
        if (towardsDark) hi = mid
        else lo = mid
      }
    }
    if (!best) return null
    const bestL = rgbToOklch(best).l
    return { rgba: best, dist: Math.abs(bestL - base.l) }
  }

  const darkCand = searchDirection(true)
  const lightCand = searchDirection(false)
  if (darkCand && lightCand) {
    return darkCand.dist <= lightCand.dist ? darkCand.rgba : lightCand.rgba
  }
  if (darkCand) return darkCand.rgba
  if (lightCand) return lightCand.rgba

  // 极端情况回退纯黑或纯白
  return bgLum > 0.5 ? { r: 0, g: 0, b: 0, a: 1 } : { r: 255, g: 255, b: 255, a: 1 }
}

// ======================== CSS 渐变构建与 PNG 导出 ========================

export type GradientType = 'linear' | 'radial' | 'conic'
export type GradientInterpolation = 'srgb' | 'oklch'

export interface GradientStop {
  id: string
  color: string
  pos: number // 0 - 100
}

export interface GradientConfig {
  type: GradientType
  angle: number // 0 - 360
  interpolation: GradientInterpolation
  stops: GradientStop[]
}

export const GRADIENT_PRESETS: { name: string; config: Omit<GradientConfig, 'stops'> & { stops: [string, number][] } }[] = [
  {
    name: '极光蓝紫',
    config: { type: 'linear', angle: 135, interpolation: 'oklch', stops: [['#4f46e5', 0], ['#06b6d4', 100]] },
  },
  {
    name: '日落晚霞',
    config: { type: 'linear', angle: 120, interpolation: 'oklch', stops: [['#f97316', 0], ['#ec4899', 55], ['#8b5cf6', 100]] },
  },
  {
    name: '翡翠森氧',
    config: { type: 'linear', angle: 135, interpolation: 'oklch', stops: [['#059669', 0], ['#14b8a6', 50], ['#84cc16', 100]] },
  },
  {
    name: '深海暗夜',
    config: { type: 'linear', angle: 160, interpolation: 'srgb', stops: [['#0f172a', 0], ['#1e1b4b', 55], ['#312e81', 100]] },
  },
  {
    name: '蜜桃晨雾',
    config: { type: 'radial', angle: 135, interpolation: 'oklch', stops: [['#fef3c7', 0], ['#fbcfe8', 50], ['#c7d2fe', 100]] },
  },
  {
    name: '全息光环',
    config: { type: 'conic', angle: 45, interpolation: 'oklch', stops: [['#6366f1', 0], ['#ec4899', 33], ['#06b6d4', 66], ['#6366f1', 100]] },
  },
]

export function buildGradientCss(cfg: GradientConfig): string {
  const sorted = [...cfg.stops].sort((a, b) => a.pos - b.pos)
  const stopList = sorted.map((s) => `${s.color} ${s.pos}%`).join(', ')
  const space = cfg.interpolation === 'oklch' ? ' in oklch' : ''

  if (cfg.type === 'radial') {
    return `radial-gradient(circle at center${space}, ${stopList})`
  }
  if (cfg.type === 'conic') {
    return `conic-gradient(from ${cfg.angle}deg${space}, ${stopList})`
  }
  return `linear-gradient(${cfg.angle}deg${space}, ${stopList})`
}
