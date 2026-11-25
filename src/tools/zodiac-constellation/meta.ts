import { Sparkles } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'zodiac-constellation',
  name: '星座、生肖与干支星宿',
  description:
    '输入公历或农历出生日期时间，精准查询西方十二星座与交界说明、立春/春节双口径生肖、干支八字纳音五行、出生月相与二十八宿',
  category: 'calendar',
  icon: Sparkles,
  keywords: [
    'zodiac',
    'constellation',
    'bazi',
    'eight-char',
    'tyme',
    '星座',
    '十二星座',
    '生肖',
    '属相',
    '干支',
    '八字',
    '排盘',
    '纳音',
    '五行',
    '二十八宿',
    '星宿',
    '月相',
    '生辰',
    '立春',
    '农历',
  ],
  badge: 'new',
  createdAt: '2026-11-25',
} satisfies ToolMeta
