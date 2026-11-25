import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlarmClock,
  Briefcase,
  Calendar,
  CalendarCheck2,
  CalendarDays,
  CalendarHeart,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Palmtree,
  PartyPopper,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { downloadBlob } from '@/lib/file'
import { cn } from '@/lib/utils'
import {
  analyzeCustomLeaveStreaks,
  buildHolidaysIcs,
  buildHolidaysMarkdown,
  buildYearHolidaySummary,
  computeNextHolidayCountdown,
  diffDaysYmd,
  formatMonthDay,
  getTodayYmd,
  SUPPORTED_MAX_YEAR,
  SUPPORTED_MIN_YEAR,
  type DayCellInfo,
  type HolidayGroup,
  type LeaveSuggestion,
} from './engine'

type ViewTab = 'guide' | 'year-calendar' | 'makeup-export'

const WEEK_HEADERS = ['一', '二', '三', '四', '五', '六', '日']
const QUICK_YEARS = [2025, 2026, 2027]

/** 将 0=日..6=六 映射为周一开头网格列索引 0..6 */
function mondayColumnIndex(weekIndex: number): number {
  return weekIndex === 0 ? 6 : weekIndex - 1
}

export default function LegalHolidaysTool() {
  const todayYmd = useMemo(() => getTodayYmd(), [])
  const initialYear = useMemo(() => {
    const y = new Date().getFullYear()
    return Math.max(SUPPORTED_MIN_YEAR, Math.min(SUPPORTED_MAX_YEAR, y))
  }, [])

  const [year, setYear] = useState<number>(initialYear)
  const [tab, setTab] = useState<ViewTab>('guide')

  // 每个假期卡片当前选中的拼假方案 ID（用于高亮日历条带）
  const [activePlanByGroup, setActivePlanByGroup] = useState<Record<string, string | null>>({})
  // 用户自定义试请年假集合（按 YYYY-MM-DD 存储）
  const [customLeaves, setCustomLeaves] = useState<Set<string>>(() => new Set())
  const [leaveEditMode, setLeaveEditMode] = useState(true)

  // ICS 导出选项
  const [icsHolidays, setIcsHolidays] = useState(true)
  const [icsMakeups, setIcsMakeups] = useState(true)
  const [icsCustomLeaves, setIcsCustomLeaves] = useState(true)

  const summary = useMemo(() => buildYearHolidaySummary(year), [year])
  const countdown = useMemo(() => computeNextHolidayCountdown(todayYmd), [todayYmd])

  // 当前年份范围内用户已勾选的自定义年假
  const yearCustomLeaves = useMemo(() => {
    const prefix = `${year}-`
    const next = new Set<string>()
    customLeaves.forEach((d) => {
      if (d.startsWith(prefix)) next.add(d)
    })
    return next
  }, [customLeaves, year])

  const customStreaks = useMemo(
    () => analyzeCustomLeaveStreaks(summary, yearCustomLeaves),
    [summary, yearCustomLeaves],
  )

  const toggleCustomLeave = (day: DayCellInfo) => {
    if (day.isRestDay) return
    setCustomLeaves((prev) => {
      const next = new Set(prev)
      if (next.has(day.ymd)) next.delete(day.ymd)
      else next.add(day.ymd)
      return next
    })
  }

  const applySuggestionToMyPlan = (sug: LeaveSuggestion) => {
    setCustomLeaves((prev) => {
      const next = new Set(prev)
      sug.leaveDays.forEach((d) => next.add(d))
      return next
    })
    toast.success(`已将「${sug.title}」的 ${sug.leaveCount} 天年假加入你的拼假计划，可在全年日历与 ICS 导出中查看`)
  }

  const handleDownloadIcs = () => {
    if (!icsHolidays && !icsMakeups && !(icsCustomLeaves && yearCustomLeaves.size > 0)) {
      toast.info('请至少勾选一项导出内容')
      return
    }
    const content = buildHolidaysIcs(summary, {
      includeHolidays: icsHolidays,
      includeMakeups: icsMakeups,
      customLeaves: icsCustomLeaves ? yearCustomLeaves : undefined,
    })
    downloadBlob(new Blob([content], { type: 'text/calendar;charset=utf-8' }), `${year}年中国法定节假日.ics`)
    toast.success(`已导出 ${year} 年 .ics 日历文件，双击即可导入系统日历`)
  }

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(buildHolidaysMarkdown(summary))
      toast.success(`已复制 ${year} 年 Markdown 假期与拼假攻略表`)
    } catch {
      toast.error('复制失败，请手动复制')
    }
  }

  const allYears = useMemo(() => {
    const arr: number[] = []
    for (let y = SUPPORTED_MAX_YEAR; y >= SUPPORTED_MIN_YEAR; y--) arr.push(y)
    return arr
  }, [])

  return (
    <div className="space-y-5">
      {/* ================= 顶部 Hero：下个假期实时倒计时 + 年份切换 ================= */}
      <section className="glass shadow-soft relative overflow-hidden rounded-3xl p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          {/* 左：倒计时核心信息 */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/12 px-2.5 py-0.5 font-semibold text-rose-600 dark:text-rose-400">
                <CalendarHeart className="size-3.5" />
                今日 {todayYmd}
              </span>
              {countdown.nextMakeup && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2.5 py-0.5 font-medium text-amber-800 dark:text-amber-300">
                  <AlarmClock className="size-3.5" />
                  下次补班：{formatMonthDay(countdown.nextMakeup.ymd)}（周{countdown.nextMakeup.weekLabel} ·{' '}
                  {countdown.nextMakeup.daysUntil === 0 ? '就是今天' : `${countdown.nextMakeup.daysUntil} 天后`}）
                </span>
              )}
            </div>

            {countdown.status === 'ongoing' ? (
              <div className="space-y-1">
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <PartyPopper className="size-7 text-rose-500" />
                  <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                    正在享受 <span className="text-primary">{countdown.holidayName}</span> 假期
                  </h2>
                </div>
                <p className="text-muted-foreground text-sm">
                  第 <strong className="text-foreground font-mono">{countdown.daysCount}</strong> / {countdown.restDays} 天（
                  {formatMonthDay(countdown.startYmd)} – {formatMonthDay(countdown.endYmd)}）
                </p>
              </div>
            ) : countdown.status === 'upcoming' ? (
              <div className="space-y-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-muted-foreground text-sm font-medium">距离下一个法定假期</span>
                  <span className="text-primary text-lg font-bold">{countdown.holidayName}</span>
                  <span className="text-muted-foreground text-xs">
                    （{formatMonthDay(countdown.startYmd)} 起连休 {countdown.restDays} 天）
                  </span>
                </div>
                <div className="flex flex-wrap items-baseline gap-4">
                  <div className="font-mono text-4xl font-extrabold tracking-tight tabular-nums sm:text-5xl">
                    {countdown.daysCount}
                    <span className="text-muted-foreground ml-1.5 font-sans text-base font-medium">天</span>
                  </div>
                  <div className="border-border/70 bg-foreground/[0.04] rounded-xl border px-3 py-1 text-xs">
                    期间仅需再上 <strong className="text-primary font-mono text-sm">{countdown.workDaysLeft}</strong> 个工作日
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm font-medium">浏览 {year} 年中国法定节假日与调休安排</div>
            )}
          </div>

          {/* 右：年份选择 + 一键导出 */}
          <div className="flex flex-col items-start gap-2.5 lg:items-end">
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="icon"
                variant="outline"
                className="size-8"
                disabled={year <= SUPPORTED_MIN_YEAR}
                onClick={() => setYear((y) => Math.max(SUPPORTED_MIN_YEAR, y - 1))}
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

              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                aria-label="选择年份"
                className="border-border/70 bg-background/70 h-8 rounded-xl border px-2 font-mono text-xs font-semibold outline-none"
              >
                {allYears.map((y) => (
                  <option key={y} value={y}>
                    {y} 年
                  </option>
                ))}
              </select>

              <Button
                size="icon"
                variant="outline"
                className="size-8"
                disabled={year >= SUPPORTED_MAX_YEAR}
                onClick={() => setYear((y) => Math.min(SUPPORTED_MAX_YEAR, y + 1))}
                title="下一年"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleCopyMarkdown}>
                <Copy className="!size-3.5" />
                复制攻略表
              </Button>
              <Button size="sm" variant="primary" onClick={handleDownloadIcs}>
                <Download className="!size-3.5" />
                导出 {year} 年 .ics 日历
              </Button>
            </div>
          </div>
        </div>

        {/* 全年 4 项核心数据统计 */}
        <div className="mt-5 grid grid-cols-2 gap-2.5 border-t pt-4 sm:grid-cols-4">
          {[
            { label: '法定放假（休）', value: `${summary.legalRestCount} 天`, cls: 'text-emerald-600 dark:text-emerald-400' },
            { label: '调休补班（班）', value: `${summary.makeupWorkCount} 天`, cls: 'text-rose-600 dark:text-rose-400' },
            { label: '全年总休息日', value: `${summary.totalRestDays} 天`, cls: 'text-sky-600 dark:text-sky-400' },
            { label: '全年实际工作日', value: `${summary.totalWorkDays} 天`, cls: 'text-foreground' },
          ].map((stat) => (
            <div key={stat.label} className="bg-foreground/[0.03] rounded-2xl px-3.5 py-2.5">
              <div className="text-muted-foreground text-[11px]">{stat.label}</div>
              <div className={cn('mt-0.5 font-mono text-lg font-bold tabular-nums', stat.cls)}>{stat.value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ================= 视图切换 ================= */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<ViewTab>
          value={tab}
          onChange={setTab}
          className="max-w-lg"
          options={[
            { value: 'guide', label: '假期与拼假攻略', icon: <Palmtree /> },
            { value: 'year-calendar', label: '全年 12 月日历', icon: <CalendarDays /> },
            { value: 'makeup-export', label: '补班速查与 ICS', icon: <CalendarCheck2 /> },
          ]}
        />

        {yearCustomLeaves.size > 0 && (
          <div className="bg-amber-500/12 text-amber-800 dark:text-amber-300 flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium">
            <Sparkles className="size-3.5" />
            <span>已规划 {yearCustomLeaves.size} 天年假</span>
            <button
              type="button"
              onClick={() => setCustomLeaves(new Set())}
              className="hover:text-rose-500 underline"
            >
              清空
            </button>
          </div>
        )}
      </div>

      {/* ================= 视图一：全年假期清单与智能拼假攻略 ================= */}
      {tab === 'guide' && (
        <div className="grid gap-4 lg:grid-cols-2">
          {summary.groups.map((group) => (
            <HolidayGuideCard
              key={group.id}
              group={group}
              todayYmd={todayYmd}
              activePlanId={activePlanByGroup[group.id] ?? null}
              onSelectPlan={(planId) =>
                setActivePlanByGroup((prev) => ({
                  ...prev,
                  [group.id]: prev[group.id] === planId ? null : planId,
                }))
              }
              onApplyPlan={applySuggestionToMyPlan}
            />
          ))}
        </div>
      )}

      {/* ================= 视图二：全年 12 月休/班总览 + 交互试请年假 ================= */}
      {tab === 'year-calendar' && (
        <div className="space-y-4">
          {/* 试请年假交互控制台 */}
          <section className="glass shadow-soft flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 text-xs">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 font-semibold">
                <Switch checked={leaveEditMode} onChange={setLeaveEditMode} label="开启点击试请年假" />
                <span>点击任意工作日/补班日试请年假</span>
              </label>

              {/* 图例 */}
              <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-[11px]">
                <span className="inline-flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-emerald-500" /> 法定假(休)
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-rose-500" /> 调休补班(班)
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-sky-500/35" /> 普通周末
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-amber-500" /> 试请年假
                </span>
              </div>
            </div>

            {yearCustomLeaves.size > 0 && (
              <Button size="sm" variant="ghost" className="text-rose-500" onClick={() => setCustomLeaves(new Set())}>
                <Trash2 className="!size-3.5" />
                清空已选年假 ({yearCustomLeaves.size} 天)
              </Button>
            )}
          </section>

          {/* 已拼出的自定义长假结果条 */}
          {customStreaks.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/[0.08] px-4 py-3 text-xs">
              <Sparkles className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="font-semibold text-amber-800 dark:text-amber-300">你的自定义拼假成果：</span>
              {customStreaks.map((st) => (
                <span
                  key={st.startYmd}
                  className="bg-background/80 inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 font-mono"
                >
                  <strong className="text-amber-700 dark:text-amber-300">
                    请 {st.leaveUsed} 休 {st.totalDays}
                  </strong>
                  <span className="text-muted-foreground">
                    ({formatMonthDay(st.startYmd)} – {formatMonthDay(st.endYmd)})
                  </span>
                </span>
              ))}
            </div>
          )}

          {/* 12 个月微型月历网格 */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 12 }, (_, idx) => idx + 1).map((month) => {
              const days = summary.months[month] || []
              const leadBlanks = days.length > 0 ? mondayColumnIndex(days[0].weekIndex) : 0
              return (
                <section key={month} className="glass shadow-soft rounded-2xl p-3.5">
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="text-sm font-bold">{month} 月</span>
                    <span className="text-muted-foreground font-mono text-[11px]">
                      {days.filter((d) => d.kind === 'holiday').length > 0 && (
                        <span className="mr-1.5 text-emerald-600 dark:text-emerald-400">
                          休{days.filter((d) => d.kind === 'holiday').length}
                        </span>
                      )}
                      {days.filter((d) => d.kind === 'makeup').length > 0 && (
                        <span className="text-rose-500">班{days.filter((d) => d.kind === 'makeup').length}</span>
                      )}
                    </span>
                  </div>

                  <div className="text-muted-foreground mb-1 grid grid-cols-7 text-center text-[10px]">
                    {WEEK_HEADERS.map((w) => (
                      <span key={w}>{w}</span>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-1 text-center font-mono text-xs">
                    {Array.from({ length: leadBlanks }).map((_, i) => (
                      <span key={`b-${i}`} />
                    ))}
                    {days.map((d) => {
                      const isToday = d.ymd === todayYmd
                      const isCustomLeave = yearCustomLeaves.has(d.ymd)
                      const clickable = leaveEditMode && !d.isRestDay
                      const titleText = [
                        `${d.ymd} 周${d.weekLabel}（农历${d.lunarShort}）`,
                        d.termName ? `节气：${d.termName}` : '',
                        d.holidayName ? `${d.holidayName}${d.kind === 'makeup' ? '调休补班' : '法定放假'}` : '',
                        isCustomLeave ? '已标记为试请年假' : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')

                      return (
                        <button
                          key={d.ymd}
                          type="button"
                          disabled={!clickable}
                          onClick={() => clickable && toggleCustomLeave(d)}
                          title={titleText}
                          className={cn(
                            'relative flex h-8 flex-col items-center justify-center rounded-lg text-[11px] font-medium transition',
                            isCustomLeave
                              ? 'bg-amber-500 text-white shadow-xs'
                              : d.kind === 'holiday'
                                ? 'bg-emerald-500/18 text-emerald-700 font-bold dark:text-emerald-300'
                                : d.kind === 'makeup'
                                  ? 'bg-rose-500/18 text-rose-600 font-bold dark:text-rose-400'
                                  : d.kind === 'weekend'
                                    ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
                                    : 'text-foreground/85',
                            clickable && !isCustomLeave && 'hover:bg-amber-500/20 cursor-pointer',
                            isToday && 'ring-primary ring-2',
                          )}
                        >
                          <span>{d.day}</span>
                          {(d.kind === 'holiday' || d.kind === 'makeup' || isCustomLeave) && (
                            <span className="text-[8px] leading-none font-sans">
                              {isCustomLeave ? '年' : d.kind === 'holiday' ? '休' : '班'}
                            </span>
                          )}
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

      {/* ================= 视图三：调休补班速查 & ICS 日历导出 ================= */}
      {tab === 'makeup-export' && (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* 左：全年调休补班保命清单 */}
          <section className="glass shadow-soft space-y-3 rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Briefcase className="size-4 text-rose-500" />
                <span>{year} 年全部调休补班日（{summary.allMakeupDays.length} 天）</span>
              </div>
              <span className="text-muted-foreground text-xs">记得设好周末上班闹钟</span>
            </div>

            {summary.allMakeupDays.length === 0 ? (
              <div className="text-muted-foreground py-10 text-center text-xs">该年份无调休补班记录</div>
            ) : (
              <div className="divide-border/50 divide-y">
                {summary.allMakeupDays.map((m) => {
                  const diff = diffDaysYmd(todayYmd, m.ymd)
                  const isPast = diff < 0
                  return (
                    <div
                      key={m.ymd}
                      className={cn(
                        'flex items-center justify-between gap-3 py-2.5 text-xs',
                        isPast && 'opacity-55',
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-7 items-center justify-center rounded-lg bg-rose-500/15 font-bold text-rose-600 dark:text-rose-400">
                          班
                        </span>
                        <div>
                          <div className="font-mono text-sm font-semibold">
                            {m.ymd}{' '}
                            <span className="font-sans text-xs font-normal text-muted-foreground">
                              周{m.weekLabel}
                            </span>
                          </div>
                          <div className="text-muted-foreground text-[11px]">
                            对应 {m.holidayName} 调休 · 农历{m.lunarShort}
                          </div>
                        </div>
                      </div>
                      <span
                        className={cn(
                          'rounded-full px-2.5 py-0.5 font-mono text-[11px]',
                          diff === 0
                            ? 'bg-rose-500 text-white font-semibold'
                            : diff > 0
                              ? 'bg-foreground/[0.06] text-foreground'
                              : 'text-muted-foreground',
                        )}
                      >
                        {diff === 0 ? '今天补班' : diff > 0 ? `${diff} 天后` : '已过'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* 右：自定义 ICS 日历导出器 */}
          <section className="glass shadow-soft flex flex-col justify-between gap-5 rounded-2xl p-5">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Calendar className="text-primary size-4" />
                <span>导出标准 .ics 日历文件</span>
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed">
                生成符合 RFC 5545 规范的通用日历文件，双击即可一键导入 macOS / iPhone 日历、华为/小米手机日历、Outlook 或 Google Calendar。
              </p>

              <div className="space-y-3 rounded-2xl border p-4 text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">包含法定放假安排（[休]）</div>
                    <div className="text-muted-foreground text-[11px]">共 {summary.groups.length} 段法定假期</div>
                  </div>
                  <Switch checked={icsHolidays} onChange={setIcsHolidays} label="包含法定假期" />
                </div>

                <div className="flex items-center justify-between border-t pt-3">
                  <div>
                    <div className="font-semibold">包含调休补班提醒（[班]）</div>
                    <div className="text-muted-foreground text-[11px]">共 {summary.allMakeupDays.length} 个补班日，防误睡过头</div>
                  </div>
                  <Switch checked={icsMakeups} onChange={setIcsMakeups} label="包含调休补班" />
                </div>

                <div className="flex items-center justify-between border-t pt-3">
                  <div>
                    <div className="font-semibold">包含我的自定义年假（[年假]）</div>
                    <div className="text-muted-foreground text-[11px]">
                      当前已规划 {yearCustomLeaves.size} 天（可在「全年 12 月日历」或攻略中勾选）
                    </div>
                  </div>
                  <Switch
                    checked={icsCustomLeaves}
                    onChange={setIcsCustomLeaves}
                    label="包含自定义年假"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="lg" className="flex-1" onClick={handleDownloadIcs}>
                <Download />
                下载 {year} 年节假日 .ics
              </Button>
              <Button variant="outline" size="lg" onClick={handleCopyMarkdown}>
                <Copy />
                复制 Markdown 表
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

/** 单个法定节假日与拼假攻略卡片 */
function HolidayGuideCard({
  group,
  todayYmd,
  activePlanId,
  onSelectPlan,
  onApplyPlan,
}: {
  group: HolidayGroup
  todayYmd: string
  activePlanId: string | null
  onSelectPlan: (id: string) => void
  onApplyPlan: (sug: LeaveSuggestion) => void
}) {
  const diffStart = diffDaysYmd(todayYmd, group.startYmd)
  const diffEnd = diffDaysYmd(todayYmd, group.endYmd)
  const status = diffEnd < 0 ? 'past' : diffStart <= 0 ? 'ongoing' : 'upcoming'

  const activePlan = group.suggestions.find((s) => s.id === activePlanId) ?? null
  const activeLeaveSet = useMemo(() => new Set(activePlan?.leaveDays ?? []), [activePlan])

  return (
    <article
      className={cn(
        'glass shadow-soft flex flex-col justify-between gap-4 rounded-2xl border p-5 transition',
        status === 'ongoing' && 'border-primary/60 ring-primary/20 ring-2',
        status === 'past' && 'opacity-80',
      )}
    >
      {/* 头部：节日名、时间范围、天数与倒计时徽章 */}
      <div className="space-y-2.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold">{group.name}</h3>
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-mono text-xs font-bold text-emerald-700 dark:text-emerald-300">
                连休 {group.restDays} 天
              </span>
            </div>
            <div className="text-muted-foreground mt-1 font-mono text-xs">
              {formatMonthDay(group.startYmd)}（周{group.holidayDays[0]?.weekLabel}）–{' '}
              {formatMonthDay(group.endYmd)}（周{group.holidayDays[group.holidayDays.length - 1]?.weekLabel}）
            </div>
          </div>

          <span
            className={cn(
              'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold',
              status === 'ongoing'
                ? 'bg-primary text-primary-foreground'
                : status === 'upcoming'
                  ? 'bg-sky-500/12 text-sky-700 dark:text-sky-300'
                  : 'bg-foreground/[0.06] text-muted-foreground',
            )}
          >
            {status === 'ongoing' ? '进行中' : status === 'upcoming' ? `${diffStart} 天后` : '已结束'}
          </span>
        </div>

        {/* 调休补班说明 */}
        <div className="text-xs">
          {group.makeupDays.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 text-rose-600 dark:text-rose-400">
              <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold">调休补班</span>
              <span>
                {group.makeupDays.map((m) => `${formatMonthDay(m.ymd)}(周${m.weekLabel})`).join('、')} 上班
              </span>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <Check className="size-3.5" />
              无调休补班，纯粹连休！
            </span>
          )}
        </div>
      </div>

      {/* 可视化彩色日历条带（展示假期前后连休与高亮的拼假日期） */}
      <div className="no-scrollbar flex gap-1 overflow-x-auto pb-1">
        {group.windowDays.map((d) => {
          const isPlanLeave = activeLeaveSet.has(d.ymd)
          const inPlanSpan = activePlan && d.ymd >= activePlan.startYmd && d.ymd <= activePlan.endYmd
          return (
            <div
              key={d.ymd}
              title={`${d.ymd} 周${d.weekLabel}（农历${d.lunarShort}）`}
              className={cn(
                'flex w-10 shrink-0 flex-col items-center rounded-xl border py-1.5 text-center font-mono text-[11px] transition',
                isPlanLeave
                  ? 'border-amber-500 bg-amber-500 text-white shadow-xs'
                  : d.kind === 'holiday'
                    ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : d.kind === 'makeup'
                      ? 'border-rose-500/35 bg-rose-500/15 text-rose-600 dark:text-rose-400'
                      : d.kind === 'weekend'
                        ? 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                        : 'border-border/50 bg-foreground/[0.02] text-muted-foreground',
                inPlanSpan && !isPlanLeave && 'ring-amber-400/70 ring-1',
              )}
            >
              <span className="text-[9px] opacity-75">周{d.weekLabel}</span>
              <span className="font-bold">{d.day}</span>
              <span className="font-sans text-[9px] leading-tight">
                {isPlanLeave ? '请假' : d.kind === 'holiday' ? '休' : d.kind === 'makeup' ? '班' : d.kind === 'weekend' ? '末' : '工'}
              </span>
            </div>
          )
        })}
      </div>

      {/* 智能拼假推荐区 */}
      {group.suggestions.length > 0 && (
        <div className="border-border/60 space-y-2.5 border-t pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px] font-medium">
              <Sparkles className="size-3.5 text-amber-500" />
              拼假攻略：
            </span>
            {group.suggestions.map((sug) => {
              const selected = activePlan?.id === sug.id
              return (
                <button
                  key={sug.id}
                  type="button"
                  onClick={() => onSelectPlan(sug.id)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-xl border px-2.5 py-1 text-xs font-semibold transition',
                    selected
                      ? 'border-amber-500 bg-amber-500 text-white shadow-xs'
                      : 'border-border/70 bg-background/60 hover:border-amber-500/60 text-foreground',
                  )}
                >
                  <span>{sug.title}</span>
                  <span className={cn('font-mono text-[10px]', selected ? 'text-white/90' : 'text-amber-600 dark:text-amber-400')}>
                    {sug.ratio}×
                  </span>
                </button>
              )
            })}
          </div>

          {activePlan && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-500/[0.08] px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
              <div className="space-y-0.5">
                <div>
                  <strong>{activePlan.positionLabel}</strong>：请{' '}
                  <span className="font-mono font-semibold">
                    {activePlan.leaveDays.map(formatMonthDay).join('、')}
                  </span>
                </div>
                <div className="text-[11px] opacity-85">
                  可连休 {formatMonthDay(activePlan.startYmd)} – {formatMonthDay(activePlan.endYmd)} 共{' '}
                  <strong>{activePlan.totalRestDays} 天</strong>
                </div>
              </div>
              <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => onApplyPlan(activePlan)}>
                加入我的年假计划
              </Button>
            </div>
          )}
        </div>
      )}
    </article>
  )
}
