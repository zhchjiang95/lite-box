/**
 * Base64 编解码核心引擎（零第三方依赖）
 * - 支持 UTF-8 中文/Emoji 与大体积 Uint8Array 分块编解码（避免栈溢出）
 * - 支持标准 Base64 / URL-Safe (RFC 4648 §5) / 去填充 / 76 字符 MIME 换行 / 逐行批处理
 * - 支持无前缀纯 Base64 文件头魔数（Magic Bytes）自动识别真实 MIME 与扩展名
 */

export interface TextBase64Options {
  /** 是否使用 URL-Safe 字符集（+ → -，/ → _） */
  urlSafe: boolean
  /** 编码时是否省略末尾 '=' 填充 */
  omitPadding: boolean
  /** 编码时是否按 76 字符自动折行（MIME / PEM 规范） */
  wrap76: boolean
  /** 是否按行独立编解码 */
  lineByLine: boolean
}

export const DEFAULT_TEXT_BASE64_OPTS: TextBase64Options = {
  urlSafe: false,
  omitPadding: false,
  wrap76: false,
  lineByLine: false,
}

const textEncoder = new TextEncoder()
const textDecoderStrict = new TextDecoder('utf-8', { fatal: true })
const textDecoderLoose = new TextDecoder('utf-8', { fatal: false })

/** 将任意大小 Uint8Array 分块编码为标准 Base64（不触发 call stack 溢出） */
export function bytesToBase64(bytes: Uint8Array, opts?: { urlSafe?: boolean; omitPadding?: boolean; wrap76?: boolean }): string {
  const chunkSize = 0x8000 // 32KB 分块
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    binary += String.fromCharCode(...slice)
  }
  let b64 = btoa(binary)
  if (opts?.urlSafe) {
    b64 = b64.replace(/\+/g, '-').replace(/\//g, '_')
  }
  if (opts?.omitPadding) {
    b64 = b64.replace(/=+$/, '')
  }
  if (opts?.wrap76 && b64.length > 76) {
    const parts: string[] = []
    for (let i = 0; i < b64.length; i += 76) {
      parts.push(b64.slice(i, i + 76))
    }
    b64 = parts.join('\n')
  }
  return b64
}

/** 清理并解析标准/URL-Safe/带 DataURL 前缀的 Base64 为 Uint8Array */
export function base64ToBytes(rawInput: string): {
  bytes: Uint8Array<ArrayBuffer>
  declaredMime: string | null
  cleanBase64: string
} {
  let declaredMime: string | null = null
  let body = rawInput.trim()

  // 自动识别并剥离 DataURL 头部（如 data:image/png;base64,xxxx）
  const dataUrlMatch = body.match(/^data:([^;,]*)(?:;charset=[^;,]*)?;base64,(.*)$/is)
  if (dataUrlMatch) {
    declaredMime = dataUrlMatch[1]?.trim().toLowerCase() || null
    body = dataUrlMatch[2]
  }

  // 去除所有空白换行，兼容 URL-Safe 字符并补齐 '=' 填充
  let cleaned = body.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!cleaned) {
    return { bytes: new Uint8Array(new ArrayBuffer(0)), declaredMime, cleanBase64: '' }
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
    throw new Error('包含非法 Base64 字符（仅允许 A-Z、a-z、0-9、+/ 或 -_ 及末尾 =）')
  }
  const mod = cleaned.length % 4
  if (mod === 1) {
    throw new Error('Base64 长度无效（不能满足 4n / 4n+2 / 4n+3 编码长度）')
  }
  if (mod > 0) {
    cleaned += '='.repeat(4 - mod)
  }

  let binary: string
  try {
    binary = atob(cleaned)
  } catch {
    throw new Error('Base64 解码失败，请检查字符串是否完整')
  }

  const buf = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return { bytes, declaredMime, cleanBase64: cleaned }
}

/** 编码 UTF-8 文本为 Base64 */
export function encodeTextBase64(text: string, opts: TextBase64Options): {
  output: string
  inputBytes: number
  outputBytes: number
} {
  if (!text) return { output: '', inputBytes: 0, outputBytes: 0 }

  if (opts.lineByLine) {
    const lines = text.split(/\r?\n/)
    const encodedLines = lines.map((line) => {
      if (!line) return ''
      return bytesToBase64(textEncoder.encode(line), {
        urlSafe: opts.urlSafe,
        omitPadding: opts.omitPadding,
        wrap76: false,
      })
    })
    const output = encodedLines.join('\n')
    return {
      output,
      inputBytes: textEncoder.encode(text).byteLength,
      outputBytes: output.length,
    }
  }

  const rawBytes = textEncoder.encode(text)
  const output = bytesToBase64(rawBytes, opts)
  return {
    output,
    inputBytes: rawBytes.byteLength,
    outputBytes: output.length,
  }
}

/** 解码 Base64 为 UTF-8 文本 */
export function decodeTextBase64(b64Text: string, opts: Pick<TextBase64Options, 'lineByLine'>): {
  output: string
  inputBytes: number
  outputBytes: number
  nonUtf8Warning: boolean
} {
  if (!b64Text.trim()) return { output: '', inputBytes: 0, outputBytes: 0, nonUtf8Warning: false }

  let nonUtf8Warning = false
  const decodeOne = (chunk: string) => {
    const { bytes } = base64ToBytes(chunk)
    try {
      return { text: textDecoderStrict.decode(bytes), byteLen: bytes.byteLength }
    } catch {
      nonUtf8Warning = true
      return { text: textDecoderLoose.decode(bytes), byteLen: bytes.byteLength }
    }
  }

  if (opts.lineByLine) {
    const lines = b64Text.split(/\r?\n/)
    let totalOutBytes = 0
    const decodedLines = lines.map((line, idx) => {
      if (!line.trim()) return ''
      try {
        const res = decodeOne(line)
        totalOutBytes += res.byteLen
        return res.text
      } catch (err) {
        const msg = err instanceof Error ? err.message : '解码失败'
        throw new Error(`第 ${idx + 1} 行：${msg}`)
      }
    })
    return {
      output: decodedLines.join('\n'),
      inputBytes: b64Text.length,
      outputBytes: totalOutBytes,
      nonUtf8Warning,
    }
  }

  const res = decodeOne(b64Text)
  return {
    output: res.text,
    inputBytes: b64Text.trim().length,
    outputBytes: res.byteLen,
    nonUtf8Warning,
  }
}

// ======================== 文件头魔数（Magic Bytes）自动识别 ========================

export interface DetectedFileType {
  mime: string
  ext: string
  label: string
  category: 'image' | 'pdf' | 'audio' | 'video' | 'text' | 'binary'
}

const MIME_TO_META: Record<string, Omit<DetectedFileType, 'mime'>> = {
  'image/png': { ext: 'png', label: 'PNG 图片', category: 'image' },
  'image/jpeg': { ext: 'jpg', label: 'JPEG 图片', category: 'image' },
  'image/webp': { ext: 'webp', label: 'WebP 图片', category: 'image' },
  'image/gif': { ext: 'gif', label: 'GIF 动图', category: 'image' },
  'image/svg+xml': { ext: 'svg', label: 'SVG 矢量图', category: 'image' },
  'image/x-icon': { ext: 'ico', label: 'ICO 图标', category: 'image' },
  'image/bmp': { ext: 'bmp', label: 'BMP 位图', category: 'image' },
  'image/avif': { ext: 'avif', label: 'AVIF 图片', category: 'image' },
  'application/pdf': { ext: 'pdf', label: 'PDF 文档', category: 'pdf' },
  'application/zip': { ext: 'zip', label: 'ZIP 压缩包', category: 'binary' },
  'application/json': { ext: 'json', label: 'JSON 文本', category: 'text' },
  'text/plain': { ext: 'txt', label: '纯文本文件', category: 'text' },
  'text/html': { ext: 'html', label: 'HTML 文档', category: 'text' },
  'text/css': { ext: 'css', label: 'CSS 样式表', category: 'text' },
  'audio/mpeg': { ext: 'mp3', label: 'MP3 音频', category: 'audio' },
  'audio/wav': { ext: 'wav', label: 'WAV 音频', category: 'audio' },
  'audio/ogg': { ext: 'ogg', label: 'OGG 音频', category: 'audio' },
  'video/mp4': { ext: 'mp4', label: 'MP4 视频', category: 'video' },
  'video/webm': { ext: 'webm', label: 'WebM 视频', category: 'video' },
  'font/woff2': { ext: 'woff2', label: 'WOFF2 字体', category: 'binary' },
}

function startsWithBytes(buf: Uint8Array, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false
  for (let i = 0; i < sig.length; i++) {
    if (buf[offset + i] !== sig[i]) return false
  }
  return true
}

/** 结合声明 MIME 与二进制文件头魔数识别真实文件类型 */
export function detectFileTypeFromBytes(bytes: Uint8Array, declaredMime: string | null): DetectedFileType {
  // 1. 优先通过二进制魔数精准探测（兼容不带 DataURL 前缀的纯 Base64）
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: 'image/png', ...MIME_TO_META['image/png'] }
  }
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) {
    return { mime: 'image/jpeg', ...MIME_TO_META['image/jpeg'] }
  }
  if (startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return { mime: 'image/gif', ...MIME_TO_META['image/gif'] }
  }
  if (startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWithBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { mime: 'image/webp', ...MIME_TO_META['image/webp'] }
  }
  if (startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWithBytes(bytes, [0x57, 0x41, 0x56, 0x45], 8)) {
    return { mime: 'audio/wav', ...MIME_TO_META['audio/wav'] }
  }
  if (startsWithBytes(bytes, [0x42, 0x4d])) {
    return { mime: 'image/bmp', ...MIME_TO_META['image/bmp'] }
  }
  if (startsWithBytes(bytes, [0x00, 0x00, 0x01, 0x00])) {
    return { mime: 'image/x-icon', ...MIME_TO_META['image/x-icon'] }
  }
  if (startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { mime: 'application/pdf', ...MIME_TO_META['application/pdf'] }
  }
  if (startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    if (declaredMime && declaredMime.includes('openxmlformats')) {
      return { mime: declaredMime, ext: 'docx', label: 'Office 文档', category: 'binary' }
    }
    return { mime: 'application/zip', ...MIME_TO_META['application/zip'] }
  }
  if (startsWithBytes(bytes, [0x77, 0x4f, 0x46, 0x32])) {
    return { mime: 'font/woff2', ...MIME_TO_META['font/woff2'] }
  }
  if (startsWithBytes(bytes, [0x49, 0x44, 0x33]) || startsWithBytes(bytes, [0xff, 0xfb])) {
    return { mime: 'audio/mpeg', ...MIME_TO_META['audio/mpeg'] }
  }
  if (startsWithBytes(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12))
    if (brand === 'avif' || brand === 'avis') {
      return { mime: 'image/avif', ...MIME_TO_META['image/avif'] }
    }
    return { mime: 'video/mp4', ...MIME_TO_META['video/mp4'] }
  }

  // 2. 若头部存在明确 MIME 声明
  if (declaredMime) {
    if (MIME_TO_META[declaredMime]) {
      return { mime: declaredMime, ...MIME_TO_META[declaredMime] }
    }
    if (declaredMime.startsWith('image/')) {
      return { mime: declaredMime, ext: declaredMime.split('/')[1] || 'img', label: '图片文件', category: 'image' }
    }
    if (declaredMime.startsWith('audio/')) {
      return { mime: declaredMime, ext: declaredMime.split('/')[1] || 'audio', label: '音频文件', category: 'audio' }
    }
    if (declaredMime.startsWith('video/')) {
      return { mime: declaredMime, ext: declaredMime.split('/')[1] || 'mp4', label: '视频文件', category: 'video' }
    }
    if (declaredMime.startsWith('text/')) {
      return { mime: declaredMime, ext: 'txt', label: '文本文件', category: 'text' }
    }
  }

  // 3. 文本与 SVG 启发式检测（仅抽样前 4KB 判断是否为可打印 UTF-8）
  try {
    const sample = textDecoderStrict.decode(bytes.subarray(0, Math.min(bytes.length, 4096)))
    const trimmed = sample.trimStart()
    if (/^(?:<\?xml[\s\S]*?)?<svg[\s>]/i.test(trimmed)) {
      return { mime: 'image/svg+xml', ...MIME_TO_META['image/svg+xml'] }
    }
    // 控制字符占比极低视为纯文本
    let ctrl = 0
    for (let i = 0; i < sample.length; i++) {
      const code = sample.charCodeAt(i)
      if (code < 9 || (code > 13 && code < 32)) ctrl++
    }
    if (sample.length > 0 && ctrl / sample.length < 0.02) {
      if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && bytes.length < 2 * 1024 * 1024) {
        try {
          JSON.parse(textDecoderStrict.decode(bytes))
          return { mime: 'application/json', ...MIME_TO_META['application/json'] }
        } catch {
          // 按普通文本处理
        }
      }
      return { mime: 'text/plain', ...MIME_TO_META['text/plain'] }
    }
  } catch {
    // 非 UTF-8，按通用二进制处理
  }

  return {
    mime: declaredMime || 'application/octet-stream',
    ext: 'bin',
    label: '二进制文件',
    category: 'binary',
  }
}

/** 将二进制前 N 字节格式化为简洁 Hex Dump（用于二进制还原预览） */
export function formatHexPreview(bytes: Uint8Array, limit = 128): string {
  const slice = bytes.subarray(0, Math.min(bytes.length, limit))
  const lines: string[] = []
  for (let offset = 0; offset < slice.length; offset += 16) {
    const chunk = slice.subarray(offset, Math.min(offset + 16, slice.length))
    const addr = offset.toString(16).padStart(4, '0')
    const hex = Array.from(chunk, (b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ')
    const ascii = Array.from(chunk, (b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('')
    lines.push(`${addr}  ${hex}  |${ascii}|`)
  }
  return lines.join('\n')
}
