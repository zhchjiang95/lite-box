import { IdCard } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'id-card-print',
  name: '身份证 A4 排版打印',
  description: '手动裁切或四点透视拉直证件正反面，一键 1:1 真实物理尺寸排版到 A4 纸，支持扫描增白、防盗水印、导出 PDF 与直接打印',
  category: 'pdf',
  icon: IdCard,
  keywords: [
    '身份证',
    '身份证打印',
    '身份证正反面',
    '证件复印件',
    'a4排版',
    '身份证合并',
    '证件扫描',
    '四点拉直',
    '驾驶证',
    '护照',
    'id-card',
    'print',
  ],
  badge: 'new',
  createdAt: '2026-11-22',
} satisfies ToolMeta
