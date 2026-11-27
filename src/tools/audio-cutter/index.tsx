import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AudioWaveform,
  Download,
  Loader2,
  Maximize2,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  Scissors,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { downloadBlob } from '@/lib/file'
import { cn } from '@/lib/utils'
import {
  computeResultDuration,
  decodeAudioFile,
  encodeAudioBufferToMp3,
  encodeAudioBufferToWav,
  estimateOutputBytes,
  extractWaveformPeaks,
  formatAudioTime,
  formatBytes,
  parseAudioTime,
  renderProcessedAudio,
  resolveOutputFormatMeta,
  sanitizeStem,
  type AudioExportFormat,
  type ChannelPreset,
  type CutMode,
  type Mp3BitrateKbps,
  type SampleRatePreset,
  type WaveformPeaks,
} from './engine'
import { WaveformCanvas } from './WaveformCanvas'

const BITRATE_OPTIONS: { kbps: Mp3BitrateKbps; tag: string }[] = [
  { kbps: 32, tag: '超轻人声' },
  { kbps: 48, tag: '语音推荐' },
  { kbps: 64, tag: '播客清晰' },
  { kbps: 96, tag: '轻量音乐' },
  { kbps: 128, tag: '标准音乐' },
  { kbps: 192, tag: '高清音乐' },
  { kbps: 256, tag: '高保真' },
  { kbps: 320, tag: '极品音质' },
]

const EXPORT_SCENE_PRESETS: {
  id: string
  label: string
  desc: string
  format: AudioExportFormat
  bitrate: Mp3BitrateKbps
  sampleRate: SampleRatePreset
  channels: ChannelPreset
}[] = [
  {
    id: 'voice',
    label: '清晰语音',
    desc: '48k · 24kHz · 单声道',
    format: 'mp3',
    bitrate: 48,
    sampleRate: '24000',
    channels: 'mono',
  },
  {
    id: 'podcast',
    label: '播客 / 会议',
    desc: '64k · 24kHz · 单声道',
    format: 'mp3',
    bitrate: 64,
    sampleRate: '24000',
    channels: 'mono',
  },
  {
    id: 'music-std',
    label: '标准音乐',
    desc: '128k · 保持原样',
    format: 'mp3',
    bitrate: 128,
    sampleRate: 'original',
    channels: 'original',
  },
  {
    id: 'music-hq',
    label: '极品音乐',
    desc: '320k · 44.1kHz · 立体声',
    format: 'mp3',
    bitrate: 320,
    sampleRate: '44100',
    channels: 'stereo',
  },
]
const ZOOM_STEPS = [1, 2, 4, 8, 16]

export default function AudioCutterTool() {
  // 音频源状态
  const [fileName, setFileName] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [decoding, setDecoding] = useState(false)
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null)
  const [peaks, setPeaks] = useState<WaveformPeaks | null>(null)

  // 裁剪与波形视图状态
  const [mode, setMode] = useState<CutMode>('keep')
  const [startSec, setStartSec] = useState(0)
  const [endSec, setEndSec] = useState(0)
  const [startInput, setStartInput] = useState('00:00.00')
  const [endInput, setEndInput] = useState('00:00.00')
  const [zoom, setZoom] = useState(1)
  const [scrollSec, setScrollSec] = useState(0)

  // 播放状态
  const [isPlaying, setIsPlaying] = useState(false)
  const [loopSelection, setLoopSelection] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)

  // 音效与导出设置
  const [fadeInSec, setFadeInSec] = useState(0)
  const [fadeOutSec, setFadeOutSec] = useState(0)
  const [gainPct, setGainPct] = useState(100)
  const [normalize, setNormalize] = useState(false)
  const [exportFormat, setExportFormat] = useState<AudioExportFormat>('mp3')
  const [bitrate, setBitrate] = useState<Mp3BitrateKbps>(128)
  const [sampleRate, setSampleRate] = useState<SampleRatePreset>('original')
  const [channels, setChannels] = useState<ChannelPreset>('original')

  // 导出进度状态
  const [exporting, setExporting] = useState(false)
  const [exportPct, setExportPct] = useState(0)
  const [exportStage, setExportStage] = useState('')

  // Web Audio 实时试听句柄
  const audioCtxRef = useRef<AudioContext | null>(null)
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const playMetaRef = useRef<{
    active: boolean
    startedAtCtx: number
    /** 映射播放时钟到原始音频波形时间的分段列表 */
    segments: { outOffset: number; srcOffset: number; dur: number }[]
    totalDur: number
    loop: boolean
  }>({ active: false, startedAtCtx: 0, segments: [], totalDur: 0, loop: false })

  const duration = audioBuffer?.duration ?? 0

  // 同步文本输入框
  useEffect(() => {
    setStartInput(formatAudioTime(startSec))
  }, [startSec])

  useEffect(() => {
    setEndInput(formatAudioTime(endSec))
  }, [endSec])

  /** 停止当前试听播放 */
  const stopPlayback = useCallback(() => {
    playMetaRef.current.active = false
    for (const node of activeSourcesRef.current) {
      try {
        node.onended = null
        node.stop()
        node.disconnect()
      } catch {
        // 忽略已结束节点
      }
    }
    activeSourcesRef.current = []
    setIsPlaying(false)
  }, [])

  // 卸载时清理 AudioContext
  useEffect(() => {
    return () => {
      stopPlayback()
      audioCtxRef.current?.close().catch(() => {})
    }
  }, [stopPlayback])

  // 播放期间用 rAF 平滑推进播放指针
  useEffect(() => {
    if (!isPlaying) return
    let rafId = 0
    const tick = () => {
      const ctx = audioCtxRef.current
      const meta = playMetaRef.current
      if (!ctx || !meta.active) return
      const elapsed = ctx.currentTime - meta.startedAtCtx
      if (elapsed >= meta.totalDur) {
        if (meta.loop) {
          // 循环逻辑交由 startPreview 重新触发
          return
        }
        const lastSeg = meta.segments[meta.segments.length - 1]
        if (lastSeg) setCurrentTime(lastSeg.srcOffset + lastSeg.dur)
        stopPlayback()
        return
      }
      // 将播放经过时间映射回原始波形时间指针
      for (const seg of meta.segments) {
        if (elapsed >= seg.outOffset && elapsed <= seg.outOffset + seg.dur + 0.005) {
          setCurrentTime(seg.srcOffset + (elapsed - seg.outOffset))
          break
        }
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [isPlaying, stopPlayback])

  /** 启动精准实时试听（支持保留选区含淡入淡出试听，或剪除选区自动跳过中间段试听） */
  const startPlayback = useCallback(
    async (opts?: { fromSec?: number; previewCut?: boolean }) => {
      if (!audioBuffer) return
      stopPlayback()

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioCtx()
      }
      const ctx = audioCtxRef.current
      if (ctx.state === 'suspended') {
        await ctx.resume()
      }

      const previewCut = opts?.previewCut ?? true
      const segments: { outOffset: number; srcOffset: number; dur: number }[] = []

      if (previewCut) {
        if (mode === 'keep') {
          const segDur = Math.max(0.02, endSec - startSec)
          segments.push({ outOffset: 0, srcOffset: startSec, dur: segDur })
        } else {
          let cursor = 0
          if (startSec > 0.01) {
            segments.push({ outOffset: cursor, srcOffset: 0, dur: startSec })
            cursor += startSec
          }
          const tailDur = duration - endSec
          if (tailDur > 0.01) {
            segments.push({ outOffset: cursor, srcOffset: endSec, dur: tailDur })
          }
        }
      } else {
        const from = Math.max(0, Math.min(duration - 0.02, opts?.fromSec ?? currentTime))
        segments.push({ outOffset: 0, srcOffset: from, dur: Math.max(0.02, duration - from) })
      }

      if (segments.length === 0) {
        toast.error('当前选区无有效可播放片段')
        return
      }

      const totalDur = segments.reduce((acc, s) => acc + s.dur, 0)
      const now = ctx.currentTime + 0.02

      const masterGain = ctx.createGain()
      const baseGain = Math.max(0, Math.min(2, gainPct / 100))
      if (previewCut) {
        const maxFade = totalDur * 0.49
        const fi = Math.min(maxFade, Math.max(0, fadeInSec))
        const fo = Math.min(maxFade, Math.max(0, fadeOutSec))
        if (fi > 0.01) {
          masterGain.gain.setValueAtTime(0.0001, now)
          masterGain.gain.linearRampToValueAtTime(Math.max(0.0001, baseGain), now + fi)
        } else {
          masterGain.gain.setValueAtTime(baseGain, now)
        }
        if (fo > 0.01) {
          masterGain.gain.setValueAtTime(Math.max(0.0001, baseGain), now + totalDur - fo)
          masterGain.gain.linearRampToValueAtTime(0.0001, now + totalDur)
        }
      } else {
        masterGain.gain.setValueAtTime(baseGain, now)
      }
      masterGain.connect(ctx.destination)

      const nodes: AudioBufferSourceNode[] = []
      segments.forEach((seg, idx) => {
        const src = ctx.createBufferSource()
        src.buffer = audioBuffer
        src.connect(masterGain)
        src.start(now + seg.outOffset, seg.srcOffset, seg.dur)
        if (idx === segments.length - 1) {
          src.onended = () => {
            if (!playMetaRef.current.active) return
            if (playMetaRef.current.loop && previewCut) {
              startPlayback({ previewCut: true })
            } else {
              stopPlayback()
            }
          }
        }
        nodes.push(src)
      })

      activeSourcesRef.current = nodes
      playMetaRef.current = {
        active: true,
        startedAtCtx: now,
        segments,
        totalDur,
        loop: loopSelection && previewCut,
      }
      setCurrentTime(segments[0].srcOffset)
      setIsPlaying(true)
    },
    [
      audioBuffer,
      stopPlayback,
      mode,
      startSec,
      endSec,
      duration,
      currentTime,
      gainPct,
      fadeInSec,
      fadeOutSec,
      loopSelection,
    ],
  )

  const handleLoadFiles = useCallback(
    async (files: File[]) => {
      const file = files[0]
      if (!file) return
      stopPlayback()
      setDecoding(true)
      try {
        const decoded = await decodeAudioFile(file)
        const wf = extractWaveformPeaks(decoded, 2000)
        setAudioBuffer(decoded)
        setPeaks(wf)
        setFileName(file.name)
        setFileSize(file.size)
        setMode('keep')
        setStartSec(0)
        setEndSec(decoded.duration)
        setCurrentTime(0)
        setZoom(1)
        setScrollSec(0)
        setFadeInSec(0)
        setFadeOutSec(0)
        setGainPct(100)
        setNormalize(false)
        toast.success(
          `音频已解码（${formatAudioTime(decoded.duration)} · ${(decoded.sampleRate / 1000).toFixed(1)} kHz）`,
        )
      } catch {
        toast.error('无法解码该文件，请上传常见音频格式（MP3 / WAV / FLAC / OGG / M4A）或 MP4 视频')
      } finally {
        setDecoding(false)
      }
    },
    [stopPlayback],
  )

  // 键盘快捷键
  useEffect(() => {
    if (!audioBuffer) return
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === ' ') {
        e.preventDefault()
        if (isPlaying) stopPlayback()
        else startPlayback({ previewCut: true })
      } else if (e.key === '[') {
        e.preventDefault()
        const nextS = Math.min(endSec - 0.1, currentTime)
        if (nextS >= 0) setStartSec(nextS)
      } else if (e.key === ']') {
        e.preventDefault()
        const nextE = Math.max(startSec + 0.1, currentTime)
        if (nextE <= duration) setEndSec(nextE)
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault()
        setLoopSelection((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [audioBuffer, isPlaying, stopPlayback, startPlayback, currentTime, startSec, endSec, duration])

  const handleChangeZoom = (nextZoom: number) => {
    const clamped = Math.max(1, Math.min(16, nextZoom))
    setZoom(clamped)
    if (clamped === 1) {
      setScrollSec(0)
    } else if (duration > 0) {
      const visible = duration / clamped
      // 以当前选区中心或播放头为中心平滑缩放
      const anchor = (startSec + endSec) / 2
      setScrollSec(Math.max(0, Math.min(duration - visible, anchor - visible / 2)))
    }
  }

  const handleRangeChange = (nextS: number, nextE: number) => {
    setStartSec(nextS)
    setEndSec(nextE)
  }

  const handleSeek = (sec: number) => {
    setCurrentTime(sec)
    if (isPlaying) {
      startPlayback({ fromSec: sec, previewCut: false })
    }
  }

  const applyStartInput = () => {
    const parsed = parseAudioTime(startInput)
    if (parsed === null) {
      setStartInput(formatAudioTime(startSec))
      return
    }
    const clamped = Math.max(0, Math.min(endSec - 0.05, parsed))
    setStartSec(clamped)
  }

  const applyEndInput = () => {
    const parsed = parseAudioTime(endInput)
    if (parsed === null) {
      setEndInput(formatAudioTime(endSec))
      return
    }
    const clamped = Math.min(duration, Math.max(startSec + 0.05, parsed))
    setEndSec(clamped)
  }

  const resultDuration = useMemo(
    () => computeResultDuration(duration, startSec, endSec, mode),
    [duration, startSec, endSec, mode],
  )

  const outputMeta = useMemo(() => {
    if (!audioBuffer) return { sampleRate: 44100, channels: 2 }
    return resolveOutputFormatMeta(audioBuffer, sampleRate, channels)
  }, [audioBuffer, sampleRate, channels])

  const estimatedBytes = useMemo(
    () =>
      estimateOutputBytes({
        durationSec: resultDuration,
        format: exportFormat,
        bitrateKbps: bitrate,
        sampleRate: outputMeta.sampleRate,
        channels: outputMeta.channels,
      }),
    [resultDuration, exportFormat, bitrate, outputMeta],
  )

  /** 渲染并导出最终 WAV / MP3 文件 */
  const handleExport = async () => {
    if (!audioBuffer) return
    if (resultDuration < 0.05) {
      toast.error('裁剪后的有效时长过短，请重新调整选区')
      return
    }
    stopPlayback()
    setExporting(true)
    setExportPct(5)
    setExportStage('正在离线渲染剪辑、淡入淡出与增益…')

    try {
      const processed = await renderProcessedAudio(audioBuffer, {
        mode,
        startSec,
        endSec,
        fadeInSec,
        fadeOutSec,
        gain: gainPct / 100,
        normalize,
        sampleRate,
        channels,
      })

      let blob: Blob
      const stem = sanitizeStem(fileName)
      const suffix = mode === 'keep' ? 'clip' : 'cut'

      if (exportFormat === 'wav') {
        setExportStage('正在封装无损 16-bit WAV…')
        setExportPct(75)
        blob = encodeAudioBufferToWav(processed)
        setExportPct(100)
        downloadBlob(blob, `${stem}_${suffix}.wav`)
      } else {
        setExportStage(`正在编码 ${bitrate} kbps MP3…`)
        blob = await encodeAudioBufferToMp3(processed, bitrate, (pct) => {
          setExportPct(Math.max(10, pct))
        })
        downloadBlob(blob, `${stem}_${suffix}_${bitrate}k.mp3`)
      }

      toast.success(
        `导出成功（${formatAudioTime(processed.duration)} · ${formatBytes(blob.size)}）`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '音频导出失败')
    } finally {
      setExporting(false)
      setExportPct(0)
      setExportStage('')
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 pb-12">
      {!audioBuffer || !peaks ? (
        <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 pt-2">
          {decoding ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-border/75 bg-card/85 py-20 shadow-sm">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <div className="text-sm font-semibold text-foreground">正在本地解码音频与生成波形图…</div>
              <div className="text-xs text-muted-foreground">全程在浏览器内存中处理，文件不会上传</div>
            </div>
          ) : (
            <FileDropzone
              accept="audio/*,video/*,.mp3,.wav,.flac,.ogg,.m4a,.aac,.webm,.mp4,.mov"
              multiple={false}
              onFiles={handleLoadFiles}
              title="拖放音频文件（或 MP4 视频提取音轨）到这里"
              hint="支持 MP3 / WAV / FLAC / OGG / M4A / AAC，也支持拖入视频直接提取并剪辑音轨 · 100% 纯本地处理"
            />
          )}
          <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              Web Audio API 纯本地处理
            </span>
            <span>·</span>
            <span>可视化缩放波形裁剪</span>
            <span>·</span>
            <span>淡入淡出 / 响度归一化 / 导出 WAV & MP3</span>
          </div>
        </section>
      ) : (
        <>
          {/* 顶部音频信息条 */}
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/75 bg-card/85 px-4 py-3 text-xs shadow-sm backdrop-blur-md">
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
              <div className="flex min-w-0 items-center gap-2 font-bold text-foreground">
                <AudioWaveform className="h-4 w-4 shrink-0 text-primary" />
                <span className="max-w-[240px] truncate sm:max-w-[380px]" title={fileName}>
                  {fileName}
                </span>
              </div>
              <span className="rounded-md bg-muted/70 px-2 py-0.5 font-mono text-[11px] text-foreground">
                {formatAudioTime(duration)}
              </span>
              <span className="font-mono text-muted-foreground">
                {(audioBuffer.sampleRate / 1000).toFixed(1)} kHz ·{' '}
                {audioBuffer.numberOfChannels === 1 ? '单声道' : `${audioBuffer.numberOfChannels} 声道`}
              </span>
              <span className="font-mono text-muted-foreground">{formatBytes(fileSize)}</span>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                stopPlayback()
                setAudioBuffer(null)
                setPeaks(null)
              }}
              className="h-8 text-xs"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              更换音频
            </Button>
          </section>

          {/* 中央交互式波形舞台 */}
          <section className="flex flex-col gap-3.5 rounded-2xl border border-border/75 bg-card/85 p-4 shadow-sm sm:p-5">
            {/* 波形顶栏：裁剪模式 + 缩放控件 */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <Segmented
                  size="sm"
                  value={mode}
                  onChange={(v) => {
                    stopPlayback()
                    setMode(v as CutMode)
                  }}
                  options={[
                    { value: 'keep', label: '保留选区（裁出片段）' },
                    { value: 'remove', label: '剪除选区（删掉中间）' },
                  ]}
                />
                <span className="font-mono text-xs text-muted-foreground">
                  成品时长：<strong className="text-foreground">{formatAudioTime(resultDuration)}</strong>
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={zoom <= 1}
                  onClick={() => handleChangeZoom(zoom / 2)}
                  title="缩小波形"
                  className="h-7 w-7 p-0"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <div className="flex items-center gap-0.5 rounded-lg border border-border/70 bg-muted/35 p-0.5 font-mono text-[11px]">
                  {ZOOM_STEPS.map((z) => (
                    <button
                      key={z}
                      type="button"
                      onClick={() => handleChangeZoom(z)}
                      className={cn(
                        'rounded px-1.5 py-0.5 transition-colors',
                        zoom === z
                          ? 'bg-primary text-primary-foreground font-semibold'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {z}x
                    </button>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={zoom >= 16}
                  onClick={() => handleChangeZoom(zoom * 2)}
                  title="放大波形"
                  className="h-7 w-7 p-0"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStartSec(0)
                    setEndSec(duration)
                    setZoom(1)
                    setScrollSec(0)
                  }}
                  title="重置选区与缩放"
                  className="h-7 px-2 text-[11px]"
                >
                  <Maximize2 className="mr-1 h-3 w-3" />
                  全曲
                </Button>
              </div>
            </div>

            {/* 高清交互波形画布 */}
            <WaveformCanvas
              peaks={peaks}
              duration={duration}
              currentTime={currentTime}
              startSec={startSec}
              endSec={endSec}
              mode={mode}
              fadeInSec={fadeInSec}
              fadeOutSec={fadeOutSec}
              zoom={zoom}
              scrollSec={scrollSec}
              onChangeRange={handleRangeChange}
              onSeek={handleSeek}
              onChangeScroll={setScrollSec}
            />

            {/* 放大时的横向视野滚动滑块 */}
            {zoom > 1 && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="shrink-0">波形视野</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, duration - duration / zoom)}
                  step={0.01}
                  value={scrollSec}
                  onChange={(e) => setScrollSec(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
            )}

            {/* 试听控制 + 精确起止时间微调 */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/65 bg-muted/25 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    if (isPlaying) stopPlayback()
                    else startPlayback({ previewCut: true })
                  }}
                  className="h-9 px-4"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="mr-1.5 h-4 w-4" />
                      停止试听
                    </>
                  ) : (
                    <>
                      <Play className="mr-1.5 h-4 w-4" />
                      {mode === 'keep' ? '试听选区效果' : '试听剪除后效果'}
                    </>
                  )}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => startPlayback({ fromSec: currentTime, previewCut: false })}
                  className="h-9 text-xs"
                >
                  从指针播原音
                </Button>
                <Button
                  variant={loopSelection ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setLoopSelection((v) => !v)}
                  className={cn(
                    'h-9 text-xs',
                    loopSelection && 'border border-primary/40 bg-primary/12 text-primary',
                  )}
                >
                  <Repeat className="mr-1 h-3.5 w-3.5" />
                  循环
                </Button>
              </div>

              {/* 精确时间输入框 */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">起点</span>
                  <input
                    type="text"
                    aria-label="选区起点"
                    value={startInput}
                    onChange={(e) => setStartInput(e.target.value)}
                    onBlur={applyStartInput}
                    onKeyDown={(e) => e.key === 'Enter' && applyStartInput()}
                    className="h-8 w-24 rounded-lg border border-border/80 bg-background px-2 text-center font-mono text-xs font-semibold outline-none focus:border-primary"
                  />
                </div>
                <span className="text-muted-foreground">→</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">终点</span>
                  <input
                    type="text"
                    aria-label="选区终点"
                    value={endInput}
                    onChange={(e) => setEndInput(e.target.value)}
                    onBlur={applyEndInput}
                    onKeyDown={(e) => e.key === 'Enter' && applyEndInput()}
                    className="h-8 w-24 rounded-lg border border-border/80 bg-background px-2 text-center font-mono text-xs font-semibold outline-none focus:border-primary"
                  />
                </div>
                <span className="hidden font-mono text-[11px] text-amber-600 sm:inline dark:text-amber-400">
                  指针 {formatAudioTime(currentTime)}
                </span>
              </div>
            </div>

            <div className="text-[11px] text-muted-foreground">
              提示：拖动波形左右耳标调整选区，拖动选区内部整体平移，点击顶部标尺跳转指针；快捷键{' '}
              <kbd className="rounded border px-1 font-mono">Space</kbd> 试听 ·{' '}
              <kbd className="rounded border px-1 font-mono">[</kbd>/
              <kbd className="rounded border px-1 font-mono">]</kbd> 设起止点 ·{' '}
              <kbd className="rounded border px-1 font-mono">L</kbd> 开关循环
            </div>
          </section>

          {/* 底部双栏：音效处理 + 格式转换导出 */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* 左卡：淡入淡出与音量处理 */}
            <section className="flex flex-col gap-4 rounded-2xl border border-border/75 bg-card/85 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <SlidersHorizontal className="h-4 w-4 text-primary" />
                  <span>淡入淡出与响度处理</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFadeInSec(0)
                    setFadeOutSec(0)
                    setGainPct(100)
                    setNormalize(false)
                  }}
                  className="text-xs text-muted-foreground hover:text-primary"
                >
                  重置音效
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">淡入（Fade In）</span>
                    <span className="font-mono font-semibold text-foreground">{fadeInSec.toFixed(1)} s</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.min(10, Math.max(1, Number((resultDuration / 2).toFixed(1))))}
                    step={0.1}
                    value={fadeInSec}
                    onChange={(e) => setFadeInSec(Number(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-sky-600 dark:text-sky-400 font-medium">淡出（Fade Out）</span>
                    <span className="font-mono font-semibold text-foreground">{fadeOutSec.toFixed(1)} s</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.min(10, Math.max(1, Number((resultDuration / 2).toFixed(1))))}
                    step={0.1}
                    value={fadeOutSec}
                    onChange={(e) => setFadeOutSec(Number(e.target.value))}
                    className="w-full accent-sky-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Volume2 className="h-3.5 w-3.5" />
                    音量增益
                  </span>
                  <span className="font-mono font-semibold text-foreground">{gainPct}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={5}
                  value={gainPct}
                  onChange={(e) => setGainPct(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border/65 bg-muted/25 px-3.5 py-2.5 text-xs">
                <div className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <div className="font-medium text-foreground">自动响度峰值归一化（-0.5 dB）</div>
                    <div className="text-[11px] text-muted-foreground">
                      自动放大偏小的录音音量，同时避免爆音削波
                    </div>
                  </div>
                </div>
                <Switch checked={normalize} onChange={setNormalize} label="响度归一化" />
              </div>
            </section>

            {/* 右卡：格式转换与导出 */}
            <section className="flex flex-col justify-between gap-4 rounded-2xl border border-border/75 bg-card/85 p-5 shadow-sm">
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <Scissors className="h-4 w-4 text-primary" />
                  <span>导出格式与编码参数</span>
                </div>

                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">目标格式</div>
                  <Segmented
                    value={exportFormat}
                    onChange={(v) => setExportFormat(v as AudioExportFormat)}
                    options={[
                      { value: 'mp3', label: 'MP3（通用压缩）' },
                      { value: 'wav', label: 'WAV（16-bit 无损 PCM）' },
                    ]}
                  />
                </div>

                {exportFormat === 'mp3' && (
                  <>
                    {/* 场景一键预设（语音 / 播客 / 标准音乐 / 极品音乐） */}
                    <div className="space-y-1.5">
                      <div className="text-xs text-muted-foreground">快捷场景预设</div>
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                        {EXPORT_SCENE_PRESETS.map((p) => {
                          const active =
                            exportFormat === p.format &&
                            bitrate === p.bitrate &&
                            sampleRate === p.sampleRate &&
                            channels === p.channels
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                setExportFormat(p.format)
                                setBitrate(p.bitrate)
                                setSampleRate(p.sampleRate)
                                setChannels(p.channels)
                              }}
                              className={cn(
                                'rounded-xl border px-2 py-1.5 text-left transition-colors',
                                active
                                  ? 'border-primary bg-primary/12 text-primary'
                                  : 'border-border/70 bg-background/60 text-foreground/85 hover:border-border',
                              )}
                            >
                              <div className="text-xs font-semibold">{p.label}</div>
                              <div className="text-[10px] text-muted-foreground">{p.desc}</div>
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>MP3 比特率</span>
                        <span className="text-[11px]">语音推荐 48–64 kbps · 音乐推荐 128–320 kbps</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {BITRATE_OPTIONS.map(({ kbps, tag }) => (
                          <button
                            key={kbps}
                            type="button"
                            onClick={() => setBitrate(kbps)}
                            className={cn(
                              'rounded-xl border px-1.5 py-1.5 text-center transition-colors',
                              bitrate === kbps
                                ? 'border-primary bg-primary/12 text-primary'
                                : 'border-border/75 bg-background/70 text-muted-foreground hover:text-foreground',
                            )}
                          >
                            <div className="font-mono text-xs font-semibold">{kbps}k</div>
                            <div className="text-[10px] opacity-80">{tag}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="space-y-1.5">
                    <label className="text-muted-foreground">输出采样率</label>
                    <select
                      value={sampleRate}
                      onChange={(e) => setSampleRate(e.target.value as SampleRatePreset)}
                      className="h-9 w-full rounded-xl border border-border/80 bg-background px-2.5 font-mono text-xs outline-none focus:border-primary"
                    >
                      <option value="original">保持原采样率（{(audioBuffer.sampleRate / 1000).toFixed(1)} kHz）</option>
                      <option value="48000">48.0 kHz（视频标准）</option>
                      <option value="44100">44.1 kHz（CD 音乐）</option>
                      <option value="24000">24.0 kHz（清晰语音推荐）</option>
                      <option value="22050">22.05 kHz（语音兼容）</option>
                      <option value="16000">16.0 kHz（超轻人声）</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-muted-foreground">声道模式</label>
                    <select
                      value={channels}
                      onChange={(e) => setChannels(e.target.value as ChannelPreset)}
                      className="h-9 w-full rounded-xl border border-border/80 bg-background px-2.5 text-xs outline-none focus:border-primary"
                    >
                      <option value="original">保持原声道（{audioBuffer.numberOfChannels === 1 ? '单声道' : '立体声'}）</option>
                      <option value="stereo">立体声（2 声道）</option>
                      <option value="mono">单声道（1 声道 · 语音省体积）</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-2.5 border-t border-border/55 pt-3.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    成品：{formatAudioTime(resultDuration)} · {(outputMeta.sampleRate / 1000).toFixed(1)} kHz ·{' '}
                    {outputMeta.channels === 1 ? '单声道' : '立体声'}
                  </span>
                  <span className="font-mono font-semibold text-foreground">
                    预估 {formatBytes(estimatedBytes)}
                  </span>
                </div>

                {exporting ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 font-medium text-primary">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {exportStage}
                      </span>
                      <span className="font-mono text-muted-foreground">{exportPct}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-150"
                        style={{ width: `${exportPct}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <Button
                    onClick={handleExport}
                    disabled={resultDuration < 0.05}
                    className="h-10 w-full"
                  >
                    <Download className="mr-1.5 h-4 w-4" />
                    导出 {exportFormat.toUpperCase()} 音频文件
                  </Button>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
