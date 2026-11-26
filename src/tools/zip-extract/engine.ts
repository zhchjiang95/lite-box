/**
 * ZIP 在线解压与预览核心引擎（基于 @zip.js/zip.js）
 * - 支持常规 ZIP / ZIP64 / AES-256 / ZipCrypto 加密压缩包
 * - 智能识别 UTF-8 / Windows GB18030(GBK) 中文文件名，并支持手动切换编码
 * - 支持嵌套目录树构建、macOS 系统垃圾文件过滤、Zip Slip 路径安全消毒
 * - 支持 File System Access API 流式直写本地目录、单文件提取与勾选项重打包
 */

import {
  BlobReader,
  BlobWriter,
  configure,
  ERR_ENCRYPTED,
  ERR_INVALID_PASSWORD,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
  type Entry,
  type FileEntry,
} from '@zip.js/zip.js'

// 启用内置 Web Worker + 原生流式解压，大文件不阻塞主线程
configure({ useWebWorkers: true })

/** 支持的压缩包文件名编码 */
export type FilenameEncoding = 'auto' | 'utf-8' | 'gb18030' | 'big5' | 'shift-jis' | 'euc-kr' | 'ibm866'

export const FILENAME_ENCODING_OPTIONS: { value: FilenameEncoding; label: string; hint: string }[] = [
  { value: 'auto', label: '智能识别（UTF-8 / GBK）', hint: '自动优先 UTF-8，非法字节回退 GB18030' },
  { value: 'gb18030', label: 'GB18030 / GBK（中文 Windows）', hint: '修复 Windows 打包的中文乱码' },
  { value: 'utf-8', label: 'UTF-8（标准 / macOS / Linux）', hint: '标准 Unicode 编码' },
  { value: 'big5', label: 'Big5（繁体中文）', hint: '港台旧系统压缩包' },
  { value: 'shift-jis', label: 'Shift-JIS（日文）', hint: '日文 Windows 压缩包' },
  { value: 'euc-kr', label: 'EUC-KR（韩文）', hint: '韩文 Windows 压缩包' },
]

/** 文件预览分类 */
export type EntryKind = 'image' | 'text' | 'pdf' | 'audio' | 'video' | 'zip' | 'office' | 'binary'

/** 标准化后的压缩包文件条目 */
export interface ZipItem {
  /** 唯一标识（同序号防重名冲突） */
  id: string
  /** 原始 zip.js FileEntry 引用 */
  entry: FileEntry
  /** 规范化后的相对路径（统一使用 `/` 分隔，已去除前导 `/` 与危险 `..`） */
  path: string
  /** 文件名 */
  name: string
  /** 所在目录路径（根目录为 ''，子目录如 'docs/2026'） */
  dir: string
  /** 扩展名（小写，不含点） */
  ext: string
  /** 分类 */
  kind: EntryKind
  /** 推断的 MIME 类型 */
  mime: string
  /** 未压缩字节大小 */
  uncompressedSize: number
  /** 压缩后字节大小 */
  compressedSize: number
  /** 压缩节省比例（0–100） */
  ratio: number
  /** 是否加密 */
  encrypted: boolean
  /** 最后修改时间 */
  lastModDate: Date | null
  /** CRC32 十六进制校验码 */
  crc32Hex: string
  /** 是否为系统隐藏/垃圾文件（__MACOSX / .DS_Store / Thumbs.db / desktop.ini） */
  isSystemJunk: boolean
}

/** 文件夹树节点 */
export interface FolderTreeNode {
  /** 目录路径（根目录为 ''） */
  path: string
  /** 目录显示名 */
  name: string
  /** 直接与后代包含的文件总数 */
  fileCount: number
  /** 直接与后代包含的未压缩总字节 */
  totalSize: number
  /** 子目录（按自然序排序） */
  children: FolderTreeNode[]
}

/** 已打开的压缩包会话 */
export interface OpenedArchive {
  /** 压缩包文件名 */
  name: string
  /** 原始压缩包大小（字节） */
  archiveSize: number
  /** 原始 Blob（便于切换编码重解析） */
  sourceBlob: Blob
  /** 底层 ZipReader 实例（卸载或关闭时需调用 close） */
  reader: ZipReader<Blob>
  /** 所有文件条目（不含纯目录占位项） */
  items: ZipItem[]
  /** 压缩包备注 */
  comment: string
  /** 加密条目数量 */
  encryptedCount: number
  /** 未压缩总体积 */
  totalUncompressed: number
  /** 压缩后总体积 */
  totalCompressed: number
  /** 检测到的编码方案 */
  encoding: FilenameEncoding
  /** 系统垃圾文件数量 */
  junkCount: number
}

// ============================================================================
// 文件类型识别、安全路径消毒与编码解码
// ============================================================================

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico', 'avif', 'heic', 'heif'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'webm'])
const VIDEO_EXTS = new Set(['mp4', 'mov', 'm4v', 'ogv', 'mkv'])
const OFFICE_EXTS = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'wps', 'et', 'dps'])
const TEXT_EXTS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'jsonc',
  'json5',
  'yaml',
  'yml',
  'toml',
  'xml',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'mts',
  'cts',
  'tsx',
  'vue',
  'svelte',
  'py',
  'java',
  'kt',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'go',
  'rs',
  'rb',
  'php',
  'swift',
  'sh',
  'bash',
  'zsh',
  'bat',
  'ps1',
  'sql',
  'graphql',
  'csv',
  'tsv',
  'ini',
  'conf',
  'cfg',
  'env',
  'properties',
  'gitignore',
  'dockerignore',
  'dockerfile',
  'makefile',
  'log',
  'srt',
  'vtt',
  'lrc',
  'ass',
  'ssa',
  'license',
  'readme',
])

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/typescript',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  zip: 'application/zip',
}

/** 路径安全消毒：统一分隔符、去除前导斜杠与 Zip Slip `..` 越权段 */
export function sanitizeZipPath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '')
  const segments = normalized
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.' && s !== '..')
  return segments.join('/')
}

/** 判断是否为系统隐藏垃圾文件 */
export function isSystemJunkPath(cleanPath: string): boolean {
  const segs = cleanPath.split('/')
  if (segs[0] === '__MACOSX') return true
  const base = segs[segs.length - 1] ?? ''
  if (base === '.DS_Store' || base === 'Thumbs.db' || base === 'desktop.ini') return true
  if (base.startsWith('._') && segs.includes('__MACOSX')) return true
  return false
}

/** 识别扩展名与内容类别 */
export function classifyFile(filename: string): { ext: string; kind: EntryKind; mime: string } {
  const lower = filename.toLowerCase()
  const dotIdx = lower.lastIndexOf('.')
  const ext = dotIdx > 0 ? lower.slice(dotIdx + 1) : ''

  // 无扩展名的常见文本文件（README / LICENSE / Dockerfile / Makefile）
  if (!ext && TEXT_EXTS.has(lower)) {
    return { ext: lower, kind: 'text', mime: 'text/plain' }
  }

  let kind: EntryKind = 'binary'
  if (IMAGE_EXTS.has(ext)) kind = 'image'
  else if (ext === 'pdf') kind = 'pdf'
  else if (ext === 'zip') kind = 'zip'
  else if (AUDIO_EXTS.has(ext)) kind = 'audio'
  else if (VIDEO_EXTS.has(ext)) kind = 'video'
  else if (OFFICE_EXTS.has(ext)) kind = 'office'
  else if (TEXT_EXTS.has(ext)) kind = 'text'

  const mime = MIME_BY_EXT[ext] ?? (kind === 'text' ? 'text/plain' : 'application/octet-stream')
  return { ext, kind, mime }
}

/** 智能文件名/注释解码器（解决 Windows 中文 GBK 压缩包乱码） */
function createTextDecoderFn(encoding: FilenameEncoding) {
  const utf8Strict = new TextDecoder('utf-8', { fatal: true })

  return (bytes: Uint8Array): string | undefined => {
    if (encoding === 'utf-8') {
      return new TextDecoder('utf-8').decode(bytes)
    }
    if (encoding === 'auto') {
      try {
        return utf8Strict.decode(bytes)
      } catch {
        // 非法 UTF-8 字节序列：优先按 GB18030（超集兼容 GBK/GB2312）解码
        try {
          return new TextDecoder('gb18030').decode(bytes)
        } catch {
          return undefined
        }
      }
    }
    try {
      return new TextDecoder(encoding).decode(bytes)
    } catch {
      return undefined
    }
  }
}

/** 把 zip.js 底层错误翻译为直观中文提示 */
export function humanizeZipError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (msg.includes(ERR_INVALID_PASSWORD) || msg.toLowerCase().includes('invalid password')) {
    return '解压密码不正确，请检查大小写后重试'
  }
  if (msg.includes(ERR_ENCRYPTED) || msg.toLowerCase().includes('encrypted')) {
    return '该文件已加密，请先输入解压密码'
  }
  if (msg.includes('End of central directory') || msg.includes('EOCDR')) {
    return '文件不是有效的 ZIP 压缩包，或文件已损坏/不完整'
  }
  if (msg.includes('Unsupported compression')) {
    return '包含浏览器暂不支持的特殊压缩算法（如 Deflate64 / LZMA）'
  }
  return msg || '压缩包解析或解压失败'
}

/** 判断错误是否属于密码缺失/密码错误 */
export function isPasswordError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return (
    msg.includes(ERR_ENCRYPTED) ||
    msg.includes(ERR_INVALID_PASSWORD) ||
    msg.toLowerCase().includes('password') ||
    msg.toLowerCase().includes('encrypted')
  )
}

// ============================================================================
// 打开压缩包 & 目录树构建
// ============================================================================

/** 打开并解析一个 ZIP 文件（仅读取目录索引，秒开大包不解压正文） */
export async function openZipArchive(
  sourceBlob: Blob,
  name: string,
  encoding: FilenameEncoding = 'auto',
): Promise<OpenedArchive> {
  const decodeText = createTextDecoderFn(encoding)
  const reader = new ZipReader(new BlobReader(sourceBlob), {
    decodeText,
    filenameEncoding: encoding === 'auto' ? 'utf-8' : encoding,
    commentEncoding: encoding === 'auto' ? 'utf-8' : encoding,
  })

  try {
    const entries: Entry[] = await reader.getEntries({
      decodeText,
      filenameEncoding: encoding === 'auto' ? 'utf-8' : encoding,
    })

    const items: ZipItem[] = []
    let encryptedCount = 0
    let totalUncompressed = 0
    let totalCompressed = 0
    let junkCount = 0
    let idx = 0

    for (const entry of entries) {
      if (entry.directory) continue
      const fileEntry = entry as FileEntry
      const cleanPath = sanitizeZipPath(fileEntry.filename)
      if (!cleanPath) continue

      const slashIdx = cleanPath.lastIndexOf('/')
      const dir = slashIdx >= 0 ? cleanPath.slice(0, slashIdx) : ''
      const baseName = slashIdx >= 0 ? cleanPath.slice(slashIdx + 1) : cleanPath
      const { ext, kind, mime } = classifyFile(baseName)
      const isJunk = isSystemJunkPath(cleanPath)

      const uSize = fileEntry.uncompressedSize || 0
      const cSize = fileEntry.compressedSize || 0
      const ratio = uSize > 0 ? Math.max(0, Math.min(99, Math.round((1 - cSize / uSize) * 100))) : 0

      if (fileEntry.encrypted) encryptedCount++
      if (isJunk) junkCount++
      totalUncompressed += uSize
      totalCompressed += cSize

      items.push({
        id: `${idx++}-${cleanPath}`,
        entry: fileEntry,
        path: cleanPath,
        name: baseName,
        dir,
        ext,
        kind,
        mime,
        uncompressedSize: uSize,
        compressedSize: cSize,
        ratio,
        encrypted: Boolean(fileEntry.encrypted),
        lastModDate: fileEntry.lastModDate instanceof Date && !Number.isNaN(fileEntry.lastModDate.getTime()) ? fileEntry.lastModDate : null,
        crc32Hex: ((fileEntry.signature ?? 0) >>> 0).toString(16).toUpperCase().padStart(8, '0'),
        isSystemJunk: isJunk,
      })
    }

    // 读取压缩包全局注释（兼容不同版本字段）
    const rawComment = (reader as unknown as { comment?: Uint8Array }).comment
    let comment = ''
    if (rawComment && rawComment.length > 0) {
      comment = decodeText(rawComment) ?? new TextDecoder('utf-8').decode(rawComment)
    }

    return {
      name,
      archiveSize: sourceBlob.size,
      sourceBlob,
      reader,
      items,
      comment: comment.trim(),
      encryptedCount,
      totalUncompressed,
      totalCompressed,
      encoding,
      junkCount,
    }
  } catch (err) {
    await reader.close().catch(() => {})
    throw new Error(humanizeZipError(err))
  }
}

/** 安全关闭压缩包句柄 */
export async function closeZipArchive(archive: OpenedArchive | null): Promise<void> {
  if (!archive) return
  await archive.reader.close().catch(() => {})
}

/** 根据文件列表构建嵌套文件夹树 */
export function buildFolderTree(items: ZipItem[], rootName: string): FolderTreeNode {
  const root: FolderTreeNode = {
    path: '',
    name: rootName,
    fileCount: 0,
    totalSize: 0,
    children: [],
  }

  const nodeMap = new Map<string, FolderTreeNode>([['', root]])

  const ensureDir = (dirPath: string): FolderTreeNode => {
    const existing = nodeMap.get(dirPath)
    if (existing) return existing
    const parts = dirPath.split('/')
    let currentPath = ''
    let parent = root
    for (const seg of parts) {
      currentPath = currentPath ? `${currentPath}/${seg}` : seg
      let node = nodeMap.get(currentPath)
      if (!node) {
        node = { path: currentPath, name: seg, fileCount: 0, totalSize: 0, children: [] }
        nodeMap.set(currentPath, node)
        parent.children.push(node)
      }
      parent = node
    }
    return parent
  }

  for (const item of items) {
    root.fileCount++
    root.totalSize += item.uncompressedSize
    if (item.dir) {
      ensureDir(item.dir)
      const parts = item.dir.split('/')
      let acc = ''
      for (const seg of parts) {
        acc = acc ? `${acc}/${seg}` : seg
        const node = nodeMap.get(acc)!
        node.fileCount++
        node.totalSize += item.uncompressedSize
      }
    }
  }

  const sortTree = (node: FolderTreeNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
    node.children.forEach(sortTree)
  }
  sortTree(root)

  return root
}

// ============================================================================
// 密码校验、文件提取、流式解压到本地目录 & 选中项重打包
// ============================================================================

/** 快速校验压缩包密码（挑最小的非空加密文件尝试解密，避免大文件耗时） */
export async function verifyArchivePassword(items: ZipItem[], password: string): Promise<boolean> {
  const encrypted = items
    .filter((i) => i.encrypted)
    .sort((a, b) => a.uncompressedSize - b.uncompressedSize)
  if (encrypted.length === 0) return true

  const target = encrypted[0]
  try {
    // 若支持 checkPasswordOnly 则极速校验，否则解码首条最小加密文件
    await target.entry.getData(new Uint8ArrayWriter(), {
      password,
      checkPasswordOnly: true,
    } as Parameters<FileEntry['getData']>[1])
    return true
  } catch (err) {
    if (isPasswordError(err)) return false
    // 某些特殊加密方式可能不支持 checkPasswordOnly，尝试真正解压小文件兜底
    if (target.uncompressedSize <= 4 * 1024 * 1024) {
      try {
        await target.entry.getData(new Uint8ArrayWriter(), { password })
        return true
      } catch (err2) {
        if (isPasswordError(err2)) return false
        throw new Error(humanizeZipError(err2))
      }
    }
    throw new Error(humanizeZipError(err))
  }
}

/** 提取单个文件为 Blob */
export async function extractItemToBlob(
  item: ZipItem,
  password?: string,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  try {
    return await item.entry.getData(new BlobWriter(item.mime), {
      password: password || undefined,
      onprogress: (loaded, total) => {
        if (onProgress && total > 0) onProgress(Math.min(1, loaded / total))
      },
    })
  } catch (err) {
    throw new Error(humanizeZipError(err))
  }
}

/** 提取单个文件为文本（可指定字符集，默认自动 UTF-8/GBK，并限制超大文件预览上限） */
export async function extractItemToText(
  item: ZipItem,
  password?: string,
  encoding: 'auto' | 'utf-8' | 'gb18030' = 'auto',
  maxBytes = 2 * 1024 * 1024,
): Promise<{ text: string; truncated: boolean; detectedEncoding: string; rawBytes: Uint8Array }> {
  const blob = await extractItemToBlob(item, password)
  const truncated = blob.size > maxBytes
  const slice = truncated ? blob.slice(0, maxBytes) : blob
  const rawBytes = new Uint8Array(await slice.arrayBuffer())

  let detectedEncoding = 'UTF-8'
  let text: string
  if (encoding === 'gb18030') {
    detectedEncoding = 'GB18030'
    text = new TextDecoder('gb18030').decode(rawBytes)
  } else if (encoding === 'utf-8') {
    detectedEncoding = 'UTF-8'
    text = new TextDecoder('utf-8').decode(rawBytes)
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes)
      detectedEncoding = 'UTF-8'
    } catch {
      text = new TextDecoder('gb18030').decode(rawBytes)
      detectedEncoding = 'GB18030 / GBK'
    }
  }
  return { text, truncated, detectedEncoding, rawBytes }
}

/** 生成十六进制预览表（用于二进制文件检视） */
export function formatHexPreview(bytes: Uint8Array, limit = 256): string {
  const len = Math.min(bytes.length, limit)
  const lines: string[] = []
  for (let offset = 0; offset < len; offset += 16) {
    const addr = offset.toString(16).toUpperCase().padStart(4, '0')
    const hexParts: string[] = []
    let ascii = ''
    for (let i = 0; i < 16; i++) {
      if (offset + i < len) {
        const b = bytes[offset + i]
        hexParts.push(b.toString(16).toUpperCase().padStart(2, '0'))
        ascii += b >= 32 && b <= 126 ? String.fromCharCode(b) : '.'
      } else {
        hexParts.push('  ')
        ascii += ' '
      }
    }
    lines.push(`${addr}  ${hexParts.slice(0, 8).join(' ')}  ${hexParts.slice(8).join(' ')}  |${ascii}|`)
  }
  return lines.join('\n')
}

/** 判断当前浏览器是否支持 File System Access API（直接释放到本地文件夹） */
export function supportsDirectoryExtraction(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
}

export interface ExtractProgress {
  completedFiles: number
  totalFiles: number
  completedBytes: number
  totalBytes: number
  currentPath: string
}

/**
 * 流式解压一组文件到用户选择的本地文件夹（Chrome / Edge 原生保留目录结构，支持大文件低内存）
 */
export async function extractItemsToLocalDirectory(
  items: ZipItem[],
  options: {
    password?: string
    createSubfolderName?: string
    onProgress?: (p: ExtractProgress) => void
    signal?: AbortSignal
  } = {},
): Promise<{ extractedCount: number; folderName: string }> {
  const picker = (
    window as unknown as {
      showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
    }
  ).showDirectoryPicker
  if (!picker) {
    throw new Error('当前浏览器不支持直接写入本地文件夹，请使用「打包选中项」或单文件下载')
  }

  let rootDir = await picker({ mode: 'readwrite' })
  let folderName = rootDir.name

  if (options.createSubfolderName) {
    const safeSub = options.createSubfolderName.replace(/[\\/:*?"<>|]/g, '_').trim() || 'extracted'
    rootDir = await rootDir.getDirectoryHandle(safeSub, { create: true })
    folderName = `${folderName}/${safeSub}`
  }

  const totalFiles = items.length
  const totalBytes = items.reduce((sum, it) => sum + Math.max(1, it.uncompressedSize), 0)
  let completedBytes = 0
  let completedFiles = 0

  for (const item of items) {
    if (options.signal?.aborted) {
      throw new Error('已取消解压')
    }
    options.onProgress?.({
      completedFiles,
      totalFiles,
      completedBytes,
      totalBytes,
      currentPath: item.path,
    })

    const segments = item.path.split('/').filter(Boolean)
    if (segments.length === 0) continue

    let targetDir = rootDir
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i].replace(/[\\/:*?"<>|]/g, '_')
      targetDir = await targetDir.getDirectoryHandle(seg, { create: true })
    }

    const fileName = segments[segments.length - 1].replace(/[\\/:*?"<>|]/g, '_')
    const fileHandle = await targetDir.getFileHandle(fileName, { create: true })
    const writable = await fileHandle.createWritable()
    const baseBytes = completedBytes

    try {
      await item.entry.getData(writable as unknown as WritableStream, {
        password: options.password || undefined,
        onprogress: (loaded) => {
          options.onProgress?.({
            completedFiles,
            totalFiles,
            completedBytes: baseBytes + loaded,
            totalBytes,
            currentPath: item.path,
          })
        },
      })
    } catch (err) {
      await writable.abort().catch(() => {})
      throw new Error(`${item.name}：${humanizeZipError(err)}`)
    }

    completedBytes = baseBytes + Math.max(1, item.uncompressedSize)
    completedFiles++
    options.onProgress?.({
      completedFiles,
      totalFiles,
      completedBytes,
      totalBytes,
      currentPath: item.path,
    })
  }

  return { extractedCount: completedFiles, folderName }
}

/**
 * 将选中的文件重新打包为一个干净的 UTF-8 无密码 ZIP（兼容 Safari / Firefox 或部分提取转存）
 */
export async function repackSelectedItemsAsZip(
  items: ZipItem[],
  options: {
    password?: string
    onProgress?: (p: ExtractProgress) => void
    signal?: AbortSignal
  } = {},
): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  const totalFiles = items.length
  const totalBytes = items.reduce((sum, it) => sum + Math.max(1, it.uncompressedSize), 0)
  let completedBytes = 0
  let completedFiles = 0

  try {
    for (const item of items) {
      if (options.signal?.aborted) throw new Error('已取消打包')
      const baseBytes = completedBytes
      options.onProgress?.({
        completedFiles,
        totalFiles,
        completedBytes,
        totalBytes,
        currentPath: item.path,
      })

      const blob = await extractItemToBlob(item, options.password, (ratio) => {
        options.onProgress?.({
          completedFiles,
          totalFiles,
          completedBytes: baseBytes + Math.round(ratio * item.uncompressedSize),
          totalBytes,
          currentPath: item.path,
        })
      })
      await writer.add(item.path, new BlobReader(blob), { level: 5 })
      completedBytes = baseBytes + Math.max(1, item.uncompressedSize)
      completedFiles++
    }
    return await writer.close()
  } catch (err) {
    await writer.close().catch(() => {})
    throw err
  }
}

/** 格式化文件修改时间 */
export function formatDateTime(d: Date | null): string {
  if (!d) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
