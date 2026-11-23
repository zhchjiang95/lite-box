import { FileSearch } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'docx-viewer',
  name: 'Word 预览与隐私元数据清理',
  description: '免装 Office 本地秒开 .docx 排版预览与打印，深度体检作者、公司、编辑时长、隐藏批注与修订痕迹，一键无损脱敏重新导出',
  category: 'word',
  icon: FileSearch,
  keywords: [
    'word预览',
    'docx预览',
    'word打开',
    'word元数据',
    '文档属性',
    '清除作者',
    'word隐私清理',
    '去除批注',
    '修订痕迹',
    'docx',
    'word',
    'viewer',
    'metadata',
  ],
  badge: 'new',
  createdAt: '2026-11-23',
} satisfies ToolMeta
