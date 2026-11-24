import { Barcode } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'barcode',
  name: '条形码生成',
  description: '支持 CODE128、EAN-13、UPC、CODE39、ITF-14 等 12 种国际条码制式，自动算校验位、导出高清 PNG/SVG 及批量连号打包 ZIP',
  category: 'generate',
  icon: Barcode,
  keywords: [
    'barcode',
    'code128',
    'ean13',
    'ean8',
    'upc',
    'code39',
    'itf14',
    '条形码',
    '条码',
    '商品条码',
    '快递单号',
    '标签打印',
    '批量条码',
  ],
  badge: 'new',
  createdAt: '2026-11-24',
} satisfies ToolMeta
