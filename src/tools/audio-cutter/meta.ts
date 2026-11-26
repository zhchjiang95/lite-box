import { AudioWaveform } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'audio-cutter',
  name: '音频剪切与格式转换',
  description:
    '100% 本地可视化波形图选区裁剪（保留选区或剪除中间片段），支持毫秒级缩放、淡入淡出、音量增益与响度归一化、视频音轨提取及导出 WAV / MP3',
  category: 'media',
  icon: AudioWaveform,
  keywords: [
    'audio',
    'cutter',
    'trim',
    'wav',
    'mp3',
    'waveform',
    'fade',
    'ringtone',
    '音频',
    '音频剪切',
    '音频裁剪',
    '剪辑',
    '铃声制作',
    '淡入淡出',
    '波形图',
    '格式转换',
    '转MP3',
    '转WAV',
    '提取音频',
  ],
  badge: 'new',
  createdAt: '2026-11-26',
} satisfies ToolMeta
