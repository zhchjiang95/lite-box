import { Palette } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'color-converter',
  name: '颜色转换与对比度检查',
  description: 'HEX、RGB、HSL、OKLCH、CMYK、HSV 实时双向互转，生成 OKLCH 11 阶色板、WCAG 无障碍对比度体检与现代 CSS 渐变',
  category: 'dev',
  icon: Palette,
  keywords: [
    'color',
    'hex',
    'rgb',
    'hsl',
    'oklch',
    'cmyk',
    'hsv',
    'wcag',
    'contrast',
    'gradient',
    '颜色转换',
    '色值转换',
    '色彩空间',
    '对比度',
    '无障碍',
    '渐变生成',
    '色阶',
    '吸管',
  ],
  badge: 'new',
  createdAt: '2026-11-24',
} satisfies ToolMeta
