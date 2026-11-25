import {
  HeavenStem,
  LunarDay,
  LunarYear,
  SixtyCycle,
  SolarDay,
  SolarMonth,
  SolarTerm,
  SolarTime,
  TwentyEightStar,
  YinYang,
} from 'tyme4ts'
import {
  CONSTELLATION_LIST,
  CONSTELLATION_MAP,
  FOUR_BEAST_GROUPS,
  FOUR_BEAST_MAP,
  PHASE_INFO,
  SHICHEN_LIST,
  STAR_LORE,
  WUXING_ORDER,
  ZODIAC_MAP,
  type ConstellationMeta,
  type FourBeastStyle,
  type WuXing,
  type ZodiacMeta,
} from './data'

export interface BirthInput {
  /** 公历年份 1900–2100 */
  year: number
  /** 公历月份 1–12 */
  month: number
  /** 公历日期 1–31 */
  day: number
  /** 小时 0–23 */
  hour: number
  /** 分钟 0–59 */
  minute: number
  /** 是否知晓出生时辰（false 时仅排三柱，时柱标记未知） */
  knowTime: boolean
}

export interface LunarMonthOption {
  /** 传给 LunarDay.fromYmd 的月份值，闰月为负数，如 -6 */
  monthWithLeap: number
  /** 中文月名，如 正月、闰六月 */
  name: string
  /** 是否闰月 */
  isLeap: boolean
  /** 该月天数（29 或 30） */
  dayCount: number
}

export interface PillarDetail {
  /** 柱名：年柱 / 月柱 / 日柱 / 时柱 */
  label: string
  /** 是否已知（时辰未知时为 false） */
  known: boolean
  /** 干支全名，如 丙子 */
  ganZhi: string
  /** 天干 */
  stem: string
  stemElement: WuXing
  stemYinYang: '阳' | '阴'
  /** 十神（日柱自身显示“日主”） */
  tenStar: string
  /** 地支 */
  branch: string
  branchElement: WuXing
  branchYinYang: '阳' | '阴'
  /** 地支生肖 */
  branchZodiac: string
  /** 地支藏干 */
  hiddenStems: { stem: string; element: WuXing; role: '本气' | '中气' | '余气' }[]
  /** 纳音五行，如 涧下水 */
  sound: string
  /** 日主十二长生（地势） */
  terrain: string
  /** 旬空（空亡） */
  kongWang: string
}

export interface ConstellationAnalysis {
  meta: ConstellationMeta
  /** 是否处于星座交界期（切换日 ±1 天） */
  isCusp: boolean
  /** 交界相邻星座（仅 isCusp 为 true 时有值） */
  cuspNeighbor?: ConstellationMeta
  /** 交界说明文案 */
  cuspNote?: string
}

export interface ZodiacAnalysis {
  /** 按立春交节口径（传统命理干支岁首） */
  lichunZodiac: ZodiacMeta
  /** 按农历春节口径（正月初一民俗岁首） */
  springFestivalZodiac: ZodiacMeta
  /** 两个口径是否一致 */
  isSame: boolean
  /** 当年立春精确交节时间（北京时间） */
  lichunTimeStr: string
  /** 当年正月初一（春节）公历日期 */
  springFestivalDateStr: string
  /** 解释双口径是否处于过渡窗口 */
  boundaryNote: string
}

export interface MoonPhaseAnalysis {
  name: string
  enName: string
  dayInPhase: number
  /** 农历初几（1–30） */
  lunarDayNumber: number
  /** 估算照明比例 0–1 */
  illumination: number
  /** 月相周期相位角 0–1（0=新月，0.5=满月，1=下一新月） */
  cycleProgress: number
  desc: string
  fractionRange: string
}

export interface TwentyEightStarAnalysis {
  /** 简称，如 奎 */
  shortName: string
  /** 全称（宿名+七曜+禽兽），如 奎木狼 */
  fullName: string
  sevenStar: string
  animal: string
  luck: string
  land: string
  zoneDirection: string
  beast: FourBeastStyle
  lore: string
}

export interface AgeMilestone {
  /** 周岁 */
  nominalAge: number
  /** 虚岁（按农历年差+1） */
  virtualAge: number
  /** 已出生天数（若为未来日期则为负数） */
  livedDays: number
  /** 是否未来日期 */
  isFuture: boolean
  /** 距下次公历生日天数 */
  nextSolarBirthdayDays: number
  /** 下次公历生日日期 */
  nextSolarBirthdayYmd: string
  /** 距下次农历生日天数 */
  nextLunarBirthdayDays: number | null
  /** 下次农历生日对应公历日期 */
  nextLunarBirthdaySolarYmd: string | null
}

export interface BirthProfile {
  input: BirthInput
  /** 公历格式化 */
  solarYmd: string
  solarTimeStr: string
  weekday: string
  /** 农历格式化 */
  lunarYear: number
  lunarMonthWithLeap: number
  lunarDay: number
  lunarDateText: string
  lunarFullText: string
  shichenLabel: string
  /** 出生日节气信息 */
  solarTermDesc: string
  /** 星座分析 */
  constellation: ConstellationAnalysis
  /** 生肖双口径分析 */
  zodiac: ZodiacAnalysis
  /** 四柱八字 */
  pillars: PillarDetail[]
  /** 命宫 / 身宫 / 胎元 / 胎息 */
  extraSigns: {
    ownSign: string
    bodySign: string
    fetalOrigin: string
    fetalBreath: string
  }
  /** 日主信息 */
  dayMaster: {
    stem: string
    element: WuXing
    yinYang: '阳' | '阴'
  }
  /** 五行分布统计（按已知柱的天干+地支本气共 8 字或 6 字统计） */
  wuXingStats: {
    counts: Record<WuXing, number>
    total: number
    dominant: WuXing[]
    missing: WuXing[]
  }
  /** 出生日纳音与年纳音 */
  yearSound: string
  daySound: string
  /** 月相 */
  moonPhase: MoonPhaseAnalysis
  /** 二十八宿 */
  twentyEightStar: TwentyEightStarAnalysis
  /** 年龄与生日倒计时 */
  age: AgeMilestone
}

export interface StarCatalogEntry {
  shortName: string
  fullName: string
  sevenStar: string
  animal: string
  luck: string
  land: string
  beast: string
  direction: string
  lore: string
}

const pad2 = (n: number) => String(n).padStart(2, '0')

export function formatYmd(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`
}

/** 获取指定公历年月的天数 */
export function getSolarDayCount(year: number, month: number): number {
  return SolarMonth.fromYm(year, month).getDayCount()
}

/** 获取指定农历年份的所有月份（含闰月） */
export function getLunarMonthOptions(lunarYear: number): LunarMonthOption[] {
  const ly = LunarYear.fromYear(lunarYear)
  return ly.getMonths().map((m) => ({
    monthWithLeap: m.getMonthWithLeap(),
    name: m.getName(),
    isLeap: m.isLeap(),
    dayCount: m.getDayCount(),
  }))
}

/** 将农历年月日转换为公历年月日 */
export function lunarToSolarYmd(
  lunarYear: number,
  monthWithLeap: number,
  lunarDay: number,
): { year: number; month: number; day: number } {
  const months = getLunarMonthOptions(lunarYear)
  const matched = months.find((m) => m.monthWithLeap === monthWithLeap) ?? months[0]
  const safeDay = Math.min(Math.max(1, lunarDay), matched.dayCount)
  const sd = LunarDay.fromYmd(lunarYear, matched.monthWithLeap, safeDay).getSolarDay()
  return {
    year: sd.getYear(),
    month: sd.getMonth(),
    day: sd.getDay(),
  }
}

/** 根据公历小时获取对应传统时辰名称 */
export function getShiChenByHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24
  if (h === 23 || h === 0) return '子时'
  const idx = Math.floor((h + 1) / 2)
  return SHICHEN_LIST[idx]?.name ?? '子时'
}

/** 构建单个干支柱详情 */
function buildPillar(
  label: string,
  cycle: SixtyCycle,
  dayStem: HeavenStem,
  isDayPillar: boolean,
): PillarDetail {
  const hs = cycle.getHeavenStem()
  const eb = cycle.getEarthBranch()
  const hidden: PillarDetail['hiddenStems'] = []

  const main = eb.getHideHeavenStemMain()
  hidden.push({
    stem: main.getName(),
    element: main.getElement().getName() as WuXing,
    role: '本气',
  })
  const mid = eb.getHideHeavenStemMiddle()
  if (mid) {
    hidden.push({
      stem: mid.getName(),
      element: mid.getElement().getName() as WuXing,
      role: '中气',
    })
  }
  const res = eb.getHideHeavenStemResidual()
  if (res) {
    hidden.push({
      stem: res.getName(),
      element: res.getElement().getName() as WuXing,
      role: '余气',
    })
  }

  return {
    label,
    known: true,
    ganZhi: cycle.getName(),
    stem: hs.getName(),
    stemElement: hs.getElement().getName() as WuXing,
    stemYinYang: hs.getYinYang() === YinYang.YANG ? '阳' : '阴',
    tenStar: isDayPillar ? '日主' : dayStem.getTenStar(hs).getName(),
    branch: eb.getName(),
    branchElement: eb.getElement().getName() as WuXing,
    branchYinYang: eb.getYinYang() === YinYang.YANG ? '阳' : '阴',
    branchZodiac: eb.getZodiac().getName(),
    hiddenStems: hidden,
    sound: cycle.getSound().getName(),
    terrain: dayStem.getTerrain(eb).getName(),
    kongWang: cycle
      .getExtraEarthBranches()
      .map((b) => b.getName())
      .join(''),
  }
}

/** 构造占位未知时柱 */
function buildUnknownHourPillar(): PillarDetail {
  return {
    label: '时柱',
    known: false,
    ganZhi: '未知',
    stem: '?',
    stemElement: '土',
    stemYinYang: '阳',
    tenStar: '时辰未填',
    branch: '?',
    branchElement: '土',
    branchYinYang: '阳',
    branchZodiac: '—',
    hiddenStems: [],
    sound: '待补充出生时辰',
    terrain: '—',
    kongWang: '—',
  }
}

/** 检测西方星座与交界日说明 */
function analyzeConstellation(sd: SolarDay): ConstellationAnalysis {
  const key = sd.getConstellation().getName()
  const meta = CONSTELLATION_MAP[key] ?? CONSTELLATION_LIST[0]

  // 检查前一天与后一天星座是否变化，精确识别交界日（Cusp）
  const prevKey = sd.next(-1).getConstellation().getName()
  const nextKey = sd.next(1).getConstellation().getName()

  if (prevKey !== key) {
    const neighbor = CONSTELLATION_MAP[prevKey]
    return {
      meta,
      isCusp: true,
      cuspNeighbor: neighbor,
      cuspNote: `当日恰逢「${neighbor.fullName} → ${meta.fullName}」交界首日。太阳换座时刻每年有数小时浮动，若出生在凌晨且偏重占星精确交宫，可同时对照 ${neighbor.fullName}。`,
    }
  }
  if (nextKey !== key) {
    const neighbor = CONSTELLATION_MAP[nextKey]
    return {
      meta,
      isCusp: true,
      cuspNeighbor: neighbor,
      cuspNote: `当日恰逢「${meta.fullName} → ${neighbor.fullName}」交界末日。太阳换座时刻因平闰年略有偏移，若出生在深夜，可同时对照 ${neighbor.fullName}。`,
    }
  }
  return { meta, isCusp: false }
}

/** 计算年龄、已出生天数及下一次公历/农历生日倒计时 */
function computeAgeMilestones(sd: SolarDay, ld: LunarDay, refDate: Date): AgeMilestone {
  const today = SolarDay.fromYmd(refDate.getFullYear(), refDate.getMonth() + 1, refDate.getDate())
  const livedDays = today.subtract(sd)
  const isFuture = livedDays < 0

  // 周岁
  let nominalAge = today.getYear() - sd.getYear()
  if (
    today.getMonth() < sd.getMonth() ||
    (today.getMonth() === sd.getMonth() && today.getDay() < sd.getDay())
  ) {
    nominalAge -= 1
  }
  if (nominalAge < 0) nominalAge = 0

  // 虚岁（按农历年份差 + 1）
  const todayLunar = today.getLunarDay()
  const virtualAge = Math.max(0, todayLunar.getYear() - ld.getYear() + 1)

  // 下次公历生日（处理 2 月 29 日在平年取 2 月 28 日）
  const makeSolarBday = (y: number) => {
    const maxD = getSolarDayCount(y, sd.getMonth())
    return SolarDay.fromYmd(y, sd.getMonth(), Math.min(sd.getDay(), maxD))
  }
  let nextSolarBday = makeSolarBday(today.getYear())
  if (nextSolarBday.subtract(today) < 0) {
    nextSolarBday = makeSolarBday(today.getYear() + 1)
  }
  const nextSolarBirthdayDays = nextSolarBday.subtract(today)

  // 下次农历生日（如遇闰月出生，在无该闰月年份自动按对应正月初几计；若遇大月30在29天小月取廿九）
  const targetAbsMonth = Math.abs(ld.getMonth())
  const birthIsLeap = ld.getLunarMonth().isLeap()
  let nextLunarBirthdayDays: number | null = null
  let nextLunarBirthdaySolarYmd: string | null = null

  for (let offset = 0; offset <= 2; offset++) {
    const tryYear = todayLunar.getYear() + offset
    const opts = getLunarMonthOptions(tryYear)
    const leapOpt = birthIsLeap
      ? opts.find((o) => o.isLeap && Math.abs(o.monthWithLeap) === targetAbsMonth)
      : undefined
    const normalOpt = opts.find((o) => !o.isLeap && o.monthWithLeap === targetAbsMonth)
    const chosen = leapOpt ?? normalOpt
    if (!chosen) continue
    const safeD = Math.min(ld.getDay(), chosen.dayCount)
    const candSolar = LunarDay.fromYmd(tryYear, chosen.monthWithLeap, safeD).getSolarDay()
    const diff = candSolar.subtract(today)
    if (diff >= 0) {
      nextLunarBirthdayDays = diff
      nextLunarBirthdaySolarYmd = formatYmd(
        candSolar.getYear(),
        candSolar.getMonth(),
        candSolar.getDay(),
      )
      break
    }
  }

  return {
    nominalAge,
    virtualAge,
    livedDays,
    isFuture,
    nextSolarBirthdayDays,
    nextSolarBirthdayYmd: formatYmd(
      nextSolarBday.getYear(),
      nextSolarBday.getMonth(),
      nextSolarBday.getDay(),
    ),
    nextLunarBirthdayDays,
    nextLunarBirthdaySolarYmd,
  }
}

/** 综合推算出生星历全维度档案 */
export function analyzeBirthProfile(input: BirthInput, refDate: Date = new Date()): BirthProfile {
  const safeYear = Math.min(2100, Math.max(1900, Math.floor(input.year)))
  const safeMonth = Math.min(12, Math.max(1, Math.floor(input.month)))
  const maxDay = getSolarDayCount(safeYear, safeMonth)
  const safeDay = Math.min(maxDay, Math.max(1, Math.floor(input.day)))
  const safeHour = input.knowTime ? Math.min(23, Math.max(0, Math.floor(input.hour))) : 12
  const safeMinute = input.knowTime ? Math.min(59, Math.max(0, Math.floor(input.minute))) : 0

  const st = SolarTime.fromYmdHms(safeYear, safeMonth, safeDay, safeHour, safeMinute, 0)
  const sd = st.getSolarDay()
  const ld = sd.getLunarDay()
  const lh = st.getLunarHour()
  const ec = lh.getEightChar()

  // 1. 星座分析
  const constellation = analyzeConstellation(sd)

  // 2. 立春 vs 春节双口径生肖
  const lichunZodiacKey = ec.getYear().getEarthBranch().getZodiac().getName()
  const springZodiacKey = ld
    .getLunarMonth()
    .getLunarYear()
    .getSixtyCycle()
    .getEarthBranch()
    .getZodiac()
    .getName()
  const lichunZodiac = ZODIAC_MAP[lichunZodiacKey]
  const springFestivalZodiac = ZODIAC_MAP[springZodiacKey]
  const isSame = lichunZodiacKey === springZodiacKey

  // 当年公历立春精确交节时刻（SolarTerm.fromIndex(year, 3) 为当年立春）
  const lichunSolarTime = SolarTerm.fromIndex(safeYear, 3).getJulianDay().getSolarTime()
  const lichunTimeStr = `${lichunSolarTime.getYear()}-${pad2(lichunSolarTime.getMonth())}-${pad2(lichunSolarTime.getDay())} ${pad2(lichunSolarTime.getHour())}:${pad2(lichunSolarTime.getMinute())}:${pad2(lichunSolarTime.getSecond())}`

  // 该公历年内的春节（正月初一）公历日期
  const springFestSolar = LunarDay.fromYmd(safeYear, 1, 1).getSolarDay()
  const springFestivalDateStr = formatYmd(
    springFestSolar.getYear(),
    springFestSolar.getMonth(),
    springFestSolar.getDay(),
  )

  const boundaryNote = isSame
    ? `该日期在「立春交节」与「农历春节」两种传统岁首口径下生肖完全一致，均为「${lichunZodiac.key}」。`
    : `该日期恰落在春节（${springFestivalDateStr}）与立春（${lichunTimeStr}）之间的岁首交替窗口：民间民俗多以正月初一计为「属${springFestivalZodiac.key}」，传统干支命理以立春交节时刻计为「属${lichunZodiac.key}」。`

  // 3. 四柱八字排盘
  const dayStem = ec.getDay().getHeavenStem()
  const yearPillar = buildPillar('年柱', ec.getYear(), dayStem, false)
  const monthPillar = buildPillar('月柱', ec.getMonth(), dayStem, false)
  const dayPillar = buildPillar('日柱', ec.getDay(), dayStem, true)
  const hourPillar = input.knowTime
    ? buildPillar('时柱', ec.getHour(), dayStem, false)
    : buildUnknownHourPillar()

  const pillars = [yearPillar, monthPillar, dayPillar, hourPillar]

  // 五行统计（已知柱的天干 + 地支本气五行）
  const counts: Record<WuXing, number> = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 }
  let total = 0
  for (const p of pillars) {
    if (!p.known) continue
    counts[p.stemElement] += 1
    counts[p.branchElement] += 1
    total += 2
  }
  const maxCount = Math.max(...WUXING_ORDER.map((w) => counts[w]))
  const dominant = WUXING_ORDER.filter((w) => counts[w] === maxCount && maxCount > 0)
  const missing = WUXING_ORDER.filter((w) => counts[w] === 0)

  // 4. 出生月相
  const phaseDay = sd.getPhaseDay()
  const phaseName = phaseDay.getPhase().getName()
  const pInfo = PHASE_INFO[phaseName] ?? {
    en: phaseName,
    desc: '月相盈亏流转，阴晴圆缺各具意蕴。',
    fractionRange: '',
  }
  const lunarDayNumber = ld.getDay()
  const lunarMonthDays = ld.getLunarMonth().getDayCount()
  // 估算月相周期进度：初一≈0(新月)，十五≈0.5(满月)
  const cycleProgress = Math.max(0, Math.min(1, (lunarDayNumber - 1) / lunarMonthDays))
  const illumination = (1 - Math.cos(cycleProgress * 2 * Math.PI)) / 2

  // 5. 二十八星宿
  const star = ld.getTwentyEightStar()
  const shortName = star.getName()
  const sevenStar = star.getSevenStar().getName()
  const animal = star.getAnimal().getName()
  const beastName = star.getZone().getBeast().getName()
  const beastStyle = FOUR_BEAST_MAP[beastName] ?? FOUR_BEAST_GROUPS[0]

  // 6. 节气描述
  const termDay = sd.getTermDay()
  const solarTermDesc = `${termDay.getSolarTerm().getName()}第 ${termDay.getDayIndex() + 1} 天`

  // 7. 年龄与生日倒计时
  const age = computeAgeMilestones(sd, ld, refDate)

  const monthWithLeap = ld.getLunarMonth().getMonthWithLeap()
  const lunarDateText = `${ld.getLunarMonth().getName()}${ld.getName()}`
  const lunarFullText = `农历 ${ld.getLunarMonth().getLunarYear().getSixtyCycle().getName()}(${springZodiacKey})年 ${lunarDateText}`

  return {
    input: {
      year: safeYear,
      month: safeMonth,
      day: safeDay,
      hour: input.hour,
      minute: input.minute,
      knowTime: input.knowTime,
    },
    solarYmd: formatYmd(safeYear, safeMonth, safeDay),
    solarTimeStr: input.knowTime ? `${pad2(safeHour)}:${pad2(safeMinute)}` : '时辰未知',
    weekday: `星期${sd.getWeek().getName()}`,
    lunarYear: ld.getYear(),
    lunarMonthWithLeap: monthWithLeap,
    lunarDay: ld.getDay(),
    lunarDateText,
    lunarFullText,
    shichenLabel: input.knowTime ? getShiChenByHour(safeHour) : '时辰未知',
    solarTermDesc,
    constellation,
    zodiac: {
      lichunZodiac,
      springFestivalZodiac,
      isSame,
      lichunTimeStr,
      springFestivalDateStr,
      boundaryNote,
    },
    pillars,
    extraSigns: {
      ownSign: input.knowTime ? ec.getOwnSign().getName() : '需知出生时辰',
      bodySign: input.knowTime ? ec.getBodySign().getName() : '需知出生时辰',
      fetalOrigin: ec.getFetalOrigin().getName(),
      fetalBreath: ec.getFetalBreath().getName(),
    },
    dayMaster: {
      stem: dayPillar.stem,
      element: dayPillar.stemElement,
      yinYang: dayPillar.stemYinYang,
    },
    wuXingStats: {
      counts,
      total,
      dominant,
      missing,
    },
    yearSound: yearPillar.sound,
    daySound: dayPillar.sound,
    moonPhase: {
      name: phaseName,
      enName: pInfo.en,
      dayInPhase: phaseDay.getDayIndex() + 1,
      lunarDayNumber,
      illumination,
      cycleProgress,
      desc: pInfo.desc,
      fractionRange: pInfo.fractionRange,
    },
    twentyEightStar: {
      shortName,
      fullName: `${shortName}${sevenStar}${animal}`,
      sevenStar,
      animal,
      luck: star.getLuck().getName(),
      land: star.getLand().getName(),
      zoneDirection: star.getZone().getName(),
      beast: beastStyle,
      lore: STAR_LORE[shortName] ?? '',
    },
    age,
  }
}

/** 生成完整的二十八星宿辞典列表（按四象顺序） */
export function getAllTwentyEightStars(): StarCatalogEntry[] {
  const list: StarCatalogEntry[] = []
  for (let i = 0; i < 28; i++) {
    const s = TwentyEightStar.fromIndex(i)
    const shortName = s.getName()
    const sevenStar = s.getSevenStar().getName()
    const animal = s.getAnimal().getName()
    list.push({
      shortName,
      fullName: `${shortName}${sevenStar}${animal}`,
      sevenStar,
      animal,
      luck: s.getLuck().getName(),
      land: s.getLand().getName(),
      beast: s.getZone().getBeast().getName(),
      direction: s.getZone().getName(),
      lore: STAR_LORE[shortName] ?? '',
    })
  }
  return list
}

/** 导出星历档案 Markdown 报告 */
export function buildProfileMarkdown(p: BirthProfile): string {
  const lines: string[] = [
    `# 出生星历档案 · ${p.solarYmd} ${p.input.knowTime ? p.solarTimeStr : ''}`.trim(),
    '',
    `- **公历**：${p.solarYmd}（${p.weekday}）${p.input.knowTime ? `${p.solarTimeStr} · ${p.shichenLabel}` : '（时辰未填）'}`,
    `- **农历**：${p.lunarFullText}`,
    `- **节气**：${p.solarTermDesc}`,
    `- **星座**：${p.constellation.meta.symbol} ${p.constellation.meta.fullName}（${p.constellation.meta.enName} · ${p.constellation.meta.element} · ${p.constellation.meta.modality} · 守护星 ${p.constellation.meta.ruler}）`,
    `- **生肖**：立春口径「${p.zodiac.lichunZodiac.key}」 / 春节口径「${p.zodiac.springFestivalZodiac.key}」${p.zodiac.isSame ? '（双口径一致）' : '（处于岁首交替期）'}`,
    `- **月相**：${p.moonPhase.name}（${p.moonPhase.enName}，照明约 ${Math.round(p.moonPhase.illumination * 100)}%）`,
    `- **二十八宿**：${p.twentyEightStar.fullName}（${p.twentyEightStar.beast.title} · ${p.twentyEightStar.land}）`,
    '',
    '## 干支四柱与纳音',
    '',
    '| 柱位 | 干支 | 天干/十神 | 地支/藏干 | 纳音五行 | 十二长生 | 旬空 |',
    '| --- | :---: | :---: | --- | :---: | :---: | :---: |',
  ]

  for (const col of p.pillars) {
    if (!col.known) {
      lines.push(`| ${col.label} | 未知 | — | — | 待补时辰 | — | — |`)
      continue
    }
    const hidden = col.hiddenStems.map((h) => `${h.stem}(${h.element})`).join(' ')
    lines.push(
      `| ${col.label} | **${col.ganZhi}** | ${col.stem}(${col.stemYinYang}${col.stemElement}) · ${col.tenStar} | ${col.branch}(${col.branchElement}) / ${hidden} | ${col.sound} | ${col.terrain} | ${col.kongWang} |`,
    )
  }

  const wxSummary = WUXING_ORDER.map((w) => `${w} ${p.wuXingStats.counts[w]}`).join(' · ')
  lines.push(
    '',
    `- **五行统计**（共 ${p.wuXingStats.total} 字）：${wxSummary}`,
    `- **命宫 / 身宫 / 胎元 / 胎息**：${p.extraSigns.ownSign} / ${p.extraSigns.bodySign} / ${p.extraSigns.fetalOrigin} / ${p.extraSigns.fetalBreath}`,
    '',
    '> 注：以上数据由本地历法库 `tyme4ts` 精确推算，传统文化内容仅供知识查阅与趣味参考。',
  )

  return lines.join('\n')
}
