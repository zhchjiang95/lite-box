import { CalendarHeart } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'legal-holidays',
  name: '法定节假日与拼假攻略',
  description: '全年中国法定节假日与调休补班日历总览、下个假期倒计时、智能年假拼假计算、全年 12 月休/班视图与一键导出 .ics 日历',
  category: 'calendar',
  icon: CalendarHeart,
  keywords: [
    'holiday',
    'legal-holiday',
    'ics',
    'tyme',
    '法定节假日',
    '放假安排',
    '调休',
    '补班',
    '拼假',
    '年假',
    '假期倒计时',
    '工作日',
    '日历导出',
  ],
  badge: 'new',
  createdAt: '2026-11-25',
} satisfies ToolMeta
