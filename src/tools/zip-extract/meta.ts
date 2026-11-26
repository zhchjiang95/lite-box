import { FolderArchive } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'zip-extract',
  name: 'ZIP 在线解压与预览',
  description:
    '纯本地解析 ZIP 压缩包目录树，支持 AES/ZipCrypto 密码解密、Windows GBK 中文文件名防乱码、免解压在线预览图片/代码/文档/音视频，及一键解压到本地文件夹',
  category: 'life',
  icon: FolderArchive,
  keywords: [
    'zip',
    'unzip',
    'extract',
    'archive',
    '解压',
    '解压缩',
    '压缩包',
    'zip解压',
    '在线解压',
    '密码解压',
    'gbk',
    '乱码修复',
    '预览压缩包',
  ],
  badge: 'new',
  createdAt: '2026-11-26',
} satisfies ToolMeta
