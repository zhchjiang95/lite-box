import { AnimatePresence, motion } from 'motion/react'
import {
  Check,
  Edit3,
  Laptop,
  MessageSquare,
  Radio,
  Smartphone,
  Tablet,
  Upload,
  WifiOff,
  Zap,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { formatSpeed, type ActiveTransfer, type ConnectionState, type DeviceType, type PeerInfo } from './types'

interface RadarStageProps {
  connectionState: ConnectionState
  self: PeerInfo | null
  peers: PeerInfo[]
  roomLabel: string
  pairCode: string | null
  transfers: ActiveTransfer[]
  onPickFilesForPeer: (peer: PeerInfo) => void
  onDropFilesForPeer: (peer: PeerInfo, files: File[]) => void
  onOpenTextModal: (peer: PeerInfo) => void
  onRenameSelf: (name: string) => void
  onOpenPairModal: () => void
  onRetryConnect: () => void
}

function DeviceIcon({ type, className }: { type: DeviceType; className?: string }) {
  if (type === 'phone') return <Smartphone className={className} />
  if (type === 'tablet') return <Tablet className={className} />
  return <Laptop className={className} />
}

/** 计算每个在线设备在雷达舞台上的星轨坐标（百分比，原点为下方中央本机光核） */
function computeOrbitalPositions(count: number): { x: number; y: number }[] {
  if (count === 0) return []
  if (count === 1) return [{ x: 50, y: 31 }]
  if (count === 2) return [{ x: 30, y: 36 }, { x: 70, y: 36 }]
  if (count === 3) return [{ x: 22, y: 44 }, { x: 50, y: 24 }, { x: 78, y: 44 }]

  const pts: { x: number; y: number }[] = []
  const cx = 50
  const cy = 78
  for (let i = 0; i < count; i++) {
    const outer = count > 5 && i % 2 === 1
    const t = count === 1 ? 0.5 : i / (count - 1)
    // 角度范围：-156° ~ -24°（上方扇形星轨）
    const angleDeg = -156 + t * 132
    const rad = (angleDeg * Math.PI) / 180
    const rx = outer ? 39 : 31
    const ry = outer ? 54 : 43
    pts.push({
      x: Math.max(11, Math.min(89, cx + Math.cos(rad) * rx)),
      y: Math.max(15, Math.min(62, cy + Math.sin(rad) * ry)),
    })
  }
  return pts
}

/**
 * 无线雷达沉浸舞台
 * - 同心圆声波脉冲 + 极光旋转扫描光束 + 星轨浮现设备节点
 * - 拖拽文件磁吸发光 + 贝塞尔能量光束粒子飞行 + 头像外圈实时进度光环
 */
export function RadarStage({
  connectionState,
  self,
  peers,
  roomLabel,
  pairCode,
  transfers,
  onPickFilesForPeer,
  onDropFilesForPeer,
  onOpenTextModal,
  onRenameSelf,
  onOpenPairModal,
  onRetryConnect,
}: RadarStageProps) {
  const [dragTargetId, setDragTargetId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  const positions = useMemo(() => computeOrbitalPositions(peers.length), [peers.length])

  // 为每个设备找到当前最活跃的一条传输任务
  const activeTransferByPeer = useMemo(() => {
    const map = new Map<string, ActiveTransfer>()
    for (const tx of transfers) {
      if (tx.status === 'connecting' || tx.status === 'waiting-accept' || tx.status === 'transferring') {
        map.set(tx.peerId, tx)
      }
    }
    return map
  }, [transfers])

  const selfPos = { x: 50, y: 78 }

  const startRename = () => {
    setNameDraft(self?.name ?? '')
    setEditingName(true)
  }

  const submitRename = () => {
    setEditingName(false)
    if (nameDraft.trim() && nameDraft.trim() !== self?.name) {
      onRenameSelf(nameDraft.trim())
    }
  }

  return (
    <div className="relative flex min-h-[540px] w-full flex-col overflow-hidden rounded-3xl border border-indigo-500/20 bg-[#070b16] text-white shadow-2xl sm:min-h-[600px]">
      {/* 深空极光渐变氛围层 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 78%, rgba(6, 182, 212, 0.24), transparent 52%), radial-gradient(circle at 22% 24%, rgba(139, 92, 246, 0.2), transparent 46%), radial-gradient(circle at 80% 22%, rgba(56, 189, 248, 0.16), transparent 45%)',
        }}
      />

      {/* 细腻星点微纹理 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.45) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
          maskImage: 'radial-gradient(circle at 50% 62%, black 15%, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(circle at 50% 62%, black 15%, transparent 78%)',
        }}
      />

      {/* 同心圆轨道线 + 持续向外扩散的无线声波脉冲 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        {/* 静态细星轨环 */}
        {[210, 380, 560, 760].map((diameter) => (
          <div
            key={diameter}
            className="absolute rounded-full border border-cyan-300/[0.11]"
            style={{
              width: diameter,
              height: diameter,
              left: `${selfPos.x}%`,
              top: `${selfPos.y}%`,
              transform: 'translate(-50%, -50%)',
            }}
          />
        ))}

        {/* 旋转极光雷达扫描光束（在线时激活） */}
        {connectionState === 'online' && (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 8, ease: 'linear' }}
            className="absolute rounded-full"
            style={{
              width: 780,
              height: 780,
              left: `${selfPos.x}%`,
              top: `${selfPos.y}%`,
              marginLeft: -390,
              marginTop: -390,
              background:
                'conic-gradient(from 0deg, rgba(6, 182, 212, 0.22) 0deg, rgba(139, 92, 246, 0.08) 38deg, transparent 78deg, transparent 360deg)',
            }}
          />
        )}

        {/* 3 层错峰向外扩散的声波涟漪 */}
        {connectionState === 'online' &&
          [0, 1.3, 2.6].map((delay) => (
            <motion.div
              key={delay}
              initial={{ scale: 0.2, opacity: 0.6 }}
              animate={{ scale: 3.1, opacity: 0 }}
              transition={{
                repeat: Infinity,
                duration: 3.9,
                delay,
                ease: 'easeOut',
              }}
              className="absolute rounded-full border border-cyan-400/45 shadow-[0_0_24px_rgba(34,211,238,0.28)]"
              style={{
                width: 240,
                height: 240,
                left: `${selfPos.x}%`,
                top: `${selfPos.y}%`,
                marginLeft: -120,
                marginTop: -120,
              }}
            />
          ))}
      </div>

      {/* 贝塞尔无线能量光束层（发送/接收时连接本机与目标设备并有光点高速穿梭） */}
      <svg
        aria-hidden
        viewBox="0 0 1000 600"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      >
        <defs>
          <linearGradient id="lan-beam-grad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="50%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
          <filter id="lan-beam-glow">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {peers.map((peer, idx) => {
          const tx = activeTransferByPeer.get(peer.id)
          if (!tx) return null
          const pos = positions[idx]
          if (!pos) return null

          const sx = selfPos.x * 10
          const sy = selfPos.y * 6
          const px = pos.x * 10
          const py = pos.y * 6
          const midX = (sx + px) / 2 + (px >= sx ? 45 : -45)
          const midY = (sy + py) / 2 - 25

          // 发送方向：本机 → 对方；接收方向：对方 → 本机
          const d =
            tx.direction === 'send'
              ? `M ${sx} ${sy} Q ${midX} ${midY} ${px} ${py}`
              : `M ${px} ${py} Q ${midX} ${midY} ${sx} ${sy}`
          const pathId = `beam-${peer.id}`

          return (
            <g key={peer.id} filter="url(#lan-beam-glow)">
              <path
                id={pathId}
                d={d}
                fill="none"
                stroke="url(#lan-beam-grad)"
                strokeWidth="2.8"
                strokeDasharray="8 8"
                opacity="0.72"
              />
              {[0, 0.45, 0.9].map((begin) => (
                <circle key={begin} r="5.5" fill="#67e8f9">
                  <animateMotion dur="1.35s" begin={`${begin}s`} repeatCount="indefinite" path={d} />
                </circle>
              ))}
            </g>
          )
        })}
      </svg>

      {/* 顶部浮层状态信息 */}
      <div className="relative z-20 flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium backdrop-blur-md',
              connectionState === 'online'
                ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300'
                : connectionState === 'connecting'
                  ? 'border-amber-400/30 bg-amber-500/15 text-amber-200'
                  : 'border-rose-400/30 bg-rose-500/15 text-rose-200',
            )}
          >
            <span
              className={cn(
                'size-2 rounded-full',
                connectionState === 'online'
                  ? 'animate-pulse bg-emerald-400 shadow-[0_0_8px_#34d399]'
                  : connectionState === 'connecting'
                    ? 'animate-ping bg-amber-400'
                    : 'bg-rose-400',
              )}
            />
            {connectionState === 'online'
              ? `无线雷达在线 · 发现 ${peers.length} 台附近设备`
              : connectionState === 'connecting'
                ? '正在连接无线信令雷达…'
                : '未连接到信令服务'}
          </span>

          <button
            type="button"
            onClick={onOpenPairModal}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-cyan-200 backdrop-blur-md transition hover:bg-white/20"
          >
            <Radio className="size-3.5" />
            {pairCode ? `配对房间 #${pairCode}` : roomLabel}
          </button>
        </div>

        <span className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/65 backdrop-blur-md sm:inline-flex">
          <Zap className="size-3.5 text-cyan-300" />
          P2P 加密直传优先 · 受限网络自动中转兜底（不落盘）
        </span>
      </div>

      {/* 中央星轨设备层 */}
      <div className="relative z-20 flex-1">
        {/* 离线或空雷达引导 */}
        {connectionState === 'offline' ? (
          <div className="absolute inset-x-4 top-[34%] flex -translate-y-1/2 flex-col items-center text-center">
            <div className="mb-3 flex size-14 items-center justify-center rounded-2xl border border-rose-400/30 bg-rose-500/15 text-rose-300">
              <WifiOff className="size-7" />
            </div>
            <div className="text-base font-semibold text-white">尚未检测到局域网信令服务</div>
            <p className="mt-1.5 max-w-md text-xs leading-relaxed text-white/60">
              请在项目根目录启动独立后端服务 <code className="rounded bg-white/10 px-1.5 py-0.5 text-cyan-200">cd server && node index.mjs</code>（生产环境直接访问该服务即可），设备打开同一页面即会自动出现在雷达上。
            </p>
            <button
              type="button"
              onClick={onRetryConnect}
              className="mt-4 rounded-xl border border-cyan-400/35 bg-cyan-500/20 px-4 py-1.5 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/30"
            >
              重新扫描连接
            </button>
          </div>
        ) : peers.length === 0 ? (
          <div className="pointer-events-none absolute inset-x-4 top-[34%] flex -translate-y-1/2 flex-col items-center text-center">
            <motion.div
              animate={{ opacity: [0.55, 1, 0.55] }}
              transition={{ repeat: Infinity, duration: 2.8 }}
              className="text-sm font-medium text-cyan-100/90 sm:text-base"
            >
              正在搜索同一 Wi-Fi / 局域网下的其他设备…
            </motion.div>
            <p className="mt-1.5 max-w-md text-xs text-white/55">
              在另一台手机或电脑上打开此网页，对方就会像隔空投送一样自动浮现在这里；若跨网或被路由器隔离，可点上方进入「6 位配对码」房间。
            </p>
          </div>
        ) : null}

        {/* 在线设备星轨节点 */}
        <AnimatePresence>
          {peers.map((peer, idx) => {
            const pos = positions[idx]
            if (!pos) return null
            const tx = activeTransferByPeer.get(peer.id)
            const isDragOver = dragTargetId === peer.id
            const progress =
              tx && tx.totalSize > 0
                ? Math.min(100, Math.round((tx.transferredBytes / tx.totalSize) * 100))
                : 0
            const ringR = 40
            const ringC = 2 * Math.PI * ringR

            return (
              <motion.div
                key={peer.id}
                initial={{ opacity: 0, scale: 0.35 }}
                animate={{ opacity: 1, scale: isDragOver ? 1.12 : 1 }}
                exit={{ opacity: 0, scale: 0.4 }}
                transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                className="absolute -translate-x-1/2 -translate-y-1/2"
              >
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragTargetId(peer.id)
                  }}
                  onDragLeave={() => setDragTargetId((cur) => (cur === peer.id ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragTargetId(null)
                    const files = Array.from(e.dataTransfer.files)
                    if (files.length) onDropFilesForPeer(peer, files)
                  }}
                  className="group relative flex flex-col items-center"
                >
                  {/* 初次浮现时的扩散欢迎光环 */}
                  <motion.span
                    initial={{ scale: 0.7, opacity: 0.85 }}
                    animate={{ scale: 2.1, opacity: 0 }}
                    transition={{ duration: 1.1, ease: 'easeOut' }}
                    className="pointer-events-none absolute top-0 size-20 rounded-full border-2 border-cyan-300/70"
                  />

                  {/* 拖拽文件靠近时的旋转磁吸光环 */}
                  {isDragOver && (
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 3, ease: 'linear' }}
                      className="pointer-events-none absolute -top-2.5 size-[100px] rounded-full border-2 border-dashed border-cyan-300 shadow-[0_0_28px_rgba(34,211,238,0.65)]"
                    />
                  )}

                  {/* 核心圆形设备按钮（点击选文件 / 拖入直接发） */}
                  <button
                    type="button"
                    onClick={() => onPickFilesForPeer(peer)}
                    className="relative flex size-20 cursor-pointer items-center justify-center rounded-full border border-white/25 shadow-[0_10px_34px_-6px_rgba(0,0,0,0.65)] transition-transform duration-200 hover:scale-105 active:scale-95"
                    style={{
                      background: `radial-gradient(circle at 30% 25%, ${peer.color}, #1e1b4b 92%)`,
                    }}
                    title={`点击选择文件发送给 ${peer.name}，或直接拖入文件`}
                  >
                    <DeviceIcon type={peer.deviceType} className="size-8 text-white drop-shadow" />

                    {/* 传输进度 SVG 发光圆环 */}
                    {tx && (
                      <svg className="pointer-events-none absolute -inset-1.5 size-[92px] -rotate-90" viewBox="0 0 92 92">
                        <circle
                          cx="46"
                          cy="46"
                          r={ringR}
                          fill="none"
                          stroke="rgba(255,255,255,0.16)"
                          strokeWidth="4"
                        />
                        <circle
                          cx="46"
                          cy="46"
                          r={ringR}
                          fill="none"
                          stroke="#22d3ee"
                          strokeWidth="4.5"
                          strokeLinecap="round"
                          strokeDasharray={ringC}
                          strokeDashoffset={
                            tx.status === 'transferring' ? ringC * (1 - progress / 100) : ringC * 0.72
                          }
                          className="transition-all duration-150"
                        />
                      </svg>
                    )}

                    {/* 在线呼吸小绿点 */}
                    <span className="absolute right-1 bottom-1 size-3.5 rounded-full border-2 border-[#070b16] bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                  </button>

                  {/* 设备名称与实时状态标签 */}
                  <div className="mt-2.5 flex flex-col items-center text-center">
                    <div className="rounded-full bg-slate-950/75 px-3 py-0.5 text-xs font-bold tracking-wide text-white shadow backdrop-blur-md">
                      {peer.name}
                    </div>
                    <div className="mt-0.5 text-[10px] text-white/60">
                      {isDragOver ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-cyan-300">
                          <Upload className="size-3" />
                          松手隔空发送
                        </span>
                      ) : tx ? (
                        <span className="font-mono text-cyan-300">
                          {tx.status === 'connecting'
                            ? '正在建立加密通道…'
                            : tx.status === 'waiting-accept'
                              ? '等待对方确认…'
                              : `${tx.direction === 'send' ? '发送' : '接收'} ${progress}% · ${formatSpeed(tx.speedBps)}`}
                        </span>
                      ) : (
                        <span>
                          {peer.osLabel} · {peer.browserLabel}
                        </span>
                      )}
                    </div>

                    {/* 悬停或移动端随时可见的快捷「发文字」小胶囊 */}
                    {!tx && (
                      <button
                        type="button"
                        onClick={() => onOpenTextModal(peer)}
                        className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur-md transition hover:border-cyan-300/50 hover:bg-cyan-500/20 hover:text-white"
                      >
                        <MessageSquare className="size-2.5" />
                        发文字
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>

        {/* 本机设备光核（固定在下方中央） */}
        <div
          style={{ left: `${selfPos.x}%`, top: `${selfPos.y}%` }}
          className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
        >
          <div className="flex flex-col items-center">
            <div className="relative flex size-16 items-center justify-center rounded-full border-2 border-cyan-300/70 bg-gradient-to-br from-violet-500 via-indigo-600 to-cyan-500 shadow-[0_0_36px_rgba(34,211,238,0.5)]">
              <DeviceIcon type={self?.deviceType ?? 'desktop'} className="size-7 text-white" />
            </div>

            <div className="mt-2.5 flex flex-col items-center">
              {editingName ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    submitRename()
                  }}
                  className="flex items-center gap-1 rounded-full border border-cyan-400/50 bg-slate-950/90 px-2.5 py-1"
                >
                  <input
                    autoFocus
                    maxLength={18}
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={submitRename}
                    className="w-28 bg-transparent text-center text-xs font-semibold text-white outline-none"
                  />
                  <button type="submit" className="text-cyan-300">
                    <Check className="size-3.5" />
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={startRename}
                  className="group inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-slate-950/75 px-3 py-1 text-xs font-semibold text-white backdrop-blur-md transition hover:border-cyan-300/50"
                  title="点击修改本机显示代号"
                >
                  <span className="text-cyan-300">我：</span>
                  <span>{self?.name ?? '识别中…'}</span>
                  <Edit3 className="size-3 text-white/50 transition group-hover:text-cyan-300" />
                </button>
              )}
              <span className="mt-1 text-[10px] text-white/50">
                点击任意上方设备选文件，或直接将文件拖到对方头像上
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
