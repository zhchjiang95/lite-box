/**
 * 歌曲信息解析与标签编辑器核心类型定义
 */

/** 支持的音频格式分类 */
export type AudioContainerKind = 'mp3' | 'flac' | 'm4a' | 'ogg' | 'wav' | 'other'

/** 内嵌专辑封面数据 */
export interface CoverArtData {
  mime: string
  data: Uint8Array
  width?: number
  height?: number
  /** 用于 UI 展示的临时 ObjectURL */
  previewUrl: string
}

/** 可编辑的标准歌曲标签模型 */
export interface EditableSongTags {
  title: string
  artist: string
  album: string
  albumArtist: string
  year: string
  track: string
  trackTotal: string
  disc: string
  discTotal: string
  genre: string
  composer: string
  comment: string
  lyrics: string
  cover: CoverArtData | null
}

/** 音频底层技术规格（只读展示） */
export interface AudioTechInfo {
  container: string
  codec: string
  durationSec: number
  bitrateKbps: number
  sampleRateHz: number
  bitsPerSample: number | null
  channels: number
  lossless: boolean
  tagTypes: string[]
}

/** 队列中的单首歌曲对象 */
export interface SongTrackItem {
  id: string
  file: File
  filename: string
  size: number
  formatKind: AudioContainerKind
  /** 是否支持零重编码无损写回（MP3 / FLAC / M4A） */
  writable: boolean
  /** 用于内置试听的音频 ObjectURL */
  audioUrl: string
  /** 音频技术参数 */
  tech: AudioTechInfo
  /** 原始解析的标签（用于判断是否有改动或撤销重置） */
  originalTags: EditableSongTags
  /** 当前编辑中的标签 */
  tags: EditableSongTags
  /** 是否已修改 */
  dirty: boolean
  /** 是否检测到疑似老旧 GBK 乱码标签 */
  hasMojibake: boolean
}

/** 常见流派快捷建议 */
export const GENRE_SUGGESTIONS = [
  '流行 Pop',
  '华语流行 Mandopop',
  '粤语流行 Cantopop',
  '摇滚 Rock',
  '民谣 Folk',
  '说唱 Hip-Hop',
  '电子 Electronic',
  '节奏布鲁斯 R&B',
  '爵士 Jazz',
  '古典 Classical',
  '轻音乐 Easy Listening',
  '影视原声 Soundtrack',
  'ACG / 动漫',
  '古风 / 国风',
]

/** 批量编辑专辑信息草稿 */
export interface BatchEditDraft {
  applyArtist: boolean
  artist: string
  applyAlbum: boolean
  album: string
  applyAlbumArtist: boolean
  albumArtist: string
  applyYear: boolean
  year: string
  applyGenre: boolean
  genre: string
  applyCover: boolean
  cover: CoverArtData | null
  clearCover: boolean
}
