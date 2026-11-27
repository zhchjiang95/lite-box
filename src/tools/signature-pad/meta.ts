import { PenTool } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'signature-pad',
  name: '手写签名生成',
  description:
    '支持鼠标、触控屏与手写笔的压感/笔锋电子手写签名板，内置钢笔/签字笔/毛笔三款笔触、自动紧致裁切留白、本地签名库，一键导出高清透明 PNG 与无损矢量 SVG',
  category: 'generate',
  icon: PenTool,
  keywords: [
    'signature',
    'sign',
    'handwriting',
    'autograph',
    '签名',
    '手写签名',
    '电子签名',
    '透明签名',
    '签字',
    '手写板',
    '透明png',
    'svg签名',
  ],
  badge: 'new',
  createdAt: '2026-11-27',
} satisfies ToolMeta
