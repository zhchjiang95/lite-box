import { FileImage } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'image-to-pdf',
  name: '图片转 PDF',
  description: '多张图片一键合成 PDF，支持 A4/自适应纸张、自动方向、页边距、拖拽排序与体积压缩',
  category: 'pdf',
  icon: FileImage,
  keywords: ['图片转pdf', '照片转pdf', '转pdf', '合成pdf', 'a4', 'heic转pdf', 'image2pdf', 'jpg2pdf', 'png2pdf'],
  badge: 'new',
  createdAt: '2026-11-22',
} satisfies ToolMeta
