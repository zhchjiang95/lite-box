import { Stamp } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'image-watermark',
  name: '图片加水印',
  description: '支持文字与图片 Logo 水印，全屏错行斜向平铺（防盗证件水印）与九宫格精准定位，支持批量处理',
  category: 'image',
  icon: Stamp,
  keywords: ['水印', '防盗图', '证件水印', '身份证水印', '版权', 'logo', '平铺', 'watermark', 'stamp'],
  badge: 'new',
  createdAt: '2026-11-22',
} satisfies ToolMeta
