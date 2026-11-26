import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Archive,
  Camera,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Download,
  FastForward,
  Film,
  Grid2x2,
  Layers,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Rewind,
  Scissors,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { downloadBlob } from '@/lib/file'
import { cn } from '@/lib/utils'
import {
  captureVideoFrame,
  computeBatchTimestamps,
  copyVideoFrameToClipboard,
  extractBatchFrames,
  formatBytes,
  formatTimecode,
  MAX_BATCH_FRAMES,
  packFramesToZip,
  parseTimecodeInput,
  renderContactSheet,
  sanitizeFileStem,
  type BatchMode,
  type CapturedFrame,
  type CaptureOptions,
  type ImageOutputFormat,
  type MaxEdgePreset,
  type VideoInfo,
} from './engine'

const STEP_FPS_PRESETS = [24, 25, 30, 60]
const PLAYBACK_RATES = [0.25, 0.5, 1, 1.5, 2]
const COUNT_PRESETS = [6, 9, 12, 16, 24]
const INTERVAL_PRESETS = [0.5, 1, 2, 5, 10]
const FPS_PRESETS = [1, 2, 5, 10]

export default function VideoFramesTool() {
  // 视频源文件状态
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)
  const [videoError, setVideoError] = useState<string | null>(null)

  // 播放器实时状态
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [stepFps, setStepFps] = useState(30)
  const [jumpText, setJumpText] = useState('')

  // 导出参数
  const [format, setFormat] = useState<ImageOutputFormat>('png')
  const [quality, setQuality] = useState(0.92)
  const [maxEdge, setMaxEdge] = useState<MaxEdgePreset>('original')
  const [stampTimecode, setStampTimecode] = useState(false)

  // 批量抽帧参数与进度
  const [batchMode, setBatchMode] = useState<BatchMode>('count')
  const [batchCount, setBatchCount] = useState(12)
  const [batchInterval, setBatchInterval] = useState(2)
  const [batchFps, setBatchFps] = useState(1)
  const [rangeStart, setRangeStart] = useState(0)
  const [rangeEnd, setRangeEnd] = useState(0)
  const [extracting, setExtracting] = useState(false)
  const [extractProgress, setExtractProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  })

  // 已截取画廊、勾选与灯箱
  const [frames, setFrames] = useState<CapturedFrame[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [packingZip, setPackingZip] = useState(false)
  const [renderingSheet, setRenderingSheet] = useState(false)
  const [sheetCols, setSheetCols] = useState(4)
  const [lightboxId, setLightboxId] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const framesRef = useRef<CapturedFrame[]>([])
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    framesRef.current = frames
  }, [frames])

  // 组件卸载时彻底释放视频和截图的 ObjectURL，避免内存泄漏
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      for (const f of framesRef.current) {
        URL.revokeObjectURL(f.url)
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl)
    }
  }, [videoUrl])

  const captureOptions = useMemo<CaptureOptions>(
    () => ({ format, quality, maxEdge, stampTimecode }),
    [format, quality, maxEdge, stampTimecode],
  )

  // 播放期间使用 rAF 高频同步时间码显示
  useEffect(() => {
    if (!isPlaying) return
    let rafId = 0
    const tick = () => {
      const el = videoRef.current
      if (el) setCurrentTime(el.currentTime)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [isPlaying])

  // 同步播放倍速
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate
    }
  }, [playbackRate, videoUrl])

  // 加载本地视频文件
  const handleLoadFiles = useCallback((files: File[]) => {
    const file = files[0]
    if (!file) return
    abortRef.current?.abort()
    setExtracting(false)

    // 清理旧截图
    for (const f of framesRef.current) URL.revokeObjectURL(f.url)
    setFrames([])
    setSelectedIds(new Set())
    setLightboxId(null)

    const url = URL.createObjectURL(file)
    setVideoUrl(url)
    setVideoError(null)
    setIsPlaying(false)
    setCurrentTime(0)
    setVideoInfo({
      name: file.name,
      stem: sanitizeFileStem(file.name),
      size: file.size,
      duration: 0,
      width: 0,
      height: 0,
    })
  }, [])

  const handleVideoLoadedMetadata = () => {
    const el = videoRef.current
    if (!el) return
    const dur = Number.isFinite(el.duration) ? el.duration : 0
    setVideoInfo((prev) =>
      prev
        ? {
            ...prev,
            duration: dur,
            width: el.videoWidth,
            height: el.videoHeight,
          }
        : prev,
    )
    setRangeStart(0)
    setRangeEnd(dur)
    setCurrentTime(0)
    setVideoError(null)
  }

  const seekTo = useCallback((targetSec: number) => {
    const el = videoRef.current
    if (!el) return
    const max = Number.isFinite(el.duration) ? el.duration : 0
    const clamped = Math.max(0, Math.min(max, targetSec))
    el.currentTime = clamped
    setCurrentTime(clamped)
  }, [])

  const togglePlay = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    if (el.paused) {
      el.play().catch(() => {})
    } else {
      el.pause()
    }
  }, [])

  const stepBySeconds = useCallback(
    (deltaSec: number) => {
      const el = videoRef.current
      if (!el) return
      if (!el.paused) el.pause()
      seekTo(el.currentTime + deltaSec)
    },
    [seekTo],
  )

  const stepFrame = useCallback(
    (dir: -1 | 1) => {
      stepBySeconds((dir * 1) / stepFps)
    },
    [stepBySeconds, stepFps],
  )

  // 截取当前帧并加入画廊（可选立刻下载）
  const handleCaptureCurrent = useCallback(
    async (downloadNow = false) => {
      const el = videoRef.current
      if (!el || !videoInfo) return
      if (!el.paused) el.pause()
      try {
        const frame = await captureVideoFrame(el, videoInfo.stem, captureOptions)
        setFrames((prev) => [frame, ...prev])
        setSelectedIds((prev) => {
          const next = new Set(prev)
          next.add(frame.id)
          return next
        })
        if (downloadNow) {
          downloadBlob(frame.blob, frame.fileName)
          toast.success(`已导出当前帧 ${frame.timecode}`)
        } else {
          toast.success(`已截取帧 ${frame.timecode}（${frame.width}×${frame.height}）`)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '截图失败')
      }
    },
    [videoInfo, captureOptions],
  )

  // 复制当前帧到剪贴板
  const handleCopyCurrent = useCallback(async () => {
    const el = videoRef.current
    if (!el) return
    if (!el.paused) el.pause()
    try {
      await copyVideoFrameToClipboard(el, captureOptions)
      toast.success(`已复制当前帧 ${formatTimecode(el.currentTime)} 到剪贴板，可直接粘贴`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制剪贴板失败')
    }
  }, [captureOptions])

  // 计算批量抽帧预览时间点
  const batchPlan = useMemo(() => {
    if (!videoInfo || videoInfo.duration <= 0) {
      return { timestamps: [] as number[], truncated: false }
    }
    const val =
      batchMode === 'count' ? batchCount : batchMode === 'interval' ? batchInterval : batchFps
    return computeBatchTimestamps({
      duration: videoInfo.duration,
      startSec: rangeStart,
      endSec: rangeEnd,
      mode: batchMode,
      value: val,
    })
  }, [videoInfo, rangeStart, rangeEnd, batchMode, batchCount, batchInterval, batchFps])

  // 开始批量抽帧
  const handleStartBatch = async () => {
    if (!videoUrl || !videoInfo) return
    if (batchPlan.timestamps.length === 0) {
      toast.error('当前起止区间内没有可提取的时间点')
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setExtracting(true)
    setExtractProgress({ done: 0, total: batchPlan.timestamps.length })

    let added = 0
    try {
      await extractBatchFrames({
        videoUrl,
        stem: videoInfo.stem,
        timestamps: batchPlan.timestamps,
        options: captureOptions,
        signal: controller.signal,
        onFrame: (frame, done, total) => {
          added += 1
          setExtractProgress({ done, total })
          setFrames((prev) => [...prev, frame])
          setSelectedIds((prev) => {
            const next = new Set(prev)
            next.add(frame.id)
            return next
          })
        },
      })
      toast.success(`批量抽帧完成，共提取 ${added} 张高清截图`)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        toast.info(`已取消批量抽帧（已保留已提取的 ${added} 张）`)
      } else {
        toast.error(err instanceof Error ? err.message : '批量抽帧过程中出错')
      }
    } finally {
      setExtracting(false)
      abortRef.current = null
    }
  }

  const handleCancelBatch = () => {
    abortRef.current?.abort()
  }

  // 全局键盘快捷键（逐帧微调、空格播放、S 截图、C 复制、[ / ] 设起止点）
  useEffect(() => {
    if (!videoUrl) return
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (/INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable)) {
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (lightboxId) {
        if (e.key === 'Escape') {
          setLightboxId(null)
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          const idx = framesRef.current.findIndex((f) => f.id === lightboxId)
          if (idx >= 0) {
            const nextIdx =
              e.key === 'ArrowLeft'
                ? (idx - 1 + framesRef.current.length) % framesRef.current.length
                : (idx + 1) % framesRef.current.length
            setLightboxId(framesRef.current[nextIdx]?.id ?? null)
          }
        }
        return
      }

      switch (e.key) {
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
        case ',':
          e.preventDefault()
          if (e.shiftKey) stepBySeconds(-1)
          else stepFrame(-1)
          break
        case 'ArrowRight':
        case '.':
          e.preventDefault()
          if (e.shiftKey) stepBySeconds(1)
          else stepFrame(1)
          break
        case 's':
        case 'S':
          e.preventDefault()
          handleCaptureCurrent(false)
          break
        case 'c':
        case 'C':
          e.preventDefault()
          handleCopyCurrent()
          break
        case '[':
          e.preventDefault()
          setRangeStart(currentTime)
          if (currentTime > rangeEnd) setRangeEnd(currentTime)
          toast.info(`已将起点设为 ${formatTimecode(currentTime)}`)
          break
        case ']':
          e.preventDefault()
          setRangeEnd(currentTime)
          if (currentTime < rangeStart) setRangeStart(currentTime)
          toast.info(`已将终点设为 ${formatTimecode(currentTime)}`)
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    videoUrl,
    lightboxId,
    togglePlay,
    stepBySeconds,
    stepFrame,
    handleCaptureCurrent,
    handleCopyCurrent,
    currentTime,
    rangeStart,
    rangeEnd,
  ])

  const selectedFrames = useMemo(
    () => frames.filter((f) => selectedIds.has(f.id)),
    [frames, selectedIds],
  )

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSelectAllToggle = () => {
    if (selectedIds.size === frames.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(frames.map((f) => f.id)))
    }
  }

  const handleRemoveFrame = (id: string) => {
    const target = frames.find((f) => f.id === id)
    if (target) URL.revokeObjectURL(target.url)
    setFrames((prev) => prev.filter((f) => f.id !== id))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    if (lightboxId === id) setLightboxId(null)
  }

  const handleClearFrames = () => {
    for (const f of frames) URL.revokeObjectURL(f.url)
    setFrames([])
    setSelectedIds(new Set())
    setLightboxId(null)
    toast.success('已清空画廊截图')
  }

  const handleSortFramesByTime = () => {
    setFrames((prev) => [...prev].sort((a, b) => a.timeSec - b.timeSec))
    toast.success('已按时间码从早到晚排序')
  }

  const handleDownloadZip = async () => {
    const targets = selectedFrames.length > 0 ? selectedFrames : frames
    if (targets.length === 0 || !videoInfo) return
    setPackingZip(true)
    try {
      const zipBlob = await packFramesToZip(targets)
      downloadBlob(zipBlob, `${videoInfo.stem}_frames_${targets.length}p.zip`)
      toast.success(`已打包导出 ${targets.length} 张截图`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ZIP 打包失败')
    } finally {
      setPackingZip(false)
    }
  }

  const handleExportContactSheet = async () => {
    const targets = selectedFrames.length > 0 ? selectedFrames : frames
    if (targets.length === 0 || !videoInfo) return
    setRenderingSheet(true)
    try {
      const ordered = [...targets].sort((a, b) => a.timeSec - b.timeSec)
      const blob = await renderContactSheet({
        frames: ordered,
        videoInfo,
        columns: sheetCols,
      })
      downloadBlob(blob, `${videoInfo.stem}_contact_sheet_${ordered.length}p.png`)
      toast.success(`已生成 ${ordered.length} 格电影分镜拼图板`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '分镜拼图生成失败')
    } finally {
      setRenderingSheet(false)
    }
  }

  const handleCopySavedFrame = async (frame: CapturedFrame) => {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      toast.error('当前浏览器不支持图片写入剪贴板')
      return
    }
    try {
      let pngBlob = frame.blob
      if (frame.format !== 'png') {
        const bitmap = await createImageBitmap(frame.blob)
        const c = document.createElement('canvas')
        c.width = bitmap.width
        c.height = bitmap.height
        c.getContext('2d')?.drawImage(bitmap, 0, 0)
        bitmap.close()
        pngBlob = await new Promise<Blob>((resolve, reject) =>
          c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 转换失败'))), 'image/png'),
        )
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
      toast.success(`已复制 ${frame.timecode} 截图到剪贴板`)
    } catch {
      toast.error('复制剪贴板失败')
    }
  }

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const sec = parseTimecodeInput(jumpText)
    if (sec === null) {
      toast.error('请输入有效时间，如 01:23.5 或 83.5')
      return
    }
    seekTo(sec)
    setJumpText('')
  }

  const lightboxIndex = lightboxId ? frames.findIndex((f) => f.id === lightboxId) : -1
  const lightboxFrame = lightboxIndex >= 0 ? frames[lightboxIndex] : null

  const duration = videoInfo?.duration ?? 0
  const startPct = duration > 0 ? Math.min(100, Math.max(0, (rangeStart / duration) * 100)) : 0
  const endPct = duration > 0 ? Math.min(100, Math.max(startPct, (rangeEnd / duration) * 100)) : 100

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 pb-12">
      {!videoUrl || !videoInfo ? (
        <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 pt-2">
          <FileDropzone
            accept="video/*,.mp4,.webm,.mov,.m4v,.ogg,.mkv"
            multiple={false}
            onFiles={handleLoadFiles}
            title="拖放本地视频到这里，或点击选择视频"
            hint="支持 MP4 / WebM / MOV / M4V / OGG 等浏览器可解码格式 · 100% 本地逐帧提取，视频永不上传"
          />
          <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              纯浏览器本地 Canvas 抽帧
            </span>
            <span>·</span>
            <span>支持键盘逐帧微调（← / →）</span>
            <span>·</span>
            <span>批量抽帧打包 ZIP & 电影分镜拼图板</span>
          </div>
        </section>
      ) : (
        <>
          {/* 顶部视频元信息条 */}
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/75 bg-card/85 px-4 py-3 text-xs shadow-sm backdrop-blur-md">
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
              <div className="flex min-w-0 items-center gap-2 font-bold text-foreground">
                <Film className="h-4 w-4 shrink-0 text-primary" />
                <span className="max-w-[240px] truncate sm:max-w-[380px]" title={videoInfo.name}>
                  {videoInfo.name}
                </span>
              </div>
              {videoInfo.width > 0 && (
                <span className="rounded-md bg-muted/70 px-2 py-0.5 font-mono text-[11px] text-foreground">
                  {videoInfo.width}×{videoInfo.height}
                </span>
              )}
              <span className="font-mono text-muted-foreground">
                时长 {formatTimecode(videoInfo.duration)}
              </span>
              <span className="font-mono text-muted-foreground">{formatBytes(videoInfo.size)}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>步进帧率</span>
                <select
                  aria-label="单帧步进帧率"
                  value={stepFps}
                  onChange={(e) => setStepFps(Number(e.target.value))}
                  className="h-7 rounded-lg border border-border/80 bg-background px-2 font-mono text-xs text-foreground outline-none focus:border-primary"
                >
                  {STEP_FPS_PRESETS.map((fps) => (
                    <option key={fps} value={fps}>
                      {fps} fps
                    </option>
                  ))}
                </select>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  abortRef.current?.abort()
                  setExtracting(false)
                  setVideoUrl(null)
                  setVideoInfo(null)
                }}
                className="h-8 text-xs"
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                更换视频
              </Button>
            </div>
          </section>

          {/* 主工作区：左预览操控台 + 右导出与批量抽帧面板 */}
          <div className="grid w-full min-w-0 grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            {/* 左栏：逐帧精确预览台 */}
            <section className="flex min-w-0 flex-col gap-3.5 rounded-2xl border border-border/75 bg-card/85 p-4 shadow-sm">
              {/* 视频画面 */}
              <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
                <video
                  ref={videoRef}
                  src={videoUrl}
                  playsInline
                  preload="auto"
                  onLoadedMetadata={handleVideoLoadedMetadata}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  onClick={togglePlay}
                  onError={() =>
                    setVideoError('浏览器无法解码此视频编码（如部分 HEVC/MKV），建议转为 H.264 MP4 后重试。')
                  }
                  className="h-full w-full cursor-pointer object-contain"
                />

                {/* 左上角精确时间码与帧序号 HUD */}
                <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2 rounded-lg bg-black/65 px-2.5 py-1 font-mono text-xs text-white backdrop-blur-sm">
                  <span>{formatTimecode(currentTime)}</span>
                  <span className="opacity-50">/</span>
                  <span className="opacity-80">{formatTimecode(duration)}</span>
                  <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px]">
                    #{Math.round(currentTime * stepFps)}
                  </span>
                </div>

                {videoError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6 text-center text-sm text-rose-300">
                    {videoError}
                  </div>
                )}
              </div>

              {/* 精确时间轴 + 批抽区间指示条 */}
              <div className="space-y-1.5">
                <div className="relative flex items-center py-1">
                  {/* 批抽范围底槽可视化 */}
                  <div className="pointer-events-none absolute right-0 left-0 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="absolute top-0 bottom-0 rounded-full bg-primary/35"
                      style={{ left: `${startPct}%`, width: `${Math.max(0.5, endPct - startPct)}%` }}
                    />
                  </div>
                  <input
                    type="range"
                    aria-label="视频进度轴"
                    min={0}
                    max={duration || 0}
                    step={0.001}
                    value={Math.min(currentTime, duration || 0)}
                    onChange={(e) => seekTo(Number(e.target.value))}
                    className="relative z-10 h-4 w-full cursor-pointer accent-primary"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRangeStart(currentTime)
                        if (currentTime > rangeEnd) setRangeEnd(currentTime)
                      }}
                      className="rounded-md border border-border/70 bg-background/80 px-2 py-0.5 font-medium text-foreground hover:border-primary hover:text-primary"
                    >
                      设为起点 [
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRangeEnd(currentTime)
                        if (currentTime < rangeStart) setRangeStart(currentTime)
                      }}
                      className="rounded-md border border-border/70 bg-background/80 px-2 py-0.5 font-medium text-foreground hover:border-primary hover:text-primary"
                    >
                      设为终点 ]
                    </button>
                    <span className="font-mono">
                      选区：{formatTimecode(rangeStart)} – {formatTimecode(rangeEnd)}
                    </span>
                  </div>

                  {/* 精确时间码跳转 */}
                  <form onSubmit={handleJumpSubmit} className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={jumpText}
                      onChange={(e) => setJumpText(e.target.value)}
                      placeholder="跳至 01:23.5"
                      className="h-6 w-28 rounded-md border border-border/80 bg-background px-2 font-mono text-[11px] text-foreground outline-none focus:border-primary"
                    />
                    <button
                      type="submit"
                      className="h-6 rounded-md border border-border/75 bg-muted/60 px-2 text-[11px] font-medium text-foreground hover:border-primary"
                    >
                      跳转
                    </button>
                  </form>
                </div>
              </div>

              {/* 逐帧步进 + 播放控制条 */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/65 bg-muted/25 p-2.5">
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => stepBySeconds(-5)}
                    title="后退 5 秒"
                    className="h-8 px-2 text-xs"
                  >
                    <Rewind className="h-3.5 w-3.5" />
                    <span className="ml-0.5 font-mono">-5s</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => stepBySeconds(-1)}
                    title="后退 1 秒 (Shift+←)"
                    className="h-8 px-2 font-mono text-xs"
                  >
                    -1s
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => stepFrame(-1)}
                    title="上一帧 (← 或 ,)"
                    className="h-8 px-2.5 text-xs"
                  >
                    <SkipBack className="mr-1 h-3.5 w-3.5" />
                    上一帧
                  </Button>
                  <Button size="sm" onClick={togglePlay} title="播放 / 暂停 (Space)" className="h-8 px-3.5">
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => stepFrame(1)}
                    title="下一帧 (→ 或 .)"
                    className="h-8 px-2.5 text-xs"
                  >
                    下一帧
                    <SkipForward className="ml-1 h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => stepBySeconds(1)}
                    title="前进 1 秒 (Shift+→)"
                    className="h-8 px-2 font-mono text-xs"
                  >
                    +1s
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => stepBySeconds(5)}
                    title="前进 5 秒"
                    className="h-8 px-2 text-xs"
                  >
                    <span className="mr-0.5 font-mono">+5s</span>
                    <FastForward className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {/* 倍速选择 */}
                <div className="flex items-center gap-1">
                  {PLAYBACK_RATES.map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setPlaybackRate(rate)}
                      className={cn(
                        'rounded-md px-1.5 py-1 font-mono text-[11px] transition-colors',
                        playbackRate === rate
                          ? 'bg-primary text-primary-foreground font-semibold'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              </div>

              {/* 单帧截取核心操作栏 */}
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => handleCaptureCurrent(false)} className="h-10 flex-1 sm:flex-none sm:px-5">
                  <Camera className="mr-1.5 h-4 w-4" />
                  截取当前帧（S）
                </Button>
                <Button variant="secondary" onClick={handleCopyCurrent} className="h-10">
                  <ClipboardCopy className="mr-1.5 h-4 w-4" />
                  复制剪贴板（C）
                </Button>
                <Button variant="ghost" onClick={() => handleCaptureCurrent(true)} className="h-10">
                  <Download className="mr-1.5 h-4 w-4" />
                  截并直接下载
                </Button>
              </div>

              <div className="text-[11px] text-muted-foreground">
                快捷键：<kbd className="rounded border px-1 font-mono">Space</kbd> 播放/暂停 ·{' '}
                <kbd className="rounded border px-1 font-mono">←</kbd>/
                <kbd className="rounded border px-1 font-mono">→</kbd> 逐帧步进 ·{' '}
                <kbd className="rounded border px-1 font-mono">S</kbd> 截图入库 ·{' '}
                <kbd className="rounded border px-1 font-mono">C</kbd> 复制图片 ·{' '}
                <kbd className="rounded border px-1 font-mono">[</kbd>/
                <kbd className="rounded border px-1 font-mono">]</kbd> 设批抽起止点
              </div>
            </section>

            {/* 右栏：导出参数 + 批量自动抽帧控制台 */}
            <aside className="flex min-w-0 flex-col gap-4">
              {/* 1. 输出图片规格 */}
              <div className="flex flex-col gap-3.5 rounded-2xl border border-border/75 bg-card/85 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <Scissors className="h-4 w-4 text-primary" />
                  <span>导出图片规格</span>
                </div>

                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">图片格式</div>
                  <Segmented
                    value={format}
                    onChange={(v) => setFormat(v as ImageOutputFormat)}
                    options={[
                      { value: 'png', label: 'PNG 无损' },
                      { value: 'jpeg', label: 'JPEG 小体积' },
                      { value: 'webp', label: 'WebP 现代' },
                    ]}
                  />
                </div>

                {format !== 'png' && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">编码画质</span>
                      <span className="font-mono font-semibold text-foreground">
                        {Math.round(quality * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={1}
                      step={0.02}
                      value={quality}
                      onChange={(e) => setQuality(Number(e.target.value))}
                      className="w-full accent-primary"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">分辨率输出</div>
                  <Segmented
                    size="sm"
                    value={maxEdge}
                    onChange={(v) => setMaxEdge(v as MaxEdgePreset)}
                    options={[
                      { value: 'original', label: '原画尺寸' },
                      { value: '1920', label: '≤ 1080p' },
                      { value: '1280', label: '≤ 720p' },
                      { value: '720', label: '≤ 720px' },
                    ]}
                  />
                </div>

                <div className="flex items-center justify-between rounded-xl border border-border/65 bg-muted/25 px-3 py-2.5 text-xs">
                  <div>
                    <div className="font-medium text-foreground">右下角烧录精确时间码水印</div>
                    <div className="text-[11px] text-muted-foreground">适合剪辑审片、教学标注与取证留档</div>
                  </div>
                  <Switch checked={stampTimecode} onChange={setStampTimecode} label="时间码水印" />
                </div>
              </div>

              {/* 2. 批量定时 / 定数抽帧 */}
              <div className="flex flex-col gap-3.5 rounded-2xl border border-border/75 bg-card/85 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                    <Layers className="h-4 w-4 text-primary" />
                    <span>批量自动抽帧</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setRangeStart(0)
                      setRangeEnd(duration)
                    }}
                    className="text-[11px] font-medium text-primary hover:underline"
                  >
                    重置为全片
                  </button>
                </div>

                <Segmented
                  size="sm"
                  value={batchMode}
                  onChange={(v) => setBatchMode(v as BatchMode)}
                  options={[
                    { value: 'count', label: '均匀抽 N 张' },
                    { value: 'interval', label: '按秒数间隔' },
                    { value: 'fps', label: '按帧率 FPS' },
                  ]}
                />

                {batchMode === 'count' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">均匀抽取总张数</span>
                      <input
                        type="number"
                        min={1}
                        max={MAX_BATCH_FRAMES}
                        value={batchCount}
                        onChange={(e) =>
                          setBatchCount(
                            Math.min(MAX_BATCH_FRAMES, Math.max(1, Number(e.target.value) || 1)),
                          )
                        }
                        className="h-8 w-20 rounded-lg border border-border/80 bg-background px-2 text-right font-mono text-xs font-semibold outline-none focus:border-primary"
                      />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {COUNT_PRESETS.map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setBatchCount(n)}
                          className={cn(
                            'rounded-md border px-2 py-0.5 font-mono text-[11px]',
                            batchCount === n
                              ? 'border-primary bg-primary/12 font-semibold text-primary'
                              : 'border-border/70 text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {n} 张
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {batchMode === 'interval' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">每隔多少秒截 1 张</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0.1}
                          step={0.5}
                          value={batchInterval}
                          onChange={(e) => setBatchInterval(Math.max(0.05, Number(e.target.value) || 1))}
                          className="h-8 w-20 rounded-lg border border-border/80 bg-background px-2 text-right font-mono text-xs font-semibold outline-none focus:border-primary"
                        />
                        <span className="text-muted-foreground">秒</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {INTERVAL_PRESETS.map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => setBatchInterval(sec)}
                          className={cn(
                            'rounded-md border px-2 py-0.5 font-mono text-[11px]',
                            batchInterval === sec
                              ? 'border-primary bg-primary/12 font-semibold text-primary'
                              : 'border-border/70 text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {batchMode === 'fps' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">每秒抽取帧数（适合短片动作拆解）</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0.2}
                          max={30}
                          step={0.5}
                          value={batchFps}
                          onChange={(e) =>
                            setBatchFps(Math.min(30, Math.max(0.1, Number(e.target.value) || 1)))
                          }
                          className="h-8 w-20 rounded-lg border border-border/80 bg-background px-2 text-right font-mono text-xs font-semibold outline-none focus:border-primary"
                        />
                        <span className="text-muted-foreground">fps</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {FPS_PRESETS.map((fps) => (
                        <button
                          key={fps}
                          type="button"
                          onClick={() => setBatchFps(fps)}
                          className={cn(
                            'rounded-md border px-2 py-0.5 font-mono text-[11px]',
                            batchFps === fps
                              ? 'border-primary bg-primary/12 font-semibold text-primary'
                              : 'border-border/70 text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {fps} fps
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 抽帧区间与预计结果摘要 */}
                <div className="rounded-xl border border-border/65 bg-muted/25 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">抽取区间</span>
                    <span className="font-mono font-medium text-foreground">
                      {formatTimecode(rangeStart)} → {formatTimecode(rangeEnd)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-muted-foreground">预计提取张数</span>
                    <span className="font-mono font-bold text-primary">
                      {batchPlan.timestamps.length} 张
                      {batchPlan.truncated && (
                        <span className="ml-1 text-[10px] font-normal text-amber-600 dark:text-amber-400">
                          （已按上限 {MAX_BATCH_FRAMES} 张截断）
                        </span>
                      )}
                    </span>
                  </div>
                </div>

                {/* 抽帧进度条或启动按钮 */}
                {extracting ? (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 font-medium text-primary">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        正在离屏抽帧…
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {extractProgress.done} / {extractProgress.total}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-150"
                        style={{
                          width: `${
                            extractProgress.total > 0
                              ? Math.round((extractProgress.done / extractProgress.total) * 100)
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleCancelBatch}
                      className="w-full text-amber-700 dark:text-amber-300"
                    >
                      <Square className="mr-1.5 h-3 w-3 fill-current" />
                      停止抽帧（保留已提取帧）
                    </Button>
                  </div>
                ) : (
                  <Button
                    onClick={handleStartBatch}
                    disabled={batchPlan.timestamps.length === 0 || Boolean(videoError)}
                    className="h-10 w-full"
                  >
                    <Layers className="mr-1.5 h-4 w-4" />
                    开始批量抽帧（{batchPlan.timestamps.length} 张）
                  </Button>
                )}
              </div>
            </aside>
          </div>

          {/* 底部：已截取画廊与批量打包 / 分镜拼图区 */}
          <section className="flex flex-col gap-4 rounded-2xl border border-border/75 bg-card/85 p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-base font-bold text-foreground">
                  已提取帧画廊（{frames.length}）
                </h2>
                {frames.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={handleSelectAllToggle}
                      className="inline-flex items-center gap-1 rounded-lg border border-border/75 bg-background px-2.5 py-1 text-xs text-foreground hover:border-primary"
                    >
                      <CheckSquare className="h-3.5 w-3.5 text-primary" />
                      {selectedIds.size === frames.length ? '取消全选' : '全选'}
                    </button>
                    <button
                      type="button"
                      onClick={handleSortFramesByTime}
                      className="rounded-lg border border-border/75 bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      按时间排序
                    </button>
                  </>
                )}
              </div>

              {frames.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {/* 分镜拼图列数 + 生成按钮 */}
                  <div className="flex items-center gap-1 rounded-xl border border-border/75 bg-background/80 p-1">
                    <select
                      aria-label="分镜拼图列数"
                      value={sheetCols}
                      onChange={(e) => setSheetCols(Number(e.target.value))}
                      className="h-7 rounded-lg bg-transparent px-1.5 text-xs font-medium outline-none"
                    >
                      {[3, 4, 5].map((c) => (
                        <option key={c} value={c}>
                          {c} 列拼图
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={renderingSheet}
                      onClick={handleExportContactSheet}
                      className="h-7 px-2.5 text-xs"
                    >
                      {renderingSheet ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Grid2x2 className="mr-1 h-3.5 w-3.5" />
                      )}
                      导出分镜拼图
                    </Button>
                  </div>

                  <Button size="sm" disabled={packingZip} onClick={handleDownloadZip} className="h-9 text-xs">
                    {packingZip ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Archive className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    打包下载 ZIP（{selectedFrames.length > 0 ? selectedFrames.length : frames.length}）
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearFrames}
                    className="h-9 text-xs text-rose-600 hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    清空
                  </Button>
                </div>
              )}
            </div>

            {frames.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-xs text-muted-foreground">
                <Camera className="h-8 w-8 opacity-30" />
                <div>暂未截取任何画面</div>
                <div>点击上方「截取当前帧（S）」单张提取，或使用右侧「批量自动抽帧」一次性生成整套分镜</div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {frames.map((frame) => {
                  const isChecked = selectedIds.has(frame.id)
                  return (
                    <div
                      key={frame.id}
                      className={cn(
                        'group flex flex-col overflow-hidden rounded-xl border bg-background/70 transition-all',
                        isChecked
                          ? 'border-primary/60 ring-1 ring-primary/25'
                          : 'border-border/70 hover:border-border',
                      )}
                    >
                      <div className="relative aspect-video w-full overflow-hidden bg-black">
                        <img
                          src={frame.url}
                          alt={frame.fileName}
                          loading="lazy"
                          onClick={() => setLightboxId(frame.id)}
                          className="h-full w-full cursor-zoom-in object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                        />

                        {/* 左上勾选 */}
                        <button
                          type="button"
                          aria-label="选择此帧"
                          onClick={() => handleToggleSelect(frame.id)}
                          className={cn(
                            'absolute top-2 left-2 flex h-5 w-5 items-center justify-center rounded-md border text-white transition-colors',
                            isChecked
                              ? 'border-primary bg-primary'
                              : 'border-white/70 bg-black/45 hover:bg-black/70',
                          )}
                        >
                          {isChecked && <Check className="h-3.5 w-3.5" />}
                        </button>

                        {/* 右上放大查看 */}
                        <button
                          type="button"
                          aria-label="大图预览"
                          onClick={() => setLightboxId(frame.id)}
                          className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80"
                        >
                          <ZoomIn className="h-3.5 w-3.5" />
                        </button>

                        {/* 左下时间码（点击可跳回该帧） */}
                        <button
                          type="button"
                          title="点击让视频跳回此时间点"
                          onClick={() => seekTo(frame.timeSec)}
                          className="absolute bottom-1.5 left-1.5 rounded bg-black/72 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white hover:bg-primary"
                        >
                          {frame.timecode}
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-1 px-2.5 py-2 text-[11px]">
                        <span className="truncate font-mono text-muted-foreground">
                          {frame.width}×{frame.height} · {formatBytes(frame.size)}
                        </span>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            title="复制到剪贴板"
                            onClick={() => handleCopySavedFrame(frame)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <ClipboardCopy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="下载此帧"
                            onClick={() => downloadBlob(frame.blob, frame.fileName)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-primary"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="删除此帧"
                            onClick={() => handleRemoveFrame(frame.id)}
                            className="rounded p-1 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </>
      )}

      {/* 高清大图灯箱预览弹窗 */}
      {lightboxFrame && (
        <div
          onClick={() => setLightboxId(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[92vh] w-full max-w-5xl flex-col gap-3 rounded-2xl border border-white/15 bg-zinc-950 p-4 text-white shadow-2xl"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 font-mono">
                <span className="font-bold">{lightboxFrame.fileName}</span>
                <span className="text-zinc-400">
                  {lightboxFrame.width}×{lightboxFrame.height} · {formatBytes(lightboxFrame.size)} ·{' '}
                  {lightboxIndex + 1}/{frames.length}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleCopySavedFrame(lightboxFrame)}
                  className="h-8 text-xs"
                >
                  <ClipboardCopy className="mr-1 h-3.5 w-3.5" />
                  复制图片
                </Button>
                <Button
                  size="sm"
                  onClick={() => downloadBlob(lightboxFrame.blob, lightboxFrame.fileName)}
                  className="h-8 text-xs"
                >
                  <Download className="mr-1 h-3.5 w-3.5" />
                  下载高清图
                </Button>
                <button
                  type="button"
                  onClick={() => setLightboxId(null)}
                  className="ml-1 rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-xl bg-black">
              <img
                src={lightboxFrame.url}
                alt={lightboxFrame.fileName}
                className="max-h-[75vh] w-auto object-contain"
              />

              {frames.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="上一张"
                    onClick={() =>
                      setLightboxId(frames[(lightboxIndex - 1 + frames.length) % frames.length].id)
                    }
                    className="absolute left-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/85"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    aria-label="下一张"
                    onClick={() => setLightboxId(frames[(lightboxIndex + 1) % frames.length].id)}
                    className="absolute right-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/85"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
