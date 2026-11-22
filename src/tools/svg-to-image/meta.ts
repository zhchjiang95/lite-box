import { FileCode2 } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'svg-to-image',
  name: 'SVG 转图片',
  description: '粘贴 SVG 代码或批量上传 .svg 文件，按 1×–8× 倍率或自定义像素无锯齿导出 PNG / WebP / JPG',
  category: 'image',
  icon: FileCode2,
  keywords: ['svg', '矢量图', 'svg转png', 'svg转webp', 'svg转jpg', 'icon', '图标导出', 'dataurl'],
  badge: 'new',
  createdAt: '2026-11-22',
} satisfies ToolMeta
