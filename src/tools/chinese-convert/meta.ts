import { Languages } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'chinese-convert',
  name: '繁简转换与拼音标注',
  description: '基于 OpenCC 实现大陆简体、台湾正体（含用语习惯）、香港繁体精准互转，支持汉字转带声调/无声调拼音、语文注音卡片、首字母提取与多音字查询',
  category: 'text',
  icon: Languages,
  keywords: [
    '繁简转换',
    '简繁转换',
    '简体转繁体',
    '繁体转简体',
    '台湾繁体',
    '香港繁体',
    '汉字转拼音',
    '拼音标注',
    '注音',
    '首字母',
    '多音字',
    'opencc',
    'pinyin',
  ],
  badge: 'new',
  createdAt: '2026-11-23',
} satisfies ToolMeta
