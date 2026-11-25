import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertCircle,
  Calendar,
  Clock,
  Compass,
  Copy,
  Flame,
  Info,
  Moon,
  RotateCcw,
  Sparkles,
  Star,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { cn } from '@/lib/utils'
import {
  CONSTELLATION_LIST,
  FOUR_BEAST_GROUPS,
  SHICHEN_LIST,
  WESTERN_ELEMENT_STYLE,
  WUXING_ORDER,
  WUXING_STYLE,
  ZODIAC_LIST,
  type WesternElement,
} from './data'
import {
  analyzeBirthProfile,
  buildProfileMarkdown,
  getAllTwentyEightStars,
  getLunarMonthOptions,
  getSolarDayCount,
  lunarToSolarYmd,
  type BirthInput,
} from './engine'

type CalendarMode = 'solar' | 'lunar'
type ViewTab = 'overview' | 'constellations' | 'stars'

const LUNAR_DAY_NAMES = [
  '初一',
  '初二',
  '初三',
  '初四',
  '初五',
  '初六',
  '初七',
  '初八',
  '初九',
  '初十',
  '十一',
  '十二',
  '十三',
  '十四',
  '十五',
  '十六',
  '十七',
  '十八',
  '十九',
  '二十',
  '廿一',
  '廿二',
  '廿三',
  '廿四',
  '廿五',
  '廿六',
  '廿七',
  '廿八',
  '廿九',
  '三十',
]

const YEAR_OPTIONS = Array.from({ length: 201 }, (_, i) => 1900 + i)
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1)

/** 逼真 SVG 月相渲染器（cycleProgress: 0=新月, 0.25=上弦, 0.5=满月, 0.75=下弦） */
function MoonPhaseSvg({
  cycleProgress,
  size = 76,
}: {
  cycleProgress: number
  size?: number
}) {
  const r = 30
  const cx = 40
  const cy = 40
  const p = ((cycleProgress % 1) + 1) % 1
  const phaseAngle = p * 2 * Math.PI
  const rx = Math.abs(Math.cos(phaseAngle)) * r

  // 构造亮面路径：上半程（0..0.5 盈月）右侧受光；下半程（0.5..1 亏月）左侧受光
  let litPath = ''
  if (p < 0.015 || p > 0.985) {
    litPath = ''
  } else if (Math.abs(p - 0.5) < 0.015) {
    litPath = `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`
  } else if (p < 0.5) {
    // 盈月：右半外弧固定向下（sweep=1），中间晨昏线向上回起点
    // p < 0.25 蛾眉月（凹向右侧，sweep=0）；p > 0.25 盈凸月（凸向左侧，sweep=1）
    const innerSweep = p < 0.25 ? 0 : 1
    litPath = `M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx} ${cy + r} A ${rx.toFixed(2)} ${r} 0 0 ${innerSweep} ${cx} ${cy - r} Z`
  } else {
    // 亏月：左半外弧固定向下（sweep=0），中间晨昏线向上回起点
    // p < 0.75 亏凸月（凸向右侧，sweep=0）；p > 0.75 残月（凹向左侧，sweep=1）
    const innerSweep = p < 0.75 ? 0 : 1
    litPath = `M ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx} ${cy + r} A ${rx.toFixed(2)} ${r} 0 0 ${innerSweep} ${cx} ${cy - r} Z`
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      className="shrink-0 drop-shadow-[0_0_12px_rgba(251,191,36,0.22)]"
      aria-label="出生月相图示"
    >
      <defs>
        <radialGradient id="moon-lit-grad" cx="38%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#fef9c3" />
          <stop offset="55%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#f59e0b" />
        </radialGradient>
        <radialGradient id="moon-dark-grad" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="#334155" />
          <stop offset="100%" stopColor="#0f172a" />
        </radialGradient>
      </defs>
      {/* 微弱外环星轨 */}
      <circle
        cx={cx}
        cy={cy}
        r={r + 5}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.14"
        strokeDasharray="2 3"
      />
      {/* 月球暗面基底 */}
      <circle cx={cx} cy={cy} r={r} fill="url(#moon-dark-grad)" />
      {/* 月海隐约纹理 */}
      <circle cx={cx - 8} cy={cy - 6} r={6} fill="#ffffff" fillOpacity="0.04" />
      <circle cx={cx + 9} cy={cy + 7} r={7.5} fill="#ffffff" fillOpacity="0.03" />
      {/* 亮面 */}
      {litPath && <path d={litPath} fill="url(#moon-lit-grad)" />}
      {/* 月缘细环 */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#fde68a" strokeOpacity="0.28" strokeWidth="1" />
    </svg>
  )
}

function getTodayInput(): BirthInput {
  const now = new Date()
  return {
    year: Math.min(2100, Math.max(1900, now.getFullYear())),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes(),
    knowTime: true,
  }
}

export default function ZodiacConstellationTool() {
  const [input, setInput] = useState<BirthInput>(() => getTodayInput())
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('solar')
  const [viewTab, setViewTab] = useState<ViewTab>('overview')
  const [elementFilter, setElementFilter] = useState<'全部' | WesternElement>('全部')
  const [focusZodiac, setFocusZodiac] = useState<string | null>(null)
  const [selectedStarKey, setSelectedStarKey] = useState<string | null>(null)

  const profile = useMemo(() => analyzeBirthProfile(input), [input])
  const allStars = useMemo(() => getAllTwentyEightStars(), [])

  // 公历当月天数列表
  const solarDayOptions = useMemo(() => {
    const count = getSolarDayCount(input.year, input.month)
    return Array.from({ length: count }, (_, i) => i + 1)
  }, [input.year, input.month])

  // 农历当年月份列表（含闰月）
  const lunarMonthOptions = useMemo(
    () => getLunarMonthOptions(profile.lunarYear),
    [profile.lunarYear],
  )

  const activeLunarMonthMeta = useMemo(
    () =>
      lunarMonthOptions.find((m) => m.monthWithLeap === profile.lunarMonthWithLeap) ??
      lunarMonthOptions[0],
    [lunarMonthOptions, profile.lunarMonthWithLeap],
  )

  const lunarDayOptions = useMemo(
    () => Array.from({ length: activeLunarMonthMeta?.dayCount ?? 30 }, (_, i) => i + 1),
    [activeLunarMonthMeta],
  )

  // 更新公历字段
  const updateSolar = (patch: Partial<BirthInput>) => {
    setInput((prev) => {
      const next = { ...prev, ...patch }
      const maxD = getSolarDayCount(next.year, next.month)
      if (next.day > maxD) next.day = maxD
      return next
    })
  }

  // 更新农历字段并自动同步至公历
  const updateLunar = (nextYear: number, nextMonthWithLeap: number, nextDay: number) => {
    const clampedYear = Math.min(2100, Math.max(1900, nextYear))
    const converted = lunarToSolarYmd(clampedYear, nextMonthWithLeap, nextDay)
    setInput((prev) => ({
      ...prev,
      year: Math.min(2100, Math.max(1900, converted.year)),
      month: converted.month,
      day: converted.day,
    }))
  }

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(buildProfileMarkdown(profile))
      toast.success('已复制完整星历档案 Markdown')
    } catch {
      toast.error('剪贴板写入失败，请手动复制')
    }
  }

  const handleApplyBoundaryDemo = () => {
    // 2025年1月31日（农历乙巳年正月初三），已过春节但未到2月3日立春，典型双口径对照日
    setInput({
      year: 2025,
      month: 1,
      day: 31,
      hour: 12,
      minute: 0,
      knowTime: true,
    })
    toast.info('已切换至 2025-01-31（春节后、立春前），可直观对比双口径生肖')
  }

  const handleResetToday = () => {
    setInput(getTodayInput())
    toast.success('已重置为当前日期与时间')
  }

  const filteredConstellations = useMemo(() => {
    if (elementFilter === '全部') return CONSTELLATION_LIST
    return CONSTELLATION_LIST.filter((c) => c.element === elementFilter)
  }, [elementFilter])

  const activeStarDetail = useMemo(() => {
    const target = selectedStarKey ?? profile.twentyEightStar.shortName
    return allStars.find((s) => s.shortName === target) ?? allStars[0]
  }, [allStars, selectedStarKey, profile.twentyEightStar.shortName])

  const activeFocusZodiacMeta = useMemo(() => {
    const key = focusZodiac ?? profile.zodiac.lichunZodiac.key
    return ZODIAC_LIST.find((z) => z.key === key) ?? ZODIAC_LIST[0]
  }, [focusZodiac, profile.zodiac.lichunZodiac.key])

  const constellationStyle = WESTERN_ELEMENT_STYLE[profile.constellation.meta.element]
  const dayMasterStyle = WUXING_STYLE[profile.dayMaster.element]

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 pb-10">
      {/* 顶部输入控制台 */}
      <section className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm backdrop-blur-md sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Calendar className="h-4 w-4 text-primary" />
              <span>出生日期与时辰</span>
            </div>
            <Segmented
              value={calendarMode}
              onChange={(v) => setCalendarMode(v as CalendarMode)}
              options={[
                { value: 'solar', label: '公历输入' },
                { value: 'lunar', label: '农历输入' },
              ]}
              size="sm"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleApplyBoundaryDemo} className="h-8 text-xs">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              立春/春节交界示例
            </Button>
            <Button variant="ghost" size="sm" onClick={handleResetToday} className="h-8 text-xs">
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              回到今日
            </Button>
            <Button variant="secondary" size="sm" onClick={handleCopyMarkdown} className="h-8 text-xs">
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              复制报告
            </Button>
          </div>
        </div>

        {/* 日期 + 时间网格 */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.25fr_1fr]">
          {/* 左侧：日期选择 */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{calendarMode === 'solar' ? '公历年 / 月 / 日（1900–2100）' : '农历年 / 月（自动含闰月）/ 日'}</span>
              <span className="font-mono text-[11px] text-foreground/80">
                {calendarMode === 'solar' ? profile.lunarFullText : `公历 ${profile.solarYmd} ${profile.weekday}`}
              </span>
            </div>

            {calendarMode === 'solar' ? (
              <div className="grid grid-cols-3 gap-2">
                <select
                  aria-label="公历年份"
                  value={input.year}
                  onChange={(e) => updateSolar({ year: Number(e.target.value) })}
                  className="h-10 rounded-xl border border-border/80 bg-background/80 px-3 text-sm font-medium outline-none focus:border-primary"
                >
                  {YEAR_OPTIONS.map((y) => (
                    <option key={y} value={y}>
                      {y} 年
                    </option>
                  ))}
                </select>
                <select
                  aria-label="公历月份"
                  value={input.month}
                  onChange={(e) => updateSolar({ month: Number(e.target.value) })}
                  className="h-10 rounded-xl border border-border/80 bg-background/80 px-3 text-sm font-medium outline-none focus:border-primary"
                >
                  {MONTH_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m} 月
                    </option>
                  ))}
                </select>
                <select
                  aria-label="公历日期"
                  value={input.day}
                  onChange={(e) => updateSolar({ day: Number(e.target.value) })}
                  className="h-10 rounded-xl border border-border/80 bg-background/80 px-3 text-sm font-medium outline-none focus:border-primary"
                >
                  {solarDayOptions.map((d) => (
                    <option key={d} value={d}>
                      {d} 日
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <select
                  aria-label="农历年份"
                  value={profile.lunarYear}
                  onChange={(e) =>
                    updateLunar(Number(e.target.value), profile.lunarMonthWithLeap, profile.lunarDay)
                  }
                  className="h-10 rounded-xl border border-border/80 bg-background/80 px-3 text-sm font-medium outline-none focus:border-primary"
                >
                  {YEAR_OPTIONS.map((y) => (
                    <option key={y} value={y}>
                      农历 {y} 年
                    </option>
                  ))}
                </select>
                <select
                  aria-label="农历月份"
                  value={profile.lunarMonthWithLeap}
                  onChange={(e) =>
                    updateLunar(profile.lunarYear, Number(e.target.value), profile.lunarDay)
                  }
                  className="h-10 rounded-xl border border-border/80 bg-background/80 px-3 text-sm font-medium outline-none focus:border-primary"
                >
                  {lunarMonthOptions.map((m) => (
                    <option key={m.monthWithLeap} value={m.monthWithLeap}>
                      {m.name}（{m.dayCount}天）
                    </option>
                  ))}
                </select>
                <select
                  aria-label="农历日期"
                  value={profile.lunarDay}
                  onChange={(e) =>
                    updateLunar(profile.lunarYear, profile.lunarMonthWithLeap, Number(e.target.value))
                  }
                  className="h-10 rounded-xl border border-border/80 bg-background/80 px-3 text-sm font-medium outline-none focus:border-primary"
                >
                  {lunarDayOptions.map((d) => (
                    <option key={d} value={d}>
                      {LUNAR_DAY_NAMES[d - 1] ?? `${d}日`}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* 右侧：时间与时辰开关 */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                出生时间（精确影响时柱与立春交节）
              </span>
              <label className="flex cursor-pointer items-center gap-1.5 text-foreground/85">
                <span>知晓时辰</span>
                <Switch
                  checked={input.knowTime}
                  onChange={(checked) => updateSolar({ knowTime: checked })}
                  label="知晓出生时辰"
                />
              </label>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="time"
                aria-label="出生时间"
                disabled={!input.knowTime}
                value={`${String(input.hour).padStart(2, '0')}:${String(input.minute).padStart(2, '0')}`}
                onChange={(e) => {
                  const [hh, mm] = e.target.value.split(':').map(Number)
                  if (!Number.isNaN(hh) && !Number.isNaN(mm)) {
                    updateSolar({ hour: hh, minute: mm })
                  }
                }}
                className="h-10 flex-1 rounded-xl border border-border/80 bg-background/80 px-3 font-mono text-sm font-medium outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-45"
              />
              <div className="flex h-10 items-center rounded-xl border border-border/70 bg-muted/40 px-3 text-xs font-medium text-muted-foreground">
                {profile.shichenLabel}
              </div>
            </div>
          </div>
        </div>

        {/* 十二传统时辰快捷芯片 */}
        {input.knowTime && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 pt-2.5 border-t border-border/50">
            <span className="mr-1 text-[11px] text-muted-foreground">快捷选时辰：</span>
            {SHICHEN_LIST.map((sc) => {
              const active = profile.shichenLabel === sc.name
              return (
                <button
                  key={sc.branch}
                  type="button"
                  onClick={() => updateSolar({ hour: sc.sampleHour, minute: 0 })}
                  title={`${sc.name}（${sc.rangeLabel}）`}
                  className={cn(
                    'rounded-lg border px-2 py-1 text-[11px] transition-colors',
                    active
                      ? 'border-primary/50 bg-primary/12 font-semibold text-primary'
                      : 'border-border/60 bg-background/60 text-muted-foreground hover:border-border hover:text-foreground',
                  )}
                >
                  {sc.name}
                  <span className="ml-1 hidden opacity-65 sm:inline">{sc.rangeLabel.split('–')[0]}</span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* 视图切换导航 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={viewTab}
          onChange={(v) => setViewTab(v as ViewTab)}
          options={[
            { value: 'overview', label: '星历总览与八字' },
            { value: 'constellations', label: '十二星座图鉴' },
            { value: 'stars', label: '生肖与二十八宿图谱' },
          ]}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            节气：<strong className="text-foreground">{profile.solarTermDesc}</strong>
          </span>
          <span>·</span>
          <span>
            年纳音：<strong className="text-foreground">{profile.yearSound}</strong>
          </span>
          <span>·</span>
          <span>
            日纳音：<strong className="text-foreground">{profile.daySound}</strong>
          </span>
        </div>
      </div>

      {/* ==================== 视图 1：星历总览与八字 ==================== */}
      {viewTab === 'overview' && (
        <div className="flex flex-col gap-5">
          {/* 生命里程碑与公农历摘要条 */}
          <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border/70 bg-card/75 p-4 backdrop-blur-sm sm:grid-cols-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] text-muted-foreground">公历 / 农历</span>
              <span className="font-mono text-sm font-semibold text-foreground">
                {profile.solarYmd} · {profile.weekday}
              </span>
              <span className="text-xs text-muted-foreground">{profile.lunarDateText}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] text-muted-foreground">周岁 / 虚岁</span>
              <span className="text-sm font-semibold text-foreground">
                {profile.age.isFuture
                  ? '未来日期'
                  : `${profile.age.nominalAge} 周岁 · ${profile.age.virtualAge} 虚岁`}
              </span>
              <span className="text-xs text-muted-foreground">
                {profile.age.isFuture
                  ? `距该日还有 ${Math.abs(profile.age.livedDays).toLocaleString()} 天`
                  : `已走过 ${profile.age.livedDays.toLocaleString()} 个日夜`}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] text-muted-foreground">下次公历生日</span>
              <span className="text-sm font-semibold text-foreground">
                {profile.age.nextSolarBirthdayDays === 0
                  ? '就是今天 🎉'
                  : `${profile.age.nextSolarBirthdayDays} 天后`}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {profile.age.nextSolarBirthdayYmd}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] text-muted-foreground">下次农历生日</span>
              <span className="text-sm font-semibold text-foreground">
                {profile.age.nextLunarBirthdayDays === null
                  ? '—'
                  : profile.age.nextLunarBirthdayDays === 0
                    ? '就是今天 🎂'
                    : `${profile.age.nextLunarBirthdayDays} 天后`}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {profile.age.nextLunarBirthdaySolarYmd
                  ? `公历 ${profile.age.nextLunarBirthdaySolarYmd}`
                  : '—'}
              </span>
            </div>
          </div>

          {/* 4 枚星历主卡：星座 / 生肖 / 月相 / 二十八宿 */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* 1. 西方十二星座 */}
            <div
              className={cn(
                'flex flex-col justify-between gap-3 rounded-2xl border bg-card/85 p-5 shadow-sm',
                constellationStyle.borderClass,
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">西方太阳星座</span>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                        constellationStyle.badgeClass,
                      )}
                    >
                      {profile.constellation.meta.element} · {profile.constellation.meta.modality}宫
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-baseline gap-2">
                    <h2 className="text-2xl font-bold tracking-tight text-foreground">
                      {profile.constellation.meta.fullName}
                    </h2>
                    <span className="font-mono text-sm text-muted-foreground">
                      {profile.constellation.meta.enName}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {profile.constellation.meta.dateRange} · 守护星：{profile.constellation.meta.ruler}
                  </p>
                </div>
                <div
                  className={cn(
                    'flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border text-3xl',
                    constellationStyle.bgClass,
                    constellationStyle.borderClass,
                  )}
                  style={{ color: constellationStyle.color }}
                >
                  {profile.constellation.meta.symbol}
                </div>
              </div>

              <p className="text-xs leading-relaxed text-muted-foreground">
                {profile.constellation.meta.summary}
              </p>

              <div className="flex flex-wrap gap-1.5">
                {profile.constellation.meta.traits.map((t) => (
                  <span
                    key={t}
                    className="rounded-lg border border-border/70 bg-muted/40 px-2.5 py-0.5 text-xs text-foreground/85"
                  >
                    {t}
                  </span>
                ))}
              </div>

              {profile.constellation.isCusp && profile.constellation.cuspNote && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{profile.constellation.cuspNote}</span>
                </div>
              )}
            </div>

            {/* 2. 十二生肖（立春 / 春节双口径） */}
            <div className="flex flex-col justify-between gap-3 rounded-2xl border border-border/75 bg-card/85 p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">十二生肖 · 双口径对照</span>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                        profile.zodiac.isSame
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                          : 'border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300',
                      )}
                    >
                      {profile.zodiac.isSame ? '双口径一致' : '岁首交界差异'}
                    </span>
                  </div>

                  {profile.zodiac.isSame ? (
                    <div className="mt-1.5 flex items-baseline gap-2.5">
                      <h2 className="text-2xl font-bold tracking-tight text-foreground">
                        属{profile.zodiac.lichunZodiac.key}
                      </h2>
                      <span className="text-sm text-muted-foreground">
                        {profile.zodiac.lichunZodiac.branch} · 五行属{profile.zodiac.lichunZodiac.element}
                      </span>
                    </div>
                  ) : (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-primary/30 bg-primary/8 px-3 py-2">
                        <div className="text-[11px] text-muted-foreground">立春交节（命理口径）</div>
                        <div className="mt-0.5 text-base font-bold text-foreground">
                          {profile.zodiac.lichunZodiac.emoji} 属{profile.zodiac.lichunZodiac.key}
                        </div>
                      </div>
                      <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2">
                        <div className="text-[11px] text-muted-foreground">农历春节（民俗口径）</div>
                        <div className="mt-0.5 text-base font-bold text-foreground">
                          {profile.zodiac.springFestivalZodiac.emoji} 属
                          {profile.zodiac.springFestivalZodiac.key}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-muted/40 text-3xl">
                  {profile.zodiac.lichunZodiac.emoji}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 rounded-xl border border-border/60 bg-muted/25 p-2.5 text-[11px]">
                <div>
                  <div className="text-muted-foreground">{input.year} 年正月初一（春节）</div>
                  <div className="mt-0.5 font-mono font-semibold text-foreground">
                    {profile.zodiac.springFestivalDateStr}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">{input.year} 年立春精确交节</div>
                  <div className="mt-0.5 font-mono font-semibold text-foreground">
                    {profile.zodiac.lichunTimeStr}
                  </div>
                </div>
              </div>

              <p className="text-xs leading-relaxed text-muted-foreground">
                {profile.zodiac.boundaryNote}
              </p>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">
                  三合：{profile.zodiac.lichunZodiac.sanHe.join(' · ')}
                </span>
                <span className="rounded-lg border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-sky-700 dark:text-sky-400">
                  六合：{profile.zodiac.lichunZodiac.liuHe}
                </span>
                <span className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-2 py-0.5 text-rose-700 dark:text-rose-400">
                  六冲：{profile.zodiac.lichunZodiac.liuChong}
                </span>
              </div>
            </div>

            {/* 3. 出生月相 */}
            <div className="flex items-center gap-4 rounded-2xl border border-border/75 bg-card/85 p-5 shadow-sm">
              <MoonPhaseSvg cycleProgress={profile.moonPhase.cycleProgress} size={82} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <Moon className="h-3.5 w-3.5 text-amber-500" />
                    出生日对应月相
                  </span>
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] text-amber-700 dark:text-amber-300">
                    照明约 {Math.round(profile.moonPhase.illumination * 100)}%
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <h3 className="text-xl font-bold text-foreground">{profile.moonPhase.name}</h3>
                  <span className="font-mono text-xs text-muted-foreground">
                    {profile.moonPhase.enName}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  农历{LUNAR_DAY_NAMES[profile.moonPhase.lunarDayNumber - 1]} · 本阶段第{' '}
                  {profile.moonPhase.dayInPhase} 天
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {profile.moonPhase.desc}
                </p>
              </div>
            </div>

            {/* 4. 东方二十八宿 */}
            <div
              className={cn(
                'flex flex-col justify-between gap-2.5 rounded-2xl border bg-card/85 p-5 shadow-sm',
                profile.twentyEightStar.beast.borderClass,
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      <Star className="h-3.5 w-3.5 text-primary" />
                      东方二十八宿（值日星宿）
                    </span>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                        profile.twentyEightStar.beast.badgeClass,
                      )}
                    >
                      {profile.twentyEightStar.beast.title}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-baseline gap-2.5">
                    <h3 className="text-2xl font-bold text-foreground">
                      {profile.twentyEightStar.fullName}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {profile.twentyEightStar.shortName}宿 · {profile.twentyEightStar.sevenStar}曜 ·{' '}
                      {profile.twentyEightStar.land}
                    </span>
                  </div>
                </div>
                <div
                  className={cn(
                    'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border text-xl font-bold',
                    profile.twentyEightStar.beast.bgClass,
                    profile.twentyEightStar.beast.borderClass,
                  )}
                  style={{ color: profile.twentyEightStar.beast.color }}
                >
                  {profile.twentyEightStar.shortName}
                </div>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {profile.twentyEightStar.lore}
              </p>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  方位：{profile.twentyEightStar.zoneDirection}方{profile.twentyEightStar.beast.beast} · 星禽：
                  {profile.twentyEightStar.animal}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedStarKey(profile.twentyEightStar.shortName)
                    setViewTab('stars')
                  }}
                  className="font-medium text-primary hover:underline"
                >
                  查看二十八宿全图谱 →
                </button>
              </div>
            </div>
          </div>

          {/* 干支八字排盘 + 五行分布 */}
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_1fr]">
            {/* 左侧：四柱八字详盘 */}
            <div className="flex flex-col gap-4 rounded-2xl border border-border/75 bg-card/85 p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Compass className="h-4 w-4 text-primary" />
                  <h3 className="text-base font-bold text-foreground">干支四柱八字排盘</h3>
                </div>
                <span className="text-xs text-muted-foreground">
                  严格按节气交节精确换年换月 · 纳音五行与地支藏干
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {profile.pillars.map((pillar) => {
                  const stemWx = WUXING_STYLE[pillar.stemElement]
                  const branchWx = WUXING_STYLE[pillar.branchElement]
                  const isDay = pillar.label === '日柱'
                  return (
                    <div
                      key={pillar.label}
                      className={cn(
                        'flex flex-col items-center rounded-xl border p-3 text-center transition-colors',
                        isDay
                          ? 'border-primary/45 bg-primary/5'
                          : 'border-border/70 bg-background/60',
                        !pillar.known && 'border-dashed opacity-70',
                      )}
                    >
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {pillar.label}
                      </span>
                      <span
                        className={cn(
                          'mt-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          isDay
                            ? 'bg-primary/15 text-primary'
                            : 'bg-muted/70 text-foreground/80',
                        )}
                      >
                        {pillar.tenStar}
                      </span>

                      {/* 天干 */}
                      <div className="mt-2.5 flex items-center gap-1.5">
                        <span
                          className={cn(
                            'flex h-11 w-11 items-center justify-center rounded-xl border text-2xl font-bold',
                            pillar.known
                              ? cn(stemWx.bgClass, stemWx.textClass, stemWx.borderClass)
                              : 'border-border/70 bg-muted/40 text-muted-foreground',
                          )}
                        >
                          {pillar.stem}
                        </span>
                      </div>
                      <span className="mt-1 text-[11px] text-muted-foreground">
                        {pillar.known ? `${pillar.stemYinYang}${pillar.stemElement}` : '待填'}
                      </span>

                      {/* 地支 */}
                      <div className="mt-2 flex items-center gap-1.5">
                        <span
                          className={cn(
                            'flex h-11 w-11 items-center justify-center rounded-xl border text-2xl font-bold',
                            pillar.known
                              ? cn(branchWx.bgClass, branchWx.textClass, branchWx.borderClass)
                              : 'border-border/70 bg-muted/40 text-muted-foreground',
                          )}
                        >
                          {pillar.branch}
                        </span>
                      </div>
                      <span className="mt-1 text-[11px] text-muted-foreground">
                        {pillar.known
                          ? `${pillar.branchYinYang}${pillar.branchElement} · ${pillar.branchZodiac}`
                          : '待填'}
                      </span>

                      {/* 藏干 */}
                      <div className="mt-2.5 w-full border-t border-border/50 pt-2">
                        <div className="text-[10px] text-muted-foreground">地支藏干</div>
                        <div className="mt-1 flex flex-wrap justify-center gap-1">
                          {pillar.known ? (
                            pillar.hiddenStems.map((h) => (
                              <span
                                key={`${pillar.label}-${h.stem}`}
                                className={cn(
                                  'rounded px-1.5 py-0.5 text-[10px] font-medium',
                                  WUXING_STYLE[h.element].bgClass,
                                  WUXING_STYLE[h.element].textClass,
                                )}
                                title={`${h.role}：${h.stem}（${h.element}）`}
                              >
                                {h.stem}
                                {h.element}
                              </span>
                            ))
                          ) : (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          )}
                        </div>
                      </div>

                      {/* 纳音 / 十二长生 / 旬空 */}
                      <div className="mt-2 w-full space-y-1 border-t border-border/50 pt-2 text-[11px]">
                        <div className="font-semibold text-foreground/90">{pillar.sound}</div>
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>长生：{pillar.terrain}</span>
                          <span>空：{pillar.kongWang}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* 命宫 / 身宫 / 胎元 / 胎息 */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: '命宫', value: profile.extraSigns.ownSign },
                  { label: '身宫', value: profile.extraSigns.bodySign },
                  { label: '胎元', value: profile.extraSigns.fetalOrigin },
                  { label: '胎息', value: profile.extraSigns.fetalBreath },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-xs"
                  >
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="font-semibold text-foreground">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 右侧：日主与五行分布 */}
            <div className="flex flex-col justify-between gap-4 rounded-2xl border border-border/75 bg-card/85 p-5 shadow-sm">
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Flame className="h-4 w-4 text-primary" />
                    <h3 className="text-base font-bold text-foreground">日主与五行分布</h3>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    按 {profile.wuXingStats.total} 字本气统计
                  </span>
                </div>

                {/* 日主摘要卡 */}
                <div
                  className={cn(
                    'flex items-center justify-between rounded-xl border p-3.5',
                    dayMasterStyle.bgClass,
                    dayMasterStyle.borderClass,
                  )}
                >
                  <div>
                    <div className="text-[11px] text-muted-foreground">日主（出生日天干）</div>
                    <div className={cn('mt-0.5 text-xl font-bold', dayMasterStyle.textClass)}>
                      {profile.dayMaster.stem}
                      {profile.dayMaster.element} · {profile.dayMaster.yinYang}
                      {profile.dayMaster.element}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      方位属{dayMasterStyle.direction} · 生「{dayMasterStyle.generates}」 · 克「
                      {dayMasterStyle.overcomes}」
                    </div>
                  </div>
                  <div
                    className={cn(
                      'flex h-12 w-12 items-center justify-center rounded-xl border text-2xl font-bold',
                      dayMasterStyle.borderClass,
                      dayMasterStyle.textClass,
                    )}
                  >
                    {profile.dayMaster.stem}
                  </div>
                </div>

                {/* 五行条形分布 */}
                <div className="space-y-2.5">
                  {WUXING_ORDER.map((wx) => {
                    const style = WUXING_STYLE[wx]
                    const count = profile.wuXingStats.counts[wx]
                    const pct =
                      profile.wuXingStats.total > 0
                        ? Math.round((count / profile.wuXingStats.total) * 100)
                        : 0
                    return (
                      <div key={wx} className="flex items-center gap-2.5 text-xs">
                        <span
                          className={cn(
                            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border font-bold',
                            style.bgClass,
                            style.textClass,
                            style.borderClass,
                          )}
                        >
                          {wx}
                        </span>
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted/60">
                          <div
                            className={cn('h-full rounded-full transition-all duration-300', style.barClass)}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-16 text-right font-mono text-muted-foreground">
                          {count} 个 ({pct}%)
                        </span>
                      </div>
                    )
                  })}
                </div>

                {/* 偏旺 / 缺失概览 */}
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-lg border border-border/70 bg-muted/35 px-2.5 py-1 text-foreground/85">
                    占比最高：{profile.wuXingStats.dominant.join('、')}
                  </span>
                  <span className="rounded-lg border border-border/70 bg-muted/35 px-2.5 py-1 text-foreground/85">
                    {profile.wuXingStats.missing.length > 0
                      ? `本气未现：${profile.wuXingStats.missing.join('、')}`
                      : '五行俱全（木火土金水均有）'}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  干支、纳音、十神与星宿数据均由本地天文历法库 <code>tyme4ts</code> 精确计算，传统文化符号与五行比例仅供历法学习与趣味参考。
                </span>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ==================== 视图 2：十二星座图鉴 ==================== */}
      {viewTab === 'constellations' && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card/80 p-4">
            <div>
              <h2 className="text-base font-bold text-foreground">黄道十二星座与四象星图</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                当前出生日期对应{' '}
                <strong className="text-foreground">
                  {profile.constellation.meta.symbol} {profile.constellation.meta.fullName}
                </strong>
                （{profile.constellation.meta.element} · {profile.constellation.meta.dateRange}）
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['全部', '火象', '土象', '风象', '水象'] as const).map((el) => (
                <button
                  key={el}
                  type="button"
                  onClick={() => setElementFilter(el)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                    elementFilter === el
                      ? 'border-primary/50 bg-primary/12 text-primary'
                      : 'border-border/70 bg-background/70 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {el}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {filteredConstellations.map((c) => {
              const style = WESTERN_ELEMENT_STYLE[c.element]
              const isMine = c.key === profile.constellation.meta.key
              const isCuspNeighbor =
                profile.constellation.isCusp && profile.constellation.cuspNeighbor?.key === c.key
              return (
                <div
                  key={c.key}
                  className={cn(
                    'flex flex-col justify-between gap-3 rounded-2xl border bg-card/85 p-4 transition-all',
                    isMine
                      ? 'border-primary ring-2 ring-primary/20'
                      : isCuspNeighbor
                        ? 'border-amber-500/50 bg-amber-500/5'
                        : 'border-border/70 hover:border-border',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="text-base font-bold text-foreground">{c.fullName}</h3>
                        <span className="font-mono text-xs text-muted-foreground">{c.enName}</span>
                        {isMine && (
                          <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                            当前星座
                          </span>
                        )}
                        {isCuspNeighbor && (
                          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                            交界邻座
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{c.dateRange}</div>
                    </div>
                    <div
                      className={cn(
                        'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-2xl',
                        style.bgClass,
                        style.borderClass,
                      )}
                      style={{ color: style.color }}
                    >
                      {c.symbol}
                    </div>
                  </div>

                  <p className="text-xs leading-relaxed text-muted-foreground">{c.summary}</p>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2.5 text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <span className={cn('rounded-md border px-1.5 py-0.5 font-medium', style.badgeClass)}>
                        {c.element}
                      </span>
                      <span className="text-muted-foreground">{c.modality}宫</span>
                      <span className="text-muted-foreground">· 守护星 {c.ruler}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        updateSolar({ month: c.startMd[0], day: c.startMd[1] })
                        setViewTab('overview')
                      }}
                      className="text-primary hover:underline"
                    >
                      查看交界日
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ==================== 视图 3：生肖与二十八宿图谱 ==================== */}
      {viewTab === 'stars' && (
        <div className="flex flex-col gap-5">
          {/* 十二生肖地支关系图谱 */}
          <section className="rounded-2xl border border-border/75 bg-card/85 p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
              <div>
                <h2 className="text-base font-bold text-foreground">十二生肖地支与三合六合六冲对照</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  点击任意生肖可高亮其三合、六合与六冲关系；当前聚焦：
                  <strong className="text-foreground">
                    {activeFocusZodiacMeta.emoji} 属{activeFocusZodiacMeta.key}（{activeFocusZodiacMeta.branch}
                    {activeFocusZodiacMeta.element}）
                  </strong>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="rounded-md border border-emerald-500/30 bg-emerald-500/12 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">
                  三合：{activeFocusZodiacMeta.sanHe.join(' · ')}
                </span>
                <span className="rounded-md border border-sky-500/30 bg-sky-500/12 px-2 py-0.5 text-sky-700 dark:text-sky-400">
                  六合：{activeFocusZodiacMeta.liuHe}
                </span>
                <span className="rounded-md border border-rose-500/30 bg-rose-500/12 px-2 py-0.5 text-rose-700 dark:text-rose-400">
                  六冲：{activeFocusZodiacMeta.liuChong}
                </span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
              {ZODIAC_LIST.map((z) => {
                const isFocused = z.key === activeFocusZodiacMeta.key
                const isMyLichun = z.key === profile.zodiac.lichunZodiac.key
                const isMySpring =
                  !profile.zodiac.isSame && z.key === profile.zodiac.springFestivalZodiac.key
                const isSanHe = activeFocusZodiacMeta.sanHe.includes(z.key)
                const isLiuHe = activeFocusZodiacMeta.liuHe === z.key
                const isLiuChong = activeFocusZodiacMeta.liuChong === z.key

                return (
                  <button
                    key={z.key}
                    type="button"
                    onClick={() => setFocusZodiac(z.key)}
                    className={cn(
                      'flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all',
                      isFocused
                        ? 'border-primary bg-primary/10 ring-2 ring-primary/20'
                        : isSanHe
                          ? 'border-emerald-500/45 bg-emerald-500/8'
                          : isLiuHe
                            ? 'border-sky-500/45 bg-sky-500/8'
                            : isLiuChong
                              ? 'border-rose-500/45 bg-rose-500/8'
                              : 'border-border/70 bg-background/60 hover:border-border',
                    )}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="text-2xl">{z.emoji}</span>
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                          WUXING_STYLE[z.element].bgClass,
                          WUXING_STYLE[z.element].textClass,
                        )}
                      >
                        {z.branch} · {z.element}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <span className="text-sm font-bold text-foreground">属{z.key}</span>
                      {isMyLichun && (
                        <span className="rounded bg-primary/15 px-1 text-[10px] font-medium text-primary">
                          本命
                        </span>
                      )}
                      {isMySpring && (
                        <span className="rounded bg-amber-500/15 px-1 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                          春节
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {isFocused
                        ? '当前选中'
                        : isSanHe
                          ? '三合'
                          : isLiuHe
                            ? '六合'
                            : isLiuChong
                              ? '六冲'
                              : `合${z.liuHe} 冲${z.liuChong}`}
                    </div>
                  </button>
                )
              })}
            </div>

            <p className="mt-3 text-xs text-muted-foreground">{activeFocusZodiacMeta.summary}</p>
          </section>

          {/* 东方二十八星宿四象图谱 */}
          <section className="rounded-2xl border border-border/75 bg-card/85 p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
              <div>
                <h2 className="text-base font-bold text-foreground">东方四象 · 二十八星宿全图谱</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  中国古代天文学将黄道与天赤道附近星空划分为四象二十八宿，点击任意星宿查看古天文释义
                </p>
              </div>
              <span className="rounded-full border border-primary/35 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                出生值日宿：{profile.twentyEightStar.fullName}
              </span>
            </div>

            {/* 当前选中星宿详情条 */}
            <div className="mt-4 rounded-xl border border-border/70 bg-muted/30 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-foreground">{activeStarDetail.fullName}</span>
                  <span className="text-xs text-muted-foreground">
                    {activeStarDetail.direction}方{activeStarDetail.beast} · {activeStarDetail.sevenStar}曜 ·
                    禽象「{activeStarDetail.animal}」 · {activeStarDetail.land}
                  </span>
                </div>
                <span className="rounded-md border border-border/70 bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">
                  传统历注：{activeStarDetail.luck}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {activeStarDetail.lore}
              </p>
            </div>

            {/* 四象分组 4×7 网格 */}
            <div className="mt-4 grid grid-cols-1 gap-3.5 md:grid-cols-2">
              {FOUR_BEAST_GROUPS.map((group) => {
                const groupStars = group.stars
                  .map((name) => allStars.find((s) => s.shortName === name))
                  .filter((s): s is NonNullable<typeof s> => Boolean(s))
                return (
                  <div
                    key={group.beast}
                    className={cn('rounded-xl border p-3.5', group.borderClass, group.bgClass)}
                  >
                    <div className="mb-2.5 flex items-center justify-between">
                      <span className="text-sm font-bold text-foreground">{group.title}</span>
                      <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', group.badgeClass)}>
                        {group.direction}方 · 七宿
                      </span>
                    </div>
                    <div className="grid grid-cols-7 gap-1.5">
                      {groupStars.map((st) => {
                        const isBirthStar = st.shortName === profile.twentyEightStar.shortName
                        const isSelected = st.shortName === activeStarDetail.shortName
                        return (
                          <button
                            key={st.shortName}
                            type="button"
                            onClick={() => setSelectedStarKey(st.shortName)}
                            className={cn(
                              'flex flex-col items-center rounded-lg border py-2 text-center transition-all',
                              isSelected
                                ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                                : isBirthStar
                                  ? 'border-primary/60 bg-primary/15 text-primary font-bold'
                                  : 'border-border/60 bg-background/80 text-foreground hover:border-border',
                            )}
                          >
                            <span className="text-sm font-bold">{st.shortName}</span>
                            <span className="mt-0.5 text-[9px] opacity-80">
                              {st.sevenStar}
                              {st.animal}
                            </span>
                          </button>
                        )
                      })}
                    </div>
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
