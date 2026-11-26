import { Stamp } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'seal-generator',
  name: '印章生成器',
  description:
    '在线制作圆形企业公章、椭圆发票财务章、方形个人私章/书画篆刻（朱文/白文）及条形审核日期章，支持真实印泥做旧、自定义字体与图片盖章',
  category: 'generate',
  icon: Stamp,
  keywords: [
    'seal',
    'stamp',
    '印章',
    '印章生成',
    '电子印章',
    '公章',
    '公司印章',
    '企业公章',
    '合同专用章',
    '财务章',
    '发票专用章',
    '个人印章',
    '私章',
    '法人章',
    '篆刻',
    '闲章',
    '盖章',
    'svg',
    'png',
  ],
  badge: 'new',
  createdAt: '2026-11-26',
} satisfies ToolMeta
