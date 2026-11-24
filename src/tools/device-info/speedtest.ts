/**
 * 双引擎实时网速测试引擎
 * - 模式 1：公网测速节点（Cloudflare 全球边缘 speed.cloudflare.com，免后端纯静态可用）
 * - 模式 2：当前服务器节点（/api/speedtest/*，配合 LiteBox 独立后端实现局域网/内网/自建服务千兆实测）
 * - 指标：Ping 延迟（最小/平均/最大）、网络抖动（Jitter）、流式下载速率（Mbps & MB/s）、随机载荷上传速率（Mbps & MB/s）
 */

export type SpeedTestSource = 'cloudflare' | 'self'
export type SpeedTestStage = 'idle' | 'ping' | 'download' | 'upload' | 'done' | 'error'

export interface SpeedSamplePoint {
  /** 阶段开始后经过的毫秒数 */
  elapsedMs: number
  /** 瞬时速率（Mbps） */
  mbps: number
}

export interface SpeedTestProgress {
  stage: SpeedTestStage
  /** 0 - 100 总进度 */
  progress: number
  /** 当前仪表盘展示的实时速率（Mbps） */
  liveMbps: number
  /** 延迟（ms） */
  pingMs: number | null
  pingMinMs: number | null
  pingMaxMs: number | null
  /** 抖动（ms） */
  jitterMs: number | null
  /** 下载均值（Mbps） */
  downloadMbps: number | null
  /** 上传均值（Mbps） */
  uploadMbps: number | null
  /** 实时曲线点 */
  downloadSamples: SpeedSamplePoint[]
  uploadSamples: SpeedSamplePoint[]
  /** 消耗流量统计（字节） */
  transferredBytes: number
  /** 状态提示文案 */
  statusText: string
  error?: string
}

export interface SpeedTestRecord {
  id: string
  time: string
  source: SpeedTestSource
  pingMs: number
  jitterMs: number
  downloadMbps: number
  uploadMbps: number
}

export interface PublicIpInfo {
  ip: string
  city?: string
  region?: string
  country?: string
  org?: string
  colo?: string
}

export const INITIAL_SPEED_PROGRESS: SpeedTestProgress = {
  stage: 'idle',
  progress: 0,
  liveMbps: 0,
  pingMs: null,
  pingMinMs: null,
  pingMaxMs: null,
  jitterMs: null,
  downloadMbps: null,
  uploadMbps: null,
  downloadSamples: [],
  uploadSamples: [],
  transferredBytes: 0,
  statusText: '就绪，点击「开始测速」测试延迟与上下行带宽',
}

/** 构造不可压缩随机数据块（防止代理/CDN 压缩导致上传测速虚高） */
function buildRandomPayload(bytes: number): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(bytes)
  const arr = new Uint8Array(buf)
  // crypto.getRandomValues 单次上限 65536 字节，分段填充后复用切片极快生成大块随机数据
  const seed = new Uint8Array(65536)
  crypto.getRandomValues(seed)
  for (let offset = 0; offset < bytes; offset += seed.byteLength) {
    const len = Math.min(seed.byteLength, bytes - offset)
    arr.set(len === seed.byteLength ? seed : seed.subarray(0, len), offset)
  }
  return arr
}

/** 探测当前站点是否挂载了自建 /api/speedtest/ping 接口 */
export async function probeSelfSpeedtestApi(): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1800)
  try {
    const res = await fetch(`/api/speedtest/ping?t=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) return false
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('application/json')) return false
    const data = (await res.json()) as { ok?: boolean }
    return Boolean(data.ok)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** 获取端点 URL 构造器 */
function getEndpoints(source: SpeedTestSource) {
  if (source === 'self') {
    return {
      ping: () => `/api/speedtest/ping?t=${Date.now()}-${Math.random()}`,
      down: (bytes: number) => `/api/speedtest/down?bytes=${bytes}&t=${Date.now()}-${Math.random()}`,
      up: () => `/api/speedtest/up?t=${Date.now()}-${Math.random()}`,
    }
  }
  return {
    ping: () => `https://speed.cloudflare.com/__down?bytes=0&t=${Date.now()}-${Math.random()}`,
    down: (bytes: number) => `https://speed.cloudflare.com/__down?bytes=${bytes}&t=${Date.now()}-${Math.random()}`,
    up: () => `https://speed.cloudflare.com/__up?t=${Date.now()}-${Math.random()}`,
  }
}

/**
 * 执行完整三阶段测速：Ping & Jitter → 流式下载 → 随机载荷上传
 */
export async function runSpeedTest(
  source: SpeedTestSource,
  signal: AbortSignal,
  onProgress: (next: SpeedTestProgress) => void,
): Promise<SpeedTestProgress> {
  const ep = getEndpoints(source)
  let state: SpeedTestProgress = {
    ...INITIAL_SPEED_PROGRESS,
    stage: 'ping',
    progress: 2,
    statusText: '正在连接节点并测量往返延迟 (Ping)…',
  }
  const emit = (patch: Partial<SpeedTestProgress>) => {
    state = { ...state, ...patch }
    onProgress(state)
  }
  onProgress(state)

  try {
    // ================= 1. 延迟与抖动采样（1 次预热 + 7 次正式采样） =================
    const rtts: number[] = []
    const rounds = 8
    for (let i = 0; i < rounds; i++) {
      if (signal.aborted) throw new DOMException('已取消测速', 'AbortError')
      const t0 = performance.now()
      const res = await fetch(ep.ping(), { cache: 'no-store', signal })
      if (!res.ok) throw new Error(`测速节点返回异常状态 (${res.status})`)
      await res.arrayBuffer()
      const dt = performance.now() - t0
      // 跳过第 1 次 TCP/TLS 握手冷启动，记录后续真实 RTT
      if (i > 0) rtts.push(dt)

      const avg = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : dt
      let jitter = 0
      if (rtts.length >= 2) {
        let diffSum = 0
        for (let k = 1; k < rtts.length; k++) diffSum += Math.abs(rtts[k] - rtts[k - 1])
        jitter = diffSum / (rtts.length - 1)
      }
      emit({
        progress: Math.round(((i + 1) / rounds) * 18),
        pingMs: Number(avg.toFixed(1)),
        pingMinMs: Number(Math.min(...(rtts.length ? rtts : [dt])).toFixed(1)),
        pingMaxMs: Number(Math.max(...(rtts.length ? rtts : [dt])).toFixed(1)),
        jitterMs: Number(jitter.toFixed(1)),
        statusText: `正在测延迟 (${i + 1}/${rounds})…`,
      })
    }

    // ================= 2. 阶梯流式下载测速 =================
    emit({ stage: 'download', progress: 20, liveMbps: 0, statusText: '正在测试下行下载带宽…' })

    // 阶梯包体：先 1MB 探速，再根据网速决定是否升至 5MB / 15MB / 25MB，总时长控制在 4~7 秒内
    const downSteps = source === 'self' ? [2e6, 8e6, 20e6, 32e6] : [1e6, 4e6, 10e6, 20e6]
    const downStartAll = performance.now()
    let totalDownBytes = 0
    const downSamples: SpeedSamplePoint[] = []
    let lastEmitTime = downStartAll
    let windowBytes = 0

    for (let sIdx = 0; sIdx < downSteps.length; sIdx++) {
      if (signal.aborted) throw new DOMException('已取消测速', 'AbortError')
      // 若前几轮已耗时超过 5.5 秒（慢速网络），无需再下大包，直接得出准确结果
      if (sIdx >= 2 && performance.now() - downStartAll > 5500) break

      const stepBytes = downSteps[sIdx]
      const res = await fetch(ep.down(stepBytes), { cache: 'no-store', signal })
      if (!res.ok) throw new Error(`下载测速失败 (${res.status})`)

      if (res.body) {
        const reader = res.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            totalDownBytes += value.byteLength
            windowBytes += value.byteLength
            const now = performance.now()
            const dtWin = now - lastEmitTime
            if (dtWin >= 160) {
              const instMbps = (windowBytes * 8) / (dtWin * 1000)
              const avgMbps = (totalDownBytes * 8) / (Math.max(1, now - downStartAll) * 1000)
              // 平滑瞬时速率，仪表盘跳动更自然真实
              const displayMbps = instMbps * 0.65 + avgMbps * 0.35
              downSamples.push({ elapsedMs: Math.round(now - downStartAll), mbps: Number(displayMbps.toFixed(2)) })
              const stepRatio = Math.min(1, (sIdx + 0.6) / downSteps.length)
              emit({
                progress: Math.min(60, Math.round(20 + stepRatio * 40)),
                liveMbps: Number(displayMbps.toFixed(2)),
                downloadMbps: Number(avgMbps.toFixed(2)),
                downloadSamples: [...downSamples],
                transferredBytes: state.transferredBytes + windowBytes,
              })
              windowBytes = 0
              lastEmitTime = now
            }
          }
        }
      } else {
        const buf = await res.arrayBuffer()
        totalDownBytes += buf.byteLength
        const now = performance.now()
        const avgMbps = (totalDownBytes * 8) / (Math.max(1, now - downStartAll) * 1000)
        downSamples.push({ elapsedMs: Math.round(now - downStartAll), mbps: Number(avgMbps.toFixed(2)) })
        emit({
          progress: Math.round(20 + ((sIdx + 1) / downSteps.length) * 40),
          liveMbps: Number(avgMbps.toFixed(2)),
          downloadMbps: Number(avgMbps.toFixed(2)),
          downloadSamples: [...downSamples],
          transferredBytes: totalDownBytes,
        })
      }
    }

    const downTotalSec = Math.max(0.05, (performance.now() - downStartAll) / 1000)
    const finalDownMbps = Number(((totalDownBytes * 8) / (downTotalSec * 1_000_000)).toFixed(2))
    emit({
      progress: 62,
      downloadMbps: finalDownMbps,
      liveMbps: finalDownMbps,
      transferredBytes: totalDownBytes,
    })

    // ================= 3. 随机载荷阶梯上传测速 =================
    emit({ stage: 'upload', progress: 64, liveMbps: 0, statusText: '正在测试上行上传带宽…' })

    const upSteps = source === 'self' ? [1e6, 4e6, 10e6] : [5e5, 2e6, 5e6]
    const upStartAll = performance.now()
    let totalUpBytes = 0
    const upSamples: SpeedSamplePoint[] = []

    for (let uIdx = 0; uIdx < upSteps.length; uIdx++) {
      if (signal.aborted) throw new DOMException('已取消测速', 'AbortError')
      if (uIdx >= 1 && performance.now() - upStartAll > 5500) break

      const size = upSteps[uIdx]
      const payload = buildRandomPayload(size)
      const t0 = performance.now()
      const res = await fetch(ep.up(), {
        method: 'POST',
        body: payload,
        cache: 'no-store',
        signal,
      })
      if (!res.ok) throw new Error(`上传测速失败 (${res.status})`)
      await res.text()
      const dtSec = Math.max(0.02, (performance.now() - t0) / 1000)
      totalUpBytes += size
      const stepMbps = (size * 8) / (dtSec * 1_000_000)
      const avgUpMbps = (totalUpBytes * 8) / (Math.max(0.05, (performance.now() - upStartAll) / 1000) * 1_000_000)
      upSamples.push({
        elapsedMs: Math.round(performance.now() - upStartAll),
        mbps: Number(stepMbps.toFixed(2)),
      })

      emit({
        progress: Math.min(96, Math.round(64 + ((uIdx + 1) / upSteps.length) * 32)),
        liveMbps: Number(stepMbps.toFixed(2)),
        uploadMbps: Number(avgUpMbps.toFixed(2)),
        uploadSamples: [...upSamples],
        transferredBytes: totalDownBytes + totalUpBytes,
      })
    }

    const upTotalSec = Math.max(0.05, (performance.now() - upStartAll) / 1000)
    const finalUpMbps = Number(((totalUpBytes * 8) / (upTotalSec * 1_000_000)).toFixed(2))

    emit({
      stage: 'done',
      progress: 100,
      liveMbps: finalDownMbps,
      downloadMbps: finalDownMbps,
      uploadMbps: finalUpMbps,
      transferredBytes: totalDownBytes + totalUpBytes,
      statusText: '测速完成',
    })

    return state
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      emit({
        stage: 'idle',
        progress: 0,
        liveMbps: 0,
        statusText: '测速已中止，可随时重新开始',
      })
      return state
    }
    const msg =
      source === 'self'
        ? '无法连接当前服务器测速接口（请确认已启动 server/index.mjs 后端服务，或切换至「公网节点」）'
        : err instanceof Error
          ? `公网测速失败：${err.message}（若处于内网或离线环境，可切换「当前服务器节点」）`
          : '测速失败，请检查网络连接'
    emit({
      stage: 'error',
      error: msg,
      statusText: '测速中断',
    })
    return state
  }
}

/** 按需手动探测公网出口 IP（不自动调用，尊重隐私） */
export async function fetchPublicIpInfo(): Promise<PublicIpInfo> {
  // 优先 Cloudflare trace（纯文本极速且 CORS 友好，同时给出边缘机房 colo）
  try {
    const res = await fetch('https://speed.cloudflare.com/meta', { cache: 'no-store' })
    if (res.ok) {
      const data = (await res.json()) as {
        clientIp?: string
        city?: string
        region?: string
        country?: string
        asOrganization?: string
        colo?: string
      }
      if (data.clientIp) {
        return {
          ip: data.clientIp,
          city: data.city,
          region: data.region,
          country: data.country,
          org: data.asOrganization,
          colo: data.colo,
        }
      }
    }
  } catch {
    // 降级尝试 ipify
  }

  const res = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' })
  if (!res.ok) throw new Error('公网 IP 查询失败')
  const data = (await res.json()) as { ip: string }
  return { ip: data.ip }
}

/** 宽带体验智能评级 */
export function evaluateNetworkTier(downMbps: number | null, pingMs: number | null) {
  if (downMbps === null) return null
  let tier = '基础宽带'
  let color = 'text-amber-600 dark:text-amber-400'
  if (downMbps >= 500) {
    tier = '千兆级超高速光纤'
    color = 'text-emerald-600 dark:text-emerald-400'
  } else if (downMbps >= 200) {
    tier = '高速宽带（300M~500M 级）'
    color = 'text-emerald-600 dark:text-emerald-400'
  } else if (downMbps >= 80) {
    tier = '百兆宽带（100M~200M 级）'
    color = 'text-sky-600 dark:text-sky-400'
  } else if (downMbps >= 25) {
    tier = '流畅宽带（4K 流媒体无压力）'
    color = 'text-sky-600 dark:text-sky-400'
  }

  const badges = [
    { label: '4K HDR 视频', ok: downMbps >= 25 },
    { label: '高清视频会议', ok: downMbps >= 10 && (pingMs ?? 999) <= 120 },
    { label: '低延迟游戏', ok: (pingMs ?? 999) <= 60 },
  ]
  return { tier, color, badges }
}
