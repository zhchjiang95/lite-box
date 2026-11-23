/** 局域网共享剪贴板：类型定义、内容类型识别与截图压缩工具 */

import { decodeImageFile } from '@/lib/image'
import type { ConnectionState, DeviceType, PeerInfo } from '../lan-transfer/types'

export type { ConnectionState, DeviceType, PeerInfo }

export type ClipKind = 'text' | 'link' | 'code' | 'image'

export interface ClipItem {
  id: string
  kind: ClipKind
  text: string
  imageDataUrl?: string
  imageWidth?: number
  imageHeight?: number
  pinned: boolean
  fromId: string
  fromName: string
  fromColor: string
  deviceType: DeviceType
  timestamp: number
}

/** 自动识别粘贴文本的类型（纯链接 / 代码片段 / 普通文本） */
export function detectTextClipKind(text: string): Exclude<ClipKind, 'image'> {
  const trimmed = text.trim()
  if (/^https?:\/\/\S+$/i.test(trimmed)) return 'link'

  // 常见代码特征启发式判断（包含缩进/代码块符号/关键字）
  const lines = trimmed.split('\n')
  const looksLikeJson =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))
  const hasCodeTokens =
    /^(?:import |export |const |let |var |function |class |def |SELECT |curl |git |pnpm |npm |docker |#include |<\/?[a-z])/im.test(
      trimmed,
    ) ||
    (lines.length >= 2 && /[{};=>]|^\s{2,}\S/m.test(trimmed))

  if (looksLikeJson || hasCodeTokens) return 'code'
  return 'text'
}

/** 将粘贴或拖入的截图压缩为轻量化 DataURL（限制最长边 1600px 且体积 < 1.2 MB），确保局域网毫秒级同步 */
export async function compressClipboardImage(file: File): Promise<{
  dataUrl: string
  width: number
  height: number
}> {
  const decoded = await decodeImageFile(file)
  try {
    const maxSide = 1600
    const scale = Math.min(1, maxSide / Math.max(decoded.width, decoded.height))
    const w = Math.max(1, Math.round(decoded.width * scale))
    const h = Math.max(1, Math.round(decoded.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(decoded.bitmap, 0, 0, w, h)

    // 先尝试清晰度极佳的 WebP，若体积仍较大再降质量或回退 JPEG
    let dataUrl = canvas.toDataURL('image/webp', 0.86)
    if (!dataUrl.startsWith('data:image/webp')) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.86)
    }
    if (dataUrl.length > 1_300_000) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.72)
    }
    canvas.width = 0
    canvas.height = 0
    return { dataUrl, width: w, height: h }
  } finally {
    decoded.bitmap.close()
    URL.revokeObjectURL(decoded.previewUrl)
  }
}

/** 将任意图片 DataURL 转为 PNG Blob 并写入系统剪贴板（浏览器 ClipboardItem 仅对 image/png 兼容性最佳） */
export async function copyDataUrlImageToClipboard(dataUrl: string): Promise<void> {
  if (!('ClipboardItem' in window) || !navigator.clipboard?.write) {
    throw new Error('当前浏览器不支持直接复制图片，请点击下载保存')
  }
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('图片加载失败'))
    el.src = dataUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  canvas.getContext('2d')!.drawImage(img, 0, 0)
  const pngBlob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('生成 PNG 失败'))), 'image/png'),
  )
  canvas.width = 0
  canvas.height = 0
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
}

export function formatClipTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
