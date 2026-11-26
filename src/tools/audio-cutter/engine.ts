export type CutMode = 'keep' | 'remove'
export type AudioExportFormat = 'mp3' | 'wav'
export type SampleRatePreset = 'original' | '48000' | '44100' | '22050'
export type ChannelPreset = 'original' | 'stereo' | 'mono'

export interface WaveformPeaks {
  /** 每个像素桶的峰值绝对幅度 0..1 */
  peaks: Float32Array
  /** 每个像素桶的 RMS 均方根能量 0..1 */
  rms: Float32Array
  buckets: number
}

export interface AudioProcessOptions {
  mode: CutMode
  startSec: number
  endSec: number
  /** 淡入秒数 */
  fadeInSec: number
  /** 淡出秒数 */
  fadeOutSec: number
  /** 音量倍率 0..2（1 = 100% 原音量） */
  gain: number
  /** 是否开启峰值归一化（将峰值对齐到 -0.5 dBFS ≈ 0.944） */
  normalize: boolean
  /** 输出采样率 */
  sampleRate: SampleRatePreset
  /** 输出声道 */
  channels: ChannelPreset
}

export interface AudioExportOptions extends AudioProcessOptions {
  format: AudioExportFormat
  /** MP3 码率（kbps） */
  bitrate: 128 | 192 | 256 | 320
}

const pad2 = (n: number) => String(Math.floor(n)).padStart(2, '0')

/** 将秒数格式化为 MM:SS.dd（厘秒精度，适合音频剪辑显示） */
export function formatAudioTime(sec: number): string {
  const safe = Number.isFinite(sec) ? Math.max(0, sec) : 0
  const totalCs = Math.round(safe * 100)
  const h = Math.floor(totalCs / 360000)
  const m = Math.floor((totalCs % 360000) / 6000)
  const s = Math.floor((totalCs % 6000) / 100)
  const cs = totalCs % 100
  if (h > 0) return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad2(cs)}`
  return `${pad2(m)}:${pad2(s)}.${pad2(cs)}`
}

/** 解析用户输入的时间字符串（支持 "12.5"、"01:23.45"、"01:02:03.5"） */
export function parseAudioTime(raw: string): number | null {
  const t = raw.trim()
  if (!t) return null
  if (/^\d+(\.\d+)?$/.test(t)) {
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  const parts = t.split(':')
  if (parts.length < 2 || parts.length > 3) return null
  const nums = parts.map((p) => Number(p))
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null
  return parts.length === 2 ? nums[0] * 60 + nums[1] : nums[0] * 3600 + nums[1] * 60 + nums[2]
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let idx = 0
  while (v >= 1024 && idx < units.length - 1) {
    v /= 1024
    idx += 1
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[idx]}`
}

export function sanitizeStem(name: string): string {
  const base = name.replace(/\.[^.]+$/, '')
  return base.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'audio'
}

/** 计算裁剪后的目标有效时长（秒） */
export function computeResultDuration(
  totalDuration: number,
  startSec: number,
  endSec: number,
  mode: CutMode,
): number {
  const dur = Math.max(0, totalDuration)
  const s = Math.max(0, Math.min(dur, startSec))
  const e = Math.max(s, Math.min(dur, endSec))
  return mode === 'keep' ? Math.max(0, e - s) : Math.max(0, dur - (e - s))
}

/** 预估导出文件字节大小 */
export function estimateOutputBytes(params: {
  durationSec: number
  format: AudioExportFormat
  bitrateKbps: number
  sampleRate: number
  channels: number
}): number {
  const dur = Math.max(0, params.durationSec)
  if (params.format === 'mp3') {
    return Math.round((dur * params.bitrateKbps * 1000) / 8)
  }
  // 16-bit PCM WAV = 44 字节头 + 采样率 × 声道数 × 2 字节 × 时长
  return Math.round(44 + dur * params.sampleRate * params.channels * 2)
}

/** 使用浏览器原生 Web Audio API 解码音频或视频中的音轨 */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer()
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AudioCtx()
  try {
    return await ctx.decodeAudioData(arrayBuffer)
  } finally {
    ctx.close().catch(() => {})
  }
}

/** 提取高分辨率双层波形数据（多声道混缩峰值 + RMS 能量） */
export function extractWaveformPeaks(buffer: AudioBuffer, buckets = 1600): WaveformPeaks {
  const safeBuckets = Math.max(64, Math.min(4000, Math.floor(buckets)))
  const peaks = new Float32Array(safeBuckets)
  const rms = new Float32Array(safeBuckets)
  const chCount = buffer.numberOfChannels
  const channels: Float32Array[] = []
  for (let c = 0; c < chCount; c++) {
    channels.push(buffer.getChannelData(c))
  }

  const totalSamples = buffer.length
  const step = totalSamples / safeBuckets

  for (let b = 0; b < safeBuckets; b++) {
    const start = Math.floor(b * step)
    const end = Math.min(totalSamples, Math.max(start + 1, Math.floor((b + 1) * step)))
    // 极大音频采用等步长抽样提速，同时保持视觉精准
    const sampleStride = Math.max(1, Math.floor((end - start) / 180))
    let maxAbs = 0
    let sumSq = 0
    let count = 0

    for (let i = start; i < end; i += sampleStride) {
      let mixed = 0
      for (let c = 0; c < chCount; c++) {
        mixed += channels[c][i]
      }
      mixed /= chCount
      const a = Math.abs(mixed)
      if (a > maxAbs) maxAbs = a
      sumSq += mixed * mixed
      count += 1
    }

    peaks[b] = Math.min(1, maxAbs)
    rms[b] = count > 0 ? Math.min(1, Math.sqrt(sumSq / count)) : 0
  }

  return { peaks, rms, buckets: safeBuckets }
}

/** 解析输出采样率与声道数 */
export function resolveOutputFormatMeta(
  source: AudioBuffer,
  sampleRatePreset: SampleRatePreset,
  channelPreset: ChannelPreset,
): { sampleRate: number; channels: number } {
  const sampleRate =
    sampleRatePreset === 'original' ? source.sampleRate : Number(sampleRatePreset) || source.sampleRate
  const channels =
    channelPreset === 'mono'
      ? 1
      : channelPreset === 'stereo'
        ? 2
        : Math.min(2, Math.max(1, source.numberOfChannels))
  return { sampleRate, channels }
}

/**
 * 基于 OfflineAudioContext 执行非破坏性裁剪、拼接、淡入淡出、增益与归一化
 */
export async function renderProcessedAudio(
  source: AudioBuffer,
  options: AudioProcessOptions,
): Promise<AudioBuffer> {
  const dur = source.duration
  const start = Math.max(0, Math.min(dur, options.startSec))
  const end = Math.max(start, Math.min(dur, options.endSec))

  const outDuration = computeResultDuration(dur, start, end, options.mode)
  if (outDuration < 0.02) {
    throw new Error('裁剪后的音频时长过短（至少保留 0.02 秒）')
  }

  const { sampleRate, channels } = resolveOutputFormatMeta(
    source,
    options.sampleRate,
    options.channels,
  )
  const frameCount = Math.max(1, Math.ceil(outDuration * sampleRate))
  const offline = new OfflineAudioContext(channels, frameCount, sampleRate)

  const masterGain = offline.createGain()
  const baseGain = Math.max(0, Math.min(3, options.gain))

  // 安排整体淡入淡出包络（限制淡入+淡出不超过总时长）
  const maxFade = outDuration * 0.49
  const fadeIn = Math.min(maxFade, Math.max(0, options.fadeInSec))
  const fadeOut = Math.min(maxFade, Math.max(0, options.fadeOutSec))

  if (fadeIn > 0.005) {
    masterGain.gain.setValueAtTime(0.0001, 0)
    masterGain.gain.linearRampToValueAtTime(Math.max(0.0001, baseGain), fadeIn)
  } else {
    masterGain.gain.setValueAtTime(baseGain, 0)
  }

  if (fadeOut > 0.005) {
    const fadeOutStart = Math.max(fadeIn, outDuration - fadeOut)
    masterGain.gain.setValueAtTime(Math.max(0.0001, baseGain), fadeOutStart)
    masterGain.gain.linearRampToValueAtTime(0.0001, outDuration)
  }

  masterGain.connect(offline.destination)

  if (options.mode === 'keep') {
    const srcNode = offline.createBufferSource()
    srcNode.buffer = source
    srcNode.connect(masterGain)
    srcNode.start(0, start, outDuration)
  } else {
    // 剪除中间区间 [start, end]，保留前段 [0, start] + 后段 [end, dur]，接缝做 12ms 防爆音微渐变
    const headDur = start
    const tailDur = Math.max(0, dur - end)
    const seamFade = 0.012

    if (headDur > 0.002) {
      const headSrc = offline.createBufferSource()
      headSrc.buffer = source
      const headGain = offline.createGain()
      headGain.gain.setValueAtTime(1, 0)
      if (tailDur > 0.002 && headDur > seamFade * 2) {
        headGain.gain.setValueAtTime(1, headDur - seamFade)
        headGain.gain.linearRampToValueAtTime(0.0001, headDur)
      }
      headSrc.connect(headGain)
      headGain.connect(masterGain)
      headSrc.start(0, 0, headDur)
    }

    if (tailDur > 0.002) {
      const tailSrc = offline.createBufferSource()
      tailSrc.buffer = source
      const tailGain = offline.createGain()
      if (headDur > 0.002 && tailDur > seamFade * 2) {
        tailGain.gain.setValueAtTime(0.0001, headDur)
        tailGain.gain.linearRampToValueAtTime(1, headDur + seamFade)
      } else {
        tailGain.gain.setValueAtTime(1, headDur)
      }
      tailSrc.connect(tailGain)
      tailGain.connect(masterGain)
      tailSrc.start(headDur, end, tailDur)
    }
  }

  const rendered = await offline.startRendering()

  // 可选：峰值归一化到 -0.5 dBFS（约 0.944）并做软限幅防削波
  if (options.normalize) {
    let peak = 0
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      const data = rendered.getChannelData(c)
      for (let i = 0; i < data.length; i++) {
        const a = Math.abs(data[i])
        if (a > peak) peak = a
      }
    }
    if (peak > 1e-5) {
      const targetPeak = 0.944
      const scale = targetPeak / peak
      for (let c = 0; c < rendered.numberOfChannels; c++) {
        const data = rendered.getChannelData(c)
        for (let i = 0; i < data.length; i++) {
          data[i] = Math.max(-1, Math.min(1, data[i] * scale))
        }
      }
    }
  }

  return rendered
}

/** Float32 [-1, 1] 采样转 Int16 PCM */
export function floatToInt16Pcm(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
  }
  return out
}

/** 零依赖标准 16-bit PCM RIFF WAV 编码器（纯函数，可直接单元测试） */
export function encodeWavFromChannels(channels: Float32Array[], sampleRate: number): Blob {
  const numChannels = Math.max(1, channels.length)
  const numFrames = channels[0]?.length ?? 0
  const bytesPerSample = 2
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = numFrames * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM 块长度
  view.setUint16(20, 1, true) // PCM 线性编码
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // 16-bit
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch][i] ?? 0))
      const int16 = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
      view.setInt16(offset, int16, true)
      offset += 2
    }
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

export function encodeAudioBufferToWav(buffer: AudioBuffer): Blob {
  const channels: Float32Array[] = []
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(buffer.getChannelData(c))
  }
  return encodeWavFromChannels(channels, buffer.sampleRate)
}

/**
 * 基于 @breezystack/lamejs 分块异步编码 MP3（按需动态加载，不阻塞主线程渲染）
 */
export async function encodeChannelsToMp3(
  channels: Float32Array[],
  sampleRate: number,
  bitrateKbps: number,
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  const { Mp3Encoder } = await import('@breezystack/lamejs')
  const numChannels = Math.min(2, Math.max(1, channels.length))
  const leftPcm = floatToInt16Pcm(channels[0])
  const rightPcm = numChannels === 2 ? floatToInt16Pcm(channels[1] ?? channels[0]) : undefined

  const encoder = new Mp3Encoder(numChannels, sampleRate, bitrateKbps)
  const chunkSize = 1152
  const mp3Parts: Uint8Array[] = []
  const total = leftPcm.length

  for (let i = 0; i < total; i += chunkSize) {
    const leftSlice = leftPcm.subarray(i, i + chunkSize)
    const encoded =
      numChannels === 2 && rightPcm
        ? encoder.encodeBuffer(leftSlice, rightPcm.subarray(i, i + chunkSize))
        : encoder.encodeBuffer(leftSlice)
    if (encoded.length > 0) {
      mp3Parts.push(new Uint8Array(encoded))
    }

    // 每编码约 50 帧让出一次事件循环，保持进度条顺滑响应
    if (((i / chunkSize) | 0) % 50 === 0) {
      onProgress?.(Math.min(98, Math.round((i / Math.max(1, total)) * 98)))
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  const tail = encoder.flush()
  if (tail.length > 0) {
    mp3Parts.push(new Uint8Array(tail))
  }
  onProgress?.(100)

  return new Blob(mp3Parts as BlobPart[], { type: 'audio/mpeg' })
}

export function encodeAudioBufferToMp3(
  buffer: AudioBuffer,
  bitrateKbps: number,
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  const channels: Float32Array[] = []
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) {
    channels.push(buffer.getChannelData(c))
  }
  return encodeChannelsToMp3(channels, buffer.sampleRate, bitrateKbps, onProgress)
}
