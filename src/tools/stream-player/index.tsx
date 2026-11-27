import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Activity,
  AlertCircle,
  Camera,
  Captions,
  Check,
  Copy,
  ExternalLink,
  FlipHorizontal2,
  FolderOpen,
  KeyRound,
  Loader2,
  Maximize2,
  Minimize2,
  PictureInPicture2,
  Play,
  Radio,
  RefreshCw,
  RotateCw,
  Shield,
  ShieldCheck,
  Star,
  Tv,
  Unlock,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/field'
import { copyImageToClipboard, downloadBlob, timestampName } from '@/lib/file'
import { cn } from '@/lib/utils'
import { ChannelSidebar } from './ChannelSidebar'
import {
  buildStreamProxyUrl,
  captureVideoFrameToPng,
  clearPlayHistory,
  fetchStreamProxyStatus,
  loadFavorites,
  loadPlayHistory,
  loadSavedChannels,
  loadSavedProxyToken,
  mountStreamPlayer,
  pushPlayHistory,
  saveChannels,
  saveFavorites,
  saveProxyToken,
  verifyStreamProxyToken,
  type PlayerSession,
  type QualityLevel,
  type StreamProxyStatus,
  type StreamTelemetry,
} from './engine'
import {
  buildExternalPlayerUrls,
  convertSrtToVtt,
  detectStreamProtocol,
  guessNameFromUrl,
  parsePlaylistText,
  protocolLabel,
  SAMPLE_STREAMS,
  type ChannelItem,
  type PlayHistoryItem,
  type StreamProtocol,
} from './playlist'

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]

const PROTOCOL_OPTIONS: { value: StreamProtocol; label: string }[] = [
  { value: 'auto', label: '自动识别' },
  { value: 'hls', label: 'HLS (.m3u8)' },
  { value: 'flv', label: 'HTTP-FLV' },
  { value: 'mpegts', label: 'MPEG-TS' },
  { value: 'native', label: '原生 MP4/WebM' },
]

export default function StreamPlayerTool() {
  // 播放源与配置状态
  const [urlInput, setUrlInput] = useState('')
  const [currentUrl, setCurrentUrl] = useState('')
  const [currentTitle, setCurrentTitle] = useState('')
  const [protocol, setProtocol] = useState<StreamProtocol>('auto')
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle')
  const [errorInfo, setErrorInfo] = useState<{ message: string; maybeCors: boolean } | null>(null)

  // 后端跨域代理状态
  const [proxyStatus, setProxyStatus] = useState<StreamProxyStatus | null>(null)
  const [useProxy, setUseProxy] = useState(false)
  const [proxyOpen, setProxyOpen] = useState(false)
  const [proxyToken, setProxyToken] = useState(() => loadSavedProxyToken())
  const [tokenVerified, setTokenVerified] = useState(false)
  const [verifyingToken, setVerifyingToken] = useState(false)
  const [customReferer, setCustomReferer] = useState('')
  const [customUa, setCustomUa] = useState('')

  // 播放器增强控制
  const [levels, setLevels] = useState<QualityLevel[]>([])
  const [currentLevel, setCurrentLevel] = useState(-1)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [mirrorX, setMirrorX] = useState(false)
  const [showHud, setShowHud] = useState(true)
  const [theaterMode, setTheaterMode] = useState(false)
  const [telemetry, setTelemetry] = useState<StreamTelemetry | null>(null)
  const [subtitleTrack, setSubtitleTrack] = useState<{ url: string; name: string } | null>(null)
  const [copiedUrl, setCopiedUrl] = useState(false)

  // 频道列表、收藏与历史
  const [channels, setChannels] = useState<ChannelItem[]>(() => loadSavedChannels())
  const [favorites, setFavorites] = useState<ChannelItem[]>(() => loadFavorites())
  const [history, setHistory] = useState<PlayHistoryItem[]>(() => loadPlayHistory())

  const videoRef = useRef<HTMLVideoElement>(null)
  const sessionRef = useRef<PlayerSession | null>(null)
  const localVideoUrlRef = useRef<string | null>(null)
  const localVideoInputRef = useRef<HTMLInputElement>(null)
  const subtitleInputRef = useRef<HTMLInputElement>(null)

  // 启动时探活后端流媒体代理服务
  useEffect(() => {
    let active = true
    fetchStreamProxyStatus().then((st) => {
      if (!active) return
      setProxyStatus(st)
      if (st.online && st.enabled && !st.requiresAuth) {
        setTokenVerified(true)
      } else if (st.online && st.enabled && proxyToken) {
        verifyStreamProxyToken(proxyToken).then((res) => {
          if (active && res.ok) setTokenVerified(true)
        })
      }
    })
    return () => {
      active = false
    }
  }, [proxyToken])

  // 组件卸载时彻底销毁解码会话与临时 ObjectURL
  useEffect(() => {
    return () => {
      sessionRef.current?.destroy()
      sessionRef.current = null
      if (localVideoUrlRef.current) URL.revokeObjectURL(localVideoUrlRef.current)
      if (subtitleTrack?.url) URL.revokeObjectURL(subtitleTrack.url)
    }
  }, [subtitleTrack?.url])

  /** 核心起播入口 */
  const startPlayback = useCallback(
    async (opts: {
      url: string
      title?: string
      protocolOverride?: StreamProtocol
      proxy?: boolean
      referer?: string
      userAgent?: string
      isLiveHint?: boolean
      recordHistory?: boolean
    }) => {
      const targetUrl = opts.url.trim()
      if (!targetUrl) {
        toast.error('请输入视频或直播流地址')
        return
      }
      const video = videoRef.current
      if (!video) return

      const shouldProxy = Boolean(opts.proxy) && !targetUrl.startsWith('blob:')
      if (shouldProxy && proxyStatus?.online && proxyStatus.requiresAuth && !proxyToken) {
        setProxyOpen(true)
        toast.error('后端代理需要验证口令，请先输入代理口令')
        return
      }

      sessionRef.current?.destroy()
      sessionRef.current = null

      const nextProto = opts.protocolOverride ?? protocol
      const title = opts.title?.trim() || guessNameFromUrl(targetUrl)
      const refVal = opts.referer !== undefined ? opts.referer : customReferer
      const uaVal = opts.userAgent !== undefined ? opts.userAgent : customUa

      setCurrentUrl(targetUrl)
      setCurrentTitle(title)
      setErrorInfo(null)
      setTelemetry(null)
      setLevels([])
      setCurrentLevel(-1)

      const actualPlayUrl = shouldProxy
        ? buildStreamProxyUrl(targetUrl, {
            token: proxyToken,
            referer: refVal.trim() || undefined,
            userAgent: uaVal.trim() || undefined,
          })
        : targetUrl

      if (opts.recordHistory !== false && !targetUrl.startsWith('blob:')) {
        const nextHist = pushPlayHistory({
          url: targetUrl,
          name: title,
          protocol: nextProto,
          useProxy: shouldProxy,
          referer: refVal.trim() || undefined,
          playedAt: Date.now(),
        })
        setHistory(nextHist)
      }

      const session = await mountStreamPlayer({
        video,
        playUrl: actualPlayUrl,
        originalUrl: targetUrl,
        protocolOverride: nextProto,
        isLiveHint: opts.isLiveHint,
        onLevels: (lv, cur) => {
          setLevels(lv)
          setCurrentLevel(cur)
        },
        onTelemetry: setTelemetry,
        onStatus: (st) => setStatus(st),
        onError: (message, maybeCors) => {
          setErrorInfo({ message, maybeCors })
        },
      })

      sessionRef.current = session
      video.playbackRate = playbackRate
    },
    [protocol, customReferer, customUa, proxyStatus, proxyToken, playbackRate],
  )

  /** 地址栏提交播放 */
  const handlePlaySubmit = () => {
    const raw = urlInput.trim()
    if (!raw) return
    void startPlayback({
      url: raw,
      protocolOverride: protocol,
      proxy: useProxy,
    })
  }

  /** 播放本地视频文件 */
  const handleLocalVideoFile = (file?: File) => {
    if (!file) return
    // 若拖入的是 .m3u / .m3u8 列表文件（且体积较小）则按频道列表导入
    if (/\.(m3u|m3u8|txt)$/i.test(file.name) && file.size < 2 * 1024 * 1024) {
      file.text().then((text) => {
        const parsed = parsePlaylistText(text, file.name.replace(/\.[^.]+$/, ''))
        if (parsed.length > 0) {
          setChannels(parsed)
          saveChannels(parsed)
          toast.success(`已从「${file.name}」导入 ${parsed.length} 个频道`)
        } else {
          toast.error('该文件不是有效的 M3U 频道列表')
        }
      })
      return
    }

    if (localVideoUrlRef.current) URL.revokeObjectURL(localVideoUrlRef.current)
    const blobUrl = URL.createObjectURL(file)
    localVideoUrlRef.current = blobUrl
    setUrlInput(file.name)
    setUseProxy(false)
    void startPlayback({
      url: blobUrl,
      title: file.name,
      protocolOverride: 'native',
      proxy: false,
      recordHistory: false,
    })
    toast.success(`已载入本地视频「${file.name}」`)
  }

  /** 加载外挂 .srt / .vtt 字幕 */
  const handleSubtitleFile = async (file?: File) => {
    if (!file) return
    try {
      const raw = await file.text()
      const vtt = convertSrtToVtt(raw)
      const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt;charset=utf-8' }))
      setSubtitleTrack((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url)
        return { url, name: file.name }
      })
      toast.success(`已挂载字幕「${file.name}」`)
    } catch {
      toast.error('字幕文件读取失败')
    } finally {
      if (subtitleInputRef.current) subtitleInputRef.current.value = ''
    }
  }

  /** 截图并下载或复制 */
  const handleScreenshot = async (copyOnly = false) => {
    const video = videoRef.current
    if (!video || !currentUrl) return
    try {
      const blob = await captureVideoFrameToPng(video, rotation, mirrorX)
      if (copyOnly) {
        await copyImageToClipboard(blob)
        toast.success('当前画面已复制到剪贴板')
      } else {
        downloadBlob(blob, timestampName('stream-shot', 'png'))
        toast.success('已保存高清截图（PNG）')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '截图失败')
    }
  }

  /** 画中画 */
  const handleTogglePiP = async () => {
    const video = videoRef.current
    if (!video) return
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture()
      } else {
        toast.error('当前浏览器不支持画中画模式')
      }
    } catch {
      toast.error('请先播放视频再开启画中画')
    }
  }

  /** 验证后端代理口令 */
  const handleVerifyProxyToken = async () => {
    if (!proxyToken.trim()) {
      toast.error('请输入代理口令')
      return
    }
    setVerifyingToken(true)
    const res = await verifyStreamProxyToken(proxyToken.trim())
    setVerifyingToken(false)
    if (res.ok) {
      saveProxyToken(proxyToken.trim())
      setTokenVerified(true)
      setUseProxy(true)
      toast.success('代理口令验证通过，已开启后端跨域代理')
    } else {
      setTokenVerified(false)
      toast.error(res.message || '代理口令不正确')
    }
  }

  /** 收藏/取消收藏当前地址 */
  const isCurrentFavorite = useMemo(
    () => Boolean(currentUrl && !currentUrl.startsWith('blob:') && favorites.some((f) => f.url === currentUrl)),
    [currentUrl, favorites],
  )

  const handleToggleFavorite = useCallback((item: ChannelItem) => {
    setFavorites((prev) => {
      const exists = prev.some((f) => f.url === item.url)
      const next = exists ? prev.filter((f) => f.url !== item.url) : [item, ...prev]
      saveFavorites(next)
      toast.success(exists ? `已取消收藏「${item.name}」` : `已收藏「${item.name}」`)
      return next
    })
  }, [])

  /** 快捷键操控（在非输入焦点的状态下生效） */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable)) return
      const video = videoRef.current
      if (!video || !currentUrl) return

      if (e.code === 'Space') {
        e.preventDefault()
        if (video.paused) video.play().catch(() => {})
        else video.pause()
      } else if (e.key === 'ArrowRight' && Number.isFinite(video.duration)) {
        e.preventDefault()
        video.currentTime = Math.min(video.duration, video.currentTime + 5)
      } else if (e.key === 'ArrowLeft' && Number.isFinite(video.duration)) {
        e.preventDefault()
        video.currentTime = Math.max(0, video.currentTime - 5)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        video.volume = Math.min(1, Number((video.volume + 0.1).toFixed(2)))
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        video.volume = Math.max(0, Number((video.volume - 0.1).toFixed(2)))
      } else if (e.key === 'm' || e.key === 'M') {
        video.muted = !video.muted
      } else if (e.key === 'f' || e.key === 'F') {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
        else video.requestFullscreen?.().catch(() => {})
      } else if (e.key === 's' || e.key === 'S') {
        void handleScreenshot(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [currentUrl, rotation, mirrorX])

  const detectedProto = detectStreamProtocol(currentUrl || urlInput, protocol)
  const externalUrls = currentUrl && !currentUrl.startsWith('blob:') ? buildExternalPlayerUrls(currentUrl) : null
  const isRotatedVertical = rotation === 90 || rotation === 270

  return (
    <div className="space-y-4">
      {/* 顶部地址输入与代理控制台 */}
      <div className="glass shadow-soft space-y-3 rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Tv className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handlePlaySubmit()
              }}
              placeholder="粘贴直播或视频地址（支持 .m3u8 / .flv / .ts / .mp4 / .webm）"
              className="border-border/70 bg-background/70 focus:border-primary focus:ring-primary/20 w-full rounded-xl border py-2.5 pr-9 pl-9 text-sm outline-none focus:ring-2"
            />
            {urlInput && (
              <button
                type="button"
                onClick={() => setUrlInput('')}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          <select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as StreamProtocol)}
            className="border-border/70 bg-background/70 h-10 rounded-xl border px-3 text-xs font-medium outline-none"
            title="强制指定流媒体协议"
          >
            {PROTOCOL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <Button variant="primary" size="md" onClick={handlePlaySubmit}>
            <Play />
            播放
          </Button>

          <Button variant="outline" size="md" onClick={() => localVideoInputRef.current?.click()} title="打开本地视频或 M3U 列表">
            <FolderOpen />
            <span className="hidden sm:inline">本地视频</span>
          </Button>
          <input
            ref={localVideoInputRef}
            type="file"
            accept="video/*,.m3u,.m3u8,.ts,.flv,.mkv"
            className="hidden"
            onChange={(e) => handleLocalVideoFile(e.target.files?.[0])}
          />
        </div>

        {/* 次级控制栏：后端跨域代理开关 + 防盗链头展开 + 一键体验测试源 */}
        <div className="border-border/50 flex flex-wrap items-center justify-between gap-2.5 border-t pt-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                checked={useProxy}
                onChange={(checked) => {
                  if (checked && !proxyStatus?.online) {
                    toast.error('未检测到后端服务，当前仅支持浏览器直连播放')
                    return
                  }
                  if (checked && !proxyStatus?.enabled) {
                    toast.error('后端未开启流媒体代理（stream.enabled = false）')
                    return
                  }
                  setUseProxy(checked)
                  if (checked && proxyStatus?.requiresAuth && !tokenVerified) {
                    setProxyOpen(true)
                  }
                }}
                label="开启后端跨域代理"
              />
              <span className="text-foreground/85 font-medium">后端跨域代理</span>
              {proxyStatus?.online ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="size-3" />
                  {proxyStatus.requiresAuth ? (tokenVerified ? '已鉴权' : '需口令') : '就绪'}
                </span>
              ) : (
                <span className="bg-foreground/[0.06] text-muted-foreground rounded-full px-2 py-0.5 text-[10px]">
                  仅直连
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => setProxyOpen((v) => !v)}
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              <Shield className="size-3.5" />
              {proxyOpen ? '收起代理与防盗链设置' : '代理口令 / Referer 设置'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground hidden sm:inline">快速试播：</span>
            {SAMPLE_STREAMS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setUrlInput(s.url)
                  setProtocol(s.protocol ?? 'auto')
                  void startPlayback({
                    url: s.url,
                    title: s.name,
                    protocolOverride: s.protocol ?? 'auto',
                    proxy: false,
                    isLiveHint: s.isLive,
                  })
                }}
                className="bg-foreground/[0.06] hover:bg-primary/12 hover:text-primary rounded-lg px-2 py-1 text-[11px] font-medium transition-colors"
              >
                {s.name.split('（')[0]}
              </button>
            ))}
          </div>
        </div>

        {/* 展开：代理口令 + 自定义 Referer / User-Agent */}
        {proxyOpen && (
          <div className="bg-foreground/[0.03] border-border/60 grid gap-3 rounded-xl border p-3 text-xs md:grid-cols-3">
            <div className="space-y-1">
              <div className="text-muted-foreground flex items-center justify-between">
                <span className="flex items-center gap-1 font-medium">
                  <KeyRound className="size-3" />
                  后端代理口令
                </span>
                {tokenVerified && <span className="text-emerald-500">已验证</span>}
              </div>
              <div className="flex gap-1.5">
                <input
                  type="password"
                  value={proxyToken}
                  onChange={(e) => {
                    setProxyToken(e.target.value)
                    setTokenVerified(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleVerifyProxyToken()
                  }}
                  placeholder="对应 server/config.json stream.token"
                  className="border-border/70 bg-background/80 min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
                />
                <Button variant="primary" size="sm" className="h-auto px-2.5 text-xs" disabled={verifyingToken} onClick={handleVerifyProxyToken}>
                  {verifyingToken ? <Loader2 className="size-3.5 animate-spin" /> : <Unlock className="size-3.5" />}
                  验证
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-muted-foreground font-medium">自定义 Referer（绕过防盗链，需开启代理）</div>
              <input
                type="text"
                value={customReferer}
                onChange={(e) => setCustomReferer(e.target.value)}
                placeholder="例如：https://live.example.com/"
                className="border-border/70 bg-background/80 w-full rounded-lg border px-2.5 py-1.5 font-mono text-xs outline-none"
              />
            </div>

            <div className="space-y-1">
              <div className="text-muted-foreground font-medium">自定义 User-Agent（可选，需开启代理）</div>
              <input
                type="text"
                value={customUa}
                onChange={(e) => setCustomUa(e.target.value)}
                placeholder="留空使用默认 Chrome UA"
                className="border-border/70 bg-background/80 w-full rounded-lg border px-2.5 py-1.5 font-mono text-xs outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* 主体：左侧影院播放器 + 右侧频道侧栏（剧场模式自动收起侧栏） */}
      <div
        className={cn(
          'grid items-start gap-4',
          !theaterMode && 'xl:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)]',
        )}
      >
        {/* 播放器主栏 */}
        <div className="min-w-0 space-y-3">
          {/* 视频视口（支持直接拖放本地视频或 .m3u 文件） */}
          <div
            className="glass shadow-soft relative overflow-hidden rounded-2xl bg-black"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const f = e.dataTransfer.files?.[0]
              if (f) handleLocalVideoFile(f)
            }}
          >
            <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-neutral-950">
              <video
                ref={videoRef}
                controls
                playsInline
                crossOrigin={!currentUrl || currentUrl.startsWith('blob:') ? undefined : 'anonymous'}
                style={{
                  transform: `rotate(${rotation}deg) scaleX(${mirrorX ? -1 : 1})${isRotatedVertical ? ' scale(0.58)' : ''}`,
                }}
                className="h-full w-full object-contain transition-transform duration-200"
              >
                {subtitleTrack && (
                  <track kind="subtitles" label={subtitleTrack.name} src={subtitleTrack.url} default />
                )}
              </video>

              {/* 空态占位 */}
              {status === 'idle' && !currentUrl && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white/80">
                  <div className="flex size-16 items-center justify-center rounded-3xl bg-white/10 backdrop-blur">
                    <Tv className="size-8" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-base font-semibold">粘贴视频 / 直播地址，或点击右侧频道开播</div>
                    <p className="text-xs text-white/55">
                      支持 HLS (.m3u8)、HTTP-FLV (.flv/.ts)、MP4/WebM，也可直接拖入本地视频或 .m3u 列表文件
                    </p>
                  </div>
                </div>
              )}

              {/* 加载中指示 */}
              {status === 'loading' && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35">
                  <div className="flex items-center gap-2 rounded-full bg-black/75 px-4 py-2 text-xs text-white backdrop-blur">
                    <Loader2 className="size-4 animate-spin" />
                    <span>正在缓冲流媒体...</span>
                  </div>
                </div>
              )}

              {/* 错误诊断覆盖层 */}
              {errorInfo && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/82 p-6 text-center text-white backdrop-blur-xs">
                  <AlertCircle className="size-10 text-red-400" />
                  <div className="max-w-lg space-y-1">
                    <div className="text-sm font-semibold">播放受阻</div>
                    <p className="text-xs leading-relaxed text-white/75">{errorInfo.message}</p>
                    {errorInfo.maybeCors && !useProxy && (
                      <p className="text-[11px] text-amber-300/90">
                        提示：该直播/视频源可能未配置 CORS 跨域头，或存在 Referer 防盗链限制。
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-white/20 bg-white/10 text-white hover:bg-white/20"
                      onClick={() =>
                        void startPlayback({
                          url: currentUrl,
                          title: currentTitle,
                          protocolOverride: protocol,
                          proxy: useProxy,
                        })
                      }
                    >
                      <RefreshCw />
                      重试
                    </Button>
                    {!useProxy && proxyStatus?.online && proxyStatus.enabled && !currentUrl.startsWith('blob:') && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => {
                          setUseProxy(true)
                          if (proxyStatus.requiresAuth && !tokenVerified) {
                            setProxyOpen(true)
                            toast.info('请先输入后端代理口令完成验证')
                            return
                          }
                          void startPlayback({
                            url: currentUrl,
                            title: currentTitle,
                            protocolOverride: protocol,
                            proxy: true,
                          })
                        }}
                      >
                        <ShieldCheck />
                        改用后端跨域代理重试
                      </Button>
                    )}
                    {externalUrls && (
                      <a
                        href={externalUrls.potplayer}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 text-xs font-medium text-white hover:bg-white/20"
                      >
                        <ExternalLink className="size-3.5" />
                        PotPlayer 打开
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* 左上角 LIVE 徽章与实时监控 HUD */}
              {currentUrl && (
                <div className="pointer-events-none absolute top-3 left-3 z-10 flex flex-wrap items-center gap-1.5">
                  {telemetry?.isLive && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-600/90 px-2.5 py-0.5 text-[11px] font-semibold text-white shadow">
                      <Radio className="size-3 animate-pulse" />
                      LIVE
                    </span>
                  )}
                  <span className="rounded-full bg-black/65 px-2.5 py-0.5 font-mono text-[11px] text-white/90 backdrop-blur-xs">
                    {protocolLabel(telemetry?.protocol ?? detectedProto)}
                    {useProxy && !currentUrl.startsWith('blob:') ? ' · 代理' : ''}
                  </span>
                </div>
              )}

              {showHud && telemetry && currentUrl && (
                <div className="pointer-events-none absolute top-3 right-3 z-10 hidden rounded-xl bg-black/68 px-3 py-2 font-mono text-[11px] text-white/90 backdrop-blur-sm sm:block">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                    <span className="text-white/55">内核</span>
                    <span>{telemetry.engine}</span>
                    <span className="text-white/55">分辨率</span>
                    <span>{telemetry.width && telemetry.height ? `${telemetry.width}×${telemetry.height}` : '—'}</span>
                    <span className="text-white/55">缓冲</span>
                    <span>{telemetry.bufferedSec} s</span>
                    {telemetry.bitrateKbps > 0 && (
                      <>
                        <span className="text-white/55">码率</span>
                        <span>
                          {telemetry.bitrateKbps >= 1000
                            ? `${(telemetry.bitrateKbps / 1000).toFixed(2)} Mbps`
                            : `${telemetry.bitrateKbps} kbps`}
                        </span>
                      </>
                    )}
                    {telemetry.speedKBps > 0 && (
                      <>
                        <span className="text-white/55">速率</span>
                        <span>
                          {telemetry.speedKBps >= 1024
                            ? `${(telemetry.speedKBps / 1024).toFixed(2)} MB/s`
                            : `${telemetry.speedKBps} KB/s`}
                        </span>
                      </>
                    )}
                    {telemetry.liveLatencySec !== null && (
                      <>
                        <span className="text-white/55">直播延迟</span>
                        <span>{telemetry.liveLatencySec} s</span>
                      </>
                    )}
                    <span className="text-white/55">掉帧</span>
                    <span>
                      {telemetry.droppedFrames} / {telemetry.totalFrames}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 专业播放增强工具栏 */}
          <div className="glass shadow-soft space-y-3 rounded-2xl p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-semibold">
                  {currentTitle || '等待播放视频或直播流'}
                </span>
                {subtitleTrack && (
                  <span className="bg-primary/12 text-primary inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
                    <Captions className="size-3" />
                    {subtitleTrack.name}
                    <button
                      type="button"
                      onClick={() => {
                        URL.revokeObjectURL(subtitleTrack.url)
                        setSubtitleTrack(null)
                      }}
                      className="hover:text-red-500"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {/* HLS 清晰度选择 */}
                {levels.length > 1 && (
                  <select
                    value={currentLevel}
                    onChange={(e) => {
                      const idx = Number(e.target.value)
                      setCurrentLevel(idx)
                      sessionRef.current?.setQuality(idx)
                    }}
                    className="border-border/70 bg-background/70 h-8 rounded-lg border px-2 text-xs font-medium outline-none"
                    title="切换 HLS 清晰度"
                  >
                    <option value={-1}>清晰度：自动</option>
                    {levels.map((lv) => (
                      <option key={lv.index} value={lv.index}>
                        {lv.label}
                      </option>
                    ))}
                  </select>
                )}

                {/* 倍速 */}
                <select
                  value={playbackRate}
                  onChange={(e) => {
                    const rate = Number(e.target.value)
                    setPlaybackRate(rate)
                    if (videoRef.current) videoRef.current.playbackRate = rate
                  }}
                  className="border-border/70 bg-background/70 h-8 rounded-lg border px-2 font-mono text-xs font-medium outline-none"
                  title="播放倍速"
                >
                  {SPEED_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}×
                    </option>
                  ))}
                </select>

                {/* 直播追帧 */}
                {telemetry?.isLive && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      sessionRef.current?.catchUpLive()
                      toast.success('已同步到最新直播画面')
                    }}
                  >
                    <Radio className="text-red-500" />
                    追上直播
                  </Button>
                )}

                {/* 重载流 */}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!currentUrl}
                  title="重连 / 刷新当前流"
                  onClick={() =>
                    void startPlayback({
                      url: currentUrl,
                      title: currentTitle,
                      protocolOverride: protocol,
                      proxy: useProxy,
                    })
                  }
                >
                  <RefreshCw />
                </Button>

                {/* 一键截图 */}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!currentUrl}
                  title="保存当前画面 PNG (快捷键 S)"
                  onClick={() => void handleScreenshot(false)}
                >
                  <Camera />
                  <span className="hidden sm:inline">截图</span>
                </Button>

                {/* 旋转 / 镜像 */}
                <Button
                  variant="outline"
                  size="icon-sm"
                  title={`顺时针旋转画面（当前 ${rotation}°）`}
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                >
                  <RotateCw />
                </Button>
                <Button
                  variant={mirrorX ? 'primary' : 'outline'}
                  size="icon-sm"
                  title="水平镜像翻转"
                  onClick={() => setMirrorX((v) => !v)}
                >
                  <FlipHorizontal2 />
                </Button>

                {/* 外挂字幕 */}
                <Button
                  variant="outline"
                  size="icon-sm"
                  title="挂载本地 .srt / .vtt 字幕"
                  onClick={() => subtitleInputRef.current?.click()}
                >
                  <Captions />
                </Button>
                <input
                  ref={subtitleInputRef}
                  type="file"
                  accept=".srt,.vtt"
                  className="hidden"
                  onChange={(e) => handleSubtitleFile(e.target.files?.[0])}
                />

                {/* 画中画 */}
                <Button variant="outline" size="icon-sm" disabled={!currentUrl} title="画中画" onClick={handleTogglePiP}>
                  <PictureInPicture2 />
                </Button>

                {/* 实时监控 HUD 开关 */}
                <Button
                  variant={showHud ? 'primary' : 'outline'}
                  size="icon-sm"
                  title="切换实时码率/缓冲监控面板"
                  onClick={() => setShowHud((v) => !v)}
                >
                  <Activity />
                </Button>

                {/* 收藏当前源 */}
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={!currentUrl || currentUrl.startsWith('blob:')}
                  title={isCurrentFavorite ? '取消收藏' : '收藏当前源'}
                  onClick={() =>
                    handleToggleFavorite({
                      id: `fav-${Date.now()}`,
                      name: currentTitle || guessNameFromUrl(currentUrl),
                      url: currentUrl,
                      group: '收藏',
                      referer: customReferer.trim() || undefined,
                      userAgent: customUa.trim() || undefined,
                      protocol,
                    })
                  }
                >
                  <Star className={cn(isCurrentFavorite && 'fill-amber-500 text-amber-500')} />
                </Button>

                {/* 剧场宽屏开关 */}
                <Button
                  variant={theaterMode ? 'primary' : 'outline'}
                  size="icon-sm"
                  className="hidden xl:inline-flex"
                  title={theaterMode ? '恢复侧栏' : '剧场宽屏模式'}
                  onClick={() => setTheaterMode((v) => !v)}
                >
                  {theaterMode ? <Minimize2 /> : <Maximize2 />}
                </Button>
              </div>
            </div>

            {/* 底部快捷信息：快捷键提示 + 外置播放器直链 */}
            <div className="border-border/50 text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t pt-2.5 text-[11px]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>快捷键：空格 播放/暂停</span>
                <span>←/→ ±5秒</span>
                <span>↑/↓ 音量</span>
                <span>M 静音</span>
                <span>F 全屏</span>
                <span>S 截图</span>
              </div>

              {externalUrls && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(currentUrl).then(() => {
                        setCopiedUrl(true)
                        toast.success('已复制流地址')
                        setTimeout(() => setCopiedUrl(false), 1500)
                      })
                    }}
                    className="hover:text-foreground inline-flex items-center gap-1"
                  >
                    {copiedUrl ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                    复制地址
                  </button>
                  <span>·</span>
                  <span>外置播放器：</span>
                  <a href={externalUrls.potplayer} className="text-primary hover:underline">
                    PotPlayer
                  </a>
                  <a href={externalUrls.vlc} className="text-primary hover:underline">
                    VLC
                  </a>
                  <a href={externalUrls.iina} className="text-primary hover:underline">
                    IINA
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 右侧频道、收藏与播放历史侧栏 */}
        {!theaterMode && (
          <ChannelSidebar
            currentUrl={currentUrl}
            channels={channels}
            favorites={favorites}
            history={history}
            useProxy={useProxy}
            proxyToken={proxyToken}
            onPlayChannel={(ch) => {
              setUrlInput(ch.url)
              setProtocol(ch.protocol ?? 'auto')
              if (ch.referer) setCustomReferer(ch.referer)
              if (ch.userAgent) setCustomUa(ch.userAgent)
              void startPlayback({
                url: ch.url,
                title: ch.name,
                protocolOverride: ch.protocol ?? 'auto',
                proxy: useProxy,
                referer: ch.referer ?? customReferer,
                userAgent: ch.userAgent ?? customUa,
                isLiveHint: ch.isLive,
              })
            }}
            onPlayHistory={(h) => {
              setUrlInput(h.url)
              setProtocol(h.protocol)
              setUseProxy(h.useProxy)
              if (h.referer) setCustomReferer(h.referer)
              void startPlayback({
                url: h.url,
                title: h.name,
                protocolOverride: h.protocol,
                proxy: h.useProxy,
                referer: h.referer,
              })
            }}
            onImportChannels={(items, mode) => {
              setChannels((prev) => {
                const next = mode === 'append' ? [...prev, ...items] : items
                saveChannels(next)
                return next
              })
            }}
            onClearChannels={() => {
              setChannels([])
              saveChannels([])
            }}
            onToggleFavorite={handleToggleFavorite}
            onClearHistory={() => {
              clearPlayHistory()
              setHistory([])
              toast.success('已清空播放历史')
            }}
          />
        )}
      </div>
    </div>
  )
}
