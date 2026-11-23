import { ImageDown } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'docx-extract-media',
  name: 'Word / PPT 原图无损提取',
  description: '拖入 .docx（同时兼容 .pptx / .xlsx），零画质损失一键提取文档中所有内嵌高清原图与音视频媒体，支持画廊预览、过滤小图与批量 ZIP 打包',
  category: 'word',
  icon: ImageDown,
  keywords: [
    'word提取图片',
    'docx提取图片',
    'word原图提取',
    'ppt提取图片',
    'excel提取图片',
    '提取原图',
    '文档图片提取',
    'word图片',
    'pptx',
    'xlsx',
    'media',
    'extract',
  ],
  badge: 'new',
  createdAt: '2026-11-23',
} satisfies ToolMeta
