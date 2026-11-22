import { Crop } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'image-crop',
  name: '图片裁剪缩放',
  description: '自由或预设比例（含证件照尺寸）精准裁剪、旋转翻转与圆形头像导出，支持多图批量缩放',
  category: 'image',
  icon: Crop,
  keywords: ['裁剪', '缩放', 'resize', 'crop', '旋转', '翻转', '证件照', '一寸', '二寸', '头像', '改尺寸', '尺寸调整'],
  badge: 'new',
  createdAt: '2026-11-22',
} satisfies ToolMeta
