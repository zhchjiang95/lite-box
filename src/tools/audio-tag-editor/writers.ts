/**
 * 纯 TypeScript 零重编码音频标签无损写回引擎
 * - MP3：标准 ID3v2.3.0（UTF-16 LE + BOM 全字段 + USLT 歌词 + APIC 封面），原 MPEG 音频帧 100% 字节无损保留
 * - FLAC：重组 VORBIS_COMMENT + METADATA_BLOCK_PICTURE + PADDING，保留 STREAMINFO/SEEKTABLE 与原无损音频帧
 * - M4A / MP4：重写 moov/udta/meta/ilst 原子并同步修正 stco/co64 块偏移量（兼容 Fast-Start 快启与普通 M4A）
 */

import type { AudioContainerKind, EditableSongTags } from './types'

// ============================================================================
// 二进制字节工具
// ============================================================================

const utf8Encoder = new TextEncoder()

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

function asciiBytes(str: string): Uint8Array {
  const out = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) {
    out[i] = str.charCodeAt(i) & 0xff
  }
  return out
}

function utf8Bytes(str: string): Uint8Array {
  return utf8Encoder.encode(str)
}

/** 编码带 BOM 的 UTF-16LE（ID3v2.3 跨平台兼容性最好：Windows/macOS/车机/播放器全识别） */
function utf16LeWithBom(str: string): Uint8Array {
  const out = new Uint8Array(2 + str.length * 2)
  out[0] = 0xff
  out[1] = 0xfe
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    out[2 + i * 2] = code & 0xff
    out[3 + i * 2] = (code >> 8) & 0xff
  }
  return out
}

function u32BE(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff])
}

function u24BE(n: number): Uint8Array {
  return new Uint8Array([(n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff])
}

function u32LE(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff])
}

function readU32BE(buf: Uint8Array, pos: number): number {
  return ((buf[pos] << 24) | (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3]) >>> 0
}

function writeU32BEAt(buf: Uint8Array, pos: number, val: number) {
  buf[pos] = (val >>> 24) & 0xff
  buf[pos + 1] = (val >>> 16) & 0xff
  buf[pos + 2] = (val >>> 8) & 0xff
  buf[pos + 3] = val & 0xff
}

function encodeSynchsafe32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f])
}

function decodeSynchsafe32(buf: Uint8Array, pos: number): number {
  return (
    ((buf[pos] & 0x7f) << 21) |
    ((buf[pos + 1] & 0x7f) << 14) |
    ((buf[pos + 2] & 0x7f) << 7) |
    (buf[pos + 3] & 0x7f)
  )
}

/** 跳过文件开头可能存在的一个或多个 ID3v2 标签头，返回实际音频起始偏移 */
function skipLeadingId3v2(bytes: Uint8Array): number {
  let offset = 0
  while (
    offset + 10 <= bytes.length &&
    bytes[offset] === 0x49 &&
    bytes[offset + 1] === 0x44 &&
    bytes[offset + 2] === 0x33
  ) {
    const flags = bytes[offset + 5]
    const bodySize = decodeSynchsafe32(bytes, offset + 6)
    const footerSize = (flags & 0x10) !== 0 ? 10 : 0
    const next = offset + 10 + bodySize + footerSize
    if (next <= offset || next > bytes.length) break
    offset = next
  }
  return offset
}

/** 拼接音轨号/碟号字符串（如 "3/12" 或 "3"） */
function formatPair(num: string, total: string): string {
  const n = num.trim()
  const t = total.trim()
  if (!n) return ''
  return t ? `${n}/${t}` : n
}

// ============================================================================
// 1. MP3 无损 ID3v2.3 写回器
// ============================================================================

function makeId3v23Frame(frameId: string, payload: Uint8Array): Uint8Array {
  return concatBytes(asciiBytes(frameId), u32BE(payload.length), new Uint8Array([0, 0]), payload)
}

function makeId3TextFrame(frameId: string, value: string): Uint8Array | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  // encoding = 0x01 (UTF-16 with BOM)
  return makeId3v23Frame(frameId, concatBytes(new Uint8Array([0x01]), utf16LeWithBom(trimmed)))
}

function makeId3LangTextFrame(frameId: string, lang: string, value: string): Uint8Array | null {
  if (!value.trim()) return null
  // encoding=0x01 + 3字节语言码 + 空短描述(BOM + 0x00 0x00) + 正文(UTF-16LE with BOM)
  const payload = concatBytes(
    new Uint8Array([0x01]),
    asciiBytes(lang.slice(0, 3).padEnd(3, ' ')),
    new Uint8Array([0xff, 0xfe, 0x00, 0x00]),
    utf16LeWithBom(value),
  )
  return makeId3v23Frame(frameId, payload)
}

function makeId3ApicFrame(mime: string, imageBytes: Uint8Array): Uint8Array {
  const cleanMime = mime || 'image/jpeg'
  // encoding=0x00(Latin-1) + MIME + 0x00 + picType=0x03(Cover Front) + empty desc 0x00 + data
  const payload = concatBytes(
    new Uint8Array([0x00]),
    asciiBytes(cleanMime),
    new Uint8Array([0x00, 0x03, 0x00]),
    imageBytes,
  )
  return makeId3v23Frame('APIC', payload)
}

export function writeMp3Tags(rawBytes: Uint8Array, tags: EditableSongTags): Uint8Array {
  const audioStart = skipLeadingId3v2(rawBytes)
  // 若尾部带有旧 ID3v1（128 字节以 "TAG" 开头），一并剥离以防陈旧乱码覆盖
  let audioEnd = rawBytes.length
  if (
    audioEnd - audioStart >= 128 &&
    rawBytes[audioEnd - 128] === 0x54 &&
    rawBytes[audioEnd - 127] === 0x41 &&
    rawBytes[audioEnd - 126] === 0x47
  ) {
    audioEnd -= 128
  }
  const pureAudio = rawBytes.subarray(audioStart, audioEnd)

  const frames: Uint8Array[] = []
  const push = (f: Uint8Array | null) => {
    if (f) frames.push(f)
  }

  push(makeId3TextFrame('TIT2', tags.title))
  push(makeId3TextFrame('TPE1', tags.artist))
  push(makeId3TextFrame('TALB', tags.album))
  push(makeId3TextFrame('TPE2', tags.albumArtist))
  push(makeId3TextFrame('TYER', tags.year.slice(0, 4)))
  push(makeId3TextFrame('TRCK', formatPair(tags.track, tags.trackTotal)))
  push(makeId3TextFrame('TPOS', formatPair(tags.disc, tags.discTotal)))
  push(makeId3TextFrame('TCON', tags.genre))
  push(makeId3TextFrame('TCOM', tags.composer))
  push(makeId3LangTextFrame('COMM', 'eng', tags.comment))
  push(makeId3LangTextFrame('USLT', 'chi', tags.lyrics))

  if (tags.cover && tags.cover.data.length > 0) {
    frames.push(makeId3ApicFrame(tags.cover.mime, tags.cover.data))
  }

  // 预留少量 256 字节空白填充方便后续其他播放器快速原地编辑
  const padding = new Uint8Array(256)
  const tagBody = concatBytes(...frames, padding)
  const header = concatBytes(
    asciiBytes('ID3'),
    new Uint8Array([0x03, 0x00, 0x00]), // ID3v2.3.0, flags = 0
    encodeSynchsafe32(tagBody.length),
  )

  return concatBytes(header, tagBody, pureAudio)
}

// ============================================================================
// 2. FLAC 无损元数据块写回器
// ============================================================================

function buildFlacVorbisCommentPayload(tags: EditableSongTags): Uint8Array {
  const vendor = utf8Bytes('LiteBox AudioTagEditor')
  const comments: string[] = []
  const add = (key: string, val: string) => {
    const v = key === 'LYRICS' ? val.trimEnd() : val.trim()
    if (v) comments.push(`${key}=${v}`)
  }

  add('TITLE', tags.title)
  add('ARTIST', tags.artist)
  add('ALBUM', tags.album)
  add('ALBUMARTIST', tags.albumArtist)
  add('DATE', tags.year)
  add('TRACKNUMBER', tags.track)
  add('TRACKTOTAL', tags.trackTotal)
  add('DISCNUMBER', tags.disc)
  add('DISCTOTAL', tags.discTotal)
  add('GENRE', tags.genre)
  add('COMPOSER', tags.composer)
  add('COMMENT', tags.comment)
  add('LYRICS', tags.lyrics)

  const parts: Uint8Array[] = [u32LE(vendor.length), vendor, u32LE(comments.length)]
  for (const c of comments) {
    const b = utf8Bytes(c)
    parts.push(u32LE(b.length), b)
  }
  return concatBytes(...parts)
}

function buildFlacPicturePayload(
  mime: string,
  imageBytes: Uint8Array,
  width = 0,
  height = 0,
): Uint8Array {
  const mimeBuf = asciiBytes(mime || 'image/jpeg')
  return concatBytes(
    u32BE(3), // 3 = Cover (front)
    u32BE(mimeBuf.length),
    mimeBuf,
    u32BE(0), // description length = 0
    u32BE(width || 0),
    u32BE(height || 0),
    u32BE(24), // color depth
    u32BE(0), // indexed colors
    u32BE(imageBytes.length),
    imageBytes,
  )
}

function wrapFlacBlock(blockType: number, payload: Uint8Array, isLast: boolean): Uint8Array {
  if (payload.length > 0xffffff) {
    throw new Error('专辑封面体积超出 FLAC 元数据块 16MB 上限，请适当压缩封面图片')
  }
  const headByte = (isLast ? 0x80 : 0x00) | (blockType & 0x7f)
  return concatBytes(new Uint8Array([headByte]), u24BE(payload.length), payload)
}

export function writeFlacTags(rawBytes: Uint8Array, tags: EditableSongTags): Uint8Array {
  const start = skipLeadingId3v2(rawBytes)
  if (
    start + 4 > rawBytes.length ||
    rawBytes[start] !== 0x66 || // f
    rawBytes[start + 1] !== 0x4c || // L
    rawBytes[start + 2] !== 0x61 || // a
    rawBytes[start + 3] !== 0x43 // C
  ) {
    throw new Error('不是有效的 FLAC 音频文件（缺少 fLaC 文件头）')
  }

  let pos = start + 4
  const preservedBlocks: { type: number; data: Uint8Array }[] = []

  while (pos + 4 <= rawBytes.length) {
    const h = rawBytes[pos]
    const isLast = (h & 0x80) !== 0
    const blockType = h & 0x7f
    const len = (rawBytes[pos + 1] << 16) | (rawBytes[pos + 2] << 8) | rawBytes[pos + 3]
    pos += 4
    if (pos + len > rawBytes.length) {
      throw new Error('FLAC 元数据块长度损坏，无法安全写回')
    }
    const payload = rawBytes.subarray(pos, pos + len)
    pos += len

    // 保留 STREAMINFO(0)、APPLICATION(2)、SEEKTABLE(3)、CUESHEET(5)，替换 PADDING(1)/VORBIS(4)/PICTURE(6)
    if (blockType !== 1 && blockType !== 4 && blockType !== 6) {
      preservedBlocks.push({ type: blockType, data: payload })
    }
    if (isLast) break
  }

  const audioFrames = rawBytes.subarray(pos)

  // 确保 STREAMINFO(0) 排在最前面
  const streamInfo = preservedBlocks.filter((b) => b.type === 0)
  const others = preservedBlocks.filter((b) => b.type !== 0)
  const outBlocks: { type: number; data: Uint8Array }[] = [
    ...streamInfo,
    ...others,
    { type: 4, data: buildFlacVorbisCommentPayload(tags) },
  ]

  if (tags.cover && tags.cover.data.length > 0) {
    outBlocks.push({
      type: 6,
      data: buildFlacPicturePayload(tags.cover.mime, tags.cover.data, tags.cover.width, tags.cover.height),
    })
  }
  // 末尾附加轻量 PADDING 块
  outBlocks.push({ type: 1, data: new Uint8Array(512) })

  const wrapped = outBlocks.map((b, idx) => wrapFlacBlock(b.type, b.data, idx === outBlocks.length - 1))
  return concatBytes(asciiBytes('fLaC'), ...wrapped, audioFrames)
}

// ============================================================================
// 3. M4A / MP4 无损原子（Atom/Box）写回器（含 stco/co64 偏移修正）
// ============================================================================

interface Mp4Box {
  type: string
  start: number
  end: number
  headerSize: number
}

function readBoxType(buf: Uint8Array, pos: number): string {
  return String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3])
}

/** 遍历容器范围内的子 Box */
function parseBoxes(buf: Uint8Array, start: number, end: number): Mp4Box[] {
  const boxes: Mp4Box[] = []
  let pos = start
  while (pos + 8 <= end) {
    const size32 = readU32BE(buf, pos)
    const type = readBoxType(buf, pos + 4)
    let boxSize = size32
    let headerSize = 8

    if (size32 === 1) {
      if (pos + 16 > end) break
      const hi = readU32BE(buf, pos + 8)
      const lo = readU32BE(buf, pos + 12)
      boxSize = hi * 4294967296 + lo
      headerSize = 16
    } else if (size32 === 0) {
      boxSize = end - pos
    }

    if (boxSize < headerSize || pos + boxSize > end) break
    boxes.push({ type, start: pos, end: pos + boxSize, headerSize })
    pos += boxSize
  }
  return boxes
}

function makeMp4Box(type: string, ...payloads: Uint8Array[]): Uint8Array {
  let bodyLen = 0
  for (const p of payloads) bodyLen += p.length
  const totalSize = 8 + bodyLen
  const typeBytes = new Uint8Array(4)
  for (let i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i) & 0xff
  return concatBytes(u32BE(totalSize), typeBytes, ...payloads)
}

function makeIlstTextAtom(atomType: string, value: string): Uint8Array | null {
  const v = atomType === '\u00a9lyr' ? value.trimEnd() : value.trim()
  if (!v) return null
  // data atom: type=1 (UTF-8), locale=0
  const dataAtom = makeMp4Box('data', u32BE(1), u32BE(0), utf8Bytes(v))
  return makeMp4Box(atomType, dataAtom)
}

function makeIlstPairAtom(atomType: 'trkn' | 'disk', numStr: string, totalStr: string): Uint8Array | null {
  const num = Number.parseInt(numStr.trim(), 10)
  const total = Number.parseInt(totalStr.trim(), 10)
  if (!Number.isFinite(num) || num <= 0) return null
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0
  const payload = new Uint8Array(atomType === 'trkn' ? 8 : 6)
  payload[2] = (num >> 8) & 0xff
  payload[3] = num & 0xff
  payload[4] = (safeTotal >> 8) & 0xff
  payload[5] = safeTotal & 0xff
  const dataAtom = makeMp4Box('data', u32BE(0), u32BE(0), payload)
  return makeMp4Box(atomType, dataAtom)
}

function makeIlstCoverAtom(mime: string, imageBytes: Uint8Array): Uint8Array {
  // type 13 = JPEG, 14 = PNG
  const dataType = mime.toLowerCase().includes('png') ? 14 : 13
  const dataAtom = makeMp4Box('data', u32BE(dataType), u32BE(0), imageBytes)
  return makeMp4Box('covr', dataAtom)
}

function buildM4aMetaBox(tags: EditableSongTags): Uint8Array {
  // 标准 Apple iTunes hdlr box
  const hdlr = makeMp4Box(
    'hdlr',
    u32BE(0), // version & flags
    u32BE(0), // pre_defined
    asciiBytes('mdir'),
    asciiBytes('appl'),
    u32BE(0),
    u32BE(0),
    new Uint8Array([0]),
  )

  const atoms: Uint8Array[] = []
  const push = (a: Uint8Array | null) => {
    if (a) atoms.push(a)
  }

  push(makeIlstTextAtom('\u00a9nam', tags.title))
  push(makeIlstTextAtom('\u00a9ART', tags.artist))
  push(makeIlstTextAtom('\u00a9alb', tags.album))
  push(makeIlstTextAtom('aART', tags.albumArtist))
  push(makeIlstTextAtom('\u00a9day', tags.year))
  push(makeIlstPairAtom('trkn', tags.track, tags.trackTotal))
  push(makeIlstPairAtom('disk', tags.disc, tags.discTotal))
  push(makeIlstTextAtom('\u00a9gen', tags.genre))
  push(makeIlstTextAtom('\u00a9wrt', tags.composer))
  push(makeIlstTextAtom('\u00a9cmt', tags.comment))
  push(makeIlstTextAtom('\u00a9lyr', tags.lyrics))

  if (tags.cover && tags.cover.data.length > 0) {
    atoms.push(makeIlstCoverAtom(tags.cover.mime, tags.cover.data))
  }

  const ilst = makeMp4Box('ilst', ...atoms)
  // meta 是 FullBox，正文前有 4 字节 version/flags = 0
  return makeMp4Box('meta', u32BE(0), hdlr, ilst)
}

const MOOV_CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl'])

/** 当 moov 位于 mdat 之前且长度发生变化时，同步修正所有 stco / co64 偏移量 */
function patchChunkOffsetsInPlace(moovBytes: Uint8Array, delta: number, minOffsetToShift: number) {
  const walk = (start: number, end: number) => {
    const children = parseBoxes(moovBytes, start, end)
    for (const box of children) {
      if (MOOV_CONTAINERS.has(box.type)) {
        walk(box.start + box.headerSize, box.end)
      } else if (box.type === 'stco') {
        // FullBox: 4 bytes version/flags + 4 bytes entry_count + N * uint32
        const bodyStart = box.start + box.headerSize
        if (bodyStart + 8 > box.end) continue
        const count = readU32BE(moovBytes, bodyStart + 4)
        for (let i = 0; i < count; i++) {
          const p = bodyStart + 8 + i * 4
          if (p + 4 > box.end) break
          const oldOff = readU32BE(moovBytes, p)
          if (oldOff >= minOffsetToShift) {
            const nextOff = oldOff + delta
            if (nextOff < 0 || nextOff > 0xffffffff) {
              throw new Error('M4A 块偏移超出 32 位范围')
            }
            writeU32BEAt(moovBytes, p, nextOff)
          }
        }
      } else if (box.type === 'co64') {
        const bodyStart = box.start + box.headerSize
        if (bodyStart + 8 > box.end) continue
        const count = readU32BE(moovBytes, bodyStart + 4)
        const view = new DataView(moovBytes.buffer, moovBytes.byteOffset, moovBytes.byteLength)
        for (let i = 0; i < count; i++) {
          const p = bodyStart + 8 + i * 8
          if (p + 8 > box.end) break
          const oldOff = view.getBigUint64(p, false)
          if (oldOff >= BigInt(minOffsetToShift)) {
            view.setBigUint64(p, oldOff + BigInt(delta), false)
          }
        }
      }
    }
  }
  walk(8, moovBytes.length)
}

export function writeM4aTags(rawBytes: Uint8Array, tags: EditableSongTags): Uint8Array {
  const topBoxes = parseBoxes(rawBytes, 0, rawBytes.length)
  const moovBox = topBoxes.find((b) => b.type === 'moov')
  if (!moovBox) {
    throw new Error('不是有效的 M4A / MP4 音频文件（缺少 moov 原子）')
  }

  const mdatBoxes = topBoxes.filter((b) => b.type === 'mdat')
  const earliestMdatStart = mdatBoxes.length > 0 ? Math.min(...mdatBoxes.map((b) => b.start)) : -1

  // 解析 moov 内原子，替换或新建 udta -> meta
  const moovChildren = parseBoxes(rawBytes, moovBox.start + moovBox.headerSize, moovBox.end)
  const rebuiltMoovChildren: Uint8Array[] = []
  let preservedNonMetaUdta: Uint8Array[] = []

  for (const child of moovChildren) {
    if (child.type === 'udta') {
      const udtaChildren = parseBoxes(rawBytes, child.start + child.headerSize, child.end)
      preservedNonMetaUdta = udtaChildren
        .filter((u) => u.type !== 'meta')
        .map((u) => rawBytes.subarray(u.start, u.end))
    } else {
      rebuiltMoovChildren.push(rawBytes.subarray(child.start, child.end))
    }
  }

  const newUdta = makeMp4Box('udta', ...preservedNonMetaUdta, buildM4aMetaBox(tags))
  rebuiltMoovChildren.push(newUdta)

  const newMoov = makeMp4Box('moov', ...rebuiltMoovChildren)
  const delta = newMoov.length - (moovBox.end - moovBox.start)

  // 若 moov 在 mdat 之前，必须平移所有指向 mdat 区域的 stco / co64 偏移
  if (delta !== 0 && earliestMdatStart >= 0 && moovBox.start < earliestMdatStart) {
    patchChunkOffsetsInPlace(newMoov, delta, earliestMdatStart)
  }

  return concatBytes(
    rawBytes.subarray(0, moovBox.start),
    newMoov,
    rawBytes.subarray(moovBox.end),
  )
}

// ============================================================================
// 统一无损写回分发入口
// ============================================================================

export function writeAudioTagsLossless(
  formatKind: AudioContainerKind,
  rawBytes: Uint8Array,
  tags: EditableSongTags,
): { bytes: Uint8Array; mime: string } {
  if (formatKind === 'mp3') {
    return { bytes: writeMp3Tags(rawBytes, tags), mime: 'audio/mpeg' }
  }
  if (formatKind === 'flac') {
    return { bytes: writeFlacTags(rawBytes, tags), mime: 'audio/flac' }
  }
  if (formatKind === 'm4a') {
    return { bytes: writeM4aTags(rawBytes, tags), mime: 'audio/mp4' }
  }
  throw new Error(`当前格式（${formatKind.toUpperCase()}）仅支持解析查看，无损写回支持 MP3 / FLAC / M4A`)
}
