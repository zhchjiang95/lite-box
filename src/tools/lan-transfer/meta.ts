import { Radio } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'lan-transfer',
  name: '隔空快传 · 局域网互传',
  description: '同局域网打开网页自动发现彼此，分配唯一代号，支持 WebRTC 点对点高速传文件、极端网络自动中转兜底、6 位配对码与文字秒传',
  category: 'lan',
  icon: Radio,
  keywords: [
    '隔空快传',
    '隔空投送',
    '局域网共享',
    '局域网传文件',
    '局域网互传',
    '文件传输',
    '手机传电脑',
    '无线传输',
    'airdrop',
    'snapdrop',
    'pairdrop',
    'lan',
    'p2p',
  ],
  badge: 'new',
  createdAt: '2026-11-23',
} satisfies ToolMeta
