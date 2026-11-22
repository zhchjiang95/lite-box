import { Camera } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'photo-frame',
  name: '摄影作品分享框',
  description: '自动读取照片 EXIF 设备与光圈快门参数，支持上/下/左/右四向画框、艺术字体、胶片与毛玻璃风格',
  category: 'image',
  icon: Camera,
  keywords: ['摄影', '水印框', '徕卡水印', '相框', 'exif水印', '拍立得', '胶片', '参数边框', '作品分享', 'photo', 'frame', 'leica'],
  badge: 'new',
  createdAt: '2026-11-22',
} satisfies ToolMeta
