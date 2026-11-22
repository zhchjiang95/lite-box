import { BadgeJapaneseYen } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'rmb-upper',
  name: '数字转人民币大写',
  description: '阿拉伯数字金额按财务规范实时转为汉字大写，支持支票/发票数位格对照、大写反查数字、Excel 多行批量转换与自动求和',
  category: 'life',
  icon: BadgeJapaneseYen,
  keywords: [
    '人民币大写',
    '金额大写',
    '数字转大写',
    '财务大写',
    '支票大写',
    '发票金额',
    '大小写转换',
    'rmb',
    'cny',
    'money',
  ],
  badge: 'new',
  createdAt: '2026-11-22',
} satisfies ToolMeta
