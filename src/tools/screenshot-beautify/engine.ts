import {
  ASPECT_OPTIONS,
  FORMAT_MIME,
  GRADIENT_PRESETS,
  type BeautifyOptions,
  type ExportFormat,
} from './types'

/** 缓存一张轻量可平铺噪点图案，避免每帧重复计算像素随机数 */
let noisePatternCanvas: HTMLCanvasElement | null = null
function getNoiseCanvas() {
  if (noisePatternCanvas) return noisePatternCanvas
  const c = document.createElement('canvas')
  c.width = 160
  c.height = 160
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(160, 160)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.random() * 255
    d[i] = v
    d[i + 1] = v
    d[i + 2] = v
    d[i + 3] = 16 // 非常克制的细腻磨砂感
  }
  ctx.putImageData(img, 0, 0)
  noisePatternCanvas = c
  return c
}

/** 根据原图尺寸与当前配置计算逻辑输出总画布尺寸 */
export function computeBeautifyDimensions(srcW: number, srcH: number, opts: BeautifyOptions) {
  // 参考短边缩放因子，使 600px 小截图与 2800px Retina 截图拥有一致的视觉比例
  const uiScale = Math.max(0.65, Math.min(2.6, Math.max(srcW, srcH) / 1100))
  const hasBar =
    opts.frame === 'mac-light' ||
    opts.frame === 'mac-dark' ||
    opts.frame === 'browser-light' ||
    opts.frame === 'browser-dark'
  const barH = hasBar ? Math.round((opts.frame.startsWith('browser') ? 44 : 38) * uiScale) : 0
  const glassPad = opts.frame === 'glass' ? Math.round(14 * uiScale) : 0
  const insetPx = Math.round(opts.inset * uiScale)

  // 整个套壳卡片的外框宽高
  const cardW = srcW + insetPx * 2 + glassPad * 2
  const cardH = srcH + insetPx * 2 + barH + glassPad * 2

  const pad = Math.round((Math.max(cardW, cardH) * opts.paddingPct) / 100)
  let outW = cardW + pad * 2
  let outH = cardH + pad * 2

  const aspectInfo = ASPECT_OPTIONS.find((a) => a.id === opts.aspect)
  if (aspectInfo?.ratio) {
    const target = aspectInfo.ratio
    const cur = outW / outH
    if (cur < target) {
      outW = Math.round(outH * target)
    } else {
      outH = Math.round(outW / target)
    }
  }

  return {
    outW: Math.max(1, outW),
    outH: Math.max(1, outH),
    cardW,
    cardH,
    barH,
    glassPad,
    insetPx,
    uiScale,
  }
}

/** 绘制线性角度渐变背景 */
function fillGradientBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  colors: string[],
  angleDeg: number,
) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  const diag = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad))
  const cx = w / 2
  const cy = h / 2
  const dx = (Math.cos(rad) * diag) / 2
  const dy = (Math.sin(rad) * diag) / 2
  const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy)
  colors.forEach((c, idx) => {
    grad.addColorStop(colors.length === 1 ? 0 : idx / (colors.length - 1), c)
  })
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)
}

/** 采样原图四周边角平均色（用于一键内衬配色） */
export function sampleEdgeColor(bitmap: ImageBitmap): string {
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 16
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0, 16, 16)
  const { data } = ctx.getImageData(0, 0, 16, 16)
  c.width = 0
  c.height = 0
  // 采样左上像素作为背景近似
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${toHex(data[0])}${toHex(data[1])}${toHex(data[2])}`
}

/** 核心渲染函数：将截图、背景、窗口套壳与多层阴影绘制到目标 Canvas */
export function renderBeautifyCanvas(
  canvas: HTMLCanvasElement,
  bitmap: ImageBitmap,
  opts: BeautifyOptions,
  scale = 1,
) {
  const dim = computeBeautifyDimensions(bitmap.width, bitmap.height, opts)
  const W = Math.max(1, Math.round(dim.outW * scale))
  const H = Math.max(1, Math.round(dim.outH * scale))
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W
    canvas.height = H
  }

  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, W, H)

  ctx.save()
  ctx.scale(scale, scale)

  // 1. 背景层
  if (opts.bgMode === 'gradient') {
    const preset = GRADIENT_PRESETS.find((g) => g.id === opts.gradientId) ?? GRADIENT_PRESETS[0]
    fillGradientBackground(ctx, dim.outW, dim.outH, preset.colors, opts.gradientAngle)
    // 叠加细腻磨砂颗粒噪点
    if (opts.noise) {
      const pattern = ctx.createPattern(getNoiseCanvas(), 'repeat')
      if (pattern) {
        ctx.save()
        ctx.globalCompositeOperation = 'overlay'
        ctx.fillStyle = pattern
        ctx.fillRect(0, 0, dim.outW, dim.outH)
        ctx.restore()
      }
    }
  } else if (opts.bgMode === 'solid') {
    ctx.fillStyle = opts.solidColor === 'transparent' ? '#ffffff' : opts.solidColor
    ctx.fillRect(0, 0, dim.outW, dim.outH)
  }

  // 2. 计算套壳卡片居中坐标
  const cardX = (dim.outW - dim.cardW) / 2
  const cardY = (dim.outH - dim.cardH) / 2
  const radius = Math.min(Math.round(opts.radius * dim.uiScale), dim.cardW / 2, dim.cardH / 2)

  // 3. 多层柔和阴影（3 层叠加：远景环境弥散 + 中景主落影 + 近景接触轮廓）
  if (opts.shadow > 0) {
    const k = opts.shadow / 100
    const layers = [
      { blur: 78 * dim.uiScale * k, y: 34 * dim.uiScale * k, alpha: 0.34 * k },
      { blur: 28 * dim.uiScale * k, y: 12 * dim.uiScale * k, alpha: 0.24 * k },
      { blur: 8 * dim.uiScale * k, y: 3 * dim.uiScale * k, alpha: 0.16 * k },
    ]
    for (const l of layers) {
      ctx.save()
      ctx.shadowColor = `rgba(0, 0, 0, ${l.alpha.toFixed(3)})`
      ctx.shadowBlur = l.blur
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = l.y
      ctx.fillStyle = opts.frame === 'glass' ? 'rgba(255, 255, 255, 0.24)' : 'rgba(15, 23, 42, 0.92)'
      ctx.beginPath()
      ctx.roundRect(cardX, cardY, dim.cardW, dim.cardH, radius)
      ctx.fill()
      ctx.restore()
    }
  }

  // 4. 玻璃外框模式（Glass Frame）
  if (opts.frame === 'glass') {
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(cardX, cardY, dim.cardW, dim.cardH, radius)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.24)'
    ctx.fill()
    ctx.lineWidth = Math.max(1.5, 1.5 * dim.uiScale)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.stroke()
    ctx.restore()

    const innerX = cardX + dim.glassPad
    const innerY = cardY + dim.glassPad
    const innerW = dim.cardW - dim.glassPad * 2
    const innerH = dim.cardH - dim.glassPad * 2
    const innerR = Math.max(0, radius - dim.glassPad * 0.65)

    ctx.save()
    ctx.beginPath()
    ctx.roundRect(innerX, innerY, innerW, innerH, innerR)
    ctx.clip()
    if (dim.insetPx > 0) {
      ctx.fillStyle = opts.insetColor
      ctx.fillRect(innerX, innerY, innerW, innerH)
    }
    ctx.drawImage(bitmap, innerX + dim.insetPx, innerY + dim.insetPx, bitmap.width, bitmap.height)
    ctx.restore()

    ctx.restore()
    return
  }

  // 5. 主卡片圆角裁切容器（无边框 / macOS 窗口 / 浏览器窗口）
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(cardX, cardY, dim.cardW, dim.cardH, radius)
  ctx.clip()

  const isDark = opts.frame === 'mac-dark' || opts.frame === 'browser-dark'
  const isBrowser = opts.frame === 'browser-light' || opts.frame === 'browser-dark'

  // 绘制顶部窗口标题栏 / 浏览器地址栏
  if (dim.barH > 0) {
    ctx.fillStyle = isDark ? '#1e1f26' : '#f4f4f6'
    ctx.fillRect(cardX, cardY, dim.cardW, dim.barH)

    // macOS 红黄绿三色交通灯
    const dotR = Math.max(4, 6 * dim.uiScale)
    const dotY = cardY + dim.barH / 2
    const startX = cardX + 18 * dim.uiScale
    const dotGap = 20 * dim.uiScale
    const dots = ['#ff5f57', '#febc2e', '#28c840']
    dots.forEach((col, i) => {
      ctx.beginPath()
      ctx.arc(startX + i * dotGap, dotY, dotR, 0, Math.PI * 2)
      ctx.fillStyle = col
      ctx.fill()
    })

    // 标题或浏览器居中网址胶囊
    const title = opts.windowTitle.trim()
    if (isBrowser) {
      const pillW = Math.min(dim.cardW * 0.46, Math.max(180 * dim.uiScale, 280 * dim.uiScale))
      const pillH = Math.round(26 * dim.uiScale)
      const pillX = cardX + (dim.cardW - pillW) / 2
      const pillY = cardY + (dim.barH - pillH) / 2
      ctx.beginPath()
      ctx.roundRect(pillX, pillY, pillW, pillH, pillH / 2)
      ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'
      ctx.fill()

      if (title) {
        ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.72)' : 'rgba(15, 23, 42, 0.65)'
        ctx.font = `500 ${Math.round(12 * dim.uiScale)}px Inter, "PingFang SC", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(title, cardX + dim.cardW / 2, dotY, pillW - 24 * dim.uiScale)
      }
    } else if (title) {
      ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.68)' : 'rgba(15, 23, 42, 0.65)'
      ctx.font = `500 ${Math.round(13 * dim.uiScale)}px Inter, "PingFang SC", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(title, cardX + dim.cardW / 2, dotY, dim.cardW * 0.55)
    }

    // 标题栏底部分割线
    ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)'
    ctx.fillRect(cardX, cardY + dim.barH - 1, dim.cardW, 1)
  }

  // 绘制内衬留白与原始截图
  const contentY = cardY + dim.barH
  const contentH = dim.cardH - dim.barH
  if (dim.insetPx > 0) {
    ctx.fillStyle = opts.insetColor
    ctx.fillRect(cardX, contentY, dim.cardW, contentH)
  }
  ctx.drawImage(bitmap, cardX + dim.insetPx, contentY + dim.insetPx, bitmap.width, bitmap.height)
  ctx.restore()

  // 6. 极细外轮廓高光描边，提升深浅背景下的边缘质感
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(cardX + 0.5, cardY + 0.5, dim.cardW - 1, dim.cardH - 1, radius)
  ctx.lineWidth = Math.max(1, dim.uiScale)
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.45)'
  ctx.stroke()
  ctx.restore()

  ctx.restore()
}

/** 导出高清成品 Blob */
export async function exportBeautifyBlob(
  bitmap: ImageBitmap,
  opts: BeautifyOptions,
  forcePng = false,
): Promise<{ blob: Blob; width: number; height: number }> {
  const dim = computeBeautifyDimensions(bitmap.width, bitmap.height, opts)
  // 限制最大导出边长在浏览器安全范围内（10000px）
  const maxScale = Math.min(opts.exportScale, 10000 / Math.max(dim.outW, dim.outH))
  const canvas = document.createElement('canvas')
  renderBeautifyCanvas(canvas, bitmap, opts, maxScale)

  const fmt: ExportFormat = forcePng ? 'png' : opts.format
  const mime = FORMAT_MIME[fmt]
  const q = fmt === 'png' ? undefined : Math.max(0.1, Math.min(1, opts.quality / 100))
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片导出失败'))), mime, q),
  )
  const result = { blob, width: canvas.width, height: canvas.height }
  canvas.width = 0
  canvas.height = 0
  return result
}

/** 生成一张精致的代码卡片示例截图（方便空状态下零门槛直接体验美化效果） */
export async function createDemoScreenshot(): Promise<{ bitmap: ImageBitmap; name: string }> {
  const c = document.createElement('canvas')
  c.width = 1080
  c.height = 640
  const ctx = c.getContext('2d')!

  ctx.fillStyle = '#11131a'
  ctx.fillRect(0, 0, c.width, c.height)

  // 顶部淡紫色柔和环境光
  const glow = ctx.createRadialGradient(240, 80, 10, 240, 80, 480)
  glow.addColorStop(0, 'rgba(139, 92, 246, 0.22)')
  glow.addColorStop(1, 'transparent')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, c.width, c.height)

  const lines: [string, string][] = [
    ['// 轻匣 LiteBox · 100% 浏览器本地处理', '#6b7280'],
    ['export async function beautify(screenshot: File) {', '#c084fc'],
    ['  const bitmap = await decodeImageFile(screenshot)', '#93c5fd'],
    ['  const canvas = renderGlassFrame(bitmap, {', '#e5e7eb'],
    ['    background: "aurora-gradient",', '#34d399'],
    ['    window: "macOS-dark",', '#34d399'],
    ['    shadow: "triple-soft-layer",', '#34d399'],
    ['    privacy: "local-only", // 文件绝不离开设备', '#fbbf24'],
    ['  })', '#e5e7eb'],
    ['  return canvas.toBlob("image/png")', '#93c5fd'],
    ['}', '#c084fc'],
  ]

  ctx.font = '500 24px "JetBrains Mono", ui-monospace, Menlo, monospace'
  ctx.textBaseline = 'top'
  lines.forEach(([text, color], i) => {
    const y = 92 + i * 44
    ctx.fillStyle = '#3f3f46'
    ctx.fillText(String(i + 1).padStart(2, ' '), 52, y)
    ctx.fillStyle = color
    ctx.fillText(text, 118, y)
  })

  const bitmap = await createImageBitmap(c)
  c.width = 0
  c.height = 0
  return { bitmap, name: 'demo-code.png' }
}
