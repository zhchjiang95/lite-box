/**
 * 视频与直播流播放引擎（HLS.js + mpegts.js 按需懒加载 + 原生 <video> + 后端跨域代理客户端）
 */

import { canvasToBlob } from '@/lib/file'
import { detectStreamProtocol, type ChannelItem, type PlayHistoryItem, type StreamProtocol } from './playlist'

// ============================================================================
// 后端跨域代理 API 封装与本地状态存储
// ============================================================================

const STORAGE_KEYS = {
  token: 'litebox:stream:proxy-token',
  channels: 'litebox:stream:channels',
  favorites: 'litebox:stream:favorites',
  history: 'litebox:stream:history',
}

export interface StreamProxyStatus {
  online: boolean
  enabled: boolean
  requiresAuth: boolean
  allowPrivateIp: boolean
  activeStreams: number
  maxConcurrent: number
}

export async function fetchStreamProxyStatus(): Promise<StreamProxyStatus> {
  try {
    const res = await fetch('/api/stream/status', { cache: 'no-store' })
    if (!res.ok) {
      return { online: false, enabled: false, requiresAuth: false, allowPrivateIp: false, activeStreams: 0, maxConcurrent: 0 }
    }
    const data = await res.json()
    return {
      online: true,
      enabled: Boolean(data.enabled),
      requiresAuth: Boolean(data.requiresAuth),
      allowPrivateIp: Boolean(data.allowPrivateIp),
      activeStreams: Number(data.activeStreams || 0),
      maxConcurrent: Number(data.maxConcurrent || 16),
    }
  } catch {
    return { online: false, enabled: false, requiresAuth: false, allowPrivateIp: false, activeStreams: 0, maxConcurrent: 0 }
  }
}

export async function verifyStreamProxyToken(token: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch('/api/stream/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, message: data.message || '代理口令验证失败' }
    }
    return { ok: true }
  } catch {
    return { ok: false, message: '无法连接后端流媒体代理服务' }
  }
}

/** 构造通过后端中转代理的播放地址 */
export function buildStreamProxyUrl(
  targetUrl: string,
  options: { token?: string; referer?: string; userAgent?: string } = {},
): string {
  const sp = new URLSearchParams()
  sp.set('url', targetUrl)
  if (options.token) sp.set('token', options.token)
  if (options.referer) sp.set('referer', options.referer)
  if (options.userAgent) sp.set('ua', options.userAgent)
  return `/api/stream/proxy?${sp.toString()}`
}

export function loadSavedProxyToken(): string {
  try {
    return localStorage.getItem(STORAGE_KEYS.token) || ''
  } catch {
    return ''
  }
}

export function saveProxyToken(token: string) {
  try {
    if (token) localStorage.setItem(STORAGE_KEYS.token, token)
    else localStorage.removeItem(STORAGE_KEYS.token)
  } catch {
    // 忽略隐私模式存储限制
  }
}

export function loadSavedChannels(): ChannelItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.channels)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveChannels(channels: ChannelItem[]) {
  try {
    localStorage.setItem(STORAGE_KEYS.channels, JSON.stringify(channels.slice(0, 2000)))
  } catch {
    // 容量超出时忽略
  }
}

export function loadFavorites(): ChannelItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.favorites)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveFavorites(favs: ChannelItem[]) {
  try {
    localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(favs.slice(0, 200)))
  } catch {
    // ignore
  }
}

export function loadPlayHistory(): PlayHistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.history)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function pushPlayHistory(item: PlayHistoryItem): PlayHistoryItem[] {
  const prev = loadPlayHistory().filter((h) => h.url !== item.url)
  const next = [item, ...prev].slice(0, 30)
  try {
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(next))
  } catch {
    // ignore
  }
  return next
}

export function clearPlayHistory() {
  try {
    localStorage.removeItem(STORAGE_KEYS.history)
  } catch {
    // ignore
  }
}

// ============================================================================
// 统一流媒体播放引擎（HLS.js / mpegts.js / Native）
// ============================================================================

export interface QualityLevel {
  index: number
  label: string
  height: number
  bitrate: number
}

export interface StreamTelemetry {
  engine: 'hls.js' | 'mpegts.js' | 'native'
  protocol: Exclude<StreamProtocol, 'auto'>
  isLive: boolean
  width: number
  height: number
  bufferedSec: number
  bitrateKbps: number
  speedKBps: number
  droppedFrames: number
  totalFrames: number
  liveLatencySec: number | null
}

export interface PlayerSession {
  setQuality: (levelIndex: number) => void
  catchUpLive: () => void
  destroy: () => void
}

export interface MountStreamParams {
  video: HTMLVideoElement
  playUrl: string
  originalUrl: string
  protocolOverride: StreamProtocol
  isLiveHint?: boolean
  onLevels?: (levels: QualityLevel[], currentLevel: number) => void
  onTelemetry?: (stats: StreamTelemetry) => void
  onError?: (message: string, maybeCors: boolean) => void
  onStatus?: (status: 'loading' | 'playing' | 'error') => void
}

/** 计算当前播放位置前方的缓冲秒数 */
function readBufferedAhead(video: HTMLVideoElement): number {
  try {
    const t = video.currentTime
    for (let i = 0; i < video.buffered.length; i++) {
      const start = video.buffered.start(i)
      const end = video.buffered.end(i)
      if (t >= start - 0.5 && t <= end + 0.5) {
        return Math.max(0, end - t)
      }
    }
    if (video.buffered.length > 0) {
      return Math.max(0, video.buffered.end(video.buffered.length - 1) - t)
    }
  } catch {
    // ignore
  }
  return 0
}

/** 读取浏览器视频掉帧统计 */
function readPlaybackQuality(video: HTMLVideoElement): { dropped: number; total: number } {
  if (typeof video.getVideoPlaybackQuality === 'function') {
    const q = video.getVideoPlaybackQuality()
    return { dropped: q.droppedVideoFrames || 0, total: q.totalVideoFrames || 0 }
  }
  return { dropped: 0, total: 0 }
}

/**
 * 将任意流媒体地址挂载到 <video> 元素，自动选择最优解码内核
 */
export async function mountStreamPlayer(params: MountStreamParams): Promise<PlayerSession> {
  const { video, playUrl, originalUrl, protocolOverride, isLiveHint, onLevels, onTelemetry, onError, onStatus } = params
  const protocol = detectStreamProtocol(originalUrl, protocolOverride)

  let destroyed = false
  let timer: ReturnType<typeof setInterval> | null = null
  let latestSpeedKBps = 0
  let latestBitrateKbps = 0
  let detectedLive = Boolean(isLiveHint)

  onStatus?.('loading')
  onLevels?.([], -1)

  // 重置 video 元素残留状态
  video.pause()
  video.removeAttribute('src')
  video.load()

  const startTelemetry = (
    engine: StreamTelemetry['engine'],
    getLatency: () => number | null = () => null,
  ) => {
    const emit = () => {
      if (destroyed) return
      const q = readPlaybackQuality(video)
      const isLive = detectedLive || !Number.isFinite(video.duration) || video.duration === Infinity
      onTelemetry?.({
        engine,
        protocol,
        isLive,
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
        bufferedSec: Number(readBufferedAhead(video).toFixed(1)),
        bitrateKbps: Math.round(latestBitrateKbps),
        speedKBps: Math.round(latestSpeedKBps),
        droppedFrames: q.dropped,
        totalFrames: q.total,
        liveLatencySec: isLive ? getLatency() : null,
      })
    }
    emit()
    timer = setInterval(emit, 1000)
  }

  // --------------------------------------------------------------------------
  // 1. HLS (.m3u8) -> 优先使用 hls.js（支持多码率切换、错误恢复、缓冲遥测）
  // --------------------------------------------------------------------------
  if (protocol === 'hls') {
    const { default: Hls } = await import('hls.js')
    if (destroyed) return noopSession()

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        fragLoadingMaxRetry: 4,
        manifestLoadingMaxRetry: 3,
      })

      let mediaRecoverCount = 0

      hls.on(Hls.Events.MANIFEST_PARSED, (_evt, data) => {
        if (destroyed) return
        const levels: QualityLevel[] = data.levels.map((lv, idx) => ({
          index: idx,
          height: lv.height || 0,
          bitrate: lv.bitrate || 0,
          label: lv.height
            ? `${lv.height}p${lv.bitrate ? ` · ${(lv.bitrate / 1e6).toFixed(1)}M` : ''}`
            : lv.bitrate
              ? `${Math.round(lv.bitrate / 1000)} kbps`
              : `档位 ${idx + 1}`,
        }))
        onLevels?.(levels, hls.currentLevel)
        video.play().catch(() => {})
      })

      hls.on(Hls.Events.LEVEL_LOADED, (_evt, data) => {
        if (data.details?.live !== undefined) {
          detectedLive = Boolean(data.details.live)
        }
      })

      hls.on(Hls.Events.LEVEL_SWITCHED, (_evt, data) => {
        const lv = hls.levels[data.level]
        if (lv?.bitrate) latestBitrateKbps = lv.bitrate / 1000
        onLevels?.(
          hls.levels.map((item, idx) => ({
            index: idx,
            height: item.height || 0,
            bitrate: item.bitrate || 0,
            label: item.height
              ? `${item.height}p${item.bitrate ? ` · ${(item.bitrate / 1e6).toFixed(1)}M` : ''}`
              : item.bitrate
                ? `${Math.round(item.bitrate / 1000)} kbps`
                : `档位 ${idx + 1}`,
          })),
          hls.autoLevelEnabled ? -1 : data.level,
        )
      })

      hls.on(Hls.Events.FRAG_LOADED, (_evt, data) => {
        const stats = data.frag?.stats
        if (stats && stats.loaded > 0 && stats.loading.end > stats.loading.start) {
          const sec = (stats.loading.end - stats.loading.start) / 1000
          if (sec > 0) latestSpeedKBps = stats.loaded / 1024 / sec
        }
        if (hls.bandwidthEstimate > 0) {
          latestBitrateKbps = hls.bandwidthEstimate / 1000
        }
      })

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (destroyed || !data.fatal) return
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          const httpCode = data.response?.code
          const maybeCors = !httpCode || httpCode === 0
          const detail = httpCode ? `HTTP ${httpCode}` : data.details || '网络或跨域被拦截'
          onStatus?.('error')
          onError?.(`HLS 流加载失败（${detail}）`, maybeCors)
          hls.stopLoad()
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoverCount < 2) {
          mediaRecoverCount++
          hls.recoverMediaError()
        } else {
          onStatus?.('error')
          onError?.(`HLS 解码异常（${data.details || '媒体格式不兼容'}）`, false)
        }
      })

      const onPlaying = () => onStatus?.('playing')
      video.addEventListener('playing', onPlaying)

      hls.loadSource(playUrl)
      hls.attachMedia(video)

      startTelemetry('hls.js', () => {
        const lat = hls.latency
        return typeof lat === 'number' && Number.isFinite(lat) ? Number(lat.toFixed(1)) : null
      })

      return {
        setQuality: (levelIndex) => {
          hls.currentLevel = levelIndex // -1 为自动
        },
        catchUpLive: () => {
          const pos = hls.liveSyncPosition
          if (typeof pos === 'number' && Number.isFinite(pos)) {
            video.currentTime = pos
          }
          video.play().catch(() => {})
        },
        destroy: () => {
          destroyed = true
          if (timer) clearInterval(timer)
          video.removeEventListener('playing', onPlaying)
          hls.destroy()
        },
      }
    }

    // Safari 原生 HLS 回退
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      return mountNativeVideo(video, playUrl, protocol, startTelemetry, onStatus, onError, () => {
        destroyed = true
        if (timer) clearInterval(timer)
      })
    }

    onStatus?.('error')
    onError?.('当前浏览器不支持 MSE 或原生 HLS 播放', false)
    return noopSession()
  }

  // --------------------------------------------------------------------------
  // 2. HTTP-FLV / MPEG-TS -> 使用 mpegts.js
  // --------------------------------------------------------------------------
  if (protocol === 'flv' || protocol === 'mpegts') {
    const mpegtsMod = await import('mpegts.js')
    const mpegts = mpegtsMod.default ?? mpegtsMod
    if (destroyed) return noopSession()

    if (!mpegts.isSupported()) {
      onStatus?.('error')
      onError?.('当前浏览器不支持 MSE，无法解码 HTTP-FLV / MPEG-TS 流（可使用 Chrome / Edge）', false)
      return noopSession()
    }

    detectedLive = true
    const player = mpegts.createPlayer(
      {
        type: protocol === 'flv' ? 'flv' : 'mpegts',
        isLive: isLiveHint ?? true,
        url: playUrl,
        cors: true,
      },
      {
        enableWorker: true,
        enableStashBuffer: false,
        stashInitialSize: 128,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 4.5,
        liveBufferLatencyMinRemain: 0.8,
        autoCleanupSourceBuffer: true,
      },
    )

    player.on(mpegts.Events.STATISTICS_INFO, (info: { speed?: number }) => {
      if (typeof info?.speed === 'number' && Number.isFinite(info.speed)) {
        latestSpeedKBps = info.speed
        latestBitrateKbps = info.speed * 8
      }
    })

    player.on(mpegts.Events.MEDIA_INFO, (info: { videoDataRate?: number; audioDataRate?: number; duration?: number }) => {
      if (typeof info?.duration === 'number' && info.duration > 0) {
        detectedLive = false
      }
      const totalRate = (info?.videoDataRate || 0) + (info?.audioDataRate || 0)
      if (totalRate > 0) latestBitrateKbps = totalRate
    })

    player.on(mpegts.Events.ERROR, (errType: string, errDetail: string, errInfo?: { code?: number; msg?: string }) => {
      if (destroyed) return
      const maybeCors = errType === mpegts.ErrorTypes.NETWORK_ERROR && (!errInfo?.code || errInfo.code === 0)
      const hint = errInfo?.msg || errDetail || errType
      onStatus?.('error')
      onError?.(`${protocol.toUpperCase()} 播放失败（${hint}）`, maybeCors)
    })

    const onPlaying = () => onStatus?.('playing')
    video.addEventListener('playing', onPlaying)

    player.attachMediaElement(video)
    player.load()
    Promise.resolve(player.play()).catch(() => {})

    startTelemetry('mpegts.js', () => {
      const ahead = readBufferedAhead(video)
      return Number(ahead.toFixed(1))
    })

    return {
      setQuality: () => {},
      catchUpLive: () => {
        if (video.buffered.length > 0) {
          const end = video.buffered.end(video.buffered.length - 1)
          if (end - video.currentTime > 1.2) {
            video.currentTime = Math.max(0, end - 0.5)
          }
        }
        video.play().catch(() => {})
      },
      destroy: () => {
        destroyed = true
        if (timer) clearInterval(timer)
        video.removeEventListener('playing', onPlaying)
        try {
          player.pause()
          player.unload()
          player.detachMediaElement()
          player.destroy()
        } catch {
          // ignore
        }
      },
    }
  }

  // --------------------------------------------------------------------------
  // 3. 原生 <video>（MP4 / WebM / OGG / 本地文件）
  // --------------------------------------------------------------------------
  return mountNativeVideo(video, playUrl, protocol, startTelemetry, onStatus, onError, () => {
    destroyed = true
    if (timer) clearInterval(timer)
  })
}

function mountNativeVideo(
  video: HTMLVideoElement,
  playUrl: string,
  _protocol: Exclude<StreamProtocol, 'auto'>,
  startTelemetry: (engine: StreamTelemetry['engine']) => void,
  onStatus?: (status: 'loading' | 'playing' | 'error') => void,
  onError?: (message: string, maybeCors: boolean) => void,
  onCleanup?: () => void,
): PlayerSession {
  const onPlaying = () => onStatus?.('playing')
  const onCanPlay = () => {
    video.play().catch(() => {})
  }
  const onVideoErr = () => {
    const code = video.error?.code
    const reason =
      code === 2
        ? '网络请求中断或跨域/防盗链拦截'
        : code === 3
          ? '视频流解码失败（可能包含浏览器不支持的编码如 HEVC/AC3）'
          : code === 4
            ? '不支持的视频格式或源地址不可达'
            : '视频加载失败'
    onStatus?.('error')
    onError?.(reason, code === 2 || code === 4)
  }

  video.addEventListener('playing', onPlaying)
  video.addEventListener('canplay', onCanPlay)
  video.addEventListener('error', onVideoErr)

  // 仅远端地址尝试匿名跨域（允许截图），失败由用户切换后端代理
  video.src = playUrl
  video.load()
  video.play().catch(() => {})

  startTelemetry('native')

  return {
    setQuality: () => {},
    catchUpLive: () => {
      if (video.buffered.length > 0) {
        video.currentTime = Math.max(0, video.buffered.end(video.buffered.length - 1) - 0.5)
      }
      video.play().catch(() => {})
    },
    destroy: () => {
      onCleanup?.()
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('error', onVideoErr)
      video.pause()
      video.removeAttribute('src')
      video.load()
    },
  }
}

function noopSession(): PlayerSession {
  return { setQuality: () => {}, catchUpLive: () => {}, destroy: () => {} }
}

/** 截取当前视频帧为高清 PNG（自动应用画面旋转与水平镜像） */
export async function captureVideoFrameToPng(
  video: HTMLVideoElement,
  rotationDeg: number,
  mirrorX: boolean,
): Promise<Blob> {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) {
    throw new Error('当前暂无可截取的视频画面')
  }
  const rotated = rotationDeg === 90 || rotationDeg === 270
  const canvas = document.createElement('canvas')
  canvas.width = rotated ? vh : vw
  canvas.height = rotated ? vw : vh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建截图画布')

  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((rotationDeg * Math.PI) / 180)
  if (mirrorX) ctx.scale(-1, 1)
  ctx.drawImage(video, -vw / 2, -vh / 2, vw, vh)
  ctx.restore()

  try {
    return await canvasToBlob(canvas, 'image/png')
  } catch {
    throw new Error('截图失败：该远端源未开放 CORS，请开启「后端跨域代理」后重试')
  }
}
