import { Cast } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'lan-screen',
  name: '局域网无线投屏',
  description: '免装投屏 App，基于 WebRTC 将电脑屏幕或应用窗口超低延迟镜像到同局域网的另一台电脑、iPad 或电视浏览器，支持一投多、系统音频与全屏画中画',
  category: 'lan',
  icon: Cast,
  keywords: [
    '无线投屏',
    '局域网投屏',
    '屏幕共享',
    '屏幕镜像',
    '电脑投屏',
    '会议投屏',
    '教室投屏',
    '投屏到ipad',
    '投屏到电视',
    'screen-share',
    'mirror',
    'cast',
    'webrtc',
  ],
  badge: 'new',
  createdAt: '2026-11-23',
} satisfies ToolMeta
