import { FileCode2 } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'markdown-preview',
  name: 'Markdown 实时预览与导出',
  description: '支持 GFM 表格与任务列表、代码语法高亮、KaTeX 数学公式、4 套精美排版主题与同步滚动，一键导出独立 HTML、2× 高清长图或打印 PDF',
  category: 'text',
  icon: FileCode2,
  keywords: [
    'markdown',
    'md预览',
    'markdown预览',
    'md转html',
    'md转长图',
    'md转图片',
    '代码高亮',
    '数学公式',
    'katex',
    'latex',
    '公众号排版',
    'gfm',
  ],
  badge: 'new',
  createdAt: '2026-11-23',
} satisfies ToolMeta
