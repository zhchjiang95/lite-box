import { Dices } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'random-picker',
  name: '随机抽签与转盘决策',
  description: '支持幸运大转盘与滚动抽签点名双模式，支持权重概率、不重复连抽、沉浸式全屏大屏模式、礼花彩带与清脆音效',
  category: 'life',
  icon: Dices,
  keywords: [
    '随机抽签',
    '转盘',
    '大转盘',
    '转盘决策',
    '抽奖',
    '年会抽奖',
    '随机点名',
    '吃什么',
    '全屏抽奖',
    'random',
    'wheel',
    'picker',
    'lottery',
  ],
  badge: 'new',
  createdAt: '2026-11-22',
} satisfies ToolMeta
