/**
 * 歌曲元数据解析、封面规范化、单曲无损导出与专辑 ZIP 批量导出引擎
 */

import { zipSync } from 'fflate'
import { parseBlob, selectCover, type IAudioMetadata } from 'music-metadata'
import { decodeImageFile } from '@/lib/image'
import { detectTagsMojibake, formatLrcTimestamp } from './lrc'
import type {
  AudioContainerKind,
  AudioTechInfo,
  CoverArtData,
  EditableSongTags,
  SongTrackItem,
} from './types'
import { writeAudioTagsLossless } from './writers'

/** 判断音频容器类型及是否支持零重编码无损写回 */
export function detectAudioContainer(file: File, metadata?: IAudioMetadata): AudioContainerKind {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const container = (metadata?.format.container || '').toLowerCase()
  const mime = file.type.toLowerCase()

  if (ext === 'mp3' || container.includes('mpeg') || mime === 'audio/mpeg') return 'mp3'
  if (ext === 'flac' || container.includes('flac') || mime.includes('flac')) return 'flac'
  if (
    ext === 'm4a' ||
    ext === 'mp4' ||
    ext === 'aac' ||
    container.includes('m4a') ||
    container.includes('mp4') ||
    container.includes('isom') ||
    container.includes('quicktime') ||
    mime.includes('mp4')
  ) {
    return 'm4a'
  }
  if (ext === 'ogg' || ext === 'oga' || ext === 'opus' || container.includes('ogg')) return 'ogg'
  if (ext === 'wav' || ext === 'wave' || container.includes('wave') || container.includes('riff')) return 'wav'
  return 'other'
}

/** 从 music-metadata 结果中提取完整歌词（优先 common.lyrics，并兼容 SYLT 同步歌词与原生标签兜底） */
function extractLyrics(metadata: IAudioMetadata): string {
  const list = metadata.common.lyrics
  if (list && list.length > 0) {
    for (const item of list) {
      if (item.syncText && item.syncText.length > 0) {
        const lines = item.syncText
          .filter((s) => s.text !== undefined)
          .map((s) => {
            const ts = typeof s.timestamp === 'number' ? formatLrcTimestamp(s.timestamp / 1000) : ''
            return `${ts}${s.text}`
          })
        if (lines.length > 0) return lines.join('\n')
      }
      if (item.text && item.text.trim()) {
        return item.text.trim()
      }
    }
  }

  // 兜底检查原生标签（兼容非标 LYRICS / UNSYNCEDLYRICS / ©lyr / USLT）
  const native = metadata.native
  if (native) {
    for (const tags of Object.values(native)) {
      for (const tag of tags) {
        const id = tag.id.toUpperCase()
        if (
          id === 'LYRICS' ||
          id === 'UNSYNCEDLYRICS' ||
          id === 'USLT' ||
          id === '©LYR' ||
          id === '\u00A9LYR'
        ) {
          if (typeof tag.value === 'string' && tag.value.trim()) {
            return tag.value.trim()
          }
          if (
            tag.value &&
            typeof tag.value === 'object' &&
            'text' in tag.value &&
            typeof (tag.value as { text?: unknown }).text === 'string'
          ) {
            const t = (tag.value as { text: string }).text.trim()
            if (t) return t
          }
        }
      }
    }
  }

  return ''
}

/** 提取注释文本 */
function extractComment(metadata: IAudioMetadata): string {
  const comments = metadata.common.comments
  if (!comments || comments.length === 0) return ''
  for (const c of comments) {
    if (c.text && c.text.trim()) return c.text.trim()
  }
  return ''
}

/** 读取图片字节的宽高（用于展示封面像素尺寸） */
async function probeImageDimensions(blob: Blob): Promise<{ width?: number; height?: number }> {
  try {
    const bmp = await createImageBitmap(blob)
    const width = bmp.width
    const height = bmp.height
    bmp.close()
    return { width, height }
  } catch {
    return {}
  }
}

/** 浅克隆标签对象（共享封面引用） */
export function cloneTags(tags: EditableSongTags): EditableSongTags {
  return {
    ...tags,
    cover: tags.cover ? { ...tags.cover } : null,
  }
}

/** 解析单个本地音频文件为队列歌曲对象 */
export async function parseAudioFileToTrack(file: File): Promise<SongTrackItem> {
  const metadata = await parseBlob(file)
  const formatKind = detectAudioContainer(file, metadata)
  const writable = formatKind === 'mp3' || formatKind === 'flac' || formatKind === 'm4a'

  const common = metadata.common
  const fmt = metadata.format

  // 提取内嵌专辑封面
  let cover: CoverArtData | null = null
  const pic = selectCover(common.picture)
  if (pic && pic.data && pic.data.length > 0) {
    const mime = pic.format && pic.format.includes('/') ? pic.format : 'image/jpeg'
    const copied = new Uint8Array(pic.data)
    const blob = new Blob([copied], { type: mime })
    const dims = await probeImageDimensions(blob)
    cover = {
      mime,
      data: copied,
      width: dims.width,
      height: dims.height,
      previewUrl: URL.createObjectURL(blob),
    }
  }

  const yearStr = common.year
    ? String(common.year)
    : common.date
      ? String(common.date).slice(0, 4)
      : ''

  const tags: EditableSongTags = {
    title: common.title?.trim() || '',
    artist: common.artist?.trim() || (common.artists?.join(' / ') ?? ''),
    album: common.album?.trim() || '',
    albumArtist: common.albumArtist?.trim() || '',
    year: yearStr,
    track: common.trackNumber ? String(common.trackNumber) : '',
    trackTotal: common.trackTotal ? String(common.trackTotal) : '',
    disc: common.discNumber ? String(common.discNumber) : '',
    discTotal: common.discTotal ? String(common.discTotal) : '',
    genre: common.genres?.join(', ') || '',
    composer: common.composers?.join(', ') || '',
    comment: extractComment(metadata),
    lyrics: extractLyrics(metadata),
    cover,
  }

  const tech: AudioTechInfo = {
    container: fmt.container || formatKind.toUpperCase(),
    codec: fmt.codec || fmt.codecProfile || '未知编码',
    durationSec: fmt.duration || 0,
    bitrateKbps: fmt.bitrate ? Math.round(fmt.bitrate / 1000) : 0,
    sampleRateHz: fmt.sampleRate || 0,
    bitsPerSample: fmt.bitsPerSample ?? null,
    channels: fmt.numberOfChannels || 0,
    lossless: Boolean(fmt.lossless),
    tagTypes: fmt.tagTypes ?? [],
  }

  return {
    id: `song-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    filename: file.name,
    size: file.size,
    formatKind,
    writable,
    audioUrl: URL.createObjectURL(file),
    tech,
    originalTags: cloneTags(tags),
    tags,
    dirty: false,
    hasMojibake: detectTagsMojibake(tags),
  }
}

/** 将用户拖入或粘贴的图片规范化为适合嵌入歌曲的专辑封面（支持 HEIC / PNG / JPG / WebP） */
export async function prepareCoverImageFromFile(file: File, maxEdge = 1200): Promise<CoverArtData> {
  const decoded = await decodeImageFile(file)
  try {
    const scale = Math.min(1, maxEdge / Math.max(1, decoded.width, decoded.height))
    const w = Math.max(1, Math.round(decoded.width * scale))
    const h = Math.max(1, Math.round(decoded.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(decoded.bitmap, 0, 0, w, h)

    // 统一导出高画质 JPEG（0.92），兼容性最佳且显著降低 MP3/FLAC 体积膨胀
    const jpegBlob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('封面编码失败'))), 'image/jpeg', 0.92),
    )
    const data = new Uint8Array(await jpegBlob.arrayBuffer())
    return {
      mime: 'image/jpeg',
      data,
      width: w,
      height: h,
      previewUrl: URL.createObjectURL(jpegBlob),
    }
  } finally {
    decoded.bitmap.close()
    URL.revokeObjectURL(decoded.previewUrl)
  }
}

/** 无损写回单首歌曲标签并返回可下载 Blob */
export async function exportEditedSongBlob(track: SongTrackItem): Promise<Blob> {
  const rawBytes = new Uint8Array(await track.file.arrayBuffer())
  const { bytes, mime } = writeAudioTagsLossless(track.formatKind, rawBytes, track.tags)
  return new Blob([new Uint8Array(bytes)], { type: mime })
}

/** 将多首可写回的歌曲批量无损写回并零级存储打包为 ZIP */
export async function exportBatchSongsZip(
  tracks: SongTrackItem[],
  onProgress?: (done: number, total: number, currentName: string) => void,
): Promise<Blob> {
  const files: Record<string, Uint8Array> = {}
  const usedNames = new Set<string>()
  const total = tracks.length

  for (let i = 0; i < total; i++) {
    const t = tracks[i]
    onProgress?.(i, total, t.filename)
    const raw = new Uint8Array(await t.file.arrayBuffer())
    const outBytes = t.writable ? writeAudioTagsLossless(t.formatKind, raw, t.tags).bytes : raw

    let outName = t.filename
    let seq = 2
    while (usedNames.has(outName)) {
      const dot = t.filename.lastIndexOf('.')
      outName =
        dot > 0
          ? `${t.filename.slice(0, dot)} (${seq++})${t.filename.slice(dot)}`
          : `${t.filename} (${seq++})`
    }
    usedNames.add(outName)
    files[outName] = outBytes
    await new Promise((r) => setTimeout(r, 0))
  }

  onProgress?.(total, total, '正在封装 ZIP...')
  const zipped = zipSync(files, { level: 0 })
  return new Blob([new Uint8Array(zipped)], { type: 'application/zip' })
}

/** 格式化歌曲时长 mm:ss */
export function formatSongDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '--:--'
  const total = Math.floor(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
