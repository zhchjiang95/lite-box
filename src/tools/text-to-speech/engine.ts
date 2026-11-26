/** 文字转语音前端 API 封装、多角色剧本解析与格式化工具 */

export type TtsEngine = 'edge' | 'browser'
export type ScriptMode = 'single' | 'dialogue'
export type VoiceGroup = 'zh-cn' | 'zh-dialect' | 'intl'

export interface EdgeVoiceItem {
  id: string
  name: string
  aliases: string[]
  gender: 'female' | 'male'
  group: VoiceGroup
  locale: string
  styleTag: string
  sample: string
}

export interface TtsQuotaSnapshot {
  hasUnlockToken: boolean
  unlocked: boolean
  unlimited: boolean
  dailyFreeLimit: number
  usedToday: number
  remainingToday: number | null
  freeMaxChars: number
  maxChars: number
  effectiveMaxChars: number
}

export interface TtsServiceStatus extends TtsQuotaSnapshot {
  enabled: boolean
  available: boolean
  quotaDate?: string
  loadError: string | null
  installHint: string
}

export interface SubtitleCue {
  index: number
  startMs: number
  endMs: number
  text: string
  speaker?: string
}

export interface SynthesizeResponse {
  audioBase64: string
  mime: string
  byteLength: number
  durationMs: number
  chunkCount: number
  cues: SubtitleCue[]
  srt: string
  quota?: TtsQuotaSnapshot
}

export interface ParsedDialogueSegment {
  speakerLabel: string
  voiceId: string
  voiceName: string
  text: string
}

const TTS_TOKEN_KEY = 'litebox.tts.token'

export const DEMO_SINGLE_TEXT =
  '欢迎使用轻匣文字转语音与配音工作台。无需昂贵会员，也无需在本地下载庞大模型，即可将任意文章、短视频文案或学习资料合成为自然流畅的真人级 MP3 语音，并同步生成毫秒级对齐的 SRT 字幕文件。'

export const DEMO_DIALOGUE_NEWS = `[云扬] 各位听众朋友大家好，欢迎收听今天的轻匣科技早报。
[晓晓] 大家好，我是晓晓！今天我们要聊一个非常实用的效率技巧：如何在浏览器里零成本做出播客级双人对话配音。
[云希] 没错，只需要在每段台词前面加上方括号角色名，系统就会自动匹配对应的神经语音主播，还能一键导出带时间轴的字幕文件。
[晓晓] 听起来太方便了，拿来做短视频旁白或者有声书简直事半功倍！`

export const DEMO_DIALOGUE_STORY = `[晓伊] 你听说了吗？城东老图书馆的钟楼，昨晚十二点居然自己响了。
[云希] 别吓我，那座钟楼不是早就停摆十年了吗？
[小北] 哎呀妈呀，你们俩别瞎琢磨了，昨晚是我路过修表顺手给它上紧了发条！
[晓伊] 哈哈，原来虚惊一场，吓得我差点连夜写一篇悬疑小说！`

export function loadTtsToken(): string {
  try {
    return localStorage.getItem(TTS_TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function saveTtsToken(token: string) {
  try {
    const trimmed = token.trim()
    if (trimmed) localStorage.setItem(TTS_TOKEN_KEY, trimmed)
    else localStorage.removeItem(TTS_TOKEN_KEY)
  } catch {
    // 忽略
  }
}

async function requestJson<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (token.trim()) headers.set('X-TTS-Token', token.trim())
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let res: Response
  try {
    res = await fetch(url, { ...init, headers })
  } catch {
    throw new Error('无法连接到后端服务，可切换为「浏览器原生朗读」离线使用')
  }

  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`后端响应异常（HTTP ${res.status}）`)
  }

  if (!res.ok) {
    const msg =
      (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
        ? data.message
        : null) || `请求失败（HTTP ${res.status}）`
    throw new Error(msg)
  }
  return data as T
}

export function fetchTtsStatus(token: string) {
  return requestJson<TtsServiceStatus>('/api/tts/status', token)
}

export function verifyTtsToken(token: string) {
  return requestJson<{ ok: boolean; quota: TtsQuotaSnapshot }>('/api/tts/auth', token, {
    method: 'POST',
  })
}

export function fetchTtsVoices(token: string) {
  return requestJson<{ voices: EdgeVoiceItem[] }>('/api/tts/voices', token)
}

export function synthesizeSpeech(
  token: string,
  payload: {
    text?: string
    voice?: string
    rate?: number
    pitch?: number
    volume?: number
    quality?: '96k' | '48k'
    includeSpeakerInSrt?: boolean
    segments?: {
      text: string
      voice: string
      rate: number
      pitch: number
      volume: number
      speakerLabel: string
    }[]
  },
) {
  return requestJson<SynthesizeResponse>('/api/tts/synthesize', token, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function buildPreviewUrl(voiceId: string, token: string): string {
  const params = new URLSearchParams({ voice: voiceId })
  if (token.trim()) params.set('token', token.trim())
  return `/api/tts/preview?${params.toString()}`
}

/** 将后端返回的 Base64 MP3 转为标准 Blob */
export function base64ToBlob(base64: string, mime = 'audio/mpeg'): Blob {
  const bin = atob(base64)
  const len = bin.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = bin.charCodeAt(i)
  }
  return new Blob([bytes], { type: mime })
}

/**
 * 解析多角色对话剧本
 * 支持格式：[晓晓] 台词 / 【云希】台词 / 晓晓：台词 / 云希: 台词
 */
export function parseDialogueScript(
  rawText: string,
  voices: EdgeVoiceItem[],
  defaultVoiceId: string,
): ParsedDialogueSegment[] {
  const defaultVoice =
    voices.find((v) => v.id === defaultVoiceId) ??
    voices[0] ?? {
      id: defaultVoiceId || 'zh-CN-XiaoxiaoNeural',
      name: '默认主播',
      aliases: [],
    }

  const findVoiceByTag = (tag: string): EdgeVoiceItem | undefined => {
    const clean = tag.trim().toLowerCase()
    if (!clean) return undefined
    return voices.find(
      (v) =>
        v.id.toLowerCase() === clean ||
        v.name.toLowerCase() === clean ||
        v.name.toLowerCase().startsWith(clean) ||
        v.aliases.some((a) => a.toLowerCase() === clean),
    )
  }

  const lines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const segments: ParsedDialogueSegment[] = []
  let activeVoice = defaultVoice
  let activeLabel = defaultVoice.name

  const bracketRe = /^\s*(?:\[([^\]]{1,24})\]|【([^】]{1,24})】)\s*(.*)$/
  const colonRe = /^\s*([^\s:：，,。.!?！？]{1,10})\s*[:：]\s*(.+)$/

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    let matchedVoice: EdgeVoiceItem | undefined
    let speakerTag = ''
    let spoken = line

    const bm = line.match(bracketRe)
    if (bm) {
      speakerTag = (bm[1] || bm[2] || '').trim()
      spoken = (bm[3] || '').trim()
      matchedVoice = findVoiceByTag(speakerTag)
    } else {
      const cm = line.match(colonRe)
      if (cm) {
        const candidate = cm[1].trim()
        const hit = findVoiceByTag(candidate)
        if (hit) {
          speakerTag = candidate
          spoken = cm[2].trim()
          matchedVoice = hit
        }
      }
    }

    if (matchedVoice) {
      activeVoice = matchedVoice
      activeLabel = speakerTag || matchedVoice.name
    } else if (speakerTag) {
      // 用户写了未预设的自定义角色名，按稳定哈希从中文主力主播里分配一个固定音色
      const zhPool = voices.filter((v) => v.group === 'zh-cn')
      const pool = zhPool.length > 0 ? zhPool : voices
      let hash = 0
      for (let i = 0; i < speakerTag.length; i++) {
        hash = (hash * 31 + speakerTag.charCodeAt(i)) >>> 0
      }
      if (pool.length > 0) {
        activeVoice = pool[hash % pool.length]
      }
      activeLabel = speakerTag
    }

    if (!spoken) continue

    const prev = segments[segments.length - 1]
    if (prev && prev.voiceId === activeVoice.id && prev.speakerLabel === activeLabel) {
      prev.text = `${prev.text}\n${spoken}`
    } else {
      segments.push({
        speakerLabel: activeLabel,
        voiceId: activeVoice.id,
        voiceName: activeVoice.name,
        text: spoken,
      })
    }
  }

  return segments
}

/** 按句切分文本供浏览器原生朗读逐句高亮跟读 */
export function splitBrowserSentences(raw: string): string[] {
  const cleaned = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!cleaned) return []
  const parts = cleaned
    .split(/(?<=[。！？；!?;\n])/)
    .map((s) => s.trim())
    .filter(Boolean)
  return parts
}

export function formatDurationMs(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatCueTime(ms: number): string {
  const totalSec = Math.max(0, ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = Math.floor(totalSec % 60)
  const d = Math.floor((totalSec * 10) % 10)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`
}
