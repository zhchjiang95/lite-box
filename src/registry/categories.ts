import {
  Image,
  FileText,
  FileType,
  Wifi,
  Type,
  KeyRound,
  Code2,
  Sparkles,
  Clapperboard,
  CalendarDays,
  Coffee,
} from 'lucide-react'
import type { Category, CategoryId } from './types'

/** 分类列表（顺序即展示顺序） */
export const categories: Category[] = [
  { id: 'image', name: '图片处理', description: '拼接、压缩、转换、编辑', icon: Image, gradient: ['#8b5cf6', '#ec4899'] },
  { id: 'pdf', name: 'PDF 工具', description: '合并、拆分、互转、证件排版', icon: FileText, gradient: ['#ef4444', '#f97316'] },
  { id: 'word', name: 'Word 工具', description: '格式转换、压缩、提取、比对', icon: FileType, gradient: ['#2563eb', '#0284c7'] },
  { id: 'lan', name: '局域网互联', description: '隔空快传、跨端剪贴板、投屏', icon: Wifi, gradient: ['#06b6d4', '#6366f1'] },
  { id: 'text', name: '文本处理', description: '统计、对比、格式转换', icon: Type, gradient: ['#0ea5e9', '#6366f1'] },
  { id: 'encode', name: '编码加密', description: 'Base64、哈希、URL、JWT', icon: KeyRound, gradient: ['#10b981', '#14b8a6'] },
  { id: 'dev', name: '开发工具', description: 'JSON、正则、时间戳、颜色', icon: Code2, gradient: ['#6366f1', '#06b6d4'] },
  { id: 'generate', name: '生成器', description: '二维码、密码、UUID、占位图', icon: Sparkles, gradient: ['#f59e0b', '#ef4444'] },
  { id: 'media', name: '音视频', description: '格式转换、剪辑、提取', icon: Clapperboard, gradient: ['#d946ef', '#8b5cf6'] },
  { id: 'calendar', name: '日历历法', description: '万年历、节气、节假日、星座', icon: CalendarDays, gradient: ['#f43f5e', '#f59e0b'] },
  { id: 'life', name: '生活实用', description: '计算器、换算、随机决策', icon: Coffee, gradient: ['#84cc16', '#10b981'] },
]

export const categoryMap = Object.fromEntries(categories.map((c) => [c.id, c])) as Record<
  CategoryId,
  Category
>

