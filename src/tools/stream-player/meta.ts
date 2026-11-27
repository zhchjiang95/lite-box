import { Tv } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'stream-player',
  name: '视频与直播播放器',
  description:
    '支持 HLS (.m3u8)、HTTP-FLV (.flv/.ts)、MP4/WebM 及本地视频播放，内置 IPTV 频道列表导入、可选后端防盗链跨域代理、外挂字幕、截图、旋转镜像与实时码率监控',
  category: 'media',
  icon: Tv,
  keywords: [
    'video',
    'player',
    'live',
    'hls',
    'm3u8',
    'flv',
    'http-flv',
    'iptv',
    'm3u',
    'mp4',
    '视频播放器',
    '直播播放器',
    '直播源',
    '流媒体',
    '电视直播',
    '在线播放',
  ],
  badge: 'new',
  createdAt: '2026-11-27',
} satisfies ToolMeta
