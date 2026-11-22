import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { PAGE_SIZES, type ImageToPdfOptions, type PdfImageItem } from './types'

/** 将 HEX 颜色（如 #ffffff）转为 pdf-lib 的 rgb() */
function hexToPdfRgb(hex: string) {
  const clean = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return rgb(1, 1, 1)
  return rgb(
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255,
  )
}

/** 计算给定图片在当前排版配置下的页面宽高（pt） */
export function resolvePageDimensions(
  imgW: number,
  imgH: number,
  rotation: number,
  opts: ImageToPdfOptions,
): { pageW: number; pageH: number; effW: number; effH: number } {
  const swapped = rotation % 180 !== 0
  const effW = swapped ? imgH : imgW
  const effH = swapped ? imgW : imgH

  if (opts.pageSize === 'fit') {
    // 自适应模式：以 144 DPI 映射合理逻辑点尺寸（宽上限约 842pt），保留精准长宽比
    const scale = Math.min(1, 842 / Math.max(effW, effH))
    const contentW = Math.max(72, effW * scale)
    const contentH = Math.max(72, effH * scale)
    const m = Math.max(0, opts.marginPt)
    return { pageW: contentW + m * 2, pageH: contentH + m * 2, effW, effH }
  }

  const spec = PAGE_SIZES.find((s) => s.id === opts.pageSize) ?? PAGE_SIZES[0]
  const baseW = spec.widthPt ?? 595.28
  const baseH = spec.heightPt ?? 841.89

  // 16:9 演示稿默认横向
  const landscape =
    opts.pageSize === 'slide169'
      ? opts.orientation !== 'portrait'
      : opts.orientation === 'landscape' || (opts.orientation === 'auto' && effW > effH)

  return {
    pageW: landscape ? Math.max(baseW, baseH) : Math.min(baseW, baseH),
    pageH: landscape ? Math.min(baseW, baseH) : Math.max(baseW, baseH),
    effW,
    effH,
  }
}

/**
 * 将图片预处理为可直接嵌入 pdf-lib 的 PNG 或 JPEG 字节流
 * - 未旋转、不压缩、且原图本身就是标准 JPG/PNG 时直接无损嵌入原始字节（速度最快）
 * - 需要旋转、cover 裁切、压缩或非 JPG/PNG（如 WebP / AVIF / HEIC / SVG）时通过 Canvas 精确渲染输出
 */
async function prepareEmbeddedBytes(
  item: PdfImageItem,
  targetAreaRatio: number | null,
  opts: ImageToPdfOptions,
): Promise<{ bytes: Uint8Array; kind: 'jpg' | 'png' }> {
  const isRawJpg = item.file.type === 'image/jpeg' || item.file.type === 'image/jpg'
  const isRawPng = item.file.type === 'image/png'
  const needCrop = opts.pageSize !== 'fit' && opts.fitMode === 'cover' && targetAreaRatio !== null
  const needRotate = item.rotation % 360 !== 0

  // 满足直通条件：零重编码直接嵌入原文件字节
  if ((isRawJpg || isRawPng) && !needRotate && !needCrop && !opts.compressJpeg) {
    return {
      bytes: new Uint8Array(await item.file.arrayBuffer()),
      kind: isRawJpg ? 'jpg' : 'png',
    }
  }

  // 计算旋转后的有效宽高
  const swapped = item.rotation % 180 !== 0
  const rw = swapped ? item.height : item.width
  const rh = swapped ? item.width : item.height

  // 若启用压缩，限制单图最长边在 2400px 以内兼顾高清与轻量体积
  const maxSide = opts.compressJpeg ? 2400 : 4096
  const scale = Math.min(1, maxSide / Math.max(rw, rh))

  let canvasW = Math.max(1, Math.round(rw * scale))
  let canvasH = Math.max(1, Math.round(rh * scale))
  let drawScale = scale

  // cover 模式下直接按目标内容区比例居中裁切，确保 PDF 页面内容区严丝合缝不溢出
  if (needCrop && targetAreaRatio) {
    const curRatio = canvasW / canvasH
    if (curRatio > targetAreaRatio) {
      canvasW = Math.max(1, Math.round(canvasH * targetAreaRatio))
    } else {
      canvasH = Math.max(1, Math.round(canvasW / targetAreaRatio))
    }
    drawScale = Math.max(canvasW / rw, canvasH / rh)
  }

  const canvas = document.createElement('canvas')
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // JPG 输出需先铺页面底色，避免透明区域变黑
  const outputJpg = opts.compressJpeg || isRawJpg
  if (outputJpg) {
    ctx.fillStyle = opts.background === 'transparent' ? '#ffffff' : opts.background
    ctx.fillRect(0, 0, canvasW, canvasH)
  }

  ctx.save()
  ctx.translate(canvasW / 2, canvasH / 2)
  ctx.scale(drawScale, drawScale)
  ctx.rotate((item.rotation * Math.PI) / 180)
  ctx.drawImage(item.bitmap, -item.width / 2, -item.height / 2)
  ctx.restore()

  const mime = outputJpg ? 'image/jpeg' : 'image/png'
  const q = outputJpg ? Math.max(0.4, Math.min(0.98, opts.jpegQuality / 100)) : undefined
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片编码失败'))), mime, q),
  )
  canvas.width = 0
  canvas.height = 0

  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    kind: outputJpg ? 'jpg' : 'png',
  }
}

/** 将多张图片按顺序合成一份标准 PDF */
export async function generatePdfFromImages(
  items: PdfImageItem[],
  opts: ImageToPdfOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  if (!items.length) throw new Error('请至少添加 1 张图片')

  const pdfDoc = await PDFDocument.create()
  pdfDoc.setCreator('轻匣 LiteBox')
  pdfDoc.setProducer('轻匣 LiteBox · 纯本地 PDF 工具')

  const font = opts.showPageNumbers ? await pdfDoc.embedFont(StandardFonts.Helvetica) : null
  const bgColor = hexToPdfRgb(opts.background)
  const isDarkBg =
    parseInt(opts.background.slice(1, 3), 16) * 0.299 +
      parseInt(opts.background.slice(3, 5), 16) * 0.587 +
      parseInt(opts.background.slice(5, 7), 16) * 0.114 <
    128

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const { pageW, pageH } = resolvePageDimensions(item.width, item.height, item.rotation, opts)
    const margin = Math.min(Math.max(0, opts.marginPt), Math.min(pageW, pageH) * 0.35)
    const footerSpace = opts.showPageNumbers ? 16 : 0

    const availW = Math.max(20, pageW - margin * 2)
    const availH = Math.max(20, pageH - margin * 2 - footerSpace)
    const targetAreaRatio = availW / availH

    const { bytes, kind } = await prepareEmbeddedBytes(item, targetAreaRatio, opts)
    const embedded = kind === 'jpg' ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes)

    const page = pdfDoc.addPage([pageW, pageH])

    // 绘制非纯白背景
    if (opts.background.toLowerCase() !== '#ffffff') {
      page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: bgColor })
    }

    // 计算绘制矩形（contain 完整居中；cover 已经按 targetAreaRatio 裁切直接铺满）
    const imgScale = Math.min(availW / embedded.width, availH / embedded.height)
    const drawW = embedded.width * imgScale
    const drawH = embedded.height * imgScale
    const drawX = margin + (availW - drawW) / 2
    const drawY = margin + footerSpace + (availH - drawH) / 2

    page.drawImage(embedded, { x: drawX, y: drawY, width: drawW, height: drawH })

    // 可选底部页码
    if (font && opts.showPageNumbers) {
      const label = `${i + 1} / ${items.length}`
      const textSize = 9.5
      const textW = font.widthOfTextAtSize(label, textSize)
      page.drawText(label, {
        x: (pageW - textW) / 2,
        y: Math.max(6, margin * 0.45),
        size: textSize,
        font,
        color: isDarkBg ? rgb(0.75, 0.75, 0.78) : rgb(0.45, 0.45, 0.5),
      })
    }

    onProgress?.(i + 1, items.length)
  }

  const pdfBytes = await pdfDoc.save()
  const buf = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer
  return new Blob([buf], { type: 'application/pdf' })
}
