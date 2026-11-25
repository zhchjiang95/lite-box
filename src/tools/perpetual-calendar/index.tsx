import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowRightLeft,
  Cake,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  Copy,
  Download,
  Filter,
  Moon,
  RotateCcw,
  Sparkles,
  Star,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { downloadBlob } from '@/lib/file'
import { cn } from '@/lib/utils'
import {
  AUSPICIOUS_PRESETS,
  buildDayAlmanacMarkdown,
  buildLunarBirthdayIcs,
  buildMonthGrid,
  getDayAlmanac,
  getLunarMonthOptions,
  getSolarDayCount,
  julianDayToSolarYmd,
  LUNAR_DAY_NAMES,
  LUNAR_MONTH_NAMES,
  lunarToSolarYmd,
  queryLunarBirthdayMatches,
  type WeekStart,
} from './engine'

type MainTab = 'calendar' | 'converter' | 'birthday'

const YEAR_OPTIONS = Array.from({ length: 201 }, (_, i) => 1900 + i)
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1)

/** 精致 SVG 月相小图（用于黄历详情卡头） */
function MiniMoonPhase({ cycleProgress, size = 48 }: { cycleProgress: number; size?: number }) {
  const r = 18
  const cx = 24
  const cy = 24
  const p = ((cycleProgress % 1) + 1) % 1
  const rx = Math.abs(Math.cos(p * 2 * Math.PI)) * r

  let litPath = ''
  if (p < 0.015 || p > 0.985) {
    litPath = ''
  } else if (Math.abs(p - 0.5) < 0.015) {
    litPath = `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`
  } else if (p < 0.5) {
    const sweep = p < 0.25 ? 0 : 1
    litPath = `M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx} ${cy + r} A ${rx.toFixed(2)} ${r} 0 0 ${sweep} ${cx} ${cy - r} Z`
  } else {
    const sweep = p < 0.75 ? 0 : 1
    litPath = `M ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx} ${cy + r} A ${rx.toFixed(2)} ${r} 0 0 ${sweep} ${cx} ${cy - r} Z`
  }

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className="shrink-0" aria-label="月相">
      <defs>
        <radialGradient id="pc-moon-lit" cx="35%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#fef9c3" />
          <stop offset="60%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#f59e0b" />
        </radialGradient>
        <radialGradient id="pc-moon-dark" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#334155" />
          <stop offset="100%" stopColor="#0f172a" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill="url(#pc-moon-dark)" />
      {litPath && <path d={litPath} fill="url(#pc-moon-lit)" />}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#fde68a" strokeOpacity="0.3" strokeWidth="1" />
    </svg>
  )
}

function getNowYmd() {
  const now = new Date()
  return {
    year: Math.min(2100, Math.max(1900, now.getFullYear())),
    month: now.getMonth() + 1,
    day: now.getDate(),
  }
}

function formatDiffLabel(diff: number): string {
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === -1) return '昨天'
  return diff > 0 ? `${diff} 天后` : `${Math.abs(diff)} 天前`
}

export default function PerpetualCalendarTool() {
  const initial = useMemo(() => getNowYmd(), [])

  // 主导航标签
  const [activeTab, setActiveTab] = useState<MainTab>('calendar')

  // 万年历浏览年月 & 选中日期
  const [viewYear, setViewYear] = useState(initial.year)
  const [viewMonth, setViewMonth] = useState(initial.month)
  const [selectedDate, setSelectedDate] = useState(initial)
  const [weekStart, setWeekStart] = useState<WeekStart>('mon')
  const [auspiciousTaboo, setAuspiciousTaboo] = useState<string | null>(null)
  const [activeHourIndex, setActiveHourIndex] = useState<number>(() => {
    const h = new Date().getHours()
    return h === 23 ? 0 : Math.floor((h + 1) / 2)
  })

  // 儒略日互转输入框状态
  const [jdInput, setJdInput] = useState<string>('')

  // 农历生日查公历状态
  const [bdayMonth, setBdayMonth] = useState<number>(8)
  const [bdayDay, setBdayDay] = useState<number>(15)
  const [bdayIsLeap, setBdayIsLeap] = useState<boolean>(false)
  const [bdayStartYear, setBdayStartYear] = useState<number>(initial.year)
  const [bdayCount, setBdayCount] = useState<number>(10)
  const [bdayTitle, setBdayTitle] = useState<string>('农历生日')

  // 计算整月网格与当日详尽黄历
  const monthCells = useMemo(
    () => buildMonthGrid(viewYear, viewMonth, weekStart, auspiciousTaboo),
    [viewYear, viewMonth, weekStart, auspiciousTaboo],
  )

  const detail = useMemo(
    () => getDayAlmanac(selectedDate.year, selectedDate.month, selectedDate.day),
    [selectedDate.year, selectedDate.month, selectedDate.day],
  )

  const monthAuspiciousCount = useMemo(
    () => monthCells.filter((c) => c.isCurrentMonth && c.matchesAuspicious).length,
    [monthCells],
  )

  // 多历法互转所需的公/农历下拉选项
  const convSolarDays = useMemo(
    () => Array.from({ length: getSolarDayCount(selectedDate.year, selectedDate.month) }, (_, i) => i + 1),
    [selectedDate.year, selectedDate.month],
  )

  const convLunarMonths = useMemo(() => getLunarMonthOptions(detail.lunarYear), [detail.lunarYear])
  const activeConvLunarMonth = useMemo(
    () => convLunarMonths.find((m) => m.monthWithLeap === detail.lunarMonthWithLeap) ?? convLunarMonths[0],
    [convLunarMonths, detail.lunarMonthWithLeap],
  )
  const convLunarDays = useMemo(
    () => Array.from({ length: activeConvLunarMonth?.dayCount ?? 30 }, (_, i) => i + 1),
    [activeConvLunarMonth],
  )

  // 农历生日查询结果
  const birthdayResults = useMemo(
    () => queryLunarBirthdayMatches(bdayMonth, bdayDay, bdayIsLeap, bdayStartYear, bdayCount),
    [bdayMonth, bdayDay, bdayIsLeap, bdayStartYear, bdayCount],
  )

  const weekHeaders =
    weekStart === 'mon'
      ? ['一', '二', '三', '四', '五', '六', '日']
      : ['日', '一', '二', '三', '四', '五', '六']

  const jumpToDate = (y: number, m: number, d: number, switchToCalendar = false) => {
    const safeY = Math.min(2100, Math.max(1900, y))
    const safeM = Math.min(12, Math.max(1, m))
    const safeD = Math.min(getSolarDayCount(safeY, safeM), Math.max(1, d))
    setSelectedDate({ year: safeY, month: safeM, day: safeD })
    setViewYear(safeY)
    setViewMonth(safeM)
    if (switchToCalendar) setActiveTab('calendar')
  }

  const stepMonth = (delta: number) => {
    let nextM = viewMonth + delta
    let nextY = viewYear
    if (nextM < 1) {
      nextM = 12
      nextY -= 1
    } else if (nextM > 12) {
      nextM = 1
      nextY += 1
    }
    if (nextY < 1900 || nextY > 2100) return
    setViewYear(nextY)
    setViewMonth(nextM)
  }

  const handleGoToday = () => {
    const now = getNowYmd()
    jumpToDate(now.year, now.month, now.day)
    toast.success('已定位到今日')
  }

  const handleApplyJd = () => {
    const num = Number(jdInput.trim())
    const converted = julianDayToSolarYmd(num)
    if (!converted) {
      toast.error('请输入有效的儒略日数值（约 2415020 – 2488435，对应 1900–2100 年）')
      return
    }
    jumpToDate(converted.year, converted.month, converted.day)
    toast.success(`儒略日 JD ${num} 已换算为 ${converted.year}-${String(converted.month).padStart(2, '0')}-${String(converted.day).padStart(2, '0')}`)
  }

  const handleCopyAlmanac = async () => {
    try {
      await navigator.clipboard.writeText(buildDayAlmanacMarkdown(detail))
      toast.success('已复制当日黄历 Markdown 摘要')
    } catch {
      toast.error('复制失败，请检查剪贴板权限')
    }
  }

  const handleCopyBirthdayTable = async () => {
    const lines = [
      `# ${bdayTitle || '农历生日'}（农历${bdayIsLeap ? '闰' : ''}${LUNAR_MONTH_NAMES[bdayMonth - 1]}${LUNAR_DAY_NAMES[bdayDay - 1]}）公历对照表`,
      '',
      '| 农历年份 | 农历日期 | 对应公历 | 星期 | 距今 |',
      '| --- | --- | :---: | :---: | :---: |',
      ...birthdayResults.map(
        (r) =>
          `| ${r.lunarYear} ${r.lunarYearGanZhi}(${r.zodiac})年 | ${r.lunarDateText}${r.fallbackToNormalMonth ? '（无闰月取平月）' : ''} | ${r.solarYmd} | ${r.weekday} | ${formatDiffLabel(r.diffFromToday)} |`,
      ),
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      toast.success('已复制未来公历对照表 Markdown')
    } catch {
      toast.error('复制失败')
    }
  }

  const handleExportBirthdayIcs = () => {
    const ics = buildLunarBirthdayIcs(bdayTitle, birthdayResults)
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
    const fileLabel = `${bdayTitle.trim() || 'lunar-birthday'}-${bdayStartYear}-${bdayCount}y.ics`
    downloadBlob(blob, fileLabel)
    toast.success(`已导出 ${birthdayResults.length} 年日历提醒文件`)
  }

  const activeHour = detail.hours[activeHourIndex] ?? detail.hours[0]

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 pb-10">
      {/* 顶部模式切换栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={activeTab}
          onChange={(v) => setActiveTab(v as MainTab)}
          options={[
            { value: 'calendar', label: '万年历与黄历' },
            { value: 'converter', label: '多历法互转' },
            { value: 'birthday', label: '农历生日查公历' },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden sm:inline">
            当前选中：<strong className="font-mono text-foreground">{detail.ymd}</strong>（
            {detail.lunarDateText}）
          </span>
          <Button variant="ghost" size="sm" onClick={handleGoToday} className="h-8 text-xs">
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            回到今天
          </Button>
          <Button variant="secondary" size="sm" onClick={handleCopyAlmanac} className="h-8 text-xs">
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            复制黄历
          </Button>
        </div>
      </div>

      {/* ==================== 视图 1：万年历与传统黄历（双栏） ==================== */}
      {activeTab === 'calendar' && (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1.35fr_1fr]">
          {/* 左栏：全月视图 */}
          <section className="flex flex-col gap-4 rounded-2xl border border-border/75 bg-card/85 p-4 shadow-sm backdrop-blur-md sm:p-5">
            {/* 月份控制工具栏 */}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => stepMonth(-1)}
                  aria-label="上一个月"
                  className="h-9 w-9 p-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <select
                  aria-label="选择年份"
                  value={viewYear}
                  onChange={(e) => setViewYear(Number(e.target.value))}
                  className="h-9 rounded-xl border border-border/80 bg-background/85 px-2.5 text-sm font-semibold outline-none focus:border-primary"
                >
                  {YEAR_OPTIONS.map((y) => (
                    <option key={y} value={y}>
                      {y} 年
                    </option>
                  ))}
                </select>
                <select
                  aria-label="选择月份"
                  value={viewMonth}
                  onChange={(e) => setViewMonth(Number(e.target.value))}
                  className="h-9 rounded-xl border border-border/80 bg-background/85 px-2.5 text-sm font-semibold outline-none focus:border-primary"
                >
                  {MONTH_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m} 月
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => stepMonth(1)}
                  aria-label="下一个月"
                  className="h-9 w-9 p-0"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Segmented
                  size="sm"
                  value={weekStart}
                  onChange={(v) => setWeekStart(v as WeekStart)}
                  options={[
                    { value: 'mon', label: '周一起' },
                    { value: 'sun', label: '周日起' },
                  ]}
                />
              </div>
            </div>

            {/* 择日吉日快捷筛选条 */}
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border/60 bg-muted/25 px-3 py-2">
              <span className="mr-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <Filter className="h-3 w-3 text-primary" />
                择日高亮：
              </span>
              <button
                type="button"
                onClick={() => setAuspiciousTaboo(null)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-[11px] transition-colors',
                  auspiciousTaboo === null
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                全部
              </button>
              {AUSPICIOUS_PRESETS.map((item) => {
                const active = auspiciousTaboo === item.taboo
                return (
                  <button
                    key={item.taboo}
                    type="button"
                    onClick={() => setAuspiciousTaboo(active ? null : item.taboo)}
                    className={cn(
                      'rounded-md px-2 py-0.5 text-[11px] transition-colors',
                      active
                        ? 'bg-emerald-600 text-white font-semibold shadow-xs'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {item.label}
                  </button>
                )
              })}
              {auspiciousTaboo && (
                <span className="ml-auto text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  本月宜「{auspiciousTaboo}」共 {monthAuspiciousCount} 天
                </span>
              )}
            </div>

            {/* 星期标题行 */}
            <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-semibold text-muted-foreground">
              {weekHeaders.map((w) => {
                const isWeekendHeader = w === '六' || w === '日'
                return (
                  <div
                    key={w}
                    className={cn('py-1', isWeekendHeader && 'text-rose-500/85 dark:text-rose-400')}
                  >
                    周{w}
                  </div>
                )
              })}
            </div>

            {/* 6×7 日历主体网格 */}
            <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
              {monthCells.map((cell) => {
                const isSelected = cell.ymd === detail.ymd
                return (
                  <button
                    key={cell.ymd}
                    type="button"
                    onClick={() => jumpToDate(cell.year, cell.month, cell.day)}
                    className={cn(
                      'group relative flex min-h-[64px] flex-col items-center justify-center rounded-xl border p-1.5 text-center transition-all sm:min-h-[76px] sm:p-2',
                      !cell.isCurrentMonth && 'opacity-38 hover:opacity-75',
                      isSelected
                        ? 'border-primary bg-primary/12 shadow-sm ring-2 ring-primary/25'
                        : cell.matchesAuspicious && cell.isCurrentMonth
                          ? 'border-emerald-500/55 bg-emerald-500/8 hover:border-emerald-500'
                          : cell.isToday
                            ? 'border-primary/50 bg-primary/5'
                            : 'border-border/60 bg-background/60 hover:border-border hover:bg-muted/35',
                    )}
                  >
                    {/* 左上角：择日命中“宜”角标 */}
                    {cell.matchesAuspicious && cell.isCurrentMonth && (
                      <span className="absolute top-1 left-1 rounded bg-emerald-600 px-1 text-[9px] leading-tight font-bold text-white">
                        宜
                      </span>
                    )}

                    {/* 右上角：法定节假日 休 / 班 角标 */}
                    {cell.holidayStatus === 'rest' && (
                      <span
                        title={cell.holidayName ?? '法定节假日'}
                        className="absolute top-1 right-1 rounded bg-rose-500/90 px-1 text-[9px] leading-tight font-bold text-white"
                      >
                        休
                      </span>
                    )}
                    {cell.holidayStatus === 'work' && (
                      <span
                        title={cell.holidayName ? `${cell.holidayName}调休补班` : '调休补班'}
                        className="absolute top-1 right-1 rounded bg-slate-500/85 px-1 text-[9px] leading-tight font-bold text-white dark:bg-slate-600"
                      >
                        班
                      </span>
                    )}

                    {/* 公历日期数字 */}
                    <span
                      className={cn(
                        'font-mono text-base leading-none font-bold sm:text-lg',
                        isSelected
                          ? 'text-primary'
                          : cell.isToday
                            ? 'text-primary'
                            : cell.isWeekend
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-foreground',
                      )}
                    >
                      {cell.day}
                    </span>

                    {/* 农历 / 节气 / 节日副标题 */}
                    <span
                      className={cn(
                        'mt-1.5 max-w-full truncate text-[10px] leading-tight sm:text-[11px]',
                        cell.subKind === 'term'
                          ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                          : cell.subKind === 'festival'
                            ? 'font-semibold text-rose-600 dark:text-rose-400'
                            : cell.subKind === 'lunar-month'
                              ? 'font-semibold text-primary underline decoration-primary/40 underline-offset-2'
                              : 'text-muted-foreground',
                      )}
                    >
                      {cell.subLabel}
                    </span>

                    {/* 今日微标 */}
                    {cell.isToday && (
                      <span className="absolute bottom-1 h-1 w-4 rounded-full bg-primary/70" />
                    )}
                  </button>
                )
              })}
            </div>

            {/* 底部图例 */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-500/90" /> 法定休假
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-500/85" /> 调休补班
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" /> 节气 / 宜办吉日
                </span>
              </div>
              <span className="font-mono">
                {viewYear} 年 {viewMonth} 月 · 法定节假日覆盖 2002–2027
              </span>
            </div>
          </section>

          {/* 右栏：当日传统黄历全息详情 */}
          <aside className="flex flex-col gap-4 rounded-2xl border border-border/75 bg-card/85 p-4 shadow-sm backdrop-blur-md sm:p-5">
            {/* 头部大日历卡 */}
            <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-2xl font-extrabold tracking-tight text-foreground">
                    {detail.ymd}
                  </span>
                  <span className="rounded-full border border-border/80 bg-muted/50 px-2 py-0.5 text-xs font-medium text-foreground">
                    {detail.weekday}
                  </span>
                  <span className="rounded-full bg-primary/12 px-2 py-0.5 text-xs font-semibold text-primary">
                    {formatDiffLabel(detail.diffFromToday)}
                  </span>
                </div>

                <div className="mt-1.5 text-base font-bold text-foreground">
                  {detail.lunarFullText}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {detail.yearGanZhi}年 · {detail.monthGanZhi}月 · {detail.dayGanZhi}日（{detail.daySound}）
                  </span>
                  <span>·</span>
                  <span>{detail.constellation}</span>
                  <span>·</span>
                  <span>第 {detail.dayOfYear} 天</span>
                </div>
              </div>

              <div className="flex flex-col items-center gap-1 text-center">
                <MiniMoonPhase cycleProgress={detail.cycleProgress} size={48} />
                <span className="text-[10px] font-medium text-muted-foreground">
                  {detail.phaseName} · {Math.round(detail.illumination * 100)}%
                </span>
              </div>
            </div>

            {/* 节日、节气、物候与传统周期标签 */}
            <div className="flex flex-wrap gap-1.5">
              {detail.holidayStatus === 'rest' && (
                <span className="rounded-lg border border-rose-500/35 bg-rose-500/12 px-2 py-0.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
                  法定休假{detail.holidayName ? ` · ${detail.holidayName}` : ''}
                </span>
              )}
              {detail.holidayStatus === 'work' && (
                <span className="rounded-lg border border-amber-500/35 bg-amber-500/12 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  调休补班{detail.holidayName ? ` · ${detail.holidayName}` : ''}
                </span>
              )}
              {detail.festivals.map((f) => (
                <span
                  key={f}
                  className="rounded-lg border border-rose-500/25 bg-rose-500/8 px-2 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400"
                >
                  {f}
                </span>
              ))}
              <span
                className={cn(
                  'rounded-lg border px-2 py-0.5 text-xs font-medium',
                  detail.isSolarTermExactDay
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'border-border/70 bg-muted/40 text-foreground/85',
                )}
              >
                {detail.solarTermText}
              </span>
              <span className="rounded-lg border border-border/70 bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
                物候：{detail.phenologyText}
              </span>
              {detail.cycleTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300"
                >
                  {tag}
                </span>
              ))}
            </div>

            {/* 每日宜忌双色盒 */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/6 p-3">
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">
                    宜
                  </span>
                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    今日所宜（{detail.recommends.length}）
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {detail.recommends.length > 0 ? (
                    detail.recommends.map((item) => (
                      <span
                        key={item}
                        className={cn(
                          'rounded px-1.5 py-0.5 text-xs',
                          auspiciousTaboo === item
                            ? 'bg-emerald-600 font-bold text-white'
                            : 'bg-emerald-500/12 text-foreground/90',
                        )}
                      >
                        {item}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">诸事不宜</span>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-rose-500/30 bg-rose-500/6 p-3">
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-[11px] font-bold text-white">
                    忌
                  </span>
                  <span className="text-xs font-semibold text-rose-700 dark:text-rose-400">
                    今日所忌（{detail.avoids.length}）
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {detail.avoids.length > 0 ? (
                    detail.avoids.map((item) => (
                      <span
                        key={item}
                        className="rounded bg-rose-500/12 px-1.5 py-0.5 text-xs text-foreground/90"
                      >
                        {item}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">无特别忌讳</span>
                  )}
                </div>
              </div>
            </div>

            {/* 传统黄历核心 6 格 */}
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <div className="rounded-xl border border-border/65 bg-background/60 p-2.5">
                <div className="text-[10px] text-muted-foreground">建除十二神</div>
                <div className="mt-0.5 font-bold text-foreground">{detail.duty}日</div>
              </div>
              <div className="rounded-xl border border-border/65 bg-background/60 p-2.5">
                <div className="text-[10px] text-muted-foreground">值神黄黑道</div>
                <div className="mt-0.5 flex items-center gap-1 font-bold">
                  <span>{detail.twelveStar}</span>
                  <span
                    className={cn(
                      'rounded px-1 text-[10px]',
                      detail.twelveStarLuck === '吉'
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-slate-500/15 text-muted-foreground',
                    )}
                  >
                    {detail.twelveStarEcliptic}
                  </span>
                </div>
              </div>
              <div className="rounded-xl border border-border/65 bg-background/60 p-2.5">
                <div className="text-[10px] text-muted-foreground">今日冲煞</div>
                <div className="mt-0.5 font-bold text-foreground">
                  {detail.chongDesc} · {detail.shaDir}
                </div>
              </div>
              <div className="rounded-xl border border-border/65 bg-background/60 p-2.5">
                <div className="text-[10px] text-muted-foreground">值日九星</div>
                <div className="mt-0.5 font-bold text-foreground">
                  {detail.nineStarFull}（{detail.nineStarDipper}）
                </div>
              </div>
              <div className="rounded-xl border border-border/65 bg-background/60 p-2.5">
                <div className="text-[10px] text-muted-foreground">二十八宿</div>
                <div className="mt-0.5 font-bold text-foreground">{detail.twentyEightStar}</div>
              </div>
              <div className="rounded-xl border border-border/65 bg-background/60 p-2.5">
                <div className="text-[10px] text-muted-foreground">传统六曜</div>
                <div className="mt-0.5 font-bold text-foreground">{detail.sixStar}</div>
              </div>
            </div>

            {/* 吉神方位六宫格 */}
            <div className="rounded-xl border border-border/65 bg-muted/20 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Compass className="h-3.5 w-3.5 text-primary" />
                <span>今日吉神方位</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                {[
                  { label: '喜神', val: detail.directions.joy },
                  { label: '财神', val: detail.directions.wealth },
                  { label: '福神', val: detail.directions.mascot },
                  { label: '阳贵神', val: detail.directions.yangNoble },
                  { label: '阴贵神', val: detail.directions.yinNoble },
                  { label: '太岁方', val: detail.directions.taiSui },
                ].map((d) => (
                  <div
                    key={d.label}
                    className="rounded-lg border border-border/55 bg-background/75 py-1.5"
                  >
                    <div className="text-[10px] text-muted-foreground">{d.label}</div>
                    <div className="mt-0.5 font-bold text-foreground">{d.val}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 藏历 / 儒略日 / 胎神 / 彭祖 / 神煞 */}
            <div className="space-y-2 rounded-xl border border-border/65 bg-background/55 p-3 text-xs">
              <div className="flex flex-wrap justify-between gap-1">
                <span className="text-muted-foreground">藏历</span>
                <span className="font-medium text-foreground">
                  {detail.rabByungText ?? '藏历仅精确支持 1951–2050 年'}
                </span>
              </div>
              <div className="flex flex-wrap justify-between gap-1">
                <span className="text-muted-foreground">儒略日（Julian Day）</span>
                <span className="font-mono font-medium text-foreground">JD {detail.julianDay}</span>
              </div>
              <div className="flex flex-wrap justify-between gap-1">
                <span className="text-muted-foreground">逐日胎神</span>
                <span className="font-medium text-foreground">{detail.fetusDay}</span>
              </div>
              <div className="border-t border-border/50 pt-2">
                <span className="text-muted-foreground">彭祖百忌：</span>
                <span className="font-medium text-foreground">{detail.pengZu}</span>
              </div>
              {detail.goodGods.length > 0 && (
                <div className="border-t border-border/50 pt-2">
                  <span className="text-emerald-600 dark:text-emerald-400">吉神宜趋：</span>
                  <span className="text-foreground/85">{detail.goodGods.join(' · ')}</span>
                </div>
              )}
              {detail.badGods.length > 0 && (
                <div>
                  <span className="text-rose-600 dark:text-rose-400">凶神宜忌：</span>
                  <span className="text-foreground/85">{detail.badGods.join(' · ')}</span>
                </div>
              )}
            </div>

            {/* 当日十二时辰吉凶速览 */}
            <div className="rounded-xl border border-border/65 bg-muted/20 p-3">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-semibold text-foreground">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  当日十二时辰吉凶（点击查宜忌）
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {activeHour.name} · {activeHour.timeRange}
                </span>
              </div>

              <div className="grid grid-cols-6 gap-1.5">
                {detail.hours.map((h) => {
                  const isActive = h.index === activeHourIndex
                  const isGood = h.luck === '吉'
                  return (
                    <button
                      key={h.index}
                      type="button"
                      onClick={() => setActiveHourIndex(h.index)}
                      className={cn(
                        'flex flex-col items-center rounded-lg border py-1.5 text-center transition-all',
                        isActive
                          ? 'border-primary bg-primary/14 ring-1 ring-primary/30'
                          : isGood
                            ? 'border-emerald-500/35 bg-emerald-500/6 hover:border-emerald-500/60'
                            : 'border-border/60 bg-background/70 hover:border-border',
                      )}
                    >
                      <span className="text-[11px] font-bold text-foreground">{h.ganZhi}</span>
                      <span
                        className={cn(
                          'text-[10px] font-semibold',
                          isGood ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
                        )}
                      >
                        {h.luck}
                      </span>
                    </button>
                  )
                })}
              </div>

              {activeHour && (
                <div className="mt-2.5 space-y-1 rounded-lg border border-border/55 bg-background/80 p-2.5 text-[11px]">
                  <div className="flex items-center justify-between font-semibold text-foreground">
                    <span>
                      {activeHour.name}（{activeHour.timeRange}）
                    </span>
                    <span
                      className={cn(
                        activeHour.luck === '吉'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400',
                      )}
                    >
                      {activeHour.twelveStar} · {activeHour.ecliptic}
                      {activeHour.luck}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">宜：</span>
                    {activeHour.recommends.join('、') || '无'}
                  </div>
                  <div className="text-muted-foreground">
                    <span className="font-semibold text-rose-600 dark:text-rose-400">忌：</span>
                    {activeHour.avoids.join('、') || '无'}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* ==================== 视图 2：公历 / 农历 / 干支 / 藏历 / 儒略日 多历法互转 ==================== */}
      {activeTab === 'converter' && (
        <section className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* 1. 公历输入 */}
            <div className="flex flex-col gap-3 rounded-2xl border border-border/75 bg-card/85 p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <CalendarIcon className="h-4 w-4 text-primary" />
                <span>公历（格里高利历）</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <select
                  aria-label="公历年"
                  value={selectedDate.year}
                  onChange={(e) => jumpToDate(Number(e.target.value), selectedDate.month, selectedDate.day)}
                  className="h-10 rounded-xl border border-border/80 bg-background px-2.5 text-sm font-medium outline-none focus:border-primary"
                >
                  {YEAR_OPTIONS.map((y) => (
                    <option key={y} value={y}>
                      {y} 年
                    </option>
                  ))}
                </select>
                <select
                  aria-label="公历月"
                  value={selectedDate.month}
                  onChange={(e) => jumpToDate(selectedDate.year, Number(e.target.value), selectedDate.day)}
                  className="h-10 rounded-xl border border-border/80 bg-background px-2.5 text-sm font-medium outline-none focus:border-primary"
                >
                  {MONTH_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m} 月
                    </option>
                  ))}
                </select>
                <select
                  aria-label="公历日"
                  value={selectedDate.day}
                  onChange={(e) => jumpToDate(selectedDate.year, selectedDate.month, Number(e.target.value))}
                  className="h-10 rounded-xl border border-border/80 bg-background px-2.5 text-sm font-medium outline-none focus:border-primary"
                >
                  {convSolarDays.map((d) => (
                    <option key={d} value={d}>
                      {d} 日
                    </option>
                  ))}
                </select>
              </div>
              <div className="text-xs text-muted-foreground">
                {detail.weekday} · 当年第 {detail.dayOfYear} 天 · {detail.constellation}
              </div>
            </div>

            {/* 2. 农历输入（含闰月） */}
            <div className="flex flex-col gap-3 rounded-2xl border border-border/75 bg-card/85 p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <Moon className="h-4 w-4 text-amber-500" />
                <span>中国传统农历（自动带闰月）</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <select
                  aria-label="农历年"
                  value={detail.lunarYear}
                  onChange={(e) => {
                    const s = lunarToSolarYmd(
                      Number(e.target.value),
                      detail.lunarMonthWithLeap,
                      detail.lunarDay,
                    )
                    jumpToDate(s.year, s.month, s.day)
                  }}
                  className="h-10 rounded-xl border border-border/80 bg-background px-2.5 text-sm font-medium outline-none focus:border-primary"
                >
                  {YEAR_OPTIONS.map((y) => (
                    <option key={y} value={y}>
                      {y} 年
                    </option>
                  ))}
                </select>
                <select
                  aria-label="农历月"
                  value={detail.lunarMonthWithLeap}
                  onChange={(e) => {
                    const s = lunarToSolarYmd(detail.lunarYear, Number(e.target.value), detail.lunarDay)
                    jumpToDate(s.year, s.month, s.day)
                  }}
                  className="h-10 rounded-xl border border-border/80 bg-background px-2.5 text-sm font-medium outline-none focus:border-primary"
                >
                  {convLunarMonths.map((m) => (
                    <option key={m.monthWithLeap} value={m.monthWithLeap}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="农历日"
                  value={detail.lunarDay}
                  onChange={(e) => {
                    const s = lunarToSolarYmd(
                      detail.lunarYear,
                      detail.lunarMonthWithLeap,
                      Number(e.target.value),
                    )
                    jumpToDate(s.year, s.month, s.day)
                  }}
                  className="h-10 rounded-xl border border-border/80 bg-background px-2.5 text-sm font-medium outline-none focus:border-primary"
                >
                  {convLunarDays.map((d) => (
                    <option key={d} value={d}>
                      {LUNAR_DAY_NAMES[d - 1]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="text-xs text-muted-foreground">{detail.lunarFullText}</div>
            </div>

            {/* 3. 儒略日输入 */}
            <div className="flex flex-col gap-3 rounded-2xl border border-border/75 bg-card/85 p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <ArrowRightLeft className="h-4 w-4 text-sky-500" />
                <span>天文儒略日（Julian Day）</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={`当前 JD ${detail.julianDay}`}
                  value={jdInput}
                  onChange={(e) => setJdInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleApplyJd()
                  }}
                  className="h-10 flex-1 rounded-xl border border-border/80 bg-background px-3 font-mono text-sm outline-none focus:border-primary"
                />
                <Button size="sm" onClick={handleApplyJd} className="h-10 px-3.5">
                  换算
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                当前公历对应儒略日：<strong className="font-mono text-foreground">{detail.julianDay}</strong>
              </div>
            </div>
          </div>

          {/* 多历法同步全景结果卡 */}
          <div className="rounded-2xl border border-border/75 bg-card/85 p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="text-base font-bold text-foreground">多历法对照结果</h2>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setActiveTab('calendar')}
                className="h-8 text-xs"
              >
                在万年历与黄历中查看此日 →
              </Button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { label: '公历', value: `${detail.ymd}（${detail.weekday}）`, sub: `当年第 ${detail.dayOfYear} 天 · ${detail.constellation}` },
                { label: '农历', value: detail.lunarFullText, sub: `月相：${detail.phaseName}（照明约 ${Math.round(detail.illumination * 100)}%）` },
                { label: '干支纪历', value: `${detail.yearGanZhi}年 ${detail.monthGanZhi}月 ${detail.dayGanZhi}日`, sub: `日纳音：${detail.daySound} · 建除${detail.duty}日` },
                { label: '藏历（饶迥历）', value: detail.rabByungText ?? '超出精确年份范围', sub: 'tyme4ts 精确覆盖 1951–2050 年' },
                { label: '儒略日（JD）', value: `JD ${detail.julianDay}`, sub: '天文学连续纪日标准（0时起算带 .5）' },
                { label: '节气与星宿', value: `${detail.solarTermText} · ${detail.twentyEightStar}`, sub: `物候：${detail.phenologyText}` },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-border/65 bg-background/65 p-4"
                >
                  <div className="text-xs text-muted-foreground">{item.label}</div>
                  <div className="mt-1 text-base font-bold text-foreground">{item.value}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{item.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ==================== 视图 3：农历生日转公历未来查询 ==================== */}
      {activeTab === 'birthday' && (
        <section className="flex flex-col gap-5">
          <div className="rounded-2xl border border-border/75 bg-card/85 p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3.5">
              <div className="flex items-center gap-2">
                <Cake className="h-4 w-4 text-primary" />
                <h2 className="text-base font-bold text-foreground">农历生日 / 纪念日转未来公历查询</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" onClick={handleCopyBirthdayTable} className="h-8 text-xs">
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  复制对照表
                </Button>
                <Button variant="secondary" size="sm" onClick={handleExportBirthdayIcs} className="h-8 text-xs">
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  导出 .ics 提醒日历
                </Button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">提醒标题（用于导出 .ics）</label>
                <input
                  type="text"
                  value={bdayTitle}
                  onChange={(e) => setBdayTitle(e.target.value)}
                  placeholder="例如：妈妈农历生日"
                  className="h-10 rounded-xl border border-border/80 bg-background px-3 text-sm outline-none focus:border-primary"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">农历月份</label>
                <select
                  value={bdayMonth}
                  onChange={(e) => setBdayMonth(Number(e.target.value))}
                  className="h-10 rounded-xl border border-border/80 bg-background px-3 text-sm font-medium outline-none focus:border-primary"
                >
                  {LUNAR_MONTH_NAMES.map((name, idx) => (
                    <option key={name} value={idx + 1}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">农历日期</label>
                <select
                  value={bdayDay}
                  onChange={(e) => setBdayDay(Number(e.target.value))}
                  className="h-10 rounded-xl border border-border/80 bg-background px-3 text-sm font-medium outline-none focus:border-primary"
                >
                  {LUNAR_DAY_NAMES.map((name, idx) => (
                    <option key={name} value={idx + 1}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">起始年份 / 跨度</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    aria-label="起始年份"
                    value={bdayStartYear}
                    onChange={(e) => setBdayStartYear(Number(e.target.value))}
                    className="h-10 rounded-xl border border-border/80 bg-background px-2 text-sm font-medium outline-none focus:border-primary"
                  >
                    {YEAR_OPTIONS.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="查询年数"
                    value={bdayCount}
                    onChange={(e) => setBdayCount(Number(e.target.value))}
                    className="h-10 rounded-xl border border-border/80 bg-background px-2 text-sm font-medium outline-none focus:border-primary"
                  >
                    {[5, 10, 15, 20].map((n) => (
                      <option key={n} value={n}>
                        {n} 年
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col justify-between gap-1.5">
                <span className="text-xs text-muted-foreground">闰月出生优先匹配闰月</span>
                <div className="flex h-10 items-center justify-between rounded-xl border border-border/70 bg-muted/25 px-3">
                  <span className="text-xs font-medium text-foreground">
                    {bdayIsLeap ? `闰${LUNAR_MONTH_NAMES[bdayMonth - 1]}` : '普通平月'}
                  </span>
                  <Switch checked={bdayIsLeap} onChange={setBdayIsLeap} label="是否闰月出生" />
                </div>
              </div>
            </div>
          </div>

          {/* 未来公历结果列表 */}
          <div className="overflow-hidden rounded-2xl border border-border/75 bg-card/85 shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border/70 bg-muted/35 text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-semibold">农历年份</th>
                    <th className="px-4 py-3 font-semibold">农历日期</th>
                    <th className="px-4 py-3 font-semibold">对应公历</th>
                    <th className="px-4 py-3 font-semibold">星期</th>
                    <th className="px-4 py-3 font-semibold">距今</th>
                    <th className="px-4 py-3 text-right font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {birthdayResults.map((row) => {
                    const isNextUpcoming =
                      row.diffFromToday >= 0 &&
                      birthdayResults.find((x) => x.diffFromToday >= 0)?.lunarYear === row.lunarYear
                    return (
                      <tr
                        key={row.lunarYear}
                        className={cn(
                          'transition-colors hover:bg-muted/30',
                          isNextUpcoming && 'bg-primary/6',
                        )}
                      >
                        <td className="px-4 py-3 font-medium text-foreground">
                          {row.lunarYear} · {row.lunarYearGanZhi}（{row.zodiac}）年
                        </td>
                        <td className="px-4 py-3 text-foreground/90">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span>{row.lunarDateText}</span>
                            {row.fallbackToNormalMonth && (
                              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                                该年无此闰月，按平月计
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono font-bold text-foreground">
                          <div className="flex items-center gap-2">
                            <span>{row.solarYmd}</span>
                            {isNextUpcoming && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                                <Star className="h-2.5 w-2.5" />
                                最近一次
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{row.weekday}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {formatDiffLabel(row.diffFromToday)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => jumpToDate(row.solarYear, row.solarMonth, row.solarDay, true)}
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            在万年历查看
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
