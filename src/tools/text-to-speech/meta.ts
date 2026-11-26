import { Volume2 } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'text-to-speech',
  name: '文字转语音与配音',
  description:
    '双引擎文字转语音：浏览器原生离线逐句跟读 + 后端 Edge 神经语音合成高拟真 MP3 与同步 SRT 字幕，支持多角色对话配音与长文自动分段',
  category: 'media',
  icon: Volume2,
  keywords: [
    'tts',
    'text-to-speech',
    'speech',
    'voice',
    'edge-tts',
    'srt',
    'mp3',
    '文字转语音',
    '语音合成',
    '配音',
    '朗读',
    '播音',
    '多角色配音',
    '对话配音',
    '晓晓',
    '云希',
    '字幕生成',
  ],
  badge: 'new',
  createdAt: '2026-11-26',
} satisfies ToolMeta
