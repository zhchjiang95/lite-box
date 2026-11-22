import { zip } from 'fflate'

export type ExportFormat = 'png' | 'webp' | 'jpeg'
export type SizeMode = 'scale' | 'custom'

export interface SvgExportOptions {
  sizeMode: SizeMode
  /** 倍率（1 / 2 / 3 / 4 / 8） */
  scale: number
  /** 自定义目标像素宽高 */
  customWidth: number
  customHeight: number
  /** 四周留白像素（按最终画布计算） */
  padding: number
  /** 背景色，transparent 表示透明 */
  background: string
  /** 替换 SVG 中的 currentColor（对单色图标极为实用） */
  currentColor: string
  /** 导出格式 */
  format: ExportFormat
  /** JPG / WebP 质量（10 - 100） */
  quality: number
}

export const defaultSvgOptions: SvgExportOptions = {
  sizeMode: 'scale',
  scale: 2,
  customWidth: 512,
  customHeight: 512,
  padding: 0,
  background: 'transparent',
  currentColor: '#6366f1',
  format: 'png',
  quality: 92,
}

export const FORMAT_MIME: Record<ExportFormat, string> = {
  png: 'image/png',
  webp: 'image/webp',
  jpeg: 'image/jpeg',
}

export const FORMAT_EXT: Record<ExportFormat, string> = {
  png: 'png',
  webp: 'webp',
  jpeg: 'jpg',
}

export interface ParsedSvgInfo {
  ok: true
  width: number
  height: number
  /** 是否包含 currentColor 关键字 */
  usesCurrentColor: boolean
  /** 规范化后的可执行 SVG 字符串（已补全 xmlns 等属性） */
  normalized: string
}

export interface ParsedSvgError {
  ok: false
  error: string
}

/** 解析数值长度属性（忽略百分比，识别 px/无单位） */
function parseLengthAttr(raw: string | null): number | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed.endsWith('%')) return null
  const num = parseFloat(trimmed)
  return Number.isFinite(num) && num > 0 ? num : null
}

/**
 * 解析并规范化 SVG 代码：
 * - 自动校验 XML 合法性
 * - 自动补齐缺失的 xmlns，避免浏览器 <img> 渲染空白
 * - 精准提取原生尺寸（width/height 优先，其次 viewBox，最后兜底 512×512）
 */
export function parseSvgCode(rawCode: string): ParsedSvgInfo | ParsedSvgError {
  const code = rawCode.trim()
  if (!code) return { ok: false, error: '请输入或上传 SVG 代码' }

  const parser = new DOMParser()
  const doc = parser.parseFromString(code, 'image/svg+xml')
  const parseErr = doc.querySelector('parsererror')
  const svg = doc.documentElement

  if (parseErr || !svg || svg.tagName.toLowerCase() !== 'svg') {
    return { ok: false, error: 'SVG 语法有误，请检查标签是否闭合完整' }
  }

  // 补齐命名空间（独立 Blob 渲染必需）
  if (!svg.getAttribute('xmlns')) {
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  }

  // 解析 viewBox
  let vbW: number | null = null
  let vbH: number | null = null
  const viewBox = svg.getAttribute('viewBox')
  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number)
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      vbW = parts[2]
      vbH = parts[3]
    }
  }

  const attrW = parseLengthAttr(svg.getAttribute('width'))
  const attrH = parseLengthAttr(svg.getAttribute('height'))

  let width = attrW ?? vbW ?? 512
  let height = attrH ?? vbH ?? 512

  // 仅写了宽或仅写了高时按 viewBox 等比补全另一边
  if (attrW && !attrH && vbW && vbH) height = Math.round((attrW * vbH) / vbW)
  if (attrH && !attrW && vbW && vbH) width = Math.round((attrH * vbW) / vbH)

  // 若缺失 viewBox，按解析出的宽高补上，保证高倍缩放时矢量自适应不裁剪
  if (!viewBox) {
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  }

  const serializer = new XMLSerializer()
  const normalized = serializer.serializeToString(svg)
  const usesCurrentColor = /currentColor/i.test(normalized)

  return {
    ok: true,
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    usesCurrentColor,
    normalized,
  }
}

/** 计算最终输出画布尺寸（含四周 padding） */
export function computeSvgOutputSize(srcW: number, srcH: number, opts: SvgExportOptions) {
  let contentW = srcW
  let contentH = srcH
  if (opts.sizeMode === 'scale') {
    contentW = Math.max(1, Math.round(srcW * opts.scale))
    contentH = Math.max(1, Math.round(srcH * opts.scale))
  } else {
    contentW = Math.max(1, Math.min(8192, Math.round(opts.customWidth || srcW)))
    contentH = Math.max(1, Math.min(8192, Math.round(opts.customHeight || srcH)))
  }
  const pad = Math.max(0, Math.round(opts.padding))
  return {
    contentW,
    contentH,
    totalW: contentW + pad * 2,
    totalH: contentH + pad * 2,
    pad,
  }
}

/**
 * 将 SVG 按目标像素尺寸无锯齿光栅化渲染为位图 Blob
 * 核心技巧：在生成 SVG Blob 前直接把目标 contentW/contentH 写入根 <svg> 的 width/height，
 * 让浏览器矢量引擎以完整目标分辨率栅格化，4×/8× 导出也绝对锐利。
 */
export async function renderSvgToBlob(
  parsed: ParsedSvgInfo,
  opts: SvgExportOptions,
  forcePng = false,
): Promise<{ blob: Blob; width: number; height: number }> {
  const { contentW, contentH, totalW, totalH, pad } = computeSvgOutputSize(parsed.width, parsed.height, opts)

  // 将目标渲染宽高与 currentColor 注入 SVG 文档
  const parser = new DOMParser()
  const doc = parser.parseFromString(parsed.normalized, 'image/svg+xml')
  const svg = doc.documentElement
  svg.setAttribute('width', String(contentW))
  svg.setAttribute('height', String(contentH))
  let finalSvg = new XMLSerializer().serializeToString(svg)
  if (parsed.usesCurrentColor) {
    finalSvg = finalSvg.replace(/currentColor/gi, opts.currentColor)
  }

  const svgBlob = new Blob([finalSvg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('SVG 渲染失败，可能引用了受跨域限制的外部资源'))
      el.src = url
    })

    const canvas = document.createElement('canvas')
    canvas.width = totalW
    canvas.height = totalH
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    const fmt: ExportFormat = forcePng ? 'png' : opts.format
    const needBg = fmt === 'jpeg' || opts.background !== 'transparent'
    if (needBg) {
      ctx.fillStyle = opts.background === 'transparent' ? '#ffffff' : opts.background
      ctx.fillRect(0, 0, totalW, totalH)
    }

    ctx.drawImage(img, pad, pad, contentW, contentH)

    const mime = FORMAT_MIME[fmt]
    const q = fmt === 'png' ? undefined : Math.max(0.1, Math.min(1, opts.quality / 100))
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('位图导出失败，尺寸可能过大'))), mime, q),
    )
    canvas.width = 0
    canvas.height = 0
    return { blob, width: totalW, height: totalH }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 将 Blob 转为 Base64 DataURL */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('生成 DataURL 失败'))
    reader.readAsDataURL(blob)
  })
}

/** 批量转换多个 SVG 文件并打包 ZIP */
export async function exportSvgBatchZip(
  items: { name: string; code: string }[],
  opts: SvgExportOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {}
  const used = new Map<string, number>()

  for (let i = 0; i < items.length; i++) {
    const parsed = parseSvgCode(items[i].code)
    if (!parsed.ok) continue
    const { blob } = await renderSvgToBlob(parsed, opts)
    const base = items[i].name.replace(/\.svg$/i, '') || `svg-${i + 1}`
    const rawName = `${base}.${FORMAT_EXT[opts.format]}`
    const count = used.get(rawName) ?? 0
    const finalName = count > 0 ? `${base}-${count + 1}.${FORMAT_EXT[opts.format]}` : rawName
    used.set(rawName, count + 1)
    entries[finalName] = new Uint8Array(await blob.arrayBuffer())
    onProgress?.(i + 1, items.length)
  }

  if (!Object.keys(entries).length) throw new Error('没有可导出的有效 SVG')

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data)))
  })
  const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
  return new Blob([buf], { type: 'application/zip' })
}

/** 内置示例 SVG（轻匣品牌风格矢量徽标） */
export const DEMO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#8b5cf6"/>
      <stop offset="55%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#06b6d4"/>
    </linearGradient>
    <linearGradient id="shine" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="56" fill="url(#bg)"/>
  <rect width="256" height="128" rx="56" fill="url(#shine)"/>
  <path d="M64 102 L128 70 L192 102 L192 158 L128 190 L64 158 Z" fill="none" stroke="#ffffff" stroke-width="12" stroke-linejoin="round"/>
  <path d="M64 102 L128 134 L192 102 M128 134 L128 190" fill="none" stroke="#ffffff" stroke-width="12" stroke-linejoin="round" opacity="0.9"/>
</svg>`
