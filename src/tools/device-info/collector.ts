/**
 * 全维度设备与系统信息本地采集引擎
 * - 100% 在浏览器本地通过标准 Web API 采集，不自动上传任何数据
 * - 优先使用 User-Agent Client Hints (userAgentData) 获取高精度 OS/架构/位数，旧浏览器自动降级解析 UA
 * - WebGL/WebGPU 显卡渲染器探测、屏幕色域/HDR/实时刷新率估算、电池、存储配额、音视频编解码与权限矩阵
 */

export interface InfoRow {
  key: string
  label: string
  value: string
  detail?: string
  mono?: boolean
}

export interface GpuInfo {
  supported: boolean
  webgl2: boolean
  webgpu: boolean
  vendor: string
  renderer: string
  shadingLanguage: string
  maxTextureSize: number | null
  maxRenderBufferSize: number | null
  maxCombinedTextureUnits: number | null
  maxViewportDims: string
  extensionCount: number
}

export interface BatterySnapshot {
  supported: boolean
  charging: boolean
  level: number
  chargingTime: number
  dischargingTime: number
}

export interface StorageSnapshot {
  supported: boolean
  quota: number | null
  usage: number | null
  persisted: boolean | null
  localStorageOk: boolean
  sessionStorageOk: boolean
  indexedDbOk: boolean
  cacheApiOk: boolean
  opfsOk: boolean
}

export interface NetworkSnapshot {
  online: boolean
  effectiveType: string
  type: string
  downlinkMbps: number | null
  rttMs: number | null
  saveData: boolean
}

export interface MediaSnapshot {
  audioSampleRate: number | null
  audioMaxChannels: number | null
  cameraCount: number | null
  micCount: number | null
  speakerCount: number | null
  speechVoices: number
  codecs: { label: string; supported: boolean; category: 'video' | 'audio' }[]
}

export interface FeatureItem {
  name: string
  supported: boolean
  desc: string
}

export interface PermissionItem {
  name: string
  label: string
  state: 'granted' | 'denied' | 'prompt' | 'unsupported'
}

export interface DeviceSnapshot {
  collectedAt: string
  summary: {
    osName: string
    osDetail: string
    browserName: string
    browserVersion: string
    architecture: string
    deviceType: string
    cpuCores: number | null
    deviceMemoryGb: number | null
    jsHeapUsedMb: number | null
    jsHeapLimitMb: number | null
  }
  systemRows: InfoRow[]
  displayRows: InfoRow[]
  gpu: GpuInfo
  battery: BatterySnapshot
  storage: StorageSnapshot
  network: NetworkSnapshot
  media: MediaSnapshot
  features: FeatureItem[]
  permissions: PermissionItem[]
  rawUserAgent: string
}

/** User-Agent Client Hints 宽松类型声明 */
interface NavigatorUAData {
  brands?: Array<{ brand: string; version: string }>
  mobile?: boolean
  platform?: string
  getHighEntropyValues?: (hints: string[]) => Promise<{
    architecture?: string
    bitness?: string
    model?: string
    platform?: string
    platformVersion?: string
    fullVersionList?: Array<{ brand: string; version: string }>
  }>
}

interface NetworkInformationLike {
  effectiveType?: string
  type?: string
  downlink?: number
  rtt?: number
  saveData?: boolean
  addEventListener?: (type: string, listener: () => void) => void
  removeEventListener?: (type: string, listener: () => void) => void
}

interface BatteryManagerLike {
  charging: boolean
  level: number
  chargingTime: number
  dischargingTime: number
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

interface PerformanceMemoryLike {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}

/** 格式化字节数 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '不可用'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let val = bytes / 1024
  let idx = 0
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024
    idx++
  }
  return `${val.toFixed(val >= 100 ? 1 : 2)} ${units[idx]}`
}

/** 格式化续航/充电秒数 */
export function formatDurationSec(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '计算中'
  const totalMin = Math.round(sec / 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m} 分钟`
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分钟`
}

/** 解析 User-Agent 兜底信息 */
function parseFallbackUA(ua: string) {
  let osName = '未知系统'
  let osVersion = ''
  if (/Windows NT 10\.0/i.test(ua)) {
    osName = 'Windows'
    osVersion = '10 / 11'
  } else if (/Windows NT 6\.3/i.test(ua)) {
    osName = 'Windows'
    osVersion = '8.1'
  } else if (/Mac OS X ([\d_]+)/i.test(ua)) {
    osName = 'macOS'
    osVersion = (ua.match(/Mac OS X ([\d_]+)/i)?.[1] ?? '').replace(/_/g, '.')
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    osName = /iPad/i.test(ua) ? 'iPadOS' : 'iOS'
    osVersion = (ua.match(/OS ([\d_]+)/i)?.[1] ?? '').replace(/_/g, '.')
  } else if (/Android ([\d.]+)/i.test(ua)) {
    osName = 'Android'
    osVersion = ua.match(/Android ([\d.]+)/i)?.[1] ?? ''
  } else if (/CrOS/i.test(ua)) {
    osName = 'ChromeOS'
  } else if (/Linux/i.test(ua)) {
    osName = 'Linux'
  }

  let browserName = '未知浏览器'
  let browserVersion = ''
  const browserMatchers: [string, RegExp][] = [
    ['Edge', /Edg(?:A|iOS)?\/([\d.]+)/],
    ['Opera', /OPR\/([\d.]+)/],
    ['Arc / Chrome', /Chrome\/([\d.]+)/],
    ['Firefox', /Firefox\/([\d.]+)/],
    ['Safari', /Version\/([\d.]+).*Safari/],
  ]
  for (const [name, re] of browserMatchers) {
    const m = ua.match(re)
    if (m) {
      browserName = name === 'Arc / Chrome' ? 'Chrome' : name
      browserVersion = m[1]
      break
    }
  }

  let engine = '未知内核'
  if (/AppleWebKit/i.test(ua)) {
    engine = /Chrome|Edg|OPR/i.test(ua) ? 'Blink (Chromium)' : 'WebKit'
  } else if (/Gecko\//i.test(ua)) {
    engine = 'Gecko'
  }

  let arch = '未知'
  if (/arm64|aarch64/i.test(ua)) arch = 'ARM64'
  else if (/x86_64|Win64|WOW64|x64/i.test(ua)) arch = 'x86_64 (64位)'
  else if (/i686|i386/i.test(ua)) arch = 'x86 (32位)'

  const isMobile = /Mobi|Android|iPhone/i.test(ua)
  const isTablet = /iPad|Tablet/i.test(ua) || (osName === 'macOS' && navigator.maxTouchPoints > 1)
  const deviceType = isTablet ? '平板设备' : isMobile ? '移动手机' : '桌面电脑'

  return { osName, osVersion, browserName, browserVersion, engine, arch, deviceType }
}

/** 采集 WebGL / WebGPU 显卡信息 */
export function collectGpuInfo(): GpuInfo {
  const canvas = document.createElement('canvas')
  const gl2 = canvas.getContext('webgl2')
  const gl = gl2 || canvas.getContext('webgl') || (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null)
  const webgpu = 'gpu' in navigator

  if (!gl) {
    return {
      supported: false,
      webgl2: false,
      webgpu,
      vendor: '不支持 WebGL',
      renderer: '无法检测',
      shadingLanguage: '—',
      maxTextureSize: null,
      maxRenderBufferSize: null,
      maxCombinedTextureUnits: null,
      maxViewportDims: '—',
      extensionCount: 0,
    }
  }

  try {
    const debugExt = gl.getExtension('WEBGL_debug_renderer_info')
    const vendor = debugExt
      ? String(gl.getParameter(debugExt.UNMASKED_VENDOR_WEBGL) || gl.getParameter(gl.VENDOR))
      : String(gl.getParameter(gl.VENDOR) || '未知厂商')
    const renderer = debugExt
      ? String(gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL) || gl.getParameter(gl.RENDERER))
      : String(gl.getParameter(gl.RENDERER) || '受隐私保护限制')
    const shadingLanguage = String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION) || '—')
    const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || null
    const maxRenderBufferSize = Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || null
    const maxCombinedTextureUnits = Number(gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS)) || null
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | number[] | null
    const maxViewportDims = vp && vp.length >= 2 ? `${vp[0]} × ${vp[1]}` : '—'
    const extensionCount = gl.getSupportedExtensions()?.length ?? 0

    // 主动释放临时 WebGL 上下文避免触发浏览器上下文数量上限警告
    gl.getExtension('WEBGL_lose_context')?.loseContext()

    return {
      supported: true,
      webgl2: Boolean(gl2),
      webgpu,
      vendor,
      renderer,
      shadingLanguage,
      maxTextureSize,
      maxRenderBufferSize,
      maxCombinedTextureUnits,
      maxViewportDims,
      extensionCount,
    }
  } catch {
    return {
      supported: true,
      webgl2: Boolean(gl2),
      webgpu,
      vendor: '未知厂商',
      renderer: '读取受限',
      shadingLanguage: '—',
      maxTextureSize: null,
      maxRenderBufferSize: null,
      maxCombinedTextureUnits: null,
      maxViewportDims: '—',
      extensionCount: 0,
    }
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

/** 采集实时网络状态（Navigator.connection） */
export function readNetworkSnapshot(): NetworkSnapshot {
  const conn = (navigator as unknown as { connection?: NetworkInformationLike }).connection
  return {
    online: navigator.onLine,
    effectiveType: conn?.effectiveType ? conn.effectiveType.toUpperCase() : '未知',
    type: conn?.type ? conn.type : '浏览器未公开接口类型',
    downlinkMbps: typeof conn?.downlink === 'number' ? conn.downlink : null,
    rttMs: typeof conn?.rtt === 'number' ? conn.rtt : null,
    saveData: Boolean(conn?.saveData),
  }
}

/** 采集显示器与视觉偏好信息（窗口缩放时可重新调用实时刷新） */
export function collectDisplayRows(measuredHz: number | null): InfoRow[] {
  const dpr = window.devicePixelRatio || 1
  const physW = Math.round(window.screen.width * dpr)
  const physH = Math.round(window.screen.height * dpr)

  const gamut = window.matchMedia('(color-gamut: rec2020)').matches
    ? 'Rec.2020（超广色域）'
    : window.matchMedia('(color-gamut: p3)').matches
      ? 'Display-P3（广色域）'
      : window.matchMedia('(color-gamut: srgb)').matches
        ? 'sRGB（标准色域）'
        : '未知'

  const hdr = window.matchMedia('(dynamic-range: high)').matches ? '支持 HDR 高动态范围' : '标准动态范围 (SDR)'
  const colorScheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? '深色模式 (Dark)' : '浅色模式 (Light)'
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? '已开启减弱动态' : '正常动效'
  const contrast = window.matchMedia('(prefers-contrast: more)').matches
    ? '高对比度'
    : window.matchMedia('(prefers-contrast: less)').matches
      ? '低对比度'
      : '默认对比度'
  const pointer = window.matchMedia('(pointer: fine)').matches
    ? '精准指针（鼠标 / 触控板）'
    : window.matchMedia('(pointer: coarse)').matches
      ? '触控指针（手指触屏）'
      : '无主指针'
  const orientation = window.screen.orientation
    ? `${window.screen.orientation.type.includes('landscape') ? '横屏' : '竖屏'} (${window.screen.orientation.angle}°)`
    : window.innerWidth >= window.innerHeight
      ? '横屏'
      : '竖屏'

  return [
    {
      key: 'screen_logical',
      label: '屏幕逻辑分辨率',
      value: `${window.screen.width} × ${window.screen.height} px`,
      mono: true,
    },
    {
      key: 'screen_physical',
      label: '估算物理像素',
      value: `${physW} × ${physH} px`,
      detail: `DPR ${dpr.toFixed(2).replace(/\.00$/, '')}×`,
      mono: true,
    },
    {
      key: 'screen_avail',
      label: '可用工作区尺寸',
      value: `${window.screen.availWidth} × ${window.screen.availHeight} px`,
      mono: true,
    },
    {
      key: 'viewport',
      label: '当前浏览器视口',
      value: `${window.innerWidth} × ${window.innerHeight} px`,
      detail: '随窗口实时变化',
      mono: true,
    },
    {
      key: 'refresh_rate',
      label: '实测屏幕刷新率',
      value: measuredHz ? `${measuredHz} Hz` : '测算中…',
      detail: measuredHz && measuredHz >= 100 ? '高刷新率屏幕' : undefined,
      mono: true,
    },
    { key: 'color_depth', label: '色彩深度', value: `${window.screen.colorDepth} bit`, mono: true },
    { key: 'color_gamut', label: '屏幕色域', value: gamut },
    { key: 'hdr', label: '动态范围 (HDR)', value: hdr },
    { key: 'orientation', label: '屏幕方向', value: orientation },
    {
      key: 'touch',
      label: '触控与指针',
      value: `${pointer} · ${navigator.maxTouchPoints > 0 ? `支持 ${navigator.maxTouchPoints} 点触控` : '非触控屏'}`,
    },
    { key: 'prefs', label: '系统视觉偏好', value: `${colorScheme} / ${contrast} / ${reducedMotion}` },
  ]
}

/** 采集音视频编解码与媒体外设数量（不触发摄像头/麦克风权限弹窗） */
async function collectMediaSnapshot(): Promise<MediaSnapshot> {
  const videoEl = document.createElement('video')
  const audioEl = document.createElement('audio')

  const testVideo = (mime: string) => {
    const r = videoEl.canPlayType(mime)
    return r === 'probably' || r === 'maybe'
  }
  const testAudio = (mime: string) => {
    const r = audioEl.canPlayType(mime)
    return r === 'probably' || r === 'maybe'
  }

  const codecs: MediaSnapshot['codecs'] = [
    { label: 'H.264 (AVC)', supported: testVideo('video/mp4; codecs="avc1.42E01E"'), category: 'video' },
    { label: 'H.265 (HEVC)', supported: testVideo('video/mp4; codecs="hvc1.1.6.L93.B0"'), category: 'video' },
    { label: 'VP9', supported: testVideo('video/webm; codecs="vp9"'), category: 'video' },
    { label: 'AV1', supported: testVideo('video/mp4; codecs="av01.0.08M.08"'), category: 'video' },
    { label: 'AAC', supported: testAudio('audio/mp4; codecs="mp4a.40.2"'), category: 'audio' },
    { label: 'Opus', supported: testAudio('audio/webm; codecs="opus"'), category: 'audio' },
    { label: 'FLAC', supported: testAudio('audio/flac'), category: 'audio' },
    { label: 'MP3', supported: testAudio('audio/mpeg'), category: 'audio' },
  ]

  let audioSampleRate: number | null = null
  let audioMaxChannels: number | null = null
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (AudioCtx) {
      const ctx = new AudioCtx()
      audioSampleRate = ctx.sampleRate
      audioMaxChannels = ctx.destination.maxChannelCount
      await ctx.close().catch(() => {})
    }
  } catch {
    // 忽略音频上下文初始化失败
  }

  let cameraCount: number | null = null
  let micCount: number | null = null
  let speakerCount: number | null = null
  try {
    if (navigator.mediaDevices?.enumerateDevices) {
      const list = await navigator.mediaDevices.enumerateDevices()
      cameraCount = list.filter((d) => d.kind === 'videoinput').length
      micCount = list.filter((d) => d.kind === 'audioinput').length
      speakerCount = list.filter((d) => d.kind === 'audiooutput').length
    }
  } catch {
    // 无媒体设备枚举能力时留空
  }

  const speechVoices = typeof window.speechSynthesis !== 'undefined' ? window.speechSynthesis.getVoices().length : 0

  return {
    audioSampleRate,
    audioMaxChannels,
    cameraCount,
    micCount,
    speakerCount,
    speechVoices,
    codecs,
  }
}

/** 采集本地存储配额与可用存储引擎 */
async function collectStorageSnapshot(): Promise<StorageSnapshot> {
  let quota: number | null = null
  let usage: number | null = null
  let persisted: boolean | null = null
  let supported = false

  try {
    if (navigator.storage?.estimate) {
      supported = true
      const est = await navigator.storage.estimate()
      quota = typeof est.quota === 'number' ? est.quota : null
      usage = typeof est.usage === 'number' ? est.usage : null
    }
    if (navigator.storage?.persisted) {
      persisted = await navigator.storage.persisted()
    }
  } catch {
    // 隐私无痕模式下可能受限
  }

  const checkStorage = (fn: () => Storage) => {
    try {
      const s = fn()
      const k = '__litebox_probe__'
      s.setItem(k, '1')
      s.removeItem(k)
      return true
    } catch {
      return false
    }
  }

  return {
    supported,
    quota,
    usage,
    persisted,
    localStorageOk: checkStorage(() => window.localStorage),
    sessionStorageOk: checkStorage(() => window.sessionStorage),
    indexedDbOk: 'indexedDB' in window,
    cacheApiOk: 'caches' in window,
    opfsOk: Boolean(navigator.storage && 'getDirectory' in navigator.storage),
  }
}

/** 采集现代浏览器能力支持矩阵 */
function collectFeatures(): FeatureItem[] {
  const win = window as unknown as Record<string, unknown>
  const nav = navigator as unknown as Record<string, unknown>
  return [
    { name: 'WebAssembly', supported: typeof WebAssembly === 'object', desc: '高性能原生字节码模块' },
    { name: 'WebRTC', supported: 'RTCPeerConnection' in window, desc: '点对点音视频与局域网直传' },
    { name: 'WebGPU', supported: 'gpu' in navigator, desc: '下一代 GPU 图形与 AI 计算' },
    { name: 'WebGL 2', supported: Boolean(document.createElement('canvas').getContext('webgl2')), desc: '3D 硬件加速渲染' },
    { name: 'Service Worker', supported: 'serviceWorker' in navigator, desc: 'PWA 离线缓存能力' },
    { name: 'OffscreenCanvas', supported: 'OffscreenCanvas' in window, desc: 'Worker 后台离屏渲染' },
    { name: 'SharedArrayBuffer', supported: 'SharedArrayBuffer' in window, desc: '多线程共享内存' },
    { name: 'Web Crypto', supported: Boolean(window.crypto?.subtle), desc: '硬件级加密与哈希' },
    { name: 'Clipboard API', supported: Boolean(navigator.clipboard), desc: '异步剪贴板读写' },
    { name: 'BarcodeDetector', supported: 'BarcodeDetector' in window, desc: '原生条码/二维码识别' },
    { name: 'View Transitions', supported: 'startViewTransition' in document, desc: '原生页面平滑转场' },
    { name: 'Screen Wake Lock', supported: 'wakeLock' in navigator, desc: '屏幕常亮控制' },
    { name: 'Web Bluetooth', supported: 'bluetooth' in nav, desc: '蓝牙设备直连' },
    { name: 'WebUSB', supported: 'usb' in nav, desc: 'USB 硬件通信' },
    { name: 'Gamepad API', supported: 'getGamepads' in navigator, desc: '游戏手柄接入' },
    { name: 'File System Access', supported: 'showOpenFilePicker' in win, desc: '原生本地文件读写' },
    { name: 'Web Share', supported: 'share' in navigator, desc: '系统级分享面板' },
    { name: 'Notifications', supported: 'Notification' in window, desc: '系统桌面通知' },
  ]
}

/** 静默查询当前站点隐私权限状态（绝不主动弹窗申请） */
async function collectPermissions(): Promise<PermissionItem[]> {
  const targets: { name: string; label: string }[] = [
    { name: 'camera', label: '摄像头' },
    { name: 'microphone', label: '麦克风' },
    { name: 'notifications', label: '桌面通知' },
    { name: 'geolocation', label: '地理位置' },
    { name: 'clipboard-read', label: '剪贴板读取' },
    { name: 'clipboard-write', label: '剪贴板写入' },
  ]

  if (!navigator.permissions?.query) {
    return targets.map((t) => ({ ...t, state: 'unsupported' }))
  }

  return Promise.all(
    targets.map(async (t) => {
      try {
        const res = await navigator.permissions.query({ name: t.name as PermissionName })
        return { ...t, state: res.state }
      } catch {
        return { ...t, state: 'unsupported' as const }
      }
    }),
  )
}

/** 订阅电池状态（支持时返回取消订阅函数） */
export async function watchBattery(onChange: (snap: BatterySnapshot) => void): Promise<() => void> {
  const getBattery = (navigator as unknown as { getBattery?: () => Promise<BatteryManagerLike> }).getBattery
  if (!getBattery) {
    onChange({ supported: false, charging: false, level: 0, chargingTime: 0, dischargingTime: 0 })
    return () => {}
  }
  try {
    const bat = await getBattery.call(navigator)
    const emit = () => {
      onChange({
        supported: true,
        charging: bat.charging,
        level: Math.round(bat.level * 100),
        chargingTime: bat.chargingTime,
        dischargingTime: bat.dischargingTime,
      })
    }
    emit()
    const events = ['chargingchange', 'levelchange', 'chargingtimechange', 'dischargingtimechange']
    events.forEach((ev) => bat.addEventListener(ev, emit))
    return () => events.forEach((ev) => bat.removeEventListener(ev, emit))
  } catch {
    onChange({ supported: false, charging: false, level: 0, chargingTime: 0, dischargingTime: 0 })
    return () => {}
  }
}

/** 使用 requestAnimationFrame 采样估算当前屏幕真实刷新率（约 0.9 秒，自动归整常见档位） */
export function measureRefreshRate(onMeasured: (hz: number) => void): () => void {
  let rafId = 0
  let cancelled = false
  const timestamps: number[] = []

  const tick = (now: number) => {
    if (cancelled) return
    timestamps.push(now)
    if (timestamps.length >= 48 || (timestamps.length >= 16 && now - timestamps[0] >= 850)) {
      const elapsed = timestamps[timestamps.length - 1] - timestamps[0]
      if (elapsed > 100) {
        const rawHz = ((timestamps.length - 1) * 1000) / elapsed
        // 若非常接近标准刷新率档位（误差 ±3Hz 内），展示整洁标称值
        const common = [30, 48, 60, 75, 90, 100, 120, 144, 165, 240, 360]
        const snapped = common.find((c) => Math.abs(c - rawHz) <= 3.5) ?? Math.round(rawHz)
        onMeasured(snapped)
      }
      return
    }
    rafId = requestAnimationFrame(tick)
  }

  rafId = requestAnimationFrame(tick)
  return () => {
    cancelled = true
    cancelAnimationFrame(rafId)
  }
}

/** 一次性采集完整设备与系统信息快照 */
export async function collectDeviceSnapshot(measuredHz: number | null = null): Promise<DeviceSnapshot> {
  const ua = navigator.userAgent
  const fallback = parseFallbackUA(ua)

  let osName = fallback.osName
  let osDetail = fallback.osVersion
  let browserName = fallback.browserName
  let browserVersion = fallback.browserVersion
  let architecture = fallback.arch
  let deviceModel = ''
  let deviceType = fallback.deviceType

  // 尝试 User-Agent Client Hints 高熵 API（Chrome/Edge 可区分 Windows 11、ARM64 与 macOS 精确版本）
  const uaData = (navigator as unknown as { userAgentData?: NavigatorUAData }).userAgentData
  if (uaData?.getHighEntropyValues) {
    try {
      const high = await uaData.getHighEntropyValues([
        'architecture',
        'bitness',
        'model',
        'platform',
        'platformVersion',
        'fullVersionList',
      ])
      if (high.platform) {
        osName = high.platform
        if (high.platform === 'Windows' && high.platformVersion) {
          const major = Number(high.platformVersion.split('.')[0])
          osDetail = major >= 13 ? `11 (${high.platformVersion})` : `10 (${high.platformVersion})`
        } else if (high.platformVersion) {
          osDetail = high.platformVersion
        }
      }
      if (high.architecture) {
        const archLabel = high.architecture.toUpperCase() === 'ARM' ? 'ARM' : high.architecture
        architecture = high.bitness ? `${archLabel} (${high.bitness}位)` : archLabel
      }
      if (high.model) deviceModel = high.model
      if (typeof uaData.mobile === 'boolean') {
        deviceType = uaData.mobile ? '移动设备' : fallback.deviceType
      }
      const realBrand = high.fullVersionList?.find((b) => !/Not|Brand|Chromium/i.test(b.brand))
      if (realBrand) {
        browserName = realBrand.brand
        browserVersion = realBrand.version
      }
    } catch {
      // 降级使用 fallback
    }
  }

  const cpuCores = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null
  const deviceMemoryGb =
    typeof (navigator as unknown as { deviceMemory?: number }).deviceMemory === 'number'
      ? (navigator as unknown as { deviceMemory: number }).deviceMemory
      : null
  const perfMem = (performance as unknown as { memory?: PerformanceMemoryLike }).memory
  const jsHeapUsedMb = perfMem ? Math.round((perfMem.usedJSHeapSize / 1024 / 1024) * 10) / 10 : null
  const jsHeapLimitMb = perfMem ? Math.round(perfMem.jsHeapSizeLimit / 1024 / 1024) : null

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '未知'
  const offsetMin = -new Date().getTimezoneOffset()
  const offsetSign = offsetMin >= 0 ? '+' : '-'
  const offsetH = String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, '0')
  const offsetM = String(Math.abs(offsetMin) % 60).padStart(2, '0')
  const isPwa =
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as unknown as { standalone?: boolean }).standalone)

  const systemRows: InfoRow[] = [
    { key: 'os', label: '操作系统', value: osDetail ? `${osName} ${osDetail}` : osName },
    { key: 'arch', label: '处理器架构', value: architecture, mono: true },
    { key: 'device_type', label: '设备形态', value: deviceModel ? `${deviceType} (${deviceModel})` : deviceType },
    {
      key: 'browser',
      label: '浏览器与内核',
      value: `${browserName} ${browserVersion}`.trim() + ` · ${fallback.engine}`,
    },
    {
      key: 'cpu',
      label: 'CPU 逻辑核心',
      value: cpuCores ? `${cpuCores} 核` : '浏览器未开放',
      mono: true,
    },
    {
      key: 'ram',
      label: '设备内存（近似）',
      value: deviceMemoryGb ? `${deviceMemoryGb >= 8 ? '≥ ' : ''}${deviceMemoryGb} GB` : '浏览器未开放（如 Safari）',
      detail: '出于防指纹保护，浏览器上限通常封顶显示 8 GB',
      mono: true,
    },
    ...(jsHeapUsedMb !== null && jsHeapLimitMb !== null
      ? [
          {
            key: 'js_heap',
            label: '当前标签 JS 堆内存',
            value: `${jsHeapUsedMb} MB / ${jsHeapLimitMb} MB`,
            mono: true,
          },
        ]
      : []),
    {
      key: 'lang',
      label: '系统语言',
      value: `${navigator.language}${navigator.languages?.length > 1 ? `（共 ${navigator.languages.length} 项：${navigator.languages.slice(0, 4).join(', ')}）` : ''}`,
    },
    { key: 'tz', label: '时区与偏移', value: `${tz} (UTC${offsetSign}${offsetH}:${offsetM})`, mono: true },
    {
      key: 'env',
      label: '运行环境',
      value: `${isPwa ? 'PWA 独立应用' : '浏览器标签页'} · ${window.isSecureContext ? '安全上下文 (HTTPS/Localhost)' : '非安全上下文 (HTTP)'}`,
    },
    {
      key: 'cookie_dnt',
      label: 'Cookie / DNT / PDF',
      value: `Cookie ${navigator.cookieEnabled ? '已启用' : '已禁用'} · DNT ${navigator.doNotTrack === '1' ? '开启' : '未开启'} · PDF 内置查看 ${navigator.pdfViewerEnabled ? '支持' : '否'}`,
    },
  ]

  const [storage, media, permissions] = await Promise.all([
    collectStorageSnapshot(),
    collectMediaSnapshot(),
    collectPermissions(),
  ])

  return {
    collectedAt: new Date().toLocaleString('zh-CN'),
    summary: {
      osName,
      osDetail,
      browserName,
      browserVersion,
      architecture,
      deviceType,
      cpuCores,
      deviceMemoryGb,
      jsHeapUsedMb,
      jsHeapLimitMb,
    },
    systemRows,
    displayRows: collectDisplayRows(measuredHz),
    gpu: collectGpuInfo(),
    battery: { supported: false, charging: false, level: 0, chargingTime: 0, dischargingTime: 0 },
    storage,
    network: readNetworkSnapshot(),
    media,
    features: collectFeatures(),
    permissions,
    rawUserAgent: ua,
  }
}

/** 导出整洁的 Markdown 系统配置报告 */
export function buildMarkdownReport(snap: DeviceSnapshot, battery: BatterySnapshot, measuredHz: number | null): string {
  const lines: string[] = [
    `# 设备与系统体检报告`,
    `> 采集时间：${snap.collectedAt}（由轻匣 LiteBox 纯本地采集）`,
    '',
    '## 1. 系统与硬件',
    ...snap.systemRows.map((r) => `- **${r.label}**：${r.value}`),
    '',
    '## 2. 显示器与视觉',
    ...collectDisplayRows(measuredHz).map((r) => `- **${r.label}**：${r.value}${r.detail ? `（${r.detail}）` : ''}`),
    '',
    '## 3. 显卡与图形能力',
    `- **GPU 厂商**：${snap.gpu.vendor}`,
    `- **GPU 渲染器**：${snap.gpu.renderer}`,
    `- **WebGL2 / WebGPU**：${snap.gpu.webgl2 ? '支持' : '不支持'} / ${snap.gpu.webgpu ? '支持' : '不支持'}`,
    `- **最大纹理尺寸**：${snap.gpu.maxTextureSize ? `${snap.gpu.maxTextureSize} px` : '未知'}`,
    '',
    '## 4. 存储与电池',
    `- **站点存储配额**：已用 ${formatBytes(snap.storage.usage)} / 总配额 ${formatBytes(snap.storage.quota)}`,
    battery.supported
      ? `- **电池状态**：${battery.level}%（${battery.charging ? '充电中' : '未充电'}）`
      : '- **电池状态**：当前浏览器未开放 Battery API',
    '',
    '## 5. User-Agent',
    '```text',
    snap.rawUserAgent,
    '```',
  ]
  return lines.join('\n')
}
