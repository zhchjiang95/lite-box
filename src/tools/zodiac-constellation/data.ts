/** 星座、生肖、五行、二十八宿与月相传统文化辞典数据 */

export type WesternElement = '火象' | '土象' | '风象' | '水象'
export type WesternModality = '开创' | '固定' | '变动'
export type WuXing = '金' | '木' | '水' | '火' | '土'
export type FourBeast = '青龙' | '玄武' | '白虎' | '朱雀'

export interface ConstellationMeta {
  /** 与 tyme4ts Constellation.getName() 对应的简称，如“白羊” */
  key: string
  /** 完整中文名，如“白羊座” */
  fullName: string
  /** 英文拉丁名 */
  enName: string
  /** 占星符号 */
  symbol: string
  /** 常见公历日期跨度 */
  dateRange: string
  /** 起始月日 [month, day] */
  startMd: [number, number]
  /** 结束月日 [month, day] */
  endMd: [number, number]
  /** 四象元素 */
  element: WesternElement
  /** 三方模式 */
  modality: WesternModality
  /** 传统守护星 */
  ruler: string
  /** 核心性格关键词 */
  traits: string[]
  /** 简明文化介绍 */
  summary: string
}

export interface ZodiacMeta {
  /** 与 tyme4ts Zodiac.getName() 对应，如“鼠” */
  key: string
  /** 对应十二地支 */
  branch: string
  /** 对应五行 */
  element: WuXing
  /** 生肖图标 */
  emoji: string
  /** 三合生肖 */
  sanHe: [string, string]
  /** 六合生肖 */
  liuHe: string
  /** 六冲生肖 */
  liuChong: string
  /** 传统文化意象 */
  summary: string
}

export interface WuXingStyle {
  name: WuXing
  color: string
  bgClass: string
  textClass: string
  borderClass: string
  barClass: string
  generates: WuXing
  overcomes: WuXing
  direction: string
  season: string
}

export interface FourBeastStyle {
  beast: FourBeast
  direction: string
  title: string
  color: string
  badgeClass: string
  borderClass: string
  bgClass: string
  stars: string[]
}

export interface ShiChenItem {
  branch: string
  name: string
  rangeLabel: string
  /** 选此快捷时辰时自动填入的代表小时 */
  sampleHour: number
}

/** 西方四象视觉样式 */
export const WESTERN_ELEMENT_STYLE: Record<
  WesternElement,
  { color: string; badgeClass: string; borderClass: string; bgClass: string; desc: string }
> = {
  火象: {
    color: '#ef4444',
    badgeClass: 'bg-rose-500/12 text-rose-600 dark:text-rose-400 border-rose-500/25',
    borderClass: 'border-rose-500/30',
    bgClass: 'bg-rose-500/6',
    desc: '热情直率、行动力强、富有开创精神',
  },
  土象: {
    color: '#d97706',
    badgeClass: 'bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/25',
    borderClass: 'border-amber-500/30',
    bgClass: 'bg-amber-500/6',
    desc: '沉稳务实、注重秩序、耐心且具韧性',
  },
  风象: {
    color: '#0ea5e9',
    badgeClass: 'bg-sky-500/12 text-sky-600 dark:text-sky-400 border-sky-500/25',
    borderClass: 'border-sky-500/30',
    bgClass: 'bg-sky-500/6',
    desc: '思维灵动、善沟通表达、重视理念与自由',
  },
  水象: {
    color: '#6366f1',
    badgeClass: 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-400 border-indigo-500/25',
    borderClass: 'border-indigo-500/30',
    bgClass: 'bg-indigo-500/6',
    desc: '细腻共情、直觉敏锐、内心丰盈深沉',
  },
}

/** 十二星座完整数据（顺序与黄道春分起算一致） */
export const CONSTELLATION_LIST: ConstellationMeta[] = [
  {
    key: '白羊',
    fullName: '白羊座',
    enName: 'Aries',
    symbol: '♈',
    dateRange: '3月21日 – 4月19日',
    startMd: [3, 21],
    endMd: [4, 19],
    element: '火象',
    modality: '开创',
    ruler: '火星',
    traits: ['果敢冲劲', '直率坦荡', '开疆拓土'],
    summary: '黄道第一宫，象征春分破土的新生力量，常具先发制人的勇气与鲜明热情。',
  },
  {
    key: '金牛',
    fullName: '金牛座',
    enName: 'Taurus',
    symbol: '♉',
    dateRange: '4月20日 – 5月20日',
    startMd: [4, 20],
    endMd: [5, 20],
    element: '土象',
    modality: '固定',
    ruler: '金星',
    traits: ['笃定踏实', '审美敏锐', '持之以恒'],
    summary: '深耕细作的土象固定宫，偏爱质感、丰盈与长期积累带来的确定感。',
  },
  {
    key: '双子',
    fullName: '双子座',
    enName: 'Gemini',
    symbol: '♊',
    dateRange: '5月21日 – 6月21日',
    startMd: [5, 21],
    endMd: [6, 21],
    element: '风象',
    modality: '变动',
    ruler: '水星',
    traits: ['好奇多变', '机敏健谈', '触类旁通'],
    summary: '信息与联结的使者，思维跳跃敏捷，擅长从多元视角捕捉新鲜灵感。',
  },
  {
    key: '巨蟹',
    fullName: '巨蟹座',
    enName: 'Cancer',
    symbol: '♋',
    dateRange: '6月22日 – 7月22日',
    startMd: [6, 22],
    endMd: [7, 22],
    element: '水象',
    modality: '开创',
    ruler: '月亮',
    traits: ['温润守护', '念旧重情', '直觉细腻'],
    summary: '以夏至为始的水象开创宫，情感丰富而有韧性，看重归属感与内在滋养。',
  },
  {
    key: '狮子',
    fullName: '狮子座',
    enName: 'Leo',
    symbol: '♌',
    dateRange: '7月23日 – 8月22日',
    startMd: [7, 23],
    endMd: [8, 22],
    element: '火象',
    modality: '固定',
    ruler: '太阳',
    traits: ['明朗自信', '慷慨热忱', '创造表现'],
    summary: '盛夏太阳守护之宫，自带舞台光芒与担当气度，乐于鼓励并照亮身边人。',
  },
  {
    key: '处女',
    fullName: '处女座',
    enName: 'Virgo',
    symbol: '♍',
    dateRange: '8月23日 – 9月22日',
    startMd: [8, 23],
    endMd: [9, 22],
    element: '土象',
    modality: '变动',
    ruler: '水星',
    traits: ['条理精微', '克制严谨', '精益求精'],
    summary: '注重秩序与实效的土象变动宫，擅长梳理复杂细节并将理念落到实处。',
  },
  {
    key: '天秤',
    fullName: '天秤座',
    enName: 'Libra',
    symbol: '♎',
    dateRange: '9月23日 – 10月23日',
    startMd: [9, 23],
    endMd: [10, 23],
    element: '风象',
    modality: '开创',
    ruler: '金星',
    traits: ['优雅权衡', '公平谐和', '善解人意'],
    summary: '起于秋分的风象开创宫，追求关系、逻辑与美感之间的恰当平衡。',
  },
  {
    key: '天蝎',
    fullName: '天蝎座',
    enName: 'Scorpio',
    symbol: '♏',
    dateRange: '10月24日 – 11月22日',
    startMd: [10, 24],
    endMd: [11, 22],
    element: '水象',
    modality: '固定',
    ruler: '冥王星 / 火星',
    traits: ['深邃专注', '洞察本质', '意志坚定'],
    summary: '秋深敛藏的水象固定宫，外敛内炽，面对挑战往往具备极强的专注与破局力。',
  },
  {
    key: '射手',
    fullName: '射手座',
    enName: 'Sagittarius',
    symbol: '♐',
    dateRange: '11月23日 – 12月21日',
    startMd: [11, 23],
    endMd: [12, 21],
    element: '火象',
    modality: '变动',
    ruler: '木星',
    traits: ['豁达率真', '远游求索', '乐观开阔'],
    summary: '心怀远方的火象变动宫，向往辽阔天地与思想探索，自带爽朗洒脱气质。',
  },
  {
    key: '摩羯',
    fullName: '摩羯座',
    enName: 'Capricorn',
    symbol: '♑',
    dateRange: '12月22日 – 1月19日',
    startMd: [12, 22],
    endMd: [1, 19],
    element: '土象',
    modality: '开创',
    ruler: '土星',
    traits: ['沉毅自持', '长远规划', '厚积薄发'],
    summary: '冬至起算的土象开创宫，耐得住寂寞、看重结构与责任，擅长以时间沉淀成果。',
  },
  {
    key: '水瓶',
    fullName: '水瓶座',
    enName: 'Aquarius',
    symbol: '♒',
    dateRange: '1月20日 – 2月18日',
    startMd: [1, 20],
    endMd: [2, 18],
    element: '风象',
    modality: '固定',
    ruler: '天王星 / 土星',
    traits: ['独立前瞻', '理性疏朗', '不拘一格'],
    summary: '富有革新意识的风象固定宫，善于跳出惯性框架，以冷静客观视角审视世界。',
  },
  {
    key: '双鱼',
    fullName: '双鱼座',
    enName: 'Pisces',
    symbol: '♓',
    dateRange: '2月19日 – 3月20日',
    startMd: [2, 19],
    endMd: [3, 20],
    element: '水象',
    modality: '变动',
    ruler: '海王星 / 木星',
    traits: ['浪漫灵性', '包容共情', '想象丰沛'],
    summary: '黄道终末亦是孕育之宫，柔和感性且具艺术直觉，容易感受细微情绪与诗意。',
  },
]

export const CONSTELLATION_MAP: Record<string, ConstellationMeta> = Object.fromEntries(
  CONSTELLATION_LIST.map((c) => [c.key, c]),
)

/** 十二生肖完整辞典 */
export const ZODIAC_LIST: ZodiacMeta[] = [
  {
    key: '鼠',
    branch: '子',
    element: '水',
    emoji: '🐭',
    sanHe: ['龙', '猴'],
    liuHe: '牛',
    liuChong: '马',
    summary: '子水机敏灵动，象征生机初发、善察微澜与精明筹谋。',
  },
  {
    key: '牛',
    branch: '丑',
    element: '土',
    emoji: '🐮',
    sanHe: ['蛇', '鸡'],
    liuHe: '鼠',
    liuChong: '羊',
    summary: '丑土勤恳厚重，象征脚踏实地、蓄力耕耘与稳健恒心。',
  },
  {
    key: '虎',
    branch: '寅',
    element: '木',
    emoji: '🐯',
    sanHe: ['马', '狗'],
    liuHe: '猪',
    liuChong: '猴',
    summary: '寅木昂扬挺拔，象征孟春破寒、果敢担当与威仪气魄。',
  },
  {
    key: '兔',
    branch: '卯',
    element: '木',
    emoji: '🐰',
    sanHe: ['猪', '羊'],
    liuHe: '狗',
    liuChong: '鸡',
    summary: '卯木温润灵秀，象征仲春舒展、温和机警与儒雅从容。',
  },
  {
    key: '龙',
    branch: '辰',
    element: '土',
    emoji: '🐲',
    sanHe: ['鼠', '猴'],
    liuHe: '鸡',
    liuChong: '狗',
    summary: '辰土纳水行云，象征宏阔格局、进取志向与变化生机。',
  },
  {
    key: '蛇',
    branch: '巳',
    element: '火',
    emoji: '🐍',
    sanHe: ['牛', '鸡'],
    liuHe: '猴',
    liuChong: '猪',
    summary: '巳火明察内敛，象征睿智沉静、条理周密与厚积敏行。',
  },
  {
    key: '马',
    branch: '午',
    element: '火',
    emoji: '🐴',
    sanHe: ['虎', '狗'],
    liuHe: '羊',
    liuChong: '鼠',
    summary: '午火炽烈奔放，象征驰骋千里、明快热烈与自由奔赴。',
  },
  {
    key: '羊',
    branch: '未',
    element: '土',
    emoji: '🐑',
    sanHe: ['兔', '猪'],
    liuHe: '马',
    liuChong: '牛',
    summary: '未土温厚和煦，象征谦和柔韧、仁善细腻与含蓄内力。',
  },
  {
    key: '猴',
    branch: '申',
    element: '金',
    emoji: '🐵',
    sanHe: ['鼠', '龙'],
    liuHe: '蛇',
    liuChong: '虎',
    summary: '申金清朗迅捷，象征聪慧变通、好奇善学与灵活应变。',
  },
  {
    key: '鸡',
    branch: '酉',
    element: '金',
    emoji: '🐔',
    sanHe: ['牛', '蛇'],
    liuHe: '龙',
    liuChong: '兔',
    summary: '酉金精致守信，象征司晨知时、条理明晰与务实精进。',
  },
  {
    key: '狗',
    branch: '戌',
    element: '土',
    emoji: '🐶',
    sanHe: ['虎', '马'],
    liuHe: '兔',
    liuChong: '龙',
    summary: '戌土忠厚守义，象征赤诚可靠、重诺担当与沉稳护持。',
  },
  {
    key: '猪',
    branch: '亥',
    element: '水',
    emoji: '🐷',
    sanHe: ['兔', '羊'],
    liuHe: '虎',
    liuChong: '蛇',
    summary: '亥水宽厚藏福，象征豁达真诚、包容大度与从容积善。',
  },
]

export const ZODIAC_MAP: Record<string, ZodiacMeta> = Object.fromEntries(
  ZODIAC_LIST.map((z) => [z.key, z]),
)

/** 五行视觉与生克映射 */
export const WUXING_ORDER: WuXing[] = ['木', '火', '土', '金', '水']

export const WUXING_STYLE: Record<WuXing, WuXingStyle> = {
  木: {
    name: '木',
    color: '#10b981',
    bgClass: 'bg-emerald-500/12',
    textClass: 'text-emerald-600 dark:text-emerald-400',
    borderClass: 'border-emerald-500/30',
    barClass: 'bg-emerald-500',
    generates: '火',
    overcomes: '土',
    direction: '东',
    season: '春',
  },
  火: {
    name: '火',
    color: '#f43f5e',
    bgClass: 'bg-rose-500/12',
    textClass: 'text-rose-600 dark:text-rose-400',
    borderClass: 'border-rose-500/30',
    barClass: 'bg-rose-500',
    generates: '土',
    overcomes: '金',
    direction: '南',
    season: '夏',
  },
  土: {
    name: '土',
    color: '#d97706',
    bgClass: 'bg-amber-500/12',
    textClass: 'text-amber-700 dark:text-amber-400',
    borderClass: 'border-amber-500/30',
    barClass: 'bg-amber-500',
    generates: '金',
    overcomes: '水',
    direction: '中',
    season: '季月',
  },
  金: {
    name: '金',
    color: '#eab308',
    bgClass: 'bg-yellow-500/12',
    textClass: 'text-yellow-700 dark:text-yellow-400',
    borderClass: 'border-yellow-500/30',
    barClass: 'bg-yellow-500',
    generates: '水',
    overcomes: '木',
    direction: '西',
    season: '秋',
  },
  水: {
    name: '水',
    color: '#0ea5e9',
    bgClass: 'bg-sky-500/12',
    textClass: 'text-sky-600 dark:text-sky-400',
    borderClass: 'border-sky-500/30',
    barClass: 'bg-sky-500',
    generates: '木',
    overcomes: '火',
    direction: '北',
    season: '冬',
  },
}

/** 东方四象与二十八星宿分组 */
export const FOUR_BEAST_GROUPS: FourBeastStyle[] = [
  {
    beast: '青龙',
    direction: '东',
    title: '东方青龙七宿',
    color: '#10b981',
    badgeClass: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
    borderClass: 'border-emerald-500/30',
    bgClass: 'bg-emerald-500/6',
    stars: ['角', '亢', '氐', '房', '心', '尾', '箕'],
  },
  {
    beast: '玄武',
    direction: '北',
    title: '北方玄武七宿',
    color: '#0ea5e9',
    badgeClass: 'bg-sky-500/12 text-sky-700 dark:text-sky-400 border-sky-500/25',
    borderClass: 'border-sky-500/30',
    bgClass: 'bg-sky-500/6',
    stars: ['斗', '牛', '女', '虚', '危', '室', '壁'],
  },
  {
    beast: '白虎',
    direction: '西',
    title: '西方白虎七宿',
    color: '#f59e0b',
    badgeClass: 'bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/25',
    borderClass: 'border-amber-500/30',
    bgClass: 'bg-amber-500/6',
    stars: ['奎', '娄', '胃', '昴', '毕', '觜', '参'],
  },
  {
    beast: '朱雀',
    direction: '南',
    title: '南方朱雀七宿',
    color: '#f43f5e',
    badgeClass: 'bg-rose-500/12 text-rose-700 dark:text-rose-400 border-rose-500/25',
    borderClass: 'border-rose-500/30',
    bgClass: 'bg-rose-500/6',
    stars: ['井', '鬼', '柳', '星', '张', '翼', '轸'],
  },
]

export const FOUR_BEAST_MAP: Record<string, FourBeastStyle> = Object.fromEntries(
  FOUR_BEAST_GROUPS.map((g) => [g.beast, g]),
)

/** 二十八宿古天文简释 */
export const STAR_LORE: Record<string, string> = {
  角: '青龙之角，二十八宿之首，古人常以昏见角宿观农时开端。',
  亢: '青龙之颈，位处天庭咽喉，主司礼仪与气象清明。',
  氐: '青龙之胸，亦称天根，秋深氐宿晨见象征草木归藏。',
  房: '青龙之腹，古称天驷、明堂，与古代车驾和星象纪年密切相关。',
  心: '青龙之心，含著名红超巨星心宿二（大火），《诗经》“七月流火”即指此星。',
  尾: '青龙之尾，九星如勾陈列银河之畔，古称九子之宿。',
  箕: '青龙尾末，形似扬米之箕，古语“箕好风、毕好雨”源于此宿。',
  斗: '玄武之首，即南斗六星，与北斗遥相呼应，横跨人马座亮星区。',
  牛: '即牵牛宿，虽非织女对岸的河鼓二，却同为古星图银河津渡要冲。',
  女: '即须女宿，主司织作与巧思，古人以此宿纪仲冬星象。',
  虚: '玄武中宫，昔日冬至太阳曾驻于此，为古代校准岁差的关键基准宿。',
  危: '形似高屋飞檐，古称天府危楼，象征登高望远与谨慎持守。',
  室: '又称营室、定星，古人见定星中天便开始营建宫室土木。',
  壁: '即东壁二星，古称图书之府、文章之秘，与室宿共构飞马座四边形。',
  奎: '白虎之首，十六星曲折如履，古以“奎星”象征文运与武库。',
  娄: '三星贯列如聚众，古人视其为牧养、丰聚与祭祀之象。',
  胃: '古称天仓，主藏五谷丰登，白虎腹中之粮库。',
  昴: '即璀璨的昴星团（七姊妹星团），《尚书》“日短星昴，以正仲冬”。',
  毕: '形如捕兔之网，含橘红亮星毕宿五，“毕好雨”为古代占雨要宿。',
  觜: '即觜觿，猎户座头部三星，是二十八宿中赤经跨度最窄的一宿。',
  参: '白虎胸腹，即猎户座璀璨三星腰带与四亮星，“人生不相见，动如参与商”。',
  井: '朱雀之首，亦称东井，赤经跨度最广，古人视作天之水衡法度。',
  鬼: '即舆鬼，中央积尸气即著名的鬼星团（M44 蜂巢星团）。',
  柳: '朱雀之喙，八星垂挂如柳枝，主司草木生机与庖厨烟火。',
  星: '即七星宿，朱雀颈项，亮星轩辕十四邻近，古称文明衣裳之象。',
  张: '朱雀之嗉，形如张开之弓网，古人用以象征宾宴礼乐。',
  翼: '朱雀双翼，二十二星舒展如羽，象征远行、乐舞与舒展气象。',
  轸: '朱雀之尾，形如古车后横木，为二十八宿压轴之宿。',
}

/** 八大月相诗意说明 */
export const PHASE_INFO: Record<string, { en: string; desc: string; fractionRange: string }> = {
  新月: { en: 'New Moon', desc: '日月合朔，月面隐于夜幕，万物蓄势待发。', fractionRange: '0% – 3%' },
  蛾眉月: { en: 'Waxing Crescent', desc: '一弯清眉初现西天，微光渐长，充满新生气息。', fractionRange: '3% – 45%' },
  上弦月: { en: 'First Quarter', desc: '半壁明月高悬中天，明暗均分，行进至前半程高峰。', fractionRange: '≈ 50%' },
  盈凸月: { en: 'Waxing Gibbous', desc: '清辉渐满、圆融在望，象征积蓄走向丰盛。', fractionRange: '55% – 96%' },
  满月: { en: 'Full Moon', desc: '日月相望，玉盘圆满皎洁，光华至盛。', fractionRange: '97% – 100%' },
  亏凸月: { en: 'Waning Gibbous', desc: '满而不溢，清光渐敛，适合沉淀与分享收获。', fractionRange: '96% – 55%' },
  下弦月: { en: 'Last Quarter', desc: '半月东升于子夜，去芜存菁，静待新一轮流转。', fractionRange: '≈ 50%' },
  残月: { en: 'Waning Crescent', desc: '晓月如钩映晨曦，余韵悠长，孕育下一次初生。', fractionRange: '45% – 3%' },
}

/** 十二传统时辰列表 */
export const SHICHEN_LIST: ShiChenItem[] = [
  { branch: '子', name: '子时', rangeLabel: '23:00–00:59', sampleHour: 0 },
  { branch: '丑', name: '丑时', rangeLabel: '01:00–02:59', sampleHour: 2 },
  { branch: '寅', name: '寅时', rangeLabel: '03:00–04:59', sampleHour: 4 },
  { branch: '卯', name: '卯时', rangeLabel: '05:00–06:59', sampleHour: 6 },
  { branch: '辰', name: '辰时', rangeLabel: '07:00–08:59', sampleHour: 8 },
  { branch: '巳', name: '巳时', rangeLabel: '09:00–10:59', sampleHour: 10 },
  { branch: '午', name: '午时', rangeLabel: '11:00–12:59', sampleHour: 12 },
  { branch: '未', name: '未时', rangeLabel: '13:00–14:59', sampleHour: 14 },
  { branch: '申', name: '申时', rangeLabel: '15:00–16:59', sampleHour: 16 },
  { branch: '酉', name: '酉时', rangeLabel: '17:00–18:59', sampleHour: 18 },
  { branch: '戌', name: '戌时', rangeLabel: '19:00–20:59', sampleHour: 20 },
  { branch: '亥', name: '亥时', rangeLabel: '21:00–22:59', sampleHour: 22 },
]
