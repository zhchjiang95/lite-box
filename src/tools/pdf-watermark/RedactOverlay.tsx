import { useCallback, useEffect, useRef, useState } from 'react'
import { Circle, CopyPlus, Layers, Square, Trash2 } from 'lucide-react'
import { cn, uid } from '@/lib/utils'
import { REDACT_COLOR_PRESETS, type RedactMark, type RedactShape, type RedactTool } from './types'

interface RedactOverlayProps {
  /** 当前展示页码（1-based） */
  page: number
  /** 当前文档全部页数 */
  totalPages: number
  /** 当前页可见的打码块（本页 + 应用全部页） */
  marks: RedactMark[]
  /** 当前绘图工具 */
  tool: RedactTool
  /** 新绘制色块的默认颜色 */
  drawColor: string
  /** 新绘制色块是否默认应用全页 */
  defaultAllPages: boolean
  /** 当前选中的色块 ID */
  selectedMarkId: string | null
  onSelectMark: (id: string | null) => void
  onAddMark: (mark: RedactMark) => void
  onUpdateMark: (id: string, patch: Partial<RedactMark>) => void
  onDeleteMark: (id: string) => void
}

type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se'

interface DragSession {
  kind: 'draw' | 'move' | 'resize'
  pointerId: number
  startX: number
  startY: number
  markId?: string
  handle?: ResizeHandle
  originRect?: { x: number; y: number; w: number; h: number }
}

const MIN_SIZE = 0.012
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/**
 * PDF 预览画布上的交互式打码遮挡层
 * - 支持按住拖拽绘制纯色矩形 / 圆形（按住 Shift 锁定正圆/正方形）
 * - 支持选中、自由拖动、四角手柄精准缩放、原地切换形状/颜色/全页生效与删除
 */
export function RedactOverlay({
  page,
  totalPages,
  marks,
  tool,
  drawColor,
  defaultAllPages,
  selectedMarkId,
  onSelectMark,
  onAddMark,
  onUpdateMark,
  onDeleteMark,
}: RedactOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragSession | null>(null)
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number; shape: RedactShape } | null>(null)

  /** 将指针客户端坐标换算为 [0..1] 归一化画布坐标 */
  const toNorm = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current
    if (!el) return { nx: 0, ny: 0, ratio: 1 }
    const rect = el.getBoundingClientRect()
    const nx = clamp01((clientX - rect.left) / Math.max(1, rect.width))
    const ny = clamp01((clientY - rect.top) / Math.max(1, rect.height))
    return { nx, ny, ratio: rect.width / Math.max(1, rect.height) }
  }, [])

  // 键盘 Delete/Backspace 删除选中色块，Esc 取消选中
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /INPUT|TEXTAREA/.test(target.tagName)) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedMarkId) {
        e.preventDefault()
        onDeleteMark(selectedMarkId)
      } else if (e.key === 'Escape' && selectedMarkId) {
        onSelectMark(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedMarkId, onDeleteMark, onSelectMark])

  /** 在画布空白处按下：绘制新遮挡块或取消选中 */
  const handleSurfacePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if (tool === 'select') {
      onSelectMark(null)
      return
    }
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const { nx, ny } = toNorm(e.clientX, e.clientY)
    onSelectMark(null)
    dragRef.current = {
      kind: 'draw',
      pointerId: e.pointerId,
      startX: nx,
      startY: ny,
    }
    setDraft({ x: nx, y: ny, w: 0, h: 0, shape: tool })
  }

  /** 在已有色块上按下：选中并启动拖动 */
  const handleMarkPointerDown = (e: React.PointerEvent<HTMLDivElement>, mark: RedactMark) => {
    if (e.button !== 0) return
    // 若当前处于绘制模式，仍允许点空白开画，但在选择模式下直接拖动已有色块
    if (tool !== 'select') return
    e.stopPropagation()
    e.preventDefault()
    containerRef.current?.setPointerCapture(e.pointerId)
    onSelectMark(mark.id)
    const { nx, ny } = toNorm(e.clientX, e.clientY)
    dragRef.current = {
      kind: 'move',
      pointerId: e.pointerId,
      startX: nx,
      startY: ny,
      markId: mark.id,
      originRect: { x: mark.x, y: mark.y, w: mark.w, h: mark.h },
    }
  }

  /** 在四角缩放手柄按下 */
  const handleResizePointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    mark: RedactMark,
    handle: ResizeHandle,
  ) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    containerRef.current?.setPointerCapture(e.pointerId)
    const { nx, ny } = toNorm(e.clientX, e.clientY)
    dragRef.current = {
      kind: 'resize',
      pointerId: e.pointerId,
      startX: nx,
      startY: ny,
      markId: mark.id,
      handle,
      originRect: { x: mark.x, y: mark.y, w: mark.w, h: mark.h },
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const sess = dragRef.current
    if (!sess || sess.pointerId !== e.pointerId) return
    const { nx, ny, ratio } = toNorm(e.clientX, e.clientY)

    if (sess.kind === 'draw') {
      let dx = nx - sess.startX
      let dy = ny - sess.startY
      // 按住 Shift 锁定正圆/正方形（考虑页面真实宽高比）
      if (e.shiftKey) {
        const pxDx = dx * ratio
        const pxDy = dy
        const side = Math.max(Math.abs(pxDx), Math.abs(pxDy))
        dx = (side / ratio) * (dx < 0 ? -1 : 1)
        dy = side * (dy < 0 ? -1 : 1)
      }
      const x1 = clamp01(sess.startX)
      const y1 = clamp01(sess.startY)
      const x2 = clamp01(sess.startX + dx)
      const y2 = clamp01(sess.startY + dy)
      setDraft({
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        w: Math.abs(x2 - x1),
        h: Math.abs(y2 - y1),
        shape: tool === 'ellipse' ? 'ellipse' : 'rect',
      })
      return
    }

    if (sess.kind === 'move' && sess.markId && sess.originRect) {
      const dx = nx - sess.startX
      const dy = ny - sess.startY
      const nextX = Math.max(0, Math.min(1 - sess.originRect.w, sess.originRect.x + dx))
      const nextY = Math.max(0, Math.min(1 - sess.originRect.h, sess.originRect.y + dy))
      onUpdateMark(sess.markId, { x: nextX, y: nextY })
      return
    }

    if (sess.kind === 'resize' && sess.markId && sess.originRect && sess.handle) {
      const o = sess.originRect
      let left = o.x
      let top = o.y
      let right = o.x + o.w
      let bottom = o.y + o.h

      if (sess.handle.includes('w')) left = Math.min(right - MIN_SIZE, clamp01(nx))
      if (sess.handle.includes('e')) right = Math.max(left + MIN_SIZE, clamp01(nx))
      if (sess.handle.includes('n')) top = Math.min(bottom - MIN_SIZE, clamp01(ny))
      if (sess.handle.includes('s')) bottom = Math.max(top + MIN_SIZE, clamp01(ny))

      onUpdateMark(sess.markId, {
        x: left,
        y: top,
        w: right - left,
        h: bottom - top,
      })
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const sess = dragRef.current
    if (!sess || sess.pointerId !== e.pointerId) return
    dragRef.current = null
    if (containerRef.current?.hasPointerCapture(e.pointerId)) {
      containerRef.current.releasePointerCapture(e.pointerId)
    }

    if (sess.kind === 'draw' && draft) {
      if (draft.w >= MIN_SIZE && draft.h >= MIN_SIZE) {
        const created: RedactMark = {
          id: uid(),
          page,
          applyAllPages: defaultAllPages,
          shape: draft.shape,
          x: draft.x,
          y: draft.y,
          w: draft.w,
          h: draft.h,
          color: drawColor,
        }
        onAddMark(created)
        onSelectMark(created.id)
      }
      setDraft(null)
    }
  }

  const duplicateMark = (mark: RedactMark) => {
    const copy: RedactMark = {
      ...mark,
      id: uid(),
      x: Math.min(1 - mark.w, mark.x + 0.02),
      y: Math.min(1 - mark.h, mark.y + 0.02),
    }
    onAddMark(copy)
    onSelectMark(copy.id)
  }

  const isLightColor = (hex: string) => hex.toLowerCase() === '#ffffff' || hex.toLowerCase() === '#fff'

  return (
    <div
      ref={containerRef}
      onPointerDown={handleSurfacePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={cn(
        'absolute inset-0 z-10 touch-none select-none',
        tool === 'select' ? 'cursor-default' : 'cursor-crosshair',
      )}
    >
      {/* 已绘制的打码遮挡块 */}
      {marks.map((mark) => {
        const isSelected = mark.id === selectedMarkId
        const toolbarBelow = mark.y < 0.14
        return (
          <div
            key={mark.id}
            onPointerDown={(e) => handleMarkPointerDown(e, mark)}
            style={{
              left: `${mark.x * 100}%`,
              top: `${mark.y * 100}%`,
              width: `${mark.w * 100}%`,
              height: `${mark.h * 100}%`,
            }}
            className={cn(
              'group absolute',
              tool === 'select' ? 'cursor-move' : 'pointer-events-none',
            )}
          >
            {/* 纯色遮挡主体 */}
            <div
              className={cn(
                'size-full transition-shadow',
                mark.shape === 'ellipse' ? 'rounded-full' : 'rounded-none',
                isLightColor(mark.color) && !isSelected && 'outline-1 outline-dashed outline-slate-400/70',
                isSelected && 'ring-2 ring-sky-500 ring-offset-1 ring-offset-white/80',
              )}
              style={{ backgroundColor: mark.color }}
            />

            {/* 全页生效小角标 */}
            {mark.applyAllPages && totalPages > 1 && (
              <span className="pointer-events-none absolute -top-2 -right-2 flex size-4 items-center justify-center rounded-full bg-sky-500 text-[9px] font-bold text-white shadow">
                全
              </span>
            )}

            {/* 选中时的四角缩放手柄 + 悬浮快捷微调栏 */}
            {isSelected && tool === 'select' && (
              <>
                {(
                  [
                    ['nw', '-top-1.5 -left-1.5 cursor-nwse-resize'],
                    ['ne', '-top-1.5 -right-1.5 cursor-nesw-resize'],
                    ['sw', '-bottom-1.5 -left-1.5 cursor-nesw-resize'],
                    ['se', '-bottom-1.5 -right-1.5 cursor-nwse-resize'],
                  ] as const
                ).map(([h, posCls]) => (
                  <button
                    key={h}
                    type="button"
                    aria-label="调整打码大小"
                    onPointerDown={(e) => handleResizePointerDown(e, mark, h)}
                    className={cn(
                      'absolute z-20 size-3 rounded-full border-2 border-sky-500 bg-white shadow-sm transition-transform hover:scale-125',
                      posCls,
                    )}
                  />
                ))}

                {/* 悬浮迷你操作条 */}
                <div
                  onPointerDown={(e) => e.stopPropagation()}
                  className={cn(
                    'bg-card-solid/95 shadow-lift absolute left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-xl border px-1.5 py-1 text-[11px] backdrop-blur-md',
                    toolbarBelow ? 'top-[calc(100%+10px)]' : 'bottom-[calc(100%+10px)]',
                  )}
                >
                  {/* 形状切换 */}
                  <button
                    type="button"
                    title={mark.shape === 'rect' ? '切换为圆形/椭圆' : '切换为矩形'}
                    onClick={() => onUpdateMark(mark.id, { shape: mark.shape === 'rect' ? 'ellipse' : 'rect' })}
                    className="hover:bg-foreground/10 flex size-6 items-center justify-center rounded-lg transition"
                  >
                    {mark.shape === 'rect' ? <Circle className="size-3.5" /> : <Square className="size-3.5" />}
                  </button>

                  {/* 快捷换色（黑/白/灰） */}
                  {REDACT_COLOR_PRESETS.slice(0, 3).map((c) => (
                    <button
                      key={c}
                      type="button"
                      title={c === '#ffffff' ? '纯白（涂改液）' : c}
                      onClick={() => onUpdateMark(mark.id, { color: c })}
                      className={cn(
                        'size-4.5 rounded-full border border-black/20 transition-transform hover:scale-110',
                        mark.color.toLowerCase() === c && 'ring-primary ring-2 ring-offset-1',
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}

                  {/* 单页 / 全页切换 */}
                  {totalPages > 1 && (
                    <button
                      type="button"
                      title={mark.applyAllPages ? '当前应用于全部页，点击改为仅本页' : '同步应用到全部页面'}
                      onClick={() => onUpdateMark(mark.id, { applyAllPages: !mark.applyAllPages })}
                      className={cn(
                        'flex h-6 items-center gap-0.5 rounded-lg px-1.5 font-medium whitespace-nowrap transition',
                        mark.applyAllPages
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
                      )}
                    >
                      <Layers className="size-3" />
                      {mark.applyAllPages ? '全页' : '本页'}
                    </button>
                  )}

                  {/* 复制一份 */}
                  <button
                    type="button"
                    title="复制此遮挡块"
                    onClick={() => duplicateMark(mark)}
                    className="hover:bg-foreground/10 flex size-6 items-center justify-center rounded-lg transition"
                  >
                    <CopyPlus className="size-3.5" />
                  </button>

                  {/* 删除 */}
                  <button
                    type="button"
                    title="删除 (Delete)"
                    onClick={() => onDeleteMark(mark.id)}
                    className="flex size-6 items-center justify-center rounded-lg text-rose-500 transition hover:bg-rose-500/15"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        )
      })}

      {/* 正在拖拽绘制中的实时预览块 */}
      {draft && (
        <div
          style={{
            left: `${draft.x * 100}%`,
            top: `${draft.y * 100}%`,
            width: `${draft.w * 100}%`,
            height: `${draft.h * 100}%`,
            backgroundColor: drawColor,
          }}
          className={cn(
            'pointer-events-none absolute opacity-85 ring-2 ring-sky-500',
            draft.shape === 'ellipse' ? 'rounded-full' : 'rounded-none',
          )}
        />
      )}
    </div>
  )
}
