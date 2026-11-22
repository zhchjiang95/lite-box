import { Stamp } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'pdf-watermark',
  name: 'PDF 加水印与页码',
  description: '为 PDF 批量添加中英文文字或图片 Logo 水印（全屏斜铺/九宫格）及底部/顶部页码，原文件矢量无损',
  category: 'pdf',
  icon: Stamp,
  keywords: ['pdf加水印', 'pdf水印', 'pdf页码', '添加页码', '保密水印', '合同水印', 'watermark', 'page-number'],
  badge: 'new',
  createdAt: '2026-11-22',
} satisfies ToolMeta
