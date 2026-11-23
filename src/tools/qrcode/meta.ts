import { QrCode } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'qrcode',
  name: '二维码生成与识别',
  description: '自定义配色、渐变、圆点样式与中心 Logo 生成高清 PNG/SVG，支持离线拖放、粘贴与摄像头扫码',
  category: 'generate',
  icon: QrCode,
  keywords: [
    'qrcode',
    'qr',
    '二维码',
    '生成二维码',
    '扫码',
    '识别二维码',
    '解码',
    'logo二维码',
    'wifi二维码',
    'vcard',
    'svg',
    '批量二维码',
  ],
  badge: 'new',
  createdAt: '2026-11-23',
} satisfies ToolMeta
