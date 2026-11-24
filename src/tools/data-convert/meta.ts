import { ArrowLeftRight } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'data-convert',
  name: 'JSON 多格式互转',
  description: 'JSON、YAML、TOML、CSV/TSV 双向互转，支持一键生成 TypeScript 接口与 Zod Schema 及可视化表格预览',
  category: 'dev',
  icon: ArrowLeftRight,
  keywords: [
    'json',
    'typescript',
    'ts',
    'interface',
    'zod',
    'yaml',
    'yml',
    'toml',
    'csv',
    'tsv',
    'excel',
    '互转',
    '数据转换',
    'json转ts',
    'json转yaml',
    'json转csv',
    '类型生成',
  ],
  badge: 'new',
  createdAt: '2026-11-24',
} satisfies ToolMeta
