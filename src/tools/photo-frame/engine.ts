import {
  ART_FONTS,
  FORMAT_MIME,
  type BrandBadgeId,
  type ExportFormat,
  type PhotoExifFields,
  type PhotoFrameOptions,
} from './types'

/** 根据相机厂商/型号文本自动推断品牌徽标 */
export function detectBrand(make: string, camera: string): Exclude<BrandBadgeId, 'auto'> {
  const s = `${make} ${camera}`.toLowerCase()
  if (s.includes('leica')) return 'leica'
  if (s.includes('hasselblad')) return 'hasselblad'
  if (s.includes('fuji')) return 'fujifilm'
  if (s.includes('sony') || s.includes('ilce')) return 'sony'
  if (s.includes('canon') || s.includes('eos')) return 'canon'
  if (s.includes('nikon')) return 'nikon'
  if (s.includes('apple') || s.includes('iphone')) return 'apple'
  if (s.includes('ricoh') || /\bgr\s?(iii|ii|3)/i.test(s)) return 'ricoh'
  return 'film35'
}

/** 绘制矢量品牌徽标（居中于 (cx, cy)，高度约 h），放大不锯齿 */
function drawBrandBadge(
  ctx: CanvasRenderingContext2D,
  brand: Exclude<BrandBadgeId, 'auto' | 'none'>,
  cx: number,
  cy: number,
  h: number,
  isDarkBg: boolean,
) {
  ctx.save()
  ctx.translate(cx, cy)
  const fg = isDarkBg ? '#f4f4f5' : '#18181b'

  switch (brand) {
    case 'leica': {
      // 经典徕卡小红点
      const r = h * 0.56
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.fillStyle = '#e11d2a'
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.font = `italic 700 ${Math.round(r * 0.85)}px "Playfair Display", Georgia, serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('Leica', 0, r * 0.04, r * 1.75)
      break
    }
    case 'hasselblad': {
      // 哈苏方徽 H
      const s = h * 0.92
      ctx.fillStyle = '#f97316'
      ctx.beginPath()
      ctx.roundRect(-s / 2, -s / 2, s, s, s * 0.18)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.font = `800 ${Math.round(s * 0.65)}px Inter, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('H', 0, s * 0.03)
      break
    }
    case 'fujifilm': {
      ctx.fillStyle = fg
      ctx.font = `800 ${Math.round(h * 0.52)}px "Cinzel", Inter, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('FUJI', 0, -h * 0.1)
      ctx.fillStyle = '#10b981'
      ctx.fillRect(-h * 0.55, h * 0.22, h * 1.1, Math.max(2, h * 0.1))
      break
    }
    case 'canon': {
      ctx.fillStyle = '#dc2626'
      ctx.font = `800 ${Math.round(h * 0.62)}px Georgia, serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('Canon', 0, 0)
      break
    }
    case 'nikon': {
      const s = h * 0.95
      ctx.fillStyle = '#facc15'
      ctx.beginPath()
      ctx.roundRect(-s / 2, -s / 2, s, s, s * 0.16)
      ctx.fill()
      ctx.fillStyle = '#111827'
      ctx.font = `italic 800 ${Math.round(s * 0.34)}px Inter, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('Nikon', 0, s * 0.03)
      break
    }
    case 'sony': {
      ctx.fillStyle = fg
      ctx.font = `700 ${Math.round(h * 0.56)}px "Cinzel", Georgia, serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('SONY', 0, 0)
      break
    }
    case 'apple': {
      // 极简镜头光圈环图标
      const r = h * 0.48
      ctx.strokeStyle = fg
      ctx.lineWidth = Math.max(2, h * 0.11)
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2)
      ctx.fillStyle = fg
      ctx.fill()
      break
    }
    case 'ricoh': {
      const s = h * 0.92
      ctx.strokeStyle = fg
      ctx.lineWidth = Math.max(2, h * 0.09)
      ctx.beginPath()
      ctx.roundRect(-s * 0.62, -s * 0.42, s * 1.24, s * 0.84, s * 0.14)
      ctx.stroke()
      ctx.fillStyle = fg
      ctx.font = `800 ${Math.round(s * 0.48)}px Inter, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('GR', 0, s * 0.03)
      break
    }
    case 'film35': {
      const w = h * 1.35
      const bh = h * 0.78
      ctx.strokeStyle = fg
      ctx.lineWidth = Math.max(1.5, h * 0.08)
      ctx.beginPath()
      ctx.roundRect(-w / 2, -bh / 2, w, bh, bh * 0.22)
      ctx.stroke()
      ctx.fillStyle = fg
      ctx.font = `700 ${Math.round(bh * 0.52)}px "Space Mono", monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('35MM', 0, bh * 0.03)
      break
    }
  }
  ctx.restore()
}

/** 计算输出画布总尺寸与照片、信息栏的精确矩形区域 */
export function computeFrameLayout(srcW: number, srcH: number, opts: PhotoFrameOptions) {
  const shortSide = Math.min(srcW, srcH)
  const isHorizontalBar = opts.position === 'bottom' || opts.position === 'top'

  // 无框悬浮模式：总尺寸与原图完全一致
  if (opts.theme === 'overlay') {
    const barThick = Math.max(84, Math.round(shortSide * (opts.barSizePct / 100)))
    return {
      outW: srcW,
      outH: srcH,
      photoX: 0,
      photoY: 0,
      photoW: srcW,
      photoH: srcH,
      barRect: {
        x: opts.position === 'right' ? srcW - barThick : 0,
        y: opts.position === 'bottom' ? srcH - barThick : 0,
        w: isHorizontalBar ? srcW : barThick,
        h: isHorizontalBar ? barThick : srcH,
      },
      uiUnit: shortSide / 1000,
    }
  }

  // 根据不同画框主题微调默认留白比例
  const baseBorderPct =
    opts.theme === 'polaroid'
      ? Math.max(opts.borderPct, 5.5)
      : opts.theme === 'blur-glass'
        ? Math.max(opts.borderPct, 7)
        : opts.theme === 'film-strip'
          ? Math.max(opts.borderPct, 5)
          : opts.borderPct

  const border = Math.round((shortSide * baseBorderPct) / 100)
  const barThick = Math.max(
    90,
    Math.round(shortSide * ((opts.theme === 'polaroid' ? Math.max(opts.barSizePct, 17) : opts.barSizePct) / 100)),
  )

  let padL = border
  let padR = border
  let padT = border
  let padB = border

  if (opts.position === 'bottom') padB = barThick
  else if (opts.position === 'top') padT = barThick
  else if (opts.position === 'left') padL = barThick
  else if (opts.position === 'right') padR = barThick

  const outW = srcW + padL + padR
  const outH = srcH + padT + padB

  const barRect =
    opts.position === 'bottom'
      ? { x: padL, y: padT + srcH, w: srcW, h: padB }
      : opts.position === 'top'
        ? { x: padL, y: 0, w: srcW, h: padT }
        : opts.position === 'left'
          ? { x: 0, y: padT, w: padL, h: srcH }
          : { x: padL + srcW, y: padT, w: padR, h: srcH }

  return {
    outW,
    outH,
    photoX: padL,
    photoY: padT,
    photoW: srcW,
    photoH: srcH,
    barRect,
    uiUnit: shortSide / 1000,
  }
}

/** 绘制 35mm 电影胶片齿孔装饰 */
function drawFilmSprockets(
  ctx: CanvasRenderingContext2D,
  outW: number,
  outH: number,
  isHorizontalBar: boolean,
  u: number,
) {
  ctx.save()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)'
  const holeW = Math.max(10, Math.round(22 * u))
  const holeH = Math.max(7, Math.round(14 * u))
  const step = Math.round(48 * u)
  const r = Math.max(2, Math.round(3 * u))

  if (isHorizontalBar) {
    // 顶部与底部的边缘胶片齿孔
    for (let x = Math.round(24 * u); x < outW - holeW; x += step) {
      ctx.beginPath()
      ctx.roundRect(x, Math.round(10 * u), holeW, holeH, r)
      ctx.fill()
      ctx.beginPath()
      ctx.roundRect(x, outH - Math.round(10 * u) - holeH, holeW, holeH, r)
      ctx.fill()
    }
  } else {
    // 左右边缘竖向齿孔
    for (let y = Math.round(24 * u); y < outH - holeW; y += step) {
      ctx.beginPath()
      ctx.roundRect(Math.round(10 * u), y, holeH, holeW, r)
      ctx.fill()
      ctx.beginPath()
      ctx.roundRect(outW - Math.round(10 * u) - holeH, y, holeH, holeW, r)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** 渲染核心：将照片、画框、品牌徽标、艺术字体参数与色点绘制到 Canvas */
export function renderPhotoFrame(
  canvas: HTMLCanvasElement,
  bitmap: ImageBitmap,
  exif: PhotoExifFields,
  opts: PhotoFrameOptions,
  paletteHexes: string[],
  scale = 1,
) {
  const layout = computeFrameLayout(bitmap.width, bitmap.height, opts)
  const W = Math.max(1, Math.round(layout.outW * scale))
  const H = Math.max(1, Math.round(layout.outH * scale))
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W
    canvas.height = H
  }

  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, W, H)

  const u = layout.uiUnit
  const isDarkTheme =
    opts.theme === 'gallery-dark' ||
    opts.theme === 'blur-glass' ||
    opts.theme === 'film-strip' ||
    opts.theme === 'overlay'
  const isHorizontalBar = opts.position === 'bottom' || opts.position === 'top'

  ctx.save()
  ctx.scale(scale, scale)

  // ==================== 1. 绘制画框底色 / 毛玻璃背景 ====================
  if (opts.theme === 'classic-light') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, layout.outW, layout.outH)
  } else if (opts.theme === 'polaroid') {
    // 复古暖白相纸色
    ctx.fillStyle = '#faf8f5'
    ctx.fillRect(0, 0, layout.outW, layout.outH)
  } else if (opts.theme === 'gallery-dark') {
    ctx.fillStyle = '#121318'
    ctx.fillRect(0, 0, layout.outW, layout.outH)
  } else if (opts.theme === 'film-strip') {
    ctx.fillStyle = '#0d0d0f'
    ctx.fillRect(0, 0, layout.outW, layout.outH)
    drawFilmSprockets(ctx, layout.outW, layout.outH, isHorizontalBar, u)
  } else if (opts.theme === 'blur-glass') {
    // 以照片本身做高斯模糊放大铺满背景，再叠加柔和暗色蒙层确保文字清晰
    ctx.save()
    const blurPx = Math.max(24, Math.round(52 * u))
    ctx.filter = `blur(${blurPx}px) saturate(1.35) brightness(0.72)`
    const coverScale = Math.max(layout.outW / bitmap.width, layout.outH / bitmap.height) * 1.18
    const bw = bitmap.width * coverScale
    const bh = bitmap.height * coverScale
    ctx.drawImage(bitmap, (layout.outW - bw) / 2, (layout.outH - bh) / 2, bw, bh)
    ctx.restore()
    ctx.fillStyle = 'rgba(10, 12, 18, 0.28)'
    ctx.fillRect(0, 0, layout.outW, layout.outH)
  }

  // ==================== 2. 绘制照片本体（阴影 + 圆角） ====================
  const photoR = opts.theme === 'overlay' ? 0 : Math.round(opts.photoRadius * u)
  if (opts.theme !== 'overlay' && opts.photoShadow > 0) {
    const k = opts.photoShadow / 100
    ctx.save()
    ctx.shadowColor = isDarkTheme
      ? `rgba(0, 0, 0, ${(0.55 * k).toFixed(2)})`
      : `rgba(15, 23, 42, ${(0.24 * k).toFixed(2)})`
    ctx.shadowBlur = Math.round(42 * u * k)
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = Math.round(14 * u * k)
    ctx.fillStyle = isDarkTheme ? '#000000' : '#ffffff'
    ctx.beginPath()
    ctx.roundRect(layout.photoX, layout.photoY, layout.photoW, layout.photoH, photoR)
    ctx.fill()
    ctx.restore()
  }

  ctx.save()
  ctx.beginPath()
  ctx.roundRect(layout.photoX, layout.photoY, layout.photoW, layout.photoH, photoR)
  ctx.clip()
  ctx.drawImage(bitmap, layout.photoX, layout.photoY, layout.photoW, layout.photoH)
  ctx.restore()

  // 无框悬浮模式：在目标方位绘制柔和暗色渐变，保证文字清晰可读
  if (opts.theme === 'overlay') {
    const b = layout.barRect
    let grad: CanvasGradient
    if (opts.position === 'bottom') {
      grad = ctx.createLinearGradient(0, b.y - b.h * 0.45, 0, b.y + b.h)
    } else if (opts.position === 'top') {
      grad = ctx.createLinearGradient(0, b.y + b.h * 1.45, 0, b.y)
    } else if (opts.position === 'left') {
      grad = ctx.createLinearGradient(b.x + b.w * 1.45, 0, b.x, 0)
    } else {
      grad = ctx.createLinearGradient(b.x - b.w * 0.45, 0, b.x + b.w, 0)
    }
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)')
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.72)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, layout.outW, layout.outH)
  }

  // ==================== 3. 准备文字与艺术字体 ====================
  const fontDef = ART_FONTS.find((f) => f.id === opts.font) ?? ART_FONTS[0]
  const fs = opts.fontScale
  const primaryColor = opts.theme === 'film-strip' ? '#fbbf24' : isDarkTheme ? '#f8fafc' : '#18181b'
  const secondaryColor =
    opts.theme === 'film-strip'
      ? 'rgba(251, 191, 36, 0.72)'
      : isDarkTheme
        ? 'rgba(248, 250, 252, 0.68)'
        : 'rgba(24, 24, 27, 0.56)'
  const dividerColor = isDarkTheme ? 'rgba(255, 255, 255, 0.22)' : 'rgba(24, 24, 27, 0.16)'

  const rawCamera = exif.camera.trim() || 'CAMERA'
  const displayCamera = fontDef.uppercase ? rawCamera.toUpperCase() : rawCamera
  const paramStr = [exif.focalLength, exif.aperture, exif.shutter, exif.iso]
    .map((s) => s.trim())
    .filter(Boolean)
    .join('  ')
  const subParts: string[] = []
  if (opts.showLens && exif.lens.trim()) subParts.push(exif.lens.trim())
  if (exif.caption.trim()) subParts.push(exif.caption.trim())
  const subLeft = subParts.join(' · ')
  const dateText = opts.showDate && exif.date.trim() ? exif.date.trim() : ''

  const resolvedBrand: Exclude<BrandBadgeId, 'auto'> =
    opts.brand === 'auto' ? detectBrand(exif.make, exif.camera) : opts.brand

  // ==================== 4. 绘制四方向参数信息栏 ====================
  const bar = layout.barRect

  // 将左/右竖向信息栏旋转坐标系复用同一套极简精排逻辑，保证四方向颜值完全一致！
  ctx.save()
  let spanW = bar.w
  let spanH = bar.h

  if (opts.position === 'left') {
    // 左侧信息栏：文字逆时针旋转 90°（从下往上读，经典杂志封面脊柱排版）
    ctx.translate(bar.x + bar.w / 2, bar.y + bar.h / 2)
    ctx.rotate(-Math.PI / 2)
    spanW = bar.h
    spanH = bar.w
  } else if (opts.position === 'right') {
    // 右侧信息栏：文字顺时针旋转 90°（从上往下读）
    ctx.translate(bar.x + bar.w / 2, bar.y + bar.h / 2)
    ctx.rotate(Math.PI / 2)
    spanW = bar.h
    spanH = bar.w
  } else {
    ctx.translate(bar.x + bar.w / 2, bar.y + bar.h / 2)
  }

  // 内侧水平安全留白
  const edgePad = Math.round(spanW * (opts.theme === 'overlay' ? 0.04 : 0.015))
  const leftX = -spanW / 2 + edgePad
  const rightX = spanW / 2 - edgePad

  const titleSize = Math.max(14, Math.round(Math.min(spanH * 0.27, 42 * u) * fs))
  const subSize = Math.max(10, Math.round(Math.min(spanH * 0.16, 23 * u) * fs))
  const paramSize = Math.max(12, Math.round(Math.min(spanH * 0.22, 32 * u) * fs))
  const italicPrefix = fontDef.italic ? 'italic ' : ''

  // 拍立得居中艺术风格（仅上下方位时居中，左右方位保持两端对齐更平衡）
  if (opts.theme === 'polaroid' && isHorizontalBar) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const hasCaption = Boolean(exif.caption.trim())
    const mainLine = hasCaption ? exif.caption.trim() : displayCamera
    const secondLine = [hasCaption ? displayCamera : '', paramStr, dateText].filter(Boolean).join('   ·   ')

    ctx.fillStyle = primaryColor
    ctx.font = `${italicPrefix}700 ${Math.round(titleSize * 1.18)}px ${fontDef.displayFamily}`
    ctx.fillText(mainLine, 0, -subSize * 0.65, spanW - edgePad * 2)

    ctx.fillStyle = secondaryColor
    ctx.font = `500 ${subSize}px ${fontDef.metaFamily}`
    ctx.fillText(secondLine, 0, titleSize * 0.72, spanW - edgePad * 2)

    if (opts.showPaletteDots && paletteHexes.length > 0) {
      const dotR = Math.max(3, Math.round(5.5 * u))
      const gap = dotR * 3.2
      const startX = -((paletteHexes.length - 1) * gap) / 2
      const dy = titleSize * 1.5
      if (dy + dotR < spanH / 2 - 4) {
        paletteHexes.forEach((hex, idx) => {
          ctx.beginPath()
          ctx.arc(startX + idx * gap, dy, dotR, 0, Math.PI * 2)
          ctx.fillStyle = hex
          ctx.fill()
        })
      }
    }
  } else {
    // 经典两端精排：左（品牌标 + 相机型号 + 镜头/签名）｜ 右（拍摄参数 + 日期 + 主色调色点）
    const lineGap = Math.round(titleSize * 0.68)
    const hasSub = Boolean(subLeft)
    const titleY = hasSub ? -lineGap * 0.48 : 0
    const subY = lineGap * 0.85

    // 左侧：品牌徽标（如有）
    let textStartX = leftX
    if (resolvedBrand !== 'none') {
      const badgeH = Math.round(Math.min(spanH * 0.42, 46 * u))
      const badgeCenterX = leftX + badgeH * 0.72
      drawBrandBadge(ctx, resolvedBrand, badgeCenterX, 0, badgeH, isDarkTheme)

      // 细竖分割线
      const divX = badgeCenterX + badgeH * 0.95
      ctx.strokeStyle = dividerColor
      ctx.lineWidth = Math.max(1.5, Math.round(2 * u))
      ctx.beginPath()
      ctx.moveTo(divX, -badgeH * 0.48)
      ctx.lineTo(divX, badgeH * 0.48)
      ctx.stroke()

      textStartX = divX + Math.round(badgeH * 0.42)
    }

    // 左侧文字：设备型号 + 镜头/作品名
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = primaryColor
    ctx.font = `${italicPrefix}700 ${titleSize}px ${fontDef.displayFamily}`
    const maxLeftW = spanW * 0.48
    ctx.fillText(displayCamera, textStartX, titleY, maxLeftW)

    if (hasSub) {
      ctx.fillStyle = secondaryColor
      ctx.font = `400 ${subSize}px ${fontDef.metaFamily}`
      ctx.fillText(subLeft, textStartX, subY, maxLeftW)
    }

    // 右侧文字：曝光参数 + 日期 + 迷你主色调色点
    ctx.textAlign = 'right'
    const hasRightBottom = Boolean(dateText) || (opts.showPaletteDots && paletteHexes.length > 0)
    const paramY = hasRightBottom ? -lineGap * 0.48 : 0
    const rightSubY = lineGap * 0.85

    if (paramStr) {
      ctx.fillStyle = primaryColor
      ctx.font = `600 ${paramSize}px ${fontDef.metaFamily}`
      ctx.fillText(paramStr, rightX, paramY, spanW * 0.45)
    }

    let cursorRightX = rightX
    if (opts.showPaletteDots && paletteHexes.length > 0) {
      const dotR = Math.max(3, Math.round(5.5 * u))
      const gap = dotR * 2.8
      for (let i = paletteHexes.length - 1; i >= 0; i--) {
        ctx.beginPath()
        ctx.arc(cursorRightX - dotR, rightSubY, dotR, 0, Math.PI * 2)
        ctx.fillStyle = paletteHexes[i]
        ctx.fill()
        ctx.strokeStyle = isDarkTheme ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.12)'
        ctx.lineWidth = 1
        ctx.stroke()
        cursorRightX -= gap
      }
      cursorRightX -= Math.round(10 * u)
    }

    if (dateText) {
      ctx.fillStyle = secondaryColor
      ctx.font = `400 ${subSize}px ${fontDef.metaFamily}`
      ctx.fillText(dateText, cursorRightX, rightSubY, spanW * 0.35)
    }
  }

  ctx.restore()
  ctx.restore()
}

/** 导出全分辨率摄影作品分享图 */
export async function exportPhotoFrameBlob(
  bitmap: ImageBitmap,
  exif: PhotoExifFields,
  opts: PhotoFrameOptions,
  paletteHexes: string[],
  forcePng = false,
): Promise<{ blob: Blob; width: number; height: number }> {
  const layout = computeFrameLayout(bitmap.width, bitmap.height, opts)
  // 限制超大相机原图在浏览器画布安全上限内（最大边 8192px）
  const safeScale = Math.min(1, 8192 / Math.max(layout.outW, layout.outH))
  const canvas = document.createElement('canvas')
  renderPhotoFrame(canvas, bitmap, exif, opts, paletteHexes, safeScale)

  const fmt: ExportFormat = forcePng ? 'png' : opts.format
  const mime = FORMAT_MIME[fmt]
  const q = fmt === 'png' ? undefined : Math.max(0.1, Math.min(1, opts.quality / 100))
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('导出失败：图片尺寸可能过大'))), mime, q),
  )
  const out = { blob, width: canvas.width, height: canvas.height }
  canvas.width = 0
  canvas.height = 0
  return out
}

/** 生成一张高颜值日落山脉摄影示例图（方便空状态一键体验） */
export async function createDemoPhoto(): Promise<ImageBitmap> {
  const w = 1500
  const h = 1000
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!

  // 日落暮光天空渐变
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.72)
  sky.addColorStop(0, '#1e1b4b')
  sky.addColorStop(0.38, '#7c2d6e')
  sky.addColorStop(0.7, '#ea580c')
  sky.addColorStop(1, '#fde68a')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  // 落日余晖太阳光晕
  const sun = ctx.createRadialGradient(w * 0.62, h * 0.56, 10, w * 0.62, h * 0.56, 360)
  sun.addColorStop(0, 'rgba(255, 251, 235, 0.95)')
  sun.addColorStop(0.25, 'rgba(253, 186, 116, 0.65)')
  sun.addColorStop(1, 'rgba(234, 88, 12, 0)')
  ctx.fillStyle = sun
  ctx.fillRect(0, 0, w, h)

  // 三层远近山脉剪影
  const layers = [
    { y: 0.62, amp: 85, freq: 0.0042, phase: 1.2, color: '#3b1d4a' },
    { y: 0.71, amp: 68, freq: 0.0055, phase: 3.1, color: '#241432' },
    { y: 0.81, amp: 52, freq: 0.0068, phase: 5.0, color: '#110d1b' },
  ]
  for (const l of layers) {
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let x = 0; x <= w; x += 12) {
      const py =
        h * l.y +
        Math.sin(x * l.freq + l.phase) * l.amp +
        Math.cos(x * l.freq * 2.1 + l.phase) * (l.amp * 0.35)
      ctx.lineTo(x, py)
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fillStyle = l.color
    ctx.fill()
  }

  const bitmap = await createImageBitmap(c)
  c.width = 0
  c.height = 0
  return bitmap
}
