import { Check, Copy, Download, Loader2, ZoomIn } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface PageCardProps {
  /** 1-based 页码 */
  pageNumber: number
  thumbUrl?: string
  selected: boolean
  busy?: boolean
  onRequestThumb: (pageNumber: number) => void
  onToggleSelect: () => void
  onDownloadOne: () => void
  onCopyOne: () => void
  onZoom: () => void
}

/** 单个 PDF 页面懒渲染卡片：支持勾选、高清放大、一键复制与单独下载 */
export const PageCard = memo(function PageCard({
  pageNumber,
  thumbUrl,
  selected,
  busy,
  onRequestThumb,
  onToggleSelect,
  onDownloadOne,
  onCopyOne,
  onZoom,
}: PageCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
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
    if (visible && !thumbUrl) onRequestThumb(pageNumber)
  }, [visible, thumbUrl, pageNumber, onRequestThumb])

  return (
    <div
      ref={ref}
      className={cn(
        'group bg-card relative flex flex-col overflow-hidden rounded-2xl border backdrop-blur-xl transition-all',
        selected ? 'border-primary ring-primary/25 ring-2' : 'opacity-65 hover:border-foreground/25 hover:opacity-100',
      )}
    >
      <div
        onClick={onToggleSelect}
        className="bg-foreground/[0.03] relative flex aspect-[3/4] w-full cursor-pointer items-center justify-center overflow-hidden p-3"
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={`第 ${pageNumber} 页`}
            draggable={false}
            className="max-h-full max-w-full rounded-[3px] bg-white object-contain shadow-[0_4px_14px_rgb(0_0_0/0.16)]"
          />
        ) : (
          <div className="text-muted-foreground flex flex-col items-center gap-1.5 text-[11px]">
            <Loader2 className="size-4 animate-spin opacity-60" />
            <span>渲染中…</span>
          </div>
        )}

        {/* 左上角勾选框 */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelect()
          }}
          aria-label={selected ? '取消选中' : '选中导出'}
          className={cn(
            'absolute top-2 left-2 flex size-6 items-center justify-center rounded-lg border shadow-xs transition-all',
            selected
              ? 'border-primary bg-primary text-primary-foreground'
              : 'bg-card-solid/85 border-foreground/20 text-transparent',
          )}
        >
          <Check className="size-3.5" strokeWidth={3} />
        </button>

        {/* 悬浮操作栏 */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="glass shadow-lift absolute inset-x-2 bottom-2 flex items-center justify-center gap-0.5 rounded-xl p-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
        >
          <button
            type="button"
            onClick={onZoom}
            title="放大查看"
            className="hover:bg-foreground/10 flex size-7 items-center justify-center rounded-lg transition-colors"
          >
            <ZoomIn className="size-3.5" />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCopyOne}
            title="复制此页图片"
            className="hover:bg-foreground/10 flex size-7 items-center justify-center rounded-lg transition-colors disabled:opacity-40"
          >
            <Copy className="size-3.5" />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDownloadOne}
            title="下载此页高清图"
            className="hover:bg-primary/15 hover:text-primary flex size-7 items-center justify-center rounded-lg transition-colors disabled:opacity-40"
          >
            <Download className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between border-t px-2.5 py-2 text-xs">
        <span className="font-mono font-semibold tabular-nums">第 {pageNumber} 页</span>
        <button
          type="button"
          disabled={busy}
          onClick={onDownloadOne}
          className="text-primary hover:underline text-[11px] disabled:opacity-40"
        >
          下载
        </button>
      </div>
    </div>
  )
})
