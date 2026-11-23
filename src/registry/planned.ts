import {
  Hash,
  Binary,
  Braces,
  Clock,
  Regex,
  KeyRound,
  GitCompare,
  LetterText,
  Palette,
  Film,
  FileCode2,
  FileDown,
  Minimize2,
  MessageSquareText,
} from 'lucide-react'
import type { PlannedTool } from './types'

/** 规划中的工具（首页以“即将上线”展示，实现后从此处移除即可）。完整清单见 TODO.md */
export const plannedTools: PlannedTool[] = [
  { name: '局域网临时聊天室', category: 'lan', icon: MessageSquareText, description: '免登录同网即聊，关闭即焚不留痕' },
  { name: 'Markdown 转 Word', category: 'word', icon: FileDown, description: 'AI 生成的 Markdown 一键转规范 .docx' },
  { name: 'Word 转 Markdown', category: 'word', icon: FileCode2, description: '保留标题、表格与图片转为干净 MD' },
  { name: 'Word 文档瘦身压缩', category: 'word', icon: Minimize2, description: '无损排版，智能压缩内嵌大图减体积' },
  { name: '字数统计', category: 'text', icon: LetterText, description: '字符、词数、行数、阅读时长' },
  { name: '文本对比', category: 'text', icon: GitCompare, description: '逐行 / 逐字高亮差异' },
  { name: 'Base64 编解码', category: 'encode', icon: Binary, description: '文本与文件 Base64 互转' },
  { name: '哈希计算', category: 'encode', icon: Hash, description: 'MD5、SHA-1、SHA-256 等' },
  { name: 'JSON 格式化', category: 'dev', icon: Braces, description: '格式化、压缩、校验、树形查看' },
  { name: '时间戳转换', category: 'dev', icon: Clock, description: 'Unix 时间戳与日期互转' },
  { name: '正则测试', category: 'dev', icon: Regex, description: '实时匹配高亮与分组' },
  { name: '颜色转换', category: 'dev', icon: Palette, description: 'HEX、RGB、HSL、OKLCH 互转' },
  { name: '密码生成器', category: 'generate', icon: KeyRound, description: '高强度随机密码' },
  { name: '视频转 GIF', category: 'media', icon: Film, description: '截取片段生成 GIF 动图' },
]

