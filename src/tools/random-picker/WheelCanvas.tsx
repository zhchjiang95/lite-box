import { useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from 'react'
import { pickWeightedRandom, secureRandomFloat, type PickerItem } from './types'
import { playTickSound } from './sound'

export interface WheelCanvasHandle {
  spin: () => void
}

interface WheelCanvasProps {
  items: PickerItem[]
  spinning: boolean
  soundEnabled: boolean
  durationMs: number
  sizePx: number
  isFullscreen: boolean
  onSpinStart: () => void
  onSpinEnd: (winner: PickerItem) => void
}

interface SliceAngle {
  item: PickerItem
  startRad: number
  endRad: number
  midRad: number
}

/** 极顺滑五次缓出曲线（起速有力、尾段悬念感十足） */
function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5)
}

/** 按权重计算每个扇区的起止弧度 */
function computeSlices(items: PickerItem[]): SliceAngle[] {
  const totalWeight = items.reduce((sum, it) => sum + it.weight, 0) || 1
  const slices: SliceAngle[] = []
  let acc = 0
  for (const item of items) {
    const span = (item.weight / totalWeight) * Math.PI * 2
    slices.push({
      item,
      startRad: acc,
      endRad: acc + span,
      midRad: acc + span / 2,
    })
    acc += span
  }
  return slices
}

/**
 * 根据当前转盘顺时针旋转角度，返回顶部 12 点钟指针（-π/2）正下方的扇区索引
 */
function getSliceIndexAtPointer(slices: SliceAngle[], rotationRad: number): number {
  if (!slices.length) return -1
  const twoPi = Math.PI * 2
  // 指针固定在 -π/2，转盘顺时针转了 rotationRad，则指针指向转盘局部角 = (-π/2 - rotationRad) mod 2π
  const localAngle = (((-Math.PI / 2 - rotationRad) % twoPi) + twoPi) % twoPi
  for (let i = 0; i < slices.length; i++) {
    if (localAngle >= slices[i].startRad && localAngle < slices[i].endRad) return i
  }
  return slices.length - 1
}

/**
 * 高清 Canvas 幸运大转盘
 * - 支持权重按比例分配扇区角度
 * - 外圈呼吸跑马灯珠、金属质感轮缘、顶部弹性拨片指针
 * - 转动过格时自动触发拨片弹动与清脆音效
 */
export const WheelCanvas = forwardRef<WheelCanvasHandle, WheelCanvasProps>(function WheelCanvas(
  { items, spinning, soundEnabled, durationMs, sizePx, isFullscreen, onSpinStart, onSpinEnd },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rotationRef = useRef(0)
  const pointerKickRef = useRef(0)
  const bulbPhaseRef = useRef(0)
  const rafRef = useRef(0)
  const lastSliceIdxRef = useRef(-1)
  const highlightIdxRef = useRef(-1)
  const soundRef = useRef(soundEnabled)
  soundRef.current = soundEnabled

  const itemsRef = useRef(items)
  itemsRef.current = items

  const drawWheel = useCallback(
    (rotRad: number, kickRad: number, bulbPhase: number, highlightIdx: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      const size = Math.max(240, Math.round(sizePx))
      if (canvas.width !== Math.round(size * dpr) || canvas.height !== Math.round(size * dpr)) {
        canvas.width = Math.round(size * dpr)
        canvas.height = Math.round(size * dpr)
      }

      const ctx = canvas.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, size, size)

      const cx = size / 2
      const cy = size / 2 + 6
      const outerR = size * 0.455
      const wheelR = outerR - Math.max(11, size * 0.032)

      // 1. 底部氛围投影
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy + 4, outerR, 0, Math.PI * 2)
      ctx.shadowColor = isFullscreen ? 'rgba(99, 102, 241, 0.45)' : 'rgba(15, 23, 42, 0.25)'
      ctx.shadowBlur = isFullscreen ? 36 : 22
      ctx.fillStyle = '#0f172a'
      ctx.fill()
      ctx.restore()

      // 2. 金属质感外圈轮缘
      ctx.save()
      const bezelGrad = ctx.createLinearGradient(cx - outerR, cy - outerR, cx + outerR, cy + outerR)
      bezelGrad.addColorStop(0, '#334155')
      bezelGrad.addColorStop(0.5, '#0f172a')
      bezelGrad.addColorStop(1, '#1e293b')
      ctx.beginPath()
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2)
      ctx.fillStyle = bezelGrad
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'
      ctx.stroke()

      // 3. 外圈 24 颗跑马灯珠
      const bulbCount = 24
      const bulbR = (outerR + wheelR) / 2
      for (let i = 0; i < bulbCount; i++) {
        const a = (i / bulbCount) * Math.PI * 2
        const bx = cx + Math.cos(a) * bulbR
        const by = cy + Math.sin(a) * bulbR
        const lit = (i + Math.floor(bulbPhase)) % 2 === 0
        ctx.beginPath()
        ctx.arc(bx, by, Math.max(2.6, size * 0.0075), 0, Math.PI * 2)
        ctx.fillStyle = lit ? '#fde047' : 'rgba(255,255,255,0.28)'
        if (lit) {
          ctx.shadowColor = '#facc15'
          ctx.shadowBlur = 8
        } else {
          ctx.shadowBlur = 0
        }
        ctx.fill()
      }
      ctx.restore()

      // 4. 绘制扇区
      const currentItems = itemsRef.current
      const slices = computeSlices(currentItems)

      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(rotRad)

      if (slices.length === 0) {
        ctx.beginPath()
        ctx.arc(0, 0, wheelR, 0, Math.PI * 2)
        ctx.fillStyle = '#334155'
        ctx.fill()
      } else {
        slices.forEach((s, idx) => {
          ctx.beginPath()
          ctx.moveTo(0, 0)
          ctx.arc(0, 0, wheelR, s.startRad, s.endRad)
          ctx.closePath()
          ctx.fillStyle = s.item.color
          ctx.fill()

          // 获奖扇区轻微提亮发光
          if (highlightIdx === idx) {
            ctx.fillStyle = 'rgba(255,255,255,0.22)'
            ctx.fill()
          }

          ctx.lineWidth = Math.max(1.2, size * 0.003)
          ctx.strokeStyle = 'rgba(255,255,255,0.55)'
          ctx.stroke()

          // 扇区文字（沿径向排布并自动限长）
          const span = s.endRad - s.startRad
          if (span > 0.07) {
            ctx.save()
            ctx.rotate(s.midRad)
            ctx.textAlign = 'right'
            ctx.textBaseline = 'middle'
            const maxChars = slices.length > 20 ? 5 : slices.length > 12 ? 7 : 10
            const text =
              s.item.label.length > maxChars ? `${s.item.label.slice(0, maxChars - 1)}…` : s.item.label
            const baseFont = Math.min(
              Math.max(10, wheelR * 0.115),
              Math.max(10, (span * wheelR * 0.42)),
              isFullscreen ? 24 : 18,
            )
            ctx.font = `700 ${Math.round(baseFont)}px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`
            ctx.shadowColor = 'rgba(0,0,0,0.35)'
            ctx.shadowBlur = 4
            ctx.fillStyle = '#ffffff'
            ctx.fillText(text, wheelR - Math.max(14, wheelR * 0.09), 0)
            ctx.restore()
          }

          // 外缘拨片铆钉
          const pegX = Math.cos(s.startRad) * (wheelR - 5)
          const pegY = Math.sin(s.startRad) * (wheelR - 5)
          ctx.beginPath()
          ctx.arc(pegX, pegY, Math.max(2.2, size * 0.006), 0, Math.PI * 2)
          ctx.fillStyle = '#ffffff'
          ctx.fill()
        })
      }

      // 中心微妙径向高光
      const gloss = ctx.createRadialGradient(0, 0, wheelR * 0.12, 0, 0, wheelR)
      gloss.addColorStop(0, 'rgba(255,255,255,0.22)')
      gloss.addColorStop(0.55, 'rgba(255,255,255,0)')
      gloss.addColorStop(1, 'rgba(0,0,0,0.14)')
      ctx.beginPath()
      ctx.arc(0, 0, wheelR, 0, Math.PI * 2)
      ctx.fillStyle = gloss
      ctx.fill()
      ctx.restore()

      // 5. 中心按钮圆盘（按钮本体由外部覆盖交互，此处画底座环）
      const hubR = Math.max(28, wheelR * 0.2)
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, hubR + 5, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(15, 23, 42, 0.35)'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(cx, cy, hubR, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.shadowColor = 'rgba(0,0,0,0.28)'
      ctx.shadowBlur = 12
      ctx.fill()
      ctx.restore()

      // 6. 顶部 12 点钟弹性拨片指针
      const ptrY = cy - wheelR - Math.max(10, size * 0.028)
      const ptrH = Math.max(28, size * 0.085)
      const ptrW = Math.max(18, size * 0.056)
      ctx.save()
      ctx.translate(cx, ptrY)
      ctx.rotate(kickRad)
      ctx.shadowColor = 'rgba(0,0,0,0.35)'
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.moveTo(0, ptrH)
      ctx.lineTo(-ptrW / 2, 0)
      ctx.arc(0, 0, ptrW / 2, Math.PI, 0)
      ctx.closePath()
      const ptrGrad = ctx.createLinearGradient(0, -ptrW / 2, 0, ptrH)
      ptrGrad.addColorStop(0, '#fb7185')
      ptrGrad.addColorStop(1, '#e11d48')
      ctx.fillStyle = ptrGrad
      ctx.fill()
      ctx.lineWidth = 2.5
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()

      // 指针轴心铆钉
      ctx.beginPath()
      ctx.arc(0, 0, ptrW * 0.18, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.restore()
    },
    [sizePx, isFullscreen],
  )

  // 参数或尺寸变更时重绘静止转盘
  useEffect(() => {
    if (!spinning) {
      drawWheel(rotationRef.current, 0, bulbPhaseRef.current, highlightIdxRef.current)
    }
  }, [items, sizePx, isFullscreen, spinning, drawWheel])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  const spin = useCallback(() => {
    const currentItems = itemsRef.current
    if (spinning || currentItems.length < 2) return

    const slices = computeSlices(currentItems)
    const [winner] = pickWeightedRandom(currentItems, 1)
    const targetIdx = slices.findIndex((s) => s.item.id === winner.id)
    if (targetIdx < 0) return

    const targetSlice = slices[targetIdx]
    // 在目标扇区内部 [20%, 80%] 随机落点，既真实又绝不压线
    const span = targetSlice.endRad - targetSlice.startRad
    const targetLocalAngle = targetSlice.startRad + span * (0.2 + secureRandomFloat() * 0.6)

    const twoPi = Math.PI * 2
    const startRot = rotationRef.current
    // 期望终点满足：(-π/2 - endRot) ≡ targetLocalAngle (mod 2π)
    const desiredMod = (((-Math.PI / 2 - targetLocalAngle) % twoPi) + twoPi) % twoPi
    const currentMod = ((startRot % twoPi) + twoPi) % twoPi
    let deltaToTarget = desiredMod - currentMod
    if (deltaToTarget <= 0) deltaToTarget += twoPi

    const extraTurns = (6 + Math.floor(secureRandomFloat() * 3)) * twoPi
    const endRot = startRot + extraTurns + deltaToTarget

    highlightIdxRef.current = -1
    lastSliceIdxRef.current = getSliceIndexAtPointer(slices, startRot)
    onSpinStart()

    const startTime = performance.now()
    const totalDur = Math.max(1800, durationMs)

    const animate = (now: number) => {
      const elapsed = now - startTime
      const t = Math.min(1, elapsed / totalDur)
      const eased = easeOutQuint(t)
      const curRot = startRot + (endRot - startRot) * eased
      rotationRef.current = curRot

      // 检测是否越过扇区分界线，驱动拨片弹跳与清脆滴答音
      const curIdx = getSliceIndexAtPointer(slices, curRot)
      if (curIdx !== lastSliceIdxRef.current) {
        lastSliceIdxRef.current = curIdx
        pointerKickRef.current = -0.34
        if (soundRef.current) {
          playTickSound(0.92 + (1 - t) * 0.25)
        }
      }

      // 拨片弹性回正 + 跑马灯珠交替闪烁
      pointerKickRef.current *= 0.82
      bulbPhaseRef.current += 0.16 * (1.2 - t * 0.7)
      drawWheel(curRot, pointerKickRef.current, bulbPhaseRef.current, -1)

      if (t < 1) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        rotationRef.current = endRot % twoPi
        highlightIdxRef.current = targetIdx
        drawWheel(rotationRef.current, 0, bulbPhaseRef.current + 1, targetIdx)
        onSpinEnd(winner)
      }
    }

    rafRef.current = requestAnimationFrame(animate)
  }, [spinning, durationMs, drawWheel, onSpinStart, onSpinEnd])

  useImperativeHandle(ref, () => ({ spin }), [spin])

  const hubPx = Math.max(52, Math.round(sizePx * 0.165))

  return (
    <div className="relative inline-flex items-center justify-center select-none" style={{ width: sizePx, height: sizePx }}>
      <canvas ref={canvasRef} style={{ width: sizePx, height: sizePx }} className="block" />
      <button
        type="button"
        disabled={spinning || items.length < 2}
        onClick={spin}
        style={{
          width: hubPx,
          height: hubPx,
          marginTop: 6,
        }}
        className="from-primary to-accent absolute flex cursor-pointer items-center justify-center rounded-full bg-gradient-to-br text-sm font-bold text-white shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 sm:text-base"
        title="点击开始转动（支持按空格键）"
      >
        {spinning ? '…' : 'GO'}
      </button>
    </div>
  )
})
