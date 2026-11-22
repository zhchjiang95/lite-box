import { Minimize2 } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'image-compress',
  name: '图片压缩',
  description: '批量压缩 JPG、PNG、WebP、AVIF，支持画质微调、前后对比滑动条与一键 ZIP 打包',
  category: 'image',
  icon: Minimize2,
  keywords: ['压缩', '瘦身', '减小体积', 'tinypng', 'squoosh', 'compress', 'png', 'jpg', 'webp', 'avif', 'zip'],
  badge: 'new',
  createdAt: '2026-11-22',
} satisfies ToolMeta
