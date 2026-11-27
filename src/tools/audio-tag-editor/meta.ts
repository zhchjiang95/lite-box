import { Disc3 } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'audio-tag-editor',
  name: '歌曲信息解析与标签编辑',
  description:
    '纯本地解析 MP3/FLAC/M4A/OGG/WAV 歌曲封面、内嵌歌词与音频参数，支持试听与 LRC 同步滚动、老歌 GBK 乱码修复、零重编码无损修改写回及整张专辑批量编辑',
  category: 'media',
  icon: Disc3,
  keywords: [
    'mp3',
    'flac',
    'm4a',
    'id3',
    'tag',
    'metadata',
    'lyrics',
    'lrc',
    'cover',
    '歌曲信息',
    '音乐标签',
    '专辑图',
    '专辑封面',
    '歌词',
    '音频元数据',
    '乱码修复',
  ],
  badge: 'new',
  createdAt: '2026-11-27',
} satisfies ToolMeta
