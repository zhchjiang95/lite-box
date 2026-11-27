import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeftRight,
  Download,
  Film,
  Loader2,
  Pause,
  Play,
  Repeat,
  Rewind,
  Scissors,
  Sparkles,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-react'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { Button } from '@/components/ui/button'
import { Field, Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { Slider } from '@/components/ui/slider'
import { downloadBlob, timestampName } from '@/lib/file'
import { cn, formatBytes } from '@/lib/utils'
import {
  computeGifGeometry,
  DEFAULT_GIF_CONFIG,
  encodeVideoToGif,
  estimateGifFrames,
  extractVideoFilmstrip,
  formatTimeShort,
  GIF_PRESETS,
  type CaptionPosition,
  type CropAspect,
  type GifEncodeConfig,
  type GifEncodeProgress,
  type LoopMode,
  type PaletteMode,
} from './engine'

const VIDEO_ACCEPT = 'video/*,.mp4,.webm,.mov,.m4v,.ogv,.mkv'

const CROP_OPTIONS: { id: CropAspect; label: string }[] = [
  { id: 'original', label: '原比例' },
  { id: '1:1', label: '1:1 方图' },
  { id: '16:9', label: '16:9' },
  { id: '4:3', label: '4:3' },
  { id: '9:16', label: '9:16 竖屏' },
]

const SPEED_OPTIONS = [0.5, 1, 1.5, 2, 3]
const COLOR_OPTIONS = [64, 128, 256]

interface VideoMeta {
  file: File
  url: string
  width: number
  height: number
  duration: number
}

interface GeneratedGifItem {
  id: string
  url: string
  blob: Blob
  name: string
  width: number
  height: number
  frameCount: number
  durationSec: number
  size: number
  elapsedMs: number
  summary: string
}

type DragTarget = 'start' | 'end' | 'window' | null

export default function VideoToGifTool() {
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null)
  const [filmstrip, setFilmstrip] = useState<string[]>([])
  const [loadingStrip, setLoadingStrip] = useState(false)

  const [config, setConfig] = useState<GifEncodeConfig>(DEFAULT_GIF_CONFIG)
  const [activePresetId, setActivePresetId] = useState<string>('')
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loopPreview, setLoopPreview] = useState(true)

  const [encoding, setEncoding] = useState(false)
  const [progress, setProgress] = useState<GifEncodeProgress | null>(null)
  const [results, setResults] = useState<GeneratedGifItem[]>([])
  const [activeResultId, setActiveResultId] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const dragStateRef = useRef<{
    target: DragTarget
    initX: number
    initStart: number
    initEnd: number
  }>({ target: null, initX: 0, initStart: 0, initEnd: 0 })
  const abortRef = useRef<AbortController | null>(null)
  const stripAbortRef = useRef<AbortController | null>(null)
  const videoMetaRef = useRef(videoMeta)
  videoMetaRef.current = videoMeta
  const resultsRef = useRef(results)
  resultsRef.current = results

  const update = useCallback(<K extends keyof GifEncodeConfig>(key: K, value: GifEncodeConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
    setActivePresetId('')
  }, [])

  // 卸载释放所有临时 Blob URL
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      stripAbortRef.current?.abort()
      if (videoMetaRef.current?.url) URL.revokeObjectURL(videoMetaRef.current.url)
      resultsRef.current.forEach((r) => URL.revokeObjectURL(r.url))
    }
  }, [])

  /** 载入本地视频 */
  const handleLoadFiles = async (files: File[]) => {
    const file = files[0]
    if (!file) return
    abortRef.current?.abort()
    stripAbortRef.current?.abort()

    const url = URL.createObjectURL(file)
    // 先探查元数据（宽高、时长）
    try {
      const probe = document.createElement('video')
      probe.muted = true
      probe.preload = 'metadata'
      probe.src = url
      await new Promise<void>((resolve, reject) => {
        probe.onloadedmetadata = () => resolve()
        probe.onerror = () => reject(new Error('浏览器无法解码此视频格式，建议使用 MP4 (H.264) 或 WebM'))
      })
      const duration = Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : 0
      const width = probe.videoWidth || 1280
      const height = probe.videoHeight || 720
      probe.src = ''

      if (duration <= 0) {
        URL.revokeObjectURL(url)
        toast.error('无法读取视频有效时长')
        return
      }

      if (videoMeta?.url) URL.revokeObjectURL(videoMeta.url)
      const nextMeta: VideoMeta = { file, url, width, height, duration }
      setVideoMeta(nextMeta)
      setFilmstrip([])
      setCurrentTime(0)
      setIsPlaying(false)

      // 默认选中前 5 秒（或全片）
      const defaultEnd = Math.min(duration, Math.max(0.5, Math.min(5, duration)))
      const defaultW = Math.min(640, width)
      setConfig((prev) => ({
        ...prev,
        startSec: 0,
        endSec: Number(defaultEnd.toFixed(2)),
        width: Math.max(240, Math.round(defaultW / 2) * 2),
      }))
      toast.success(`已载入「${file.name}」（${width}×${height} · ${formatTimeShort(duration)}）`)

      // 异步后台抽取胶片时间轴缩略图
      const ctrl = new AbortController()
      stripAbortRef.current = ctrl
      setLoadingStrip(true)
      extractVideoFilmstrip(url, duration, 12, ctrl.signal)
        .then((thumbs) => {
          if (!ctrl.signal.aborted) setFilmstrip(thumbs)
        })
        .catch(() => {})
        .finally(() => {
          if (!ctrl.signal.aborted) setLoadingStrip(false)
        })
    } catch (err) {
      URL.revokeObjectURL(url)
      toast.error(err instanceof Error ? err.message : '加载视频失败')
    }
  }

  /** 视频播放器区间循环联动 */
  useEffect(() => {
    const v = videoRef.current
    if (!v || !videoMeta) return
    v.playbackRate = config.speed
  }, [config.speed, videoMeta])

  const handleTimeUpdate = () => {
    const v = videoRef.current
    if (!v) return
    const t = v.currentTime
    setCurrentTime(t)
    if (loopPreview && !v.paused && t >= config.endSec - 0.03) {
      v.currentTime = config.startSec
    }
  }

  const togglePlaySelection = () => {
    const v = videoRef.current
    if (!v) return
    if (!v.paused) {
      v.pause()
      setIsPlaying(false)
      return
    }
    if (v.currentTime < config.startSec || v.currentTime >= config.endSec - 0.05) {
      v.currentTime = config.startSec
    }
    v.playbackRate = config.speed
    v.play().catch(() => {})
    setIsPlaying(true)
  }

  /** 时间轴拖拽交互（左柄 / 右柄 / 整体平移） */
  const handleTimelinePointerDown = (e: React.PointerEvent, target: DragTarget) => {
    if (!videoMeta || !timelineRef.current) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStateRef.current = {
      target,
      initX: e.clientX,
      initStart: config.startSec,
      initEnd: config.endSec,
    }
  }

  const handleTimelinePointerMove = (e: React.PointerEvent) => {
    const st = dragStateRef.current
    if (!st.target || !videoMeta || !timelineRef.current) return
    const rect = timelineRef.current.getBoundingClientRect()
    if (rect.width <= 0) return

    const deltaSec = ((e.clientX - st.initX) / rect.width) * videoMeta.duration
    const minSpan = Math.min(0.2, videoMeta.duration)

    if (st.target === 'start') {
      const nextStart = Math.max(0, Math.min(st.initEnd - minSpan, st.initStart + deltaSec))
      setConfig((prev) => ({ ...prev, startSec: Number(nextStart.toFixed(2)) }))
      if (videoRef.current) videoRef.current.currentTime = nextStart
    } else if (st.target === 'end') {
      const nextEnd = Math.min(videoMeta.duration, Math.max(st.initStart + minSpan, st.initEnd + deltaSec))
      setConfig((prev) => ({ ...prev, endSec: Number(nextEnd.toFixed(2)) }))
      if (videoRef.current) videoRef.current.currentTime = nextEnd
    } else if (st.target === 'window') {
      const span = st.initEnd - st.initStart
      const nextStart = Math.max(0, Math.min(videoMeta.duration - span, st.initStart + deltaSec))
      const nextEnd = nextStart + span
      setConfig((prev) => ({
        ...prev,
        startSec: Number(nextStart.toFixed(2)),
        endSec: Number(nextEnd.toFixed(2)),
      }))
      if (videoRef.current) videoRef.current.currentTime = nextStart
    }
  }

  const handleTimelinePointerUp = (e: React.PointerEvent) => {
    if (dragStateRef.current.target) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
      dragStateRef.current.target = null
    }
  }

  const handleTimelineTrackClick = (e: React.MouseEvent) => {
    if (!videoMeta || !timelineRef.current || dragStateRef.current.target) return
    const rect = timelineRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const t = ratio * videoMeta.duration
    if (videoRef.current) {
      videoRef.current.currentTime = t
      setCurrentTime(t)
    }
  }

  /** 执行本地 GIF 编码 */
  const handleGenerateGif = async () => {
    if (!videoMeta) return
    if (config.endSec - config.startSec < 0.1) {
      toast.error('选中片段过短，请至少框选 0.1 秒以上')
      return
    }

    const ctrl = new AbortController()
    abortRef.current = ctrl
    setEncoding(true)
    setProgress({ stage: 'extracting', current: 0, total: frameStats.totalFrames, percent: 0 })

    try {
      const res = await encodeVideoToGif(videoMeta.url, config, setProgress, ctrl.signal)
      const base = videoMeta.file.name.replace(/\.[^.]+$/, '').slice(0, 24) || 'clip'
      const item: GeneratedGifItem = {
        id: `gif-${Date.now()}`,
        url: URL.createObjectURL(res.blob),
        blob: res.blob,
        name: timestampName(base, 'gif'),
        width: res.width,
        height: res.height,
        frameCount: res.frameCount,
        durationSec: res.durationSec,
        size: res.blob.size,
        elapsedMs: res.elapsedMs,
        summary: `${res.width}×${res.height} · ${config.fps}fps · ${config.maxColors}色${config.loopMode === 'boomerang' ? ' · 往返' : ''}`,
      }
      setResults((prev) => [item, ...prev.slice(0, 9)])
      setActiveResultId(item.id)
      toast.success(`GIF 生成完成（${formatBytes(item.size)} · 耗时 ${(res.elapsedMs / 1000).toFixed(1)}s）`)
    } catch (err) {
      if (err instanceof Error && err.message === '已取消生成') {
        toast.info('已取消 GIF 生成')
      } else {
        toast.error(err instanceof Error ? err.message : 'GIF 编码失败')
      }
    } finally {
      abortRef.current = null
      setEncoding(false)
      setProgress(null)
    }
  }

  const geometry = useMemo(
    () =>
      videoMeta
        ? computeGifGeometry(videoMeta.width, videoMeta.height, config.width, config.cropAspect)
        : { outW: config.width, outH: Math.round((config.width * 9) / 16), sx: 0, sy: 0, sw: 16, sh: 9 },
    [videoMeta, config.width, config.cropAspect],
  )
  const frameStats = useMemo(() => estimateGifFrames(config), [config])
  const activeResult = useMemo(
    () => results.find((r) => r.id === activeResultId) ?? results[0] ?? null,
    [results, activeResultId],
  )

  // ============================================================================
  // 左侧参数设置面板
  // ============================================================================
  const panel = (
    <div className="space-y-6">
      {/* 1. 场景快捷预设 */}
      <div className="space-y-2">
        <div className="text-foreground/80 flex items-center gap-1.5 text-xs font-semibold">
          <Sparkles className="text-primary size-3.5" />
          快捷画质预设
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {GIF_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setConfig((prev) => ({ ...prev, ...p.patch }))
                setActivePresetId(p.id)
              }}
              className={cn(
                'rounded-xl border px-2.5 py-2 text-left transition-all',
                activePresetId === p.id
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border/60 bg-background/40 text-foreground/85 hover:border-border',
              )}
            >
              <div className="text-xs font-semibold">{p.name}</div>
              <div className="text-muted-foreground text-[10px]">{p.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <hr className="border-border/60" />

      {/* 2. 尺寸与裁切画幅 */}
      <div className="space-y-4">
        <div className="text-foreground/80 text-xs font-semibold tracking-wider uppercase">尺寸与画幅</div>

        <Field label="输出宽度" value={`${geometry.outW} × ${geometry.outH} px`}>
          <Slider
            value={config.width}
            onChange={(v) => update('width', v)}
            min={200}
            max={1080}
            step={20}
          />
        </Field>

        <Field label="画面裁切比例">
          <div className="flex flex-wrap gap-1.5">
            {CROP_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => update('cropAspect', opt.id)}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                  config.cropAspect === opt.id
                    ? 'border-primary bg-primary/12 text-primary'
                    : 'border-border/60 bg-background/40 text-muted-foreground hover:text-foreground',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <hr className="border-border/60" />

      {/* 3. 帧率、倍速与循环 */}
      <div className="space-y-4">
        <div className="text-foreground/80 text-xs font-semibold tracking-wider uppercase">帧率与动效</div>

        <Field label="帧率 (FPS)" value={`${config.fps} fps · 约 ${frameStats.totalFrames} 帧`}>
          <Slider value={config.fps} onChange={(v) => update('fps', v)} min={5} max={24} step={1} />
        </Field>

        <Field label="播放倍速" value={`成片 ${frameStats.outputDurationSec.toFixed(1)}s`}>
          <div className="grid grid-cols-5 gap-1">
            {SPEED_OPTIONS.map((sp) => (
              <button
                key={sp}
                type="button"
                onClick={() => update('speed', sp)}
                className={cn(
                  'rounded-lg border py-1 font-mono text-xs font-medium transition-colors',
                  config.speed === sp
                    ? 'border-primary bg-primary/12 text-primary'
                    : 'border-border/60 bg-background/40 text-muted-foreground hover:text-foreground',
                )}
              >
                {sp}×
              </button>
            ))}
          </div>
        </Field>

        <Field label="循环方式">
          <Segmented<LoopMode>
            size="sm"
            value={config.loopMode}
            onChange={(v) => update('loopMode', v)}
            options={[
              { value: 'infinite', label: '无限循环' },
              { value: 'boomerang', label: '往返回弹' },
              { value: 'once', label: '仅一次' },
            ]}
          />
        </Field>

        <div className="flex items-center justify-between text-sm">
          <span className="text-foreground/80 flex items-center gap-1.5 font-medium">
            <Rewind className="size-3.5" />
            倒放片段
          </span>
          <Switch checked={config.reverse} onChange={(v) => update('reverse', v)} label="倒放片段" />
        </div>
      </div>

      <hr className="border-border/60" />

      {/* 4. 色彩调色板与压缩优化 */}
      <div className="space-y-4">
        <div className="text-foreground/80 text-xs font-semibold tracking-wider uppercase">调色板与画质</div>

        <Field label="最大色数">
          <div className="grid grid-cols-3 gap-1.5">
            {COLOR_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => update('maxColors', c)}
                className={cn(
                  'rounded-lg border py-1.5 font-mono text-xs font-medium transition-colors',
                  config.maxColors === c
                    ? 'border-primary bg-primary/12 text-primary'
                    : 'border-border/60 bg-background/40 text-muted-foreground hover:text-foreground',
                )}
              >
                {c} 色
              </button>
            ))}
          </div>
        </Field>

        <Field label="调色板模式">
          <Segmented<PaletteMode>
            size="sm"
            value={config.paletteMode}
            onChange={(v) => update('paletteMode', v)}
            options={[
              { value: 'per-frame', label: '逐帧色板（画质佳）' },
              { value: 'global', label: '全局共享（体积小）' },
            ]}
          />
        </Field>

        <div className="flex items-center justify-between text-sm">
          <span className="text-foreground/80 font-medium">有序抖动（消除渐变色带）</span>
          <Switch checked={config.dither} onChange={(v) => update('dither', v)} label="有序抖动" />
        </div>
      </div>

      <hr className="border-border/60" />

      {/* 5. 可选表情包 / 演示配文 */}
      <div className="space-y-3">
        <div className="text-foreground/80 flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
          <Type className="size-3.5" />
          配文字幕（可选）
        </div>
        <textarea
          rows={2}
          value={config.captionText}
          onChange={(e) => update('captionText', e.target.value)}
          placeholder="输入表情包配文或操作提示（最多 2 行，留空不叠加）"
          className="border-border/70 bg-background/60 focus:border-primary w-full resize-none rounded-xl border px-3 py-2 text-xs outline-none"
        />
        {config.captionText.trim() && (
          <Segmented<CaptionPosition>
            size="sm"
            value={config.captionPosition}
            onChange={(v) => update('captionPosition', v)}
            options={[
              { value: 'bottom', label: '底部居中' },
              { value: 'top', label: '顶部居中' },
            ]}
          />
        )}
      </div>
    </div>
  )

  const actions = encoding ? (
    <Button variant="danger" size="md" onClick={() => abortRef.current?.abort()}>
      <X />
      取消生成 ({progress?.percent ?? 0}%)
    </Button>
  ) : (
    <Button variant="primary" size="md" disabled={!videoMeta} onClick={handleGenerateGif}>
      <Film />
      生成 GIF（{frameStats.totalFrames} 帧）
    </Button>
  )

  return (
    <ToolShell panel={panel} actions={actions} panelTitle="GIF 编码参数">
      {!videoMeta ? (
        <div className="glass shadow-soft rounded-3xl p-6 sm:p-8">
          <FileDropzone
            accept={VIDEO_ACCEPT}
            multiple={false}
            onFiles={handleLoadFiles}
            title="拖放或点击选择本地视频文件"
            hint="支持 MP4 / WebM / MOV / OGG 等浏览器可解码视频 · 纯本地抽帧编码，不上传服务器"
          />
        </div>
      ) : (
        <div className="space-y-4">
          {/* 顶部视频信息与换片条 */}
          <div className="glass shadow-soft flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3 text-xs">
            <div className="flex min-w-0 items-center gap-2">
              <Film className="text-primary size-4 shrink-0" />
              <span className="truncate font-semibold">{videoMeta.file.name}</span>
              <span className="text-muted-foreground hidden font-mono sm:inline">
                {videoMeta.width}×{videoMeta.height} · {formatTimeShort(videoMeta.duration)} ·{' '}
                {formatBytes(videoMeta.file.size)}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={encoding}
              onClick={() => {
                stripAbortRef.current?.abort()
                if (videoMeta.url) URL.revokeObjectURL(videoMeta.url)
                setVideoMeta(null)
                setFilmstrip([])
              }}
            >
              <Upload />
              更换视频
            </Button>
          </div>

          {/* 实时预览播放器 + 胶片时间轴框选器 */}
          <div className="glass shadow-soft space-y-4 rounded-2xl p-4">
            <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl bg-black">
              <video
                ref={videoRef}
                src={videoMeta.url}
                playsInline
                muted
                onTimeUpdate={handleTimeUpdate}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                className="max-h-full max-w-full object-contain"
              />

              {/* 实时配文预览叠加 */}
              {config.captionText.trim() && (
                <div
                  className={cn(
                    'pointer-events-none absolute inset-x-4 text-center font-extrabold whitespace-pre-line text-white',
                    config.captionPosition === 'top' ? 'top-4' : 'bottom-4',
                  )}
                  style={{
                    fontSize: 'clamp(14px, 2.6vw, 24px)',
                    textShadow: '0 2px 6px rgba(0,0,0,0.95), 0 0 2px #000',
                  }}
                >
                  {config.captionText.split('\n').slice(0, 2).join('\n')}
                </div>
              )}

              {/* 右上角当前时间码 */}
              <div className="pointer-events-none absolute top-2.5 right-2.5 rounded-lg bg-black/70 px-2 py-0.5 font-mono text-[11px] text-white backdrop-blur-xs">
                {formatTimeShort(currentTime)} / {formatTimeShort(videoMeta.duration)}
              </div>
            </div>

            {/* 可视化胶片双柄时间轴 */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <Button variant="primary" size="sm" onClick={togglePlaySelection}>
                    {isPlaying ? <Pause /> : <Play />}
                    {isPlaying ? '暂停' : '试播选中片段'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const t = Number(currentTime.toFixed(2))
                      if (t < config.endSec - 0.1) update('startSec', t)
                      else toast.warning('起点需早于终点')
                    }}
                  >
                    <Scissors />
                    设为起点
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const t = Number(currentTime.toFixed(2))
                      if (t > config.startSec + 0.1) update('endSec', t)
                      else toast.warning('终点需晚于起点')
                    }}
                  >
                    设为终点
                  </Button>
                </div>

                <div className="text-muted-foreground flex items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={loopPreview}
                      onChange={(e) => setLoopPreview(e.target.checked)}
                      className="accent-primary rounded"
                    />
                    <Repeat className="size-3" />
                    区间循环试播
                  </label>
                  <span className="font-mono font-medium text-foreground">
                    已选 {(config.endSec - config.startSec).toFixed(1)}s
                  </span>
                </div>
              </div>

              {/* 胶片条 + 选区双向拖动手柄 */}
              <div
                ref={timelineRef}
                onClick={handleTimelineTrackClick}
                className="border-border/70 relative h-14 w-full cursor-pointer overflow-hidden rounded-xl border bg-neutral-900 select-none touch-none"
              >
                {/* 底层缩略图胶片 */}
                <div className="flex h-full w-full">
                  {filmstrip.length > 0 ? (
                    filmstrip.map((src, i) => (
                      <img
                        key={i}
                        src={src}
                        alt=""
                        draggable={false}
                        className="h-full flex-1 object-cover opacity-85"
                      />
                    ))
                  ) : (
                    <div className="text-muted-foreground flex h-full w-full items-center justify-center gap-1.5 text-[11px]">
                      {loadingStrip && <Loader2 className="size-3.5 animate-spin" />}
                      <span>{loadingStrip ? '正在生成时间轴缩略图...' : '拖动两端手柄框选时间区间'}</span>
                    </div>
                  )}
                </div>

                {/* 两侧未选区暗化遮罩 */}
                <div
                  className="pointer-events-none absolute inset-y-0 left-0 bg-black/62"
                  style={{ width: `${(config.startSec / videoMeta.duration) * 100}%` }}
                />
                <div
                  className="pointer-events-none absolute inset-y-0 right-0 bg-black/62"
                  style={{ width: `${Math.max(0, (1 - config.endSec / videoMeta.duration) * 100)}%` }}
                />

                {/* 选中区间高亮窗（支持拖动平移） */}
                <div
                  onPointerDown={(e) => handleTimelinePointerDown(e, 'window')}
                  onPointerMove={handleTimelinePointerMove}
                  onPointerUp={handleTimelinePointerUp}
                  style={{
                    left: `${(config.startSec / videoMeta.duration) * 100}%`,
                    width: `${Math.max(1, ((config.endSec - config.startSec) / videoMeta.duration) * 100)}%`,
                  }}
                  className="border-primary absolute inset-y-0 cursor-grab border-y-2 active:cursor-grabbing"
                >
                  {/* 左手柄 */}
                  <div
                    onPointerDown={(e) => handleTimelinePointerDown(e, 'start')}
                    onPointerMove={handleTimelinePointerMove}
                    onPointerUp={handleTimelinePointerUp}
                    className="bg-primary absolute top-0 -left-2 flex h-full w-4 cursor-ew-resize items-center justify-center rounded-l-md text-white shadow"
                    title="拖动调整起点"
                  >
                    <span className="h-5 w-0.5 rounded-full bg-white/90" />
                  </div>
                  {/* 右手柄 */}
                  <div
                    onPointerDown={(e) => handleTimelinePointerDown(e, 'end')}
                    onPointerMove={handleTimelinePointerMove}
                    onPointerUp={handleTimelinePointerUp}
                    className="bg-primary absolute top-0 -right-2 flex h-full w-4 cursor-ew-resize items-center justify-center rounded-r-md text-white shadow"
                    title="拖动调整终点"
                  >
                    <span className="h-5 w-0.5 rounded-full bg-white/90" />
                  </div>
                </div>

                {/* 实时播放头竖线 */}
                <div
                  className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]"
                  style={{ left: `${Math.min(100, (currentTime / videoMeta.duration) * 100)}%` }}
                />
              </div>

              {/* 精确时间读数 */}
              <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                <span className="flex items-center gap-1.5">
                  起点：<strong className="text-foreground">{formatTimeShort(config.startSec)}</strong>
                </span>
                <span className="flex items-center gap-1 text-[10px]">
                  <ArrowLeftRight className="size-3" />
                  可拖动手柄微调，或按住高亮框整体平移
                </span>
                <span className="flex items-center gap-1.5">
                  终点：<strong className="text-foreground">{formatTimeShort(config.endSec)}</strong>
                </span>
              </div>
            </div>

            {/* 超大帧数温馨提醒 */}
            {frameStats.totalFrames > 220 && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-4 shrink-0" />
                <span>
                  当前预计生成 <strong>{frameStats.totalFrames} 帧</strong>，GIF 体积可能较大且耗时略长；建议缩短片段、提高倍速或适当调低帧率/宽度。
                </span>
              </div>
            )}

            {/* 编码进度条 */}
            {encoding && progress && (
              <div className="bg-primary/5 border-primary/25 space-y-2 rounded-xl border p-3.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 font-medium">
                    <Loader2 className="text-primary size-3.5 animate-spin" />
                    {progress.stage === 'extracting' ? '正在抽取视频帧' : '正在量化调色板并编码 GIF'}（
                    {progress.current} / {progress.total}）
                  </span>
                  <span className="font-mono font-semibold">{progress.percent}%</span>
                </div>
                <div className="bg-foreground/10 h-2 overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full transition-all duration-150"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 成品 GIF 预览与多版本体积对比区 */}
          {activeResult && (
            <div className="glass shadow-soft space-y-4 rounded-2xl p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">生成结果预览</h3>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-medium',
                        activeResult.size <= 1024 * 1024
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : activeResult.size <= 5 * 1024 * 1024
                            ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                      )}
                    >
                      {activeResult.size <= 1024 * 1024
                        ? '≤ 1 MB · 微信表情包友好'
                        : activeResult.size <= 5 * 1024 * 1024
                          ? '≤ 5 MB · 公众号 / 文档友好'
                          : '体积较大 · 可调小宽度或帧率'}
                    </span>
                  </div>
                  <div className="text-muted-foreground flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[11px]">
                    <span>{formatBytes(activeResult.size)}</span>
                    <span>·</span>
                    <span>
                      {activeResult.width}×{activeResult.height}
                    </span>
                    <span>·</span>
                    <span>{activeResult.frameCount} 帧</span>
                    <span>·</span>
                    <span>时长 {activeResult.durationSec.toFixed(1)}s</span>
                    <span>·</span>
                    <span>耗时 {(activeResult.elapsedMs / 1000).toFixed(1)}s</span>
                  </div>
                </div>

                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    downloadBlob(activeResult.blob, activeResult.name)
                    toast.success(`已下载「${activeResult.name}」`)
                  }}
                >
                  <Download />
                  下载 GIF
                </Button>
              </div>

              <div className="checkerboard flex items-center justify-center rounded-xl border p-4">
                <img
                  src={activeResult.url}
                  alt={activeResult.name}
                  className="max-h-[420px] max-w-full rounded-lg object-contain shadow-md"
                />
              </div>

              {/* 多次微调版本对比条 */}
              {results.length > 1 && (
                <div className="space-y-2 border-t border-border/60 pt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground font-medium">
                      本次生成对比（共 {results.length} 个版本，可点击切换画质与体积对比）
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        results.forEach((r) => URL.revokeObjectURL(r.url))
                        setResults([])
                        setActiveResultId(null)
                      }}
                      className="text-muted-foreground hover:text-red-500 inline-flex items-center gap-1 text-[11px]"
                    >
                      <Trash2 className="size-3" />
                      清空
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {results.map((item) => {
                      const active = item.id === activeResult.id
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setActiveResultId(item.id)}
                          className={cn(
                            'flex items-center gap-2.5 rounded-xl border p-2 text-left text-xs transition-all',
                            active
                              ? 'border-primary bg-primary/10'
                              : 'border-border/60 bg-background/40 hover:border-border',
                          )}
                        >
                          <img
                            src={item.url}
                            alt=""
                            className="size-11 shrink-0 rounded-lg bg-black/80 object-cover"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-mono font-semibold">{formatBytes(item.size)}</div>
                            <div className="text-muted-foreground truncate text-[10px]">{item.summary}</div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </ToolShell>
  )
}
