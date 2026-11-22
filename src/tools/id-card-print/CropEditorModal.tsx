import { AnimatePresence, motion } from 'motion/react'
import { Check, Crop, RotateCcw, RotateCw, Scan, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Slider } from '@/components/ui/slider'
import {
  buildRotatedSourceCanvas,
  computeCenteredRect,
  createDefaultCardEdit,
  renderProcessedCard,
} from './engine'
import type { CardEditState, CardSource, CropMode, Point2D, PrintOptions, RectNorm } from './types'

interface CropEditorModalProps {
  open: boolean
  title: string
  source: CardSource | null
  targetAspect: number
  printOpts: PrintOptions
  onCancel: () => void
  onApply: (nextEdit: CardEditState) => void
}

type RectDragKind = 'move' | 'tl' | 'tr' | 'bl' | 'br'

const CORNER_LABELS = ['左上', '右上', '右下', '左下'] as const

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

/**
 * 证件精细裁切 & 四点透视拉直编辑器
 * - 透视模式：拖拽 4 个角点（带 3× 十字放大镜）将拍歪的梯形证件一键拉平
 * - 矩形模式：锁定国标宽高比裁剪 + 90° 旋转 + ±15° 微调纠偏
 * - 右侧/下方同步实时展示拉直裁剪后的证件成片
 */
export function CropEditorModal({
  open,
  title,
  source,
  targetAspect,
  printOpts,
  onCancel,
  onApply,
}: CropEditorModalProps) {
  const [draft, setDraft] = useState<CardEditState | null>(null)
  const [activeCorner, setActiveCorner] = useState<number | null>(null)
  const [loupePos, setLoupePos] = useState<Point2D | null>(null)

  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const miniPreviewRef = useRef<HTMLCanvasElement>(null)

  // 记录图像在画布内的显示矩形（CSS 像素）
  const imgBoxRef = useRef({ x: 0, y: 0, w: 0, h: 0 })
  const dragRef = useRef<
    | { type: 'quad'; index: number }
    | { type: 'rect'; kind: RectDragKind; startPt: Point2D; startRect: RectNorm }
    | null
  >(null)

  // 打开时克隆当前编辑状态
  useEffect(() => {
    if (open && source) {
      setDraft({
        ...source.edit,
        rect: { ...source.edit.rect },
        quad: [
          { ...source.edit.quad[0] },
          { ...source.edit.quad[1] },
          { ...source.edit.quad[2] },
          { ...source.edit.quad[3] },
        ],
      })
      setActiveCorner(null)
      setLoupePos(null)
    }
  }, [open, source])

  // 按当前 90° 旋转状态缓存适中分辨率的源图画布（拖动 60fps 丝滑）
  const rotatedCanvas = useMemo(() => {
    if (!open || !source || !draft) return null
    return buildRotatedSourceCanvas(source.bitmap, draft.rotation90, 1400)
  }, [open, source, draft?.rotation90])

  useEffect(() => {
    return () => {
      if (rotatedCanvas) {
        rotatedCanvas.width = 0
        rotatedCanvas.height = 0
      }
    }
  }, [rotatedCanvas])

  // 绘制主交互画布（原图 + 暗角遮罩 + 四点透视网格或裁剪框 + 精准放大镜）
  const drawEditor = useCallback(() => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage || !rotatedCanvas || !draft) return

    const dpr = window.devicePixelRatio || 1
    const cssW = Math.max(260, stage.clientWidth)
    const cssH = Math.max(260, stage.clientHeight)
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)

    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    const pad = 26
    const availW = Math.max(80, cssW - pad * 2)
    const availH = Math.max(80, cssH - pad * 2)
    const scale = Math.min(availW / rotatedCanvas.width, availH / rotatedCanvas.height)
    const drawW = rotatedCanvas.width * scale
    const drawH = rotatedCanvas.height * scale
    const ox = (cssW - drawW) / 2
    const oy = (cssH - drawH) / 2
    imgBoxRef.current = { x: ox, y: oy, w: drawW, h: drawH }

    // 1. 绘制源图（常规模式下按 fineAngle 旋转预览）
    ctx.save()
    if (draft.mode === 'rect' && Math.abs(draft.fineAngle) > 0.01) {
      const rcx = ox + (draft.rect.x + draft.rect.w / 2) * drawW
      const rcy = oy + (draft.rect.y + draft.rect.h / 2) * drawH
      ctx.translate(rcx, rcy)
      ctx.rotate((draft.fineAngle * Math.PI) / 180)
      ctx.drawImage(rotatedCanvas, ox - rcx, oy - rcy, drawW, drawH)
    } else {
      ctx.drawImage(rotatedCanvas, ox, oy, drawW, drawH)
    }
    ctx.restore()

    if (draft.mode === 'perspective') {
      const pts = draft.quad.map((p) => ({ x: ox + p.x * drawW, y: oy + p.y * drawH }))

      // 2. 外部半透明遮罩（evenodd 挖空四边形）
      ctx.save()
      ctx.fillStyle = 'rgba(9, 13, 24, 0.56)'
      ctx.beginPath()
      ctx.rect(0, 0, cssW, cssH)
      ctx.moveTo(pts[0].x, pts[0].y)
      ctx.lineTo(pts[1].x, pts[1].y)
      ctx.lineTo(pts[2].x, pts[2].y)
      ctx.lineTo(pts[3].x, pts[3].y)
      ctx.closePath()
      ctx.fill('evenodd')
      ctx.restore()

      // 3. 四边形内 3×3 透视辅助对齐网格（双线性插值）
      ctx.save()
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
      ctx.lineWidth = 1
      const lerpPt = (a: Point2D, b: Point2D, t: number): Point2D => ({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      })
      for (const t of [1 / 3, 2 / 3]) {
        const top = lerpPt(pts[0], pts[1], t)
        const bot = lerpPt(pts[3], pts[2], t)
        ctx.beginPath()
        ctx.moveTo(top.x, top.y)
        ctx.lineTo(bot.x, bot.y)
        ctx.stroke()

        const left = lerpPt(pts[0], pts[3], t)
        const right = lerpPt(pts[1], pts[2], t)
        ctx.beginPath()
        ctx.moveTo(left.x, left.y)
        ctx.lineTo(right.x, right.y)
        ctx.stroke()
      }

      // 4. 发光外框线
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 2.2
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      ctx.lineTo(pts[1].x, pts[1].y)
      ctx.lineTo(pts[2].x, pts[2].y)
      ctx.lineTo(pts[3].x, pts[3].y)
      ctx.closePath()
      ctx.stroke()
      ctx.restore()

      // 5. 四个可拖拽角点手柄
      pts.forEach((p, idx) => {
        const isActive = activeCorner === idx
        ctx.save()
        ctx.beginPath()
        ctx.arc(p.x, p.y, isActive ? 13 : 10, 0, Math.PI * 2)
        ctx.fillStyle = isActive ? '#0ea5e9' : '#ffffff'
        ctx.shadowColor = 'rgba(0,0,0,0.35)'
        ctx.shadowBlur = 8
        ctx.fill()
        ctx.lineWidth = 2.5
        ctx.strokeStyle = isActive ? '#ffffff' : '#0ea5e9'
        ctx.stroke()

        // 中心十字靶点
        ctx.shadowBlur = 0
        ctx.fillStyle = isActive ? '#ffffff' : '#0284c7'
        ctx.beginPath()
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2)
        ctx.fill()

        // 角点标签
        ctx.font = '600 10px "PingFang SC", sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const labelY = idx < 2 ? p.y - 20 : p.y + 20
        ctx.fillStyle = 'rgba(15, 23, 42, 0.78)'
        ctx.beginPath()
        ctx.roundRect(p.x - 16, labelY - 8, 32, 16, 4)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.fillText(CORNER_LABELS[idx], p.x, labelY)
        ctx.restore()
      })
    } else {
      // 常规锁定比例矩形裁剪框
      const rx = ox + draft.rect.x * drawW
      const ry = oy + draft.rect.y * drawH
      const rw = draft.rect.w * drawW
      const rh = draft.rect.h * drawH

      ctx.save()
      ctx.fillStyle = 'rgba(9, 13, 24, 0.56)'
      ctx.beginPath()
      ctx.rect(0, 0, cssW, cssH)
      ctx.rect(rx, ry, rw, rh)
      ctx.fill('evenodd')

      // 三分辅助线
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
      ctx.lineWidth = 1
      for (const t of [1 / 3, 2 / 3]) {
        ctx.beginPath()
        ctx.moveTo(rx + rw * t, ry)
        ctx.lineTo(rx + rw * t, ry + rh)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(rx, ry + rh * t)
        ctx.lineTo(rx + rw, ry + rh * t)
        ctx.stroke()
      }

      // 边框
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 2
      ctx.strokeRect(rx, ry, rw, rh)

      // 4 个 L 形转角手柄
      const corners = [
        { x: rx, y: ry },
        { x: rx + rw, y: ry },
        { x: rx + rw, y: ry + rh },
        { x: rx, y: ry + rh },
      ]
      corners.forEach((c) => {
        ctx.beginPath()
        ctx.arc(c.x, c.y, 8, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.shadowColor = 'rgba(0,0,0,0.35)'
        ctx.shadowBlur = 6
        ctx.fill()
        ctx.lineWidth = 2.5
        ctx.strokeStyle = '#0ea5e9'
        ctx.stroke()
      })
      ctx.restore()
    }

    // 6. 拖拽时自动显示 3× 精准十字放大镜（避免手指/鼠标挡住身份证边角）
    if (loupePos) {
      const loupeR = 54
      const lx = loupePos.x < 0.5 ? cssW - loupeR - 18 : loupeR + 18
      const ly = loupePos.y < 0.5 ? cssH - loupeR - 18 : loupeR + 18
      const srcX = loupePos.x * rotatedCanvas.width
      const srcY = loupePos.y * rotatedCanvas.height
      const zoom = 2.8
      const sampleR = loupeR / (scale * zoom)

      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.4)'
      ctx.shadowBlur = 16
      ctx.beginPath()
      ctx.arc(lx, ly, loupeR, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.restore()

      ctx.save()
      ctx.beginPath()
      ctx.arc(lx, ly, loupeR, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(
        rotatedCanvas,
        srcX - sampleR,
        srcY - sampleR,
        sampleR * 2,
        sampleR * 2,
        lx - loupeR,
        ly - loupeR,
        loupeR * 2,
        loupeR * 2,
      )
      // 十字准星
      ctx.strokeStyle = 'rgba(14, 165, 233, 0.9)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(lx - 14, ly)
      ctx.lineTo(lx + 14, ly)
      ctx.moveTo(lx, ly - 14)
      ctx.lineTo(lx, ly + 14)
      ctx.stroke()
      ctx.restore()

      ctx.save()
      ctx.beginPath()
      ctx.arc(lx, ly, loupeR, 0, Math.PI * 2)
      ctx.lineWidth = 3
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()
      ctx.restore()
    }
  }, [rotatedCanvas, draft, activeCorner, loupePos])

  useEffect(() => {
    drawEditor()
  }, [drawEditor])

  useEffect(() => {
    if (!open) return
    const stage = stageRef.current
    if (!stage) return
    const ro = new ResizeObserver(() => drawEditor())
    ro.observe(stage)
    return () => ro.disconnect()
  }, [open, drawEditor])

  // 实时更新右下角/底部成片缩略预览（含透视拉直与当前滤镜效果）
  useEffect(() => {
    const mini = miniPreviewRef.current
    if (!open || !source || !draft || !mini) return
    const raf = requestAnimationFrame(() => {
      const previewW = 360
      const previewH = Math.max(120, Math.round(previewW / targetAspect))
      const fakeSource: CardSource = { ...source, edit: draft }
      const rendered = renderProcessedCard(fakeSource, printOpts, previewW, previewH, {
        maxSourceSide: 900,
      })
      mini.width = previewW
      mini.height = previewH
      const ctx = mini.getContext('2d')!
      ctx.clearRect(0, 0, previewW, previewH)
      ctx.drawImage(rendered, 0, 0)
      rendered.width = 0
      rendered.height = 0
    })
    return () => cancelAnimationFrame(raf)
  }, [open, source, draft, targetAspect, printOpts])

  // ESC 关闭弹窗
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  const clientToNorm = (clientX: number, clientY: number): Point2D => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    const box = imgBoxRef.current
    return {
      x: clamp((px - box.x) / Math.max(1, box.w), 0, 1),
      y: clamp((py - box.y) / Math.max(1, box.h), 0, 1),
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draft) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const box = imgBoxRef.current

    if (draft.mode === 'perspective') {
      let bestIdx = -1
      let bestDist = 28
      draft.quad.forEach((p, idx) => {
        const cx = box.x + p.x * box.w
        const cy = box.y + p.y * box.h
        const d = Math.hypot(px - cx, py - cy)
        if (d < bestDist) {
          bestDist = d
          bestIdx = idx
        }
      })
      if (bestIdx !== -1) {
        e.currentTarget.setPointerCapture(e.pointerId)
        dragRef.current = { type: 'quad', index: bestIdx }
        setActiveCorner(bestIdx)
        setLoupePos(draft.quad[bestIdx])
      }
      return
    }

    // 矩形模式命中检测：先检测 4 个角点，再检测框内拖拽
    const rx = box.x + draft.rect.x * box.w
    const ry = box.y + draft.rect.y * box.h
    const rw = draft.rect.w * box.w
    const rh = draft.rect.h * box.h

    const handles: { kind: RectDragKind; x: number; y: number }[] = [
      { kind: 'tl', x: rx, y: ry },
      { kind: 'tr', x: rx + rw, y: ry },
      { kind: 'br', x: rx + rw, y: ry + rh },
      { kind: 'bl', x: rx, y: ry + rh },
    ]
    for (const h of handles) {
      if (Math.hypot(px - h.x, py - h.y) <= 22) {
        e.currentTarget.setPointerCapture(e.pointerId)
        dragRef.current = {
          type: 'rect',
          kind: h.kind,
          startPt: clientToNorm(e.clientX, e.clientY),
          startRect: { ...draft.rect },
        }
        setLoupePos({
          x: (h.x - box.x) / Math.max(1, box.w),
          y: (h.y - box.y) / Math.max(1, box.h),
        })
        return
      }
    }

    if (px >= rx && px <= rx + rw && py >= ry && py <= ry + rh) {
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = {
        type: 'rect',
        kind: 'move',
        startPt: clientToNorm(e.clientX, e.clientY),
        startRect: { ...draft.rect },
      }
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag || !draft || !rotatedCanvas) return
    const pt = clientToNorm(e.clientX, e.clientY)

    if (drag.type === 'quad') {
      setDraft((prev) => {
        if (!prev) return prev
        const nextQuad: [Point2D, Point2D, Point2D, Point2D] = [
          { ...prev.quad[0] },
          { ...prev.quad[1] },
          { ...prev.quad[2] },
          { ...prev.quad[3] },
        ]
        nextQuad[drag.index] = pt
        return { ...prev, quad: nextQuad }
      })
      setLoupePos(pt)
      return
    }

    // 矩形锁定比例移动 / 缩放
    const srcAspect = rotatedCanvas.width / Math.max(1, rotatedCanvas.height)
    // 归一化坐标系下的宽高比：w / h = targetAspect / srcAspect
    const normAspect = targetAspect / srcAspect
    const sr = drag.startRect

    if (drag.kind === 'move') {
      const dx = pt.x - drag.startPt.x
      const dy = pt.y - drag.startPt.y
      const nx = clamp(sr.x + dx, 0, 1 - sr.w)
      const ny = clamp(sr.y + dy, 0, 1 - sr.h)
      setDraft((prev) => (prev ? { ...prev, rect: { ...prev.rect, x: nx, y: ny } } : prev))
      return
    }

    // 固定对角锚点按目标比例等比缩放
    const anchorX = drag.kind === 'tl' || drag.kind === 'bl' ? sr.x + sr.w : sr.x
    const anchorY = drag.kind === 'tl' || drag.kind === 'tr' ? sr.y + sr.h : sr.y
    const signX = drag.kind === 'tl' || drag.kind === 'bl' ? -1 : 1
    const signY = drag.kind === 'tl' || drag.kind === 'tr' ? -1 : 1

    const maxW = signX < 0 ? anchorX : 1 - anchorX
    const maxH = signY < 0 ? anchorY : 1 - anchorY
    const rawW = Math.max(0.08, (pt.x - anchorX) * signX)
    const rawH = Math.max(0.08, (pt.y - anchorY) * signY)

    let nextW = Math.min(rawW, maxW)
    let nextH = nextW / normAspect
    if (nextH > maxH) {
      nextH = maxH
      nextW = nextH * normAspect
    }
    if (Math.abs(rawH * normAspect - rawW) > 0.05 && rawH * normAspect < nextW) {
      nextH = Math.min(Math.max(0.08, rawH), maxH)
      nextW = nextH * normAspect
      if (nextW > maxW) {
        nextW = maxW
        nextH = nextW / normAspect
      }
    }

    const nx = signX < 0 ? anchorX - nextW : anchorX
    const ny = signY < 0 ? anchorY - nextH : anchorY
    setDraft((prev) => (prev ? { ...prev, rect: { x: nx, y: ny, w: nextW, h: nextH } } : prev))
    setLoupePos({ x: signX < 0 ? nx : nx + nextW, y: signY < 0 ? ny : ny + nextH })
  }

  const handlePointerUp = () => {
    dragRef.current = null
    setActiveCorner(null)
    setLoupePos(null)
  }

  const rotateBy = (delta: 90 | -90) => {
    if (!source || !draft) return
    const nextRot = (((draft.rotation90 + delta) % 360) + 360) % 360 as 0 | 90 | 180 | 270
    const reset = createDefaultCardEdit(source.width, source.height, targetAspect, nextRot)
    setDraft({ ...reset, mode: draft.mode })
  }

  const resetSelection = () => {
    if (!source || !draft) return
    const reset = createDefaultCardEdit(source.width, source.height, targetAspect, draft.rotation90)
    setDraft({ ...reset, mode: draft.mode })
  }

  const switchMode = (nextMode: CropMode) => {
    if (!draft || !rotatedCanvas) return
    if (nextMode === draft.mode) return
    if (nextMode === 'perspective') {
      // 从当前矩形框平滑初始化四个角点
      const r = draft.rect
      setDraft({
        ...draft,
        mode: 'perspective',
        quad: [
          { x: r.x, y: r.y },
          { x: r.x + r.w, y: r.y },
          { x: r.x + r.w, y: r.y + r.h },
          { x: r.x, y: r.y + r.h },
        ],
      })
    } else {
      const rect = computeCenteredRect(rotatedCanvas.width, rotatedCanvas.height, targetAspect)
      setDraft({ ...draft, mode: 'rect', rect })
    }
  }

  return (
    <AnimatePresence>
      {open && source && draft && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6"
          onClick={onCancel}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-card-solid flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border shadow-2xl"
          >
            {/* 顶栏 */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2.5">
                <span className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg">
                  {draft.mode === 'perspective' ? <Scan className="size-4" /> : <Crop className="size-4" />}
                </span>
                <div>
                  <div className="text-sm font-semibold">{title} · 裁切与纠偏</div>
                  <div className="text-muted-foreground text-xs">
                    {draft.mode === 'perspective'
                      ? '拖动 4 个蓝色顶点对准证件四角，松手即自动透视拉平（拖动时自动弹出 3× 放大镜）'
                      : '拖移或缩放裁剪框（已锁定国标证件比例），可配合下方角度滑块精细摆正'}
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={onCancel} aria-label="关闭">
                <X className="size-4" />
              </Button>
            </div>

            {/* 主编辑区：左侧交互画布 + 右侧参数与拉直成片预览 */}
            <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_270px]">
              <div
                ref={stageRef}
                className="relative min-h-[340px] flex-1 bg-slate-950/95 sm:min-h-[440px]"
              >
                <canvas
                  ref={canvasRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  className="block h-full w-full touch-none select-none"
                  style={{ cursor: draft.mode === 'perspective' ? 'crosshair' : 'move' }}
                />
              </div>

              {/* 右侧工具与成片预览 */}
              <div className="flex flex-col justify-between gap-4 overflow-y-auto border-t p-4 lg:border-t-0 lg:border-l">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="text-muted-foreground text-xs font-medium">裁切模式</div>
                    <Segmented
                      value={draft.mode}
                      onChange={switchMode}
                      options={[
                        { value: 'rect', label: '比例裁剪' },
                        { value: 'perspective', label: '四点拉直' },
                      ]}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-muted-foreground text-xs font-medium">快速旋转</div>
                    <div className="grid grid-cols-3 gap-2">
                      <Button variant="outline" size="sm" onClick={() => rotateBy(-90)}>
                        <RotateCcw className="size-3.5" />
                        左转
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => rotateBy(90)}>
                        <RotateCw className="size-3.5" />
                        右转
                      </Button>
                      <Button variant="outline" size="sm" onClick={resetSelection}>
                        重置
                      </Button>
                    </div>
                  </div>

                  {draft.mode === 'rect' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground font-medium">微调摆正</span>
                        <span className="font-mono">{draft.fineAngle.toFixed(1)}°</span>
                      </div>
                      <Slider
                        value={draft.fineAngle}
                        min={-15}
                        max={15}
                        step={0.5}
                        onChange={(v) => setDraft((prev) => (prev ? { ...prev, fineAngle: v } : prev))}
                      />
                    </div>
                  )}

                  {draft.mode === 'perspective' && (
                    <div className="bg-primary/5 border-primary/20 text-muted-foreground rounded-xl border p-3 text-xs leading-relaxed">
                      <div className="text-foreground mb-1 flex items-center gap-1.5 font-medium">
                        <Sparkles className="text-primary size-3.5" />
                        拍歪也能一键拉平
                      </div>
                      只需把四个蓝点分别拖到身份证的四个角上，系统会自动消除倾斜与梯形透视变形。
                    </div>
                  )}

                  {/* 实时拉直成片小窗 */}
                  <div className="space-y-1.5">
                    <div className="text-muted-foreground text-xs font-medium">实时成片效果</div>
                    <div className="bg-muted/40 flex items-center justify-center rounded-xl border p-2.5">
                      <canvas
                        ref={miniPreviewRef}
                        className="max-h-36 w-full rounded-md object-contain shadow-sm"
                      />
                    </div>
                  </div>
                </div>

                {/* 底部确认按钮 */}
                <div className="flex gap-2 border-t pt-3">
                  <Button variant="outline" className="flex-1" onClick={onCancel}>
                    取消
                  </Button>
                  <Button variant="primary" className="flex-1" onClick={() => onApply(draft)}>
                    <Check className="size-4" />
                    应用裁切
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
