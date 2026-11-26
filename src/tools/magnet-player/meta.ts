import { Magnet } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'magnet-player',
  name: '磁力在线播放',
  description:
    '配合后端服务实现磁力链接与 .torrent 种子边下边播，按需拉流省磁盘，支持 ffmpeg 兼容转封装/转码、字幕加载、外置播放器直链与访问口令保护',
  category: 'media',
  icon: Magnet,
  keywords: [
    'magnet',
    'torrent',
    'bt',
    'webtorrent',
    'stream',
    'video',
    'ffmpeg',
    'potplayer',
    'vlc',
    'iina',
    '磁力',
    '磁力链接',
    '种子',
    '在线播放',
    '边下边播',
    '流媒体',
    '电影',
    '视频播放',
  ],
  badge: 'new',
  createdAt: '2026-11-26',
} satisfies ToolMeta
