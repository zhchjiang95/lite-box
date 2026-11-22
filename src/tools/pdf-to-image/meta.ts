import { Images } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'pdf-to-image',
  name: 'PDF 转图片',
  description: '将 PDF 逐页渲染为高清 PNG / JPG / WebP，支持单页下载、批量打包 ZIP 或一键合成为长图',
  category: 'pdf',
  icon: Images,
  keywords: ['pdf转图片', 'pdf转png', 'pdf转jpg', 'pdf转长图', '导出图片', 'pdf2img', 'pdf2png', 'pdf2jpg'],
  badge: 'new',
  createdAt: '2026-11-22',
} satisfies ToolMeta
