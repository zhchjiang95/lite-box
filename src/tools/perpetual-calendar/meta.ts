import { CalendarDays } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'perpetual-calendar',
  name: '万年历与传统黄历',
  description:
    '全月视图与当日黄历双栏展示，支持公历/农历/干支/藏历/儒略日多历法互转、法定休班、择日筛选、每日宜忌冲煞、吉神方位、九星时辰与农历生日转公历',
  category: 'calendar',
  icon: CalendarDays,
  keywords: [
    'perpetual-calendar',
    'calendar',
    'almanac',
    'huangli',
    'tyme',
    '万年历',
    '黄历',
    '老黄历',
    '农历',
    '阴历',
    '宜忌',
    '择日',
    '吉日',
    '冲煞',
    '彭祖百忌',
    '吉神方位',
    '财神方位',
    '九星',
    '藏历',
    '儒略日',
    '时辰吉凶',
    '农历生日',
    '公农历转换',
  ],
  badge: 'new',
  createdAt: '2026-11-25',
} satisfies ToolMeta
