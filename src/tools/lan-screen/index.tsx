import { AnimatePresence, motion } from 'motion/react'
import {
  Camera,
  Cast,
  Check,
  Edit3,
  Eye,
  KeyRound,
  Laptop,
  Link2,
  Loader2,
  Maximize2,
  Minimize2,
  Monitor,
  MonitorOff,
  PictureInPicture2,
  Radio,
  Send,
  ShieldCheck,
  Smartphone,
  Square,
  Tablet,
  Users,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/field'
import { canvasToBlob, downloadBlob, timestampName } from '@/lib/file'
import { cn } from '@/lib/utils'
import { playIncomingSound, playPeerArriveSound } from '../lan-transfer/types'
import { LanScreenClient } from './engine'
import {
  QUALITY_PRESETS,
  type ConnectionState,
  type DeviceType,
  type QualityPresetId,
  type ScreenInvite,
  type ScreenPeer,
  type StreamMetrics,
} from './types'

const NAME_STORAGE_KEY = 'litebox-lan-nickname'

function randomSixDigitCode(): string {
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return String(100000 + (arr[0] % 900000))
}

function DeviceIcon({ type, className }: { type: DeviceType; className?: string }) {
  if (type === 'phone') return <Smartphone className={className} />
  if (type === 'tablet') return <Tablet className={className} />
  return <Laptop className={className} />
}

export default function LanScreen() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting')
  const [self, setSelf] = useState<ScreenPeer | null>(null)
  const [peers, setPeers] = useState<ScreenPeer[]>([])
  const [roomLabel, setRoomLabel] = useState('同局域网自动发现')
  const [pairCode, setPairCode] = useState<string | null>(null)

  // 推流端配置与状态
  const [quality, setQuality] = useState<QualityPresetId>('1080p30')
  const [includeAudio, setIncludeAudio] = useState(true)
  const [castTitle, setCastTitle] = useState('')
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [viewerIds, setViewerIds] = useState<string[]>([])

  // 观看端状态
  const [remoteState, setRemoteState] = useState<'idle' | 'connecting' | 'playing'>('idle')
  const [remoteHost, setRemoteHost] = useState<ScreenPeer | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [metrics, setMetrics] = useState<StreamMetrics | null>(null)
  const [muted, setMuted] = useState(false)
  const [autoplayMutedHint, setAutoplayMutedHint] = useState(false)
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain')

  // 邀请弹窗、配对弹窗、改名与全屏状态
  const [invite, setInvite] = useState<ScreenInvite | null>(null)
  const [pairModalOpen, setPairModalOpen] = useState(false)
  const [pairInput, setPairInput] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [nativeFs, setNativeFs] = useState(false)
  const [pseudoFs, setPseudoFs] = useState(false)
  const [hudVisible, setHudVisible] = useState(true)

  const isFullscreen = nativeFs || pseudoFs
  const canCaptureScreen =
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function'

  const clientRef = useRef<LanScreenClient | null>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const viewerStageRef = useRef<HTMLDivElement>(null)
  const hudTimerRef = useRef<number | null>(null)

  // 初始化信令与投屏客户端
  useEffect(() => {
    const savedName = (() => {
      try {
        return localStorage.getItem(NAME_STORAGE_KEY) || ''
      } catch {
        return ''
      }
    })()

    const urlRoom = new URLSearchParams(window.location.search).get('room')
    const initialPair = urlRoom ? urlRoom.replace(/\D/g, '').slice(0, 6) : ''

    const client = new LanScreenClient(
      {
        onConnectionChange: setConnectionState,
        onWelcome: ({ self: me, peers: list, roomLabel: label, pairCode: code }) => {
          setSelf(me)
          setPeers(list)
          setRoomLabel(label)
          setPairCode(code)
        },
        onSelfUpdated: setSelf,
        onPeerJoined: (peer) => {
          setPeers((prev) => (prev.some((p) => p.id === peer.id) ? prev : [...prev, peer]))
          playPeerArriveSound()
        },
        onPeerLeft: (peerId) => {
          setPeers((prev) => prev.filter((p) => p.id !== peerId))
          setInvite((cur) => (cur?.fromId === peerId ? null : cur))
        },
        onPeerUpdated: (peer) => {
          setPeers((prev) => prev.map((p) => (p.id === peer.id ? peer : p)))
        },
        onLocalStreamChange: setLocalStream,
        onViewersChange: setViewerIds,
        onRemoteStreamChange: ({ stream, host, state }) => {
          setRemoteStream(stream)
          setRemoteHost(host)
          setRemoteState(state)
          if (state === 'idle') {
            setAutoplayMutedHint(false)
            setPseudoFs(false)
            if (document.fullscreenElement === viewerStageRef.current) {
              void document.exitFullscreen().catch(() => {})
            }
          }
        },
        onInviteReceived: (inv) => {
          setInvite(inv)
          playIncomingSound()
        },
        onMetricsUpdate: setMetrics,
        onToast: (type, message) => {
          if (type === 'success') toast.success(message)
          else if (type === 'error') toast.error(message)
          else toast.info(message)
        },
      },
      {
        customName: savedName,
        initialPairCode: initialPair.length === 6 ? initialPair : null,
      },
    )

    clientRef.current = client
    client.connect()

    return () => {
      client.destroy()
      clientRef.current = null
    }
  }, [])

  // 绑定本机推流预览 video
  useEffect(() => {
    const video = localVideoRef.current
    if (!video) return
    video.srcObject = localStream
    if (localStream) {
      void video.play().catch(() => {})
    }
  }, [localStream])

  // 绑定远端观看 video（自动处理浏览器有声自动播放限制）
  useEffect(() => {
    const video = remoteVideoRef.current
    if (!video) return
    video.srcObject = remoteStream
    if (!remoteStream) return

    video.muted = muted
    video.play().catch(() => {
      // 浏览器策略阻止有声播放时自动静音起播并给出明显提示按钮
      video.muted = true
      setMuted(true)
      setAutoplayMutedHint(true)
      void video.play().catch(() => {})
    })
  }, [remoteStream])

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.muted = muted
    }
  }, [muted])

  // 监听全屏状态变化
  useEffect(() => {
    const onFs = () => setNativeFs(document.fullscreenElement === viewerStageRef.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // 伪全屏下支持 ESC 退出并锁背景滚动
  useEffect(() => {
    if (!pseudoFs) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPseudoFs(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [pseudoFs])

  const bumpHud = useCallback(() => {
    setHudVisible(true)
    if (hudTimerRef.current !== null) window.clearTimeout(hudTimerRef.current)
    if (isFullscreen) {
      hudTimerRef.current = window.setTimeout(() => setHudVisible(false), 2600)
    }
  }, [isFullscreen])

  useEffect(() => {
    if (!isFullscreen) {
      setHudVisible(true)
      if (hudTimerRef.current !== null) window.clearTimeout(hudTimerRef.current)
      return
    }
    bumpHud()
    return () => {
      if (hudTimerRef.current !== null) window.clearTimeout(hudTimerRef.current)
    }
  }, [isFullscreen, bumpHud])

  const toggleViewerFullscreen = async () => {
    const el = viewerStageRef.current
    if (!el) return
    if (nativeFs) {
      await document.exitFullscreen().catch(() => setNativeFs(false))
      return
    }
    if (pseudoFs) {
      setPseudoFs(false)
      return
    }
    if (typeof el.requestFullscreen === 'function') {
      try {
        await el.requestFullscreen()
        return
      } catch {
        // 移动端降级为 CSS 铺满全屏
      }
    }
    setPseudoFs(true)
  }

  /** 画中画播放（桌面端极实用） */
  const togglePiP = async () => {
    const video = remoteVideoRef.current
    if (!video) return
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
      } else if ('requestPictureInPicture' in video) {
        await video.requestPictureInPicture()
      } else {
        toast.info('当前浏览器不支持画中画模式')
      }
    } catch {
      toast.error('无法进入画中画模式')
    }
  }

  /** 一键截屏保存当前投屏画面 */
  const captureScreenshot = async () => {
    const video = remoteVideoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) {
      toast.error('当前暂无可截取的画面')
      return
    }
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d')!.drawImage(video, 0, 0)
      const blob = await canvasToBlob(canvas, 'image/png')
      canvas.width = 0
      canvas.height = 0
      downloadBlob(blob, timestampName('投屏截屏', 'png'))
      toast.success(`已保存 ${video.videoWidth}×${video.videoHeight} 投屏截屏`)
    } catch {
      toast.error('截屏失败')
    }
  }

  const handleRenameSubmit = () => {
    setEditingName(false)
    const clean = nameDraft.trim()
    if (!clean || clean === self?.name) return
    try {
      localStorage.setItem(NAME_STORAGE_KEY, clean)
    } catch {
      // 忽略
    }
    clientRef.current?.rename(clean)
    toast.success(`本机代号已更新为「${clean}」`)
  }

  const handleJoinPairCode = (code: string | null) => {
    const clean = code ? code.replace(/\D/g, '').slice(0, 6) : null
    if (clean && clean.length !== 6) {
      toast.error('请输入完整的 6 位数字配对码')
      return
    }
    clientRef.current?.joinPairRoom(clean)
    setPairModalOpen(false)
    setPairInput('')
    toast.success(clean ? `已进入配对房间 #${clean}` : '已切回同局域网自动发现')
  }

  const copyPairShareUrl = async () => {
    if (!pairCode) return
    const u = new URL(window.location.href)
    u.searchParams.set('room', pairCode)
    try {
      await navigator.clipboard.writeText(u.toString())
      toast.success('已复制直连链接，在另一台设备打开即可加入同一投屏房间')
    } catch {
      toast.error('复制失败')
    }
  }

  const castingPeers = useMemo(() => peers.filter((p) => p.casting), [peers])
  const idlePeers = useMemo(() => peers.filter((p) => !p.casting), [peers])
  const viewerSet = useMemo(() => new Set(viewerIds), [viewerIds])

  return (
    <div className="space-y-4">
      {/* 顶部连接状态、本机代号与配对控制栏 */}
      <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium',
              connectionState === 'online'
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : connectionState === 'connecting'
                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
                  : 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
            )}
          >
            <span
              className={cn(
                'size-2 rounded-full',
                connectionState === 'online'
                  ? 'animate-pulse bg-emerald-500'
                  : connectionState === 'connecting'
                    ? 'animate-ping bg-amber-500'
                    : 'bg-rose-500',
              )}
            />
            {connectionState === 'online'
              ? `投屏信令在线 · ${peers.length} 台附近设备`
              : connectionState === 'connecting'
                ? '正在连接投屏信令…'
                : '未连接信令服务'}
          </span>

          {editingName ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleRenameSubmit()
              }}
              className="bg-background flex items-center gap-1 rounded-full border px-2.5 py-0.5"
            >
              <input
                autoFocus
                maxLength={18}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={handleRenameSubmit}
                className="w-24 bg-transparent text-xs font-semibold outline-none"
              />
              <button type="submit" className="text-primary">
                <Check className="size-3.5" />
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setNameDraft(self?.name ?? '')
                setEditingName(true)
              }}
              className="border-foreground/10 hover:border-primary/40 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium transition"
              title="点击修改本机显示代号"
            >
              <span className="text-muted-foreground">本机：</span>
              <span className="font-semibold">{self?.name ?? '识别中…'}</span>
              <Edit3 className="text-muted-foreground size-3" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {pairCode && (
            <button
              type="button"
              onClick={() => void copyPairShareUrl()}
              className="bg-primary/10 text-primary hover:bg-primary/20 inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-medium transition"
            >
              <Link2 className="size-3.5" />
              复制 #{pairCode} 邀请链
            </button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => {
              setPairInput(pairCode ?? '')
              setPairModalOpen(true)
            }}
          >
            <KeyRound className="size-3.5" />
            {pairCode ? `配对房 #${pairCode}` : roomLabel}
          </Button>
        </div>
      </div>

      {/* 未连接信令引导 */}
      {connectionState === 'offline' && (
        <div className="glass flex flex-col items-center justify-center rounded-3xl p-8 text-center">
          <div className="mb-3 flex size-14 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-500">
            <WifiOff className="size-7" />
          </div>
          <div className="text-base font-semibold">尚未检测到局域网信令服务</div>
          <p className="text-muted-foreground mt-1.5 max-w-md text-xs leading-relaxed">
            请先启动项目独立的后端服务 <code className="bg-muted rounded px-1.5 py-0.5 font-mono">cd server && node index.mjs</code>，两台同局域网设备打开本页即可免装 App 无线投屏。
          </p>
          <Button variant="primary" size="sm" className="mt-4" onClick={() => clientRef.current?.connect()}>
            重新连接
          </Button>
        </div>
      )}

      {/* 状态一：观看端全屏影院舞台 */}
      {remoteState !== 'idle' && (
        <div
          ref={viewerStageRef}
          onMouseMove={bumpHud}
          className={cn(
            'relative flex flex-col overflow-hidden bg-black text-white shadow-2xl',
            isFullscreen ? 'fixed inset-0 z-50 h-dvh w-screen' : 'min-h-[460px] rounded-3xl border border-white/10 sm:min-h-[560px]',
          )}
        >
          {/* 顶部悬浮信息与实时 WebRTC 链路指标 */}
          <div
            className={cn(
              'absolute inset-x-0 top-0 z-20 flex flex-wrap items-center justify-between gap-2 bg-gradient-to-b from-black/80 via-black/40 to-transparent px-4 py-3 text-xs transition-opacity duration-300',
              hudVisible ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/90 px-2.5 py-0.5 text-[11px] font-bold">
                <span className="size-1.5 animate-pulse rounded-full bg-white" />
                LIVE 无线投屏
              </span>
              <span className="font-semibold">
                {remoteHost?.castTitle || `${remoteHost?.name ?? '远端设备'} 的屏幕`}
              </span>
              <span className="text-white/60">来自 {remoteHost?.name}</span>
            </div>

            {metrics && metrics.width > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-full border border-white/15 bg-black/50 px-3 py-1 font-mono text-[11px] text-cyan-200 backdrop-blur-md">
                <span>
                  {metrics.width}×{metrics.height}
                </span>
                <span>·</span>
                <span>{metrics.fps} fps</span>
                {metrics.bitrateKbps > 0 && (
                  <>
                    <span>·</span>
                    <span>
                      {metrics.bitrateKbps >= 1000
                        ? `${(metrics.bitrateKbps / 1000).toFixed(1)} Mbps`
                        : `${metrics.bitrateKbps} kbps`}
                    </span>
                  </>
                )}
                {metrics.rttMs !== null && (
                  <>
                    <span>·</span>
                    <span className="text-emerald-300">{metrics.rttMs} ms</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 投屏画面本体 */}
          <div className="relative flex flex-1 items-center justify-center">
            {remoteState === 'connecting' && (
              <div className="flex flex-col items-center gap-3 text-center">
                <Loader2 className="size-10 animate-spin text-cyan-400" />
                <div className="text-sm font-medium">正在与「{remoteHost?.name}」建立超低延迟局域网视频链路…</div>
              </div>
            )}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className={cn(
                'h-full w-full',
                remoteState !== 'playing' && 'hidden',
                fitMode === 'contain' ? 'object-contain' : 'object-cover',
              )}
            />

            {autoplayMutedHint && muted && remoteState === 'playing' && (
              <button
                type="button"
                onClick={() => {
                  setMuted(false)
                  setAutoplayMutedHint(false)
                }}
                className="absolute bottom-20 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-cyan-300/40 bg-slate-950/85 px-4 py-2 text-xs font-semibold text-cyan-200 shadow-xl backdrop-blur-md transition hover:bg-slate-900"
              >
                <VolumeX className="size-4 text-amber-400" />
                浏览器已自动静音起播，点击此处开启声音
              </button>
            )}
          </div>

          {/* 底部悬浮播放控制栏 */}
          <div
            onMouseEnter={() => {
              setHudVisible(true)
              if (hudTimerRef.current !== null) window.clearTimeout(hudTimerRef.current)
            }}
            onMouseLeave={bumpHud}
            className={cn(
              'absolute bottom-4 left-1/2 z-20 flex max-w-[94vw] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-white/15 bg-slate-950/85 px-3 py-2 text-xs text-white shadow-2xl backdrop-blur-xl transition-all duration-300',
              hudVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0',
            )}
          >
            <button
              type="button"
              onClick={() => {
                setMuted((m) => !m)
                setAutoplayMutedHint(false)
              }}
              className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-white/10"
              title={muted ? '开启声音' : '静音'}
            >
              {muted ? <VolumeX className="size-4 text-amber-400" /> : <Volume2 className="size-4" />}
              <span className="hidden sm:inline">{muted ? '已静音' : '声音'}</span>
            </button>

            <button
              type="button"
              onClick={() => setFitMode((f) => (f === 'contain' ? 'cover' : 'contain'))}
              className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-white/10"
            >
              <Monitor className="size-4" />
              <span className="hidden sm:inline">{fitMode === 'contain' ? '适应画面' : '铺满屏幕'}</span>
            </button>

            <button
              type="button"
              onClick={() => void captureScreenshot()}
              className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-white/10"
              title="截取当前高清投屏画面"
            >
              <Camera className="size-4" />
              <span className="hidden sm:inline">截屏</span>
            </button>

            <button
              type="button"
              onClick={() => void togglePiP()}
              className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-white/10"
              title="画中画悬浮窗"
            >
              <PictureInPicture2 className="size-4" />
              <span className="hidden sm:inline">画中画</span>
            </button>

            <button
              type="button"
              onClick={() => void toggleViewerFullscreen()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-1.5 font-semibold hover:bg-white/25"
            >
              {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              {isFullscreen ? '退出全屏' : '全屏观看'}
            </button>

            <button
              type="button"
              onClick={() => clientRef.current?.stopWatching()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-500/85 px-3 py-1.5 font-semibold hover:bg-rose-500"
            >
              <MonitorOff className="size-4" />
              退出
            </button>
          </div>
        </div>
      )}

      {/* 状态二：本机正在对外推流投屏 */}
      {localStream && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-hidden rounded-3xl border border-cyan-500/30 bg-[#070b16] text-white shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500 px-2.5 py-0.5 text-[11px] font-bold">
                  <span className="size-1.5 animate-pulse rounded-full bg-white" />
                  正在无线投屏
                </span>
                <span className="font-semibold">{castTitle || `${self?.name} 的屏幕`}</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] text-cyan-200">
                  {viewerIds.length} 台设备观看中
                </span>
              </div>
              <Button variant="danger" size="sm" onClick={() => clientRef.current?.stopCasting()}>
                <Square className="size-3.5 fill-current" />
                停止投屏
              </Button>
            </div>
            <div className="relative flex aspect-video items-center justify-center bg-black">
              <video ref={localVideoRef} muted autoPlay playsInline className="h-full w-full object-contain" />
            </div>
          </div>

          {/* 右侧：观看者管理与定向推送邀请 */}
          <div className="glass flex flex-col gap-3 rounded-3xl p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <Users className="text-primary size-4" />
                附近设备（{peers.length}）
              </span>
              <span className="text-muted-foreground text-[11px]">支持一投多</span>
            </div>

            {peers.length === 0 ? (
              <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center text-xs">
                在另一台电脑、iPad 或电视浏览器打开本页面，即可一键观看此屏幕。
              </div>
            ) : (
              <div className="space-y-2">
                {peers.map((peer) => {
                  const watching = viewerSet.has(peer.id)
                  return (
                    <div
                      key={peer.id}
                      className="bg-background/70 flex items-center justify-between gap-2 rounded-2xl border p-3"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className="flex size-9 shrink-0 items-center justify-center rounded-xl text-white"
                          style={{ backgroundColor: peer.color }}
                        >
                          <DeviceIcon type={peer.deviceType} className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold">{peer.name}</div>
                          <div className="text-muted-foreground truncate text-[11px]">
                            {watching ? (
                              <span className="font-medium text-emerald-500">● 正在实时观看</span>
                            ) : (
                              `${peer.osLabel} · ${peer.browserLabel}`
                            )}
                          </div>
                        </div>
                      </div>
                      {watching ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-destructive h-7 px-2 text-xs"
                          onClick={() => clientRef.current?.kickViewer(peer.id)}
                        >
                          断开
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2.5 text-xs"
                          onClick={() => clientRef.current?.invitePeer(peer.id)}
                        >
                          <Send className="size-3" />
                          邀请观看
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 状态三：待机双栏主工作台（发起投屏 + 发现附近投屏信号） */}
      {!localStream && remoteState === 'idle' && connectionState !== 'offline' && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* 左卡：发起无线投屏（推流端） */}
          <div className="relative overflow-hidden rounded-3xl border border-indigo-500/20 bg-[#080d1a] p-5 text-white shadow-xl sm:p-6">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'radial-gradient(circle at 85% 15%, rgba(6, 182, 212, 0.24), transparent 55%), radial-gradient(circle at 15% 90%, rgba(139, 92, 246, 0.22), transparent 55%)',
              }}
            />

            <div className="relative z-10 space-y-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-indigo-600 shadow-lg">
                    <Cast className="size-5 text-white" />
                  </span>
                  <div>
                    <h2 className="text-base font-bold">发起无线投屏</h2>
                    <p className="text-xs text-white/65">共享整个桌面、单个窗口或浏览器标签页</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] text-emerald-300">
                  <ShieldCheck className="size-3" />
                  P2P 直连
                </span>
              </div>

              {/* 清晰度与帧率预设 */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-white/75">画质与帧率</div>
                <div className="grid grid-cols-2 gap-2">
                  {QUALITY_PRESETS.map((p) => {
                    const active = quality === p.id
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setQuality(p.id)}
                        className={cn(
                          'rounded-xl border p-2.5 text-left transition',
                          active
                            ? 'border-cyan-400/70 bg-cyan-500/20 text-white'
                            : 'border-white/10 bg-white/[0.04] text-white/75 hover:border-white/25 hover:text-white',
                        )}
                      >
                        <div className="text-xs font-semibold">{p.label}</div>
                        <div className="mt-0.5 text-[10px] text-white/60">{p.desc}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* 可选投屏名称与声音开关 */}
              <div className="space-y-3">
                <input
                  type="text"
                  maxLength={36}
                  value={castTitle}
                  onChange={(e) => setCastTitle(e.target.value)}
                  placeholder="可选：填写投屏标题（如：项目评审 PPT、代码演示）"
                  className="w-full rounded-xl border border-white/15 bg-white/[0.06] px-3.5 py-2 text-xs text-white placeholder:text-white/40 focus:border-cyan-400/70 focus:outline-none"
                />

                <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5">
                  <div>
                    <div className="text-xs font-medium">同时共享系统 / 标签页声音</div>
                    <div className="text-[11px] text-white/55">在弹窗勾选「分享音频」即可同步声音</div>
                  </div>
                  <Switch checked={includeAudio} onChange={setIncludeAudio} label="共享音频" />
                </div>
              </div>

              {canCaptureScreen ? (
                <button
                  type="button"
                  disabled={connectionState !== 'online'}
                  onClick={() =>
                    void clientRef.current?.startCasting({
                      quality,
                      includeAudio,
                      title: castTitle,
                    })
                  }
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 via-blue-500 to-violet-600 py-3.5 text-sm font-bold text-white shadow-[0_12px_30px_-8px_rgba(6,182,212,0.65)] transition hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Cast className="size-4" />
                  选择屏幕 / 窗口并开始投屏
                </button>
              ) : (
                <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
                  当前设备或 HTTP 非安全域环境不支持发起屏幕采集（发起投屏需在电脑端通过{' '}
                  <code className="rounded bg-white/10 px-1">localhost</code> 或{' '}
                  <code className="rounded bg-white/10 px-1">HTTPS</code> 访问）。
                  <strong className="text-white"> 但本设备可正常作为观看端，点击右侧正在投屏的设备直接观看！</strong>
                </div>
              )}
            </div>
          </div>

          {/* 右卡：附近投屏信号 & 在线设备 */}
          <div className="glass flex flex-col justify-between rounded-3xl p-5 sm:p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Radio className="text-primary size-4" />
                  <h2 className="text-base font-bold">发现附近投屏与设备</h2>
                </div>
                <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 font-mono text-[11px]">
                  {castingPeers.length} 路直播 · {peers.length} 台在线
                </span>
              </div>

              {/* 正在投屏中的设备（最高优先级高亮卡片） */}
              {castingPeers.length > 0 && (
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold text-rose-500">正在投屏中 · 点击即可全屏观看</div>
                  {castingPeers.map((peer) => (
                    <motion.div
                      key={peer.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-500/35 bg-gradient-to-r from-cyan-500/10 via-indigo-500/10 to-violet-500/10 p-3.5 shadow-sm"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="relative flex size-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-md"
                          style={{ backgroundColor: peer.color }}
                        >
                          <DeviceIcon type={peer.deviceType} className="size-5" />
                          <span className="absolute -top-1 -right-1 flex size-3.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                            <span className="relative inline-flex size-3.5 rounded-full border-2 border-white bg-rose-500" />
                          </span>
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold">
                            {peer.castTitle || `${peer.name} 的屏幕`}
                          </div>
                          <div className="text-muted-foreground truncate text-xs">
                            {peer.name} · {peer.osLabel} · {peer.browserLabel}
                          </div>
                        </div>
                      </div>
                      <Button variant="primary" size="sm" onClick={() => clientRef.current?.watchPeer(peer.id)}>
                        <Eye className="size-4" />
                        立即观看
                      </Button>
                    </motion.div>
                  ))}
                </div>
              )}

              {/* 其他待机在线设备 */}
              {idlePeers.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-muted-foreground text-xs font-medium">同局域网在线设备（可接收本机投屏）</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {idlePeers.map((peer) => (
                      <div
                        key={peer.id}
                        className="bg-background/60 flex items-center gap-2.5 rounded-2xl border p-2.5"
                      >
                        <span
                          className="flex size-9 shrink-0 items-center justify-center rounded-xl text-white"
                          style={{ backgroundColor: peer.color }}
                        >
                          <DeviceIcon type={peer.deviceType} className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-semibold">{peer.name}</div>
                          <div className="text-muted-foreground truncate text-[11px]">
                            {peer.osLabel} · {peer.browserLabel}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : castingPeers.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-12 text-center">
                  <motion.div
                    animate={{ scale: [1, 1.12, 1], opacity: [0.6, 1, 0.6] }}
                    transition={{ repeat: Infinity, duration: 2.6 }}
                    className="bg-primary/10 text-primary mb-3 flex size-14 items-center justify-center rounded-full"
                  >
                    <Radio className="size-7" />
                  </motion.div>
                  <div className="text-sm font-semibold">正在搜寻同局域网的投屏信号…</div>
                  <p className="text-muted-foreground mt-1.5 max-w-xs text-xs leading-relaxed">
                    在电脑、iPad 或电视浏览器打开本页即可自动发现；若处于不同网段，点击右上角「6 位配对码」快速直连。
                  </p>
                </div>
              ) : null}
            </div>

            <div className="text-muted-foreground mt-4 border-t pt-3 text-[11px]">
              提示：投屏视频流在局域网内通过 WebRTC 点对点加密直传，不经过服务器录制或存储，支持一投多设备同步观看。
            </div>
          </div>
        </div>
      )}

      {/* 收到定向投屏邀请悬浮卡 */}
      <AnimatePresence>
        {invite && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.94 }}
            className="fixed right-4 bottom-5 left-4 z-50 mx-auto max-w-md sm:left-auto"
          >
            <div className="bg-card-solid rounded-3xl border border-cyan-400/40 p-5 shadow-[0_24px_64px_-12px_rgba(6,182,212,0.45)]">
              <div className="flex items-center gap-3">
                <span
                  className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-md"
                  style={{ backgroundColor: invite.fromColor }}
                >
                  <Cast className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{invite.fromName} 邀请你观看无线投屏</div>
                  <div className="text-muted-foreground mt-0.5 truncate text-xs">{invite.castTitle}</div>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setInvite(null)}>
                  忽略
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={() => {
                    const targetId = invite.fromId
                    setInvite(null)
                    clientRef.current?.watchPeer(targetId)
                  }}
                >
                  <Eye className="size-4" />
                  立即观看
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 6 位配对码跨网连接弹窗 */}
      <AnimatePresence>
        {pairModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPairModalOpen(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-card-solid w-full max-w-md space-y-4 rounded-2xl border p-5 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <KeyRound className="text-primary size-4" />
                  6 位投屏配对码（跨网 / 防隔离）
                </div>
                <button type="button" onClick={() => setPairModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="size-4" />
                </button>
              </div>

              <p className="text-muted-foreground text-xs leading-relaxed">
                若投屏端与电视/平板不在同一网段或开启了路由器隔离，双方输入相同的 6 位数字即可秒建专属投屏频道。
              </p>

              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={pairInput}
                  onChange={(e) => setPairInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="输入 6 位数字配对码"
                  className="bg-background focus:border-primary flex-1 rounded-xl border px-3.5 py-2.5 text-center font-mono text-lg font-bold tracking-[0.3em] outline-none"
                />
                <Button variant="outline" onClick={() => setPairInput(randomSixDigitCode())}>
                  随机生成
                </Button>
              </div>

              <div className="flex flex-wrap justify-between gap-2 pt-1">
                {pairCode ? (
                  <Button variant="ghost" size="sm" onClick={() => handleJoinPairCode(null)}>
                    切回自动局域网
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setPairModalOpen(false)}>
                    取消
                  </Button>
                  <Button
                    variant="primary"
                    disabled={pairInput.length !== 6}
                    onClick={() => handleJoinPairCode(pairInput)}
                  >
                    进入投屏房
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
