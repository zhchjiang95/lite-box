import { Film } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'video-to-gif',
  name: '视频转 GIF 动图',
  description:
    '纯浏览器本地截取视频片段生成高画质调色板 GIF，支持可视化胶片时间轴、裁切比例、倍速/倒放/往返鬼畜、抗色带抖动与顶部/底部配文',
  category: 'media',
  icon: Film,
  keywords: [
    'gif',
    'video to gif',
    'mp4 to gif',
    '视频转gif',
    '动图',
    '表情包',
    'gif制作',
    'gif生成',
    '视频截取动图',
    '往返动图',
  ],
  badge: 'new',
  createdAt: '2026-11-27',
} satisfies ToolMeta
