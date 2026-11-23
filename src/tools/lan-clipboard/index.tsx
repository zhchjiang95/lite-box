import { AnimatePresence, motion } from 'motion/react'
import {
  Check,
  ClipboardPaste,
  Code2,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Flame,
  Image as ImageIcon,
  ImagePlus,
  KeyRound,
  Laptop,
  Link2,
  Loader2,
  Pin,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Tablet,
  Trash2,
  Type,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { downloadBlob, timestampName } from '@/lib/file'
import { IMAGE_ACCEPT, isImageLike } from '@/lib/image'
import { cn, uid } from '@/lib/utils'
import { detectLocalDevice, playIncomingSound, playPeerArriveSound } from '../lan-transfer/types'
import {
  compressClipboardImage,
  copyDataUrlImageToClipboard,
  detectTextClipKind,
  formatClipTime,
  type ClipItem,
  type ClipKind,
  type ConnectionState,
  type DeviceType,
  type PeerInfo,
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

const FILTER_TABS: { id: 'all' | ClipKind; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'text', label: '文本' },
  { id: 'link', label: '链接' },
  { id: 'code', label: '代码' },
  { id: 'image', label: '截图' },
]

export default function LanClipboard() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting')
  const [self, setSelf] = useState<PeerInfo | null>(null)
  const [peers, setPeers] = useState<PeerInfo[]>([])
  const [roomLabel, setRoomLabel] = useState('同局域网自动发现')
  const [pairCode, setPairCode] = useState<string | null>(null)
  const [clips, setClips] = useState<ClipItem[]>([])

  const [draft, setDraft] = useState('')
  const [forceCode, setForceCode] = useState(false)
  const [sendingImage, setSendingImage] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const [filterKind, setFilterKind] = useState<'all' | ClipKind>('all')
  const [query, setQuery] = useState('')
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [lightboxImg, setLightboxImg] = useState<ClipItem | null>(null)

  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [pairModalOpen, setPairModalOpen] = useState(false)
  const [pairInput, setPairInput] = useState('')

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const reconnectAttemptRef = useRef(0)
  const disposedRef = useRef(false)
  const desiredPairRef = useRef<string | null>(null)
  const customNameRef = useRef('')
  const selfIdRef = useRef<string | null>(null)
  const soundRef = useRef(soundEnabled)
  soundRef.current = soundEnabled

  const fileInputRef = useRef<HTMLInputElement>(null)

  const sendWs = useCallback((obj: Record<string, unknown>) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj))
      return true
    }
    return false
  }, [])

  const connectWs = useCallback(() => {
    if (disposedRef.current) return
    if (wsRef.current) {
      try {
        wsRef.current.onopen = null
        wsRef.current.onmessage = null
        wsRef.current.onclose = null
        wsRef.current.onerror = null
        wsRef.current.close()
      } catch {
        // 忽略
      }
      wsRef.current = null
    }

    setConnectionState('connecting')
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const params = new URLSearchParams({ channel: 'clipboard' })
    if (desiredPairRef.current) params.set('room', desiredPairRef.current)
    const url = `${proto}//${window.location.host}/ws/lan?${params.toString()}`

    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      setConnectionState('offline')
      return
    }
    wsRef.current = ws

    ws.onopen = () => {
      reconnectAttemptRef.current = 0
      setConnectionState('online')
      const dev = detectLocalDevice()
      ws.send(
        JSON.stringify({
          type: 'hello',
          ...dev,
          customName: customNameRef.current || undefined,
        }),
      )
    }

    ws.onmessage = (evt) => {
      if (typeof evt.data !== 'string') return
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(evt.data) as Record<string, unknown>
      } catch {
        return
      }

      switch (msg.type) {
        case 'welcome': {
          const me = msg.self as PeerInfo
          selfIdRef.current = me.id
          setSelf(me)
          setPeers((msg.peers as PeerInfo[]) ?? [])
          setRoomLabel(String(msg.roomLabel ?? '同局域网自动发现'))
          setPairCode((msg.pairCode as string | null) ?? null)
          setClips((msg.clips as ClipItem[]) ?? [])
          break
        }
        case 'self-updated': {
          const me = msg.self as PeerInfo
          selfIdRef.current = me.id
          setSelf(me)
          break
        }
        case 'peer-joined': {
          const peer = msg.peer as PeerInfo
          setPeers((prev) => (prev.some((p) => p.id === peer.id) ? prev : [...prev, peer]))
          if (soundRef.current) playPeerArriveSound()
          break
        }
        case 'peer-left': {
          const pid = String(msg.peerId)
          setPeers((prev) => prev.filter((p) => p.id !== pid))
          break
        }
        case 'peer-updated': {
          const peer = msg.peer as PeerInfo
          setPeers((prev) => prev.map((p) => (p.id === peer.id ? peer : p)))
          break
        }
        case 'clip-added': {
          const item = msg.item as ClipItem
          setClips((prev) => [item, ...prev.filter((c) => c.id !== item.id)].slice(0, 30))
          if (item.fromId !== selfIdRef.current && soundRef.current) {
            playIncomingSound()
          }
          break
        }
        case 'clip-deleted': {
          const id = String(msg.id)
          setClips((prev) => prev.filter((c) => c.id !== id))
          break
        }
        case 'clip-updated': {
          const item = msg.item as ClipItem
          setClips((prev) => prev.map((c) => (c.id === item.id ? item : c)))
          break
        }
        case 'clip-cleared': {
          setClips([])
          toast.info(`${String(msg.byName ?? '某设备')} 已清空本房间全部剪贴板`)
          break
        }
      }
    }

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null
      if (!disposedRef.current) {
        setConnectionState('offline')
        if (reconnectTimerRef.current === null) {
          const delay = Math.min(8000, 1500 * Math.pow(1.4, reconnectAttemptRef.current))
          reconnectAttemptRef.current += 1
          reconnectTimerRef.current = window.setTimeout(() => {
            reconnectTimerRef.current = null
            connectWs()
          }, delay)
        }
      }
    }

    ws.onerror = () => {
      // onclose 会处理重连
    }
  }, [])

  useEffect(() => {
    disposedRef.current = false
    try {
      customNameRef.current = localStorage.getItem(NAME_STORAGE_KEY) || ''
    } catch {
      customNameRef.current = ''
    }
    const urlRoom = new URLSearchParams(window.location.search).get('room')
    const initialPair = urlRoom ? urlRoom.replace(/\D/g, '').slice(0, 6) : ''
    desiredPairRef.current = initialPair.length === 6 ? initialPair : null

    connectWs()

    return () => {
      disposedRef.current = true
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      try {
        wsRef.current?.close()
      } catch {
        // 忽略
      }
      wsRef.current = null
    }
  }, [connectWs])

  /** 发送文本 / 链接 / 代码片段 */
  const sendTextClip = useCallback(
    (rawText: string, asCode = false) => {
      const cleaned = rawText.trim()
      if (!cleaned) return
      const kind: Exclude<ClipKind, 'image'> = asCode ? 'code' : detectTextClipKind(cleaned)
      const ok = sendWs({
        type: 'clip-add',
        item: {
          id: uid(),
          kind,
          text: rawText,
        },
      })
      if (!ok) {
        toast.error('剪贴板信令未连接，请稍后重试')
        return
      }
      setDraft('')
      toast.success('已实时同步到同局域网所有设备')
    },
    [sendWs],
  )

  /** 压缩并同步截图图片 */
  const sendImageClip = useCallback(
    async (file: File) => {
      if (!isImageLike(file)) {
        toast.error('请选择有效的图片文件')
        return
      }
      setSendingImage(true)
      try {
        const { dataUrl, width, height } = await compressClipboardImage(file)
        const ok = sendWs({
          type: 'clip-add',
          item: {
            id: uid(),
            kind: 'image',
            text: file.name && file.name !== 'image.png' ? file.name : '剪贴板截图',
            imageDataUrl: dataUrl,
            imageWidth: width,
            imageHeight: height,
          },
        })
        if (!ok) {
          toast.error('剪贴板信令未连接')
        } else {
          toast.success(`已同步截图（${width}×${height}）`)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '图片处理失败')
      } finally {
        setSendingImage(false)
      }
    },
    [sendWs],
  )

  /** 全局 Ctrl+V / Cmd+V 直接粘贴截图同步（在输入框外也可秒传截图） */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter(isImageLike)
      if (!files.length) return
      e.preventDefault()
      void sendImageClip(files[0])
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [sendImageClip])

  /** 一键读取系统剪贴板（优先支持截图，其次文本）并立即广播 */
  const readSystemClipboardAndSync = async () => {
    if (!navigator.clipboard) {
      toast.error('当前环境不支持自动读取系统剪贴板，请在上方输入框直接粘贴')
      return
    }
    try {
      if (typeof navigator.clipboard.read === 'function') {
        const items = await navigator.clipboard.read()
        for (const clip of items) {
          const imgType = clip.types.find((t) => t.startsWith('image/'))
          if (imgType) {
            const blob = await clip.getType(imgType)
            const file = new File([blob], '剪贴板截图.png', { type: imgType })
            await sendImageClip(file)
            return
          }
          if (clip.types.includes('text/plain')) {
            const blob = await clip.getType('text/plain')
            const text = await blob.text()
            if (text.trim()) {
              sendTextClip(text, forceCode)
              return
            }
          }
        }
      }
      if (typeof navigator.clipboard.readText === 'function') {
        const text = await navigator.clipboard.readText()
        if (text.trim()) {
          sendTextClip(text, forceCode)
          return
        }
      }
      toast.info('系统剪贴板为空')
    } catch {
      toast.error('浏览器拒绝读取剪贴板（需 HTTPS/localhost 或授权），可直接在输入框按 Ctrl+V 粘贴')
    }
  }

  const copyClipText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      toast.success('已复制到本机剪贴板')
      setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500)
    } catch {
      toast.error('复制失败，请手动选中复制')
    }
  }

  const copyClipImage = async (clip: ClipItem) => {
    if (!clip.imageDataUrl) return
    try {
      await copyDataUrlImageToClipboard(clip.imageDataUrl)
      setCopiedKey(`img-${clip.id}`)
      toast.success('已将截图复制到本机剪贴板')
      setTimeout(() => setCopiedKey((cur) => (cur === `img-${clip.id}` ? null : cur)), 1500)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制图片失败')
    }
  }

  const downloadClipImage = async (clip: ClipItem) => {
    if (!clip.imageDataUrl) return
    const res = await fetch(clip.imageDataUrl)
    const blob = await res.blob()
    const ext = blob.type.includes('webp') ? 'webp' : blob.type.includes('jpeg') ? 'jpg' : 'png'
    downloadBlob(blob, timestampName('共享截图', ext))
  }

  const handleRenameSubmit = () => {
    setEditingName(false)
    const clean = nameDraft.trim()
    if (!clean || clean === self?.name) return
    customNameRef.current = clean
    try {
      localStorage.setItem(NAME_STORAGE_KEY, clean)
    } catch {
      // 忽略
    }
    sendWs({ type: 'rename', name: clean })
    toast.success(`本机代号已更新为「${clean}」`)
  }

  const handleJoinPairCode = (code: string | null) => {
    const clean = code ? code.replace(/\D/g, '').slice(0, 6) : null
    if (clean && clean.length !== 6) {
      toast.error('请输入完整的 6 位数字配对码')
      return
    }
    desiredPairRef.current = clean
    sendWs({ type: 'join-room', room: clean })
    setPairModalOpen(false)
    setPairInput('')
    toast.success(clean ? `已进入配对剪贴板 #${clean}` : '已切回同局域网自动发现')
  }

  const copyPairUrl = async () => {
    if (!pairCode) return
    const u = new URL(window.location.href)
    u.searchParams.set('room', pairCode)
    await copyClipText(u.toString(), 'pair-url')
  }

  /** 过滤、搜索与置顶排序 */
  const visibleClips = useMemo(() => {
    const kw = query.trim().toLowerCase()
    return clips
      .filter((c) => {
        if (filterKind !== 'all' && c.kind !== filterKind) return false
        if (!kw) return true
        return c.text.toLowerCase().includes(kw) || c.fromName.toLowerCase().includes(kw)
      })
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.timestamp - a.timestamp)
  }, [clips, filterKind, query])

  const totalOnline = (self ? 1 : 0) + peers.length

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void sendImageClip(f)
        }}
      />

      {/* 顶部连接状态、在线设备条与焚毁清空 */}
      <div className="glass space-y-3 rounded-2xl p-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
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
                ? `实时同步中 · ${totalOnline} 台设备在线`
                : connectionState === 'connecting'
                  ? '正在连接剪贴板频道…'
                  : '未连接信令服务'}
            </span>

            <span className="text-muted-foreground hidden items-center gap-1 sm:inline-flex">
              <ShieldCheck className="size-3.5 text-emerald-500" />
              纯内存暂存 · 全部离开自动销毁
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {pairCode && (
              <button
                type="button"
                onClick={() => void copyPairUrl()}
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

            <button
              type="button"
              onClick={() => setSoundEnabled((v) => !v)}
              title={soundEnabled ? '关闭提示音' : '开启提示音'}
              className="border-foreground/10 hover:bg-foreground/5 inline-flex size-7 items-center justify-center rounded-lg border transition"
            >
              {soundEnabled ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5 opacity-55" />}
            </button>

            {clips.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-rose-500 hover:bg-rose-500/10 hover:text-rose-500"
                onClick={() => sendWs({ type: 'clip-clear' })}
                title="一键清空本房间所有设备上的剪贴板记录"
              >
                <Flame className="size-3.5" />
                一键焚毁清空
              </Button>
            )}
          </div>
        </div>

        {/* 在线设备一览 */}
        {connectionState === 'online' && (
          <div className="flex flex-wrap items-center gap-1.5 border-t pt-2.5">
            <span className="text-muted-foreground mr-1 text-[11px]">同步圈设备：</span>
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
                  <Check className="size-3" />
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setNameDraft(self?.name ?? '')
                  setEditingName(true)
                }}
                className="border-primary/35 bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition hover:bg-primary/15"
                title="点击修改本机代号"
              >
                <DeviceIcon type={self?.deviceType ?? 'desktop'} className="size-3" />
                {self?.name ?? '本机'}（我）
                <Edit3 className="size-2.5 opacity-70" />
              </button>
            )}

            {peers.map((peer) => (
              <span
                key={peer.id}
                className="bg-background/80 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
              >
                <span className="size-2 rounded-full" style={{ backgroundColor: peer.color }} />
                <DeviceIcon type={peer.deviceType} className="text-muted-foreground size-3" />
                <span>{peer.name}</span>
              </span>
            ))}

            {peers.length === 0 && (
              <span className="text-muted-foreground text-[11px]">
                （在另一台手机或电脑打开本页即自动加入实时同步）
              </span>
            )}
          </div>
        )}
      </div>

      {/* 未连接信令引导 */}
      {connectionState === 'offline' && (
        <div className="glass flex flex-col items-center justify-center rounded-3xl p-8 text-center">
          <div className="mb-3 flex size-14 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-500">
            <WifiOff className="size-7" />
          </div>
          <div className="text-base font-semibold">尚未检测到局域网信令服务</div>
          <p className="text-muted-foreground mt-1.5 max-w-md text-xs leading-relaxed">
            请先启动独立后端服务 <code className="bg-muted rounded px-1.5 py-0.5 font-mono">cd server && node index.mjs</code>，多台设备打开本页即可毫秒级共享文字、链接、代码与截图。
          </p>
          <Button variant="primary" size="sm" className="mt-4" onClick={connectWs}>
            重新连接
          </Button>
        </div>
      )}

      {/* 极速发送与粘贴区 */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const img = Array.from(e.dataTransfer.files).find(isImageLike)
          if (img) void sendImageClip(img)
        }}
        className={cn(
          'glass overflow-hidden rounded-3xl transition-all',
          dragOver && 'border-primary bg-primary/5 ring-primary/30 ring-2',
        )}
      >
        <div className="p-4">
          <textarea
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                sendTextClip(draft, forceCode)
              }
            }}
            placeholder="在此输入或粘贴文字、网址、验证码、代码片段；直接按 Ctrl+V 或拖入图片可秒发截图到所有设备…"
            className="w-full resize-y bg-transparent text-sm leading-relaxed outline-none"
          />
        </div>

        <div className="bg-foreground/[0.025] flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs"
              disabled={connectionState !== 'online' || sendingImage}
              onClick={() => void readSystemClipboardAndSync()}
            >
              <ClipboardPaste className="size-3.5" />
              读取系统剪贴板并同步
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs"
              disabled={connectionState !== 'online' || sendingImage}
              onClick={() => fileInputRef.current?.click()}
            >
              {sendingImage ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
              发截图
            </Button>

            <button
              type="button"
              onClick={() => setForceCode((v) => !v)}
              className={cn(
                'inline-flex h-8 items-center gap-1 rounded-xl border px-2.5 text-xs font-medium transition',
                forceCode
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-foreground/10 text-muted-foreground hover:text-foreground',
              )}
              title="勾选后将以等宽代码块展示（不勾选也会自动识别常见代码）"
            >
              <Code2 className="size-3.5" />
              代码格式
            </button>
          </div>

          <Button
            variant="primary"
            size="sm"
            className="h-8 px-4 text-xs"
            disabled={connectionState !== 'online' || !draft.trim()}
            onClick={() => sendTextClip(draft, forceCode)}
          >
            <Send className="size-3.5" />
            立即同步（Ctrl+Enter）
          </Button>
        </div>
      </div>

      {/* 筛选与搜索条 */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTER_TABS.map((t) => {
            const active = filterKind === t.id
            const count = t.id === 'all' ? clips.length : clips.filter((c) => c.kind === t.id).length
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilterKind(t.id)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition',
                  active
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : 'glass text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
                {count > 0 && <span className="ml-1 font-mono text-[10px] opacity-80">{count}</span>}
              </button>
            )
          })}
        </div>

        {clips.length > 0 && (
          <div className="glass flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs">
            <Search className="text-muted-foreground size-3.5" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="筛选剪贴板内容…"
              className="w-36 bg-transparent outline-none sm:w-48"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="text-muted-foreground hover:text-foreground">
                <X className="size-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* 实时同步剪贴板卡片流 */}
      {visibleClips.length === 0 ? (
        <div className="glass flex flex-col items-center justify-center rounded-3xl py-14 text-center">
          <div className="bg-primary/10 text-primary mb-3 flex size-12 items-center justify-center rounded-2xl">
            <ClipboardPaste className="size-6" />
          </div>
          <div className="text-sm font-semibold">
            {clips.length === 0 ? '共享剪贴板还是空的' : '没有匹配当前筛选条件的记录'}
          </div>
          <p className="text-muted-foreground mt-1 max-w-sm text-xs">
            {clips.length === 0
              ? '点击「读取系统剪贴板并同步」、在上方输入文字，或直接按 Ctrl+V 粘贴截图，所有同局域网设备都会瞬间同步。'
              : '切换上方分类标签或清空搜索关键词试试。'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {visibleClips.map((clip) => {
              const isMine = clip.fromId === self?.id
              const KindIcon =
                clip.kind === 'link'
                  ? Link2
                  : clip.kind === 'code'
                    ? Code2
                    : clip.kind === 'image'
                      ? ImageIcon
                      : Type

              return (
                <motion.div
                  key={clip.id}
                  layout
                  initial={{ opacity: 0, y: -12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                  className={cn(
                    'glass overflow-hidden rounded-2xl transition',
                    clip.pinned && 'border-amber-400/50 ring-1 ring-amber-400/25',
                  )}
                >
                  {/* 卡片头部：来源设备 + 时间 + 类型 + 快捷操作 */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="inline-flex size-5 items-center justify-center rounded-md text-white"
                        style={{ backgroundColor: clip.fromColor }}
                      >
                        <DeviceIcon type={clip.deviceType} className="size-3" />
                      </span>
                      <span className="font-semibold">
                        {clip.fromName}
                        {isMine ? '（我）' : ''}
                      </span>
                      <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]">
                        <KindIcon className="size-2.5" />
                        {clip.kind === 'link'
                          ? '链接'
                          : clip.kind === 'code'
                            ? '代码'
                            : clip.kind === 'image'
                              ? `截图 ${clip.imageWidth && clip.imageHeight ? `${clip.imageWidth}×${clip.imageHeight}` : ''}`
                              : '文本'}
                      </span>
                      {clip.pinned && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                          已置顶
                        </span>
                      )}
                      <span className="text-muted-foreground font-mono text-[11px]">{formatClipTime(clip.timestamp)}</span>
                    </div>

                    <div className="flex items-center gap-1">
                      {clip.kind === 'link' && (
                        <a
                          href={clip.text.trim()}
                          target="_blank"
                          rel="noreferrer"
                          className="border-foreground/10 hover:border-primary/50 hover:text-primary inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] font-medium transition"
                        >
                          <ExternalLink className="size-3" />
                          打开
                        </a>
                      )}

                      {clip.kind === 'image' ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => void copyClipImage(clip)}
                          >
                            {copiedKey === `img-${clip.id}` ? <Check className="size-3" /> : <Copy className="size-3" />}
                            复制图片
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => void downloadClipImage(clip)}
                          >
                            <Download className="size-3" />
                            保存
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="primary"
                          size="sm"
                          className="h-7 px-2.5 text-[11px]"
                          onClick={() => void copyClipText(clip.text, `c-${clip.id}`)}
                        >
                          {copiedKey === `c-${clip.id}` ? <Check className="size-3" /> : <Copy className="size-3" />}
                          {copiedKey === `c-${clip.id}` ? '已复制' : '一键复制'}
                        </Button>
                      )}

                      <button
                        type="button"
                        onClick={() => sendWs({ type: 'clip-pin', id: clip.id, pinned: !clip.pinned })}
                        title={clip.pinned ? '取消置顶' : '置顶'}
                        className={cn(
                          'inline-flex size-7 items-center justify-center rounded-lg transition',
                          clip.pinned
                            ? 'bg-amber-500/15 text-amber-500'
                            : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                        )}
                      >
                        <Pin className="size-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => sendWs({ type: 'clip-delete', id: clip.id })}
                        title="同步删除"
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive inline-flex size-7 items-center justify-center rounded-lg transition"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* 卡片正文内容 */}
                  <div className="p-4">
                    {clip.kind === 'image' && clip.imageDataUrl ? (
                      <button
                        type="button"
                        onClick={() => setLightboxImg(clip)}
                        className="group relative block max-w-full overflow-hidden rounded-xl border bg-black/5"
                        title="点击查看大图"
                      >
                        <img
                          src={clip.imageDataUrl}
                          alt={clip.text || '共享截图'}
                          className="max-h-72 w-auto rounded-xl object-contain transition group-hover:scale-[1.01]"
                        />
                      </button>
                    ) : clip.kind === 'code' ? (
                      <pre className="bg-slate-950/90 max-h-72 overflow-auto rounded-xl p-3.5 font-mono text-xs leading-relaxed text-slate-100">
                        {clip.text}
                      </pre>
                    ) : clip.kind === 'link' ? (
                      <a
                        href={clip.text.trim()}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary break-all text-sm font-medium underline-offset-4 hover:underline"
                      >
                        {clip.text.trim()}
                      </a>
                    ) : (
                      <div className="max-h-72 overflow-y-auto text-sm leading-relaxed break-words whitespace-pre-wrap">
                        {clip.text}
                      </div>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      {/* 截图放大预览灯箱 */}
      <AnimatePresence>
        {lightboxImg?.imageDataUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightboxImg(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          >
            <div onClick={(e) => e.stopPropagation()} className="relative max-h-[90dvh] max-w-[92vw]">
              <img
                src={lightboxImg.imageDataUrl}
                alt={lightboxImg.text}
                className="max-h-[85dvh] max-w-full rounded-2xl object-contain shadow-2xl"
              />
              <button
                type="button"
                onClick={() => setLightboxImg(null)}
                className="absolute -top-3 -right-3 flex size-9 items-center justify-center rounded-full bg-white text-slate-900 shadow-lg"
              >
                <X className="size-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 6 位配对码弹窗 */}
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
                  6 位剪贴板配对码（跨网 / 防隔离）
                </div>
                <button type="button" onClick={() => setPairModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="size-4" />
                </button>
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed">
                手机使用 5G 或不同子网时，双方输入相同的 6 位数字即可共享同一条实时剪贴板（所有设备退出后服务器立即销毁内存数据）。
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
                  <Button variant="primary" disabled={pairInput.length !== 6} onClick={() => handleJoinPairCode(pairInput)}>
                    进入房间
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
