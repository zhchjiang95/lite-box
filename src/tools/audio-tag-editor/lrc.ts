/**
 * LRC 同步歌词解析、格式化与老歌 GBK 标签乱码修复工具
 */

import type { EditableSongTags } from './types'

export interface LrcLine {
  /** 时间戳（秒） */
  timeSec: number
  /** 歌词正文（相同时间戳的双语翻译会合并为两行显示） */
  text: string
  /** 次行翻译（可选） */
  translation?: string
}

/** 将秒数格式化为标准 LRC 时间标签 [mm:ss.xx] */
export function formatLrcTimestamp(sec: number): string {
  const safe = Math.max(0, sec)
  const mins = Math.floor(safe / 60)
  const rem = safe - mins * 60
  const whole = Math.floor(rem)
  const hundredths = Math.floor((rem - whole) * 100)
  return `[${String(mins).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}]`
}

/**
 * 解析文本中的 LRC 时间轴歌词
 * - 支持多时间戳同句（如 [00:12.30][01:45.10]副歌）
 * - 支持 2 位/3 位毫秒（.xx / .xxx / :xx）
 * - 自动合并同一时间点的双语译文
 */
export function parseLrcLyrics(raw: string): LrcLine[] {
  if (!raw || !raw.trim()) return []
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const tagRe = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g
  const entries: { timeSec: number; text: string }[] = []

  for (const line of lines) {
    tagRe.lastIndex = 0
    const times: number[] = []
    let match: RegExpExecArray | null
    while ((match = tagRe.exec(line)) !== null) {
      const m = Number(match[1])
      const s = Number(match[2])
      const fracRaw = match[3] || '0'
      const frac =
        fracRaw.length === 1
          ? Number(fracRaw) / 10
          : fracRaw.length === 2
            ? Number(fracRaw) / 100
            : Number(fracRaw) / 1000
      times.push(m * 60 + s + frac)
    }
    if (times.length === 0) continue
    const text = line.replace(tagRe, '').trim()
    for (const t of times) {
      entries.push({ timeSec: t, text })
    }
  }

  if (entries.length === 0) return []
  entries.sort((a, b) => a.timeSec - b.timeSec)

  // 合并相同时间戳的双语歌词行
  const merged: LrcLine[] = []
  for (const item of entries) {
    const prev = merged[merged.length - 1]
    if (prev && Math.abs(prev.timeSec - item.timeSec) < 0.02) {
      if (item.text && item.text !== prev.text) {
        prev.translation = prev.translation ? `${prev.translation} ${item.text}` : item.text
      }
    } else {
      merged.push({ timeSec: item.timeSec, text: item.text || '♪' })
    }
  }
  return merged
}

/** 二分查找当前播放时间对应的高亮歌词索引 */
export function findActiveLrcIndex(lines: LrcLine[], currentTimeSec: number): number {
  if (lines.length === 0) return -1
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].timeSec <= currentTimeSec + 0.08) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

// ============================================================================
// 老旧 MP3 中文 GBK 乱码智能检测与一键修复
// ============================================================================

const CJK_RE = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/
const LATIN1_EXT_RE = /[\u0080-\u00ff]/

/** 判断单段文本是否疑似将 GBK 字节误解码为 ISO-8859-1（如 "ÖÜ½ÜÂ×"） */
export function isLikelyGbkMojibake(str: string): boolean {
  if (!str || !LATIN1_EXT_RE.test(str)) return false
  // 若已包含正常汉字/日韩文且几乎没有连续 Latin-1 扩展符，则不是纯 Latin-1 误解码
  if (CJK_RE.test(str)) return false
  let extCount = 0
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code > 0xff) return false
    if (code >= 0x80) extCount++
  }
  if (extCount < 2) return false
  const repaired = repairGbkMojibake(str)
  return repaired !== str && CJK_RE.test(repaired)
}

/** 将被误作 ISO-8859-1 解码的原始 GBK 字节重新按 GB18030 解码回正常中文 */
export function repairGbkMojibake(str: string): string {
  if (!str || !LATIN1_EXT_RE.test(str)) return str
  const bytes = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code > 0xff) return str
    bytes[i] = code
  }
  try {
    const decoded = new TextDecoder('gb18030').decode(bytes)
    // 只有解码后产生有效汉字/标点且无大量替换符时才采纳
    const badCount = (decoded.match(/\uFFFD/g) ?? []).length
    if (badCount > Math.max(1, decoded.length * 0.15)) return str
    return decoded
  } catch {
    return str
  }
}

/** 检测整首歌曲标签中是否存在疑似 GBK 乱码字段 */
export function detectTagsMojibake(tags: EditableSongTags): boolean {
  const fields = [
    tags.title,
    tags.artist,
    tags.album,
    tags.albumArtist,
    tags.genre,
    tags.composer,
    tags.comment,
    tags.lyrics,
  ]
  return fields.some((f) => isLikelyGbkMojibake(f))
}

/** 对整首歌曲所有文本标签执行一键 GBK → Unicode 修复 */
export function repairTagsMojibake(tags: EditableSongTags): EditableSongTags {
  const fix = (s: string) => (isLikelyGbkMojibake(s) ? repairGbkMojibake(s) : s)
  return {
    ...tags,
    title: fix(tags.title),
    artist: fix(tags.artist),
    album: fix(tags.album),
    albumArtist: fix(tags.albumArtist),
    genre: fix(tags.genre),
    composer: fix(tags.composer),
    comment: fix(tags.comment),
    lyrics: fix(tags.lyrics),
  }
}
