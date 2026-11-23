/** 局域网无线投屏：类型定义与画质预设 */

import type { ConnectionState, DeviceType } from '../lan-transfer/types'

export type { ConnectionState, DeviceType }

export interface ScreenPeer {
  id: string
  name: string
  deviceType: DeviceType
  osLabel: string
  browserLabel: string
  color: string
  casting?: boolean
  castTitle?: string
}

export type QualityPresetId = '1080p30' | '1080p60' | '4k30' | '720p24'

export interface QualityPreset {
  id: QualityPresetId
  label: string
  desc: string
  width: number
  height: number
  fps: number
  maxBitrateKbps: number
  contentHint: 'detail' | 'motion'
}

export const QUALITY_PRESETS: QualityPreset[] = [
  {
    id: '1080p30',
    label: '1080p 流畅办公',
    desc: '文字锐利 · 超低延迟（推荐）',
    width: 1920,
    height: 1080,
    fps: 30,
    maxBitrateKbps: 5000,
    contentHint: 'detail',
  },
  {
    id: '1080p60',
    label: '1080p 60帧丝滑',
    desc: '适合演示视频、动画与操作',
    width: 1920,
    height: 1080,
    fps: 60,
    maxBitrateKbps: 8500,
    contentHint: 'motion',
  },
  {
    id: '4k30',
    label: '4K 超清原画',
    desc: '代码与设计稿极致清晰',
    width: 3840,
    height: 2160,
    fps: 30,
    maxBitrateKbps: 12000,
    contentHint: 'detail',
  },
  {
    id: '720p24',
    label: '720p 弱网省流',
    desc: 'Wi-Fi 信号较弱时稳定优先',
    width: 1280,
    height: 720,
    fps: 24,
    maxBitrateKbps: 2200,
    contentHint: 'detail',
  },
]

export interface ScreenInvite {
  fromId: string
  fromName: string
  fromColor: string
  castTitle: string
}

/** 实时 WebRTC 投屏链路遥测指标 */
export interface StreamMetrics {
  width: number
  height: number
  fps: number
  bitrateKbps: number
  rttMs: number | null
}
