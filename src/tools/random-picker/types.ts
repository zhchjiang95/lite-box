/** 随机抽签与转盘决策：类型定义、权重解析、配色方案与场景预设 */

export type PickerMode = 'wheel' | 'draw'

export interface PickerItem {
  id: string
  label: string
  weight: number
  color: string
}

export interface DrawRecord {
  id: string
  round: number
  mode: PickerMode
  winners: string[]
  time: string
}

export interface PickerPreset {
  id: string
  label: string
  title: string
  mode: PickerMode
  itemsText: string
}

/** 饱和明快且高对比度的转盘扇区配色（兼顾浅色与暗色全屏舞台） */
export const WHEEL_COLORS = [
  '#6366f1', // 靛蓝
  '#ec4899', // 玫粉
  '#f59e0b', // 琥珀
  '#10b981', // 翡翠
  '#0ea5e9', // 天蓝
  '#f43f5e', // 珊瑚红
  '#8b5cf6', // 紫罗兰
  '#14b8a6', // 青绿
  '#f97316', // 活力橙
  '#3b82f6', // 亮蓝
  '#84cc16', // 青柠
  '#d946ef', // 洋红
] as const

/** 内置高频场景预设 */
export const PICKER_PRESETS: PickerPreset[] = [
  {
    id: 'food',
    label: '今天吃什么',
    title: '今天吃什么？',
    mode: 'wheel',
    itemsText: `重庆火锅
炭火烤肉
日式拉面
麻辣烫
意式披萨
广式茶点
酸菜鱼
轻食沙拉
螺蛳粉
汉堡薯条`,
  },
  {
    id: 'lottery',
    label: '幸运抽奖',
    title: '年度幸运大抽奖',
    mode: 'wheel',
    itemsText: `特等奖 · 神秘大奖 * 1
一等奖 · 无线降噪耳机 * 2
二等奖 · 机械键盘 * 3
三等奖 · 精品保温杯 * 5
幸运奖 · 下午茶券 * 8
再来一次 * 4`,
  },
  {
    id: 'rollcall',
    label: '随机点名',
    title: '随机点名抽签',
    mode: 'draw',
    itemsText: `林小满
陈思远
周嘉禾
苏晚晴
顾明朗
许清欢
陆知行
沈星河
江晏清
唐悦宁
叶景澄
程安然`,
  },
  {
    id: 'team',
    label: '团建分工',
    title: '随机任务分配',
    mode: 'draw',
    itemsText: `主持开场
记录纪要
订下午茶
拍照留念
总结复盘
准备小游戏`,
  },
  {
    id: 'yesno',
    label: '做决定',
    title: '听天由命做决定',
    mode: 'wheel',
    itemsText: `果断去做！
再等一等
直接冲！
先缓一缓
换个方案
问问朋友`,
  },
]

/**
 * 解析多行候选文本（支持权重语法：`选项 * 3` 或 `选项*3`）
 */
export function parseItemsText(text: string): PickerItem[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  return lines.map((line, idx) => {
    let label = line
    let weight = 1
    const weightMatch = /^(.*?)\s*[*×]\s*(\d+(?:\.\d+)?)$/.exec(line)
    if (weightMatch && weightMatch[1].trim()) {
      label = weightMatch[1].trim()
      const parsedW = Number(weightMatch[2])
      if (Number.isFinite(parsedW) && parsedW > 0) {
        weight = Math.min(100, Math.max(0.1, parsedW))
      }
    }

    return {
      id: `${idx}-${label}`,
      label,
      weight,
      color: WHEEL_COLORS[idx % WHEEL_COLORS.length],
    }
  })
}

/** 密码学安全随机数 [0, 1) */
export function secureRandomFloat(): number {
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return arr[0] / 4294967296
}

/** 按权重密码学安全随机抽取 N 个不重复项 */
export function pickWeightedRandom(items: PickerItem[], count: number): PickerItem[] {
  const pool = [...items]
  const picked: PickerItem[] = []
  const target = Math.min(Math.max(1, count), pool.length)

  for (let k = 0; k < target; k++) {
    const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0)
    let r = secureRandomFloat() * totalWeight
    let chosenIdx = pool.length - 1
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight
      if (r <= 0) {
        chosenIdx = i
        break
      }
    }
    picked.push(pool[chosenIdx])
    pool.splice(chosenIdx, 1)
  }
  return picked
}

/** Fisher-Yates 安全洗牌 */
export function shuffleLines(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  for (let i = lines.length - 1; i > 0; i--) {
    const j = Math.floor(secureRandomFloat() * (i + 1))
    const tmp = lines[i]
    lines[i] = lines[j]
    lines[j] = tmp
  }
  return lines.join('\n')
}
