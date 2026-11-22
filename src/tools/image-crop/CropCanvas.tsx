import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '@/lib/utils'
import { getRotatedBounds, renderTransformedPreview } from './engine'
import type { NormalizedCrop, TransformState } from './types'

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se' | 'create'

interface CropCanvasProps {
  bitmap: ImageBitmap
  transform: TransformState
  crop: NormalizedCrop
  onCropChange: (next: NormalizedCrop) => void
  /** 锁定的宽高比（像素空间 W/H），null 表示自由比例 */
  aspectRatio: number | null
  /** 是否显示圆形裁剪参考线 */
  circleMask: boolean
}

const MIN_NORM = 0.04

/** 专业交互式图片裁剪画布：8 方向手柄拖拽、框内移动、锁比例约束、三分线与圆形参考线 */
export function CropCanvas({
  bitmap,
  transform,
  crop,
  onCropChange,
  aspectRatio,
  circleMask,
}: CropCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<Handle | null>(null)
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 })

  const totalDeg = transform.baseRotate + transform.fineRotate
  const bounds = getRotatedBounds(bitmap.width, bitmap.height, totalDeg)
  const stageRatio = bounds.width / bounds.height

  // 监听外层视口尺寸，确保任意纵横比与旋转角度下舞台都精准居中适配
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => {
      const style = getComputedStyle(el)
      const px = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      const py = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      setBoxSize({ w: Math.max(0, el.clientWidth - px), h: Math.max(0, el.clientHeight - py) })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fitScale = boxSize.w > 0 && boxSize.h > 0 ? Math.min(boxSize.w / bounds.width, boxSize.h / bounds.height) : 0
  const stageW = fitScale > 0 ? Math.max(40, Math.floor(bounds.width * fitScale)) : undefined
  const stageH = fitScale > 0 ? Math.max(40, Math.floor(bounds.height * fitScale)) : undefined

  // 渲染实时旋转/翻转预览
  useEffect(() => {
    if (!canvasRef.current) return
    const raf = requestAnimationFrame(() => {
      if (canvasRef.current) renderTransformedPreview(canvasRef.current, bitmap, transform)
    })
    return () => cancelAnimationFrame(raf)
  }, [bitmap, transform])

  // 拖拽初始快照
  const dragRef = useRef<{
    handle: Handle
    startX: number
    startY: number
    startCrop: NormalizedCrop
    stageRect: DOMRect
    anchorX: number
    anchorY: number
  } | null>(null)

  const startDrag = (handle: Handle, e: PointerEvent<HTMLElement>) => {
    e.stopPropagation()
    const stageRect = stageRef.current?.getBoundingClientRect()
    if (!stageRect || stageRect.width === 0 || stageRect.height === 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(handle)
    const anchorX = Math.max(0, Math.min(1, (e.clientX - stageRect.left) / stageRect.width))
    const anchorY = Math.max(0, Math.min(1, (e.clientY - stageRect.top) / stageRect.height))
    dragRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startCrop: { ...crop },
      stageRect,
      anchorX,
      anchorY,
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = dragRef.current
    if (!d) return
    const dx = (e.clientX - d.startX) / d.stageRect.width
    const dy = (e.clientY - d.startY) / d.stageRect.height
    const s = d.startCrop

    // 1. 整体平移裁剪框
    if (d.handle === 'move') {
      const nx = Math.max(0, Math.min(1 - s.w, s.x + dx))
      const ny = Math.max(0, Math.min(1 - s.h, s.y + dy))
      onCropChange({ x: nx, y: ny, w: s.w, h: s.h })
      return
    }

    // 2. 在空白遮罩处拖出新的裁剪框
    if (d.handle === 'create') {
      const curX = Math.max(0, Math.min(1, (e.clientX - d.stageRect.left) / d.stageRect.width))
      const curY = Math.max(0, Math.min(1, (e.clientY - d.stageRect.top) / d.stageRect.height))
      const dirX = curX >= d.anchorX ? 1 : -1
      const dirY = curY >= d.anchorY ? 1 : -1
      let w = Math.max(MIN_NORM, Math.abs(curX - d.anchorX))
      let h = Math.max(MIN_NORM, Math.abs(curY - d.anchorY))
      if (aspectRatio) {
        const normRatio = aspectRatio / stageRatio
        h = w / normRatio
        const maxH = dirY > 0 ? 1 - d.anchorY : d.anchorY
        const maxW = dirX > 0 ? 1 - d.anchorX : d.anchorX
        if (h > maxH) {
          h = maxH
          w = h * normRatio
        }
        if (w > maxW) {
          w = maxW
          h = w / normRatio
        }
      }
      const x = dirX > 0 ? d.anchorX : Math.max(0, d.anchorX - w)
      const y = dirY > 0 ? d.anchorY : Math.max(0, d.anchorY - h)
      onCropChange({ x, y, w: Math.min(1 - x, w), h: Math.min(1 - y, h) })
      return
    }

    // 3. 自由比例调整 8 方向边界
    if (!aspectRatio) {
      let left = s.x
      let right = s.x + s.w
      let top = s.y
      let bottom = s.y + s.h

      if (d.handle.includes('w')) left = Math.max(0, Math.min(right - MIN_NORM, s.x + dx))
      if (d.handle.includes('e')) right = Math.min(1, Math.max(left + MIN_NORM, s.x + s.w + dx))
      if (d.handle.includes('n')) top = Math.max(0, Math.min(bottom - MIN_NORM, s.y + dy))
      if (d.handle.includes('s')) bottom = Math.min(1, Math.max(top + MIN_NORM, s.y + s.h + dy))

      onCropChange({ x: left, y: top, w: right - left, h: bottom - top })
      return
    }

    // 4. 锁定宽高比调整（归一化空间宽/高 = aspectRatio / stageRatio）
    const normRatio = aspectRatio / stageRatio
    const minW = Math.max(MIN_NORM, MIN_NORM * normRatio)
    const minH = minW / normRatio

    // 确定不动锚点
    const right0 = s.x + s.w
    const bottom0 = s.y + s.h
    let w = s.w
    let h = s.h

    if (d.handle === 'e' || d.handle === 'w') {
      const maxW = d.handle === 'e' ? 1 - s.x : right0
      const rawW = d.handle === 'e' ? s.w + dx : s.w - dx
      w = Math.max(minW, Math.min(maxW, rawW))
      h = w / normRatio
      // 上下居中延展并约束在 [0, 1]
      const cy = s.y + s.h / 2
      const maxHalfH = Math.min(cy, 1 - cy)
      if (h > maxHalfH * 2) {
        h = Math.max(minH, Math.min(1, h))
        w = h * normRatio
      }
      const x = d.handle === 'e' ? s.x : right0 - w
      const y = Math.max(0, Math.min(1 - h, cy - h / 2))
      onCropChange({ x, y, w, h })
      return
    }

    if (d.handle === 'n' || d.handle === 's') {
      const maxH = d.handle === 's' ? 1 - s.y : bottom0
      const rawH = d.handle === 's' ? s.h + dy : s.h - dy
      h = Math.max(minH, Math.min(maxH, rawH))
      w = h * normRatio
      const cx = s.x + s.w / 2
      if (w > 1) {
        w = 1
        h = w / normRatio
      }
      const x = Math.max(0, Math.min(1 - w, cx - w / 2))
      const y = d.handle === 's' ? s.y : bottom0 - h
      onCropChange({ x, y, w, h })
      return
    }

    // 四个角：固定对角点，等比缩放
    const anchorRight = d.handle.includes('w')
    const anchorBottom = d.handle.includes('n')
    const maxW = anchorRight ? right0 : 1 - s.x
    const maxH = anchorBottom ? bottom0 : 1 - s.y

    const candW = anchorRight ? s.w - dx : s.w + dx
    const candH = anchorBottom ? s.h - dy : s.h + dy
    // 取变化幅度更大的轴作为主导轴，拖动体验最自然
    if (Math.abs(dx) >= Math.abs(dy)) {
      w = Math.max(minW, Math.min(maxW, candW))
      h = w / normRatio
    } else {
      h = Math.max(minH, Math.min(maxH, candH))
      w = h * normRatio
    }
    if (h > maxH) {
      h = maxH
      w = h * normRatio
    }
    if (w > maxW) {
      w = maxW
      h = w / normRatio
    }
    const x = anchorRight ? right0 - w : s.x
    const y = anchorBottom ? bottom0 - h : s.y
    onCropChange({ x, y, w, h })
  }

  const endDrag = (e: PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  // 键盘微调裁剪框位置
  const onCropKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.04 : 0.008
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      onCropChange({ ...crop, x: Math.max(0, crop.x - step) })
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      onCropChange({ ...crop, x: Math.min(1 - crop.w, crop.x + step) })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      onCropChange({ ...crop, y: Math.max(0, crop.y - step) })
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      onCropChange({ ...crop, y: Math.min(1 - crop.h, crop.y + step) })
    }
  }

  const cropPxW = Math.max(1, Math.round(crop.w * bounds.width))
  const cropPxH = Math.max(1, Math.round(crop.h * bounds.height))

  const corners: { id: Handle; cls: string; cursor: string }[] = [
    { id: 'nw', cls: '-top-2 -left-2', cursor: 'cursor-nwse-resize' },
    { id: 'ne', cls: '-top-2 -right-2', cursor: 'cursor-nesw-resize' },
    { id: 'sw', cls: '-bottom-2 -left-2', cursor: 'cursor-nesw-resize' },
    { id: 'se', cls: '-bottom-2 -right-2', cursor: 'cursor-nwse-resize' },
  ]

  const edges: { id: Handle; cls: string; bar: string; cursor: string }[] = [
    { id: 'n', cls: '-top-2 inset-x-3 h-4', bar: 'h-1 w-8 rounded-full', cursor: 'cursor-ns-resize' },
    { id: 's', cls: '-bottom-2 inset-x-3 h-4', bar: 'h-1 w-8 rounded-full', cursor: 'cursor-ns-resize' },
    { id: 'w', cls: '-left-2 inset-y-3 w-4', bar: 'w-1 h-8 rounded-full', cursor: 'cursor-ew-resize' },
    { id: 'e', cls: '-right-2 inset-y-3 w-4', bar: 'w-1 h-8 rounded-full', cursor: 'cursor-ew-resize' },
  ]

  return (
    <div
      ref={wrapRef}
      className="checkerboard shadow-soft relative flex h-[min(64dvh,640px)] min-h-[320px] w-full items-center justify-center overflow-hidden rounded-3xl border p-4 select-none sm:p-6"
    >
      {/* 精准包裹预览画布的舞台，所有归一化坐标相对它定位 */}
      <div
        ref={stageRef}
        onPointerDown={(e) => startDrag('create', e)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative cursor-crosshair touch-none shadow-2xl"
        style={stageW && stageH ? { width: stageW, height: stageH } : { aspectRatio: `${bounds.width} / ${bounds.height}` }}
      >
        <canvas ref={canvasRef} className="block h-full w-full" />

        {/* 裁剪框 + 四周暗色遮罩（使用大尺寸 box-shadow 形成无接缝精准挖空） */}
        <div
          role="region"
          aria-label="裁剪选区"
          tabIndex={0}
          onKeyDown={onCropKeyDown}
          onPointerDown={(e) => startDrag('move', e)}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{
            left: `${crop.x * 100}%`,
            top: `${crop.y * 100}%`,
            width: `${crop.w * 100}%`,
            height: `${crop.h * 100}%`,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.54)',
          }}
          className={cn(
            'absolute border border-white/90 outline-none focus-visible:border-[var(--primary)]',
            dragging === 'move' ? 'cursor-grabbing' : 'cursor-grab',
          )}
        >
          {/* 三分线网格辅助线 */}
          <div
            className={cn(
              'pointer-events-none absolute inset-0 transition-opacity duration-200',
              dragging ? 'opacity-85' : 'opacity-40',
            )}
          >
            <span className="absolute inset-y-0 left-1/3 w-px bg-white/70" />
            <span className="absolute inset-y-0 left-2/3 w-px bg-white/70" />
            <span className="absolute inset-x-0 top-1/3 h-px bg-white/70" />
            <span className="absolute inset-x-0 top-2/3 h-px bg-white/70" />
          </div>

          {/* 圆形头像参考线 */}
          {circleMask && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
              <div
                className="aspect-square rounded-full border-2 border-dashed border-white/95 shadow-[0_0_0_9999px_rgba(0,0,0,0.3)]"
                style={{ width: crop.w * bounds.width >= crop.h * bounds.height ? 'auto' : '100%', height: crop.w * bounds.width >= crop.h * bounds.height ? '100%' : 'auto' }}
              />
            </div>
          )}

          {/* 裁剪选区实时像素尺寸徽章 */}
          <div className="pointer-events-none absolute top-2 left-2 rounded-md bg-black/65 px-2 py-0.5 font-mono text-[11px] font-medium text-white backdrop-blur-sm">
            {cropPxW} × {cropPxH}
          </div>

          {/* 四边手柄 */}
          {edges.map((ed) => (
            <div
              key={ed.id}
              onPointerDown={(e) => startDrag(ed.id, e)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className={cn('absolute flex items-center justify-center touch-none', ed.cls, ed.cursor)}
            >
              <span className={cn('bg-white shadow-[0_1px_4px_rgb(0_0_0/0.6)]', ed.bar)} />
            </div>
          ))}

          {/* 四角手柄 */}
          {corners.map((co) => (
            <div
              key={co.id}
              onPointerDown={(e) => startDrag(co.id, e)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className={cn('absolute flex size-5 items-center justify-center touch-none', co.cls, co.cursor)}
            >
              <span className="size-3 rounded-full border-2 border-white bg-[var(--primary)] shadow-[0_2px_6px_rgb(0_0_0/0.55)]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
