/**
 * 法定节假日与智能拼假攻略引擎（基于 tyme4ts）
 * - 支持 2002 – 2027 全年法定节假日与调休补班查询
 * - 精准区分：法定假 (holiday) / 调休补班 (makeup) / 普通周末 (weekend) / 普通工作日 (workday)
 * - 智能计算每个假期的最优年假拼假组合（请 N 休 M，按杠杆性价比与总连休天数精选推荐）
 * - 支持生成标准 RFC 5545 .ics 日历文件与 Markdown 假期汇总表
 */

import { LegalHoliday, SolarDay } from 'tyme4ts'

export type DayKind = 'holiday' | 'makeup' | 'weekend' | 'workday'

export interface DayCellInfo {
  /** YYYY-MM-DD */
  ymd: string
  year: number
  month: number
  day: number
  /** 0=日, 1=一 ... 6=六 */
  weekIndex: number
  weekLabel: string
  lunarShort: string
  termName: string | null
  kind: DayKind
  /** 若为法定假或调休补班，记录对应节日名称 */
  holidayName: string | null
  /** 是否属于实际休息日（法定假或普通周末） */
  isRestDay: boolean
}

export interface LeaveSuggestion {
  id: string
  /** 建议请年假的日期列表（YYYY-MM-DD） */
  leaveDays: string[]
  /** 连通后的总放假起止日期 */
  startYmd: string
  endYmd: string
  /** 请几天年假 */
  leaveCount: number
  /** 总共连休几天 */
  totalRestDays: number
  /** 净增性价比（总连休 / 请假天数） */
  ratio: number
  /** 简短标题，如 "请 3 休 9" */
  title: string
  /** 策略方向说明 */
  positionLabel: '节前请假' | '节后请假' | '前后连请'
}

export interface HolidayGroup {
  id: string
  name: string
  /** 放假起止（仅法定放假连休段） */
  startYmd: string
  endYmd: string
  /** 放假天数 */
  restDays: number
  /** 法定放假日期详情 */
  holidayDays: DayCellInfo[]
  /** 对应的调休补班日期 */
  makeupDays: DayCellInfo[]
  /** 围绕该假期的窗口日历（供可视化条带展示） */
  windowDays: DayCellInfo[]
  /** 智能推荐拼假方案（最多 3 套精选） */
  suggestions: LeaveSuggestion[]
}

export interface YearHolidaySummary {
  year: number
  totalDays: number
  /** 法定标注“休”的天数 */
  legalRestCount: number
  /** 法定标注“班”的调休补班天数 */
  makeupWorkCount: number
  /** 全年所有实际休息日（含双休+法定假，扣除调休补班） */
  totalRestDays: number
  /** 全年所有实际工作日 */
  totalWorkDays: number
  /** 按时间排序的节日分组 */
  groups: HolidayGroup[]
  /** 全年所有调休补班日清单 */
  allMakeupDays: DayCellInfo[]
  /** 全年 12 个月的每日详情（key: 1..12） */
  months: Record<number, DayCellInfo[]>
  /** 按 YYYY-MM-DD 索引的全年每日详情 */
  dayMap: Record<string, DayCellInfo>
}

export const SUPPORTED_MIN_YEAR = 2002
export const SUPPORTED_MAX_YEAR = 2027

/** 将 SolarDay 格式化为 YYYY-MM-DD */
export function formatSolarYmd(sd: SolarDay): string {
  const y = sd.getYear()
  const m = String(sd.getMonth()).padStart(2, '0')
  const d = String(sd.getDay()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 将 YYYY-MM-DD 格式化为更易读的 M月D日 */
export function formatMonthDay(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number)
  return `${m}月${d}日`
}

/** 计算两个 YYYY-MM-DD 之间相差天数（b - a） */
export function diffDaysYmd(aYmd: string, bYmd: string): number {
  const [ay, am, ad] = aYmd.split('-').map(Number)
  const [by, bm, bd] = bYmd.split('-').map(Number)
  const t1 = Date.UTC(ay, am - 1, ad)
  const t2 = Date.UTC(by, bm - 1, bd)
  return Math.round((t2 - t1) / 86_400_000)
}

/** 获取本地今日 YYYY-MM-DD */
export function getTodayYmd(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 构建单日完整历法与休/班状态 */
export function inspectSolarDay(sd: SolarDay): DayCellInfo {
  const ymd = formatSolarYmd(sd)
  const weekIndex = sd.getWeek().getIndex() // 0=日, 6=六
  const weekLabel = sd.getWeek().getName()
  const legal = sd.getLegalHoliday()
  const isWeekend = weekIndex === 0 || weekIndex === 6

  let kind: DayKind
  let holidayName: string | null = null
  if (legal) {
    holidayName = legal.getName()
    kind = legal.isWork() ? 'makeup' : 'holiday'
  } else {
    kind = isWeekend ? 'weekend' : 'workday'
  }

  const lunar = sd.getLunarDay()
  const lunarShort = lunar.getDay() === 1 ? lunar.getLunarMonth().getName() : lunar.getName()
  const termDay = sd.getTermDay()
  const termName = termDay.getDayIndex() === 0 ? termDay.getSolarTerm().getName() : null

  return {
    ymd,
    year: sd.getYear(),
    month: sd.getMonth(),
    day: sd.getDay(),
    weekIndex,
    weekLabel,
    lunarShort,
    termName,
    kind,
    holidayName,
    isRestDay: kind === 'holiday' || kind === 'weekend',
  }
}

/** 判断某天是否可连休（在给定虚拟请假集合下） */
function isRestWithLeave(info: DayCellInfo, leaveSet: Set<string>): boolean {
  return info.isRestDay || leaveSet.has(info.ymd)
}

/**
 * 为指定法定假期计算最优智能拼假方案（请 1 ~ 5 天年假连成最长假期）
 */
function computeLeaveSuggestions(
  holidayStart: SolarDay,
  holidayEnd: SolarDay,
  baseRestDays: number,
): LeaveSuggestion[] {
  // 扫描假期前后各 10 天
  const spanStart = holidayStart.next(-10)
  const spanEnd = holidayEnd.next(10)
  const spanDays: DayCellInfo[] = []
  let cur = spanStart
  while (true) {
    spanDays.push(inspectSolarDay(cur))
    if (cur.equals(spanEnd)) break
    cur = cur.next(1)
  }

  const startIdx = spanDays.findIndex((d) => d.ymd === formatSolarYmd(holidayStart))
  const endIdx = spanDays.findIndex((d) => d.ymd === formatSolarYmd(holidayEnd))
  if (startIdx < 0 || endIdx < 0) return []

  // 先找到不请假时包含此假期的自然最大连休段（可能本身已接壤周末）
  let naturalStart = startIdx
  while (naturalStart > 0 && spanDays[naturalStart - 1].isRestDay) naturalStart--
  let naturalEnd = endIdx
  while (naturalEnd < spanDays.length - 1 && spanDays[naturalEnd + 1].isRestDay) naturalEnd++
  const naturalTotal = naturalEnd - naturalStart + 1

  const candidates: LeaveSuggestion[] = []
  const seenKeys = new Set<string>()

  // 枚举向左扩展 leftExtend 天、向右扩展 rightExtend 天，使连休段包含原假期
  for (let l = 0; l <= naturalStart; l++) {
    for (let r = naturalEnd; r < spanDays.length; r++) {
      // 跳过完全不跨出原自然连休的
      if (l === naturalStart && r === naturalEnd) continue
      // 必须是从左侧边界延伸到某天休息日，或右侧边界延伸到某天休息日（否则没“拼”到周末/其他假，意义不大）
      const leaves: string[] = []
      let leftLeaves = 0
      let rightLeaves = 0
      for (let i = l; i <= r; i++) {
        if (!spanDays[i].isRestDay) {
          leaves.push(spanDays[i].ymd)
          if (i < naturalStart) leftLeaves++
          else if (i > naturalEnd) rightLeaves++
        }
      }
      if (leaves.length < 1 || leaves.length > 5) continue

      // 把选中请假后的整个连通休息区间向外扩展至最外侧休息日，避免留下半截周末
      const leaveSet = new Set(leaves)
      let realL = l
      while (realL > 0 && isRestWithLeave(spanDays[realL - 1], leaveSet)) realL--
      let realR = r
      while (realR < spanDays.length - 1 && isRestWithLeave(spanDays[realR + 1], leaveSet)) realR++

      const totalRest = realR - realL + 1
      // 至少要比「原自然连休 + 请假天数」多赚出 1 天以上（即真正拼上了周末或邻近假日！）
      if (totalRest <= naturalTotal + leaves.length) continue
      if (totalRest <= baseRestDays + leaves.length) continue

      const key = leaves.join(',')
      if (seenKeys.has(key)) continue
      seenKeys.add(key)

      const positionLabel: LeaveSuggestion['positionLabel'] =
        leftLeaves > 0 && rightLeaves > 0 ? '前后连请' : leftLeaves > 0 ? '节前请假' : '节后请假'

      candidates.push({
        id: `${spanDays[realL].ymd}_${spanDays[realR].ymd}_${leaves.length}`,
        leaveDays: leaves,
        startYmd: spanDays[realL].ymd,
        endYmd: spanDays[realR].ymd,
        leaveCount: leaves.length,
        totalRestDays: totalRest,
        ratio: Number((totalRest / leaves.length).toFixed(2)),
        title: `请 ${leaves.length} 休 ${totalRest}`,
        positionLabel,
      })
    }
  }

  // 对同一个请假天数只保留连休最长（同等连休优先单侧请假、再优先节后/节前更紧凑）的代表方案
  const bestByLeaveCount = new Map<number, LeaveSuggestion>()
  for (const cand of candidates) {
    const prev = bestByLeaveCount.get(cand.leaveCount)
    if (
      !prev ||
      cand.totalRestDays > prev.totalRestDays ||
      (cand.totalRestDays === prev.totalRestDays &&
        prev.positionLabel === '前后连请' &&
        cand.positionLabel !== '前后连请')
    ) {
      bestByLeaveCount.set(cand.leaveCount, cand)
    }
  }

  // 过滤掉被更少请假天数严格支配的冗余方案，再按性价比与总天数挑出最多 3 套最佳攻略
  const pruned = Array.from(bestByLeaveCount.values())
    .sort((a, b) => a.leaveCount - b.leaveCount)
    .filter((item, idx, arr) => {
      for (let i = 0; i < idx; i++) {
        // 如果请更少的天数就能休一样多或更多，当前方案无意义
        if (arr[i].totalRestDays >= item.totalRestDays) return false
      }
      return true
    })

  return pruned
    .sort((a, b) => b.ratio - a.ratio || b.totalRestDays - a.totalRestDays)
    .slice(0, 3)
}

/** 汇总指定年份的全年法定节假日、调休补班、统计数据与 12 个月完整网格 */
export function buildYearHolidaySummary(year: number): YearHolidaySummary {
  const safeYear = Math.max(SUPPORTED_MIN_YEAR, Math.min(SUPPORTED_MAX_YEAR, year))
  const months: Record<number, DayCellInfo[]> = {}
  const dayMap: Record<string, DayCellInfo> = {}
  for (let m = 1; m <= 12; m++) months[m] = []

  let totalDays = 0
  let legalRestCount = 0
  let makeupWorkCount = 0
  let totalRestDays = 0
  let totalWorkDays = 0
  const allMakeupDays: DayCellInfo[] = []

  // 1. 扫描目标年份全年的每一天
  let d = SolarDay.fromYmd(safeYear, 1, 1)
  while (d.getYear() === safeYear) {
    const info = inspectSolarDay(d)
    months[info.month].push(info)
    dayMap[info.ymd] = info
    totalDays++
    if (info.kind === 'holiday') legalRestCount++
    if (info.kind === 'makeup') {
      makeupWorkCount++
      allMakeupDays.push(info)
    }
    if (info.isRestDay) totalRestDays++
    else totalWorkDays++
    d = d.next(1)
  }

  // 2. 扫描扩展窗口（前年 12/25 至 次年 1/7）以准确识别跨年元旦与完整补班归属
  const rawRecords: { sd: SolarDay; info: DayCellInfo; name: string; isWork: boolean }[] = []
  let ext = SolarDay.fromYmd(safeYear - 1, 12, 25)
  const extEnd = SolarDay.fromYmd(safeYear + 1, 1, 7)
  while (true) {
    const h = ext.getLegalHoliday()
    if (h) {
      const info = inspectSolarDay(ext)
      rawRecords.push({ sd: ext, info, name: h.getName(), isWork: h.isWork() })
    }
    if (ext.equals(extEnd)) break
    ext = ext.next(1)
  }

  // 按“名称 + 时间相近（±18天内）”聚类，区分去年元旦/今年元旦/明年元旦
  interface RawCluster {
    name: string
    holidayItems: { sd: SolarDay; info: DayCellInfo }[]
    makeupItems: { sd: SolarDay; info: DayCellInfo }[]
    anchorYmd: string
  }

  const clusters: RawCluster[] = []
  for (const rec of rawRecords) {
    const match = clusters.find(
      (c) => c.name === rec.name && Math.abs(diffDaysYmd(c.anchorYmd, rec.info.ymd)) <= 18,
    )
    if (match) {
      if (rec.isWork) match.makeupItems.push({ sd: rec.sd, info: rec.info })
      else match.holidayItems.push({ sd: rec.sd, info: rec.info })
    } else {
      clusters.push({
        name: rec.name,
        holidayItems: rec.isWork ? [] : [{ sd: rec.sd, info: rec.info }],
        makeupItems: rec.isWork ? [{ sd: rec.sd, info: rec.info }] : [],
        anchorYmd: rec.info.ymd,
      })
    }
  }

  // 只保留法定放假主段落在目标年份内的假期（例如 2026 年 1 月 1 日属于 2026 元旦，2025/12/31 跨年则看多数日或首日/末日）
  const yearClusters = clusters
    .filter((c) => {
      if (c.holidayItems.length === 0) return false
      const inYearCount = c.holidayItems.filter((it) => it.info.year === safeYear).length
      if (c.name === '元旦') {
        return c.holidayItems.some((it) => it.info.year === safeYear && it.info.month === 1 && it.info.day === 1)
      }
      return inYearCount > 0
    })
    .sort((a, b) => a.holidayItems[0].info.ymd.localeCompare(b.holidayItems[0].info.ymd))

  // 若某些年份（如 2023/2020/2025）中秋节和国庆节紧邻（间隔 <= 1 天），合并为「中秋国庆」超长连休组展示更符合直观体验
  const mergedClusters: RawCluster[] = []
  for (const c of yearClusters) {
    const prev = mergedClusters[mergedClusters.length - 1]
    if (prev && prev.holidayItems.length > 0 && c.holidayItems.length > 0) {
      const prevEndYmd = prev.holidayItems[prev.holidayItems.length - 1].info.ymd
      const curStartYmd = c.holidayItems[0].info.ymd
      if (diffDaysYmd(prevEndYmd, curStartYmd) <= 1) {
        prev.name = prev.name.includes(c.name) ? prev.name : `${prev.name} · ${c.name}`
        prev.holidayItems.push(...c.holidayItems)
        prev.makeupItems.push(...c.makeupItems)
        prev.holidayItems.sort((x, y) => x.info.ymd.localeCompare(y.info.ymd))
        prev.makeupItems.sort((x, y) => x.info.ymd.localeCompare(y.info.ymd))
        continue
      }
    }
    mergedClusters.push(c)
  }

  // 构建最终 HolidayGroup（含前后 14 天视觉窗口与智能拼假方案）
  const groups: HolidayGroup[] = mergedClusters.map((c, idx) => {
    const first = c.holidayItems[0]
    const last = c.holidayItems[c.holidayItems.length - 1]
    const suggestions = computeLeaveSuggestions(first.sd, last.sd, c.holidayItems.length)

    // 计算窗口范围：包含最远补班日和所有拼假建议区间，外加前后 2 天缓冲
    let winStart = first.sd.next(-3)
    let winEnd = last.sd.next(3)
    for (const m of c.makeupItems) {
      if (diffDaysYmd(formatSolarYmd(winStart), m.info.ymd) < 0) winStart = m.sd
      if (diffDaysYmd(formatSolarYmd(winEnd), m.info.ymd) > 0) winEnd = m.sd
    }
    for (const s of suggestions) {
      const [sy, sm, sd] = s.startYmd.split('-').map(Number)
      const [ey, em, ed] = s.endYmd.split('-').map(Number)
      if (diffDaysYmd(formatSolarYmd(winStart), s.startYmd) < 0) winStart = SolarDay.fromYmd(sy, sm, sd)
      if (diffDaysYmd(formatSolarYmd(winEnd), s.endYmd) > 0) winEnd = SolarDay.fromYmd(ey, em, ed)
    }

    const windowDays: DayCellInfo[] = []
    let wc = winStart
    while (true) {
      windowDays.push(inspectSolarDay(wc))
      if (wc.equals(winEnd)) break
      wc = wc.next(1)
    }

    return {
      id: `${safeYear}-${idx}-${c.name}`,
      name: c.name,
      startYmd: first.info.ymd,
      endYmd: last.info.ymd,
      restDays: c.holidayItems.length,
      holidayDays: c.holidayItems.map((i) => i.info),
      makeupDays: c.makeupItems.map((i) => i.info),
      windowDays,
      suggestions,
    }
  })

  return {
    year: safeYear,
    totalDays,
    legalRestCount,
    makeupWorkCount,
    totalRestDays,
    totalWorkDays,
    groups,
    allMakeupDays,
    months,
    dayMap,
  }
}

/** 实时计算从今天出发的下一个法定假期（自动跨年查找）及期间需上工作日数 */
export interface NextHolidayCountdown {
  status: 'ongoing' | 'upcoming' | 'none'
  holidayName: string
  startYmd: string
  endYmd: string
  restDays: number
  /** 进行中：当前第几天；即将到来：还有多少自然日 */
  daysCount: number
  /** 即将到来时：距离放假还需上几天班（含调休补班） */
  workDaysLeft: number
  /** 下一个调休补班日（若有） */
  nextMakeup: { ymd: string; holidayName: string; daysUntil: number; weekLabel: string } | null
}

export function computeNextHolidayCountdown(todayYmd = getTodayYmd()): NextHolidayCountdown {
  const [ty] = todayYmd.split('-').map(Number)
  const summaries: YearHolidaySummary[] = []
  if (ty >= SUPPORTED_MIN_YEAR && ty <= SUPPORTED_MAX_YEAR) summaries.push(buildYearHolidaySummary(ty))
  if (ty + 1 >= SUPPORTED_MIN_YEAR && ty + 1 <= SUPPORTED_MAX_YEAR) summaries.push(buildYearHolidaySummary(ty + 1))

  const allGroups = summaries.flatMap((s) => s.groups)
  const allMakeups = summaries.flatMap((s) => s.allMakeupDays)

  const upcomingMakeup = allMakeups.find((m) => diffDaysYmd(todayYmd, m.ymd) >= 0)
  const nextMakeup = upcomingMakeup
    ? {
        ymd: upcomingMakeup.ymd,
        holidayName: upcomingMakeup.holidayName || '调休',
        daysUntil: diffDaysYmd(todayYmd, upcomingMakeup.ymd),
        weekLabel: upcomingMakeup.weekLabel,
      }
    : null

  // 1. 检查今天是否正在某个法定假期中
  const ongoing = allGroups.find((g) => todayYmd >= g.startYmd && todayYmd <= g.endYmd)
  if (ongoing) {
    return {
      status: 'ongoing',
      holidayName: ongoing.name,
      startYmd: ongoing.startYmd,
      endYmd: ongoing.endYmd,
      restDays: ongoing.restDays,
      daysCount: diffDaysYmd(ongoing.startYmd, todayYmd) + 1,
      workDaysLeft: 0,
      nextMakeup,
    }
  }

  // 2. 找到下一个即将到来的法定假期
  const next = allGroups.find((g) => g.startYmd > todayYmd)
  if (next) {
    const daysCount = diffDaysYmd(todayYmd, next.startYmd)
    const [sy, sm, sd] = todayYmd.split('-').map(Number)
    let cur = SolarDay.fromYmd(sy, sm, sd)
    let workDaysLeft = 0
    for (let i = 0; i < daysCount; i++) {
      const info = inspectSolarDay(cur)
      if (!info.isRestDay) workDaysLeft++
      cur = cur.next(1)
    }
    return {
      status: 'upcoming',
      holidayName: next.name,
      startYmd: next.startYmd,
      endYmd: next.endYmd,
      restDays: next.restDays,
      daysCount,
      workDaysLeft,
      nextMakeup,
    }
  }

  return {
    status: 'none',
    holidayName: '',
    startYmd: '',
    endYmd: '',
    restDays: 0,
    daysCount: 0,
    workDaysLeft: 0,
    nextMakeup,
  }
}

/** 根据用户勾选的自定义请假日期，计算所连成的长假区间（≥3天） */
export function analyzeCustomLeaveStreaks(
  summary: YearHolidaySummary,
  customLeaves: Set<string>,
): { startYmd: string; endYmd: string; totalDays: number; leaveUsed: number }[] {
  if (customLeaves.size === 0) return []
  const allDays = Object.values(summary.dayMap).sort((a, b) => a.ymd.localeCompare(b.ymd))
  const streaks: { startYmd: string; endYmd: string; totalDays: number; leaveUsed: number }[] = []

  let i = 0
  while (i < allDays.length) {
    if (!isRestWithLeave(allDays[i], customLeaves)) {
      i++
      continue
    }
    let j = i
    let leaveUsed = 0
    while (j < allDays.length && isRestWithLeave(allDays[j], customLeaves)) {
      if (customLeaves.has(allDays[j].ymd)) leaveUsed++
      j++
    }
    const totalDays = j - i
    if (leaveUsed > 0 && totalDays >= 3) {
      streaks.push({
        startYmd: allDays[i].ymd,
        endYmd: allDays[j - 1].ymd,
        totalDays,
        leaveUsed,
      })
    }
    i = j
  }
  return streaks.sort((a, b) => b.totalDays - a.totalDays)
}

/** 生成标准 RFC 5545 .ics 日历文件（支持导入 Apple / 华为 / Outlook / Google 日历） */
export function buildHolidaysIcs(
  summary: YearHolidaySummary,
  options: { includeHolidays: boolean; includeMakeups: boolean; customLeaves?: Set<string> },
): string {
  const toIcsDate = (ymd: string) => ymd.replace(/-/g, '')
  const nextDayIcs = (ymd: string) => {
    const [y, m, d] = ymd.split('-').map(Number)
    return formatSolarYmd(SolarDay.fromYmd(y, m, d).next(1)).replace(/-/g, '')
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LiteBox//Chinese Legal Holidays//ZH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${summary.year}年中国法定节假日（轻匣）`,
    'X-WR-TIMEZONE:Asia/Shanghai',
  ]

  const pushAllDayEvent = (uid: string, startYmd: string, endYmd: string, title: string, desc: string) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}@litebox.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${toIcsDate(startYmd)}`,
      `DTEND;VALUE=DATE:${nextDayIcs(endYmd)}`,
      `SUMMARY:${title}`,
      `DESCRIPTION:${desc}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    )
  }

  if (options.includeHolidays) {
    for (const g of summary.groups) {
      pushAllDayEvent(
        `holiday-${g.startYmd}-${g.endYmd}`,
        g.startYmd,
        g.endYmd,
        `[休] ${g.name}（放假 ${g.restDays} 天）`,
        `${summary.year}年法定节假日：${g.name}，${formatMonthDay(g.startYmd)}至${formatMonthDay(g.endYmd)}共放假${g.restDays}天。`,
      )
    }
  }

  if (options.includeMakeups) {
    for (const m of summary.allMakeupDays) {
      pushAllDayEvent(
        `makeup-${m.ymd}`,
        m.ymd,
        m.ymd,
        `[班] ${m.holidayName || '法定假日'}调休补班`,
        `${formatMonthDay(m.ymd)}（周${m.weekLabel}）为${m.holidayName || ''}调休补班工作日，请留意上班闹钟。`,
      )
    }
  }

  if (options.customLeaves && options.customLeaves.size > 0) {
    const sorted = Array.from(options.customLeaves).sort()
    for (const ymd of sorted) {
      pushAllDayEvent(
        `leave-${ymd}`,
        ymd,
        ymd,
        '[年假] 计划拼假休假',
        '由轻匣「法定节假日与拼假攻略」规划的个人请假日程。',
      )
    }
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

/** 导出全年假期 Markdown 表格（方便发群公告/记入飞书文档） */
export function buildHolidaysMarkdown(summary: YearHolidaySummary): string {
  const rows = summary.groups.map((g) => {
    const makeupStr =
      g.makeupDays.length > 0
        ? g.makeupDays.map((m) => `${formatMonthDay(m.ymd)}(周${m.weekLabel})`).join('、')
        : '无调休'
    const topTip = g.suggestions[0]
      ? `${g.suggestions[0].title}（请 ${g.suggestions[0].leaveDays.map(formatMonthDay).join('、')}）`
      : '—'
    return `| ${g.name} | ${formatMonthDay(g.startYmd)} – ${formatMonthDay(g.endYmd)} | ${g.restDays} 天 | ${makeupStr} | ${topTip} |`
  })

  return [
    `# ${summary.year} 年中国法定节假日与拼假攻略`,
    '',
    `> 全年法定放假 ${summary.legalRestCount} 天 · 调休补班 ${summary.makeupWorkCount} 天 · 总休息日 ${summary.totalRestDays} 天 · 总工作日 ${summary.totalWorkDays} 天`,
    '',
    '| 节日 | 放假时间 | 天数 | 调休补班 | 推荐拼假方案 |',
    '| --- | --- | :---: | --- | --- |',
    ...rows,
  ].join('\n')
}

export { LegalHoliday }
