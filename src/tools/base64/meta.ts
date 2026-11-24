import { Binary } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'base64',
  name: 'Base64 编解码',
  description: 'UTF-8 文本与标准/URL-Safe Base64 双向互转，支持图片与任意文件转 DataURL/HTML/CSS，及 Base64 魔数识别还原下载',
  category: 'encode',
  icon: Binary,
  keywords: [
    'base64',
    'dataurl',
    'encode',
    'decode',
    'url-safe',
    '编解码',
    '编码',
    '解码',
    '图片转base64',
    'base64转图片',
    '文件转base64',
  ],
  badge: 'new',
  createdAt: '2026-11-24',
} satisfies ToolMeta
