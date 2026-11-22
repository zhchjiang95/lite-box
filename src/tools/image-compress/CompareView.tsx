import { AnimatePresence, motion } from 'motion/react'
import { Loader2, MoveHorizontal, RotateCcw, ZoomIn } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn, formatBytes } from '@/lib/utils'
import { mimeLabel, savedPercent, type CompressItem } from './types'

interface CompareViewProps {
  item: CompressItem
}

const ZOOM_LEVELS = [1, 2, 4] as const

/** Before / After 交互式画质对比视口：支持拖拽分割线、触控手势、键盘微调与 1x/2x/4x 放大细节对比 */
export function CompareView({ item }: CompareViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  /** 分割线位置（0 - 100 百分比） */
  const [pos, setPos] = useState(50)
  const [zoom, setZoom] = useState<(typeof ZOOM_LEVELS)[number]>(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [draggingDivider, setDraggingDivider] = useState(false)
  const [panning, setPanning] = useState(false)
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 })

  // 切换对比图片时重置缩放与平移
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [item.id])

  const updatePosFromClientX = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const pct = ((clientX - rect.left) / rect.width) * 100
    setPos(Math.max(0, Math.min(100, pct)))
  }

  // 分割线抓手拖拽
  const onDividerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDraggingDivider(true)
    updatePosFromClientX(e.clientX)
  }
  const onDividerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingDivider) return
    updatePosFromClientX(e.clientX)
  }
  const onDividerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingDivider) return
    setDraggingDivider(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  // 画布区域交互：1x 时点击/拖拽直接移动对比线；放大时拖拽平移查看局部细节
  const onStageDown = (e: PointerEvent<HTMLDivElement>) => {
    if (zoom > 1) {
      e.currentTarget.setPointerCapture(e.pointerId)
      setPanning(true)
      panStart.current = { x: e.clientX, y: e.clientY, ox: pan.x, oy: pan.y }
    } else {
      e.currentTarget.setPointerCapture(e.pointerId)
      setDraggingDivider(true)
      updatePosFromClientX(e.clientX)
    }
  }
  const onStageMove = (e: PointerEvent<HTMLDivElement>) => {
    if (panning) {
      setPan({
        x: panStart.current.ox + (e.clientX - panStart.current.x),
        y: panStart.current.oy + (e.clientY - panStart.current.y),
      })
    } else if (draggingDivider) {
      updatePosFromClientX(e.clientX)
    }
  }
  const onStageUp = (e: PointerEvent<HTMLDivElement>) => {
    if (panning) setPanning(false)
    if (draggingDivider) setDraggingDivider(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  // 键盘微调分割线
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setPos((p) => Math.max(0, p - (e.shiftKey ? 10 : 2)))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      setPos((p) => Math.min(100, p + (e.shiftKey ? 10 : 2)))
    }
  }

  const handleZoom = (z: (typeof ZOOM_LEVELS)[number]) => {
    setZoom(z)
    if (z === 1) setPan({ x: 0, y: 0 })
  }

  const res = item.result
  const pct = res ? savedPercent(item.file.size, res.blob.size) : 0
  const busy = item.status === 'pending' || item.status === 'processing'
  const imgTransform =
    zoom > 1 ? `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` : 'translate3d(0, 0, 0) scale(1)'

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        onPointerDown={onStageDown}
        onPointerMove={onStageMove}
        onPointerUp={onStageUp}
        onPointerCancel={onStageUp}
        className={cn(
          'checkerboard shadow-soft relative h-[min(56dvh,560px)] min-h-[300px] w-full overflow-hidden rounded-3xl border select-none touch-none',
          zoom > 1 ? (panning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-ew-resize',
        )}
      >
        {/* 底层：压缩后图片（右侧可见） */}
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 sm:p-6"
          style={{
            transform: imgTransform,
            transition: panning ? 'none' : 'transform 220ms cubic-bezier(.2,.8,.2,1)',
          }}
        >
          <img
            src={item.compressedUrl || item.originalUrl}
            alt="压缩后"
            draggable={false}
            className="max-h-full max-w-full rounded-sm object-contain shadow-md"
          />
        </div>

        {/* 上层：原图（左侧可见，通过 clip-path 裁剪，杜绝错位变形） */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        >
          <div
            className="flex h-full w-full items-center justify-center p-4 sm:p-6"
            style={{
              transform: imgTransform,
              transition: panning ? 'none' : 'transform 220ms cubic-bezier(.2,.8,.2,1)',
            }}
          >
            <img
              src={item.originalUrl}
              alt="原图"
              draggable={false}
              className="max-h-full max-w-full rounded-sm object-contain shadow-md"
            />
          </div>
        </div>

        {/* 分割线与可拖拽手柄 */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="原图与压缩后对比滑块"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          onKeyDown={onKeyDown}
          onPointerDown={onDividerDown}
          onPointerMove={onDividerMove}
          onPointerUp={onDividerUp}
          onPointerCancel={onDividerUp}
          style={{ left: `${pos}%` }}
          className="group focus-visible:outline-none absolute inset-y-0 z-10 -ml-5 flex w-10 cursor-ew-resize items-center justify-center"
        >
          <span className="h-full w-0.5 bg-white shadow-[0_0_12px_rgb(0_0_0/0.55)]" />
          <span
            className={cn(
              'bg-card-solid text-foreground absolute flex size-10 items-center justify-center rounded-full border border-white/60 shadow-[0_6px_24px_rgb(0_0_0/0.32)] transition-transform',
              draggingDivider ? 'scale-110 ring-4 ring-[var(--primary)]/35' : 'group-hover:scale-105 group-focus-visible:ring-4 group-focus-visible:ring-[var(--primary)]/40',
            )}
          >
            <MoveHorizontal className="size-4" />
          </span>
        </div>

        {/* 左上角：原图信息胶囊 */}
        <div className="pointer-events-none absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-md">
          <span>原图</span>
          <span className="opacity-60">·</span>
          <span className="font-mono tabular-nums">{formatBytes(item.file.size)}</span>
          <span className="hidden opacity-75 sm:inline">({mimeLabel(item.file.type)})</span>
        </div>

        {/* 右上角：压缩后信息胶囊 */}
        <div className="pointer-events-none absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-md">
          <span>压缩后</span>
          {busy ? (
            <Loader2 className="size-3.5 animate-spin text-sky-300" />
          ) : res ? (
            <>
              <span className="opacity-60">·</span>
              <span className="font-mono tabular-nums">{formatBytes(res.blob.size)}</span>
              {res.keptOriginal ? (
                <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] text-white/90">已最优</span>
              ) : (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold',
                    pct > 0 ? 'bg-emerald-500/85 text-white' : 'bg-amber-500/85 text-white',
                  )}
                >
                  {pct > 0 ? `-${pct}%` : `+${Math.abs(pct)}%`}
                </span>
              )}
            </>
          ) : (
            <span className="text-red-300">失败</span>
          )}
        </div>

        {/* 底部居中悬浮控制条：快捷位置 + 放大倍镜 */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="glass shadow-lift absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full p-1 text-xs"
        >
          <button
            type="button"
            onClick={() => setPos(100)}
            className={cn(
              'rounded-full px-2.5 py-1 font-medium transition-colors',
              pos >= 98 ? 'bg-primary text-primary-foreground' : 'text-foreground/75 hover:bg-foreground/10',
            )}
          >
            仅原图
          </button>
          <button
            type="button"
            onClick={() => setPos(50)}
            className={cn(
              'rounded-full px-2.5 py-1 font-medium transition-colors',
              pos > 40 && pos < 60 ? 'bg-primary text-primary-foreground' : 'text-foreground/75 hover:bg-foreground/10',
            )}
          >
            对比
          </button>
          <button
            type="button"
            onClick={() => setPos(0)}
            className={cn(
              'rounded-full px-2.5 py-1 font-medium transition-colors',
              pos <= 2 ? 'bg-primary text-primary-foreground' : 'text-foreground/75 hover:bg-foreground/10',
            )}
          >
            仅压缩
          </button>

          <span className="bg-border mx-1 h-4 w-px" />

          <ZoomIn className="text-muted-foreground ml-1 hidden size-3.5 sm:block" />
          {ZOOM_LEVELS.map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => handleZoom(z)}
              className={cn(
                'rounded-full px-2 py-1 font-mono font-medium transition-colors',
                zoom === z ? 'bg-foreground text-background' : 'text-foreground/75 hover:bg-foreground/10',
              )}
            >
              {z}x
            </button>
          ))}

          {(zoom > 1 || pan.x !== 0 || pan.y !== 0) && (
            <button
              type="button"
              onClick={() => {
                setZoom(1)
                setPan({ x: 0, y: 0 })
              }}
              aria-label="重置视图"
              className="text-foreground/75 hover:bg-foreground/10 flex size-6 items-center justify-center rounded-full transition-colors"
            >
              <RotateCcw className="size-3.5" />
            </button>
          )}
        </div>

        {/* 压缩中轻提示 */}
        <AnimatePresence>
          {busy && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/15 backdrop-blur-[1px]"
            >
              <div className="glass shadow-lift flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium">
                <Loader2 className="text-primary size-4 animate-spin" />
                正在本地压缩…
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
