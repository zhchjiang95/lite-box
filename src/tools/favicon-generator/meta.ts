import { AppWindow } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'favicon-generator',
  name: 'Favicon 图标生成',
  description: '上传图片或输入文字/Emoji，一键生成多尺寸 favicon.ico、Apple/PWA 图标、Manifest 与 HTML 代码',
  category: 'image',
  icon: AppWindow,
  keywords: ['favicon', 'ico', '网站图标', 'icon', 'pwa', 'apple-touch-icon', 'webmanifest', '标签页图标'],
  badge: 'new',
  createdAt: '2026-11-22',
} satisfies ToolMeta
