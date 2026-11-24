import { Stamp } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'pdf-watermark',
  name: 'PDF 水印、页码与打码',
  description: '为 PDF 批量添加中英文/Logo 水印与页码，并支持绘制矩形、圆形纯色打码遮挡（可选彻底抹除底层防复制文字）',
  category: 'pdf',
  icon: Stamp,
  keywords: [
    'pdf加水印',
    'pdf水印',
    'pdf页码',
    'pdf打码',
    'pdf涂黑',
    'pdf遮挡',
    'pdf脱敏',
    '添加页码',
    '保密水印',
    '合同水印',
    'watermark',
    'redact',
    'mosaic',
    'page-number',
  ],
  badge: 'new',
  createdAt: '2026-11-22',
} satisfies ToolMeta
