/**
 * 屏幕录制与摄像头拍照核心引擎（零第三方依赖）
 * - 探测浏览器原生 MP4 / WebM (VP9/VP8/H.264) MediaRecorder 编码能力
 * - Web Audio API 系统音 + 麦克风双轨实时混音与音量电平表（AnalyserNode）
 * - 后台防节流 Web Worker 节拍器驱动 Canvas 2D 画中画（屏幕 + 摄像头人像）合成
 * - 摄像头滤镜拍照、录屏实时抓拍与多媒体设备枚举
 */

import { canvasToBlob } from '@/lib/file'

/** 录制/拍摄模式 */
export type CaptureMode = 'screen' | 'screen-cam' | 'camera'

/** 容器偏好 */
export type ContainerFormat = 'auto' | 'mp4' | 'webm'

/** 画中画摄像头形状 */
export type PipShape = 'circle' | 'rounded'

/** 画中画角落位置 */
export type PipCorner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'

/** 摄像头实时滤镜 */
export type CameraFilterId = 'none' | 'bright' | 'warm' | 'bw' | 'vivid'

export interface CameraFilterOption {
  id: CameraFilterId
  label: string
  css: string
}

export const CAMERA_FILTERS: CameraFilterOption[] = [
  { id: 'none', label: '原色自然', css: 'none' },
  { id: 'bright', label: '柔和提亮', css: 'brightness(1.08) contrast(1.04) saturate(1.06)' },
  { id: 'warm', label: '暖调复古', css: 'sepia(0.24) saturate(1.18) brightness(1.03)' },
  { id: 'vivid', label: '通透鲜明', css: 'contrast(1.1) saturate(1.26)' },
  { id: 'bw', label: '黑白胶片', css: 'grayscale(1) contrast(1.16)' },
]

export interface BitratePreset {
  id: string
  label: string
  bps: number
  desc: string
}

export const BITRATE_PRESETS: BitratePreset[] = [
  { id: 'lite', label: '轻量 2.5M', bps: 2_500_000, desc: '省空间 · 演示文档' },
  { id: 'std', label: '标清 5M', bps: 5_000_000, desc: '均衡推荐' },
  { id: 'hd', label: '高清 8M', bps: 8_000_000, desc: '1080p 清晰锐利' },
  { id: 'ultra', label: '超清 14M', bps: 14_000_000, desc: '高帧率 / 细节丰富' },
]

export interface MediaFormatSupport {
  mp4Mime: string | null
  webmMime: string | null
  canDisplayMedia: boolean
  canUserMedia: boolean
  canMediaRecorder: boolean
  isSecureContext: boolean
}

const MP4_CANDIDATES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=h264,aac',
  'video/mp4',
]

const WEBM_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=h264,opus',
  'video/webm',
]

/** 探测当前浏览器支持的录制容器与安全上下文 */
export function detectMediaSupport(): MediaFormatSupport {
  const hasRecorder = typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined'
  const pick = (list: string[]) => {
    if (!hasRecorder || typeof MediaRecorder.isTypeSupported !== 'function') return null
    for (const mime of list) {
      try {
        if (MediaRecorder.isTypeSupported(mime)) return mime
      } catch {
        // 忽略个别浏览器抛出异常
      }
    }
    return null
  }

  return {
    mp4Mime: pick(MP4_CANDIDATES),
    webmMime: pick(WEBM_CANDIDATES),
    canDisplayMedia: Boolean(navigator.mediaDevices?.getDisplayMedia),
    canUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
    canMediaRecorder: hasRecorder,
    isSecureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
  }
}

/** 按用户格式偏好选出最终 MIME 与扩展名 */
export function resolveRecordingMime(
  pref: ContainerFormat,
  support: MediaFormatSupport,
): { mimeType: string; ext: 'mp4' | 'webm'; label: string } {
  if (pref === 'mp4' && support.mp4Mime) {
    return { mimeType: support.mp4Mime, ext: 'mp4', label: 'MP4 (原生直出)' }
  }
  if (pref === 'webm' && support.webmMime) {
    return { mimeType: support.webmMime, ext: 'webm', label: support.webmMime.includes('vp9') ? 'WebM (VP9)' : 'WebM' }
  }
  // auto：优先 MP4（若浏览器支持原生 MP4 封装，通用性最佳），否则回退 WebM VP9/VP8
  if (support.mp4Mime) {
    return { mimeType: support.mp4Mime, ext: 'mp4', label: 'MP4 (原生直出)' }
  }
  if (support.webmMime) {
    return { mimeType: support.webmMime, ext: 'webm', label: support.webmMime.includes('vp9') ? 'WebM (VP9)' : 'WebM' }
  }
  return { mimeType: '', ext: 'webm', label: '浏览器默认 WebM' }
}

/** 枚举本机摄像头与麦克风设备 */
export interface DeviceListResult {
  cameras: MediaDeviceInfo[]
  mics: MediaDeviceInfo[]
}

export async function listMediaDevices(): Promise<DeviceListResult> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return { cameras: [], mics: [] }
  }
  try {
    const all = await navigator.mediaDevices.enumerateDevices()
    return {
      cameras: all.filter((d) => d.kind === 'videoinput'),
      mics: all.filter((d) => d.kind === 'audioinput'),
    }
  } catch {
    return { cameras: [], mics: [] }
  }
}

/** 停止一条 MediaStream 的全部轨道 */
export function stopMediaStream(stream: MediaStream | null | undefined) {
  if (!stream) return
  stream.getTracks().forEach((t) => {
    try {
      t.stop()
    } catch {
      // ignore
    }
  })
}

// ============================================================================
// Web Audio API 双轨混音器（系统/标签页音频 + 麦克风 + 实时电平分析）
// ============================================================================

export interface AudioMixerHandle {
  /** 混音后的输出音频轨（可能为空，表示无任何音轨） */
  audioTrack: MediaStreamTrack | null
  /** 动态调节系统音频增益（0–1.5） */
  setSystemGain: (val: number) => void
  /** 动态调节麦克风增益（0–1.5） */
  setMicGain: (val: number) => void
  /** 读取当前实时归一化音量电平（0–1） */
  readLevel: () => number
  /** 彻底关闭 AudioContext */
  close: () => void
}

export function createAudioMixer(
  systemStream: MediaStream | null,
  micStream: MediaStream | null,
  initialSystemGain = 1,
  initialMicGain = 1,
): AudioMixerHandle {
  const sysTracks = systemStream?.getAudioTracks() ?? []
  const micTracks = micStream?.getAudioTracks() ?? []

  if (sysTracks.length === 0 && micTracks.length === 0) {
    return {
      audioTrack: null,
      setSystemGain: () => {},
      setMicGain: () => {},
      readLevel: () => 0,
      close: () => {},
    }
  }

  const AudioCtx =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AudioCtx()
  const dest = ctx.createMediaStreamDestination()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 256
  const sampleBuf = new Uint8Array(analyser.frequencyBinCount)

  let sysGainNode: GainNode | null = null
  let micGainNode: GainNode | null = null

  if (sysTracks.length > 0) {
    const sysSrc = ctx.createMediaStreamSource(new MediaStream(sysTracks))
    sysGainNode = ctx.createGain()
    sysGainNode.gain.value = initialSystemGain
    sysSrc.connect(sysGainNode)
    sysGainNode.connect(dest)
    sysGainNode.connect(analyser)
  }

  if (micTracks.length > 0) {
    const micSrc = ctx.createMediaStreamSource(new MediaStream(micTracks))
    micGainNode = ctx.createGain()
    micGainNode.gain.value = initialMicGain
    micSrc.connect(micGainNode)
    micGainNode.connect(dest)
    micGainNode.connect(analyser)
  }

  // 某些浏览器需显式 resume AudioContext
  ctx.resume().catch(() => {})

  return {
    audioTrack: dest.stream.getAudioTracks()[0] ?? null,
    setSystemGain: (val) => {
      if (sysGainNode) sysGainNode.gain.setTargetAtTime(Math.max(0, val), ctx.currentTime, 0.02)
    },
    setMicGain: (val) => {
      if (micGainNode) micGainNode.gain.setTargetAtTime(Math.max(0, val), ctx.currentTime, 0.02)
    },
    readLevel: () => {
      analyser.getByteTimeDomainData(sampleBuf)
      let sumSq = 0
      for (let i = 0; i < sampleBuf.length; i++) {
        const norm = (sampleBuf[i] - 128) / 128
        sumSq += norm * norm
      }
      const rms = Math.sqrt(sumSq / sampleBuf.length)
      return Math.min(1, rms * 3.2)
    },
    close: () => {
      ctx.close().catch(() => {})
    },
  }
}

// ============================================================================
// 后台防节流 Worker 定时器（解决切屏录画中画时 requestAnimationFrame 冻结的问题）
// ============================================================================

interface TickerHandle {
  stop: () => void
}

function createWorkerTicker(fps: number, onTick: () => void): TickerHandle {
  const intervalMs = Math.max(12, Math.round(1000 / Math.max(10, Math.min(60, fps))))
  try {
    const code = `
      let timer = null;
      self.onmessage = (e) => {
        if (e.data.cmd === 'start') {
          if (timer) clearInterval(timer);
          timer = setInterval(() => self.postMessage(0), e.data.ms);
        } else if (e.data.cmd === 'stop') {
          if (timer) clearInterval(timer);
          timer = null;
        }
      };
    `
    const blob = new Blob([code], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    const worker = new Worker(url)
    worker.onmessage = () => onTick()
    worker.postMessage({ cmd: 'start', ms: intervalMs })
    return {
      stop: () => {
        worker.postMessage({ cmd: 'stop' })
        worker.terminate()
        URL.revokeObjectURL(url)
      },
    }
  } catch {
    // 若 CSP 禁止 Blob Worker，优雅回退到 setInterval
    const id = window.setInterval(onTick, intervalMs)
    return {
      stop: () => window.clearInterval(id),
    }
  }
}

// ============================================================================
// Canvas 2D 画中画实时合成器（屏幕主画面 + 摄像头人像浮窗）
// ============================================================================

export interface PipLayoutConfig {
  shape: PipShape
  corner: PipCorner
  /** 摄像头浮窗宽占主画布宽度的比例（0.12–0.36） */
  scale: number
  mirrorCamera: boolean
  filterCss: string
}

export interface PipCompositorHandle {
  stream: MediaStream
  updateLayout: (next: PipLayoutConfig) => void
  destroy: () => void
}

export async function createPipCompositor(
  screenStream: MediaStream,
  cameraStream: MediaStream,
  fps: number,
  initialLayout: PipLayoutConfig,
): Promise<PipCompositorHandle> {
  const screenVideo = document.createElement('video')
  screenVideo.muted = true
  screenVideo.playsInline = true
  screenVideo.srcObject = screenStream

  const camVideo = document.createElement('video')
  camVideo.muted = true
  camVideo.playsInline = true
  camVideo.srcObject = cameraStream

  await Promise.all([
    screenVideo.play().catch(() => {}),
    camVideo.play().catch(() => {}),
  ])

  // 等待主屏幕视频拿到真实分辨率
  const waitDims = async (v: HTMLVideoElement, fallbackW: number, fallbackH: number) => {
    for (let i = 0; i < 30; i++) {
      if (v.videoWidth > 0 && v.videoHeight > 0) return { w: v.videoWidth, h: v.videoHeight }
      await new Promise((r) => setTimeout(r, 50))
    }
    return { w: fallbackW, h: fallbackH }
  }

  const { w: rawW, h: rawH } = await waitDims(screenVideo, 1920, 1080)
  // 限制最高 1920px 宽以保证多轨实时合成 30/60fps 流畅
  const scaleDown = Math.min(1, 1920 / Math.max(1, rawW))
  const canvasW = Math.max(640, Math.round((rawW * scaleDown) / 2) * 2)
  const canvasH = Math.max(360, Math.round((rawH * scaleDown) / 2) * 2)

  const canvas = document.createElement('canvas')
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext('2d')!

  let layout = { ...initialLayout }

  const drawFrame = () => {
    ctx.fillStyle = '#09090b'
    ctx.fillRect(0, 0, canvasW, canvasH)

    if (screenVideo.readyState >= 2) {
      ctx.drawImage(screenVideo, 0, 0, canvasW, canvasH)
    }

    if (camVideo.readyState >= 2 && camVideo.videoWidth > 0) {
      const margin = Math.round(canvasW * 0.025)
      const pipW = Math.round(canvasW * Math.max(0.12, Math.min(0.38, layout.scale)))
      const pipH = layout.shape === 'circle' ? pipW : Math.round((pipW * 9) / 16)

      let px = canvasW - pipW - margin
      let py = canvasH - pipH - margin
      if (layout.corner === 'bottom-left') {
        px = margin
        py = canvasH - pipH - margin
      } else if (layout.corner === 'top-right') {
        px = canvasW - pipW - margin
        py = margin
      } else if (layout.corner === 'top-left') {
        px = margin
        py = margin
      }

      // 裁切居中 cover 比例
      const cw = camVideo.videoWidth
      const ch = camVideo.videoHeight
      const targetRatio = pipW / pipH
      const camRatio = cw / ch
      let sx = 0
      let sy = 0
      let sw = cw
      let sh = ch
      if (camRatio > targetRatio) {
        sw = ch * targetRatio
        sx = (cw - sw) / 2
      } else {
        sh = cw / targetRatio
        sy = (ch - sh) / 2
      }

      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.45)'
      ctx.shadowBlur = 18
      ctx.shadowOffsetY = 6

      const traceClip = () => {
        ctx.beginPath()
        if (layout.shape === 'circle') {
          ctx.arc(px + pipW / 2, py + pipH / 2, pipW / 2, 0, Math.PI * 2)
        } else {
          const r = Math.round(pipH * 0.14)
          ctx.roundRect(px, py, pipW, pipH, r)
        }
        ctx.closePath()
      }

      traceClip()
      ctx.fillStyle = '#18181b'
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.clip()

      if (layout.filterCss && layout.filterCss !== 'none') {
        ctx.filter = layout.filterCss
      }
      if (layout.mirrorCamera) {
        ctx.translate(px + pipW, py)
        ctx.scale(-1, 1)
        ctx.drawImage(camVideo, sx, sy, sw, sh, 0, 0, pipW, pipH)
      } else {
        ctx.drawImage(camVideo, sx, sy, sw, sh, px, py, pipW, pipH)
      }
      ctx.restore()

      // 精致白边描边
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.88)'
      ctx.lineWidth = Math.max(3, Math.round(canvasW * 0.0028))
      ctx.beginPath()
      if (layout.shape === 'circle') {
        ctx.arc(px + pipW / 2, py + pipH / 2, pipW / 2 - ctx.lineWidth / 2, 0, Math.PI * 2)
      } else {
        const r = Math.round(pipH * 0.14)
        ctx.roundRect(px, py, pipW, pipH, r)
      }
      ctx.stroke()
      ctx.restore()
    }
  }

  drawFrame()
  const ticker = createWorkerTicker(fps, drawFrame)
  const stream = canvas.captureStream(fps)

  return {
    stream,
    updateLayout: (next) => {
      layout = { ...next }
    },
    destroy: () => {
      ticker.stop()
      stopMediaStream(stream)
      screenVideo.srcObject = null
      camVideo.srcObject = null
    },
  }
}

/** 对当前 <video> 画面执行高清抓拍（自动应用镜像与摄像头滤镜） */
export async function captureVideoSnapshot(
  video: HTMLVideoElement,
  options: { mirror?: boolean; filterCss?: string } = {},
): Promise<{ blob: Blob; width: number; height: number }> {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) {
    throw new Error('当前暂无可拍摄的画面')
  }
  const canvas = document.createElement('canvas')
  canvas.width = vw
  canvas.height = vh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建拍照画布')

  ctx.save()
  if (options.filterCss && options.filterCss !== 'none') {
    ctx.filter = options.filterCss
  }
  if (options.mirror) {
    ctx.translate(vw, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(video, 0, 0, vw, vh)
  ctx.restore()

  const blob = await canvasToBlob(canvas, 'image/png')
  return { blob, width: vw, height: vh }
}

/** 格式化录制时长 HH:MM:SS 或 MM:SS */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}
