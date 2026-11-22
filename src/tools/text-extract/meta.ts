import { ScanSearch } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'text-extract',
  name: '正则提取与批量替换',
  description: '从杂乱文本中一键提取邮箱、手机号、网址、IP、身份证、日期与数字，支持自定义正则、捕获组模板与多规则流水线批量替换',
  category: 'text',
  icon: ScanSearch,
  keywords: [
    '正则提取',
    '批量替换',
    '提取邮箱',
    '提取手机号',
    '提取网址',
    '提取ip',
    '提取数字',
    '提取身份证',
    '文本提取',
    '数据清洗',
    '脱敏',
    'regex',
    'extract',
    'replace',
  ],
  badge: 'new',
  createdAt: '2026-11-22',
} satisfies ToolMeta
