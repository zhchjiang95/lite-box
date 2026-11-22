import { Pipette } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'image-palette',
  name: '图片取色',
  description: '像素级放大镜与屏幕吸管精准取色，支持 HEX/RGB/HSL/OKLCH，自动提取主色调并导出色卡',
  category: 'image',
  icon: Pipette,
  keywords: ['取色', '吸管', '调色板', '配色', '主色调', '颜色', 'color', 'palette', 'eyedropper', 'hex', 'rgb', 'oklch'],
  badge: 'new',
  createdAt: '2026-11-22',
} satisfies ToolMeta
