import {
  JulianDay,
  LunarDay,
  LunarYear,
  SolarDay,
  SolarMonth,
} from 'tyme4ts'

export type WeekStart = 'mon' | 'sun'

export interface LunarMonthOption {
  monthWithLeap: number
  name: string
  isLeap: boolean
  dayCount: number
}

export interface CalendarCell {
  /** 唯一键值 YYYY-MM-DD */
  ymd: string
  year: number
  month: number
  day: number
  /** 是否属于当前浏览的公历月份 */
  isCurrentMonth: boolean
  /** 是否今天 */
  isToday: boolean
  /** 是否周末（周六/周日） */
  isWeekend: boolean
  /** 单元格下方主副标题（节气 > 农历节日 > 公历节日 > 初一月名 > 农历日名） */
  subLabel: string
  /** 副标题语义高亮类别 */
  subKind: 'term' | 'festival' | 'lunar-month' | 'lunar'
  /** 法定节假日状态：rest=休, work=班 */
  holidayStatus: 'rest' | 'work' | null
  holidayName: string | null
  /** 干支日（用于高信息密度展示） */
  dayGanZhi: string
  /** 是否匹配当前择日事项（宜） */
  matchesAuspicious: boolean
}

export interface HourLuckInfo {
  /** 时辰序号 0..11 */
  index: number
  /** 传统时辰时段，如 23:00–00:59 */
  timeRange: string
  /** 干支时名，如 壬子时 */
  name: string
  /** 时柱干支 */
  ganZhi: string
  /** 值日十二神，如 司命 */
  twelveStar: string
  /** 黄道 / 黑道 */
  ecliptic: string
  /** 吉 / 凶 */
  luck: '吉' | '凶'
  /** 该时辰宜 */
  recommends: string[]
  /** 该时辰忌 */
  avoids: string[]
}

export interface DayAlmanacDetail {
  ymd: string
  year: number
  month: number
  day: number
  weekday: string
  /** 距今天数（0=今天，>0 未来，<0 过去） */
  diffFromToday: number
  /** 当年第几天 */
  dayOfYear: number
  /** 农历信息 */
  lunarYear: number
  lunarMonthWithLeap: number
  lunarDay: number
  lunarYearGanZhi: string
  lunarZodiac: string
  lunarDateText: string
  lunarFullText: string
  /** 干支三柱与日纳音 */
  yearGanZhi: string
  monthGanZhi: string
  dayGanZhi: string
  daySound: string
  /** 藏历（1951–2050 精确值，超出为 null） */
  rabByungText: string | null
  /** 儒略日 */
  julianDay: number
  /** 星座 */
  constellation: string
  /** 节气 / 物候 / 三伏数九梅雨 */
  solarTermText: string
  isSolarTermExactDay: boolean
  phenologyText: string
  cycleTags: string[]
  /** 节日列表（公历/农历/法定） */
  festivals: string[]
  holidayStatus: 'rest' | 'work' | null
  holidayName: string | null
  /** 月相 */
  phaseName: string
  phaseDayIndex: number
  cycleProgress: number
  illumination: number
  /** 黄历宜忌 */
  recommends: string[]
  avoids: string[]
  /** 建除十二值星 / 十二神黄黑道 / 六曜 */
  duty: string
  twelveStar: string
  twelveStarEcliptic: string
  twelveStarLuck: '吉' | '凶'
  sixStar: string
  /** 冲煞 */
  chongDesc: string
  shaDir: string
  /** 九星 */
  nineStarFull: string
  nineStarColor: string
  nineStarElement: string
  nineStarDipper: string
  nineStarDirection: string
  /** 胎神与彭祖百忌 */
  fetusDay: string
  pengZu: string
  /** 二十八宿 */
  twentyEightStar: string
  twentyEightStarZone: string
  /** 吉神宜趋 / 凶神宜忌 */
  goodGods: string[]
  badGods: string[]
  /** 吉神方位 */
  directions: {
    joy: string
    wealth: string
    mascot: string
    yangNoble: string
    yinNoble: string
    taiSui: string
  }
  /** 当日十二时辰吉凶 */
  hours: HourLuckInfo[]
}

export interface LunarBirthdayResult {
  lunarYear: number
  lunarYearGanZhi: string
  zodiac: string
  lunarDateText: string
  solarYmd: string
  weekday: string
  diffFromToday: number
  /** 若查询闰月但在该年无该闰月，标示已自动按平月计算 */
  fallbackToNormalMonth: boolean
  solarYear: number
  solarMonth: number
  solarDay: number
}

/** 常用择日快捷事项 */
export const AUSPICIOUS_PRESETS: { label: string; taboo: string }[] = [
  { label: '嫁娶', taboo: '嫁娶' },
  { label: '搬家(移徙)', taboo: '移徙' },
  { label: '入宅', taboo: '入宅' },
  { label: '出行', taboo: '出行' },
  { label: '开市', taboo: '开市' },
  { label: '签约(立券)', taboo: '立券' },
  { label: '动土', taboo: '动土' },
  { label: '装修(修造)', taboo: '修造' },
  { label: '安床', taboo: '安床' },
  { label: '祈福', taboo: '祈福' },
]

export const LUNAR_MONTH_NAMES = [
  '正月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '十一月',
  '十二月',
]

export const LUNAR_DAY_NAMES = [
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

const HOUR_TIME_RANGES = [
  '23:00–00:59',
  '01:00–02:59',
  '03:00–04:59',
  '05:00–06:59',
  '07:00–08:59',
  '09:00–10:59',
  '11:00–12:59',
  '13:00–14:59',
  '15:00–16:59',
  '17:00–18:59',
  '19:00–20:59',
  '21:00–22:59',
]

const pad2 = (n: number) => String(n).padStart(2, '0')

export function formatYmd(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`
}

export function getSolarDayCount(year: number, month: number): number {
  return SolarMonth.fromYm(year, month).getDayCount()
}

export function getLunarMonthOptions(lunarYear: number): LunarMonthOption[] {
  const safeYear = Math.min(2100, Math.max(1900, lunarYear))
  return LunarYear.fromYear(safeYear)
    .getMonths()
    .map((m) => ({
      monthWithLeap: m.getMonthWithLeap(),
      name: m.getName(),
      isLeap: m.isLeap(),
      dayCount: m.getDayCount(),
    }))
}

export function lunarToSolarYmd(
  lunarYear: number,
  monthWithLeap: number,
  lunarDay: number,
): { year: number; month: number; day: number } {
  const safeYear = Math.min(2100, Math.max(1900, lunarYear))
  const opts = getLunarMonthOptions(safeYear)
  const matched = opts.find((m) => m.monthWithLeap === monthWithLeap) ?? opts[0]
  const safeDay = Math.min(Math.max(1, lunarDay), matched.dayCount)
  const sd = LunarDay.fromYmd(safeYear, matched.monthWithLeap, safeDay).getSolarDay()
  return { year: sd.getYear(), month: sd.getMonth(), day: sd.getDay() }
}

/** 儒略日转公历日期（安全约束在 1900–2100 年内） */
export function julianDayToSolarYmd(
  jd: number,
): { year: number; month: number; day: number } | null {
  if (!Number.isFinite(jd) || jd < 2415020 || jd > 2488435) {
    return null
  }
  try {
    const sd = JulianDay.fromJulianDay(jd).getSolarDay()
    if (sd.getYear() < 1900 || sd.getYear() > 2100) return null
    return { year: sd.getYear(), month: sd.getMonth(), day: sd.getDay() }
  } catch {
    return null
  }
}

/** 安全读取藏历（tyme4ts 支持 1951–2050 年） */
function safeGetRabByungText(sd: SolarDay): string | null {
  try {
    return sd.getRabByungDay().toString()
  } catch {
    return null
  }
}

/** 构建整月 6×7 日历网格（含节气、节日、法定休班与择日事项高亮） */
export function buildMonthGrid(
  year: number,
  month: number,
  weekStart: WeekStart = 'mon',
  auspiciousTaboo: string | null = null,
  refDate: Date = new Date(),
): CalendarCell[] {
  const safeYear = Math.min(2100, Math.max(1900, year))
  const safeMonth = Math.min(12, Math.max(1, month))
  const firstDay = SolarDay.fromYmd(safeYear, safeMonth, 1)
  const firstWeekIndex = firstDay.getWeek().getIndex() // 0=日, 1=一, ..., 6=六
  const leading = weekStart === 'mon' ? (firstWeekIndex + 6) % 7 : firstWeekIndex

  const todayYmd = formatYmd(refDate.getFullYear(), refDate.getMonth() + 1, refDate.getDate())
  const startDay = firstDay.next(-leading)
  const cells: CalendarCell[] = []

  for (let i = 0; i < 42; i++) {
    const sd = startDay.next(i)
    const y = sd.getYear()
    const m = sd.getMonth()
    const d = sd.getDay()
    const ymd = formatYmd(y, m, d)
    const ld = sd.getLunarDay()
    const scd = sd.getSixtyCycleDay()
    const wIdx = sd.getWeek().getIndex()

    // 决定单元格副标签优先级：节气首日 > 农历节日 > 公历节日 > 初一月名 > 农历日名
    const termDay = sd.getTermDay()
    const lunarFest = ld.getFestival()
    const solarFest = sd.getFestival()

    let subLabel = ld.getName()
    let subKind: CalendarCell['subKind'] = 'lunar'

    if (termDay.getDayIndex() === 0) {
      subLabel = termDay.getSolarTerm().getName()
      subKind = 'term'
    } else if (lunarFest) {
      subLabel = lunarFest.getName()
      subKind = 'festival'
    } else if (solarFest) {
      subLabel = solarFest.getName()
      subKind = 'festival'
    } else if (ld.getDay() === 1) {
      subLabel = ld.getLunarMonth().getName()
      subKind = 'lunar-month'
    }

    const holiday = sd.getLegalHoliday()
    const holidayStatus: CalendarCell['holidayStatus'] = holiday
      ? holiday.isWork()
        ? 'work'
        : 'rest'
      : null

    let matchesAuspicious = false
    if (auspiciousTaboo) {
      matchesAuspicious = scd.getRecommends().some((t) => t.getName() === auspiciousTaboo)
    }

    cells.push({
      ymd,
      year: y,
      month: m,
      day: d,
      isCurrentMonth: y === safeYear && m === safeMonth,
      isToday: ymd === todayYmd,
      isWeekend: wIdx === 0 || wIdx === 6,
      subLabel,
      subKind,
      holidayStatus,
      holidayName: holiday ? holiday.getName() : null,
      dayGanZhi: scd.getSixtyCycle().getName(),
      matchesAuspicious,
    })
  }

  return cells
}

/** 获取指定公历日期的完整万年历与老黄历详情 */
export function getDayAlmanac(
  year: number,
  month: number,
  day: number,
  refDate: Date = new Date(),
): DayAlmanacDetail {
  const safeYear = Math.min(2100, Math.max(1900, year))
  const safeMonth = Math.min(12, Math.max(1, month))
  const safeDay = Math.min(getSolarDayCount(safeYear, safeMonth), Math.max(1, day))

  const sd = SolarDay.fromYmd(safeYear, safeMonth, safeDay)
  const ld = sd.getLunarDay()
  const scd = sd.getSixtyCycleDay()
  const today = SolarDay.fromYmd(refDate.getFullYear(), refDate.getMonth() + 1, refDate.getDate())

  // 干支与五行
  const dayCycle = scd.getSixtyCycle()
  const hs = dayCycle.getHeavenStem()
  const eb = dayCycle.getEarthBranch()
  const lunarYearCycle = ld.getLunarMonth().getLunarYear().getSixtyCycle()
  const lunarZodiac = lunarYearCycle.getEarthBranch().getZodiac().getName()

  // 节日汇总
  const festivals: string[] = []
  const lunarFest = ld.getFestival()
  const solarFest = sd.getFestival()
  const holiday = sd.getLegalHoliday()
  if (lunarFest) festivals.push(lunarFest.getName())
  if (solarFest && !festivals.includes(solarFest.getName())) festivals.push(solarFest.getName())

  // 节气、物候与传统民俗周期
  const termDay = sd.getTermDay()
  const isSolarTermExactDay = termDay.getDayIndex() === 0
  const solarTermText = isSolarTermExactDay
    ? `今日${termDay.getSolarTerm().getName()}`
    : `${termDay.getSolarTerm().getName()}第 ${termDay.getDayIndex() + 1} 天`
  const phenoDay = sd.getPhenologyDay()
  const phenologyText = `${phenoDay.getPhenology().getName()}（第 ${phenoDay.getDayIndex() + 1} 天）`

  const cycleTags: string[] = []
  const nineDay = sd.getNineDay()
  if (nineDay) cycleTags.push(nineDay.toString())
  const dogDay = sd.getDogDay()
  if (dogDay) cycleTags.push(dogDay.toString())
  const plumDay = sd.getPlumRainDay()
  if (plumDay) cycleTags.push(plumDay.toString())

  // 月相
  const phaseDay = sd.getPhaseDay()
  const lunarMonthDays = ld.getLunarMonth().getDayCount()
  const cycleProgress = Math.max(0, Math.min(1, (ld.getDay() - 1) / lunarMonthDays))
  const illumination = (1 - Math.cos(cycleProgress * 2 * Math.PI)) / 2

  // 十二神黄黑道
  const twelveStar = scd.getTwelveStar()
  const ecliptic = twelveStar.getEcliptic()

  // 九星
  const nineStar = ld.getNineStar()

  // 二十八宿
  const star28 = ld.getTwentyEightStar()
  const star28Full = `${star28.getName()}${star28.getSevenStar().getName()}${star28.getAnimal().getName()}`
  const star28Zone = `${star28.getZone().getName()}方${star28.getZone().getBeast().getName()}`

  // 吉神 / 凶煞分组
  const goodGods: string[] = []
  const badGods: string[] = []
  for (const g of scd.getGods()) {
    if (g.getLuck().getName() === '吉') {
      goodGods.push(g.getName())
    } else {
      badGods.push(g.getName())
    }
  }

  // 当日十二时辰吉凶
  const hours: HourLuckInfo[] = scd.getHours().map((h, idx) => {
    const hStar = h.getTwelveStar()
    const hEcliptic = hStar.getEcliptic()
    return {
      index: idx,
      timeRange: HOUR_TIME_RANGES[idx] ?? '',
      name: h.getName(),
      ganZhi: h.getSixtyCycle().getName(),
      twelveStar: hStar.getName(),
      ecliptic: hEcliptic.getName(),
      luck: hEcliptic.getLuck().getName() === '吉' ? '吉' : '凶',
      recommends: h.getRecommends().map((t) => t.getName()),
      avoids: h.getAvoids().map((t) => t.getName()),
    }
  })

  const lunarDateText = `${ld.getLunarMonth().getName()}${ld.getName()}`

  return {
    ymd: formatYmd(safeYear, safeMonth, safeDay),
    year: safeYear,
    month: safeMonth,
    day: safeDay,
    weekday: `星期${sd.getWeek().getName()}`,
    diffFromToday: sd.subtract(today),
    dayOfYear: sd.getIndexInYear() + 1,
    lunarYear: ld.getYear(),
    lunarMonthWithLeap: ld.getLunarMonth().getMonthWithLeap(),
    lunarDay: ld.getDay(),
    lunarYearGanZhi: lunarYearCycle.getName(),
    lunarZodiac,
    lunarDateText,
    lunarFullText: `农历 ${lunarYearCycle.getName()}(${lunarZodiac})年 ${lunarDateText}`,
    yearGanZhi: scd.getYear().getName(),
    monthGanZhi: scd.getMonth().getName(),
    dayGanZhi: dayCycle.getName(),
    daySound: dayCycle.getSound().getName(),
    rabByungText: safeGetRabByungText(sd),
    julianDay: sd.getJulianDay().getDay(),
    constellation: `${sd.getConstellation().getName()}座`,
    solarTermText,
    isSolarTermExactDay,
    phenologyText,
    cycleTags,
    festivals,
    holidayStatus: holiday ? (holiday.isWork() ? 'work' : 'rest') : null,
    holidayName: holiday ? holiday.getName() : null,
    phaseName: phaseDay.getPhase().getName(),
    phaseDayIndex: phaseDay.getDayIndex() + 1,
    cycleProgress,
    illumination,
    recommends: scd.getRecommends().map((t) => t.getName()),
    avoids: scd.getAvoids().map((t) => t.getName()),
    duty: scd.getDuty().getName(),
    twelveStar: twelveStar.getName(),
    twelveStarEcliptic: ecliptic.getName(),
    twelveStarLuck: ecliptic.getLuck().getName() === '吉' ? '吉' : '凶',
    sixStar: ld.getSixStar().getName(),
    chongDesc: `冲${eb.getOpposite().getZodiac().getName()}(${eb.getOpposite().getName()})`,
    shaDir: `煞${eb.getOminous().getName()}`,
    nineStarFull: nineStar.toString(),
    nineStarColor: nineStar.getColor(),
    nineStarElement: nineStar.getElement().getName(),
    nineStarDipper: nineStar.getDipper().getName(),
    nineStarDirection: nineStar.getDirection().getName(),
    fetusDay: ld.getFetusDay().getName(),
    pengZu: dayCycle.getPengZu().getName(),
    twentyEightStar: star28Full,
    twentyEightStarZone: star28Zone,
    goodGods,
    badGods,
    directions: {
      joy: hs.getJoyDirection().getName(),
      wealth: hs.getWealthDirection().getName(),
      mascot: hs.getMascotDirection().getName(),
      yangNoble: hs.getYangDirection().getName(),
      yinNoble: hs.getYinDirection().getName(),
      taiSui: ld.getJupiterDirection().getName(),
    },
    hours,
  }
}

/** 批量查询未来 N 年某农历生日对应的公历日期 */
export function queryLunarBirthdayMatches(
  lunarMonthAbs: number,
  lunarDay: number,
  preferLeap: boolean,
  startYear: number,
  count: number = 10,
  refDate: Date = new Date(),
): LunarBirthdayResult[] {
  const today = SolarDay.fromYmd(refDate.getFullYear(), refDate.getMonth() + 1, refDate.getDate())
  const results: LunarBirthdayResult[] = []

  for (let i = 0; i < count; i++) {
    const ly = startYear + i
    if (ly < 1900 || ly > 2100) break
    const months = getLunarMonthOptions(ly)
    const leapOpt = preferLeap
      ? months.find((m) => m.isLeap && Math.abs(m.monthWithLeap) === lunarMonthAbs)
      : undefined
    const normalOpt = months.find((m) => !m.isLeap && m.monthWithLeap === lunarMonthAbs)
    const chosen = leapOpt ?? normalOpt
    if (!chosen) continue

    const safeDay = Math.min(lunarDay, chosen.dayCount)
    const ld = LunarDay.fromYmd(ly, chosen.monthWithLeap, safeDay)
    const sd = ld.getSolarDay()
    const yearCycle = ld.getLunarMonth().getLunarYear().getSixtyCycle()

    results.push({
      lunarYear: ly,
      lunarYearGanZhi: yearCycle.getName(),
      zodiac: yearCycle.getEarthBranch().getZodiac().getName(),
      lunarDateText: `${chosen.name}${ld.getName()}`,
      solarYmd: formatYmd(sd.getYear(), sd.getMonth(), sd.getDay()),
      weekday: `星期${sd.getWeek().getName()}`,
      diffFromToday: sd.subtract(today),
      fallbackToNormalMonth: preferLeap && !chosen.isLeap,
      solarYear: sd.getYear(),
      solarMonth: sd.getMonth(),
      solarDay: sd.getDay(),
    })
  }

  return results
}

/** 导出农历生日未来 N 年公历提醒 RFC 5545 .ics */
export function buildLunarBirthdayIcs(
  title: string,
  results: LunarBirthdayResult[],
): string {
  const safeTitle = (title.trim() || '农历生日提醒').replace(/[,;\\]/g, '')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LiteBox//Perpetual Calendar//ZH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${safeTitle}`,
  ]
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'

  for (const r of results) {
    const start = `${r.solarYear}${pad2(r.solarMonth)}${pad2(r.solarDay)}`
    const nextDay = SolarDay.fromYmd(r.solarYear, r.solarMonth, r.solarDay).next(1)
    const end = `${nextDay.getYear()}${pad2(nextDay.getMonth())}${pad2(nextDay.getDay())}`
    lines.push(
      'BEGIN:VEVENT',
      `UID:litebox-lunar-bday-${r.lunarYear}-${start}@litebox.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${safeTitle}（农历${r.lunarDateText}）`,
      `DESCRIPTION:${r.lunarYear}年 ${r.lunarYearGanZhi}(${r.zodiac})年 农历${r.lunarDateText}，对应公历 ${r.solarYmd} ${r.weekday}`,
      'END:VEVENT',
    )
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

/** 导出当日黄历 Markdown 摘要 */
export function buildDayAlmanacMarkdown(d: DayAlmanacDetail): string {
  const lines = [
    `# 万年历与黄历 · ${d.ymd}（${d.weekday}）`,
    '',
    `- **农历**：${d.lunarFullText}`,
    `- **干支**：${d.yearGanZhi}年 ${d.monthGanZhi}月 ${d.dayGanZhi}日（日纳音：${d.daySound}）`,
    `- **藏历**：${d.rabByungText ?? '超出 1951–2050 精确范围'}`,
    `- **儒略日**：JD ${d.julianDay}`,
    `- **节气与物候**：${d.solarTermText} · ${d.phenologyText}`,
    `- **月相 / 星座**：${d.phaseName}（照明约 ${Math.round(d.illumination * 100)}%） / ${d.constellation}`,
    `- **每日宜**：${d.recommends.join('、') || '无'}`,
    `- **每日忌**：${d.avoids.join('、') || '无'}`,
    `- **值星 / 黄黑道 / 冲煞**：建除「${d.duty}」 · ${d.twelveStar}（${d.twelveStarEcliptic}${d.twelveStarLuck}） · ${d.chongDesc} ${d.shaDir}`,
    `- **九星 / 二十八宿 / 六曜**：${d.nineStarFull}（${d.nineStarDipper}·${d.nineStarDirection}） / ${d.twentyEightStar}（${d.twentyEightStarZone}） / ${d.sixStar}`,
    `- **吉神方位**：喜神${d.directions.joy} · 财神${d.directions.wealth} · 福神${d.directions.mascot} · 阳贵${d.directions.yangNoble} · 阴贵${d.directions.yinNoble} · 太岁${d.directions.taiSui}`,
    `- **逐日胎神**：${d.fetusDay}`,
    `- **彭祖百忌**：${d.pengZu}`,
  ]
  return lines.join('\n')
}
