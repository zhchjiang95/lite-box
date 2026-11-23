import { ClipboardCopy } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'lan-clipboard',
  name: '局域网共享剪贴板',
  description: '手机、Mac、Windows 打开同一网页实时同步文字、链接、代码片段与截图，支持一键读取系统剪贴板、置顶、6 位配对码与离开即焚',
  category: 'lan',
  icon: ClipboardCopy,
  keywords: [
    '共享剪贴板',
    '共享剪切板',
    '局域网剪贴板',
    '跨设备剪贴板',
    '手机传文字',
    '同步文字',
    '粘贴板',
    '剪贴板同步',
    'clipboard',
    'paste',
    'lan',
  ],
  badge: 'new',
  createdAt: '2026-11-23',
} satisfies ToolMeta
