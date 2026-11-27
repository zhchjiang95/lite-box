/**
 * 直播源协议识别、IPTV 频道列表解析（M3U / M3U8 / TXT）、字幕转换与内置测试源
 */

/** 支持的播放协议 */
export type StreamProtocol = 'auto' | 'hls' | 'flv' | 'mpegts' | 'native'

/** 解析后的频道 / 视频源条目 */
export interface ChannelItem {
  id: string
  name: string
  url: string
  group: string
  logo?: string
  referer?: string
  userAgent?: string
  protocol?: StreamProtocol
  /** 是否推荐直播模式 */
  isLive?: boolean
}

/** 播放历史记录 */
export interface PlayHistoryItem {
  url: string
  name: string
  protocol: StreamProtocol
  useProxy: boolean
  referer?: string
  playedAt: number
}

/** 内置高可用公开测试流（用于快速验证 HLS 自适应清晰度与原生 MP4 播放） */
export const SAMPLE_STREAMS: ChannelItem[] = [
  {
    id: 'sample-mux-hls',
    name: 'Mux 1080p 测试流（HLS 多码率）',
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    group: '内置测试源',
    protocol: 'hls',
    isLive: false,
  },
  {
    id: 'sample-apple-hls',
    name: 'Apple BipBop（HLS 自适应清晰度）',
    url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
    group: '内置测试源',
    protocol: 'hls',
    isLive: false,
  },
  {
    id: 'sample-bbb-mp4',
    name: 'Big Buck Bunny 预告片（MP4 直连）',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    group: '内置测试源',
    protocol: 'native',
    isLive: false,
  },
]

/** 根据地址后缀与查询串智能推断流媒体协议 */
export function detectStreamProtocol(rawUrl: string, override: StreamProtocol = 'auto'): Exclude<StreamProtocol, 'auto'> {
  if (override !== 'auto') return override
  const s = rawUrl.trim().toLowerCase()
  if (!s) return 'native'
  if (s.startsWith('blob:')) return 'native'

  let pathname = s
  let search = ''
  try {
    const u = new URL(rawUrl.trim())
    pathname = u.pathname.toLowerCase()
    search = u.search.toLowerCase()
  } catch {
    // 相对路径或非标准地址继续按字符串特征识别
  }

  if (
    pathname.endsWith('.m3u8') ||
    pathname.includes('.m3u8') ||
    search.includes('.m3u8') ||
    search.includes('format=hls') ||
    search.includes('type=m3u8')
  ) {
    return 'hls'
  }
  if (
    pathname.endsWith('.flv') ||
    pathname.includes('.flv') ||
    search.includes('.flv') ||
    search.includes('format=flv')
  ) {
    return 'flv'
  }
  if (pathname.endsWith('.ts') || pathname.endsWith('.m2ts')) {
    return 'mpegts'
  }
  return 'native'
}

/** 协议中文徽章文案 */
export function protocolLabel(proto: Exclude<StreamProtocol, 'auto'>): string {
  switch (proto) {
    case 'hls':
      return 'HLS (.m3u8)'
    case 'flv':
      return 'HTTP-FLV'
    case 'mpegts':
      return 'MPEG-TS'
    default:
      return '原生直连'
  }
}

/** 提取 M3U #EXTINF 标签中的属性值，例如 group-title="..." */
function readExtInfAttr(line: string, key: string): string | undefined {
  const re = new RegExp(`${key}\\s*=\\s*"([^"]*)"`, 'i')
  const m = line.match(re)
  return m?.[1]?.trim() || undefined
}

/** 从 URL 推测默认标题 */
export function guessNameFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const seg = u.pathname.split('/').filter(Boolean).pop()
    if (seg) return decodeURIComponent(seg).slice(0, 48)
    return u.hostname
  } catch {
    return url.slice(0, 40) || '未命名视频'
  }
}

/**
 * 解析 IPTV / 播放列表文本，同时兼容三种常见格式：
 * 1. 标准 M3U / M3U8（#EXTINF:-1 tvg-logo="..." group-title="...",频道名 + URL，兼容 #EXTVLCOPT）
 * 2. 国内流行 TXT 分组格式（分组名,#genre# + 频道名,http://...）
 * 3. 纯地址列表（每行一个 http(s)://...）
 */
export function parsePlaylistText(rawText: string, defaultGroup = '导入频道'): ChannelItem[] {
  const lines = rawText.replace(/^\uFEFF/, '').split(/\r?\n/)
  const channels: ChannelItem[] = []
  const seenUrls = new Set<string>()

  let currentGroup = defaultGroup
  let pendingName = ''
  let pendingGroup = ''
  let pendingLogo: string | undefined
  let pendingReferer: string | undefined
  let pendingUa: string | undefined

  const pushChannel = (item: Omit<ChannelItem, 'id'>) => {
    const cleanUrl = item.url.trim()
    if (!/^https?:\/\//i.test(cleanUrl)) return
    const key = `${item.name}__${cleanUrl}`
    if (seenUrls.has(key)) return
    seenUrls.add(key)
    channels.push({
      ...item,
      url: cleanUrl,
      id: `ch-${channels.length + 1}-${Math.abs(hashStr(key)).toString(36)}`,
    })
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    // 1. M3U 扩展属性行
    if (line.startsWith('#EXTINF')) {
      const commaIdx = line.lastIndexOf(',')
      pendingName = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : ''
      pendingGroup = readExtInfAttr(line, 'group-title') || ''
      pendingLogo = readExtInfAttr(line, 'tvg-logo')
      continue
    }

    if (line.startsWith('#EXTGRP:')) {
      pendingGroup = line.slice(8).trim()
      continue
    }

    if (line.startsWith('#EXTVLCOPT:')) {
      const opt = line.slice(11).trim()
      if (opt.toLowerCase().startsWith('http-referrer=')) {
        pendingReferer = opt.slice(14).trim()
      } else if (opt.toLowerCase().startsWith('http-user-agent=')) {
        pendingUa = opt.slice(16).trim()
      }
      continue
    }

    if (line.startsWith('#')) continue

    // 2. TXT 格式分组头：例如「央视频道,#genre#」
    if (line.includes(',#genre#')) {
      const g = line.split(',#genre#')[0].trim()
      if (g) currentGroup = g
      continue
    }

    // 3. TXT 格式「频道名,http://...」（兼容多个 # 分隔备用源）
    const commaHttpIdx = line.search(/,\s*https?:\/\//i)
    if (commaHttpIdx > 0) {
      const name = line.slice(0, commaHttpIdx).trim()
      const urlPart = line.slice(commaHttpIdx + 1).trim()
      const subUrls = urlPart.split('#').map((s) => s.trim()).filter(Boolean)
      subUrls.forEach((u, idx) => {
        pushChannel({
          name: subUrls.length > 1 ? `${name} (线路${idx + 1})` : name,
          url: u,
          group: currentGroup,
          isLive: true,
        })
      })
      continue
    }

    // 4. 独立 URL 行（紧跟 #EXTINF 或纯 URL 列表）
    if (/^https?:\/\//i.test(line)) {
      pushChannel({
        name: pendingName || guessNameFromUrl(line),
        url: line,
        group: pendingGroup || currentGroup,
        logo: pendingLogo,
        referer: pendingReferer,
        userAgent: pendingUa,
        isLive: true,
      })
      pendingName = ''
      pendingGroup = ''
      pendingLogo = undefined
      pendingReferer = undefined
      pendingUa = undefined
    }
  }

  return channels
}

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h | 0
}

/** 将 .srt 字幕文本转换为浏览器 <track> 原生支持的 WebVTT */
export function convertSrtToVtt(rawText: string): string {
  const cleaned = rawText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (cleaned.startsWith('WEBVTT')) return cleaned
  const converted = cleaned
    // 将 00:01:02,345 --> 00:01:05,678 转为点号毫秒格式
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  return `WEBVTT\n\n${converted}\n`
}

/** 构造外置播放器唤起链接（遇浏览器不支持的编码如 HEVC/AC3 或无 CORS 源时一键移交） */
export function buildExternalPlayerUrls(streamUrl: string) {
  const encoded = encodeURIComponent(streamUrl)
  return {
    potplayer: `potplayer://${streamUrl}`,
    vlc: `vlc://${streamUrl}`,
    iina: `iina://weblink?url=${encoded}`,
  }
}
