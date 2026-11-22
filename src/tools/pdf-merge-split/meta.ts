import { FileStack } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'pdf-merge-split',
  name: 'PDF 合并与拆分',
  description: '多份 PDF 拖拽合并、可视化页面重排、单页旋转删除、按页码范围或固定页数拆分并打包 ZIP',
  category: 'pdf',
  icon: FileStack,
  keywords: ['pdf', '合并', '拆分', '提取页面', '删除页面', '旋转pdf', '页面重排', 'merge', 'split'],
  badge: 'hot',
  createdAt: '2026-11-22',
} satisfies ToolMeta
