import { FileSearch } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'image-exif',
  name: 'EXIF 信息查看与抹除',
  description: '查看照片相机型号、光圈快门、GPS 经纬度等完整元数据，支持 JPEG/PNG 无损剥离隐私信息',
  category: 'image',
  icon: FileSearch,
  keywords: ['exif', '元数据', '照片信息', '图片信息', 'gps', '定位', '隐私清除', '抹除', '快门', '光圈', '相机', 'metadata'],
  badge: 'new',
  createdAt: '2026-11-22',
} satisfies ToolMeta
