import { zip } from 'fflate'
import { encodeIco, type IcoFrame } from '@/tools/image-convert/encoders'
import { ICON_GRADIENTS, ICO_FRAME_SIZES, PNG_SPECS, type FaviconOptions } from './types'

/** 将图标按当前样式绘制到正方形 Canvas 上 */
export function drawFaviconCanvas(
  canvas: HTMLCanvasElement,
  size: number,
  opts: FaviconOptions,
  bitmap: ImageBitmap | null,
) {
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, size, size)

  const radius = (size * Math.max(0, Math.min(50, opts.radiusPct))) / 100

  ctx.save()
  // 外框圆角裁切
  ctx.beginPath()
  ctx.roundRect(0, 0, size, size, radius)
  ctx.clip()

  // 1. 背景层
  if (opts.bgStyle === 'gradient') {
    const g = ICON_GRADIENTS.find((item) => item.id === opts.gradientId) ?? ICON_GRADIENTS[0]
    const grad = ctx.createLinearGradient(0, 0, size, size)
    grad.addColorStop(0, g.from)
    grad.addColorStop(1, g.to)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
  } else if (opts.bgStyle === 'solid' && opts.bgColor !== 'transparent') {
    ctx.fillStyle = opts.bgColor
    ctx.fillRect(0, 0, size, size)
  }

  // 2. 前景内容（图片 或 文字/Emoji）
  const pad = (size * Math.max(0, Math.min(35, opts.paddingPct))) / 100
  const inner = Math.max(1, size - pad * 2)

  if (opts.sourceMode === 'image' && bitmap) {
    const scale =
      opts.imageFit === 'cover'
        ? Math.max(inner / bitmap.width, inner / bitmap.height)
        : Math.min(inner / bitmap.width, inner / bitmap.height)
    const dw = bitmap.width * scale
    const dh = bitmap.height * scale
    ctx.drawImage(bitmap, pad + (inner - dw) / 2, pad + (inner - dh) / 2, dw, dh)
  } else {
    const txt = (opts.text || 'A').trim().slice(0, 4)
    const fontSize = Math.max(8, (inner * opts.textScalePct) / 100)
    ctx.fillStyle = opts.textColor
    ctx.font = `700 ${fontSize}px "PingFang SC", "Hiragino Sans GB", Inter, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // 略微下移 3% 修正中文与 Emoji 视觉基线居中
    ctx.fillText(txt, size / 2, size / 2 + fontSize * 0.04, inner * 0.96)
  }

  ctx.restore()
}

/** 渲染单个指定尺寸 PNG Blob */
export async function renderFaviconPng(
  size: number,
  opts: FaviconOptions,
  bitmap: ImageBitmap | null,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  drawFaviconCanvas(canvas, size, opts, bitmap)
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`生成 ${size}px 图标失败`))), 'image/png'),
  )
  canvas.width = 0
  canvas.height = 0
  return blob
}

/** 生成包含 16×16、32×32、48×48 多帧的标准 favicon.ico */
export async function renderFaviconIco(opts: FaviconOptions, bitmap: ImageBitmap | null): Promise<Blob> {
  const frames: IcoFrame[] = []
  for (const size of ICO_FRAME_SIZES) {
    const pngBlob = await renderFaviconPng(size, opts, bitmap)
    const buf = await pngBlob.arrayBuffer()
    frames.push({ size, pngBytes: new Uint8Array(buf) })
  }
  return encodeIco(frames)
}

/** 规范化路径前缀，确保以 / 结尾 */
function normalizePrefix(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return '/'
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

/** 生成标准 site.webmanifest JSON 文本 */
export function buildManifestJson(opts: FaviconOptions): string {
  const prefix = normalizePrefix(opts.pathPrefix)
  const obj = {
    name: opts.siteName.trim() || 'My App',
    short_name: opts.shortName.trim() || opts.siteName.trim() || 'App',
    icons: [
      {
        src: `${prefix}android-chrome-192x192.png`,
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: `${prefix}android-chrome-512x512.png`,
        sizes: '512x512',
        type: 'image/png',
      },
    ],
    theme_color: opts.themeColor,
    background_color: opts.themeColor,
    display: 'standalone',
  }
  return JSON.stringify(obj, null, 2)
}

/** 生成直接粘贴到 <head> 的 HTML 引入片段 */
export function buildHtmlSnippet(opts: FaviconOptions): string {
  const prefix = normalizePrefix(opts.pathPrefix)
  return [
    `<link rel="icon" href="${prefix}favicon.ico" sizes="any" />`,
    `<link rel="icon" type="image/png" sizes="32x32" href="${prefix}favicon-32x32.png" />`,
    `<link rel="icon" type="image/png" sizes="16x16" href="${prefix}favicon-16x16.png" />`,
    `<link rel="apple-touch-icon" sizes="180x180" href="${prefix}apple-touch-icon.png" />`,
    `<link rel="manifest" href="${prefix}site.webmanifest" />`,
    `<meta name="theme-color" content="${opts.themeColor}" />`,
  ].join('\n')
}

/** 打包全套 Favicon 文件（favicon.ico + 5 张多尺寸 PNG + site.webmanifest + README 使用代码） */
export async function exportFaviconPackageZip(
  opts: FaviconOptions,
  bitmap: ImageBitmap | null,
): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {}
  const enc = new TextEncoder()

  // 1. 多尺寸 favicon.ico
  const icoBlob = await renderFaviconIco(opts, bitmap)
  entries['favicon.ico'] = new Uint8Array(await icoBlob.arrayBuffer())

  // 2. 5 张全平台 PNG
  for (const spec of PNG_SPECS) {
    const pngBlob = await renderFaviconPng(spec.size, opts, bitmap)
    entries[spec.filename] = new Uint8Array(await pngBlob.arrayBuffer())
  }

  // 3. site.webmanifest & HTML 说明
  entries['site.webmanifest'] = enc.encode(buildManifestJson(opts))
  entries['head-snippet.html'] = enc.encode(buildHtmlSnippet(opts))

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data)))
  })
  const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
  return new Blob([buf], { type: 'application/zip' })
}
