import {
  Stamp,
  Pipette,
  FileStack,
  FileImage,
  Hash,
  Binary,
  Braces,
  Clock,
  Regex,
  QrCode,
  KeyRound,
  GitCompare,
  LetterText,
  Palette,
  Film,
} from 'lucide-react'
import type { PlannedTool } from './types'

/** 规划中的工具（首页以“即将上线”展示，实现后从此处移除即可）。完整清单见 TODO.md */
export const plannedTools: PlannedTool[] = [
  { name: '图片加水印', category: 'image', icon: Stamp, description: '文字 / 图片水印，平铺或定位' },
  { name: '图片取色', category: 'image', icon: Pipette, description: '提取主色调与任意像素颜色' },
  { name: 'PDF 合并拆分', category: 'pdf', icon: FileStack, description: '多个 PDF 合并，按页拆分' },
  { name: '图片转 PDF', category: 'pdf', icon: FileImage, description: '多张图片一键生成 PDF' },
  { name: '字数统计', category: 'text', icon: LetterText, description: '字符、词数、行数、阅读时长' },
  { name: '文本对比', category: 'text', icon: GitCompare, description: '逐行 / 逐字高亮差异' },
  { name: 'Base64 编解码', category: 'encode', icon: Binary, description: '文本与文件 Base64 互转' },
  { name: '哈希计算', category: 'encode', icon: Hash, description: 'MD5、SHA-1、SHA-256 等' },
  { name: 'JSON 格式化', category: 'dev', icon: Braces, description: '格式化、压缩、校验、树形查看' },
  { name: '时间戳转换', category: 'dev', icon: Clock, description: 'Unix 时间戳与日期互转' },
  { name: '正则测试', category: 'dev', icon: Regex, description: '实时匹配高亮与分组' },
  { name: '颜色转换', category: 'dev', icon: Palette, description: 'HEX、RGB、HSL、OKLCH 互转' },
  { name: '二维码生成', category: 'generate', icon: QrCode, description: '自定义颜色、Logo 的二维码' },
  { name: '密码生成器', category: 'generate', icon: KeyRound, description: '高强度随机密码' },
  { name: '视频转 GIF', category: 'media', icon: Film, description: '截取片段生成 GIF 动图' },
]

