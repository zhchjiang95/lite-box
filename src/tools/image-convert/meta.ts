import { RefreshCw } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'image-convert',
  name: '图片格式转换',
  description: 'PNG、JPG、WebP、AVIF、BMP、多尺寸 ICO 批量互转，支持苹果 HEIC / HEIF 与 SVG 直转',
  category: 'image',
  icon: RefreshCw,
  keywords: ['格式转换', '转格式', 'heic', 'heif', 'webp', 'avif', 'png', 'jpg', 'jpeg', 'bmp', 'ico', 'favicon', 'svg', 'convert'],
  badge: 'new',
  createdAt: '2026-11-22',
} satisfies ToolMeta
