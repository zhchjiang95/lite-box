import { Presentation } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'blackboard',
  name: '演示黑板 / 手绘白板',
  description: '打开即用的单页应急展示黑板：自由手绘、箭头图形、任意输入文字与贴图批注，支持像 PPT 一样全屏沉浸放映与激光笔讲解',
  category: 'life',
  icon: Presentation,
  keywords: [
    '黑板',
    '白板',
    '演示黑板',
    '手绘白板',
    '画板',
    '涂鸦',
    '全屏展示',
    'ppt',
    '讲课',
    '投屏',
    '激光笔',
    'blackboard',
    'whiteboard',
  ],
  badge: 'new',
  createdAt: '2026-11-22',
} satisfies ToolMeta
