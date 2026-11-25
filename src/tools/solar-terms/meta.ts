import { Sun } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'solar-terms',
  name: '二十四节气与物候指南',
  description: '精准计算 1900–2100 年二十四节气交节时刻（精确到秒）、实时倒计时、七十二候、数九三伏梅雨时间轴与民俗食养',
  category: 'calendar',
  icon: Sun,
  keywords: [
    'solar-terms',
    'jieqi',
    'tyme',
    '二十四节气',
    '节气',
    '七十二候',
    '物候',
    '数九',
    '三伏',
    '三伏天',
    '入梅',
    '出梅',
    '梅雨',
    '立春',
    '冬至',
    '夏至',
  ],
  badge: 'new',
  createdAt: '2026-11-25',
} satisfies ToolMeta
