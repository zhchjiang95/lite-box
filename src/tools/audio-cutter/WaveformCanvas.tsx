import { useEffect, useRef, useState } from 'react'
import { formatAudioTime, type CutMode, type WaveformPeaks } from './engine'

interface WaveformCanvasProps {
  peaks: WaveformPeaks
  duration: number
  currentTime: number
  startSec: number
  endSec: number
  mode: CutMode
  fadeInSec: number
  fadeOutSec: number
  zoom: number
  scrollSec: number
  onChangeRange: (start: number, end: number) => void
  onSeek: (sec: number) => void
  onChangeScroll: (nextScroll: number) => void
}

type DragKind = 'none' | 'start' | 'end' | 'move' | 'create' | 'seek'

const RULER_H = 24
const HANDLE_HIT_PX = 14

/** 交互式高清 Retina 双层音频波形画布（支持缩放、选区手柄拖拽、平移、淡入淡出可视化与标尺定位） */
export function WaveformCanvas({
  peaks,
  duration,
  currentTime,
  startSec,
  endSec,
  mode,
  fadeInSec,
  fadeOutSec,
  zoom,
  scrollSec,
  onChangeRange,
  onSeek,
  onChangeScroll,
}: WaveformCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = useState({ width: 720, height: 196 })
  const [cursorStyle, setCursorStyle] = useState('crosshair')

  const dragRef = useRef<{
    kind: DragKind
    anchorSec: number
    origStart: number
    origEnd: number
  }>({ kind: 'none', anchorSec: 0, origStart: 0, origEnd: 0 })

  const visibleDuration = duration > 0 ? duration / Math.max(1, zoom) : 1
  const viewStart = Math.max(0, Math.min(Math.max(0, duration - visibleDuration), scrollSec))
  const viewEnd = Math.min(duration, viewStart + visibleDuration)

  const secToX = (sec: number, width: number) =>
    visibleDuration > 0 ? ((sec - viewStart) / visibleDuration) * width : 0

  const xToSec = (x: number, width: number) => {
    const ratio = Math.max(0, Math.min(1, x / Math.max(1, width)))
    return Math.max(0, Math.min(duration, viewStart + ratio * visibleDuration))
  }

  // 监听容器宽度变化
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0) {
        setSize({ width: Math.floor(rect.width), height: 204 })
      }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 滚轮横向滚动 / Ctrl+滚轮（简化为 Shift 或直接横向滚轮）平移视口
  const handleWheel = (e: React.WheelEvent) => {
    if (zoom <= 1) return
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    if (delta === 0) return
    e.preventDefault()
    const shift = (delta / Math.max(1, size.width)) * visibleDuration * 0.8
    const maxScroll = Math.max(0, duration - visibleDuration)
    onChangeScroll(Math.max(0, Math.min(maxScroll, viewStart + shift)))
  }

  // 高清绘制波形、选区、淡入淡出斜坡、时间尺与播放指针
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const { width, height } = size
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)
    const waveTop = RULER_H
    const waveH = height - RULER_H
    const midY = waveTop + waveH / 2
    const isDark = document.documentElement.classList.contains('dark')

    // 1. 背景底色
    ctx.fillStyle = isDark ? '#0f121a' : '#f8fafc'
    ctx.fillRect(0, 0, width, height)

    // 2. 顶部时间标尺背景
    ctx.fillStyle = isDark ? '#161b26' : '#f1f5f9'
    ctx.fillRect(0, 0, width, RULER_H)
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, RULER_H - 0.5)
    ctx.lineTo(width, RULER_H - 0.5)
    ctx.stroke()

    // 智能选择刻度间隔
    const rawStep = visibleDuration / Math.max(4, Math.floor(width / 95))
    const niceSteps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
    const tickStep = niceSteps.find((s) => s >= rawStep) ?? 600
    const firstTick = Math.ceil(viewStart / tickStep) * tickStep

    ctx.font = '500 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    ctx.fillStyle = isDark ? 'rgba(226,232,240,0.65)' : 'rgba(51,65,85,0.7)'
    ctx.textBaseline = 'middle'

    for (let t = firstTick; t <= viewEnd + 1e-6; t += tickStep) {
      const x = Math.round(secToX(t, width)) + 0.5
      // 垂直参考虚线
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.045)' : 'rgba(15,23,42,0.05)'
      ctx.beginPath()
      ctx.moveTo(x, RULER_H)
      ctx.lineTo(x, height)
      ctx.stroke()

      // 刻度线与文字
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.22)' : 'rgba(15,23,42,0.22)'
      ctx.beginPath()
      ctx.moveTo(x, RULER_H - 6)
      ctx.lineTo(x, RULER_H)
      ctx.stroke()
      ctx.fillText(formatAudioTime(t), x + 4, RULER_H / 2)
    }

    // 中心 0 dB 基线
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(15,23,42,0.09)'
    ctx.beginPath()
    ctx.moveTo(0, midY)
    ctx.lineTo(width, midY)
    ctx.stroke()

    // 3. 绘制双层声波（每个 2px 柱子取对应 bucket）
    const sx = secToX(startSec, width)
    const ex = secToX(endSec, width)
    const barGap = 2
    const barCount = Math.floor(width / barGap)

    for (let i = 0; i < barCount; i++) {
      const x = i * barGap
      const sec = xToSec(x, width)
      const bucketIdx = Math.min(
        peaks.buckets - 1,
        Math.max(0, Math.floor((sec / Math.max(0.001, duration)) * peaks.buckets)),
      )
      const peakVal = peaks.peaks[bucketIdx] ?? 0
      const rmsVal = peaks.rms[bucketIdx] ?? 0

      const inSelection = sec >= startSec && sec <= endSec
      const isKept = mode === 'keep' ? inSelection : !inSelection

      const outerH = Math.max(2, peakVal * (waveH * 0.44))
      const innerH = Math.max(1, rmsVal * (waveH * 0.44))

      if (isKept) {
        ctx.fillStyle = isDark ? 'rgba(99, 102, 241, 0.42)' : 'rgba(79, 70, 229, 0.32)'
        ctx.fillRect(x, midY - outerH, 1.5, outerH * 2)
        ctx.fillStyle = isDark ? '#818cf8' : '#4f46e5'
        ctx.fillRect(x, midY - innerH, 1.5, innerH * 2)
      } else if (mode === 'remove' && inSelection) {
        // 将被剪除的选区标为淡红
        ctx.fillStyle = isDark ? 'rgba(244, 63, 94, 0.35)' : 'rgba(225, 29, 72, 0.28)'
        ctx.fillRect(x, midY - outerH, 1.5, outerH * 2)
      } else {
        ctx.fillStyle = isDark ? 'rgba(148, 163, 184, 0.22)' : 'rgba(100, 116, 139, 0.25)'
        ctx.fillRect(x, midY - outerH, 1.5, outerH * 2)
      }
    }

    // 4. 选区蒙层高亮与边界手柄
    const clampedSx = Math.max(0, Math.min(width, sx))
    const clampedEx = Math.max(clampedSx, Math.min(width, ex))
    if (clampedEx > clampedSx) {
      ctx.fillStyle =
        mode === 'keep'
          ? isDark
            ? 'rgba(99, 102, 241, 0.13)'
            : 'rgba(79, 70, 229, 0.09)'
          : isDark
            ? 'rgba(244, 63, 94, 0.16)'
            : 'rgba(225, 29, 72, 0.12)'
      ctx.fillRect(clampedSx, waveTop, clampedEx - clampedSx, waveH)
    }

    // 5. 淡入 / 淡出斜坡可视化（保留选区模式下绘制在选区两端，剪除模式下绘制在全曲两端）
    const fadeStartBase = mode === 'keep' ? startSec : 0
    const fadeEndBase = mode === 'keep' ? endSec : duration
    if (fadeInSec > 0.05) {
      const fx1 = secToX(fadeStartBase, width)
      const fx2 = secToX(Math.min(fadeEndBase, fadeStartBase + fadeInSec), width)
      if (fx2 > fx1) {
        ctx.fillStyle = 'rgba(16, 185, 129, 0.18)'
        ctx.beginPath()
        ctx.moveTo(fx1, waveTop)
        ctx.lineTo(fx2, waveTop)
        ctx.lineTo(fx1, height)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.85)'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(fx1, height)
        ctx.lineTo(fx2, waveTop)
        ctx.stroke()
      }
    }
    if (fadeOutSec > 0.05) {
      const fx1 = secToX(Math.max(fadeStartBase, fadeEndBase - fadeOutSec), width)
      const fx2 = secToX(fadeEndBase, width)
      if (fx2 > fx1) {
        ctx.fillStyle = 'rgba(14, 165, 233, 0.18)'
        ctx.beginPath()
        ctx.moveTo(fx1, waveTop)
        ctx.lineTo(fx2, waveTop)
        ctx.lineTo(fx2, height)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = 'rgba(14, 165, 233, 0.85)'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(fx1, waveTop)
        ctx.lineTo(fx2, height)
        ctx.stroke()
      }
    }

    // 绘制左右选区边界线与抓手
    const handleColor = mode === 'keep' ? '#6366f1' : '#f43f5e'
    for (const [hx, isLeft] of [
      [sx, true],
      [ex, false],
    ] as const) {
      if (hx < -12 || hx > width + 12) continue
      ctx.strokeStyle = handleColor
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(hx, waveTop)
      ctx.lineTo(hx, height)
      ctx.stroke()

      // 抓手小耳标
      const tabW = 10
      const tabH = 26
      const tabX = isLeft ? hx : hx - tabW
      ctx.fillStyle = handleColor
      ctx.beginPath()
      ctx.roundRect(tabX, midY - tabH / 2, tabW, tabH, isLeft ? [0, 5, 5, 0] : [5, 0, 0, 5])
      ctx.fill()

      ctx.fillStyle = '#ffffff'
      ctx.fillRect(tabX + 4, midY - 6, 2, 12)
    }

    // 6. 实时播放指针
    const playX = secToX(currentTime, width)
    if (playX >= 0 && playX <= width) {
      ctx.strokeStyle = '#f59e0b'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(playX, 0)
      ctx.lineTo(playX, height)
      ctx.stroke()

      ctx.fillStyle = '#f59e0b'
      ctx.beginPath()
      ctx.moveTo(playX - 5, 0)
      ctx.lineTo(playX + 5, 0)
      ctx.lineTo(playX, 8)
      ctx.closePath()
      ctx.fill()
    }
  }, [
    peaks,
    duration,
    currentTime,
    startSec,
    endSec,
    mode,
    fadeInSec,
    fadeOutSec,
    zoom,
    viewStart,
    viewEnd,
    visibleDuration,
    size,
  ])

  const getLocalCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      width: rect.width,
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y, width } = getLocalCoords(e)
    e.currentTarget.setPointerCapture(e.pointerId)

    // 点击顶部刻度尺直接跳转播放指针
    if (y <= RULER_H) {
      dragRef.current = { kind: 'seek', anchorSec: 0, origStart: startSec, origEnd: endSec }
      onSeek(xToSec(x, width))
      return
    }

    const sx = secToX(startSec, width)
    const ex = secToX(endSec, width)
    const sec = xToSec(x, width)

    if (Math.abs(x - sx) <= HANDLE_HIT_PX) {
      dragRef.current = { kind: 'start', anchorSec: sec, origStart: startSec, origEnd: endSec }
    } else if (Math.abs(x - ex) <= HANDLE_HIT_PX) {
      dragRef.current = { kind: 'end', anchorSec: sec, origStart: startSec, origEnd: endSec }
    } else if (x > sx && x < ex) {
      dragRef.current = { kind: 'move', anchorSec: sec, origStart: startSec, origEnd: endSec }
    } else {
      dragRef.current = { kind: 'create', anchorSec: sec, origStart: sec, origEnd: sec }
      onSeek(sec)
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y, width } = getLocalCoords(e)
    const drag = dragRef.current

    if (drag.kind === 'none') {
      if (y <= RULER_H) {
        setCursorStyle('pointer')
        return
      }
      const sx = secToX(startSec, width)
      const ex = secToX(endSec, width)
      if (Math.abs(x - sx) <= HANDLE_HIT_PX || Math.abs(x - ex) <= HANDLE_HIT_PX) {
        setCursorStyle('ew-resize')
      } else if (x > sx && x < ex) {
        setCursorStyle('grab')
      } else {
        setCursorStyle('crosshair')
      }
      return
    }

    const sec = xToSec(x, width)
    const minGap = Math.min(0.1, duration * 0.02)

    if (drag.kind === 'seek') {
      onSeek(sec)
    } else if (drag.kind === 'start') {
      const nextStart = Math.max(0, Math.min(drag.origEnd - minGap, sec))
      onChangeRange(nextStart, drag.origEnd)
    } else if (drag.kind === 'end') {
      const nextEnd = Math.min(duration, Math.max(drag.origStart + minGap, sec))
      onChangeRange(drag.origStart, nextEnd)
    } else if (drag.kind === 'move') {
      setCursorStyle('grabbing')
      const span = drag.origEnd - drag.origStart
      const delta = sec - drag.anchorSec
      const nextStart = Math.max(0, Math.min(duration - span, drag.origStart + delta))
      onChangeRange(nextStart, nextStart + span)
    } else if (drag.kind === 'create') {
      const a = Math.min(drag.anchorSec, sec)
      const b = Math.max(drag.anchorSec, sec)
      if (b - a >= minGap) {
        onChangeRange(a, b)
      }
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current.kind !== 'none') {
      dragRef.current.kind = 'none'
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // 忽略
      }
    }
  }

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      className="relative w-full overflow-hidden rounded-xl border border-border/80 select-none"
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ width: '100%', height: `${size.height}px`, cursor: cursorStyle, touchAction: 'none' }}
        className="block"
      />
    </div>
  )
}
