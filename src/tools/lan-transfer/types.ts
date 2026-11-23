/** 隔空快传 · 局域网文件共享：类型定义、本机识别与轻灵无线音效 */

export type DeviceType = 'phone' | 'tablet' | 'desktop'
export type TransferTransport = 'p2p' | 'relay'
export type ConnectionState = 'connecting' | 'online' | 'offline'

export interface PeerInfo {
  id: string
  name: string
  deviceType: DeviceType
  osLabel: string
  browserLabel: string
  color: string
}

export interface FileDescriptor {
  id: string
  name: string
  size: number
  type: string
}

export interface IncomingOffer {
  transferId: string
  fromId: string
  fromName: string
  fromColor: string
  transport: TransferTransport
  files: FileDescriptor[]
  totalSize: number
}

export type TransferStatus =
  | 'connecting'
  | 'waiting-accept'
  | 'transferring'
  | 'done'
  | 'rejected'
  | 'cancelled'
  | 'error'

export interface ActiveTransfer {
  transferId: string
  peerId: string
  peerName: string
  direction: 'send' | 'recv'
  transport: TransferTransport
  files: FileDescriptor[]
  totalSize: number
  transferredBytes: number
  speedBps: number
  status: TransferStatus
  currentFileName: string
  error?: string
}

export interface ReceivedFileItem {
  id: string
  fromName: string
  name: string
  size: number
  type: string
  url: string
  isImage: boolean
  time: string
  transport: TransferTransport
}

export interface TextMessageItem {
  id: string
  peerId: string
  peerName: string
  direction: 'in' | 'out'
  text: string
  time: string
}

/** 识别当前设备形态、操作系统与浏览器，展示在对方雷达节点上 */
export function detectLocalDevice(): {
  deviceType: DeviceType
  osLabel: string
  browserLabel: string
} {
  const ua = navigator.userAgent || ''
  const isIPad =
    /iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isIPhone = /iPhone|iPod/i.test(ua)
  const isAndroid = /Android/i.test(ua)
  const isMobile = isIPhone || (isAndroid && /Mobile/i.test(ua))

  let deviceType: DeviceType = 'desktop'
  if (isIPad || (isAndroid && !/Mobile/i.test(ua))) deviceType = 'tablet'
  else if (isMobile) deviceType = 'phone'

  let osLabel = '桌面设备'
  if (isIPhone) osLabel = 'iPhone'
  else if (isIPad) osLabel = 'iPad'
  else if (/Mac OS X|Macintosh/i.test(ua)) osLabel = 'macOS'
  else if (/Windows/i.test(ua)) osLabel = 'Windows'
  else if (isAndroid) osLabel = 'Android'
  else if (/Linux/i.test(ua)) osLabel = 'Linux'

  let browserLabel = '浏览器'
  if (/Edg\//i.test(ua)) browserLabel = 'Edge'
  else if (/MicroMessenger/i.test(ua)) browserLabel = '微信'
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browserLabel = 'Chrome'
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browserLabel = 'Safari'
  else if (/Firefox\//i.test(ua)) browserLabel = 'Firefox'

  return { deviceType, osLabel, browserLabel }
}

/** 格式化传输速率 */
export function formatSpeed(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return '计算中…'
  if (bps < 1024) return `${Math.round(bps)} B/s`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`
}

export function formatShortTime(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 轻量无线晶体音效（纯 Web Audio API，零音频文件） */
let audioCtx: AudioContext | null = null
function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!audioCtx) audioCtx = new Ctor()
  if (audioCtx.state === 'suspended') void audioCtx.resume()
  return audioCtx
}

function playTone(freqs: number[], stepSec = 0.08, duration = 0.28, volume = 0.09) {
  const ctx = getCtx()
  if (!ctx) return
  try {
    const now = ctx.currentTime
    freqs.forEach((f, idx) => {
      const start = now + idx * stepSec
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(f, start)
      gain.gain.setValueAtTime(0.001, start)
      gain.gain.linearRampToValueAtTime(volume, start + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + duration + 0.02)
    })
  } catch {
    // 未经用户手势解锁前静默跳过
  }
}

/** 新设备进入雷达圈时的柔和声波提示音 */
export const playPeerArriveSound = () => playTone([587.33, 880], 0.07, 0.24, 0.06)
/** 收到文件或文字请求时的清脆双音 */
export const playIncomingSound = () => playTone([659.25, 987.77], 0.09, 0.3, 0.08)
/** 传输完成时的空灵和弦 */
export const playCompleteSound = () => playTone([523.25, 659.25, 1046.5], 0.07, 0.38, 0.08)
