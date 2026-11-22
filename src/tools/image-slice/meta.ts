import { ScissorsLineDashed } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'image-slice',
  name: '长图切分',
  description: '将滚动截图或超长海报按比例、固定高度或等份切分为多张图，支持拖拽切线与智能避开文字行',
  category: 'image',
  icon: ScissorsLineDashed,
  keywords: ['长图切分', '长截图', '分页', '切长图', '小红书', '公众号', '长图分割', 'slice', 'split', 'long'],
  badge: 'new',
  createdAt: '2026-11-22',
} satisfies ToolMeta
