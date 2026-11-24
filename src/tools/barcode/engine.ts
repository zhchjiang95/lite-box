/**
 * 条形码渲染、高清 PNG / 矢量 SVG 导出、批量 ZIP 打包与打印视图引擎
 */

import JsBarcode from 'jsbarcode'
import { zipSync, strToU8 } from 'fflate'
import { canvasToBlob } from '@/lib/file'
import { validateAndNormalizeBarcode, type BarcodeStyleConfig } from './types'

/** 组装传给 JsBarcode 的标准配置 */
function buildJsBarcodeOptions(style: BarcodeStyleConfig, scale = 1): JsBarcode.Options {
  const fontMap = {
    monospace: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    'sans-serif': '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
  }

  return {
    format: style.format,
    width: style.barWidth * scale,
    height: style.height * scale,
    margin: style.margin * scale,
    lineColor: style.lineColor,
    background: style.background === 'transparent' ? 'rgba(0,0,0,0)' : style.background,
    displayValue: style.displayValue,
    text: style.customText.trim() || undefined,
    font: fontMap[style.font],
    fontOptions: style.bold ? 'bold' : '',
    fontSize: style.fontSize * scale,
    textMargin: style.textMargin * scale,
    textAlign: style.textAlign,
    textPosition: style.textPosition,
  }
}

/** 构建干净独立的无损矢量 SVG 字符串 */
export function buildBarcodeSvgString(rawValue: string, style: BarcodeStyleConfig): string {
  const check = validateAndNormalizeBarcode(rawValue, style.format)
  if (check.error) throw new Error(check.error)

  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const opts = buildJsBarcodeOptions(style, 1)
  JsBarcode(svgEl, check.encodedValue, {
    ...opts,
    xmlDocument: document,
  })

  // 若背景透明，移除 JsBarcode 生成的透明背景 <rect> 让 SVG 更纯净
  if (style.background === 'transparent') {
    const firstRect = svgEl.querySelector('rect')
    if (firstRect && firstRect.getAttribute('style')?.includes('rgba(0,0,0,0)')) {
      firstRect.remove()
    }
  }

  const serializer = new XMLSerializer()
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serializer.serializeToString(svgEl)}`
}

/** 渲染条形码到指定 Canvas（支持 1×/2×/3× 高清倍率与透明背景） */
export function renderBarcodeToCanvas(
  canvas: HTMLCanvasElement,
  rawValue: string,
  style: BarcodeStyleConfig,
  scale = 2,
): { width: number; height: number } {
  const check = validateAndNormalizeBarcode(rawValue, style.format)
  if (check.error) throw new Error(check.error)

  const opts = buildJsBarcodeOptions(style, scale)
  JsBarcode(canvas, check.encodedValue, opts)
  return { width: canvas.width, height: canvas.height }
}

/** 导出高清 PNG Blob */
export async function exportBarcodePngBlob(rawValue: string, style: BarcodeStyleConfig): Promise<Blob> {
  const canvas = document.createElement('canvas')
  try {
    renderBarcodeToCanvas(canvas, rawValue, style, style.exportScale)
    return await canvasToBlob(canvas, 'image/png')
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

/** 导出无损矢量 SVG Blob */
export function exportBarcodeSvgBlob(rawValue: string, style: BarcodeStyleConfig): Blob {
  const svg = buildBarcodeSvgString(rawValue, style)
  return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
}

export interface BatchBarcodeItem {
  lineNumber: number
  filename: string
  rawValue: string
  encodedValue: string
  error?: string
}

function sanitizeFilename(name: string, fallback: string): string {
  const clean = name
    .replace(/[\\/:*?"<>|\r\n]+/g, '_')
    .trim()
    .slice(0, 48)
  return clean || fallback
}

/** 解析批量多行条码输入（支持 `文件名 | 条码内容` 或纯每行一个条码，自动逐条校验） */
export function parseBatchBarcodeLines(raw: string, format: BarcodeStyleConfig['format']): BatchBarcodeItem[] {
  const lines = raw.split(/\r?\n/)
  const used = new Map<string, number>()
  const items: BatchBarcodeItem[] = []

  lines.forEach((line, idx) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const pipeIdx = trimmed.indexOf('|')
    let customName = ''
    let rawValue = trimmed
    if (pipeIdx > 0 && pipeIdx < trimmed.length - 1) {
      customName = trimmed.slice(0, pipeIdx).trim()
      rawValue = trimmed.slice(pipeIdx + 1).trim()
    }
    const check = validateAndNormalizeBarcode(rawValue, format)
    const base = sanitizeFilename(customName || check.encodedValue || rawValue, `barcode-${idx + 1}`)
    const count = used.get(base) ?? 0
    used.set(base, count + 1)
    const filename = count === 0 ? base : `${base}-${count + 1}`

    items.push({
      lineNumber: idx + 1,
      filename,
      rawValue,
      encodedValue: check.encodedValue,
      error: check.error,
    })
  })

  return items
}

/** 批量生成条形码并打包为 ZIP（跳过无效项并统计成功数） */
export async function exportBatchBarcodesZip(
  items: BatchBarcodeItem[],
  style: BarcodeStyleConfig,
  format: 'png' | 'svg',
  onProgress?: (done: number, total: number) => void,
): Promise<{ blob: Blob; exportedCount: number }> {
  const validItems = items.filter((i) => !i.error)
  if (!validItems.length) throw new Error('没有符合当前制式规则的有效条码')

  const files: Record<string, Uint8Array> = {}
  const canvas = document.createElement('canvas')
  // 批量模式不使用单码的 customText 覆盖，以免所有条码显示同一行文字
  const batchStyle: BarcodeStyleConfig = { ...style, customText: '' }

  try {
    for (let i = 0; i < validItems.length; i++) {
      const item = validItems[i]
      if (format === 'svg') {
        const svg = buildBarcodeSvgString(item.encodedValue, batchStyle)
        files[`${item.filename}.svg`] = strToU8(svg)
      } else {
        renderBarcodeToCanvas(canvas, item.encodedValue, batchStyle, batchStyle.exportScale)
        const blob = await canvasToBlob(canvas, 'image/png')
        files[`${item.filename}.png`] = new Uint8Array(await blob.arrayBuffer())
      }
      onProgress?.(i + 1, validItems.length)
      if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0))
    }
  } finally {
    canvas.width = 0
    canvas.height = 0
  }

  const zipped = zipSync(files, { level: format === 'svg' ? 6 : 0 })
  return {
    blob: new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
    exportedCount: validItems.length,
  }
}

/** 打开干净的多列 A4 标签打印视图（直接将矢量 SVG 排版至新打印 iframe） */
export function printBarcodeLabels(items: { title?: string; value: string }[], style: BarcodeStyleConfig) {
  const batchStyle: BarcodeStyleConfig = {
    ...style,
    background: style.background === 'transparent' ? '#ffffff' : style.background,
    customText: items.length === 1 ? style.customText : '',
  }

  const cardsHtml = items
    .map((it) => {
      const svg = buildBarcodeSvgString(it.value, batchStyle)
      const titleHtml = it.title ? `<div class="title">${it.title.replace(/</g, '&lt;')}</div>` : ''
      return `<div class="cell">${titleHtml}${svg}</div>`
    })
    .join('')

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  if (!doc) {
    iframe.remove()
    throw new Error('无法创建打印视图')
  }

  doc.open()
  doc.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>条形码标签打印</title>
<style>
  @page { margin: 10mm; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; background: #fff; }
  .grid { display: grid; grid-template-columns: repeat(${items.length === 1 ? 1 : 3}, minmax(0, 1fr)); gap: 10mm 6mm; align-items: start; }
  .cell { border: 1px dashed #cbd5e1; border-radius: 6px; padding: 6mm 4mm; text-align: center; break-inside: avoid; }
  .title { font-size: 12px; font-weight: 600; color: #0f172a; margin-bottom: 4px; word-break: break-all; }
  .cell svg { max-width: 100%; height: auto; display: block; margin: 0 auto; }
  @media print { .cell { border-color: #e2e8f0; } }
</style>
</head>
<body><div class="grid">${cardsHtml}</div></body>
</html>`)
  doc.close()

  setTimeout(() => {
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
    setTimeout(() => iframe.remove(), 1500)
  }, 150)
}
