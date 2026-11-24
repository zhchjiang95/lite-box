import { Cpu } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'device-info',
  name: '设备信息与网速测试',
  description: '全面检测系统架构、CPU/内存、GPU 显卡、屏幕刷新率/色域、电池、存储与浏览器能力，内置公网/局域网实时测速仪',
  category: 'life',
  icon: Cpu,
  keywords: [
    'device',
    'system',
    'hardware',
    'speedtest',
    'ping',
    'network',
    'gpu',
    'webgl',
    'fps',
    '设备信息',
    '系统信息',
    '电脑配置',
    '显卡',
    '屏幕刷新率',
    '网速测试',
    '测速',
    '带宽',
    '延迟',
  ],
  badge: 'new',
  createdAt: '2026-11-24',
} satisfies ToolMeta
