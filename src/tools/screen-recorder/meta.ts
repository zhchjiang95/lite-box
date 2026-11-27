import { Video } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'screen-recorder',
  name: '屏幕录制与摄像头拍照',
  description:
    '免安装浏览器原生录屏（支持系统音频与麦克风双轨混音、屏幕+摄像头画中画讲解、暂停继续），本地直出 MP4/WebM，并支持摄像头滤镜拍照与连拍',
  category: 'media',
  icon: Video,
  keywords: [
    'screen',
    'recorder',
    'record',
    'camera',
    'webcam',
    'photo',
    'capture',
    '录屏',
    '屏幕录制',
    '录像',
    '摄像头',
    '拍照',
    '画中画',
    'webm',
    'mp4',
  ],
  badge: 'new',
  createdAt: '2026-11-27',
} satisfies ToolMeta
