import { Grid3x3 } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'image-split',
  name: '九宫格切图',
  description: '将图片切分为 3×3 九宫格、2×2 四宫格或任意行列，支持朋友圈正方形构图拖拽与一键 ZIP 打包',
  category: 'image',
  icon: Grid3x3,
  keywords: ['九宫格', '切图', '宫格切图', '朋友圈', '微博', '四宫格', '六宫格', '分割图片', 'split', 'grid'],
  badge: 'new',
  createdAt: '2026-11-22',
} satisfies ToolMeta
