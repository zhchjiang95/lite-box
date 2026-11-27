import { ALargeSmall } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'font-editor',
  name: '字体编辑器与子集裁剪',
  description:
    '纯本地解析 TTF / OTF / WOFF 字体全部字形，支持可视化批量删字、按文本仅保留指定字（快捷删除其余全部）、按字符区段批量清理、修改字体名称并导出精简 TTF/WOFF',
  category: 'file',
  icon: ALargeSmall,
  keywords: [
    'font',
    'ttf',
    'otf',
    'woff',
    'subset',
    'glyph',
    '字体',
    '字体编辑',
    '字体裁剪',
    '字体瘦身',
    '字体子集',
    '删字',
    '删除字',
    '保留字',
    '精简字体',
  ],
  badge: 'new',
  createdAt: '2026-11-27',
} satisfies ToolMeta
