import { LayoutPanelTop } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'image-stitch',
  name: '图片拼接',
  description: '多张图片横向、纵向或宫格拼接，支持间距、圆角、背景色，长截图一键合成',
  category: 'image',
  icon: LayoutPanelTop,
  keywords: ['拼图', '长图', '合并图片', '截图拼接', '九宫格', 'stitch', 'merge', 'collage'],
  badge: 'hot',
  createdAt: '2026-11-12',
} satisfies ToolMeta

