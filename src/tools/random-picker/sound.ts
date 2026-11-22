/**
 * 沉浸式音效合成与礼花彩带粒子引擎
 * - 零外部音频依赖：基于 Web Audio API 实时合成清脆转盘拨片声与获奖和弦
 * - 独立 Canvas 礼花粒子系统：直接挂载于抽签舞台内部，原生全屏模式下同样炫丽绽放
 */

let sharedAudioCtx: AudioContext | null = null

function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!sharedAudioCtx) {
    sharedAudioCtx = new Ctor()
  }
  if (sharedAudioCtx.state === 'suspended') {
    void sharedAudioCtx.resume()
  }
  return sharedAudioCtx
}

/** 播放清脆拨片滴答声（转盘过格 / 抽签滚动） */
export function playTickSound(pitchFactor = 1) {
  const ctx = getAudioCtx()
  if (!ctx) return
  try {
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(760 * pitchFactor, now)
    osc.frequency.exponentialRampToValueAtTime(220 * pitchFactor, now + 0.032)

    gain.gain.setValueAtTime(0.11, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.036)

    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.04)
  } catch {
    // 忽略未交互解锁前的音频异常
  }
}

/** 播放愉悦的揭晓胜利和弦（C5 - E5 - G5 - C6 琶音） */
export function playWinFanfare() {
  const ctx = getAudioCtx()
  if (!ctx) return
  try {
    const notes = [523.25, 659.25, 783.99, 1046.5]
    const now = ctx.currentTime

    notes.forEach((freq, idx) => {
      const start = now + idx * 0.075
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, start)

      gain.gain.setValueAtTime(0.001, start)
      gain.gain.linearRampToValueAtTime(0.16, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.55)

      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.58)
    })
  } catch {
    // 忽略音频异常
  }
}

interface ConfettiParticle {
  x: number
  y: number
  vx: number
  vy: number
  w: number
  h: number
  color: string
  angle: number
  vAngle: number
  opacity: number
}

const CONFETTI_COLORS = ['#f43f5e', '#f59e0b', '#10b981', '#0ea5e9', '#8b5cf6', '#ec4899', '#fde047']

/**
 * 在指定 Canvas 上发射一波物理礼花彩带，返回清理函数
 */
export function launchConfetti(canvas: HTMLCanvasElement): () => void {
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  const w = Math.max(200, rect.width)
  const h = Math.max(200, rect.height)
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)

  const ctx = canvas.getContext('2d')!
  const particles: ConfettiParticle[] = []
  const count = 96

  // 从舞台左右两侧与中上方同时喷射
  for (let i = 0; i < count; i++) {
    const fromLeft = i % 3 === 0
    const fromRight = i % 3 === 1
    const originX = fromLeft ? w * 0.14 : fromRight ? w * 0.86 : w * 0.5
    const originY = fromLeft || fromRight ? h * 0.62 : h * 0.34
    const baseAngle = fromLeft ? -Math.PI / 3 : fromRight ? (-2 * Math.PI) / 3 : -Math.PI / 2
    const spread = (Math.random() - 0.5) * 1.15
    const speed = 7 + Math.random() * 11

    particles.push({
      x: originX + (Math.random() - 0.5) * 30,
      y: originY + (Math.random() - 0.5) * 20,
      vx: Math.cos(baseAngle + spread) * speed,
      vy: Math.sin(baseAngle + spread) * speed - 2,
      w: 6 + Math.random() * 6,
      h: 4 + Math.random() * 5,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      angle: Math.random() * Math.PI * 2,
      vAngle: (Math.random() - 0.5) * 0.28,
      opacity: 1,
    })
  }

  let raf = 0
  let frame = 0

  const step = () => {
    frame += 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    let alive = 0
    for (const p of particles) {
      p.x += p.vx
      p.y += p.vy
      p.vy += 0.28 // 重力加速度
      p.vx *= 0.992 // 空气阻力
      p.angle += p.vAngle
      if (frame > 70) {
        p.opacity = Math.max(0, p.opacity - 0.018)
      }
      if (p.opacity > 0.01 && p.y < h + 40) {
        alive += 1
        ctx.save()
        ctx.globalAlpha = p.opacity
        ctx.translate(p.x, p.y)
        ctx.rotate(p.angle)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      }
    }

    if (alive > 0 && frame < 200) {
      raf = requestAnimationFrame(step)
    } else {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
    }
  }

  raf = requestAnimationFrame(step)

  return () => {
    cancelAnimationFrame(raf)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
  }
}
