import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Camera,
  Check,
  Circle,
  Copy,
  Download,
  Film,
  FlipHorizontal2,
  Image as ImageIcon,
  Mic,
  MicOff,
  Monitor,
  MonitorPlay,
  Pause,
  PictureInPicture,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Timer,
  Trash2,
  Video,
  Volume2,
  X,
} from 'lucide-react'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { Button } from '@/components/ui/button'
import { Field, Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { Slider } from '@/components/ui/slider'
import { copyImageToClipboard, downloadBlob, timestampName } from '@/lib/file'
import { cn, formatBytes } from '@/lib/utils'
import {
  BITRATE_PRESETS,
  CAMERA_FILTERS,
  captureVideoSnapshot,
  createAudioMixer,
  createPipCompositor,
  detectMediaSupport,
  formatDuration,
  listMediaDevices,
  resolveRecordingMime,
  stopMediaStream,
  type AudioMixerHandle,
  type CameraFilterId,
  type CaptureMode,
  type ContainerFormat,
  type PipCompositorHandle,
  type PipCorner,
  type PipShape,
} from './engine'

interface RecordedClip {
  id: string
  name: string
  url: string
  blob: Blob
  ext: 'mp4' | 'webm'
  mimeLabel: string
  durationSec: number
  size: number
  width: number
  height: number
  createdAt: string
}

interface CapturedPhoto {
  id: string
  name: string
  url: string
  blob: Blob
  width: number
  height: number
  size: number
  createdAt: string
}

type StageState = 'idle' | 'preview' | 'countdown' | 'recording' | 'paused'
type GalleryTab = 'videos' | 'photos'

const MODE_CARDS: { id: CaptureMode; label: string; desc: string; icon: typeof Monitor }[] = [
  { id: 'screen', label: '纯屏幕录制', desc: '全屏 / 窗口 / 标签页', icon: Monitor },
  { id: 'screen-cam', label: '画中画讲解', desc: '屏幕 + 摄像头人像', icon: PictureInPicture },
  { id: 'camera', label: '摄像头拍照/录像', desc: '滤镜自拍 · 本地录像', icon: Camera },
]

const PIP_CORNERS: { id: PipCorner; label: string }[] = [
  { id: 'top-left', label: '左上' },
  { id: 'top-right', label: '右上' },
  { id: 'bottom-left', label: '左下' },
  { id: 'bottom-right', label: '右下' },
]

function nowTimeStr(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export default function ScreenRecorderTool() {
  const support = useMemo(() => detectMediaSupport(), [])

  // 核心采集与录制参数
  const [mode, setMode] = useState<CaptureMode>('screen')
  const [stage, setStage] = useState<StageState>('idle')
  const [countdownVal, setCountdownVal] = useState(0)
  const [enableCountdown, setEnableCountdown] = useState(true)

  // 视频编码参数
  const [formatPref, setFormatPref] = useState<ContainerFormat>('auto')
  const [fps, setFps] = useState<number>(30)
  const [bitrateId, setBitrateId] = useState<string>('hd')

  // 音频混音参数
  const [captureSystemAudio, setCaptureSystemAudio] = useState(true)
  const [captureMic, setCaptureMic] = useState(true)
  const [systemGain, setSystemGain] = useState(100)
  const [micGain, setMicGain] = useState(100)
  const [audioLevel, setAudioLevel] = useState(0)

  // 设备与摄像头/画中画参数
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState('')
  const [selectedMicId, setSelectedMicId] = useState('')
  const [mirrorCamera, setMirrorCamera] = useState(true)
  const [cameraFilter, setCameraFilter] = useState<CameraFilterId>('none')
  const [pipShape, setPipShape] = useState<PipShape>('circle')
  const [pipCorner, setPipCorner] = useState<PipCorner>('bottom-right')
  const [pipScale, setPipScale] = useState(20) // 占主画布宽度百分比

  // 实时录制遥测
  const [elapsedSec, setElapsedSec] = useState(0)
  const [recordedBytes, setRecordedBytes] = useState(0)
  const [activeRes, setActiveRes] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

  // 产物清单与灯箱
  const [galleryTab, setGalleryTab] = useState<GalleryTab>('videos')
  const [clips, setClips] = useState<RecordedClip[]>([])
  const [photos, setPhotos] = useState<CapturedPhoto[]>([])
  const [lightboxPhoto, setLightboxPhoto] = useState<CapturedPhoto | null>(null)
  const [copiedPhotoId, setCopiedPhotoId] = useState<string | null>(null)
  const [shutterFlash, setShutterFlash] = useState(false)

  // 底层媒体流与录制句柄
  const previewVideoRef = useRef<HTMLVideoElement>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const camStreamRef = useRef<MediaStream | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const previewStreamRef = useRef<MediaStream | null>(null)
  const audioMixerRef = useRef<AudioMixerHandle | null>(null)
  const pipCompositorRef = useRef<PipCompositorHandle | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const levelRafRef = useRef<number | null>(null)
  const elapsedRef = useRef(0)
  const countdownCancelRef = useRef<(() => void) | null>(null)

  const filterCss = useMemo(
    () => CAMERA_FILTERS.find((f) => f.id === cameraFilter)?.css ?? 'none',
    [cameraFilter],
  )
  const resolvedMime = useMemo(() => resolveRecordingMime(formatPref, support), [formatPref, support])
  const selectedBitrate = useMemo(
    () => BITRATE_PRESETS.find((b) => b.id === bitrateId) ?? BITRATE_PRESETS[2],
    [bitrateId],
  )

  const refreshDevices = useCallback(async () => {
    const { cameras: c, mics: m } = await listMediaDevices()
    setCameras(c)
    setMics(m)
  }, [])

  useEffect(() => {
    void refreshDevices()
  }, [refreshDevices])

  // 清理全部已生成的 Blob URL（组件卸载时）
  const clipsRef = useRef(clips)
  clipsRef.current = clips
  const photosRef = useRef(photos)
  photosRef.current = photos

  /** 彻底释放所有采集流、混音器、画中画合成器与计时器 */
  const releaseCaptureResources = useCallback(() => {
    countdownCancelRef.current?.()
    countdownCancelRef.current = null

    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (levelRafRef.current !== null) {
      cancelAnimationFrame(levelRafRef.current)
      levelRafRef.current = null
    }

    pipCompositorRef.current?.destroy()
    pipCompositorRef.current = null

    audioMixerRef.current?.close()
    audioMixerRef.current = null

    stopMediaStream(screenStreamRef.current)
    screenStreamRef.current = null
    stopMediaStream(camStreamRef.current)
    camStreamRef.current = null
    stopMediaStream(micStreamRef.current)
    micStreamRef.current = null
    previewStreamRef.current = null

    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = null
    }
    setAudioLevel(0)
    setActiveRes({ w: 0, h: 0 })
  }, [])

  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop()
        } catch {
          // ignore
        }
      }
      releaseCaptureResources()
      clipsRef.current.forEach((c) => URL.revokeObjectURL(c.url))
      photosRef.current.forEach((p) => URL.revokeObjectURL(p.url))
    }
  }, [releaseCaptureResources])

  // 实时同步画中画布局参数到正在运行的合成器
  useEffect(() => {
    pipCompositorRef.current?.updateLayout({
      shape: pipShape,
      corner: pipCorner,
      scale: pipScale / 100,
      mirrorCamera,
      filterCss,
    })
  }, [pipShape, pipCorner, pipScale, mirrorCamera, filterCss])

  // 实时同步音量滑块到正在运行的混音器
  useEffect(() => {
    audioMixerRef.current?.setSystemGain(systemGain / 100)
  }, [systemGain])

  useEffect(() => {
    audioMixerRef.current?.setMicGain(micGain / 100)
  }, [micGain])

  /** 启动音频电平表刷新循环 */
  const startAudioLevelLoop = useCallback(() => {
    if (levelRafRef.current !== null) cancelAnimationFrame(levelRafRef.current)
    const tick = () => {
      const mixer = audioMixerRef.current
      if (mixer) {
        setAudioLevel(mixer.readLevel())
      } else {
        setAudioLevel(0)
      }
      levelRafRef.current = requestAnimationFrame(tick)
    }
    levelRafRef.current = requestAnimationFrame(tick)
  }, [])

  /** 停止录制并生成本地视频文件 */
  const stopRecording = useCallback(() => {
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop()
      } catch {
        // ignore
      }
    }
  }, [])

  /**
   * 准备采集源（屏幕 / 画中画 / 摄像头 + 混音器）并输出到实时预览画面
   */
  const prepareStreams = useCallback(
    async (targetMode: CaptureMode): Promise<MediaStream> => {
      releaseCaptureResources()

      let screenStream: MediaStream | null = null
      let camStream: MediaStream | null = null
      let micStream: MediaStream | null = null

      try {
        // 1. 采集屏幕
        if (targetMode === 'screen' || targetMode === 'screen-cam') {
          if (!support.canDisplayMedia) {
            throw new Error('当前浏览器不支持屏幕捕获（请使用桌面端 Chrome / Edge / Firefox，并确保在 HTTPS 或 localhost 下访问）')
          }
          screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              frameRate: { ideal: fps, max: 60 },
            },
            audio: captureSystemAudio,
          })
          screenStreamRef.current = screenStream
        }

        // 2. 采集摄像头
        if (targetMode === 'camera' || targetMode === 'screen-cam') {
          if (!support.canUserMedia) {
            throw new Error('当前浏览器不支持摄像头访问')
          }
          camStream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: selectedCameraId ? { exact: selectedCameraId } : undefined,
              width: { ideal: targetMode === 'camera' ? 1920 : 640 },
              height: { ideal: targetMode === 'camera' ? 1080 : 480 },
              frameRate: { ideal: fps },
            },
            audio: false,
          })
          camStreamRef.current = camStream
        }

        // 3. 采集麦克风
        if (captureMic && support.canUserMedia) {
          try {
            micStream = await navigator.mediaDevices.getUserMedia({
              audio: {
                deviceId: selectedMicId ? { exact: selectedMicId } : undefined,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
              video: false,
            })
            micStreamRef.current = micStream
          } catch {
            toast.warning('未能打开麦克风，将继续无麦克风录制')
          }
        }

        // 获取权限后顺便刷新设备名称列表
        void refreshDevices()

        // 4. 组装视频轨
        let videoTrack: MediaStreamTrack | null = null
        if (targetMode === 'screen-cam' && screenStream && camStream) {
          const compositor = await createPipCompositor(screenStream, camStream, fps, {
            shape: pipShape,
            corner: pipCorner,
            scale: pipScale / 100,
            mirrorCamera,
            filterCss,
          })
          pipCompositorRef.current = compositor
          videoTrack = compositor.stream.getVideoTracks()[0] ?? null
        } else if (targetMode === 'screen' && screenStream) {
          videoTrack = screenStream.getVideoTracks()[0] ?? null
        } else if (targetMode === 'camera' && camStream) {
          videoTrack = camStream.getVideoTracks()[0] ?? null
        }

        if (!videoTrack) {
          throw new Error('未获取到有效视频轨道')
        }

        // 5. 组装双轨混音器（系统音 + 麦克风）
        const mixer = createAudioMixer(screenStream, micStream, systemGain / 100, micGain / 100)
        audioMixerRef.current = mixer
        startAudioLevelLoop()

        const finalTracks: MediaStreamTrack[] = [videoTrack]
        if (mixer.audioTrack) finalTracks.push(mixer.audioTrack)
        const combined = new MediaStream(finalTracks)
        previewStreamRef.current = combined

        // 挂载预览（必须 muted 防止扬声器啸叫回声！）
        if (previewVideoRef.current) {
          previewVideoRef.current.srcObject = combined
          await previewVideoRef.current.play().catch(() => {})
          const settings = videoTrack.getSettings()
          if (settings.width && settings.height) {
            setActiveRes({ w: settings.width, h: settings.height })
          }
        }

        // 监听浏览器原生「停止共享」按钮：正在录制时自动保存收尾，预览时回到空闲态
        const primaryTrack = screenStream?.getVideoTracks()[0] ?? camStream?.getVideoTracks()[0]
        if (primaryTrack) {
          primaryTrack.onended = () => {
            if (recorderRef.current && recorderRef.current.state !== 'inactive') {
              stopRecording()
            } else {
              releaseCaptureResources()
              setStage('idle')
            }
          }
        }

        return combined
      } catch (err) {
        releaseCaptureResources()
        throw err
      }
    },
    [
      releaseCaptureResources,
      support,
      fps,
      captureSystemAudio,
      selectedCameraId,
      captureMic,
      selectedMicId,
      refreshDevices,
      pipShape,
      pipCorner,
      pipScale,
      mirrorCamera,
      filterCss,
      systemGain,
      micGain,
      startAudioLevelLoop,
      stopRecording,
    ],
  )

  /** 仅开启实时预览（摄像头拍照 / 录屏前检查画面与音量） */
  const handleStartPreview = async () => {
    try {
      await prepareStreams(mode)
      setStage('preview')
      toast.success(mode === 'camera' ? '摄像头已就绪，可直接拍照或点击开始录像' : '预览已就绪，可核对画中画与音量后开始录制')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        toast.info('已取消设备或屏幕授权')
      } else {
        toast.error(err instanceof Error ? err.message : '打开采集设备失败')
      }
      setStage('idle')
    }
  }

  /** 启动真正的 MediaRecorder 录制流程（支持 3 秒倒计时） */
  const handleStartRecording = async () => {
    if (!support.canMediaRecorder) {
      toast.error('当前浏览器不支持 MediaRecorder 录制')
      return
    }

    let stream = previewStreamRef.current
    if (!stream || stream.getVideoTracks().every((t) => t.readyState === 'ended')) {
      try {
        stream = await prepareStreams(mode)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          toast.info('已取消录制授权')
        } else {
          toast.error(err instanceof Error ? err.message : '启动录制失败')
        }
        setStage('idle')
        return
      }
    }

    // 若开启 3 秒倒计时，先走倒计时再真正录制
    if (enableCountdown) {
      setStage('countdown')
      const completed = await new Promise<boolean>((resolve) => {
        let left = 3
        setCountdownVal(left)
        const id = window.setInterval(() => {
          left -= 1
          if (left <= 0) {
            window.clearInterval(id)
            countdownCancelRef.current = null
            setCountdownVal(0)
            resolve(true)
          } else {
            setCountdownVal(left)
          }
        }, 1000)
        countdownCancelRef.current = () => {
          window.clearInterval(id)
          setCountdownVal(0)
          resolve(false)
        }
      })
      if (!completed) return
    }

    const activeStream = previewStreamRef.current
    if (!activeStream) {
      setStage('idle')
      return
    }

    // 创建 MediaRecorder
    const options: MediaRecorderOptions = {
      videoBitsPerSecond: selectedBitrate.bps,
      audioBitsPerSecond: 128_000,
    }
    if (resolvedMime.mimeType) {
      options.mimeType = resolvedMime.mimeType
    }

    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(activeStream, options)
    } catch {
      recorder = new MediaRecorder(activeStream)
    }

    chunksRef.current = []
    setRecordedBytes(0)
    setElapsedSec(0)
    elapsedRef.current = 0

    const usedExt = resolvedMime.ext
    const usedLabel = resolvedMime.label
    const fallbackMime = recorder.mimeType || resolvedMime.mimeType || 'video/webm'

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data)
        setRecordedBytes((prev) => prev + e.data.size)
      }
    }

    recorder.onstop = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      const blob = new Blob(chunksRef.current, { type: fallbackMime })
      chunksRef.current = []
      recorderRef.current = null

      if (blob.size > 0) {
        const videoEl = previewVideoRef.current
        const w = videoEl?.videoWidth || activeRes.w || 1920
        const h = videoEl?.videoHeight || activeRes.h || 1080
        const clip: RecordedClip = {
          id: `clip-${Date.now()}`,
          name: timestampName(mode === 'camera' ? 'camera-video' : 'screen-record', usedExt),
          url: URL.createObjectURL(blob),
          blob,
          ext: usedExt,
          mimeLabel: usedLabel,
          durationSec: Math.max(1, elapsedRef.current),
          size: blob.size,
          width: w,
          height: h,
          createdAt: nowTimeStr(),
        }
        setClips((prev) => [clip, ...prev])
        setGalleryTab('videos')
        toast.success(`录制完成（${formatDuration(clip.durationSec)} · ${formatBytes(clip.size)}）`)
      }

      // 摄像头模式下保留实时预览方便继续拍；录屏模式自动释放共享提示条
      if (mode === 'camera' && camStreamRef.current?.getVideoTracks().some((t) => t.readyState === 'live')) {
        setStage('preview')
      } else {
        releaseCaptureResources()
        setStage('idle')
      }
    }

    recorder.onerror = () => {
      toast.error('录制过程中发生编码异常')
      stopRecording()
    }

    recorderRef.current = recorder
    recorder.start(1000)
    setStage('recording')

    timerRef.current = setInterval(() => {
      if (recorderRef.current?.state === 'recording') {
        elapsedRef.current += 1
        setElapsedSec(elapsedRef.current)
      }
    }, 1000)
  }

  /** 暂停 / 恢复录制 */
  const handleTogglePause = () => {
    const rec = recorderRef.current
    if (!rec) return
    if (rec.state === 'recording') {
      rec.pause()
      setStage('paused')
      toast.info('已暂停录制')
    } else if (rec.state === 'paused') {
      rec.resume()
      setStage('recording')
      toast.success('已继续录制')
    }
  }

  /** 拍照或录制中抓拍当前帧 */
  const handleTakePhoto = async (withDelay = false) => {
    const video = previewVideoRef.current
    if (!video || !previewStreamRef.current) {
      toast.error('请先打开摄像头或预览画面')
      return
    }

    if (withDelay && stage === 'preview') {
      setStage('countdown')
      const ok = await new Promise<boolean>((resolve) => {
        let left = 3
        setCountdownVal(left)
        const id = window.setInterval(() => {
          left -= 1
          if (left <= 0) {
            window.clearInterval(id)
            countdownCancelRef.current = null
            setCountdownVal(0)
            resolve(true)
          } else {
            setCountdownVal(left)
          }
        }, 1000)
        countdownCancelRef.current = () => {
          window.clearInterval(id)
          setCountdownVal(0)
          resolve(false)
        }
      })
      setStage('preview')
      if (!ok) return
    }

    try {
      setShutterFlash(true)
      setTimeout(() => setShutterFlash(false), 180)
      const isCamOnly = mode === 'camera'
      const { blob, width, height } = await captureVideoSnapshot(video, {
        mirror: isCamOnly ? mirrorCamera : false,
        filterCss: isCamOnly ? filterCss : 'none',
      })
      const photo: CapturedPhoto = {
        id: `photo-${Date.now()}`,
        name: timestampName(isCamOnly ? 'camera-photo' : 'screen-shot', 'png'),
        url: URL.createObjectURL(blob),
        blob,
        width,
        height,
        size: blob.size,
        createdAt: nowTimeStr(),
      }
      setPhotos((prev) => [photo, ...prev])
      if (stage !== 'recording' && stage !== 'paused') {
        setGalleryTab('photos')
      }
      toast.success(`已拍摄高清照片（${width} × ${height}）`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '抓拍失败')
    }
  }

  /** 切换模式（录制中锁定切换） */
  const handleChangeMode = (next: CaptureMode) => {
    if (stage === 'recording' || stage === 'paused' || stage === 'countdown') {
      toast.warning('请先停止当前录制再切换模式')
      return
    }
    if (next === mode) return
    releaseCaptureResources()
    setStage('idle')
    setMode(next)
  }

  const isBusyRecording = stage === 'recording' || stage === 'paused' || stage === 'countdown'

  // ============================================================================
  // 左侧参数控制面板
  // ============================================================================
  const panel = (
    <div className="space-y-6">
      {/* 1. 采集模式 */}
      <div className="space-y-2">
        <div className="text-foreground/80 text-sm font-medium">录制 / 拍摄模式</div>
        <div className="space-y-2">
          {MODE_CARDS.map((item) => {
            const Icon = item.icon
            const active = mode === item.id
            return (
              <button
                key={item.id}
                type="button"
                disabled={isBusyRecording}
                onClick={() => handleChangeMode(item.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all disabled:opacity-50',
                  active
                    ? 'border-primary bg-primary/10 text-foreground shadow-xs'
                    : 'border-border/60 bg-background/40 text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-lg',
                    active ? 'bg-primary text-primary-foreground' : 'bg-foreground/[0.06] text-foreground/70',
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold">{item.label}</span>
                  <span className="text-muted-foreground block truncate text-[10px]">{item.desc}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <hr className="border-border/60" />

      {/* 2. 音频与混音设置 */}
      <div className="space-y-4">
        <div className="text-foreground/80 text-xs font-semibold tracking-wider uppercase">音频混音</div>

        {mode !== 'camera' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground/80 flex items-center gap-1.5 font-medium">
                <Volume2 className="size-3.5" />
                录制系统 / 标签页声音
              </span>
              <Switch
                checked={captureSystemAudio}
                onChange={setCaptureSystemAudio}
                label="录制系统音频"
              />
            </div>
            {captureSystemAudio && (
              <Field label="系统音量" value={`${systemGain}%`}>
                <Slider value={systemGain} onChange={setSystemGain} min={0} max={150} step={5} />
              </Field>
            )}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground/80 flex items-center gap-1.5 font-medium">
              {captureMic ? <Mic className="size-3.5 text-emerald-500" /> : <MicOff className="size-3.5" />}
              录制麦克风人声
            </span>
            <Switch checked={captureMic} onChange={setCaptureMic} label="录制麦克风" />
          </div>
          {captureMic && (
            <>
              {mics.length > 0 && (
                <select
                  value={selectedMicId}
                  disabled={isBusyRecording}
                  onChange={(e) => setSelectedMicId(e.target.value)}
                  className="border-border/70 bg-background/60 w-full rounded-xl border px-2.5 py-1.5 text-xs outline-none"
                >
                  <option value="">默认麦克风</option>
                  {mics.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `麦克风 ${i + 1}`}
                    </option>
                  ))}
                </select>
              )}
              <Field label="麦克风增益" value={`${micGain}%`}>
                <Slider value={micGain} onChange={setMicGain} min={0} max={150} step={5} />
              </Field>
            </>
          )}
        </div>

        {/* 实时音频电平表 */}
        {(stage === 'preview' || stage === 'recording' || stage === 'paused') && (
          <div className="space-y-1">
            <div className="text-muted-foreground flex justify-between text-[11px]">
              <span>实时混音电平</span>
              <span className="font-mono">{Math.round(audioLevel * 100)}%</span>
            </div>
            <div className="bg-foreground/10 h-2 overflow-hidden rounded-full">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-75',
                  audioLevel > 0.85 ? 'bg-red-500' : audioLevel > 0.55 ? 'bg-amber-500' : 'bg-emerald-500',
                )}
                style={{ width: `${Math.min(100, Math.round(audioLevel * 100))}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 3. 摄像头 / 画中画参数 */}
      {(mode === 'camera' || mode === 'screen-cam') && (
        <>
          <hr className="border-border/60" />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-foreground/80 text-xs font-semibold tracking-wider uppercase">
                {mode === 'screen-cam' ? '画中画人像设置' : '摄像头与滤镜'}
              </span>
              <button
                type="button"
                onClick={refreshDevices}
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11px]"
              >
                <RefreshCw className="size-3" />
                刷新设备
              </button>
            </div>

            {cameras.length > 0 && (
              <Field label="摄像头设备">
                <select
                  value={selectedCameraId}
                  disabled={isBusyRecording}
                  onChange={(e) => setSelectedCameraId(e.target.value)}
                  className="border-border/70 bg-background/60 w-full rounded-xl border px-2.5 py-1.5 text-xs outline-none"
                >
                  <option value="">默认摄像头</option>
                  {cameras.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `摄像头 ${i + 1}`}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground/80 flex items-center gap-1.5 font-medium">
                <FlipHorizontal2 className="size-3.5" />
                摄像头镜像翻转
              </span>
              <Switch checked={mirrorCamera} onChange={setMirrorCamera} label="摄像头镜像" />
            </div>

            {mode === 'screen-cam' && (
              <>
                <Field label="人像外框形状">
                  <Segmented<PipShape>
                    size="sm"
                    value={pipShape}
                    onChange={setPipShape}
                    options={[
                      { value: 'circle', label: '圆形头像' },
                      { value: 'rounded', label: '16:9 圆角窗' },
                    ]}
                  />
                </Field>

                <Field label="人像停靠角落">
                  <div className="grid grid-cols-4 gap-1.5">
                    {PIP_CORNERS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setPipCorner(c.id)}
                        className={cn(
                          'rounded-lg border py-1.5 text-xs font-medium transition-colors',
                          pipCorner === c.id
                            ? 'border-primary bg-primary/12 text-primary'
                            : 'border-border/60 bg-background/40 text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="人像窗口占比" value={`${pipScale}%`}>
                  <Slider value={pipScale} onChange={setPipScale} min={12} max={34} step={1} />
                </Field>
              </>
            )}

            <Field label="实时画面滤镜">
              <div className="flex flex-wrap gap-1.5">
                {CAMERA_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setCameraFilter(f.id)}
                    className={cn(
                      'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                      cameraFilter === f.id
                        ? 'border-primary bg-primary/12 text-primary'
                        : 'border-border/60 bg-background/40 text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </>
      )}

      <hr className="border-border/60" />

      {/* 4. 视频规格与导出格式 */}
      <div className="space-y-4">
        <div className="text-foreground/80 text-xs font-semibold tracking-wider uppercase">录制规格</div>

        <Field label="输出格式" value={resolvedMime.label}>
          <Segmented<ContainerFormat>
            size="sm"
            value={formatPref}
            onChange={setFormatPref}
            options={[
              { value: 'auto', label: '自动推荐' },
              { value: 'mp4', label: support.mp4Mime ? 'MP4' : 'MP4(不支持)' },
              { value: 'webm', label: 'WebM' },
            ]}
          />
        </Field>

        <Field label="目标帧率" value={`${fps} fps`}>
          <Segmented<string>
            size="sm"
            value={String(fps)}
            onChange={(v) => setFps(Number(v))}
            options={[
              { value: '24', label: '24 fps' },
              { value: '30', label: '30 fps' },
              { value: '60', label: '60 fps' },
            ]}
          />
        </Field>

        <Field label="视频码率" value={selectedBitrate.desc}>
          <div className="grid grid-cols-2 gap-1.5">
            {BITRATE_PRESETS.map((b) => (
              <button
                key={b.id}
                type="button"
                disabled={isBusyRecording}
                onClick={() => setBitrateId(b.id)}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors disabled:opacity-50',
                  bitrateId === b.id
                    ? 'border-primary bg-primary/10 text-foreground font-semibold'
                    : 'border-border/50 bg-background/40 text-muted-foreground hover:text-foreground',
                )}
              >
                {b.label}
              </button>
            ))}
          </div>
        </Field>

        <div className="flex items-center justify-between text-sm">
          <span className="text-foreground/80 flex items-center gap-1.5 font-medium">
            <Timer className="size-3.5" />
            录制前 3 秒倒计时
          </span>
          <Switch checked={enableCountdown} onChange={setEnableCountdown} label="3秒倒计时" />
        </div>
      </div>
    </div>
  )

  const actions = (
    <>
      {stage === 'idle' || stage === 'preview' ? (
        <Button
          variant="primary"
          size="md"
          disabled={!support.isSecureContext || !support.canMediaRecorder}
          onClick={handleStartRecording}
        >
          <Circle className="fill-current" />
          开始录制
        </Button>
      ) : stage === 'countdown' ? (
        <Button
          variant="danger"
          size="md"
          onClick={() => {
            countdownCancelRef.current?.()
            setStage(previewStreamRef.current ? 'preview' : 'idle')
          }}
        >
          <X />
          取消倒计时
        </Button>
      ) : (
        <>
          <Button variant="outline" size="md" onClick={handleTogglePause}>
            {stage === 'paused' ? <Play /> : <Pause />}
            {stage === 'paused' ? '继续' : '暂停'}
          </Button>
          <Button variant="danger" size="md" onClick={stopRecording}>
            <Square className="fill-current" />
            停止保存
          </Button>
        </>
      )}
    </>
  )

  return (
    <ToolShell panel={panel} actions={actions} panelTitle="录制与拍摄参数">
      <div className="space-y-4">
        {/* 非安全上下文警告（局域网 HTTP 时浏览器禁止录屏与摄像头） */}
        {!support.isSecureContext && (
          <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1 leading-relaxed">
              <div className="font-semibold">当前页面处于非安全上下文（HTTP）</div>
              <p>
                浏览器安全策略要求在 <code>localhost</code> 或 <strong>HTTPS</strong> 环境下才开放屏幕录制与摄像头权限。若为局域网部署，请通过 HTTPS 访问或在本机打开。
              </p>
            </div>
          </div>
        )}

        {/* 主实时监视器舞台 */}
        <div className="glass shadow-soft overflow-hidden rounded-2xl">
          <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-neutral-950">
            <video
              ref={previewVideoRef}
              muted
              playsInline
              autoPlay
              style={{
                transform: mode === 'camera' && mirrorCamera ? 'scaleX(-1)' : undefined,
                filter: mode === 'camera' && filterCss !== 'none' ? filterCss : undefined,
              }}
              className={cn(
                'h-full w-full object-contain transition-opacity duration-200',
                stage === 'idle' ? 'opacity-0' : 'opacity-100',
              )}
            />

            {/* 快门闪白动效 */}
            {shutterFlash && (
              <div className="pointer-events-none absolute inset-0 z-30 bg-white/85 transition-opacity" />
            )}

            {/* 空闲态欢迎与快捷入口 */}
            {stage === 'idle' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-white/85">
                <div className="flex size-16 items-center justify-center rounded-3xl bg-white/10 backdrop-blur">
                  {mode === 'camera' ? (
                    <Camera className="size-8" />
                  ) : mode === 'screen-cam' ? (
                    <PictureInPicture className="size-8" />
                  ) : (
                    <MonitorPlay className="size-8" />
                  )}
                </div>
                <div className="max-w-md space-y-1.5">
                  <div className="text-base font-semibold">
                    {mode === 'screen' && '准备录制屏幕、应用窗口或浏览器标签页'}
                    {mode === 'screen-cam' && '屏幕 + 摄像头画中画讲解模式'}
                    {mode === 'camera' && '摄像头高清拍照与本地录像'}
                  </div>
                  <p className="text-xs leading-relaxed text-white/60">
                    {mode === 'screen' && '支持同时混录系统声音与麦克风，切屏不影响录制，完成后直接本地生成 MP4/WebM。'}
                    {mode === 'screen-cam' && '后台独立节拍器实时合成画中画人像，录制过程中可随时调整头像形状与四角位置。'}
                    {mode === 'camera' && '支持镜像、5 款实时滤镜、3 秒倒计时自拍连拍及高清视频录制，100% 本地不上传。'}
                  </p>
                </div>

                <div className="flex flex-wrap justify-center gap-2.5">
                  {mode === 'camera' ? (
                    <Button variant="primary" size="md" onClick={handleStartPreview}>
                      <Camera />
                      打开摄像头预览
                    </Button>
                  ) : (
                    <>
                      <Button variant="primary" size="md" onClick={handleStartRecording}>
                        <Circle className="fill-current" />
                        直接开始录屏
                      </Button>
                      <Button
                        variant="outline"
                        size="md"
                        className="border-white/20 bg-white/10 text-white hover:bg-white/20"
                        onClick={handleStartPreview}
                      >
                        <Monitor />
                        先预览画面
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* 3 秒倒计时大字覆盖层 */}
            {stage === 'countdown' && countdownVal > 0 && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/55 backdrop-blur-xs">
                <div className="flex size-28 items-center justify-center rounded-full border-4 border-white/80 bg-red-600/90 font-mono text-6xl font-bold text-white shadow-2xl">
                  {countdownVal}
                </div>
                <span className="text-sm font-medium text-white/90">即将开始，可整理目标窗口...</span>
              </div>
            )}

            {/* 左上角状态 HUD */}
            {stage !== 'idle' && (
              <div className="pointer-events-none absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2">
                {stage === 'recording' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600/95 px-3 py-1 font-mono text-xs font-semibold text-white shadow">
                    <span className="size-2 animate-pulse rounded-full bg-white" />
                    REC {formatDuration(elapsedSec)}
                  </span>
                )}
                {stage === 'paused' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/95 px-3 py-1 font-mono text-xs font-semibold text-white shadow">
                    <Pause className="size-3" />
                    已暂停 {formatDuration(elapsedSec)}
                  </span>
                )}
                {stage === 'preview' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600/90 px-3 py-1 text-xs font-medium text-white shadow">
                    实时预览中
                  </span>
                )}
                {activeRes.w > 0 && (
                  <span className="rounded-full bg-black/65 px-2.5 py-1 font-mono text-[11px] text-white/90 backdrop-blur-xs">
                    {activeRes.w} × {activeRes.h}
                  </span>
                )}
                {(stage === 'recording' || stage === 'paused') && recordedBytes > 0 && (
                  <span className="rounded-full bg-black/65 px-2.5 py-1 font-mono text-[11px] text-white/90 backdrop-blur-xs">
                    已录 {formatBytes(recordedBytes)}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* 舞台下方操控条 */}
          <div className="border-border/60 flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs">
            <div className="text-muted-foreground flex items-center gap-2">
              <ShieldCheck className="size-4 text-emerald-500" />
              <span>纯本地编码（{resolvedMime.label}），所有画面与音频均不离开本机</span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {stage === 'preview' && (
                <>
                  <Button variant="primary" size="sm" onClick={() => void handleTakePhoto(false)}>
                    <Camera />
                    立即拍照
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void handleTakePhoto(true)}>
                    <Timer />
                    3 秒定时拍
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      releaseCaptureResources()
                      setStage('idle')
                    }}
                  >
                    <X />
                    关闭预览
                  </Button>
                </>
              )}

              {(stage === 'recording' || stage === 'paused') && (
                <>
                  <Button variant="outline" size="sm" onClick={() => void handleTakePhoto(false)}>
                    <Camera />
                    抓拍当前帧
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleTogglePause}>
                    {stage === 'paused' ? <Play /> : <Pause />}
                    {stage === 'paused' ? '继续' : '暂停'}
                  </Button>
                  <Button variant="danger" size="sm" onClick={stopRecording}>
                    <Square className="fill-current" />
                    停止并保存
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 产物画廊：录制视频清单 + 拍摄/抓拍照片清单 */}
        <div className="glass shadow-soft space-y-4 rounded-2xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="w-full sm:w-72">
              <Segmented<GalleryTab>
                size="sm"
                value={galleryTab}
                onChange={setGalleryTab}
                options={[
                  { value: 'videos', label: `录制视频 (${clips.length})`, icon: <Film className="size-3.5" /> },
                  { value: 'photos', label: `拍摄照片 (${photos.length})`, icon: <ImageIcon className="size-3.5" /> },
                ]}
              />
            </div>

            {galleryTab === 'videos' && clips.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  clips.forEach((c) => URL.revokeObjectURL(c.url))
                  setClips([])
                  toast.success('已清空录制视频列表')
                }}
                className="text-muted-foreground hover:text-red-500 inline-flex items-center gap-1 text-xs"
              >
                <Trash2 className="size-3.5" />
                清空视频
              </button>
            )}
            {galleryTab === 'photos' && photos.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  photos.forEach((p) => URL.revokeObjectURL(p.url))
                  setPhotos([])
                  toast.success('已清空照片画廊')
                }}
                className="text-muted-foreground hover:text-red-500 inline-flex items-center gap-1 text-xs"
              >
                <Trash2 className="size-3.5" />
                清空照片
              </button>
            )}
          </div>

          {galleryTab === 'videos' ? (
            clips.length === 0 ? (
              <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-10 text-center text-xs">
                <Video className="size-8 opacity-35" />
                <span>录屏或录像结束后，视频会自动出现在这里供回放与下载</span>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {clips.map((clip) => (
                  <div
                    key={clip.id}
                    className="bg-background/50 border-border/60 flex flex-col overflow-hidden rounded-xl border"
                  >
                    <video src={clip.url} controls playsInline className="aspect-video w-full bg-black object-contain" />
                    <div className="space-y-2.5 p-3 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{clip.name}</div>
                          <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px]">
                            <span>{formatDuration(clip.durationSec)}</span>
                            <span>·</span>
                            <span>{formatBytes(clip.size)}</span>
                            <span>·</span>
                            <span>{clip.width}×{clip.height}</span>
                            <span>·</span>
                            <span>{clip.ext.toUpperCase()}</span>
                          </div>
                        </div>
                        <span className="text-muted-foreground shrink-0 font-mono text-[10px]">{clip.createdAt}</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="primary"
                          size="sm"
                          className="flex-1"
                          onClick={() => {
                            downloadBlob(clip.blob, clip.name)
                            toast.success(`已下载「${clip.name}」`)
                          }}
                        >
                          <Download />
                          保存 {clip.ext.toUpperCase()}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="删除"
                          onClick={() => {
                            URL.revokeObjectURL(clip.url)
                            setClips((prev) => prev.filter((c) => c.id !== clip.id))
                          }}
                        >
                          <Trash2 className="text-red-500" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : photos.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-10 text-center text-xs">
              <Camera className="size-8 opacity-35" />
              <span>摄像头拍摄或录屏中抓拍的高清 PNG 照片将保存在这里</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((photo) => (
                <div
                  key={photo.id}
                  className="bg-background/50 border-border/60 group overflow-hidden rounded-xl border"
                >
                  <button
                    type="button"
                    onClick={() => setLightboxPhoto(photo)}
                    className="block aspect-video w-full overflow-hidden bg-black/90"
                  >
                    <img
                      src={photo.url}
                      alt={photo.name}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  </button>
                  <div className="space-y-2 p-2.5 text-xs">
                    <div className="text-muted-foreground flex items-center justify-between font-mono text-[10px]">
                      <span>
                        {photo.width}×{photo.height}
                      </span>
                      <span>{formatBytes(photo.size)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 flex-1 px-2 text-[11px]"
                        onClick={async () => {
                          try {
                            await copyImageToClipboard(photo.blob)
                            setCopiedPhotoId(photo.id)
                            toast.success('已复制照片到剪贴板')
                            setTimeout(() => setCopiedPhotoId(null), 1500)
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : '复制失败')
                          }
                        }}
                      >
                        {copiedPhotoId === photo.id ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                        复制
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        className="h-7 flex-1 px-2 text-[11px]"
                        onClick={() => downloadBlob(photo.blob, photo.name)}
                      >
                        <Download className="size-3" />
                        下载
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-7"
                        onClick={() => {
                          URL.revokeObjectURL(photo.url)
                          setPhotos((prev) => prev.filter((p) => p.id !== photo.id))
                        }}
                      >
                        <Trash2 className="size-3 text-red-500" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 照片高清灯箱 */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setLightboxPhoto(null)}
        >
          <div
            className="relative flex max-h-[90dvh] max-w-5xl flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightboxPhoto.url}
              alt={lightboxPhoto.name}
              className="max-h-[80dvh] max-w-full rounded-2xl object-contain shadow-2xl"
            />
            <div className="flex items-center gap-2">
              <Button variant="primary" size="sm" onClick={() => downloadBlob(lightboxPhoto.blob, lightboxPhoto.name)}>
                <Download />
                下载原图 PNG
              </Button>
              <Button variant="outline" size="sm" onClick={() => setLightboxPhoto(null)}>
                <X />
                关闭
              </Button>
            </div>
          </div>
        </div>
      )}
    </ToolShell>
  )
}
