import { Check, Copy, Loader2, RotateCcw, RotateCw, Trash2, ZoomIn } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { PdfPageCard } from './types'

interface PageThumbnailProps {
  card: PdfPageCard
  /** 当前在画布中的 1-based 页码 */
  displayIndex: number
  /** 已缓存的缩略图 DataURL */
  thumbUrl?: string
  /** 是否被勾选 */
  selected: boolean
  /** 范围拆分模式下的分组标记（如 "#1"） */
  rangeBadge?: string | null
  /** 拖拽状态 */
  isDragging: boolean
  isDragOver: boolean
  /** 通知父组件懒渲染此页缩略图 */
  onRequestThumb: (fileId: string, pageIndex: number) => void
  onToggleSelect: () => void
  onRotate: (delta: 90 | -90) => void
  onDuplicate: () => void
  onDelete: () => void
  onZoom: () => void
  onDragStart: () => void
  onDragOver: () => void
  onDragEnd: () => void
}

/** 单个 PDF 页面卡片：IntersectionObserver 懒渲染缩略图 + 拖拽重排 + 旋转/复制/放大/删除 */
export const PageThumbnail = memo(function PageThumbnail({
  card,
  displayIndex,
  thumbUrl,
  selected,
  rangeBadge,
  isDragging,
  isDragOver,
  onRequestThumb,
  onToggleSelect,
  onRotate,
  onDuplicate,
  onDelete,
  onZoom,
  onDragStart,
  onDragOver,
  onDragEnd,
}: PageThumbnailProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  // 进入视口附近时才触发缩略图渲染，避免百页 PDF 一次性卡顿
  useEffect(() => {
    const el = boxRef.current
    if (!el || thumbUrl) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '240px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [thumbUrl])

  useEffect(() => {
    if (visible && !thumbUrl) {
      onRequestThumb(card.fileId, card.sourcePageIndex)
    }
  }, [visible, thumbUrl, card.fileId, card.sourcePageIndex, onRequestThumb])

  return (
    <div
      ref={boxRef}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', card.uid)
        onDragStart()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onDragOver()
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDragEnd()
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'group bg-card relative flex cursor-grab flex-col overflow-hidden rounded-2xl border backdrop-blur-xl transition-all active:cursor-grabbing',
        selected
          ? 'border-primary ring-primary/25 ring-2'
          : rangeBadge
            ? 'border-emerald-500/60 ring-2 ring-emerald-500/20'
            : 'hover:border-foreground/25',
        isDragging && 'scale-95 opacity-45',
        isDragOver && 'ring-primary scale-[1.02] border-primary ring-2',
      )}
    >
      {/* 顶部来源文件区分色条 */}
      <div className="h-1 w-full shrink-0" style={{ background: card.color }} />

      {/* 缩略图展示区 */}
      <div
        onClick={onToggleSelect}
        className="bg-foreground/[0.03] relative flex aspect-[3/4] w-full cursor-pointer items-center justify-center overflow-hidden p-3"
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={`第 ${displayIndex} 页`}
            draggable={false}
            style={{ transform: `rotate(${card.rotation}deg)` }}
            className={cn(
              'max-h-full max-w-full rounded-[3px] bg-white object-contain shadow-[0_4px_14px_rgb(0_0_0/0.16)] transition-transform duration-300',
              card.rotation % 180 !== 0 && 'scale-[0.76]',
            )}
          />
        ) : (
          <div className="text-muted-foreground flex flex-col items-center gap-1.5 text-[11px]">
            <Loader2 className="size-4 animate-spin opacity-60" />
            <span>渲染中…</span>
          </div>
        )}

        {/* 左上角：勾选复选框 */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelect()
          }}
          aria-label={selected ? '取消选中' : '选中页面'}
          className={cn(
            'absolute top-2 left-2 flex size-6 items-center justify-center rounded-lg border shadow-xs transition-all',
            selected
              ? 'border-primary bg-primary text-primary-foreground'
              : 'bg-card-solid/85 border-foreground/20 text-transparent opacity-100 hover:border-primary sm:opacity-0 sm:group-hover:opacity-100',
          )}
        >
          <Check className="size-3.5" strokeWidth={3} />
        </button>

        {/* 右上角：范围拆分分组徽章 或 旋转角度提示 */}
        <div className="pointer-events-none absolute top-2 right-2 flex items-center gap-1">
          {rangeBadge && (
            <span className="rounded-md bg-emerald-500 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white shadow">
              {rangeBadge}
            </span>
          )}
          {card.rotation !== 0 && (
            <span className="rounded-md bg-black/65 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white backdrop-blur-xs">
              {card.rotation}°
            </span>
          )}
        </div>

        {/* 底部悬浮快捷操作栏（旋转 / 放大 / 复制 / 删除） */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="glass shadow-lift absolute inset-x-2 bottom-2 flex items-center justify-center gap-0.5 rounded-xl p-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
        >
          <button
            type="button"
            onClick={() => onRotate(-90)}
            title="逆时针旋转 90°"
            className="hover:bg-foreground/10 flex size-7 items-center justify-center rounded-lg transition-colors"
          >
            <RotateCcw className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onRotate(90)}
            title="顺时针旋转 90°"
            className="hover:bg-foreground/10 flex size-7 items-center justify-center rounded-lg transition-colors"
          >
            <RotateCw className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onZoom}
            title="放大预览"
            className="hover:bg-foreground/10 flex size-7 items-center justify-center rounded-lg transition-colors"
          >
            <ZoomIn className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            title="复制此页"
            className="hover:bg-foreground/10 flex size-7 items-center justify-center rounded-lg transition-colors"
          >
            <Copy className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="删除此页"
            className="flex size-7 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-500/15"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {/* 页脚：当前新页码 + 来源文件名与原页码 */}
      <div className="flex items-center justify-between gap-2 border-t px-2.5 py-2 text-[11px]">
        <span className="bg-foreground/[0.07] shrink-0 rounded-md px-1.5 py-0.5 font-mono font-bold tabular-nums">
          #{displayIndex}
        </span>
        <span className="text-muted-foreground min-w-0 truncate" title={`${card.fileName} · 原第 ${card.sourcePageIndex + 1} 页`}>
          {card.fileName} · P{card.sourcePageIndex + 1}
        </span>
      </div>
    </div>
  )
})
