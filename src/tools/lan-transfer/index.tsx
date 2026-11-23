import { AnimatePresence, motion } from 'motion/react'
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  File as FileIcon,
  KeyRound,
  Link2,
  MessageSquare,
  Send,
  ShieldCheck,
  Trash2,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/field'
import { cn, formatBytes } from '@/lib/utils'
import { LanTransferClient } from './engine'
import { RadarStage } from './RadarStage'
import {
  formatShortTime,
  formatSpeed,
  playCompleteSound,
  playIncomingSound,
  playPeerArriveSound,
  type ActiveTransfer,
  type ConnectionState,
  type IncomingOffer,
  type PeerInfo,
  type ReceivedFileItem,
  type TextMessageItem,
} from './types'

const NAME_STORAGE_KEY = 'litebox-lan-nickname'

function randomSixDigitCode(): string {
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return String(100000 + (arr[0] % 900000))
}

export default function LanTransfer() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting')
  const [self, setSelf] = useState<PeerInfo | null>(null)
  const [peers, setPeers] = useState<PeerInfo[]>([])
  const [roomLabel, setRoomLabel] = useState('同局域网自动发现')
  const [pairCode, setPairCode] = useState<string | null>(null)

  const [autoAccept, setAutoAccept] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [incomingOffers, setIncomingOffers] = useState<IncomingOffer[]>([])
  const [transfers, setTransfers] = useState<ActiveTransfer[]>([])
  const [receivedFiles, setReceivedFiles] = useState<ReceivedFileItem[]>([])
  const [textMessages, setTextMessages] = useState<TextMessageItem[]>([])

  // 弹窗状态：文字秒传 & 6 位配对码房间
  const [textTarget, setTextTarget] = useState<PeerInfo | null>(null)
  const [textDraft, setTextDraft] = useState('')
  const [pairModalOpen, setPairModalOpen] = useState(false)
  const [pairInput, setPairInput] = useState('')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const clientRef = useRef<LanTransferClient | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingPickPeerRef = useRef<PeerInfo | null>(null)
  const soundRef = useRef(soundEnabled)
  soundRef.current = soundEnabled

  const receivedFilesRef = useRef(receivedFiles)
  receivedFilesRef.current = receivedFiles

  // 初始化信令与双引擎传输客户端
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

    const client = new LanTransferClient(
      {
        onConnectionChange: (s) => setConnectionState(s),
        onWelcome: ({ self: me, peers: list, roomLabel: label, pairCode: code }) => {
          setSelf(me)
          setPeers(list)
          setRoomLabel(label)
          setPairCode(code)
        },
        onSelfUpdated: (me) => setSelf(me),
        onPeerJoined: (peer) => {
          setPeers((prev) => (prev.some((p) => p.id === peer.id) ? prev : [...prev, peer]))
          if (soundRef.current) playPeerArriveSound()
        },
        onPeerLeft: (peerId) => {
          setPeers((prev) => prev.filter((p) => p.id !== peerId))
          setIncomingOffers((prev) => prev.filter((o) => o.fromId !== peerId))
        },
        onPeerUpdated: (peer) => {
          setPeers((prev) => prev.map((p) => (p.id === peer.id ? peer : p)))
        },
        onIncomingOffer: (offer) => {
          setIncomingOffers((prev) => [...prev, offer])
          if (soundRef.current) playIncomingSound()
        },
        onTransferUpdate: (tx) => {
          setTransfers((prev) => {
            const exists = prev.some((t) => t.transferId === tx.transferId)
            if (exists) return prev.map((t) => (t.transferId === tx.transferId ? tx : t))
            return [tx, ...prev].slice(0, 20)
          })
          if (tx.status === 'done' && soundRef.current) {
            playCompleteSound()
          }
        },
        onFileReceived: (item) => {
          setReceivedFiles((prev) => [item, ...prev])
        },
        onTextReceived: (msg) => {
          setTextMessages((prev) => [msg, ...prev])
          if (soundRef.current) playIncomingSound()
          toast.success(`收到来自 ${msg.peerName} 的无线文本消息`)
        },
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
      receivedFilesRef.current.forEach((f) => URL.revokeObjectURL(f.url))
    }
  }, [])

  // 同步自动接收开关
  useEffect(() => {
    clientRef.current?.setAutoAccept(autoAccept)
  }, [autoAccept])

  const handleRenameSelf = useCallback((name: string) => {
    try {
      localStorage.setItem(NAME_STORAGE_KEY, name)
    } catch {
      // 忽略
    }
    clientRef.current?.rename(name)
    toast.success(`本机代号已更新为「${name}」`)
  }, [])

  const handlePickFilesForPeer = useCallback((peer: PeerInfo) => {
    pendingPickPeerRef.current = peer
    fileInputRef.current?.click()
  }, [])

  const handleDropFilesForPeer = useCallback((peer: PeerInfo, files: File[]) => {
    void clientRef.current?.sendFiles(peer.id, files)
  }, [])

  const handleRespondOffer = (offer: IncomingOffer, accept: boolean) => {
    setIncomingOffers((prev) => prev.filter((o) => o.transferId !== offer.transferId))
    clientRef.current?.respondOffer(offer.transferId, accept)
  }

  const handleSendText = () => {
    if (!textTarget || !textDraft.trim()) return
    const ok = clientRef.current?.sendText(textTarget.id, textDraft)
    if (ok) {
      setTextMessages((prev) => [
        {
          id: `${Date.now()}`,
          peerId: textTarget.id,
          peerName: textTarget.name,
          direction: 'out',
          text: textDraft.trim(),
          time: formatShortTime(),
        },
        ...prev,
      ])
      toast.success(`已发送给 ${textTarget.name}`)
      setTextDraft('')
      setTextTarget(null)
    } else {
      toast.error('发送失败，请确认在线状态')
    }
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

  const copyToClipboard = async (text: string, key: string, label = '已复制') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      toast.success(label)
      setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500)
    } catch {
      toast.error('复制失败，请手动复制')
    }
  }

  const copyPairShareUrl = () => {
    if (!pairCode) return
    const u = new URL(window.location.href)
    u.searchParams.set('room', pairCode)
    void copyToClipboard(u.toString(), 'pair-url', '已复制直达链接，在另一台设备打开即可自动配对')
  }

  const clearReceived = () => {
    receivedFiles.forEach((f) => URL.revokeObjectURL(f.url))
    setReceivedFiles([])
    setTextMessages([])
    setTransfers((prev) => prev.filter((t) => t.status === 'transferring' || t.status === 'connecting' || t.status === 'waiting-accept'))
  }

  const ongoingTransfers = transfers.filter(
    (t) => t.status === 'connecting' || t.status === 'waiting-accept' || t.status === 'transferring',
  )

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          const target = pendingPickPeerRef.current
          pendingPickPeerRef.current = null
          if (target && files.length) {
            void clientRef.current?.sendFiles(target.id, files)
          }
        }}
      />

      {/* 顶部功能控制栏 */}
      <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="size-4 shrink-0" />
            <span className="font-medium">局域网 P2P 加密直传 · 文件绝不落盘存储</span>
          </div>
          {pairCode && (
            <button
              type="button"
              onClick={copyPairShareUrl}
              className="bg-primary/10 text-primary hover:bg-primary/20 inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-medium transition"
            >
              <Link2 className="size-3.5" />
              复制房间 #{pairCode} 直连链接
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
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
            {pairCode ? `配对码 #${pairCode}` : '6 位配对码'}
          </Button>

          <label className="flex items-center gap-1.5 font-medium">
            <span className="text-muted-foreground">自动接收</span>
            <Switch checked={autoAccept} onChange={setAutoAccept} label="自动接收文件" />
          </label>

          <button
            type="button"
            onClick={() => setSoundEnabled((v) => !v)}
            title={soundEnabled ? '关闭提示音' : '开启提示音'}
            className="border-foreground/10 hover:bg-foreground/5 inline-flex size-7 items-center justify-center rounded-lg border transition"
          >
            {soundEnabled ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5 opacity-55" />}
          </button>
        </div>
      </div>

      {/* 无线雷达核心交互舞台 */}
      <RadarStage
        connectionState={connectionState}
        self={self}
        peers={peers}
        roomLabel={roomLabel}
        pairCode={pairCode}
        transfers={transfers}
        onPickFilesForPeer={handlePickFilesForPeer}
        onDropFilesForPeer={handleDropFilesForPeer}
        onOpenTextModal={(peer) => {
          setTextTarget(peer)
          setTextDraft('')
        }}
        onRenameSelf={handleRenameSelf}
        onOpenPairModal={() => {
          setPairInput(pairCode ?? '')
          setPairModalOpen(true)
        }}
        onRetryConnect={() => clientRef.current?.connect()}
      />

      {/* 进行中的传输进度卡片 */}
      {ongoingTransfers.length > 0 && (
        <div className="glass space-y-2.5 rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <Zap className="text-primary size-4" />
            正在无线传输（{ongoingTransfers.length}）
          </div>
          {ongoingTransfers.map((tx) => {
            const pct = tx.totalSize > 0 ? Math.min(100, Math.round((tx.transferredBytes / tx.totalSize) * 100)) : 0
            return (
              <div key={tx.transferId} className="bg-background/70 rounded-xl border p-3 text-xs">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">
                      {tx.direction === 'send' ? `发送给 ${tx.peerName}` : `接收自 ${tx.peerName}`}
                    </span>
                    <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-[10px] font-medium">
                      {tx.transport === 'p2p' ? 'P2P 局域网直连' : '内存流中转兜底'}
                    </span>
                    <span className="text-muted-foreground truncate max-w-[220px]">{tx.currentFileName}</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span>
                      {tx.status === 'connecting'
                        ? '握手连接中…'
                        : tx.status === 'waiting-accept'
                          ? '等待接收确认…'
                          : `${pct}% · ${formatSpeed(tx.speedBps)}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => clientRef.current?.cancelTransfer(tx.transferId)}
                      className="text-muted-foreground hover:text-destructive rounded p-0.5"
                      title="取消传输"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                </div>
                <div className="bg-foreground/10 h-1.5 w-full overflow-hidden rounded-full">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 via-cyan-400 to-emerald-400 transition-all duration-150"
                    style={{ width: `${tx.status === 'transferring' ? pct : 15}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 收件箱：已接收的文件与文字消息 */}
      {(receivedFiles.length > 0 || textMessages.length > 0) && (
        <div className="glass space-y-4 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">
              无线收件箱（{receivedFiles.length} 个文件 · {textMessages.length} 条文本）
            </span>
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive h-7 px-2 text-xs" onClick={clearReceived}>
              <Trash2 className="size-3.5" />
              清空记录
            </Button>
          </div>

          {receivedFiles.length > 0 && (
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {receivedFiles.map((f) => (
                <div key={f.id} className="bg-background/70 flex items-center gap-3 rounded-xl border p-2.5">
                  {f.isImage ? (
                    <img src={f.url} alt={f.name} className="size-12 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <div className="bg-primary/10 text-primary flex size-12 shrink-0 items-center justify-center rounded-lg">
                      <FileIcon className="size-5" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold" title={f.name}>
                      {f.name}
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-[11px]">
                      {formatBytes(f.size)} · 来自 {f.fromName} · {f.time}
                    </div>
                  </div>
                  <a
                    href={f.url}
                    download={f.name}
                    className="border-foreground/10 hover:border-primary hover:text-primary inline-flex size-8 shrink-0 items-center justify-center rounded-lg border transition"
                    title="重新保存"
                  >
                    <Download className="size-4" />
                  </a>
                </div>
              ))}
            </div>
          )}

          {textMessages.length > 0 && (
            <div className="space-y-2">
              {textMessages.map((m) => {
                const isUrl = /^https?:\/\/\S+$/i.test(m.text)
                return (
                  <div key={m.id} className="bg-background/70 flex items-start justify-between gap-3 rounded-xl border p-3 text-xs">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-muted-foreground flex items-center gap-2 text-[11px]">
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 font-medium',
                            m.direction === 'in'
                              ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400'
                              : 'bg-primary/10 text-primary',
                          )}
                        >
                          {m.direction === 'in' ? `来自 ${m.peerName}` : `发给 ${m.peerName}`}
                        </span>
                        <span className="font-mono">{m.time}</span>
                      </div>
                      <div className="break-all whitespace-pre-wrap text-sm">{m.text}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {isUrl && (
                        <a
                          href={m.text}
                          target="_blank"
                          rel="noreferrer"
                          className="border-foreground/10 hover:text-primary inline-flex size-7 items-center justify-center rounded-lg border"
                          title="打开链接"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => void copyToClipboard(m.text, `txt-${m.id}`)}
                        className="border-foreground/10 hover:text-primary inline-flex size-7 items-center justify-center rounded-lg border"
                        title="复制文本"
                      >
                        {copiedKey === `txt-${m.id}` ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* 隔空接收请求弹窗（仿 AirDrop 悬浮确认卡） */}
      <AnimatePresence>
        {incomingOffers.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.94 }}
            className="fixed right-4 bottom-5 left-4 z-50 mx-auto max-w-md sm:left-auto"
          >
            {incomingOffers.slice(0, 1).map((offer) => (
              <div
                key={offer.transferId}
                className="bg-card-solid rounded-3xl border border-cyan-400/35 p-5 shadow-[0_24px_64px_-12px_rgba(6,182,212,0.45)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-md"
                      style={{ backgroundColor: offer.fromColor }}
                    >
                      <Download className="size-5" />
                    </span>
                    <div>
                      <div className="text-sm font-bold">{offer.fromName} 想给你发送文件</div>
                      <div className="text-muted-foreground mt-0.5 text-xs">
                        共 {offer.files.length} 个文件 · {formatBytes(offer.totalSize)} ·{' '}
                        {offer.transport === 'p2p' ? 'P2P 局域网直传' : '安全中转通道'}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-muted/50 mt-3 max-h-28 space-y-1 overflow-y-auto rounded-xl p-2.5 text-xs">
                  {offer.files.map((f) => (
                    <div key={f.id} className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{f.name}</span>
                      <span className="text-muted-foreground shrink-0 font-mono text-[11px]">{formatBytes(f.size)}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => handleRespondOffer(offer, false)}>
                    拒绝
                  </Button>
                  <Button variant="primary" className="flex-1" onClick={() => handleRespondOffer(offer, true)}>
                    <Download className="size-4" />
                    立即接收
                  </Button>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 发送文字 / 链接弹窗 */}
      <AnimatePresence>
        {textTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setTextTarget(null)}
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
                  <MessageSquare className="text-primary size-4" />
                  隔空发送文字给「{textTarget.name}」
                </div>
                <button type="button" onClick={() => setTextTarget(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="size-4" />
                </button>
              </div>
              <textarea
                autoFocus
                rows={4}
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    handleSendText()
                  }
                }}
                placeholder="输入链接、验证码或任意文本（Ctrl+Enter 快速发送）"
                className="bg-background focus:border-primary w-full resize-none rounded-xl border p-3 text-sm outline-none"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setTextTarget(null)}>
                  取消
                </Button>
                <Button variant="primary" disabled={!textDraft.trim()} onClick={handleSendText}>
                  <Send className="size-4" />
                  立即发送
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 6 位配对码跨网 / 防隔离连接弹窗 */}
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
                  6 位配对码直连（跨网 / 防隔离）
                </div>
                <button type="button" onClick={() => setPairModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="size-4" />
                </button>
              </div>

              <p className="text-muted-foreground text-xs leading-relaxed">
                若两台设备不在同一 Wi-Fi（如 5G 手机传电脑）或公司路由开启了隔离，只需双方输入相同的 6 位数字配对码，即可立刻在雷达中发现彼此。
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
                    进入配对房间
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
