/**
 * Word / PPT / Excel (OOXML) 原图与媒体文件无损提取引擎
 * - 基于 fflate 直接读取 word/media/、ppt/media/、xl/media/ 原始字节，零重编码、100% 无损原画质
 */

import { unzipSync, zipSync, type Zippable } from 'fflate'
import { uid } from '@/lib/utils'

export type OfficeDocKind = 'docx' | 'pptx' | 'xlsx'
export type MediaCategory = 'image' | 'vector' | 'audio' | 'video' | 'other'

export interface ExtractedMediaItem {
  id: string
  docId: string
  docName: string
  docKind: OfficeDocKind
  /** 在压缩包内的原始路径（如 word/media/image1.png） */
  entryPath: string
  /** 原始文件名（如 image1.png） */
  fileName: string
  /** 小写扩展名（不含点） */
  ext: string
  mime: string
  category: MediaCategory
  /** 浏览器 <img> 是否可直接渲染预览 */
  previewableImage: boolean
  size: number
  bytes: Uint8Array
  url: string
  width?: number
  height?: number
}

export interface OfficeDocEntry {
  id: string
  name: string
  kind: OfficeDocKind
  size: number
  mediaCount: number
  mediaBytes: number
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  emf: 'image/emf',
  wmf: 'image/wmf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
}

const PREVIEWABLE_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif', 'ico'])
const VECTOR_EXTS = new Set(['svg', 'emf', 'wmf'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac', 'wma'])
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv', 'wmv'])

/** 识别文档类型并拦截旧版二进制 Office 格式给出清晰提示 */
export function detectOfficeDoc(
  file: File,
): { ok: true; kind: OfficeDocKind } | { ok: false; reason: string } {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.docx')) return { ok: true, kind: 'docx' }
  if (lower.endsWith('.pptx')) return { ok: true, kind: 'pptx' }
  if (lower.endsWith('.xlsx')) return { ok: true, kind: 'xlsx' }

  if (lower.endsWith('.doc') || lower.endsWith('.ppt') || lower.endsWith('.xls')) {
    return {
      ok: false,
      reason: `「${file.name}」为旧版 Office 二进制格式，请先在 Word / WPS 中另存为 .docx / .pptx / .xlsx 后再提取`,
    }
  }
  return {
    ok: false,
    reason: `「${file.name}」不受支持，请导入 .docx、.pptx 或 .xlsx 文档`,
  }
}

/** 异步读取可预览图片的原始像素宽高 */
function probeImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null)
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/** 自然排序（让 image2.png 排在 image10.png 前面） */
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

/** 从单份 .docx / .pptx / .xlsx 中无损解包提取全部内嵌媒体 */
export async function extractOfficeMedia(file: File): Promise<{
  doc: OfficeDocEntry
  items: ExtractedMediaItem[]
}> {
  const detected = detectOfficeDoc(file)
  if (!detected.ok) {
    throw new Error(detected.reason)
  }

  const rawBytes = new Uint8Array(await file.arrayBuffer())
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(rawBytes)
  } catch {
    throw new Error(`无法解压「${file.name}」，可能已设置打开密码加密或文件已损坏`)
  }

  const docId = uid()
  const mediaPaths = Object.keys(entries)
    .filter((p) => /^(?:word|ppt|xl)\/media\/.+/.test(p) && entries[p].byteLength > 0)
    .sort(naturalCompare)

  const items: ExtractedMediaItem[] = []
  let mediaBytes = 0

  for (const entryPath of mediaPaths) {
    const bytes = entries[entryPath]
    const fileName = entryPath.split('/').pop() || 'media'
    const extMatch = /\.([^.]+)$/.exec(fileName)
    const ext = extMatch ? extMatch[1].toLowerCase() : 'bin'
    const mime = MIME_BY_EXT[ext] || 'application/octet-stream'

    let category: MediaCategory = 'other'
    if (AUDIO_EXTS.has(ext)) category = 'audio'
    else if (VIDEO_EXTS.has(ext)) category = 'video'
    else if (VECTOR_EXTS.has(ext)) category = 'vector'
    else if (PREVIEWABLE_IMAGE_EXTS.has(ext) || ext === 'tif' || ext === 'tiff') category = 'image'

    const previewableImage = PREVIEWABLE_IMAGE_EXTS.has(ext)
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    const blob = new Blob([copy.buffer], { type: mime })
    const url = URL.createObjectURL(blob)

    mediaBytes += bytes.byteLength

    items.push({
      id: uid(),
      docId,
      docName: file.name,
      docKind: detected.kind,
      entryPath,
      fileName,
      ext,
      mime,
      category,
      previewableImage,
      size: bytes.byteLength,
      bytes,
      url,
    })
  }

  // 并行探测可预览图片尺寸（非阻塞且极快）
  await Promise.all(
    items.map(async (item) => {
      if (!item.previewableImage) return
      const dims = await probeImageDimensions(item.url)
      if (dims) {
        item.width = dims.width
        item.height = dims.height
      }
    }),
  )

  return {
    doc: {
      id: docId,
      name: file.name,
      kind: detected.kind,
      size: file.size,
      mediaCount: items.length,
      mediaBytes,
    },
    items,
  }
}

/** 将可预览图片转为 PNG 写入系统剪贴板 */
export async function copyMediaImageToClipboard(item: ExtractedMediaItem): Promise<void> {
  if (!item.previewableImage) {
    throw new Error('该格式不支持直接复制到剪贴板，请点击下载原文件')
  }
  if (!('ClipboardItem' in window) || !navigator.clipboard?.write) {
    throw new Error('当前浏览器不支持复制图片，请点击下载')
  }
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('图片加载失败'))
    el.src = item.url
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || 512
  canvas.height = img.naturalHeight || 512
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  const pngBlob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 转换失败'))), 'image/png'),
  )
  canvas.width = 0
  canvas.height = 0
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
}

/** 将选中的无损原图/媒体打包为 ZIP（level 0 极速无损封装，因为图片/视频本身已压缩） */
export function packMediaToZip(items: ExtractedMediaItem[], groupByDoc: boolean): Blob {
  const zipData: Zippable = {}
  const usedPaths = new Set<string>()

  for (const item of items) {
    const docFolder = item.docName.replace(/\.(docx|pptx|xlsx)$/i, '').replace(/[\\/:*?"<>|]/g, '_')
    const baseName = item.fileName
    let targetPath = groupByDoc ? `${docFolder}/${baseName}` : baseName

    if (usedPaths.has(targetPath)) {
      const dot = baseName.lastIndexOf('.')
      const stem = dot > 0 ? baseName.slice(0, dot) : baseName
      const suffix = dot > 0 ? baseName.slice(dot) : ''
      let seq = 2
      while (usedPaths.has(targetPath)) {
        const nextName = `${stem}_${seq++}${suffix}`
        targetPath = groupByDoc ? `${docFolder}/${nextName}` : nextName
      }
    }

    usedPaths.add(targetPath)
    zipData[targetPath] = item.bytes
  }

  const out = zipSync(zipData, { level: 0 })
  const copy = new Uint8Array(out.byteLength)
  copy.set(out)
  return new Blob([copy.buffer], { type: 'application/zip' })
}
