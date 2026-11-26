/** 磁力流媒体前端 API 封装、口令管理与播放器链接构造 */

export type PlayMode = 'native' | 'remux' | 'compat'

export interface DiskStats {
  cacheBytes: number
  diskFreeBytes: number | null
  diskTotalBytes: number | null
}

export interface MagnetServiceStatus {
  enabled: boolean
  available: boolean
  requiresAuth: boolean
  authorized: boolean
  loadError: string | null
  installHint: string
  ffmpegAvailable: boolean
  ffmpegVersion: string | null
  cacheDir?: string
  cacheBytes: number
  diskFreeBytes: number | null
  diskTotalBytes: number | null
  maxTasks: number
  idleMinutes: number
  uploadLimitBytes: number
  activeTaskCount: number
}

export interface MagnetFileItem {
  index: number
  name: string
  path: string
  length: number
  downloaded: number
  progress: number
  kind: 'video' | 'subtitle' | 'audio' | 'other'
  ext: string
  mime: string
  browserNativePlayable: boolean
}

export interface MagnetTaskItem {
  infoHash: string
  name: string
  ready: boolean
  progress: number
  downloaded: number
  uploaded: number
  length: number
  downloadSpeed: number
  uploadSpeed: number
  numPeers: number
  activeFileIndex: number | null
  activeTranscodes: number
  createdAt: number
  lastAccessAt: number
  idleRemainingSec: number
  files: MagnetFileItem[]
}

const TOKEN_STORAGE_KEY = 'litebox.magnet.token'

/** 合法开源公有领域测试磁力（Blender Foundation 开源短片 Sintel，官方 WebTorrent 示例） */
export const DEMO_OPENSOURCE_MAGNET =
  'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com'

export function loadSavedToken(): string {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function saveToken(token: string) {
  try {
    const trimmed = token.trim()
    if (trimmed) localStorage.setItem(TOKEN_STORAGE_KEY, trimmed)
    else localStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    // 忽略隐私模式存储限制
  }
}

async function requestJson<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (token.trim()) {
    headers.set('X-Magnet-Token', token.trim())
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let res: Response
  try {
    res = await fetch(url, { ...init, headers })
  } catch {
    throw new Error('无法连接到后端服务，请确认 server 服务已启动')
  }

  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`后端响应格式异常（HTTP ${res.status}），请确认已启动最新 server/index.mjs`)
  }

  if (!res.ok) {
    const msg =
      (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
        ? data.message
        : null) || `请求失败（HTTP ${res.status}）`
    const err = new Error(msg) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return data as T
}

export function fetchMagnetStatus(token: string) {
  return requestJson<MagnetServiceStatus>('/api/magnet/status', token)
}

export function verifyMagnetToken(token: string) {
  return requestJson<{ ok: boolean }>('/api/magnet/auth', token, { method: 'POST' })
}

export function fetchMagnetTasks(token: string) {
  return requestJson<{ tasks: MagnetTaskItem[]; disk: DiskStats }>('/api/magnet/tasks', token)
}

export function createMagnetTask(
  token: string,
  payload: { magnet?: string; torrentBase64?: string; fileName?: string },
) {
  return requestJson<{ task: MagnetTaskItem; disk: DiskStats }>('/api/magnet/tasks', token, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function deleteMagnetTask(token: string, infoHash: string) {
  return requestJson<{ ok: boolean; message: string; disk: DiskStats }>(
    `/api/magnet/tasks/${infoHash}`,
    token,
    { method: 'DELETE' },
  )
}

export function clearMagnetCache(token: string) {
  return requestJson<{ ok: boolean; clearedTasks: number; disk: DiskStats }>(
    '/api/magnet/cache/clear',
    token,
    { method: 'POST' },
  )
}

/** 构造视频流地址（支持原生 206 Range / ffmpeg remux / ffmpeg compat） */
export function buildStreamUrl(
  infoHash: string,
  fileIndex: number,
  mode: PlayMode,
  token: string,
  absolute = false,
): string {
  const params = new URLSearchParams()
  if (mode === 'remux' || mode === 'compat') {
    params.set('mode', mode)
  }
  if (token.trim()) {
    params.set('token', token.trim())
  }
  const basePath =
    mode === 'native'
      ? `/api/magnet/stream/${infoHash}/${fileIndex}`
      : `/api/magnet/transcode/${infoHash}/${fileIndex}`
  const query = params.toString()
  const rel = query ? `${basePath}?${query}` : basePath
  return absolute ? `${window.location.origin}${rel}` : rel
}

/** 构造种子内字幕 WebVTT 地址 */
export function buildSubtitleUrl(infoHash: string, fileIndex: number, token: string): string {
  const params = new URLSearchParams()
  if (token.trim()) params.set('token', token.trim())
  const q = params.toString()
  return q
    ? `/api/magnet/subtitle/${infoHash}/${fileIndex}?${q}`
    : `/api/magnet/subtitle/${infoHash}/${fileIndex}`
}

/** 构造外置专业播放器唤起协议 */
export function buildExternalPlayerLinks(absNativeStreamUrl: string) {
  return {
    potplayer: `potplayer://${absNativeStreamUrl}`,
    vlc: `vlc://${absNativeStreamUrl}`,
    iina: `iina://weblink?url=${encodeURIComponent(absNativeStreamUrl)}`,
  }
}

/** 将本地上传的 SRT 字幕转换为 Blob WebVTT URL */
export function convertLocalSubtitleToVttUrl(rawText: string): string {
  const cleaned = rawText
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
  const vtt = cleaned.trimStart().startsWith('WEBVTT')
    ? cleaned
    : `WEBVTT\n\n${cleaned.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2 --> $3.$4')}\n`
  return URL.createObjectURL(new Blob([vtt], { type: 'text/vtt;charset=utf-8' }))
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let val = bytes / 1024
  let idx = 0
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024
    idx += 1
  }
  return `${val.toFixed(val >= 100 ? 0 : val >= 10 ? 1 : 2)} ${units[idx]}`
}

export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 B/s'
  return `${formatBytes(bytesPerSec)}/s`
}

export function formatIdleTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m <= 0) return `${rem} 秒`
  return `${m} 分 ${rem} 秒`
}
