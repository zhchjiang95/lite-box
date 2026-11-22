import { zip } from 'fflate'
import { decodeImageFile } from '@/lib/image'

export interface StripOptions {
  /** 是否保留 ICC 色彩配置（建议开启，避免 Display P3 广色域照片发灰偏色） */
  keepIcc: boolean
  /** 优先使用二进制无损段剥离（仅 JPEG / PNG 支持，其他格式自动回退为 Canvas 重绘） */
  lossless: boolean
}

export interface StripResult {
  blob: Blob
  /** 实际使用的抹除策略 */
  method: 'lossless-jpeg' | 'lossless-png' | 'canvas-redraw'
  removedBytes: number
  filename: string
}

/**
 * JPEG 二进制无损剥离：
 * 保留图像编码与量化数据，剔除 APP1(EXIF/XMP)、APP13(IPTC)、COM(注释) 等全部非图像隐私段；
 * 可选保留 APP2(ICC_PROFILE) 防止广色域偏色。
 */
function stripJpegBinary(buffer: ArrayBuffer, keepIcc: boolean): Blob | null {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null

  const view = new DataView(buffer)
  const chunks: Uint8Array[] = [bytes.subarray(0, 2)] // SOI (FF D8)
  let offset = 2

  while (offset < bytes.length) {
    // 查找 0xFF Marker 前缀
    if (bytes[offset] !== 0xff) return null
    while (offset < bytes.length && bytes[offset] === 0xff) offset++
    if (offset >= bytes.length) break

    const marker = bytes[offset++]

    // SOS (Start of Scan, 0xDA)：后续直到文件末尾均为压缩扫描图像数据，直接完整保留
    if (marker === 0xda) {
      chunks.push(bytes.subarray(offset - 2))
      break
    }

    // EOI (0xD9) 或 RST0..RST7 (0xD0..0xD7) 或 TEM (0x01) 无长度字段
    if (marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      chunks.push(bytes.subarray(offset - 2, offset))
      if (marker === 0xd9) break
      continue
    }

    if (offset + 2 > bytes.length) return null
    const segLen = view.getUint16(offset, false)
    if (segLen < 2 || offset + segLen > bytes.length) return null

    const segStart = offset - 2
    const segEnd = offset + segLen

    // 判断是否为需要剥离的元数据段：
    // APP1..APP15 (0xE1..0xEF) 与 COM (0xFE)
    let drop = false
    if (marker === 0xfe) {
      drop = true
    } else if (marker >= 0xe1 && marker <= 0xef) {
      if (marker === 0xe2 && keepIcc) {
        // 检查是否为 ICC_PROFILE 标识
        const sig = String.fromCharCode(...bytes.subarray(offset + 2, Math.min(segEnd, offset + 13)))
        drop = sig !== 'ICC_PROFILE'
      } else {
        drop = true
      }
    }

    if (!drop) {
      chunks.push(bytes.subarray(segStart, segEnd))
    }
    offset = segEnd
  }

  const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0)
  const out = new Uint8Array(totalLen)
  let pos = 0
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.byteLength
  }
  return new Blob([out], { type: 'image/jpeg' })
}

/**
 * PNG 二进制无损剥离：
 * 保留关键像素块（IHDR/PLTE/IDAT/IEND/tRNS 等）及可选色彩块，剥离 eXIf/tEXt/zTXt/iTXt/tIME 等隐私与文本元数据块。
 */
function stripPngBinary(buffer: ArrayBuffer, keepIcc: boolean): Blob | null {
  const bytes = new Uint8Array(buffer)
  // PNG 8 字节魔数签名：89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length < 33 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    return null
  }

  const view = new DataView(buffer)
  const chunks: Uint8Array[] = [bytes.subarray(0, 8)]
  const dropTypes = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME', 'pHYs'])
  if (!keepIcc) {
    dropTypes.add('iCCP')
    dropTypes.add('cHRM')
    dropTypes.add('gAMA')
  }

  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false)
    const chunkEnd = offset + 12 + length
    if (chunkEnd > bytes.length) return null

    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    )
    if (!dropTypes.has(type)) {
      chunks.push(bytes.subarray(offset, chunkEnd))
    }
    offset = chunkEnd
    if (type === 'IEND') break
  }

  const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0)
  const out = new Uint8Array(totalLen)
  let pos = 0
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.byteLength
  }
  return new Blob([out], { type: 'image/png' })
}

/** Canvas 重绘剥离全部元数据（自动按 EXIF Orientation 校正朝向，并兼容 HEIC/HEIF） */
async function stripByCanvasRedraw(file: File): Promise<{ blob: Blob; ext: string }> {
  const decoded = await decodeImageFile(file)
  URL.revokeObjectURL(decoded.previewUrl)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = decoded.width
    canvas.height = decoded.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(decoded.bitmap, 0, 0)

    const isJpeg = file.type === 'image/jpeg' || file.type === 'image/jpg' || decoded.isHeic
    const isWebp = file.type === 'image/webp'
    const mime = isJpeg ? 'image/jpeg' : isWebp ? 'image/webp' : 'image/png'
    const ext = isJpeg ? 'jpg' : isWebp ? 'webp' : 'png'
    const quality = mime === 'image/png' ? undefined : 0.95

    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('重绘导出失败'))), mime, quality),
    )
    canvas.width = 0
    canvas.height = 0
    return { blob, ext }
  } finally {
    decoded.bitmap.close()
  }
}

/** 清除单张图片隐私元数据 */
export async function stripImageMetadata(file: File, opts: StripOptions): Promise<StripResult> {
  const base = file.name.replace(/\.[^.]+$/, '') || 'clean-image'

  if (opts.lossless) {
    const buf = await file.arrayBuffer()
    if (file.type === 'image/jpeg' || file.type === 'image/jpg' || /\.jpe?g$/i.test(file.name)) {
      const stripped = stripJpegBinary(buf, opts.keepIcc)
      if (stripped) {
        return {
          blob: stripped,
          method: 'lossless-jpeg',
          removedBytes: Math.max(0, file.size - stripped.size),
          filename: `${base}-无隐私.jpg`,
        }
      }
    }
    if (file.type === 'image/png' || /\.png$/i.test(file.name)) {
      const stripped = stripPngBinary(buf, opts.keepIcc)
      if (stripped) {
        return {
          blob: stripped,
          method: 'lossless-png',
          removedBytes: Math.max(0, file.size - stripped.size),
          filename: `${base}-无隐私.png`,
        }
      }
    }
  }

  const { blob, ext } = await stripByCanvasRedraw(file)
  return {
    blob,
    method: 'canvas-redraw',
    removedBytes: Math.max(0, file.size - blob.size),
    filename: `${base}-无隐私.${ext}`,
  }
}

/** 批量抹除隐私元数据并打包为 ZIP */
export async function stripBatchToZip(
  files: File[],
  opts: StripOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<{ blob: Blob; totalRemoved: number }> {
  const entries: Record<string, Uint8Array> = {}
  const used = new Map<string, number>()
  let totalRemoved = 0

  for (let i = 0; i < files.length; i++) {
    const res = await stripImageMetadata(files[i], opts)
    totalRemoved += res.removedBytes
    const n = used.get(res.filename) ?? 0
    let finalName = res.filename
    if (n > 0) {
      const dot = res.filename.lastIndexOf('.')
      finalName = dot > 0 ? `${res.filename.slice(0, dot)}-${n + 1}${res.filename.slice(dot)}` : `${res.filename}-${n + 1}`
    }
    used.set(res.filename, n + 1)
    entries[finalName] = new Uint8Array(await res.blob.arrayBuffer())
    onProgress?.(i + 1, files.length)
  }

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data)))
  })
  const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
  return { blob: new Blob([buf], { type: 'application/zip' }), totalRemoved }
}
