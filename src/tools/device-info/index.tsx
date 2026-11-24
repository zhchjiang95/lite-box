import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Battery,
  BatteryCharging,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Download,
  Gauge,
  Globe,
  HardDrive,
  Laptop,
  Layers,
  Monitor,
  Play,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Square,
  Volume2,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { downloadBlob, timestampName } from '@/lib/file'
import { cn } from '@/lib/utils'
import {
  buildMarkdownReport,
  collectDeviceSnapshot,
  collectDisplayRows,
  formatBytes,
  formatDurationSec,
  measureRefreshRate,
  readNetworkSnapshot,
  watchBattery,
  type BatterySnapshot,
  type DeviceSnapshot,
  type InfoRow,
  type NetworkSnapshot,
} from './collector'
import {
  evaluateNetworkTier,
  fetchPublicIpInfo,
  INITIAL_SPEED_PROGRESS,
  probeSelfSpeedtestApi,
  runSpeedTest,
  type PublicIpInfo,
  type SpeedSamplePoint,
  type SpeedTestProgress,
  type SpeedTestRecord,
  type SpeedTestSource,
} from './speedtest'

type TabMode = 'overview' | 'speedtest' | 'capabilities'

/** 将 Mbps 映射为非线性仪表盘角度比例 [0..1]（0→10→50→100→300→1000 Mbps 视觉分布均匀） */
function mbpsToGaugeRatio(mbps: number): number {
  if (mbps <= 0) return 0
  const maxLog = Math.log10(1200 + 1)
  return Math.min(1, Math.log10(mbps + 1) / maxLog)
}

/** 极坐标转笛卡尔坐标（用于 SVG 弧形仪表盘） */
function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle)
  const end = polarToCartesian(cx, cy, r, startAngle)
  const largeArc = endAngle - startAngle <= 180 ? '0' : '1'
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`
}

/** 高颜值 SVG 弧形实时测速仪表盘 */
function SpeedGauge({ progress }: { progress: SpeedTestProgress }) {
  const startAngle = -125
  const sweepAngle = 250
  const ratio = mbpsToGaugeRatio(progress.liveMbps)
  const currentAngle = startAngle + sweepAngle * ratio
  const bgArc = describeArc(130, 128, 98, startAngle, startAngle + sweepAngle)
  const activeArc = ratio > 0.005 ? describeArc(130, 128, 98, startAngle, currentAngle) : ''

  const stageLabel: Record<SpeedTestProgress['stage'], string> = {
    idle: '等待测速',
    ping: '延迟采样中',
    download: '下行测速中',
    upload: '上行测速中',
    done: '下行速率',
    error: '测速异常',
  }

  const ticks = [0, 10, 50, 100, 300, 1000]
  const mbPerSec = (progress.liveMbps / 8).toFixed(progress.liveMbps >= 80 ? 1 : 2)

  return (
    <div className="relative mx-auto w-full max-w-[290px] select-none">
      <svg viewBox="0 0 260 220" className="h-auto w-full overflow-visible">
        <defs>
          <linearGradient id="speed-gauge-grad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="55%" stopColor="#6366f1" />
            <stop offset="100%" stopColor={progress.stage === 'upload' ? '#ec4899' : '#10b981'} />
          </linearGradient>
        </defs>

        {/* 底轨 */}
        <path
          d={bgArc}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.1"
          strokeWidth="15"
          strokeLinecap="round"
        />

        {/* 动态进度弧 */}
        {activeArc && (
          <path
            d={activeArc}
            fill="none"
            stroke="url(#speed-gauge-grad)"
            strokeWidth="15"
            strokeLinecap="round"
            className="transition-all duration-150"
          />
        )}

        {/* 刻度文字 */}
        {ticks.map((t) => {
          const ang = startAngle + sweepAngle * mbpsToGaugeRatio(t)
          const pt = polarToCartesian(130, 128, 76, ang)
          return (
            <text
              key={t}
              x={pt.x}
              y={pt.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-muted-foreground font-mono text-[9px]"
            >
              {t >= 1000 ? '1G' : t}
            </text>
          )
        })}
      </svg>

      {/* 中央数字读数 */}
      <div className="pointer-events-none absolute inset-x-0 top-[74px] flex flex-col items-center text-center">
        <span className="text-muted-foreground text-[11px] font-medium">{stageLabel[progress.stage]}</span>
        <div className="mt-0.5 font-mono text-4xl font-bold tracking-tight tabular-nums">
          {progress.liveMbps >= 100 ? progress.liveMbps.toFixed(0) : progress.liveMbps.toFixed(1)}
        </div>
        <div className="text-muted-foreground mt-0.5 font-mono text-xs">
          Mbps <span className="opacity-60">·</span> {mbPerSec} MB/s
        </div>
      </div>
    </div>
  )
}

/** 实时速率波形图 */
function SpeedSparkline({
  samples,
  color,
  label,
}: {
  samples: SpeedSamplePoint[]
  color: string
  label: string
}) {
  const width = 320
  const height = 74
  const padY = 8

  if (samples.length < 2) {
    return (
      <div className="border-border/60 bg-foreground/[0.02] flex h-[86px] flex-col items-center justify-center rounded-xl border border-dashed text-xs">
        <span className="text-muted-foreground/70">{label}实时曲线待采样</span>
      </div>
    )
  }

  const maxVal = Math.max(10, ...samples.map((s) => s.mbps)) * 1.12
  const points = samples.map((s, idx) => {
    const x = (idx / (samples.length - 1)) * width
    const y = height - padY - (s.mbps / maxVal) * (height - padY * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const lineD = `M ${points.join(' L ')}`
  const areaD = `${lineD} L ${width},${height} L 0,${height} Z`

  return (
    <div className="border-border/60 bg-foreground/[0.02] rounded-xl border p-2.5">
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground font-medium">{label}趋势</span>
        <span className="font-mono text-muted-foreground">
          峰值 {Math.max(...samples.map((s) => s.mbps)).toFixed(1)} Mbps
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[54px] w-full overflow-visible">
        <path d={areaD} fill={color} fillOpacity="0.14" />
        <path d={lineD} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

/** 通用信息行列表组件（支持搜索高亮过滤与单击复制） */
function InfoList({
  rows,
  query,
  onCopy,
}: {
  rows: InfoRow[]
  query: string
  onCopy: (val: string, label: string) => void
}) {
  const q = query.trim().toLowerCase()
  const visible = q
    ? rows.filter(
        (r) =>
          r.label.toLowerCase().includes(q) ||
          r.value.toLowerCase().includes(q) ||
          (r.detail?.toLowerCase().includes(q) ?? false),
      )
    : rows

  if (visible.length === 0) return null

  return (
    <div className="divide-border/45 divide-y">
      {visible.map((row) => (
        <div
          key={row.key}
          className="hover:bg-foreground/[0.025] group flex items-start justify-between gap-3 rounded-lg px-2 py-2 text-xs transition"
        >
          <span className="text-muted-foreground shrink-0 pt-0.5">{row.label}</span>
          <div className="flex min-w-0 items-start gap-1.5 text-right">
            <div className="min-w-0">
              <div className={cn('text-foreground break-all font-medium', row.mono && 'font-mono tabular-nums')}>
                {row.value}
              </div>
              {row.detail && <div className="text-muted-foreground/80 mt-0.5 text-[11px]">{row.detail}</div>}
            </div>
            <button
              type="button"
              onClick={() => onCopy(row.value, row.label)}
              className="text-muted-foreground hover:text-primary shrink-0 rounded p-0.5 opacity-0 transition group-hover:opacity-100"
              title={`复制${row.label}`}
            >
              <Copy className="size-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function DeviceInfoTool() {
  const [tab, setTab] = useState<TabMode>('overview')
  const [snapshot, setSnapshot] = useState<DeviceSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [measuredHz, setMeasuredHz] = useState<number | null>(null)
  const [displayRows, setDisplayRows] = useState<InfoRow[]>([])
  const [battery, setBattery] = useState<BatterySnapshot>({
    supported: false,
    charging: false,
    level: 0,
    chargingTime: 0,
    dischargingTime: 0,
  })
  const [network, setNetwork] = useState<NetworkSnapshot>(() => readNetworkSnapshot())

  // 测速相关状态
  const [speedSource, setSpeedSource] = useState<SpeedTestSource>('cloudflare')
  const [selfApiAvailable, setSelfApiAvailable] = useState<boolean | null>(null)
  const [speedProgress, setSpeedProgress] = useState<SpeedTestProgress>(INITIAL_SPEED_PROGRESS)
  const [speedHistory, setSpeedHistory] = useState<SpeedTestRecord[]>([])
  const [publicIp, setPublicIp] = useState<PublicIpInfo | null>(null)
  const [loadingIp, setLoadingIp] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const refreshAll = useCallback(async () => {
    setLoading(true)
    try {
      const snap = await collectDeviceSnapshot(measuredHz)
      setSnapshot(snap)
      setDisplayRows(collectDisplayRows(measuredHz))
      setNetwork(readNetworkSnapshot())
    } finally {
      setLoading(false)
    }
  }, [measuredHz])

  // 初始化采集 + 电池监听 + 刷新率测算 + 自建测速端点探活
  useEffect(() => {
    refreshAll()
    const stopHz = measureRefreshRate((hz) => {
      setMeasuredHz(hz)
      setDisplayRows(collectDisplayRows(hz))
    })

    let stopBattery: (() => void) | null = null
    watchBattery(setBattery).then((unsub) => {
      stopBattery = unsub
    })

    probeSelfSpeedtestApi().then((ok) => {
      setSelfApiAvailable(ok)
    })

    return () => {
      stopHz()
      stopBattery?.()
      abortRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 监听窗口尺寸变化与网络切换，实时刷新数据
  useEffect(() => {
    const onResize = () => setDisplayRows(collectDisplayRows(measuredHz))
    const onNetChange = () => setNetwork(readNetworkSnapshot())

    window.addEventListener('resize', onResize)
    window.addEventListener('online', onNetChange)
    window.addEventListener('offline', onNetChange)
    const conn = (navigator as unknown as { connection?: EventTarget }).connection
    conn?.addEventListener?.('change', onNetChange)

    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('online', onNetChange)
      window.removeEventListener('offline', onNetChange)
      conn?.removeEventListener?.('change', onNetChange)
    }
  }, [measuredHz])

  const copyText = async (text: string, label = '内容') => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`已复制${label}`)
    } catch {
      toast.error('复制失败，请手动选中复制')
    }
  }

  const handleCopyMarkdown = () => {
    if (!snapshot) return
    const md = buildMarkdownReport(snapshot, battery, measuredHz)
    copyText(md, '完整 Markdown 配置报告')
  }

  const handleExportJson = () => {
    if (!snapshot) return
    const payload = {
      ...snapshot,
      displayRows,
      measuredRefreshRateHz: measuredHz,
      battery,
      network,
      speedHistory,
    }
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }),
      timestampName('device-info', 'json'),
    )
    toast.success('已导出 JSON 设备信息报告')
  }

  // 开始 / 中止网速测试
  const isTesting =
    speedProgress.stage === 'ping' || speedProgress.stage === 'download' || speedProgress.stage === 'upload'

  const handleStartSpeedTest = async () => {
    if (isTesting) {
      abortRef.current?.abort()
      abortRef.current = null
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    const finalState = await runSpeedTest(speedSource, controller.signal, setSpeedProgress)
    abortRef.current = null

    if (
      finalState.stage === 'done' &&
      finalState.pingMs !== null &&
      finalState.downloadMbps !== null &&
      finalState.uploadMbps !== null
    ) {
      const d = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
      setSpeedHistory((prev) =>
        [
          {
            id: `${Date.now()}`,
            time,
            source: speedSource,
            pingMs: finalState.pingMs!,
            jitterMs: finalState.jitterMs ?? 0,
            downloadMbps: finalState.downloadMbps!,
            uploadMbps: finalState.uploadMbps!,
          },
          ...prev,
        ].slice(0, 10),
      )
      toast.success(`测速完成：下载 ${finalState.downloadMbps} Mbps · 上传 ${finalState.uploadMbps} Mbps`)
    }
  }

  const handleFetchPublicIp = async () => {
    setLoadingIp(true)
    try {
      const info = await fetchPublicIpInfo()
      setPublicIp(info)
      toast.success('已获取当前公网出口信息')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '查询公网 IP 失败')
    } finally {
      setLoadingIp(false)
    }
  }

  const gpuRows: InfoRow[] = useMemo(() => {
    if (!snapshot) return []
    const g = snapshot.gpu
    return [
      { key: 'gpu_renderer', label: '显卡渲染器', value: g.renderer, mono: true },
      { key: 'gpu_vendor', label: 'GPU 厂商', value: g.vendor },
      {
        key: 'gpu_apis',
        label: '图形 API 支持',
        value: `WebGL ${g.supported ? '1.0' : '不支持'}${g.webgl2 ? ' / 2.0' : ''} · WebGPU ${g.webgpu ? '支持' : '不支持'}`,
      },
      { key: 'gpu_glsl', label: '着色语言版本', value: g.shadingLanguage, mono: true },
      {
        key: 'gpu_tex',
        label: '最大纹理尺寸',
        value: g.maxTextureSize ? `${g.maxTextureSize} × ${g.maxTextureSize} px` : '未知',
        mono: true,
      },
      { key: 'gpu_vp', label: '最大视口尺寸', value: g.maxViewportDims, mono: true },
      {
        key: 'gpu_units',
        label: '纹理单元 / 扩展数',
        value: `${g.maxCombinedTextureUnits ?? '—'} 单元 · ${g.extensionCount} 个 WebGL 扩展`,
        mono: true,
      },
    ]
  }, [snapshot])

  const networkRows: InfoRow[] = useMemo(
    () => [
      { key: 'net_online', label: '联机状态', value: network.online ? '在线（已连接网络）' : '离线（无网络连接）' },
      { key: 'net_eff', label: '等效网络等级', value: network.effectiveType, mono: true },
      { key: 'net_type', label: '接口类型', value: network.type },
      {
        key: 'net_downlink',
        label: '浏览器估算下行',
        value: network.downlinkMbps !== null ? `${network.downlinkMbps} Mbps` : '浏览器未开放（建议使用测速仪实测）',
        mono: true,
      },
      {
        key: 'net_rtt',
        label: '浏览器估算 RTT',
        value: network.rttMs !== null ? `${network.rttMs} ms` : '浏览器未开放',
        mono: true,
      },
      { key: 'net_save', label: '省流模式 (Save-Data)', value: network.saveData ? '已开启' : '未开启' },
    ],
    [network],
  )

  const networkTier = useMemo(
    () => evaluateNetworkTier(speedProgress.downloadMbps, speedProgress.pingMs),
    [speedProgress.downloadMbps, speedProgress.pingMs],
  )

  const storagePercent =
    snapshot?.storage.quota && snapshot.storage.usage !== null
      ? Math.min(100, (snapshot.storage.usage / snapshot.storage.quota) * 100)
      : 0

  return (
    <div className="space-y-5">
      {/* ================= 顶部导航与导出控制 ================= */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          className="max-w-lg"
          options={[
            { value: 'overview', label: '系统与硬件', icon: <Cpu /> },
            { value: 'speedtest', label: '网络测速仪', icon: <Gauge /> },
            { value: 'capabilities', label: '能力与权限', icon: <ShieldCheck /> },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={refreshAll} disabled={loading}>
            <RefreshCw className={cn('!size-3.5', loading && 'animate-spin')} />
            重新检测
          </Button>
          <Button size="sm" variant="outline" disabled={!snapshot} onClick={handleCopyMarkdown}>
            <Copy className="!size-3.5" />
            复制报告
          </Button>
          <Button size="sm" variant="outline" disabled={!snapshot} onClick={handleExportJson}>
            <Download className="!size-3.5" />
            JSON
          </Button>
        </div>
      </div>

      {/* ================= 视图一：系统与硬件全览 ================= */}
      {tab === 'overview' && snapshot && (
        <div className="space-y-5">
          {/* 4 张硬件核心速览 Hero 卡 */}
          <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            <div className="glass shadow-soft rounded-2xl p-4">
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <Laptop className="text-primary size-4" />
                <span>操作系统与架构</span>
              </div>
              <div className="mt-2 truncate text-lg font-bold">
                {snapshot.summary.osName} {snapshot.summary.osDetail}
              </div>
              <div className="text-muted-foreground mt-1 flex items-center gap-1.5 font-mono text-xs">
                <span>{snapshot.summary.architecture}</span>
                <span>·</span>
                <span className="truncate">{snapshot.summary.browserName}</span>
              </div>
            </div>

            <div className="glass shadow-soft rounded-2xl p-4">
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <Cpu className="size-4 text-violet-500" />
                <span>处理器与内存</span>
              </div>
              <div className="mt-2 font-mono text-lg font-bold tabular-nums">
                {snapshot.summary.cpuCores ? `${snapshot.summary.cpuCores} 逻辑核` : '核心未知'}
                <span className="text-muted-foreground mx-1.5 font-normal">·</span>
                {snapshot.summary.deviceMemoryGb ? `${snapshot.summary.deviceMemoryGb >= 8 ? '≥' : ''}${snapshot.summary.deviceMemoryGb}GB` : '内存受限'}
              </div>
              <div className="text-muted-foreground mt-1 font-mono text-xs">
                {snapshot.summary.jsHeapUsedMb !== null
                  ? `JS 堆占用 ${snapshot.summary.jsHeapUsedMb} / ${snapshot.summary.jsHeapLimitMb} MB`
                  : snapshot.summary.deviceType}
              </div>
            </div>

            <div className="glass shadow-soft rounded-2xl p-4">
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <Layers className="size-4 text-cyan-500" />
                <span>显卡 GPU</span>
              </div>
              <div className="mt-2 line-clamp-1 text-sm font-bold" title={snapshot.gpu.renderer}>
                {snapshot.gpu.renderer}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span
                  className={cn(
                    'rounded-md px-1.5 py-0.5 font-mono font-medium',
                    snapshot.gpu.webgl2
                      ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                      : 'bg-foreground/8 text-muted-foreground',
                  )}
                >
                  WebGL2
                </span>
                <span
                  className={cn(
                    'rounded-md px-1.5 py-0.5 font-mono font-medium',
                    snapshot.gpu.webgpu
                      ? 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300'
                      : 'bg-foreground/8 text-muted-foreground',
                  )}
                >
                  WebGPU {snapshot.gpu.webgpu ? '✓' : '×'}
                </span>
              </div>
            </div>

            <div className="glass shadow-soft rounded-2xl p-4">
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <Monitor className="size-4 text-emerald-500" />
                <span>显示器与刷新率</span>
              </div>
              <div className="mt-2 font-mono text-lg font-bold tabular-nums">
                {window.screen.width}×{window.screen.height}
                <span className="text-primary ml-2 text-sm">{measuredHz ? `${measuredHz}Hz` : '测算中'}</span>
              </div>
              <div className="text-muted-foreground mt-1 font-mono text-xs">
                DPR {(window.devicePixelRatio || 1).toFixed(2).replace(/\.00$/, '')}× · {window.screen.colorDepth}bit 色深
              </div>
            </div>
          </div>

          {/* 快捷网络测速引导条 + 全局指标搜索 */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative min-w-[220px] flex-1 max-w-md">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="筛选设备参数（如 GPU、时区、刷新率、色域、DPR…）"
                className="border-border/70 bg-card/70 focus:border-primary focus:ring-primary/20 w-full rounded-xl border py-2 pr-3 pl-9 text-sm outline-none transition focus:ring-2"
              />
            </div>

            <div className="glass flex items-center gap-3 rounded-xl px-3.5 py-2 text-xs">
              <span className="flex items-center gap-1.5 font-medium">
                {network.online ? (
                  <Wifi className="size-4 text-emerald-500" />
                ) : (
                  <WifiOff className="size-4 text-rose-500" />
                )}
                <span>{network.online ? `在线 (${network.effectiveType})` : '当前离线'}</span>
              </span>
              {speedProgress.downloadMbps !== null && (
                <span className="text-muted-foreground font-mono">
                  上次实测 ↓{speedProgress.downloadMbps} Mbps
                </span>
              )}
              <Button size="sm" variant="primary" className="h-7 px-2.5 text-xs" onClick={() => setTab('speedtest')}>
                <Gauge className="!size-3.5" />
                测试网速
              </Button>
            </div>
          </div>

          {/* 详情分组网格 */}
          <div className="grid gap-5 lg:grid-cols-2">
            {/* 1. 系统与浏览器 */}
            <section className="glass shadow-soft space-y-2.5 rounded-2xl p-4 sm:p-5">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Laptop className="text-primary size-4" />
                <span>系统与浏览器环境</span>
              </div>
              <InfoList rows={snapshot.systemRows} query={searchQuery} onCopy={copyText} />
            </section>

            {/* 2. 显示器与视觉 */}
            <section className="glass shadow-soft space-y-2.5 rounded-2xl p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Monitor className="size-4 text-emerald-500" />
                  <span>显示器与视觉特性</span>
                </div>
                <span className="text-muted-foreground text-[11px]">缩放窗口实时更新</span>
              </div>
              <InfoList rows={displayRows} query={searchQuery} onCopy={copyText} />
            </section>

            {/* 3. 显卡与图形能力 */}
            <section className="glass shadow-soft space-y-2.5 rounded-2xl p-4 sm:p-5">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Layers className="size-4 text-cyan-500" />
                <span>显卡与图形计算 (WebGL / WebGPU)</span>
              </div>
              <InfoList rows={gpuRows} query={searchQuery} onCopy={copyText} />
            </section>

            {/* 4. 网络状态 */}
            <section className="glass shadow-soft space-y-2.5 rounded-2xl p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Wifi className="size-4 text-sky-500" />
                  <span>网络链路状态</span>
                </div>
                <button
                  type="button"
                  onClick={() => setTab('speedtest')}
                  className="text-primary text-xs font-medium hover:underline"
                >
                  前往实时测速 →
                </button>
              </div>
              <InfoList rows={networkRows} query={searchQuery} onCopy={copyText} />
            </section>

            {/* 5. 电池与电源 */}
            <section className="glass shadow-soft space-y-3 rounded-2xl p-4 sm:p-5">
              <div className="flex items-center gap-2 text-sm font-semibold">
                {battery.charging ? (
                  <BatteryCharging className="size-4 text-emerald-500" />
                ) : (
                  <Battery className="size-4 text-amber-500" />
                )}
                <span>电池与电源状态</span>
              </div>

              {battery.supported ? (
                <div className="space-y-3">
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-2xl font-bold tabular-nums">{battery.level}%</span>
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-xs font-medium',
                        battery.charging
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'bg-foreground/[0.06] text-muted-foreground',
                      )}
                    >
                      {battery.charging ? '正在充电 / 外接电源' : '电池供电中'}
                    </span>
                  </div>
                  <div className="bg-foreground/10 h-2.5 overflow-hidden rounded-full">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-500',
                        battery.charging
                          ? 'bg-emerald-500'
                          : battery.level <= 20
                            ? 'bg-rose-500'
                            : 'bg-primary',
                      )}
                      style={{ width: `${battery.level}%` }}
                    />
                  </div>
                  <div className="text-muted-foreground flex justify-between text-xs">
                    <span>
                      {battery.charging
                        ? `预计充满：${battery.chargingTime === 0 ? '已充满' : formatDurationSec(battery.chargingTime)}`
                        : `预计剩余续航：${formatDurationSec(battery.dischargingTime)}`}
                    </span>
                    <span>实时监听电量变化</span>
                  </div>
                </div>
              ) : (
                <div className="border-border/60 bg-foreground/[0.02] text-muted-foreground rounded-xl border border-dashed p-4 text-xs leading-relaxed">
                  当前浏览器未开放 Battery Status API（Safari、Firefox 或台式机部分环境出于防指纹隐私策略已隐藏电量接口）。
                </div>
              )}
            </section>

            {/* 6. 本地存储与配额 */}
            <section className="glass shadow-soft space-y-3 rounded-2xl p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <HardDrive className="size-4 text-indigo-500" />
                  <span>浏览器本地存储配额</span>
                </div>
                {snapshot.storage.persisted !== null && (
                  <span className="text-muted-foreground text-[11px]">
                    持久化保护：{snapshot.storage.persisted ? '已开启' : '默认策略'}
                  </span>
                )}
              </div>

              {snapshot.storage.supported && snapshot.storage.quota !== null ? (
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between font-mono text-xs">
                    <span>已使用 {formatBytes(snapshot.storage.usage)}</span>
                    <span className="text-muted-foreground">站点总配额 {formatBytes(snapshot.storage.quota)}</span>
                  </div>
                  <div className="bg-foreground/10 h-2 overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{ width: `${Math.max(1.5, storagePercent)}%` }}
                    />
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">当前环境不支持查询存储配额（可能处于隐私无痕模式）。</p>
              )}

              <div className="flex flex-wrap gap-1.5 pt-1 text-[11px]">
                {[
                  ['localStorage', snapshot.storage.localStorageOk],
                  ['sessionStorage', snapshot.storage.sessionStorageOk],
                  ['IndexedDB', snapshot.storage.indexedDbOk],
                  ['Cache API', snapshot.storage.cacheApiOk],
                  ['OPFS 私有文件系统', snapshot.storage.opfsOk],
                ].map(([label, ok]) => (
                  <span
                    key={label as string}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-medium',
                      ok
                        ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                        : 'bg-foreground/[0.06] text-muted-foreground',
                    )}
                  >
                    {ok ? <Check className="size-3" /> : <XCircle className="size-3" />}
                    {label as string}
                  </span>
                ))}
              </div>
            </section>
          </div>

          {/* 7. 原始 User-Agent */}
          <section className="glass shadow-soft space-y-2 rounded-2xl p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">完整 User-Agent 字符串</span>
              <Button size="sm" variant="ghost" onClick={() => copyText(snapshot.rawUserAgent, 'User-Agent')}>
                <Copy className="!size-3.5" />
                复制 UA
              </Button>
            </div>
            <pre className="border-border/60 bg-background/50 overflow-x-auto rounded-xl border p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap select-all">
              {snapshot.rawUserAgent}
            </pre>
          </section>
        </div>
      )}

      {/* ================= 视图二：双引擎实时网速测试仪 ================= */}
      {tab === 'speedtest' && (
        <div className="space-y-5">
          {/* 测速源选择 + 核心仪表盘 */}
          <section className="glass shadow-soft space-y-6 rounded-2xl p-5 sm:p-6">
            {/* 测速节点切换条 */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 text-base font-semibold">
                  <Activity className="text-primary size-4.5" />
                  <span>实时网络测速仪</span>
                </div>
                <p className="text-muted-foreground text-xs">
                  采用不可压缩随机字节流与阶梯分片采样，同时支持公网宽带与局域网自建节点实测
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isTesting}
                  onClick={() => setSpeedSource('cloudflare')}
                  className={cn(
                    'border-border/70 flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50',
                    speedSource === 'cloudflare'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Globe className="size-3.5" />
                  公网节点 (Cloudflare)
                </button>
                <button
                  type="button"
                  disabled={isTesting}
                  onClick={() => setSpeedSource('self')}
                  className={cn(
                    'border-border/70 flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50',
                    speedSource === 'self'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Server className="size-3.5" />
                  当前服务器节点
                  {selfApiAvailable !== null && (
                    <span
                      className={cn('size-2 rounded-full', selfApiAvailable ? 'bg-emerald-500' : 'bg-amber-400')}
                      title={selfApiAvailable ? '自建测速后端已就绪' : '未检测到 /api/speedtest 后端服务'}
                    />
                  )}
                </button>
              </div>
            </div>

            {/* 仪表盘 + 四维实时卡片 */}
            <div className="grid items-center gap-6 lg:grid-cols-[310px_minmax(0,1fr)]">
              {/* 左：仪表盘与开始/停止按钮 */}
              <div className="flex flex-col items-center gap-3">
                <SpeedGauge progress={speedProgress} />

                {/* 总进度条 */}
                <div className="w-full max-w-[260px] space-y-1.5">
                  <div className="bg-foreground/10 h-1.5 overflow-hidden rounded-full">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-500 transition-all duration-200"
                      style={{ width: `${speedProgress.progress}%` }}
                    />
                  </div>
                  <div className="text-muted-foreground text-center text-xs">{speedProgress.statusText}</div>
                </div>

                <Button
                  variant={isTesting ? 'outline' : 'primary'}
                  size="lg"
                  className="mt-1 w-full max-w-[220px]"
                  onClick={handleStartSpeedTest}
                >
                  {isTesting ? (
                    <>
                      <Square className="!size-4" />
                      中止测速
                    </>
                  ) : (
                    <>
                      <Play className="!size-4" />
                      {speedProgress.stage === 'done' ? '重新测速' : '开始测速'}
                    </>
                  )}
                </Button>
              </div>

              {/* 右：4 项核心指标 + 两条实时波形曲线 */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="border-border/60 bg-foreground/[0.025] rounded-2xl border p-3.5">
                    <div className="text-muted-foreground text-xs">Ping 延迟</div>
                    <div className="mt-1 font-mono text-xl font-bold tabular-nums">
                      {speedProgress.pingMs !== null ? `${speedProgress.pingMs}` : '—'}
                      <span className="text-muted-foreground ml-1 text-xs font-normal">ms</span>
                    </div>
                    <div className="text-muted-foreground mt-0.5 font-mono text-[10px]">
                      {speedProgress.pingMinMs !== null
                        ? `低 ${speedProgress.pingMinMs} / 高 ${speedProgress.pingMaxMs}`
                        : '8 轮采样均值'}
                    </div>
                  </div>

                  <div className="border-border/60 bg-foreground/[0.025] rounded-2xl border p-3.5">
                    <div className="text-muted-foreground text-xs">网络抖动</div>
                    <div className="mt-1 font-mono text-xl font-bold tabular-nums">
                      {speedProgress.jitterMs !== null ? `${speedProgress.jitterMs}` : '—'}
                      <span className="text-muted-foreground ml-1 text-xs font-normal">ms</span>
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-[10px]">
                      {speedProgress.jitterMs !== null
                        ? speedProgress.jitterMs <= 10
                          ? '连接极稳'
                          : speedProgress.jitterMs <= 30
                            ? '波动正常'
                            : '存在明显抖动'
                        : '越小越稳定'}
                    </div>
                  </div>

                  <div className="border-border/60 bg-sky-500/[0.05] rounded-2xl border p-3.5">
                    <div className="flex items-center gap-1 text-xs text-sky-700 dark:text-sky-300">
                      <ArrowDown className="size-3.5" />
                      下载速率
                    </div>
                    <div className="mt-1 font-mono text-xl font-bold tabular-nums text-sky-600 dark:text-sky-400">
                      {speedProgress.downloadMbps !== null ? speedProgress.downloadMbps.toFixed(1) : '—'}
                      <span className="ml-1 text-xs font-normal opacity-80">Mbps</span>
                    </div>
                    <div className="text-muted-foreground mt-0.5 font-mono text-[10px]">
                      {speedProgress.downloadMbps !== null
                        ? `≈ ${(speedProgress.downloadMbps / 8).toFixed(2)} MB/s`
                        : '流式阶梯测速'}
                    </div>
                  </div>

                  <div className="border-border/60 bg-violet-500/[0.05] rounded-2xl border p-3.5">
                    <div className="flex items-center gap-1 text-xs text-violet-700 dark:text-violet-300">
                      <ArrowUp className="size-3.5" />
                      上传速率
                    </div>
                    <div className="mt-1 font-mono text-xl font-bold tabular-nums text-violet-600 dark:text-violet-400">
                      {speedProgress.uploadMbps !== null ? speedProgress.uploadMbps.toFixed(1) : '—'}
                      <span className="ml-1 text-xs font-normal opacity-80">Mbps</span>
                    </div>
                    <div className="text-muted-foreground mt-0.5 font-mono text-[10px]">
                      {speedProgress.uploadMbps !== null
                        ? `≈ ${(speedProgress.uploadMbps / 8).toFixed(2)} MB/s`
                        : '不可压缩载荷'}
                    </div>
                  </div>
                </div>

                {/* 两条实时速率趋势图 */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <SpeedSparkline samples={speedProgress.downloadSamples} color="#0284c7" label="下载速率" />
                  <SpeedSparkline samples={speedProgress.uploadSamples} color="#7c3aed" label="上传速率" />
                </div>

                {/* 错误提示 */}
                {speedProgress.stage === 'error' && speedProgress.error && (
                  <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-3.5 py-2.5 text-xs text-rose-600 dark:text-rose-400">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>{speedProgress.error}</span>
                  </div>
                )}

                {/* 宽带等级与场景体验解读 */}
                {networkTier && (
                  <div className="border-border/60 bg-foreground/[0.025] flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">体验评估：</span>
                      <span className={cn('font-semibold', networkTier.color)}>{networkTier.tier}</span>
                      {speedProgress.transferredBytes > 0 && (
                        <span className="text-muted-foreground ml-2 font-mono">
                          （本次消耗流量 {formatBytes(speedProgress.transferredBytes)}）
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {networkTier.badges.map((b) => (
                        <span
                          key={b.label}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                            b.ok
                              ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                              : 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
                          )}
                        >
                          {b.ok ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
                          {b.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* 出口 IP 按需查询 + 测速历史对比 */}
          <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
            {/* 按需公网出口信息 */}
            <section className="glass shadow-soft space-y-3 rounded-2xl p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Globe className="text-primary size-4" />
                  <span>公网出口与运营商（按需）</span>
                </div>
                <Button size="sm" variant="outline" disabled={loadingIp} onClick={handleFetchPublicIp}>
                  <RefreshCw className={cn('!size-3.5', loadingIp && 'animate-spin')} />
                  {publicIp ? '刷新' : '点击查询'}
                </Button>
              </div>
              {publicIp ? (
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between rounded-xl bg-foreground/[0.03] px-3 py-2">
                    <span className="text-muted-foreground">出口 IP</span>
                    <button
                      type="button"
                      onClick={() => copyText(publicIp.ip, '公网 IP')}
                      className="text-primary font-mono font-semibold hover:underline"
                    >
                      {publicIp.ip}
                    </button>
                  </div>
                  {(publicIp.country || publicIp.region || publicIp.city) && (
                    <div className="flex items-center justify-between px-3 py-1.5">
                      <span className="text-muted-foreground">参考地区</span>
                      <span className="font-medium">
                        {[publicIp.country, publicIp.region, publicIp.city].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                  )}
                  {publicIp.org && (
                    <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <span className="text-muted-foreground shrink-0">运营商 / AS</span>
                      <span className="truncate text-right font-medium">{publicIp.org}</span>
                    </div>
                  )}
                  {publicIp.colo && (
                    <div className="flex items-center justify-between px-3 py-1.5">
                      <span className="text-muted-foreground">最近测速机房</span>
                      <span className="font-mono font-medium">{publicIp.colo}</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground text-xs leading-relaxed">
                  出于隐私保护，本工具不会在打开页面时自动探测你的公网 IP。需要查看当前出口 IP 与最近测速机房时，点击右上角「点击查询」即可。
                </p>
              )}
            </section>

            {/* 测速历史对比表 */}
            <section className="glass shadow-soft space-y-3 rounded-2xl p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">本次测速对比记录（{speedHistory.length}）</div>
                {speedHistory.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setSpeedHistory([])}>
                    清空记录
                  </Button>
                )}
              </div>
              {speedHistory.length === 0 ? (
                <div className="text-muted-foreground py-6 text-center text-xs">
                  完成一次测速后将自动在此归档，方便切换 Wi-Fi / 5G / 自建节点后对比速率变化。
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs">
                    <thead className="text-muted-foreground border-b">
                      <tr>
                        <th className="py-2 pr-3 font-sans font-medium">时间</th>
                        <th className="py-2 pr-3 font-sans font-medium">节点</th>
                        <th className="py-2 pr-3 font-sans font-medium">延迟 / 抖动</th>
                        <th className="py-2 pr-3 font-sans font-medium">下载</th>
                        <th className="py-2 font-sans font-medium">上传</th>
                      </tr>
                    </thead>
                    <tbody className="divide-border/40 divide-y tabular-nums">
                      {speedHistory.map((rec) => (
                        <tr key={rec.id}>
                          <td className="py-2 pr-3">{rec.time}</td>
                          <td className="py-2 pr-3 font-sans">
                            {rec.source === 'self' ? '当前服务器' : 'Cloudflare'}
                          </td>
                          <td className="py-2 pr-3">
                            {rec.pingMs}ms <span className="text-muted-foreground">/ {rec.jitterMs}ms</span>
                          </td>
                          <td className="py-2 pr-3 font-semibold text-sky-600 dark:text-sky-400">
                            {rec.downloadMbps.toFixed(1)} Mbps
                          </td>
                          <td className="py-2 font-semibold text-violet-600 dark:text-violet-400">
                            {rec.uploadMbps.toFixed(1)} Mbps
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* ================= 视图三：浏览器能力、编解码与权限矩阵 ================= */}
      {tab === 'capabilities' && snapshot && (
        <div className="space-y-5">
          {/* 1. 音视频编解码与媒体外设 */}
          <section className="glass shadow-soft space-y-4 rounded-2xl p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Volume2 className="text-primary size-4" />
                <span>音视频编解码与媒体设备（免弹窗静默统计）</span>
              </div>
              <div className="text-muted-foreground flex flex-wrap gap-3 font-mono text-xs">
                {snapshot.media.audioSampleRate && (
                  <span>音频采样率 {snapshot.media.audioSampleRate} Hz / {snapshot.media.audioMaxChannels} 声道</span>
                )}
                <span>语音合成声音 {snapshot.media.speechVoices} 个</span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['摄像头数量', snapshot.media.cameraCount],
                ['麦克风数量', snapshot.media.micCount],
                ['扬声器 / 音频输出', snapshot.media.speakerCount],
              ].map(([label, count]) => (
                <div key={label as string} className="border-border/60 bg-foreground/[0.02] rounded-xl border px-3.5 py-2.5 text-xs">
                  <div className="text-muted-foreground">{label as string}</div>
                  <div className="mt-1 font-mono text-base font-bold">
                    {count === null ? '未开放' : `${count} 个`}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {snapshot.media.codecs.map((codec) => (
                <span
                  key={codec.label}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1 text-xs font-medium',
                    codec.supported
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-border/60 bg-foreground/[0.03] text-muted-foreground line-through opacity-70',
                  )}
                >
                  {codec.supported ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
                  {codec.label}
                </span>
              ))}
            </div>
          </section>

          {/* 2. 现代 Web API 能力矩阵 */}
          <section className="glass shadow-soft space-y-3 rounded-2xl p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Cpu className="text-primary size-4" />
                <span>浏览器现代 Web API 支持矩阵</span>
              </div>
              <span className="text-muted-foreground font-mono text-xs">
                支持 {snapshot.features.filter((f) => f.supported).length} / {snapshot.features.length} 项
              </span>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {snapshot.features.map((feat) => (
                <div
                  key={feat.name}
                  className={cn(
                    'flex items-start justify-between gap-2 rounded-xl border px-3 py-2.5 text-xs',
                    feat.supported
                      ? 'border-emerald-500/20 bg-emerald-500/[0.04]'
                      : 'border-border/60 bg-foreground/[0.02] opacity-70',
                  )}
                >
                  <div className="min-w-0">
                    <div className="font-mono font-semibold">{feat.name}</div>
                    <div className="text-muted-foreground mt-0.5 text-[11px]">{feat.desc}</div>
                  </div>
                  {feat.supported ? (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                  ) : (
                    <XCircle className="text-muted-foreground size-4 shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* 3. 当前站点隐私权限状态 */}
          <section className="glass shadow-soft space-y-3 rounded-2xl p-4 sm:p-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="text-primary size-4" />
              <span>当前站点权限状态（静默查询）</span>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {snapshot.permissions.map((p) => {
                const badgeMap = {
                  granted: { text: '已允许', cls: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' },
                  prompt: { text: '使用时询问', cls: 'bg-sky-500/12 text-sky-700 dark:text-sky-300' },
                  denied: { text: '已拒绝', cls: 'bg-rose-500/12 text-rose-700 dark:text-rose-300' },
                  unsupported: { text: '浏览器未开放查询', cls: 'bg-foreground/[0.06] text-muted-foreground' },
                }[p.state]
                return (
                  <div
                    key={p.name}
                    className="border-border/60 bg-background/50 flex items-center justify-between rounded-xl border px-3 py-2.5 text-xs"
                  >
                    <span className="font-medium">{p.label}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', badgeMap.cls)}>
                      {badgeMap.text}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
