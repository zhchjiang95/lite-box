import { FileDiff } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'docx-diff',
  name: 'Word 文档内容对比',
  description: '拖入两份 .docx（如合同修订前后版本），本地提取正文、表格与页眉页脚做逐段/逐字红绿高亮比对，支持双栏/行内切换、逐处跳转与导出 HTML 审阅报告',
  category: 'word',
  icon: FileDiff,
  keywords: [
    'word对比',
    'docx对比',
    '文档对比',
    '合同对比',
    '合同比对',
    '文字差异',
    '版本对比',
    'diff',
    'compare',
    'docx',
    'word',
  ],
  badge: 'new',
  createdAt: '2026-11-23',
} satisfies ToolMeta
