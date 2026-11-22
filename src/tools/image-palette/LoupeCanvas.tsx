import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { rgbToHex, type RGB } from './color'

interface LoupeCanvasProps {
  bitmap: ImageBitmap
  /** 已采样的定位点列表（归一化坐标） */
  pins: { id: string; nx: number; ny: number; hex: string }[]
  showPins: boolean
  onPick: (rgb: RGB, pos: { x: number; y: number; nx: number; ny: number }) => void
}

/** 放大镜采样的像素网格半径（5 => 11×11 网格） */
const GRID_RADIUS = 5
const GRID_SIZE = GRID_RADIUS * 2 + 1
const CELL_PX = 12
const LOUPE_SIZE = GRID_SIZE * CELL_PX // 132px

/** 像素级放大镜取色画布：实时显示 11×11 像素网格、准星色值与坐标，支持鼠标与触控精准采样 */
export function LoupeCanvas({ bitmap, pins, showPins, onPick }: LoupeCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const imgCanvasRef = useRef<HTMLCanvasElement>(null)
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null)
  const pixelDataRef = useRef<{ data: Uint8ClampedArray; w: number; h: number } | null>(null)

  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<{
    /** 相对于舞台的显示坐标 */
    dx: number
    dy: number
    /** 采样图像素坐标 */
    px: number
    py: number
    /** 原图像素坐标 */
    origX: number
    origY: number
    rgb: RGB
    hex: string
  } | null>(null)

  // 离屏像素缓冲（边长上限 2400px 兼顾精准度与大照片内存）
  useEffect(() => {
    const canvas = imgCanvasRef.current
    if (!canvas) return
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, w, h)
    const imgData = ctx.getImageData(0, 0, w, h)
    pixelDataRef.current = { data: imgData.data, w, h }
  }, [bitmap])

  // 监听视口尺寸，精确居中适配任意横竖图
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => {
      const st = getComputedStyle(el)
      const px = parseFloat(st.paddingLeft) + parseFloat(st.paddingRight)
      const py = parseFloat(st.paddingTop) + parseFloat(st.paddingBottom)
      setBoxSize({ w: Math.max(0, el.clientWidth - px), h: Math.max(0, el.clientHeight - py) })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 绘制 11×11 放大镜像素网格
  useEffect(() => {
    const loupe = loupeCanvasRef.current
    const buf = pixelDataRef.current
    if (!loupe || !buf || !hover) return
    const ctx = loupe.getContext('2d')!
    ctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE)

    for (let gy = -GRID_RADIUS; gy <= GRID_RADIUS; gy++) {
      for (let gx = -GRID_RADIUS; gx <= GRID_RADIUS; gx++) {
        const sx = hover.px + gx
        const sy = hover.py + gy
        const rx = (gx + GRID_RADIUS) * CELL_PX
        const ry = (gy + GRID_RADIUS) * CELL_PX

        if (sx < 0 || sy < 0 || sx >= buf.w || sy >= buf.h) {
          ctx.fillStyle = (gx + gy) % 2 === 0 ? '#27272a' : '#18181b'
        } else {
          const idx = (sy * buf.w + sx) * 4
          const r = buf.data[idx]
          const g = buf.data[idx + 1]
          const b = buf.data[idx + 2]
          const a = buf.data[idx + 3] / 255
          ctx.fillStyle = `rgba(${r},${g},${b},${a})`
        }
        ctx.fillRect(rx, ry, CELL_PX, CELL_PX)
      }
    }

    // 细网格线
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 1
    for (let i = 1; i < GRID_SIZE; i++) {
      const p = i * CELL_PX + 0.5
      ctx.beginPath()
      ctx.moveTo(p, 0)
      ctx.lineTo(p, LOUPE_SIZE)
      ctx.moveTo(0, p)
      ctx.lineTo(LOUPE_SIZE, p)
      ctx.stroke()
    }

    // 正中心取色像素高亮框
    const centerPos = GRID_RADIUS * CELL_PX
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 3
    ctx.strokeRect(centerPos + 0.5, centerPos + 0.5, CELL_PX - 1, CELL_PX - 1)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.strokeRect(centerPos + 0.5, centerPos + 0.5, CELL_PX - 1, CELL_PX - 1)
  }, [hover])

  const sampleAt = (clientX: number, clientY: number) => {
    const stage = stageRef.current
    const buf = pixelDataRef.current
    if (!stage || !buf) return null
    const rect = stage.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const dx = Math.max(0, Math.min(rect.width, clientX - rect.left))
    const dy = Math.max(0, Math.min(rect.height, clientY - rect.top))
    const nx = dx / rect.width
    const ny = dy / rect.height
    const px = Math.min(buf.w - 1, Math.max(0, Math.floor(nx * buf.w)))
    const py = Math.min(buf.h - 1, Math.max(0, Math.floor(ny * buf.h)))
    const idx = (py * buf.w + px) * 4
    const rgb: RGB = { r: buf.data[idx], g: buf.data[idx + 1], b: buf.data[idx + 2] }
    const origX = Math.min(bitmap.width - 1, Math.floor(nx * bitmap.width))
    const origY = Math.min(bitmap.height - 1, Math.floor(ny * bitmap.height))
    return { dx, dy, nx, ny, px, py, origX, origY, rgb, hex: rgbToHex(rgb), stageW: rect.width, stageH: rect.height }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = sampleAt(e.clientX, e.clientY)
    if (!s) return
    setHover({ dx: s.dx, dy: s.dy, px: s.px, py: s.py, origX: s.origX, origY: s.origY, rgb: s.rgb, hex: s.hex })
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const s = sampleAt(e.clientX, e.clientY)
    if (!s) return
    setHover({ dx: s.dx, dy: s.dy, px: s.px, py: s.py, origX: s.origX, origY: s.origY, rgb: s.rgb, hex: s.hex })
    onPick(s.rgb, { x: s.origX, y: s.origY, nx: s.nx, ny: s.ny })
  }

  const fitScale =
    boxSize.w > 0 && boxSize.h > 0 ? Math.min(boxSize.w / bitmap.width, boxSize.h / bitmap.height) : 0
  const stageW = fitScale > 0 ? Math.max(40, Math.floor(bitmap.width * fitScale)) : undefined
  const stageH = fitScale > 0 ? Math.max(40, Math.floor(bitmap.height * fitScale)) : undefined

  // 计算放大镜防出界偏移位置
  const loupeOffset = (() => {
    if (!hover || !stageW || !stageH) return { left: 0, top: 0 }
    const margin = 18
    const totalH = LOUPE_SIZE + 34
    const preferRight = hover.dx + margin + LOUPE_SIZE <= stageW + 24
    const preferTop = hover.dy - margin - totalH >= -16
    const left = preferRight ? hover.dx + margin : hover.dx - margin - LOUPE_SIZE
    const top = preferTop ? hover.dy - margin - totalH : hover.dy + margin
    return { left, top }
  })()

  return (
    <div
      ref={wrapRef}
      className="checkerboard shadow-soft relative flex h-[min(56dvh,560px)] min-h-[280px] w-full items-center justify-center overflow-hidden rounded-3xl border p-4 select-none sm:p-6"
    >
      <div
        ref={stageRef}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerLeave={() => setHover(null)}
        className="relative cursor-crosshair touch-none shadow-2xl"
        style={stageW && stageH ? { width: stageW, height: stageH } : { aspectRatio: `${bitmap.width} / ${bitmap.height}` }}
      >
        <canvas ref={imgCanvasRef} className="block h-full w-full rounded-sm" />

        {/* 已采样坐标圆点标记 */}
        {showPins &&
          pins.map((pin) => (
            <span
              key={pin.id}
              style={{
                left: `${pin.nx * 100}%`,
                top: `${pin.ny * 100}%`,
                background: pin.hex,
              }}
              className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_2px_8px_rgb(0_0_0/0.55)]"
            />
          ))}

        {/* 跟随光标的 11×11 像素放大镜 */}
        {hover && (
          <div
            style={{ left: loupeOffset.left, top: loupeOffset.top }}
            className="pointer-events-none absolute z-20 flex flex-col items-center gap-1.5"
          >
            <div className="overflow-hidden rounded-full border-[3px] border-white shadow-[0_10px_30px_rgb(0_0_0/0.45)] ring-1 ring-black/20">
              <canvas ref={loupeCanvasRef} width={LOUPE_SIZE} height={LOUPE_SIZE} className="block" />
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-black/80 px-2.5 py-1 font-mono text-[11px] font-medium text-white shadow-lg backdrop-blur-md">
              <span className="size-3 rounded-full border border-white/50" style={{ background: hover.hex }} />
              <span>{hover.hex}</span>
              <span className="text-white/50">
                {hover.origX},{hover.origY}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
