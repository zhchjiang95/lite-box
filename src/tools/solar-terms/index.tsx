import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ChevronLeft,
  ChevronRight,
  CloudRain,
  Compass,
  Copy,
  Download,
  Flame,
  Leaf,
  Search,
  Snowflake,
  Sparkles,
  Sun,
  Utensils,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { downloadBlob } from '@/lib/file'
import { cn } from '@/lib/utils'
import {
  buildSolarTermsIcs,
  buildSolarTermsMarkdown,
  buildYearSolarTermsData,
  formatShortMd,
  getLiveSolarStatus,
  SEASON_META,
  type SeasonId,
  type SolarTermInfo,
} from './engine'

type ViewTab = 'wheel' | 'phenology' | 'cycles'

const SEASON_ORDER: SeasonId[] = ['spring', 'summer', 'autumn', 'winter']
const QUICK_YEARS = [2025, 2026, 2027]

/** 格式化毫秒倒计时为 天 / 时 / 分 / 秒 */
function formatCountdownParts(diffMs: number) {
  const secTotal = Math.max(0, Math.floor(diffMs / 1000))
  const days = Math.floor(secTotal / 86400)
  const hours = Math.floor((secTotal % 86400) / 3600)
  const minutes = Math.floor((secTotal % 3600) / 60)
  const seconds = secTotal % 60
  return { days, hours, minutes, seconds }
}

/** 交互式东方美学 SVG 二十四节气黄道星盘 */
function SolarTermWheel({
  terms,
  selectedName,
  currentName,
  onSelect,
}: {
  terms: SolarTermInfo[]
  selectedName: string
  currentName: string
  onSelect: (term: SolarTermInfo) => void
}) {
  // 按立春（315°）起排或按黄经 0°（春分在正东/右侧，夏至在正南/底部，秋分在正西/左侧，冬至在正北/顶部）排布
  // 这里采用直觉顺时针时钟布局：立春在左上（-60°），春分在正左/或冬至在正上（12点钟方向）顺时针走一年！
  const cx = 170
  const cy = 170
  const outerR = 148
  const labelR = 123
  const dotR = 96

  // 冬至放正上方 (-90°)，每节气顺时针 +15°（冬至=-90°, 小寒=-75°, 立春=-45°, 春分=0°正右, 夏至=90°正下, 秋分=180°正左）
  const angleForTerm = (t: SolarTermInfo) => ((t.longitudeDeg - 270 + 360) % 360) - 90
  const selected = terms.find((t) => t.name === selectedName) ?? terms[0]
  const selAngleRad = (angleForTerm(selected) * Math.PI) / 180

  const seasonArcs: { id: SeasonId; startDeg: number; endDeg: number }[] = [
    { id: 'winter', startDeg: -97.5, endDeg: -7.5 },
    { id: 'spring', startDeg: -7.5, endDeg: 82.5 },
    { id: 'summer', startDeg: 82.5, endDeg: 172.5 },
    { id: 'autumn', startDeg: 172.5, endDeg: 262.5 },
  ]

  const arcPath = (r: number, startDeg: number, endDeg: number) => {
    const a1 = (startDeg * Math.PI) / 180
    const a2 = (endDeg * Math.PI) / 180
    const x1 = cx + r * Math.cos(a1)
    const y1 = cy + r * Math.sin(a1)
    const x2 = cx + r * Math.cos(a2)
    const y2 = cy + r * Math.sin(a2)
    return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`
  }

  return (
    <div className="relative mx-auto w-full max-w-[350px] select-none">
      <svg viewBox="0 0 340 340" className="h-auto w-full overflow-visible">
        {/* 四季外环彩色弧线 */}
        {seasonArcs.map((arc) => (
          <path
            key={arc.id}
            d={arcPath(outerR, arc.startDeg, arc.endDeg)}
            fill="none"
            stroke={SEASON_META[arc.id].color}
            strokeOpacity="0.28"
            strokeWidth="12"
            strokeLinecap="butt"
          />
        ))}

        {/* 内刻度虚线环 */}
        <circle
          cx={cx}
          cy={cy}
          r={dotR}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.12"
          strokeWidth="1"
          strokeDasharray="3 4"
        />

        {/* 动态指向选中节气的指针 */}
        <line
          x1={cx}
          y1={cy}
          x2={cx + (dotR - 8) * Math.cos(selAngleRad)}
          y2={cy + (dotR - 8) * Math.sin(selAngleRad)}
          stroke={SEASON_META[selected.season].color}
          strokeWidth="2.5"
          strokeLinecap="round"
          className="transition-all duration-300"
        />

        {/* 24 个可点击节气节点与文字 */}
        {terms.map((t) => {
          const deg = angleForTerm(t)
          const rad = (deg * Math.PI) / 180
          const dx = cx + dotR * Math.cos(rad)
          const dy = cy + dotR * Math.sin(rad)
          const lx = cx + labelR * Math.cos(rad)
          const ly = cy + labelR * Math.sin(rad)
          const isSelected = t.name === selected.name
          const isCurrent = t.name === currentName
          const color = SEASON_META[t.season].color

          return (
            <g key={t.name} onClick={() => onSelect(t)} className="cursor-pointer">
              <circle
                cx={dx}
                cy={dy}
                r={isSelected ? 5.5 : isCurrent ? 4.5 : 3}
                fill={isSelected || isCurrent ? color : 'currentColor'}
                fillOpacity={isSelected || isCurrent ? 1 : 0.25}
                className="transition-all"
              />
              {isCurrent && !isSelected && (
                <circle cx={dx} cy={dy} r={8.5} fill="none" stroke={color} strokeOpacity="0.5" strokeWidth="1.5" />
              )}
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={isSelected ? color : 'currentColor'}
                fillOpacity={isSelected ? 1 : isCurrent ? 0.95 : 0.65}
                fontSize={isSelected ? '11.5' : '9.5'}
                fontWeight={isSelected || isCurrent ? '700' : '500'}
                className="transition-all hover:opacity-100"
              >
                {t.name}
              </text>
            </g>
          )
        })}

        {/* 中心圆徽章 */}
        <circle
          cx={cx}
          cy={cy}
          r={52}
          className="fill-card-solid stroke-border"
          strokeWidth="1.5"
        />
        <text
          x={cx}
          y={cy - 14}
          textAnchor="middle"
          fill={SEASON_META[selected.season].color}
          fontSize="10"
          fontWeight="600"
        >
          {SEASON_META[selected.season].name} · {selected.kind}
        </text>
        <text
          x={cx}
          y={cy + 6}
          textAnchor="middle"
          className="fill-foreground"
          fontSize="21"
          fontWeight="800"
        >
          {selected.name}
        </text>
        <text
          x={cx}
          y={cy + 26}
          textAnchor="middle"
          className="fill-muted-foreground font-mono"
          fontSize="10"
        >
          黄经 {selected.longitudeDeg}°
        </text>
      </svg>
    </div>
  )
}

export default function SolarTermsTool() {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const liveStatus = useMemo(() => getLiveSolarStatus(new Date()), [])
  const [year, setYear] = useState<number>(() => new Date().getFullYear())
  const [tab, setTab] = useState<ViewTab>('wheel')
  const [selectedName, setSelectedName] = useState<string>(liveStatus.currentTermName)
  const [phenQuery, setPhenQuery] = useState('')

  // 每秒更新一次下一节气倒计时
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const yearData = useMemo(() => buildYearSolarTermsData(year), [year])
  const selectedTerm = useMemo(
    () => yearData.terms.find((t) => t.name === selectedName) ?? yearData.terms[0],
    [yearData.terms, selectedName],
  )

  const countdown = useMemo(
    () => formatCountdownParts(liveStatus.nextTerm.timestampMs - nowMs),
    [liveStatus.nextTerm.timestampMs, nowMs],
  )

  // 按春/夏/秋/冬四时分组的 24 节气（每季 6 个，顺序为立春→谷雨、立夏→大暑、立秋→霜降、立冬→大寒）
  const termsBySeason = useMemo(() => {
    const map: Record<SeasonId, SolarTermInfo[]> = { spring: [], summer: [], autumn: [], winter: [] }
    for (const t of yearData.terms) {
      map[t.season].push(t)
    }
    // 冬季内按立冬、小雪、大雪、冬至、小寒、大寒排布更符合传统感知，或保留公历顺序；这里按传统四时顺序排序
    const winterOrder = ['立冬', '小雪', '大雪', '冬至', '小寒', '大寒']
    map.winter.sort((a, b) => winterOrder.indexOf(a.name) - winterOrder.indexOf(b.name))
    return map
  }, [yearData.terms])

  // 七十二候展平列表（支持关键词筛选）
  const allPhenologies = useMemo(() => {
    const q = phenQuery.trim().toLowerCase()
    const list = yearData.terms.flatMap((t) =>
      t.phenologies.map((p) => ({
        ...p,
        termName: t.name,
        season: t.season,
        isCurrent: year === new Date().getFullYear() && p.name === liveStatus.currentPhenologyName,
      })),
    )
    if (!q) return list
    return list.filter((it) => it.name.toLowerCase().includes(q) || it.termName.toLowerCase().includes(q))
  }, [yearData.terms, phenQuery, year, liveStatus.currentPhenologyName])

  const handleDownloadIcs = () => {
    const ics = buildSolarTermsIcs(yearData)
    downloadBlob(new Blob([ics], { type: 'text/calendar;charset=utf-8' }), `${year}年二十四节气.ics`)
    toast.success(`已导出 ${year} 年二十四节气 .ics 日历`)
  }

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(buildSolarTermsMarkdown(yearData))
      toast.success(`已复制 ${year} 年二十四节气与七十二候 Markdown 表`)
    } catch {
      toast.error('复制失败，请手动复制')
    }
  }

  const dogTotalDays = yearData.dogDays.reduce((s, d) => s + d.days, 0)

  return (
    <div className="space-y-5">
      {/* ================= 顶部 Hero：今日时令 + 下一节气精确到秒倒计时 ================= */}
      <section className="glass shadow-soft rounded-3xl p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          {/* 左：当前时令与秒级交节倒计时 */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="bg-primary/12 text-primary inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold">
                <Sun className="size-3.5" />
                当前：{liveStatus.currentTermName} 第 {liveStatus.currentTermDay} 天
              </span>
              <span className="bg-foreground/[0.06] text-foreground/85 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-medium">
                <Leaf className="size-3.5 text-emerald-500" />
                物候：{liveStatus.currentPhenologyName}（第 {liveStatus.currentPhenologyDay} 天）
              </span>
              {liveStatus.activeSpecialBadge && (
                <span className="rounded-full bg-sky-500/12 px-2.5 py-0.5 font-semibold text-sky-700 dark:text-sky-300">
                  {liveStatus.activeSpecialBadge}
                </span>
              )}
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-muted-foreground text-sm">距下一节气</span>
                <button
                  type="button"
                  onClick={() => setSelectedName(liveStatus.nextTerm.name)}
                  className="text-primary text-lg font-bold hover:underline"
                >
                  {liveStatus.nextTerm.name}
                </button>
                <span className="text-muted-foreground font-mono text-xs">
                  （精确交节：{liveStatus.nextTerm.exactTime}）
                </span>
              </div>

              <div className="flex flex-wrap items-baseline gap-2 font-mono">
                {[
                  [countdown.days, '天'],
                  [countdown.hours, '时'],
                  [countdown.minutes, '分'],
                  [countdown.seconds, '秒'],
                ].map(([val, unit]) => (
                  <span key={unit as string} className="inline-flex items-baseline gap-0.5">
                    <span className="text-2xl font-extrabold tabular-nums sm:text-3xl">
                      {String(val).padStart(2, '0')}
                    </span>
                    <span className="text-muted-foreground font-sans text-xs">{unit}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* 右：百年年份切换与导出 */}
          <div className="flex flex-col items-start gap-2.5 lg:items-end">
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="icon"
                variant="outline"
                className="size-8"
                disabled={year <= 1900}
                onClick={() => setYear((y) => Math.max(1900, y - 1))}
                title="上一年"
              >
                <ChevronLeft className="size-4" />
              </Button>
              {QUICK_YEARS.map((qy) => (
                <button
                  key={qy}
                  type="button"
                  onClick={() => setYear(qy)}
                  className={cn(
                    'h-8 rounded-xl px-3 font-mono text-xs font-semibold transition',
                    year === qy
                      ? 'bg-primary text-primary-foreground shadow-xs'
                      : 'bg-foreground/[0.05] text-muted-foreground hover:text-foreground',
                  )}
                >
                  {qy}
                </button>
              ))}
              <input
                type="number"
                min={1900}
                max={2100}
                value={year}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (Number.isFinite(n) && n >= 1900 && n <= 2100) setYear(n)
                }}
                aria-label="自定义查询年份"
                className="border-border/70 bg-background/70 h-8 w-20 rounded-xl border px-2 text-center font-mono text-xs font-semibold outline-none"
              />
              <Button
                size="icon"
                variant="outline"
                className="size-8"
                disabled={year >= 2100}
                onClick={() => setYear((y) => Math.min(2100, y + 1))}
                title="下一年"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleCopyMarkdown}>
                <Copy className="!size-3.5" />
                复制时刻表
              </Button>
              <Button size="sm" variant="primary" onClick={handleDownloadIcs}>
                <Download className="!size-3.5" />
                导出 {year} 年 .ics
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ================= 视图切换 ================= */}
      <Segmented<ViewTab>
        value={tab}
        onChange={setTab}
        className="max-w-lg"
        options={[
          { value: 'wheel', label: '节气星盘与全览', icon: <Compass /> },
          { value: 'phenology', label: '七十二候全表', icon: <Leaf /> },
          { value: 'cycles', label: '数九 · 三伏 · 梅雨', icon: <Flame /> },
        ]}
      />

      {/* ================= 视图一：节气星盘 + 深度详情 + 四时全览 ================= */}
      {tab === 'wheel' && (
        <div className="space-y-5">
          <div className="grid items-center gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
            {/* 左：交互式 SVG 黄道星盘 */}
            <section className="glass shadow-soft flex flex-col items-center justify-center gap-2 rounded-2xl p-5">
              <SolarTermWheel
                terms={yearData.terms}
                selectedName={selectedTerm.name}
                currentName={year === new Date().getFullYear() ? liveStatus.currentTermName : ''}
                onSelect={(t) => setSelectedName(t.name)}
              />
              <p className="text-muted-foreground text-[11px]">点击圆盘任意节气节点查看精确交节时刻与三候民俗</p>
            </section>

            {/* 右：选中节气深度卡片 */}
            <section className="glass shadow-soft flex h-full flex-col justify-between gap-4 rounded-2xl p-5 sm:p-6">
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-2xl font-extrabold tracking-tight">{selectedTerm.name}</h3>
                      <span
                        className={cn(
                          'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                          SEASON_META[selectedTerm.season].bgCls,
                          SEASON_META[selectedTerm.season].textCls,
                        )}
                      >
                        {SEASON_META[selectedTerm.season].name} · {selectedTerm.kind}
                      </span>
                      <span className="bg-foreground/[0.06] text-muted-foreground rounded-full px-2.5 py-0.5 font-mono text-xs">
                        黄经 {selectedTerm.longitudeDeg}°
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-1 text-sm">{selectedTerm.lore.tagline}</p>
                  </div>

                  <div className="bg-foreground/[0.03] rounded-xl px-3.5 py-2 text-right font-mono text-xs">
                    <div className="text-foreground font-bold">{selectedTerm.exactTime}</div>
                    <div className="text-muted-foreground mt-0.5 font-sans">
                      星期{selectedTerm.weekLabel} · 农历{selectedTerm.lunarText}
                    </div>
                  </div>
                </div>

                {/* 古诗引文 */}
                <blockquote className="border-primary/40 bg-primary/[0.04] rounded-r-xl border-l-3 px-4 py-2.5 text-sm italic">
                  「{selectedTerm.lore.poem}」
                </blockquote>

                {/* 三候物候卡片 */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold">本节气三候（每候约 5 日）</div>
                  <div className="grid gap-2.5 sm:grid-cols-3">
                    {selectedTerm.phenologies.map((p) => (
                      <div key={p.name} className="border-border/60 bg-background/50 rounded-xl border p-3">
                        <div className="text-muted-foreground text-[11px]">{p.orderLabel}</div>
                        <div className="mt-0.5 text-sm font-bold">{p.name}</div>
                        <div className="text-muted-foreground mt-1 font-mono text-[11px]">
                          {formatShortMd(p.startYmd)} – {formatShortMd(p.endYmd)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* 民俗与食养 */}
              <div className="grid gap-3 border-t pt-4 sm:grid-cols-2">
                <div className="bg-foreground/[0.025] rounded-xl p-3 text-xs">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold">
                    <Sparkles className="size-3.5 text-amber-500" />
                    传统习俗
                  </div>
                  <p className="text-muted-foreground leading-relaxed">{selectedTerm.lore.customs}</p>
                </div>
                <div className="bg-foreground/[0.025] rounded-xl p-3 text-xs">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold">
                    <Utensils className="size-3.5 text-emerald-500" />
                    应季风物与食养
                  </div>
                  <p className="text-muted-foreground leading-relaxed">{selectedTerm.lore.foods}</p>
                </div>
              </div>
            </section>
          </div>

          {/* 下方：春/夏/秋/冬 四时 24 节气全览网格 */}
          <div className="space-y-4">
            {SEASON_ORDER.map((seasonId) => {
              const sm = SEASON_META[seasonId]
              const list = termsBySeason[seasonId]
              return (
                <section key={seasonId} className="glass shadow-soft space-y-3 rounded-2xl p-4 sm:p-5">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: sm.color }} />
                    <span>{sm.name}六节气</span>
                  </div>
                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                    {list.map((t) => {
                      const active = t.name === selectedTerm.name
                      const isCurrent = year === new Date().getFullYear() && t.name === liveStatus.currentTermName
                      return (
                        <button
                          key={t.name}
                          type="button"
                          onClick={() => setSelectedName(t.name)}
                          className={cn(
                            'border-border/60 bg-background/50 hover:border-primary/50 relative flex flex-col items-start rounded-xl border p-3 text-left transition',
                            active && cn('ring-2', sm.ringCls, sm.bgCls),
                          )}
                        >
                          <div className="flex w-full items-center justify-between">
                            <span className="text-sm font-bold">{t.name}</span>
                            {isCurrent && (
                              <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[9px] font-bold">
                                当前
                              </span>
                            )}
                          </div>
                          <div className="mt-1 font-mono text-xs font-medium">{formatShortMd(t.ymd)}</div>
                          <div className="text-muted-foreground font-mono text-[10px]">{t.exactTime.slice(11)}</div>
                          <div className="text-muted-foreground mt-1 text-[10px]">农历{t.lunarText}</div>
                        </button>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      )}

      {/* ================= 视图二：七十二候物候全表 ================= */}
      {tab === 'phenology' && (
        <section className="glass shadow-soft space-y-4 rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">{year} 年七十二候物候全表</h3>
              <p className="text-muted-foreground text-xs">五日为一候，三候为一气，记录全年自然草木虫鸟变迁</p>
            </div>
            <div className="relative w-full max-w-xs">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
              <input
                type="text"
                value={phenQuery}
                onChange={(e) => setPhenQuery(e.target.value)}
                placeholder="搜索物候或节气名（如 桃始华、小雪…）"
                className="border-border/70 bg-background/60 focus:border-primary w-full rounded-xl border py-1.5 pr-3 pl-8 text-xs outline-none"
              />
            </div>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {allPhenologies.map((p, idx) => {
              const sm = SEASON_META[p.season]
              return (
                <div
                  key={`${p.termName}-${p.name}-${idx}`}
                  className={cn(
                    'border-border/60 bg-background/45 flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs',
                    p.isCurrent && 'border-primary bg-primary/[0.06] ring-primary/25 ring-1',
                  )}
                >
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold">{p.name}</span>
                      {p.isCurrent && (
                        <span className="bg-primary text-primary-foreground rounded px-1 py-0.5 text-[9px]">当前</span>
                      )}
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-[11px]">
                      <span className={sm.textCls}>{p.termName}</span> · {p.orderLabel}
                    </div>
                  </div>
                  <div className="text-muted-foreground shrink-0 text-right font-mono text-[11px]">
                    <div>{formatShortMd(p.startYmd)}</div>
                    <div>至 {formatShortMd(p.endYmd)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ================= 视图三：数九 · 三伏 · 梅雨周期时间轴 ================= */}
      {tab === 'cycles' && (
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            {/* 1. 三伏天 */}
            <section className="glass shadow-soft space-y-4 rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <Flame className="size-4 text-rose-500" />
                  <span>{year} 年三伏天时间表</span>
                </div>
                <span className="rounded-full bg-rose-500/12 px-2.5 py-0.5 font-mono text-xs font-semibold text-rose-600 dark:text-rose-400">
                  共 {dogTotalDays} 天
                </span>
              </div>

              <div className="space-y-2.5">
                {yearData.dogDays.map((d) => (
                  <div key={d.name} className="border-border/60 bg-background/50 rounded-xl border p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-rose-600 dark:text-rose-400">{d.name}</span>
                      <span className="font-mono text-xs font-semibold">{d.days} 天</span>
                    </div>
                    <div className="mt-1 font-mono text-xs">
                      {d.startYmd} 至 {d.endYmd}
                    </div>
                    {d.note && <div className="text-muted-foreground mt-1 text-[11px]">{d.note}</div>}
                  </div>
                ))}
              </div>
            </section>

            {/* 2. 梅雨季 */}
            <section className="glass shadow-soft flex flex-col justify-between gap-4 rounded-2xl p-5">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <CloudRain className="size-4 text-sky-500" />
                    <span>{year} 年传统历法梅雨季</span>
                  </div>
                  {yearData.plumRain && (
                    <span className="rounded-full bg-sky-500/12 px-2.5 py-0.5 font-mono text-xs font-semibold text-sky-700 dark:text-sky-300">
                      共 {yearData.plumRain.days} 天
                    </span>
                  )}
                </div>

                {yearData.plumRain ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="border-border/60 bg-background/50 rounded-xl border p-4">
                      <div className="text-muted-foreground text-xs">入梅日期</div>
                      <div className="mt-1 font-mono text-lg font-bold text-sky-600 dark:text-sky-400">
                        {yearData.plumRain.startYmd}
                      </div>
                      <div className="text-muted-foreground mt-1 text-[11px]">芒种后首个丙日入梅</div>
                    </div>
                    <div className="border-border/60 bg-background/50 rounded-xl border p-4">
                      <div className="text-muted-foreground text-xs">出梅日期</div>
                      <div className="mt-1 font-mono text-lg font-bold text-emerald-600 dark:text-emerald-400">
                        {yearData.plumRain.endYmd}
                      </div>
                      <div className="text-muted-foreground mt-1 text-[11px]">小暑后首个未日出梅</div>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs">暂无该年梅雨区间数据</p>
                )}
              </div>

              <div className="bg-foreground/[0.03] text-muted-foreground rounded-xl p-3.5 text-xs leading-relaxed">
                注：历法入梅与出梅按传统干支算法（芒种逢丙入梅、小暑逢未出梅）推算，气象部门每年实际宣布的梅雨期会依副热带高压实况有所浮动。
              </div>
            </section>
          </div>

          {/* 3. 数九寒天（跨年完整呈现） */}
          <section className="glass shadow-soft space-y-4 rounded-2xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Snowflake className="size-4 text-sky-500" />
                <span>{year} 年数九寒天时间表（冬至起九，每九 9 天）</span>
              </div>
              <span className="text-muted-foreground text-xs">含年初延续（{year - 1} 冬至启）与年末新启（{year} 冬至启）</span>
            </div>

            {yearData.nineSpansEarly.length > 0 && (
              <div className="space-y-2">
                <div className="text-muted-foreground text-xs font-semibold">{year} 年初（承接 {year - 1} 年冬至数九）</div>
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {yearData.nineSpansEarly.map((n) => (
                    <div key={`e-${n.name}`} className="border-border/60 bg-background/50 rounded-xl border p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sky-600 dark:text-sky-400">{n.name}</span>
                        <span className="font-mono text-[11px]">
                          {formatShortMd(n.startYmd)} – {formatShortMd(n.endYmd)}
                        </span>
                      </div>
                      {n.note && <div className="text-muted-foreground mt-1 text-[11px]">{n.note}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {yearData.nineSpansLate.length > 0 && (
              <div className="space-y-2 border-t pt-4">
                <div className="text-muted-foreground text-xs font-semibold">{year} 年末（{year} 年冬至新启数九）</div>
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {yearData.nineSpansLate.map((n) => (
                    <div key={`l-${n.name}`} className="border-border/60 bg-background/50 rounded-xl border p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sky-600 dark:text-sky-400">{n.name}</span>
                        <span className="font-mono text-[11px]">
                          {formatShortMd(n.startYmd)} – {formatShortMd(n.endYmd)}
                        </span>
                      </div>
                      {n.note && <div className="text-muted-foreground mt-1 text-[11px]">{n.note}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
