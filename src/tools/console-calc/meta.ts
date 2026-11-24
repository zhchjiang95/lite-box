import { Terminal } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'console-calc',
  name: '控制台计算器',
  description: '像浏览器控制台一样连续输入即时预览结果，支持历史记录、变量引用、中文单位、多进制与多行草稿纸算账',
  category: 'life',
  icon: Terminal,
  keywords: [
    'calculator',
    'calc',
    'console',
    'repl',
    'math',
    '计算器',
    '控制台计算器',
    '科学计算器',
    '表达式',
    '算账',
    '草稿纸',
    '加减乘除',
    '进制计算',
  ],
  badge: 'new',
  createdAt: '2026-11-24',
} satisfies ToolMeta
