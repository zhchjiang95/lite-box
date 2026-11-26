import { Clapperboard } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'video-frames',
  name: '视频逐帧截图提取',
  description:
    '100% 本地精确到帧预览视频，支持键盘逐帧步进、一键高清截图与复制剪贴板、按张数/间隔/帧率批量抽帧打包 ZIP 及生成电影分镜拼图板',
  category: 'media',
  icon: Clapperboard,
  keywords: [
    'video',
    'frames',
    'screenshot',
    'snapshot',
    'capture',
    'contact-sheet',
    '视频',
    '逐帧',
    '视频截图',
    '抽帧',
    '提取帧',
    '封面提取',
    '高清截图',
    '分镜图',
    '缩略图拼图',
  ],
  badge: 'new',
  createdAt: '2026-11-26',
} satisfies ToolMeta
