/**
 * 文字转语音（Edge Neural TTS）后端合成路由模块
 *
 * 核心特性：
 * - 按需动态加载可选依赖 msedge-tts（未安装时优雅降级，不影响主服务零依赖运行）
 * - 纯内存流合成与无缝拼接，零磁盘文件占用
 * - 支持单人长文本按标点智能切片合成 & 多角色对话分镜配音
 * - 逐帧解析 MPEG-2 Layer 3 MP3 时长，实现多段拼接 0 毫秒累积漂移的精准 SRT/WebVTT 字幕生成
 * - 内置 24 小时样音试听缓存与可选口令保护（server/config.json -> tts.token）
 */

import crypto from 'node:crypto'
import { sharedCache } from '../lib/cache.mjs'
import { serverConfig } from '../lib/config.mjs'
import { sendJson, setSecurityHeaders } from '../lib/http.mjs'
import { extractClientIp } from '../lib/logger.mjs'
import { createDailyQuotaStore } from '../lib/quota.mjs'

const {
  enabled: ENABLE_TTS,
  token: TTS_TOKEN,
  dailyFreeLimit: TTS_DAILY_FREE_LIMIT,
  freeMaxChars: TTS_FREE_MAX_CHARS,
  maxChars: TTS_MAX_CHARS,
} = serverConfig.tts

const quotaStore = createDailyQuotaStore({
  dir: serverConfig.logging.dir,
  retentionDays: serverConfig.logging.retentionDays,
})

const MAX_BODY_BYTES = 1024 * 1024 // 1MB 请求体上限
const CHUNK_CHAR_LIMIT = 380 // 每片安全长度，避免单次 WebSocket 合成超时

/** 精选高拟真微软神经语音主播目录（含中文角色别名，支持 [晓晓] 剧本语法） */
export const CURATED_VOICES = [
  // 中文普通话
  {
    id: 'zh-CN-XiaoxiaoNeural',
    name: '晓晓',
    aliases: ['晓晓', 'xiaoxiao', '女声', '旁白'],
    gender: 'female',
    group: 'zh-cn',
    locale: 'zh-CN',
    styleTag: '温暖自然 · 通用首选',
    sample: '你好，我是晓晓，适合有声阅读、知识讲解与日常配音。',
  },
  {
    id: 'zh-CN-YunxiNeural',
    name: '云希',
    aliases: ['云希', 'yunxi', '男声', '少年'],
    gender: 'male',
    group: 'zh-cn',
    locale: 'zh-CN',
    styleTag: '阳光清朗 · 故事解说',
    sample: '你好，我是云希，声音清朗有感染力，适合短视频解说与故事旁白。',
  },
  {
    id: 'zh-CN-YunyangNeural',
    name: '云扬',
    aliases: ['云扬', 'yunyang', '新闻', '播音'],
    gender: 'male',
    group: 'zh-cn',
    locale: 'zh-CN',
    styleTag: '专业沉稳 · 新闻播报',
    sample: '各位观众大家好，我是云扬，为您带来专业沉稳的新闻与资讯播报。',
  },
  {
    id: 'zh-CN-XiaoyiNeural',
    name: '晓伊',
    aliases: ['晓伊', 'xiaoyi', '温柔'],
    gender: 'female',
    group: 'zh-cn',
    locale: 'zh-CN',
    styleTag: '活泼灵动 · 情感对话',
    sample: '嗨，我是晓伊，声音轻快活泼，很适合做互动对话与生活分享哦。',
  },
  {
    id: 'zh-CN-YunjianNeural',
    name: '云健',
    aliases: ['云健', 'yunjian', '解说', '热血'],
    gender: 'male',
    group: 'zh-cn',
    locale: 'zh-CN',
    styleTag: '浑厚有力 · 影视体育',
    sample: '欢迎来到现场，我是云健，浑厚有力的声线最适合影视与赛事解说！',
  },
  {
    id: 'zh-CN-YunxiaNeural',
    name: '云夏',
    aliases: ['云夏', 'yunxia', '童声'],
    gender: 'male',
    group: 'zh-cn',
    locale: 'zh-CN',
    styleTag: '清脆可爱 · 动漫童声',
    sample: '哈喽大家好，我是云夏，最喜欢讲有趣的童话和科普小故事啦！',
  },

  // 特色方言与港台
  {
    id: 'zh-CN-liaoning-XiaobeiNeural',
    name: '小北（东北话）',
    aliases: ['小北', '东北小北', '东北话'],
    gender: 'female',
    group: 'zh-dialect',
    locale: 'zh-CN-liaoning',
    styleTag: '爽朗幽默 · 东北口音',
    sample: '老铁们好啊，我是东北小北，嘎嘎地道，听我给你唠唠嗑！',
  },
  {
    id: 'zh-CN-shaanxi-XiaoniNeural',
    name: '小妮（陕西话）',
    aliases: ['小妮', '陕西小妮', '陕西话'],
    gender: 'female',
    group: 'zh-dialect',
    locale: 'zh-CN-shaanxi',
    styleTag: '地道关中 · 陕西口音',
    sample: '乡党们好，我是陕西小妮，咱今天一块儿聊点咥美滴事儿。',
  },
  {
    id: 'zh-TW-HsiaoChenNeural',
    name: '晓臻（台湾女声）',
    aliases: ['晓臻', '台湾女声'],
    gender: 'female',
    group: 'zh-dialect',
    locale: 'zh-TW',
    styleTag: '温柔甜美 · 台湾腔',
    sample: '哈囉大家好，我是曉臻，很高興為你朗讀這段溫暖的文字。',
  },
  {
    id: 'zh-TW-YunJheNeural',
    name: '云哲（台湾男声）',
    aliases: ['云哲', '台湾男声'],
    gender: 'male',
    group: 'zh-dialect',
    locale: 'zh-TW',
    styleTag: '温和亲切 · 台湾男声',
    sample: '你好，我是雲哲，聲音自然親切，適合播客訪談與教學講解。',
  },
  {
    id: 'zh-HK-HiuMaanNeural',
    name: '晓曼（粤语女声）',
    aliases: ['晓曼', '粤语女声', '粤语'],
    gender: 'female',
    group: 'zh-dialect',
    locale: 'zh-HK',
    styleTag: '标准粤语 · 港风女声',
    sample: '大家好，我係曉曼，好高興可以同你分享今日嘅精彩內容。',
  },
  {
    id: 'zh-HK-WanLungNeural',
    name: '云龙（粤语男声）',
    aliases: ['云龙', '粤语男声'],
    gender: 'male',
    group: 'zh-dialect',
    locale: 'zh-HK',
    styleTag: '醇厚磁性 · 粤语男声',
    sample: '各位朋友大家好，我係雲龍，歡迎收聽今日嘅節目。',
  },

  // 英语与多语种
  {
    id: 'en-US-AvaNeural',
    name: 'Ava (美式女声)',
    aliases: ['ava', '美式女声', 'english'],
    gender: 'female',
    group: 'intl',
    locale: 'en-US',
    styleTag: '自然多语 · 美式英语',
    sample: 'Hello! I am Ava, a natural neural voice great for English narration and podcasts.',
  },
  {
    id: 'en-US-AndrewNeural',
    name: 'Andrew (美式男声)',
    aliases: ['andrew', '美式男声'],
    gender: 'male',
    group: 'intl',
    locale: 'en-US',
    styleTag: '温暖流畅 · 美式男声',
    sample: 'Hi there, I am Andrew. Ready to bring your English scripts to life.',
  },
  {
    id: 'en-GB-SoniaNeural',
    name: 'Sonia (英式女声)',
    aliases: ['sonia', '英式女声'],
    gender: 'female',
    group: 'intl',
    locale: 'en-GB',
    styleTag: '优雅英伦 · 英式英语',
    sample: 'Good day! I am Sonia, speaking with a crisp and clear British accent.',
  },
  {
    id: 'en-GB-RyanNeural',
    name: 'Ryan (英式男声)',
    aliases: ['ryan', '英式男声'],
    gender: 'male',
    group: 'intl',
    locale: 'en-GB',
    styleTag: '英伦绅士 · 纪录片风',
    sample: 'Hello, I am Ryan. A calm British voice ideal for documentaries and audiobooks.',
  },
  {
    id: 'ja-JP-NanamiNeural',
    name: 'Nanami (日语女声)',
    aliases: ['nanami', '日语女声', '日语'],
    gender: 'female',
    group: 'intl',
    locale: 'ja-JP',
    styleTag: '清晰温柔 · 标准日语',
    sample: 'こんにちは、七海です。自然な日本語で文章を読み上げます。',
  },
  {
    id: 'ja-JP-KeitaNeural',
    name: 'Keita (日语男声)',
    aliases: ['keita', '日语男声'],
    gender: 'male',
    group: 'intl',
    locale: 'ja-JP',
    styleTag: '爽朗自然 · 日语男声',
    sample: 'こんにちは、圭太です。ニュースや解説のナレーションに最適です。',
  },
  {
    id: 'ko-KR-SunHiNeural',
    name: 'SunHi (韩语女声)',
    aliases: ['sunhi', '韩语女声', '韩语'],
    gender: 'female',
    group: 'intl',
    locale: 'ko-KR',
    styleTag: '柔和流畅 · 标准韩语',
    sample: '안녕하세요, 선희입니다. 자연스러운 한국어 음성을 제공합니다.',
  },
]

const VOICE_ID_SET = new Set(CURATED_VOICES.map((v) => v.id))

/** 懒加载 msedge-tts 模块 */
let msEdgeTtsMod = null
let msEdgeChecked = false
let msEdgeLoadError = null

async function ensureMsEdgeTts() {
  if (!ENABLE_TTS) return null
  if (msEdgeTtsMod) return msEdgeTtsMod
  if (!msEdgeChecked) {
    msEdgeChecked = true
    try {
      const mod = await import('msedge-tts')
      msEdgeTtsMod = mod
    } catch (err) {
      msEdgeLoadError = err?.message || 'msedge-tts 未安装'
      return null
    }
  }
  return msEdgeTtsMod
}

/** 校验是否携带了有效的解锁口令（无口令配置时返回 false，统一按免费配额走） */
function isUnlockedByToken(req, parsedUrl) {
  if (!TTS_TOKEN) return false
  const headerToken = String(req.headers['x-tts-token'] || '').trim()
  const queryToken = String(parsedUrl.searchParams.get('token') || '').trim()
  const candidate = headerToken || queryToken
  if (!candidate) return false
  const a = Buffer.from(candidate, 'utf8')
  const b = Buffer.from(TTS_TOKEN, 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/** 计算当前请求 IP 的当日配额状态（本机与外网完全统一流程，无本机特权） */
function getQuotaSnapshot(req, parsedUrl) {
  const ip = extractClientIp(req, serverConfig.trustProxy)
  const unlocked = isUnlockedByToken(req, parsedUrl)
  const unlimited = unlocked || TTS_DAILY_FREE_LIMIT < 0
  const usedToday = quotaStore.getUsed('tts', ip)
  const remainingToday = unlimited ? null : Math.max(0, TTS_DAILY_FREE_LIMIT - usedToday)
  const effectiveMaxChars = unlocked || TTS_DAILY_FREE_LIMIT < 0 ? TTS_MAX_CHARS : TTS_FREE_MAX_CHARS

  return {
    ip,
    date: quotaStore.getDate(),
    hasUnlockToken: Boolean(TTS_TOKEN),
    unlocked,
    unlimited,
    dailyFreeLimit: TTS_DAILY_FREE_LIMIT,
    usedToday,
    remainingToday,
    freeMaxChars: TTS_FREE_MAX_CHARS,
    maxChars: TTS_MAX_CHARS,
    effectiveMaxChars,
  }
}

/** 读取 JSON 请求体 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let received = 0
    req.on('data', (chunk) => {
      received += chunk.length
      if (received > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim()
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(new Error('JSON 格式错误'))
      }
    })
    req.on('error', reject)
  })
}

/** 规范化语速/音调/音量参数 */
function normalizePercent(val, min, max, suffix = '%') {
  const n = Number(val)
  if (!Number.isFinite(n)) return `+0${suffix}`
  const clamped = Math.round(Math.max(min, Math.min(max, n)))
  return `${clamped >= 0 ? '+' : ''}${clamped}${suffix}`
}

/** 将超长段落按句末标点智能切分为 <= CHUNK_CHAR_LIMIT 的自然语句片 */
export function splitTextIntoChunks(text, limit = CHUNK_CHAR_LIMIT) {
  const cleaned = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
  if (!cleaned) return []

  const chunks = []
  const paragraphs = cleaned.split(/\n+/).map((p) => p.trim()).filter(Boolean)

  for (const para of paragraphs) {
    if (para.length <= limit) {
      chunks.push(para)
      continue
    }
    // 优先按中英文句末标点切分
    const sentences = para.split(/(?<=[。！？；!?;\n])/)
    let acc = ''
    for (const sent of sentences) {
      if (!sent) continue
      if (sent.length > limit) {
        if (acc.trim()) {
          chunks.push(acc.trim())
          acc = ''
        }
        // 超长无标点句子按逗号或硬切
        const subParts = sent.split(/(?<=[，,、\s])/)
        let subAcc = ''
        for (const sp of subParts) {
          if (subAcc.length + sp.length > limit) {
            if (subAcc.trim()) chunks.push(subAcc.trim())
            if (sp.length > limit) {
              for (let i = 0; i < sp.length; i += limit) {
                const slice = sp.slice(i, i + limit).trim()
                if (slice) chunks.push(slice)
              }
              subAcc = ''
            } else {
              subAcc = sp
            }
          } else {
            subAcc += sp
          }
        }
        if (subAcc.trim()) chunks.push(subAcc.trim())
      } else if (acc.length + sent.length > limit) {
        if (acc.trim()) chunks.push(acc.trim())
        acc = sent
      } else {
        acc += sent
      }
    }
    if (acc.trim()) chunks.push(acc.trim())
  }

  return chunks
}

/**
 * 逐帧解析 MP3 二进制缓冲区的精确播放时长（毫秒）
 * 兼容 MPEG-1 / MPEG-2 / MPEG-2.5 Layer III，确保多段拼接字幕 0 毫秒漂移
 */
export function measureMp3DurationMs(buf) {
  if (!buf || buf.length < 4) return 0

  // Bitrate 表（kbps）
  const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
  const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
  const SAMPLERATES = {
    3: [44100, 48000, 32000], // MPEG-1
    2: [22050, 24000, 16000], // MPEG-2
    0: [11025, 12000, 8000], // MPEG-2.5
  }

  let offset = 0
  // 跳过开头的 ID3v2 标签（若有）
  if (buf.length >= 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const tagSize =
      ((buf[6] & 0x7f) << 21) |
      ((buf[7] & 0x7f) << 14) |
      ((buf[8] & 0x7f) << 7) |
      (buf[9] & 0x7f)
    offset = 10 + tagSize
  }

  let totalMs = 0
  while (offset + 4 <= buf.length) {
    const b0 = buf[offset]
    const b1 = buf[offset + 1]
    if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) {
      offset += 1
      continue
    }
    const versionBits = (b1 >> 3) & 0x03
    const layerBits = (b1 >> 1) & 0x03
    if (versionBits === 1 || layerBits !== 1) {
      // 仅解析 Layer III
      offset += 1
      continue
    }
    const b2 = buf[offset + 2]
    const bitrateIdx = (b2 >> 4) & 0x0f
    const srIdx = (b2 >> 2) & 0x03
    const padding = (b2 >> 1) & 0x01
    if (bitrateIdx === 0 || bitrateIdx === 15 || srIdx === 3) {
      offset += 1
      continue
    }

    const isV1 = versionBits === 3
    const bitrate = (isV1 ? BITRATES_V1_L3[bitrateIdx] : BITRATES_V2_L3[bitrateIdx]) * 1000
    const sampleRate = SAMPLERATES[versionBits]?.[srIdx]
    if (!bitrate || !sampleRate) {
      offset += 1
      continue
    }

    const samplesPerFrame = isV1 ? 1152 : 576
    const frameLen = Math.floor(((samplesPerFrame / 8) * bitrate) / sampleRate) + padding
    if (frameLen < 4 || offset + frameLen > buf.length) break

    totalMs += (samplesPerFrame * 1000) / sampleRate
    offset += frameLen
  }

  return Math.round(totalMs)
}

/** 将词级 WordBoundary 聚合为阅读友好的字幕句条目 */
function groupBoundariesIntoCues(boundaries, offsetMs, fallbackText, fallbackDurationMs, speakerLabel) {
  const cues = []
  const maxLineChars = 24

  if (boundaries.length === 0) {
    if (fallbackText.trim()) {
      cues.push({
        startMs: offsetMs,
        endMs: offsetMs + Math.max(400, fallbackDurationMs),
        text: fallbackText.trim(),
        speaker: speakerLabel || undefined,
      })
    }
    return cues
  }

  let curText = ''
  let curStart = null
  let curEnd = 0

  const flush = () => {
    const trimmed = curText.trim()
    if (trimmed && curStart !== null) {
      cues.push({
        startMs: offsetMs + curStart,
        endMs: offsetMs + Math.max(curStart + 200, curEnd),
        text: trimmed,
        speaker: speakerLabel || undefined,
      })
    }
    curText = ''
    curStart = null
    curEnd = 0
  }

  for (const b of boundaries) {
    const word = String(b.text || '')
    if (!word) continue
    const startMs = Math.round(b.offsetMs)
    const endMs = Math.round(b.offsetMs + b.durationMs)

    // 英文单词间自动补空格
    const needSpace =
      curText.length > 0 && /[A-Za-z0-9]$/.test(curText) && /^[A-Za-z0-9]/.test(word)

    // 遇到超长或停顿间隙 > 700ms 时换行
    const bigGap = curStart !== null && startMs - curEnd > 700
    if (bigGap || (curText.length > 0 && curText.length + word.length > maxLineChars)) {
      flush()
    }

    if (curStart === null) curStart = startMs
    curText += (needSpace ? ' ' : '') + word
    curEnd = Math.max(curEnd, endMs)

    if (/[。！？；!?;]$/.test(word)) {
      flush()
    }
  }
  flush()

  return cues
}

/** 格式化毫秒为标准 SRT 时间戳 00:00:01,250 */
function formatSrtTimestamp(ms) {
  const safe = Math.max(0, Math.round(ms))
  const h = Math.floor(safe / 3_600_000)
  const m = Math.floor((safe % 3_600_000) / 60_000)
  const s = Math.floor((safe % 60_000) / 1000)
  const rem = safe % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(rem).padStart(3, '0')}`
}

/** 从聚合字幕条目生成标准 SRT 文本 */
export function buildSrtFromCues(cues, includeSpeaker = false) {
  return cues
    .map((cue, idx) => {
      const prefix = includeSpeaker && cue.speaker ? `[${cue.speaker}] ` : ''
      return `${idx + 1}\n${formatSrtTimestamp(cue.startMs)} --> ${formatSrtTimestamp(cue.endMs)}\n${prefix}${cue.text}`
    })
    .join('\n\n')
}

/** 单片段调用 msedge-tts 合成音频与 WordBoundary */
async function synthesizeChunk(mod, { text, voice, rate, pitch, volume, format }) {
  const { MsEdgeTTS } = mod
  const tts = new MsEdgeTTS()
  try {
    await tts.setMetadata(voice, format, {
      wordBoundaryEnabled: true,
      sentenceBoundaryEnabled: false,
    })

    const { audioStream, metadataStream } = tts.toStream(text, {
      rate,
      pitch,
      volume,
    })

    const audioChunks = []
    const boundaries = []

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('语音合成超时，请检查网络连接或缩短文本重试'))
      }, 25000)

      audioStream.on('data', (chunk) => audioChunks.push(chunk))
      metadataStream?.on('data', (chunk) => {
        try {
          const parsed = JSON.parse(chunk.toString('utf8'))
          const list = Array.isArray(parsed?.Metadata) ? parsed.Metadata : []
          for (const item of list) {
            if (item?.Type === 'WordBoundary' && item.Data) {
              boundaries.push({
                offsetMs: Number(item.Data.Offset || 0) / 10000,
                durationMs: Number(item.Data.Duration || 0) / 10000,
                text: item.Data.text?.Text || '',
              })
            }
          }
        } catch {
          // 忽略非 JSON 元数据帧
        }
      })

      let doneCalled = false
      const finish = () => {
        if (doneCalled) return
        doneCalled = true
        clearTimeout(timer)
        resolve()
      }
      audioStream.once('end', finish)
      audioStream.once('close', finish)
      audioStream.once('error', (err) => {
        if (doneCalled) return
        doneCalled = true
        clearTimeout(timer)
        reject(err)
      })
    })

    const audioBuf = Buffer.concat(audioChunks)
    if (audioBuf.length === 0) {
      throw new Error('语音服务未返回音频数据，请检查文本内容是否仅含空白或特殊符号')
    }

    const durationMs = measureMp3DurationMs(audioBuf)
    return { audioBuf, boundaries, durationMs }
  } finally {
    try {
      tts.close()
    } catch {
      // 忽略关闭异常
    }
  }
}

/**
 * 统一路由入口 /api/tts/*
 * @returns {Promise<boolean>}
 */
export async function handleTtsRoutes(req, res, pathname, parsedUrl) {
  if (!pathname.startsWith('/api/tts/')) return false

  // 1. 状态探活（返回当前 IP 的当日剩余免费额度与解锁状态）
  if (pathname === '/api/tts/status' && (req.method === 'GET' || req.method === 'HEAD')) {
    if (ENABLE_TTS && !msEdgeChecked) {
      await ensureMsEdgeTts()
    }
    const q = getQuotaSnapshot(req, parsedUrl)
    sendJson(req, res, 200, {
      enabled: ENABLE_TTS,
      available: Boolean(ENABLE_TTS && msEdgeTtsMod),
      hasUnlockToken: q.hasUnlockToken,
      unlocked: q.unlocked,
      unlimited: q.unlimited,
      dailyFreeLimit: q.dailyFreeLimit,
      usedToday: q.usedToday,
      remainingToday: q.remainingToday,
      freeMaxChars: q.freeMaxChars,
      maxChars: q.maxChars,
      effectiveMaxChars: q.effectiveMaxChars,
      quotaDate: q.date,
      loadError: msEdgeLoadError,
      installHint: 'cd server && pnpm install',
    })
    return true
  }

  // 2. 精选主播音色目录（公开）
  if (pathname === '/api/tts/voices' && req.method === 'GET') {
    sendJson(req, res, 200, { voices: CURATED_VOICES })
    return true
  }

  if (!ENABLE_TTS) {
    sendJson(req, res, 403, { code: 403, message: '服务端已禁用文字转语音模块（tts.enabled=false）' })
    return true
  }

  // 2.5 口令解锁校验接口（校验 tts.token / adminToken）
  if (pathname === '/api/tts/auth' && req.method === 'POST') {
    if (!TTS_TOKEN) {
      sendJson(req, res, 400, {
        code: 400,
        message: '服务端尚未在 server/config.json 中配置 adminToken 或 tts.token',
      })
      return true
    }
    if (!isUnlockedByToken(req, parsedUrl)) {
      sendJson(req, res, 401, { code: 401, message: '口令错误，请检查 server/config.json 配置' })
      return true
    }
    const q = getQuotaSnapshot(req, parsedUrl)
    sendJson(req, res, 200, { ok: true, quota: q })
    return true
  }

  const mod = await ensureMsEdgeTts()
  if (!mod) {
    sendJson(req, res, 503, {
      code: 503,
      message: `Edge 神经语音引擎未就绪：${msEdgeLoadError || '请在 server 目录执行 pnpm install'}`,
    })
    return true
  }

  // 3. 样音试听（带 24h 内存缓存，所有人免费试听且不扣每日额度）
  if (pathname === '/api/tts/preview' && req.method === 'GET') {
    const voiceId = String(parsedUrl.searchParams.get('voice') || 'zh-CN-XiaoxiaoNeural').trim()
    const voiceMeta = CURATED_VOICES.find((v) => v.id === voiceId)
    if (!voiceMeta) {
      sendJson(req, res, 400, { code: 400, message: '不支持的试听音色 ID' })
      return true
    }

    const cacheKey = `tts:preview:${voiceId}`
    let audioBuf = sharedCache.get(cacheKey)
    if (!audioBuf) {
      try {
        const result = await synthesizeChunk(mod, {
          text: voiceMeta.sample,
          voice: voiceMeta.id,
          rate: '+0%',
          pitch: '+0Hz',
          volume: '+0%',
          format: mod.OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
        })
        audioBuf = result.audioBuf
        sharedCache.set(cacheKey, audioBuf, 24 * 60 * 60 * 1000)
      } catch (err) {
        sendJson(req, res, 502, {
          code: 502,
          message: `试听样音合成失败：${err?.message || '上游连接异常'}`,
        })
        return true
      }
    }

    setSecurityHeaders(res)
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuf.length,
      'Cache-Control': 'public, max-age=86400',
    })
    res.end(audioBuf)
    return true
  }

  // 4. 正式合成（按自然天 IP 免费限额 + 口令无限解锁，仅合成成功才扣减次数）
  if (pathname === '/api/tts/synthesize' && req.method === 'POST') {
    const quota = getQuotaSnapshot(req, parsedUrl)

    // 额度前置拦截：未解锁且免费额度为 0 -> 需口令；已耗尽今日免费次数 -> 429
    if (!quota.unlimited) {
      if (quota.dailyFreeLimit === 0) {
        sendJson(req, res, 401, {
          code: 401,
          message: '文字转语音已设为口令专享模式，请先输入访问口令解锁',
          quota,
        })
        return true
      }
      if ((quota.remainingToday ?? 0) <= 0) {
        sendJson(req, res, 429, {
          code: 429,
          message: `今日免费额度（${quota.dailyFreeLimit} 次/天）已用完，明日 00:00 自动重置；站主可输入口令立即解除限制`,
          quota,
        })
        return true
      }
    }

    try {
      const body = await readJsonBody(req)
      // 微软 Edge Read Aloud 免费接口稳定支持 24kHz 48kbps 单声道 MP3
      const format = mod.OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3

      const includeSpeakerInSrt = Boolean(body.includeSpeakerInSrt)

      // 统一规整为任务段列表
      const rawSegments = Array.isArray(body.segments) && body.segments.length > 0
        ? body.segments
        : [
            {
              text: body.text,
              voice: body.voice || 'zh-CN-XiaoxiaoNeural',
              rate: body.rate ?? 0,
              pitch: body.pitch ?? 0,
              volume: body.volume ?? 0,
              speakerLabel: '',
            },
          ]

      const flatTasks = []
      let totalChars = 0
      const charLimit = quota.effectiveMaxChars

      for (const seg of rawSegments) {
        const text = String(seg?.text || '').trim()
        if (!text) continue
        totalChars += text.length
        if (totalChars > charLimit) {
          throw new Error(
            quota.unlocked
              ? `单次合成字数超出上限（当前上限 ${charLimit} 字，请分批合成）`
              : `免费体验单次字数上限为 ${charLimit} 字（当前 ${totalChars} 字）；缩短文本或输入口令解锁 ${TTS_MAX_CHARS} 字长文`,
          )
        }
        const voice = VOICE_ID_SET.has(seg.voice) ? seg.voice : 'zh-CN-XiaoxiaoNeural'
        const rate = normalizePercent(seg.rate ?? 0, -50, 100, '%')
        const pitch = normalizePercent(seg.pitch ?? 0, -50, 50, 'Hz')
        const volume = normalizePercent(seg.volume ?? 0, -50, 50, '%')
        const speakerLabel = String(seg.speakerLabel || '').trim()

        const chunks = splitTextIntoChunks(text, CHUNK_CHAR_LIMIT)
        for (const chunkText of chunks) {
          flatTasks.push({ text: chunkText, voice, rate, pitch, volume, speakerLabel })
        }
      }

      if (flatTasks.length === 0) {
        throw new Error('请输入需要转换为语音的文字内容')
      }

      const audioBuffers = []
      const allCues = []
      let timelineOffsetMs = 0

      // 顺序稳定合成（避免并发过高触发微软风控限流），每片严格按真实 MP3 帧长累加时间轴
      for (const item of flatTasks) {
        const { audioBuf, boundaries, durationMs } = await synthesizeChunk(mod, {
          text: item.text,
          voice: item.voice,
          rate: item.rate,
          pitch: item.pitch,
          volume: item.volume,
          format,
        })
        audioBuffers.push(audioBuf)
        const pieceCues = groupBoundariesIntoCues(
          boundaries,
          timelineOffsetMs,
          item.text,
          durationMs,
          item.speakerLabel,
        )
        allCues.push(...pieceCues)
        timelineOffsetMs += durationMs
      }

      const mergedAudio = Buffer.concat(audioBuffers)
      const indexedCues = allCues.map((c, idx) => ({ index: idx + 1, ...c }))
      const srt = buildSrtFromCues(indexedCues, includeSpeakerInSrt)

      // 仅在合成完全成功后扣减未解锁 IP 的当日免费次数
      if (!quota.unlimited) {
        quotaStore.consume('tts', quota.ip, 1)
      }
      const nextQuota = getQuotaSnapshot(req, parsedUrl)

      sendJson(req, res, 200, {
        audioBase64: mergedAudio.toString('base64'),
        mime: 'audio/mpeg',
        byteLength: mergedAudio.length,
        durationMs: timelineOffsetMs,
        chunkCount: flatTasks.length,
        cues: indexedCues,
        srt,
        quota: {
          hasUnlockToken: nextQuota.hasUnlockToken,
          unlocked: nextQuota.unlocked,
          unlimited: nextQuota.unlimited,
          dailyFreeLimit: nextQuota.dailyFreeLimit,
          usedToday: nextQuota.usedToday,
          remainingToday: nextQuota.remainingToday,
          freeMaxChars: nextQuota.freeMaxChars,
          maxChars: nextQuota.maxChars,
          effectiveMaxChars: nextQuota.effectiveMaxChars,
        },
      })
    } catch (err) {
      const msg = err?.message || '语音合成失败'
      const status = msg.includes('请输入') || msg.includes('上限') || msg.includes('JSON') ? 400 : 502
      sendJson(req, res, status, { code: status, message: msg })
    }
    return true
  }

  return false
}

export function getTtsSummary() {
  return {
    enabled: ENABLE_TTS,
    hasUnlockToken: Boolean(TTS_TOKEN),
    dailyFreeLimit: TTS_DAILY_FREE_LIMIT,
    freeMaxChars: TTS_FREE_MAX_CHARS,
    maxChars: TTS_MAX_CHARS,
  }
}
