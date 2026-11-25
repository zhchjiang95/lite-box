/**
 * 二十四节气、七十二候与数九/三伏/梅雨传统周期计算引擎（基于 tyme4ts）
 * - 支持 1900 – 2100 任意年份 24 节气精确到秒的天文交节时刻
 * - 精准提取全年 72 候起止日期、三伏天（含 10/20 天中伏自动识别）、数九寒天与入梅/出梅周期
 * - 内置 24 节气传统民俗、应季风物与经典诗词导语，支持导出标准 .ics 节气日历与 Markdown 表
 */

import { SolarDay, SolarTerm } from 'tyme4ts'

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter'

export interface PhenologyEntry {
  orderLabel: '初候' | '二候' | '三候'
  name: string
  startYmd: string
  endYmd: string
}

export interface TermLore {
  season: SeasonId
  /** 太阳黄经度数（春分 0°，每节气 +15°） */
  longitudeDeg: number
  /** 一句诗意概括 */
  tagline: string
  /** 传统民俗 */
  customs: string
  /** 应季食养 */
  foods: string
  /** 古诗词选句 */
  poem: string
}

export interface SolarTermInfo {
  /** 在当年公历中的序号 0..23（小寒=0 .. 冬至=23） */
  orderInYear: number
  name: string
  /** 节令（isJie）或中气（isQi） */
  kind: '节令' | '中气'
  season: SeasonId
  longitudeDeg: number
  /** 精确交节日期 YYYY-MM-DD */
  ymd: string
  /** 精确交节时刻 YYYY-MM-DD HH:mm:ss */
  exactTime: string
  /** 精确交节毫秒时间戳（按东八区北京时间换算） */
  timestampMs: number
  /** 对应星期 */
  weekLabel: string
  /** 对应农历日期（如 腊月初十） */
  lunarText: string
  /** 所属三候 */
  phenologies: PhenologyEntry[]
  /** 民俗与食养资料 */
  lore: TermLore
}

export interface CycleSpan {
  name: string
  startYmd: string
  endYmd: string
  days: number
  note?: string
}

export interface YearSolarTermsData {
  year: number
  /** 按公历 1 月小寒 → 12 月冬至排列的 24 节气 */
  terms: SolarTermInfo[]
  /** 三伏天（初伏 / 中伏 / 末伏） */
  dogDays: CycleSpan[]
  /** 梅雨季（入梅 → 出梅） */
  plumRain: { startYmd: string; endYmd: string; days: number } | null
  /** 本年度出现的数九区间（年初延续与年末冬至新启） */
  nineSpansEarly: CycleSpan[]
  nineSpansLate: CycleSpan[]
}

export const SEASON_META: Record<
  SeasonId,
  { name: string; color: string; bgCls: string; textCls: string; ringCls: string }
> = {
  spring: {
    name: '春季',
    color: '#10b981',
    bgCls: 'bg-emerald-500/12',
    textCls: 'text-emerald-700 dark:text-emerald-300',
    ringCls: 'border-emerald-500/35',
  },
  summer: {
    name: '夏季',
    color: '#f43f5e',
    bgCls: 'bg-rose-500/12',
    textCls: 'text-rose-600 dark:text-rose-400',
    ringCls: 'border-rose-500/35',
  },
  autumn: {
    name: '秋季',
    color: '#f59e0b',
    bgCls: 'bg-amber-500/12',
    textCls: 'text-amber-700 dark:text-amber-300',
    ringCls: 'border-amber-500/35',
  },
  winter: {
    name: '冬季',
    color: '#0ea5e9',
    bgCls: 'bg-sky-500/12',
    textCls: 'text-sky-700 dark:text-sky-300',
    ringCls: 'border-sky-500/35',
  },
}

/** 24 节气文化词典（黄经、季节、习俗、食养与古诗） */
export const SOLAR_TERM_LORE: Record<string, TermLore> = {
  小寒: {
    season: 'winter',
    longitudeDeg: 285,
    tagline: '月初寒尚小，冬深渐近腊',
    customs: '探梅赏腊、冰戏滑冰、备办年货',
    foods: '腊八粥、糯米饭、羊肉汤、菜饭',
    poem: '小寒连大吕，欢鹊垒新巢。',
  },
  大寒: {
    season: 'winter',
    longitudeDeg: 300,
    tagline: '岁末极寒处，静候一阳生',
    customs: '除尘扫舍、尾牙祭灶、贴年红',
    foods: '消寒糕、八宝饭、老母鸡汤、生姜红枣茶',
    poem: '旧雪未及消，新雪又拥户。',
  },
  立春: {
    season: 'spring',
    longitudeDeg: 315,
    tagline: '东风解冻始，岁首万物苏',
    customs: '咬春、打春牛、迎春贴宜春字',
    foods: '春饼、春卷、白萝卜、嫩韭菜',
    poem: '律回岁晚冰霜少，春到人间草木知。',
  },
  雨水: {
    season: 'spring',
    longitudeDeg: 330,
    tagline: '好雨知时节，润物细无声',
    customs: '拉保保、回娘家接寿、占稻色',
    foods: '春笋、豆苗、红枣山药粥、蜂蜜水',
    poem: '天街小雨润如酥，草色遥看近却无。',
  },
  惊蛰: {
    season: 'spring',
    longitudeDeg: 345,
    tagline: '春雷响百虫，桃红柳色新',
    customs: '吃梨离虫、祭白虎、蒙鼓驱虫',
    foods: '冰糖雪梨、炒豆、春菜、荠菜',
    poem: '微雨众卉新，一雷惊蛰始。',
  },
  春分: {
    season: 'spring',
    longitudeDeg: 0,
    tagline: '昼夜均分日，燕归陌上花',
    customs: '竖蛋游戏、放风筝、吃春菜祭祖',
    foods: '春菜鱼片汤、香椿炒蛋、驴打滚、菠菜',
    poem: '仲春初四日，春色正中分。',
  },
  清明: {
    season: 'spring',
    longitudeDeg: 15,
    tagline: '气清景明时，踏青兼追远',
    customs: '扫墓祭祖、踏青郊游、插柳荡秋千',
    foods: '青团、艾草粑粑、明前茶、螺蛳',
    poem: '清明时节雨纷纷，路上行人欲断魂。',
  },
  谷雨: {
    season: 'spring',
    longitudeDeg: 30,
    tagline: '雨生百谷茂，春尽牡丹芳',
    customs: '采谷雨茶、赏牡丹、走谷雨',
    foods: '谷雨新茶、香椿、黑豆、海带排骨汤',
    poem: '谷雨春光晓，山川黛色青。',
  },
  立夏: {
    season: 'summer',
    longitudeDeg: 45,
    tagline: '绿树阴浓处，薰风入夏来',
    customs: '称人祈福、斗蛋、挂蛋兜',
    foods: '立夏饭（乌米饭/豌豆糯米饭）、咸鸭蛋、樱桃',
    poem: '绿树阴浓夏日长，楼台倒影入池塘。',
  },
  小满: {
    season: 'summer',
    longitudeDeg: 60,
    tagline: '麦穗初齐满，蚕新夏意浓',
    customs: '祭车神、祈蚕节、抢水灌田',
    foods: '苦菜、冬瓜、绿豆汤、枇杷',
    poem: '夜莺啼绿柳，皓月醒长空。最爱垄头麦，迎风笑落红。',
  },
  芒种: {
    season: 'summer',
    longitudeDeg: 75,
    tagline: '收麦兼插秧，农忙煮青梅',
    customs: '送花神、安苗祈丰、青梅煮酒',
    foods: '青梅酒、酸梅汤、苦瓜、黄瓜',
    poem: '时雨及芒种，四野皆插秧。',
  },
  夏至: {
    season: 'summer',
    longitudeDeg: 90,
    tagline: '白昼最长日，荷风送晚凉',
    customs: '吃夏至面、赠折扇香囊、祭神祀祖',
    foods: '过水面、凉面、荔枝、西瓜、绿豆百合粥',
    poem: '昼晷已云极，宵漏自此长。',
  },
  小暑: {
    season: 'summer',
    longitudeDeg: 105,
    tagline: '温风拂大地，伏近听蝉鸣',
    customs: '食新尝麦、晒书晒衣、头伏将至',
    foods: '黄鳝、莲藕、绿豆芽、三伏饺子',
    poem: '倏忽温风至，因循小暑来。',
  },
  大暑: {
    season: 'summer',
    longitudeDeg: 120,
    tagline: '盛夏炎威极，腐草化流萤',
    customs: '送大暑船、喝伏茶、晒伏姜',
    foods: '仙草冻、伏羊、冬瓜老鸭汤、凤梨',
    poem: '桂轮开子夜，萤火照空时。',
  },
  立秋: {
    season: 'autumn',
    longitudeDeg: 135,
    tagline: '梧桐一叶落，新凉渐入夜',
    customs: '贴秋膘、啃秋（咬秋）、晒秋',
    foods: '炖肉贴秋膘、西瓜、秋桃、茄子',
    poem: '乳鸦啼散玉屏空，一枕新凉一扇风。',
  },
  处暑: {
    season: 'autumn',
    longitudeDeg: 150,
    tagline: '出暑残炎尽，天高云影轻',
    customs: '放河灯、开渔节、出游迎秋',
    foods: '老鸭汤、百合银耳羹、龙眼、梨',
    poem: '离离暑云散，袅袅凉风起。',
  },
  白露: {
    season: 'autumn',
    longitudeDeg: 165,
    tagline: '蒹葭凝夜露，丹桂始飘香',
    customs: '收清露、酿白露米酒、祭禹王',
    foods: '白露茶、龙眼、红薯、米酒、桂花糕',
    poem: '露从今夜白，月是故乡明。',
  },
  秋分: {
    season: 'autumn',
    longitudeDeg: 180,
    tagline: '平分秋色半，丰年稻谷香',
    customs: '中国农民丰收节、竖蛋、祭月吃秋菜',
    foods: '大闸蟹、芋头、桂花酒、秋梨膏',
    poem: '暑退秋澄气转凉，日光夜色两均长。',
  },
  寒露: {
    season: 'autumn',
    longitudeDeg: 195,
    tagline: '露寒将欲霜，登高赏菊红',
    customs: '登高赏红叶、饮菊花酒、斗蟋蟀',
    foods: '重阳花糕、芝麻糊、山楂、柿子',
    poem: '袅袅凉风动，凄凄寒露零。',
  },
  霜降: {
    season: 'autumn',
    longitudeDeg: 210,
    tagline: '秋深草木霜，霜叶红于花',
    customs: '赏枫赏菊、吃红柿御寒、进补煲汤',
    foods: '霜打柿子、板栗炖鸡、白萝卜、牛肉',
    poem: '停车坐爱枫林晚，霜叶红于二月花。',
  },
  立冬: {
    season: 'winter',
    longitudeDeg: 225,
    tagline: '水始冰寒起，冬藏补元气',
    customs: '补冬贺冬、北方吃饺子、酿黄酒',
    foods: '羊肉饺子、甘蔗、姜母鸭、黑芝麻',
    poem: '冻笔新诗懒写，寒炉美酒时温。',
  },
  小雪: {
    season: 'winter',
    longitudeDeg: 240,
    tagline: '虹藏天初雪，腌腊酿冬味',
    customs: '腌腊肉灌香肠、晒鱼干、吃糍粑',
    foods: '糍粑、腊味、黑豆羊肉煲、白菜豆腐',
    poem: '晚来天欲雪，能饮一杯无？',
  },
  大雪: {
    season: 'winter',
    longitudeDeg: 255,
    tagline: '仲冬瑞雪盛，封河赏雾凇',
    customs: '观赏封河滑冰、腌肉封缸、进补御寒',
    foods: '红薯粥、柑橘、羊肉火锅、莲藕汤',
    poem: '孤舟蓑笠翁，独钓寒江雪。',
  },
  冬至: {
    season: 'winter',
    longitudeDeg: 270,
    tagline: '冬至大如年，数九寒天始',
    customs: '画九消寒、祭祖团圆、北饺子南汤圆',
    foods: '水饺、汤圆、羊肉汤、冬酿酒',
    poem: '天时人事日相催，冬至阳生春又来。',
  },
}

/** 《九九消寒歌》对应每一九的传统谚语 */
export const NINE_SONG_NOTES: Record<string, string> = {
  一九: '一九二九不出手',
  二九: '一九二九不出手',
  三九: '三九四九冰上走（全年最冷时段）',
  四九: '三九四九冰上走',
  五九: '五九六九，沿河看柳',
  六九: '五九六九，沿河看柳',
  七九: '七九河开，八九雁来',
  八九: '七九河开，八九雁来',
  九九: '九九加一九，耕牛遍地走',
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatSolarYmd(sd: SolarDay): string {
  return `${sd.getYear()}-${pad2(sd.getMonth())}-${pad2(sd.getDay())}`
}

export function formatShortMd(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number)
  return `${m}月${d}日`
}

/** 将 SolarTerm 转为带三候详情的完整节点对象 */
function buildSingleTermInfo(term: SolarTerm, orderInYear: number): SolarTermInfo {
  const name = term.getName()
  const sd = term.getSolarDay()
  const st = term.getJulianDay().getSolarTime()
  const ymd = formatSolarYmd(sd)
  const exactTime = `${st.getYear()}-${pad2(st.getMonth())}-${pad2(st.getDay())} ${pad2(st.getHour())}:${pad2(st.getMinute())}:${pad2(st.getSecond())}`
  // tyme4ts SolarTime 为东八区北京时间，明确按 +08:00 转为标准时间戳确保倒计时零时区偏差
  const timestampMs = Date.parse(
    `${st.getYear()}-${pad2(st.getMonth())}-${pad2(st.getDay())}T${pad2(st.getHour())}:${pad2(st.getMinute())}:${pad2(st.getSecond())}+08:00`,
  )

  const lunar = sd.getLunarDay()
  const lunarText = `${lunar.getLunarMonth().getName()}${lunar.getName()}`

  // 提取该节气内的准确三候（从交节当天扫描至下一节气前一天）
  const nextTermDay = term.next(1).getSolarDay()
  const phenMap = new Map<string, { name: string; startYmd: string; endYmd: string }>()
  let cur = sd
  for (let i = 0; i < 18 && !cur.equals(nextTermDay); i++) {
    const pDay = cur.getPhenologyDay()
    const pName = pDay.getPhenology().getName()
    const curYmd = formatSolarYmd(cur)
    const existed = phenMap.get(pName)
    if (existed) {
      existed.endYmd = curYmd
    } else {
      phenMap.set(pName, { name: pName, startYmd: curYmd, endYmd: curYmd })
    }
    cur = cur.next(1)
  }

  const orderLabels: ('初候' | '二候' | '三候')[] = ['初候', '二候', '三候']
  const phenologies: PhenologyEntry[] = Array.from(phenMap.values())
    .slice(0, 3)
    .map((p, idx) => ({
      orderLabel: orderLabels[idx] ?? '三候',
      name: p.name,
      startYmd: p.startYmd,
      endYmd: p.endYmd,
    }))

  const lore = SOLAR_TERM_LORE[name] ?? {
    season: 'spring',
    longitudeDeg: 0,
    tagline: '',
    customs: '',
    foods: '',
    poem: '',
  }

  return {
    orderInYear,
    name,
    kind: term.isJie() ? '节令' : '中气',
    season: lore.season,
    longitudeDeg: lore.longitudeDeg,
    ymd,
    exactTime,
    timestampMs,
    weekLabel: sd.getWeek().getName(),
    lunarText,
    phenologies,
    lore,
  }
}

/** 扫描指定年份全年 24 节气、七十二候及三伏/梅雨/数九周期 */
export function buildYearSolarTermsData(year: number): YearSolarTermsData {
  const safeYear = Math.max(1900, Math.min(2100, year))

  // tyme4ts SolarTerm.fromIndex(year, 1..24) 精确对应公历该年的小寒至冬至 24 个节气
  const terms: SolarTermInfo[] = []
  for (let idx = 1; idx <= 24; idx++) {
    const term = SolarTerm.fromIndex(safeYear, idx)
    terms.push(buildSingleTermInfo(term, idx - 1))
  }

  // 扫描全年每日提取三伏、梅雨、数九精确起止区间
  const dogMap = new Map<string, CycleSpan>()
  const nineEarlyMap = new Map<string, CycleSpan>()
  const nineLateMap = new Map<string, CycleSpan>()
  let plumStart: string | null = null
  let plumEnd: string | null = null
  let plumDays = 0

  let d = SolarDay.fromYmd(safeYear, 1, 1)
  while (d.getYear() === safeYear) {
    const ymd = formatSolarYmd(d)

    // 三伏
    const dogDay = d.getDogDay()
    if (dogDay) {
      const name = dogDay.getDog().getName()
      const existed = dogMap.get(name)
      if (existed) {
        existed.endYmd = ymd
        existed.days += 1
      } else {
        dogMap.set(name, { name, startYmd: ymd, endYmd: ymd, days: 1 })
      }
    }

    // 梅雨（入梅阶段为梅雨季持续日，出梅为结束当天）
    const plumDay = d.getPlumRainDay()
    if (plumDay) {
      const pName = plumDay.getPlumRain().getName()
      if (pName === '入梅') {
        if (!plumStart) plumStart = ymd
        plumEnd = ymd
        plumDays++
      } else if (pName === '出梅') {
        plumEnd = ymd
      }
    }

    // 数九（1~4 月为上一冬延续，12 月为本冬新启）
    const nineDay = d.getNineDay()
    if (nineDay) {
      const name = nineDay.getNine().getName()
      const targetMap = d.getMonth() <= 5 ? nineEarlyMap : nineLateMap
      const existed = targetMap.get(name)
      if (existed) {
        existed.endYmd = ymd
        existed.days += 1
      } else {
        targetMap.set(name, {
          name,
          startYmd: ymd,
          endYmd: ymd,
          days: 1,
          note: NINE_SONG_NOTES[name],
        })
      }
    }

    d = d.next(1)
  }

  const dogDays = Array.from(dogMap.values()).map((span) => ({
    ...span,
    note:
      span.name === '中伏'
        ? span.days >= 20
          ? '加长版中伏（20 天）'
          : '标准中伏（10 天）'
        : span.name === '初伏'
          ? '夏至后第三个庚日起入伏'
          : '立秋后第一个庚日起入末伏',
  }))

  return {
    year: safeYear,
    terms,
    dogDays,
    plumRain: plumStart && plumEnd ? { startYmd: plumStart, endYmd: plumEnd, days: plumDays } : null,
    nineSpansEarly: Array.from(nineEarlyMap.values()),
    nineSpansLate: Array.from(nineLateMap.values()),
  }
}

/** 实时获取此刻所属节气、物候、传统周期以及下一个即将交节的节气 */
export interface LiveSolarStatus {
  todayYmd: string
  currentTermName: string
  currentTermDay: number
  currentPhenologyName: string
  currentPhenologyDay: number
  activeSpecialBadge: string | null
  nextTerm: SolarTermInfo
}

export function getLiveSolarStatus(now = new Date()): LiveSolarStatus {
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const day = now.getDate()
  const sd = SolarDay.fromYmd(y, m, day)
  const termDay = sd.getTermDay()
  const phenDay = sd.getPhenologyDay()

  const nine = sd.getNineDay()
  const dog = sd.getDogDay()
  const plum = sd.getPlumRainDay()
  const activeSpecialBadge = nine
    ? `数九 · ${nine.toString()}`
    : dog
      ? `三伏 · ${dog.toString()}`
      : plum
        ? `梅雨 · ${plum.toString()}`
        : null

  // 查找精确时间戳严格大于当前时刻的下一个节气（自动跨年）
  const nowMs = now.getTime()
  const thisYear = buildYearSolarTermsData(y).terms
  const nextYearFirst = buildSingleTermInfo(SolarTerm.fromIndex(y + 1, 1), 0)
  const nextTerm = [...thisYear, nextYearFirst].find((t) => t.timestampMs > nowMs) ?? nextYearFirst

  return {
    todayYmd: formatSolarYmd(sd),
    currentTermName: termDay.getSolarTerm().getName(),
    currentTermDay: termDay.getDayIndex() + 1,
    currentPhenologyName: phenDay.getPhenology().getName(),
    currentPhenologyDay: phenDay.getDayIndex() + 1,
    activeSpecialBadge,
    nextTerm,
  }
}

/** 导出全年二十四节气 .ics 日历文件 */
export function buildSolarTermsIcs(data: YearSolarTermsData): string {
  const toIcsDate = (ymd: string) => ymd.replace(/-/g, '')
  const nextDayIcs = (ymd: string) => {
    const [y, m, d] = ymd.split('-').map(Number)
    return formatSolarYmd(SolarDay.fromYmd(y, m, d).next(1)).replace(/-/g, '')
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LiteBox//24 Solar Terms//ZH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${data.year}年二十四节气（轻匣）`,
    'X-WR-TIMEZONE:Asia/Shanghai',
  ]

  for (const t of data.terms) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:solar-term-${t.ymd}-${t.orderInYear}@litebox.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${toIcsDate(t.ymd)}`,
      `DTEND;VALUE=DATE:${nextDayIcs(t.ymd)}`,
      `SUMMARY:${t.name}（${t.exactTime.slice(11)} 交节）`,
      `DESCRIPTION:${t.lore.tagline}｜三候：${t.phenologies.map((p) => p.name).join('、')}｜民俗：${t.lore.customs}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    )
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

/** 导出全年 24 节气 Markdown 表 */
export function buildSolarTermsMarkdown(data: YearSolarTermsData): string {
  const rows = data.terms.map(
    (t) =>
      `| ${t.name} | ${SEASON_META[t.season].name} | ${t.exactTime} | 农历${t.lunarText} | ${t.phenologies.map((p) => p.name).join(' · ')} |`,
  )
  return [
    `# ${data.year} 年二十四节气与七十二候时刻表`,
    '',
    '| 节气 | 季节 | 精确交节时刻（北京时间） | 农历 | 三候物候 |',
    '| --- | :---: | :---: | :---: | --- |',
    ...rows,
  ].join('\n')
}
