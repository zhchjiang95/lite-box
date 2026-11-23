import { AnimatePresence, motion } from 'motion/react'
import {
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileAudio,
  FileImage,
  FilePlus2,
  FileText,
  FileVideo,
  ImageDown,
  Loader2,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { Button } from '@/components/ui/button'
import { Field, Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { downloadBlob, timestampName } from '@/lib/file'
import { cn, formatBytes } from '@/lib/utils'
import {
  copyMediaImageToClipboard,
  extractOfficeMedia,
  packMediaToZip,
  type ExtractedMediaItem,
  type MediaCategory,
  type OfficeDocEntry,
} from './extractor'

type FilterKind = 'all' | 'image-only' | 'vector' | 'av'
type SortMode = 'order' | 'size-desc' | 'name'

const OFFICE_ACCEPT =
  '.docx,.pptx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export default function DocxExtractMedia() {
  const [docs, setDocs] = useState<OfficeDocEntry[]>([])
  const [items, setItems] = useState<ExtractedMediaItem[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [activeDocId, setActiveDocId] = useState<string>('all')

  const [filterKind, setFilterKind] = useState<FilterKind>('all')
  const [skipTiny, setSkipTiny] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('order')
  const [groupByDocInZip, setGroupByDocInZip] = useState(true)

  const [loading, setLoading] = useState(false)
  const [packing, setPacking] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items

  // 组件卸载释放所有 ObjectURL
  useEffect(
    () => () => {
      itemsRef.current.forEach((it) => URL.revokeObjectURL(it.url))
    },
    [],
  )

  /** 解包并导入一份或多份 Office 文档 */
  const handleFiles = useCallback(async (files: File[]) => {
    if (!files.length) return
    setLoading(true)
    const addedDocs: OfficeDocEntry[] = []
    const addedItems: ExtractedMediaItem[] = []

    for (const f of files) {
      try {
        const res = await extractOfficeMedia(f)
        addedDocs.push(res.doc)
        addedItems.push(...res.items)
        if (res.items.length === 0) {
          toast.info(`「${f.name}」中未找到内嵌图片或媒体文件`)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `解析「${f.name}」失败`)
      }
    }

    if (addedDocs.length) {
      setDocs((prev) => [...prev, ...addedDocs])
    }
    if (addedItems.length) {
      setItems((prev) => [...prev, ...addedItems])
      setSelectedIds((prev) => {
        const next = new Set(prev)
        addedItems.forEach((it) => next.add(it.id))
        return next
      })
      toast.success(`成功无损提取 ${addedItems.length} 个原图 / 媒体文件`)
    }
    setLoading(false)
  }, [])

  /** 过滤与排序后的当前展示列表 */
  const visibleItems = useMemo(() => {
    const filtered = items.filter((it) => {
      if (activeDocId !== 'all' && it.docId !== activeDocId) return false
      if (skipTiny && it.size < 5 * 1024) return false
      if (filterKind === 'image-only') return it.category === 'image' || it.ext === 'svg'
      if (filterKind === 'vector') return it.category === 'vector'
      if (filterKind === 'av') return it.category === 'audio' || it.category === 'video'
      return true
    })

    if (sortMode === 'size-desc') {
      return [...filtered].sort((a, b) => b.size - a.size)
    }
    if (sortMode === 'name') {
      return [...filtered].sort((a, b) => a.fileName.localeCompare(b.fileName, 'zh-CN', { numeric: true }))
    }
    return filtered
  }, [items, activeDocId, skipTiny, filterKind, sortMode])

  const selectedVisibleItems = useMemo(
    () => visibleItems.filter((it) => selectedIds.has(it.id)),
    [visibleItems, selectedIds],
  )

  const selectedTotalBytes = useMemo(
    () => selectedVisibleItems.reduce((sum, it) => sum + it.size, 0),
    [selectedVisibleItems],
  )

  /** 统计格式分布（如 PNG · JPG · SVG） */
  const formatSummary = useMemo(() => {
    const map = new Map<string, number>()
    for (const it of items) {
      const k = it.ext.toUpperCase()
      map.set(k, (map.get(k) ?? 0) + 1)
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [items])

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      visibleItems.forEach((it) => next.add(it.id))
      return next
    })
  }

  const clearSelectionVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      visibleItems.forEach((it) => next.delete(it.id))
      return next
    })
  }

  const removeDoc = (docId: string) => {
    itemsRef.current.filter((it) => it.docId === docId).forEach((it) => URL.revokeObjectURL(it.url))
    setDocs((prev) => prev.filter((d) => d.id !== docId))
    setItems((prev) => prev.filter((it) => it.docId !== docId))
    setActiveDocId((cur) => (cur === docId ? 'all' : cur))
    setLightboxIndex(null)
  }

  const clearAll = () => {
    itemsRef.current.forEach((it) => URL.revokeObjectURL(it.url))
    setDocs([])
    setItems([])
    setSelectedIds(new Set())
    setActiveDocId('all')
    setLightboxIndex(null)
  }

  /** 下载单张无损原图/原文件 */
  const downloadSingle = (item: ExtractedMediaItem) => {
    const copy = new Uint8Array(item.bytes.byteLength)
    copy.set(item.bytes)
    downloadBlob(new Blob([copy.buffer], { type: item.mime }), item.fileName)
  }

  /** 复制单张图片到剪贴板 */
  const copySingle = async (item: ExtractedMediaItem) => {
    try {
      await copyMediaImageToClipboard(item)
      setCopiedId(item.id)
      toast.success(`已复制「${item.fileName}」到剪贴板`)
      window.setTimeout(() => setCopiedId((cur) => (cur === item.id ? null : cur)), 1500)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制失败')
    }
  }

  /** 批量打包选中原图为 ZIP */
  const handleDownloadZip = () => {
    if (!selectedVisibleItems.length) {
      toast.error('请先勾选至少 1 个需要导出的文件')
      return
    }
    setPacking(true)
    try {
      const blob = packMediaToZip(selectedVisibleItems, docs.length > 1 && groupByDocInZip)
      downloadBlob(blob, timestampName('文档原图提取', 'zip'))
      toast.success(`已无损打包 ${selectedVisibleItems.length} 个文件为 ZIP`)
    } catch {
      toast.error('ZIP 打包失败')
    } finally {
      setPacking(false)
    }
  }

  // 灯箱键盘左右切换与 ESC 关闭
  useEffect(() => {
    if (lightboxIndex === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIndex(null)
      else if (e.key === 'ArrowLeft') {
        setLightboxIndex((i) => (i !== null ? (i - 1 + visibleItems.length) % visibleItems.length : null))
      } else if (e.key === 'ArrowRight') {
        setLightboxIndex((i) => (i !== null ? (i + 1) % visibleItems.length : null))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxIndex, visibleItems.length])

  const lightboxItem = lightboxIndex !== null ? visibleItems[lightboxIndex] ?? null : null

  const renderCategoryBadge = (cat: MediaCategory, ext: string) => {
    const label = ext.toUpperCase()
    const color =
      cat === 'image'
        ? 'bg-sky-500/15 text-sky-600 dark:text-sky-300'
        : cat === 'vector'
          ? 'bg-violet-500/15 text-violet-600 dark:text-violet-300'
          : cat === 'video'
            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
            : cat === 'audio'
              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
              : 'bg-muted text-muted-foreground'
    return <span className={cn('rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold', color)}>{label}</span>
  }

  /** 左侧筛选与打包面板 */
  const panel = docs.length > 0 ? (
    <div className="space-y-5">
      {/* 格式分布总览 */}
      <div className="bg-primary/[0.04] border-primary/15 space-y-2 rounded-2xl border p-3.5 text-xs">
        <div className="flex items-center justify-between font-semibold">
          <span>已提取媒体总计</span>
          <span className="font-mono text-primary">{items.length} 个</span>
        </div>
        {formatSummary.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {formatSummary.map(([ext, cnt]) => (
              <span key={ext} className="bg-background rounded-md border px-1.5 py-0.5 font-mono text-[10px]">
                {ext} × {cnt}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 类型筛选 */}
      <Field label="按类型筛选">
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { id: 'all' as const, label: '全部媒体' },
            { id: 'image-only' as const, label: '仅高清图片' },
            { id: 'vector' as const, label: 'SVG / EMF 矢量' },
            { id: 'av' as const, label: '内嵌音视频' },
          ].map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setFilterKind(o.id)}
              className={cn(
                'rounded-xl border py-1.5 text-xs font-medium transition',
                filterKind === o.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-foreground/10 text-muted-foreground hover:text-foreground',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </Field>

      {/* 排序方式 */}
      <Field label="排序方式">
        <Segmented<SortMode>
          value={sortMode}
          onChange={setSortMode}
          size="sm"
          options={[
            { value: 'order', label: '文档顺序' },
            { value: 'size-desc', label: '体积最大' },
            { value: 'name', label: '文件名' },
          ]}
        />
      </Field>

      {/* 实用开关 */}
      <div className="space-y-3 border-t pt-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-medium">过滤极小图标（&lt; 5 KB）</div>
            <div className="text-muted-foreground text-[11px]">自动隐藏文档装饰小圆点与空白占位图</div>
          </div>
          <Switch checked={skipTiny} onChange={setSkipTiny} label="过滤极小图标" />
        </div>

        {docs.length > 1 && (
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-medium">ZIP 按文档分目录</div>
              <div className="text-muted-foreground text-[11px]">多份文档提取时按文件名归档</div>
            </div>
            <Switch checked={groupByDocInZip} onChange={setGroupByDocInZip} label="按文档分目录" />
          </div>
        )}
      </div>

      {/* 已载入文档清单 */}
      <div className="space-y-2 border-t pt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground font-semibold">已载入文档（{docs.length}）</span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-primary hover:underline"
          >
            + 继续添加
          </button>
        </div>
        <div className="space-y-1.5">
          {docs.map((d) => (
            <div
              key={d.id}
              className={cn(
                'flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-xs transition',
                activeDocId === d.id ? 'border-primary bg-primary/10' : 'border-foreground/10',
              )}
            >
              <button
                type="button"
                onClick={() => setActiveDocId((cur) => (cur === d.id ? 'all' : d.id))}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span className="bg-primary/15 text-primary rounded px-1 py-0.5 font-mono text-[10px] font-bold uppercase">
                  {d.kind}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{d.name}</div>
                  <div className="text-muted-foreground text-[10px]">
                    {d.mediaCount} 个媒体 · {formatBytes(d.mediaBytes)}
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => removeDoc(d.id)}
                className="text-muted-foreground hover:text-destructive shrink-0 p-1"
                title="移除此文档"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  ) : undefined

  const actions =
    docs.length > 0 ? (
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        disabled={selectedVisibleItems.length === 0 || packing}
        onClick={handleDownloadZip}
      >
        {packing ? <Loader2 className="animate-spin" /> : <Archive />}
        打包下载原图 ZIP（{selectedVisibleItems.length} 个 · {formatBytes(selectedTotalBytes)}）
      </Button>
    ) : undefined

  return (
    <>
      <ToolShell panel={panel} actions={actions} panelTitle="提取筛选与打包">
        <input
          ref={fileInputRef}
          type="file"
          accept={OFFICE_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            const list = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (list.length) void handleFiles(list)
          }}
        />

        {docs.length === 0 ? (
          <div className="space-y-4">
            <FileDropzone
              accept={OFFICE_ACCEPT}
              multiple
              onFiles={(files) => void handleFiles(files)}
              title={loading ? '正在无损解包文档原图…' : '拖入或选择 .docx / .pptx / .xlsx 文档'}
              hint="纯浏览器本地直接读取原始媒体流，零画质压缩，支持一次拖入多份文档批量提取"
            />

            <div className="glass grid gap-3 rounded-2xl p-4 text-xs sm:grid-cols-3">
              <div className="space-y-1">
                <div className="text-foreground flex items-center gap-1.5 font-semibold">
                  <Sparkles className="text-primary size-4" />
                  100% 原始无损画质
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  告别在 Word 里一张张右键“另存为图片”或截图发糊，直接提取内嵌原始字节文件。
                </p>
              </div>
              <div className="space-y-1">
                <div className="text-foreground flex items-center gap-1.5 font-semibold">
                  <FileText className="size-4 text-sky-500" />
                  兼容 Word / PPT / Excel
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  同时支持 `.docx`、`.pptx`、`.xlsx`，除 PNG/JPG/SVG 外还可提取内嵌音视频素材。
                </p>
              </div>
              <div className="space-y-1">
                <div className="text-foreground flex items-center gap-1.5 font-semibold">
                  <ImageDown className="size-4 text-emerald-500" />
                  智能过滤与极速打包
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  支持一键过滤极小装饰图标、按体积排序找出大图、点击大图预览并批量 ZIP 下载。
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 顶部批量选择工具栏 */}
            <div className="glass flex flex-wrap items-center justify-between gap-2.5 rounded-2xl px-4 py-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">
                  画廊视图（显示 {visibleItems.length} / 总计 {items.length} 个）
                </span>
                <span className="bg-primary/10 text-primary rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold">
                  已选 {selectedVisibleItems.length} 项 · {formatBytes(selectedTotalBytes)}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={selectAllVisible}>
                  全选
                </Button>
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={clearSelectionVisible}>
                  取消全选
                </Button>
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => fileInputRef.current?.click()}>
                  <FilePlus2 className="size-3.5" />
                  添加文档
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive h-7 px-2 text-xs"
                  onClick={clearAll}
                >
                  <Trash2 className="size-3.5" />
                  清空
                </Button>
              </div>
            </div>

            {/* 媒体画廊网格 */}
            {visibleItems.length === 0 ? (
              <div className="glass flex flex-col items-center justify-center rounded-2xl py-16 text-center text-xs">
                <FileImage className="text-muted-foreground mb-2 size-8 opacity-60" />
                <div className="font-semibold">当前筛选条件下没有媒体文件</div>
                <p className="text-muted-foreground mt-1">可调整左侧筛选条件，或添加包含图片的文档</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {visibleItems.map((item, idx) => {
                  const checked = selectedIds.has(item.id)
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'glass group flex flex-col overflow-hidden rounded-2xl transition',
                        checked ? 'border-primary/60 ring-primary/25 ring-2' : 'opacity-80 hover:opacity-100',
                      )}
                    >
                      {/* 缩略预览区 */}
                      <div className="checkerboard relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-slate-100 dark:bg-slate-900">
                        {item.previewableImage ? (
                          <button
                            type="button"
                            onClick={() => setLightboxIndex(idx)}
                            className="flex h-full w-full items-center justify-center p-2"
                            title="点击放大预览原图"
                          >
                            <img
                              src={item.url}
                              alt={item.fileName}
                              loading="lazy"
                              className="max-h-full max-w-full rounded object-contain transition-transform duration-200 group-hover:scale-105"
                            />
                          </button>
                        ) : item.category === 'video' ? (
                          <video src={item.url} controls className="h-full w-full bg-black object-contain" />
                        ) : item.category === 'audio' ? (
                          <div className="flex w-full flex-col items-center gap-2 p-3">
                            <FileAudio className="size-8 text-amber-500" />
                            <audio src={item.url} controls className="h-8 w-full" />
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-1.5 text-center text-[11px] text-slate-500">
                            {item.category === 'vector' ? (
                              <FileImage className="size-8 text-violet-500" />
                            ) : (
                              <FileVideo className="size-8 text-slate-400" />
                            )}
                            <span className="font-mono font-semibold uppercase">{item.ext} 原文件</span>
                            <span className="text-[10px] opacity-75">支持无损下载</span>
                          </div>
                        )}

                        {/* 左上角勾选复选框 */}
                        <button
                          type="button"
                          onClick={() => toggleSelect(item.id)}
                          aria-label={checked ? '取消勾选' : '勾选此文件'}
                          className={cn(
                            'absolute top-2 left-2 flex size-6 items-center justify-center rounded-lg border shadow-sm transition',
                            checked
                              ? 'border-primary bg-primary text-white'
                              : 'border-black/20 bg-white/90 text-transparent hover:border-primary',
                          )}
                        >
                          <Check className="size-3.5" strokeWidth={3} />
                        </button>

                        {/* 右上角格式徽标 */}
                        <div className="absolute top-2 right-2">{renderCategoryBadge(item.category, item.ext)}</div>
                      </div>

                      {/* 底部元信息与操作按钮 */}
                      <div className="flex flex-1 flex-col justify-between gap-2 p-2.5 text-xs">
                        <div>
                          <div className="truncate font-semibold" title={item.fileName}>
                            {item.fileName}
                          </div>
                          <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
                            <span>{formatBytes(item.size)}</span>
                            {item.width && item.height && (
                              <>
                                <span>·</span>
                                <span>
                                  {item.width}×{item.height}
                                </span>
                              </>
                            )}
                          </div>
                          {docs.length > 1 && (
                            <div className="text-muted-foreground mt-0.5 truncate text-[10px] opacity-75" title={item.docName}>
                              来自 {item.docName}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1 border-t pt-2">
                          {item.previewableImage && (
                            <>
                              <button
                                type="button"
                                onClick={() => setLightboxIndex(idx)}
                                title="查看大图"
                                className="border-foreground/10 hover:border-primary/50 hover:text-primary inline-flex h-7 flex-1 items-center justify-center rounded-lg border transition"
                              >
                                <ZoomIn className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void copySingle(item)}
                                title="复制图片"
                                className="border-foreground/10 hover:border-primary/50 hover:text-primary inline-flex h-7 flex-1 items-center justify-center rounded-lg border transition"
                              >
                                {copiedId === item.id ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => downloadSingle(item)}
                            title="无损下载原文件"
                            className="bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-medium transition"
                          >
                            <Download className="size-3.5" />
                            <span>下载</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </ToolShell>

      {/* 原图放大预览灯箱 */}
      <AnimatePresence>
        {lightboxItem && lightboxItem.previewableImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightboxIndex(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative flex max-h-[92dvh] max-w-[92vw] flex-col items-center gap-3"
            >
              <div className="flex w-full items-center justify-between gap-4 rounded-2xl border border-white/15 bg-slate-950/85 px-4 py-2 text-xs text-white backdrop-blur-md">
                <div className="flex items-center gap-2 truncate">
                  <span className="font-semibold">{lightboxItem.fileName}</span>
                  <span className="font-mono text-white/60">
                    {formatBytes(lightboxItem.size)}
                    {lightboxItem.width && lightboxItem.height ? ` · ${lightboxItem.width}×${lightboxItem.height}` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void copySingle(lightboxItem)}
                    className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 hover:bg-white/20"
                  >
                    <Copy className="size-3.5" />
                    复制
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadSingle(lightboxItem)}
                    className="bg-primary inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-medium text-white"
                  >
                    <Download className="size-3.5" />
                    下载原图
                  </button>
                  <button
                    type="button"
                    onClick={() => setLightboxIndex(null)}
                    className="rounded-lg p-1 text-white/75 hover:bg-white/10 hover:text-white"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>

              <div className="relative flex items-center justify-center">
                {visibleItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setLightboxIndex((i) => (i !== null ? (i - 1 + visibleItems.length) % visibleItems.length : 0))
                    }
                    className="absolute -left-12 hidden size-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 sm:flex"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                )}

                <img
                  src={lightboxItem.url}
                  alt={lightboxItem.fileName}
                  className="checkerboard max-h-[78dvh] max-w-[85vw] rounded-2xl object-contain shadow-2xl"
                />

                {visibleItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLightboxIndex((i) => (i !== null ? (i + 1) % visibleItems.length : 0))}
                    className="absolute -right-12 hidden size-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 sm:flex"
                  >
                    <ChevronRight className="size-5" />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
