import { AnimatePresence, motion } from 'motion/react'
import {
  Archive,
  ArrowDown,
  ArrowUp,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Download,
  FilePlus2,
  FileStack,
  Layers,
  Loader2,
  RotateCcw,
  RotateCw,
  Scissors,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Slider } from '@/components/ui/slider'
import { Field } from '@/components/ui/field'
import { downloadBlob, timestampName } from '@/lib/file'
import {
  isPdfFile,
  openPdfDocument,
  parsePageRanges,
  renderPdfPageToDataUrl,
  type OpenedPdf,
} from '@/lib/pdf'
import { cn, formatBytes, uid } from '@/lib/utils'
import { exportByFixedSize, exportByRanges, exportMergedPdf } from './engine'
import { PageThumbnail } from './PageThumbnail'
import {
  SOURCE_COLORS,
  type ExportMode,
  type PdfPageCard,
  type RangeOutputMode,
  type SourcePdfFile,
} from './types'

export default function PdfMergeSplit() {
  const [files, setFiles] = useState<SourcePdfFile[]>([])
  const [pages, setPages] = useState<PdfPageCard[]>([])
  const [selectedUids, setSelectedUids] = useState<Set<string>>(() => new Set())
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [loadingFiles, setLoadingFiles] = useState(false)

  // 导出设置
  const [exportMode, setExportMode] = useState<ExportMode>('merge')
  const [mergeOnlySelected, setMergeOnlySelected] = useState(false)
  const [rangeInput, setRangeInput] = useState('1-2')
  const [rangeOutputMode, setRangeOutputMode] = useState<RangeOutputMode>('separate')
  const [fixedSize, setFixedSize] = useState(1)
  const [outputName, setOutputName] = useState('')
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  // 拖拽重排状态
  const [dragUid, setDragUid] = useState<string | null>(null)
  const [dragOverUid, setDragOverUid] = useState<string | null>(null)

  // 高清放大预览弹窗
  const [zoomIndex, setZoomIndex] = useState<number | null>(null)
  const [zoomImgUrl, setZoomImgUrl] = useState<string>('')
  const [zoomLoading, setZoomLoading] = useState(false)

  // 底层二进制数据与 PDF.js 文档实例（存于 Ref 避免 React 状态拷贝大 ArrayBuffer）
  const rawBytesRef = useRef(new Map<string, Uint8Array>())
  const pdfDocsRef = useRef(new Map<string, OpenedPdf>())
  const colorCursorRef = useRef(0)

  // 缩略图懒渲染小并发队列
  const queuedThumbKeysRef = useRef(new Set<string>())
  const thumbQueueRef = useRef<{ key: string; fileId: string; pageIndex: number }[]>([])
  const activeThumbJobsRef = useRef(0)

  // 卸载时销毁全部 PDF.js Worker 文档释放内存
  useEffect(
    () => () => {
      pdfDocsRef.current.forEach((doc) => {
        void doc.destroy()
      })
      pdfDocsRef.current.clear()
      rawBytesRef.current.clear()
    },
    [],
  )

  /** 推进缩略图渲染队列（最多 2 路并发，保持界面丝滑） */
  const pumpThumbQueue = useCallback(() => {
    while (activeThumbJobsRef.current < 2 && thumbQueueRef.current.length > 0) {
      const task = thumbQueueRef.current.shift()!
      const opened = pdfDocsRef.current.get(task.fileId)
      if (!opened) continue
      activeThumbJobsRef.current++
      renderPdfPageToDataUrl(opened.doc, task.pageIndex + 1, 300)
        .then((url) => {
          setThumbs((prev) => ({ ...prev, [task.key]: url }))
        })
        .catch(() => {
          // 忽略单页缩略图渲染异常
        })
        .finally(() => {
          activeThumbJobsRef.current--
          pumpThumbQueue()
        })
    }
  }, [])

  const requestThumb = useCallback(
    (fileId: string, pageIndex: number) => {
      const key = `${fileId}:${pageIndex}`
      if (queuedThumbKeysRef.current.has(key)) return
      queuedThumbKeysRef.current.add(key)
      thumbQueueRef.current.push({ key, fileId, pageIndex })
      pumpThumbQueue()
    },
    [pumpThumbQueue],
  )

  /** 导入一份或多份 PDF 文件 */
  const addPdfFiles = useCallback(async (inputFiles: File[]) => {
    const valid = inputFiles.filter(isPdfFile)
    if (!valid.length) {
      toast.error('请选择有效的 PDF 文件')
      return
    }
    setLoadingFiles(true)
    let addedPageTotal = 0
    const newSources: SourcePdfFile[] = []
    const newCards: PdfPageCard[] = []

    for (const file of valid) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const opened = await openPdfDocument(bytes)
        const fileId = uid()
        const color = SOURCE_COLORS[colorCursorRef.current++ % SOURCE_COLORS.length]
        rawBytesRef.current.set(fileId, bytes)
        pdfDocsRef.current.set(fileId, opened)

        const pageCount = opened.doc.numPages
        newSources.push({ id: fileId, name: file.name, size: file.size, pageCount, color })

        // 读取首页尺寸作为占位基准（无需阻塞遍历所有页）
        const firstPage = await opened.doc.getPage(1)
        const vp = firstPage.getViewport({ scale: 1 })
        firstPage.cleanup()

        for (let i = 0; i < pageCount; i++) {
          newCards.push({
            uid: uid(),
            fileId,
            fileName: file.name,
            color,
            sourcePageIndex: i,
            rotation: 0,
            widthPt: vp.width,
            heightPt: vp.height,
          })
        }
        addedPageTotal += pageCount
      } catch (err) {
        console.error('[pdf-merge-split] 加载 PDF 失败:', err)
        toast.error(`无法读取「${file.name}」，可能已加密或文件已损坏`)
      }
    }

    if (newSources.length) {
      setFiles((prev) => {
        const next = [...prev, ...newSources]
        if (prev.length === 0) {
          const base = newSources[0].name.replace(/\.pdf$/i, '')
          setOutputName(newSources.length > 1 ? `${base}-合并` : `${base}-处理`)
          const defaultEnd = Math.min(addedPageTotal, Math.max(1, Math.ceil(addedPageTotal / 2)))
          setRangeInput(addedPageTotal > 1 ? `1-${defaultEnd}` : '1')
        }
        return next
      })
      setPages((prev) => [...prev, ...newCards])
      toast.success(`已载入 ${newSources.length} 份 PDF，共 ${addedPageTotal} 页`)
    }
    setLoadingFiles(false)
  }, [])

  /** 移除整份源 PDF 及其所有页面 */
  const removeSourceFile = (fileId: string) => {
    const doc = pdfDocsRef.current.get(fileId)
    if (doc) {
      void doc.destroy()
      pdfDocsRef.current.delete(fileId)
    }
    rawBytesRef.current.delete(fileId)
    setFiles((prev) => prev.filter((f) => f.id !== fileId))
    setPages((prev) => {
      const removedUids = new Set(prev.filter((p) => p.fileId === fileId).map((p) => p.uid))
      setSelectedUids((sel) => {
        const next = new Set(sel)
        removedUids.forEach((u) => next.delete(u))
        return next
      })
      return prev.filter((p) => p.fileId !== fileId)
    })
  }

  /** 文件维度上移 / 下移（连带把该文档的所有页一起重排，合并多份 PDF 时非常省事） */
  const moveSourceFile = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= files.length) return
    const nextFiles = [...files]
    const [moved] = nextFiles.splice(index, 1)
    nextFiles.splice(target, 0, moved)
    setFiles(nextFiles)

    // 按新的文件顺序重排右侧页面卡片（保持每份文件内部已有顺序与旋转）
    setPages((prev) => {
      const buckets = new Map<string, PdfPageCard[]>()
      nextFiles.forEach((f) => buckets.set(f.id, []))
      prev.forEach((p) => buckets.get(p.fileId)?.push(p))
      return nextFiles.flatMap((f) => buckets.get(f.id) ?? [])
    })
  }

  const clearAll = () => {
    pdfDocsRef.current.forEach((doc) => void doc.destroy())
    pdfDocsRef.current.clear()
    rawBytesRef.current.clear()
    queuedThumbKeysRef.current.clear()
    thumbQueueRef.current = []
    setFiles([])
    setPages([])
    setSelectedUids(new Set())
    setThumbs({})
    setZoomIndex(null)
  }

  // ==================== 单页与批量页面操作 ====================
  const toggleSelect = useCallback((pageUid: string) => {
    setSelectedUids((prev) => {
      const next = new Set(prev)
      if (next.has(pageUid)) next.delete(pageUid)
      else next.add(pageUid)
      return next
    })
  }, [])

  const selectPreset = (kind: 'all' | 'none' | 'invert' | 'odd' | 'even') => {
    if (kind === 'none') {
      setSelectedUids(new Set())
      return
    }
    if (kind === 'all') {
      setSelectedUids(new Set(pages.map((p) => p.uid)))
      return
    }
    if (kind === 'invert') {
      setSelectedUids(new Set(pages.filter((p) => !selectedUids.has(p.uid)).map((p) => p.uid)))
      return
    }
    setSelectedUids(
      new Set(pages.filter((_, i) => (kind === 'odd' ? i % 2 === 0 : i % 2 === 1)).map((p) => p.uid)),
    )
  }

  const rotatePage = useCallback((pageUid: string, delta: 90 | -90) => {
    setPages((prev) =>
      prev.map((p) => (p.uid === pageUid ? { ...p, rotation: (p.rotation + delta + 360) % 360 } : p)),
    )
  }, [])

  const rotateSelected = (delta: 90 | -90) => {
    const targets = selectedUids.size > 0 ? selectedUids : new Set(pages.map((p) => p.uid))
    setPages((prev) =>
      prev.map((p) => (targets.has(p.uid) ? { ...p, rotation: (p.rotation + delta + 360) % 360 } : p)),
    )
  }

  const duplicatePage = useCallback((pageUid: string) => {
    setPages((prev) => {
      const idx = prev.findIndex((p) => p.uid === pageUid)
      if (idx < 0) return prev
      const copy: PdfPageCard = { ...prev[idx], uid: uid() }
      const next = [...prev]
      next.splice(idx + 1, 0, copy)
      return next
    })
  }, [])

  const deletePage = useCallback((pageUid: string) => {
    setPages((prev) => prev.filter((p) => p.uid !== pageUid))
    setSelectedUids((prev) => {
      if (!prev.has(pageUid)) return prev
      const next = new Set(prev)
      next.delete(pageUid)
      return next
    })
  }, [])

  const deleteSelected = () => {
    if (!selectedUids.size) return
    const count = selectedUids.size
    setPages((prev) => prev.filter((p) => !selectedUids.has(p.uid)))
    setSelectedUids(new Set())
    toast.success(`已删除 ${count} 个页面`)
  }

  // 页面卡片拖拽重排
  const handleDragEnd = () => {
    if (dragUid && dragOverUid && dragUid !== dragOverUid) {
      setPages((prev) => {
        const from = prev.findIndex((p) => p.uid === dragUid)
        const to = prev.findIndex((p) => p.uid === dragOverUid)
        if (from < 0 || to < 0) return prev
        const next = [...prev]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        return next
      })
    }
    setDragUid(null)
    setDragOverUid(null)
  }

  // ==================== 高清大图预览弹窗 ====================
  const zoomedCard = zoomIndex !== null ? pages[zoomIndex] ?? null : null
  useEffect(() => {
    if (!zoomedCard) {
      setZoomImgUrl('')
      return
    }
    const opened = pdfDocsRef.current.get(zoomedCard.fileId)
    if (!opened) return
    let cancelled = false
    setZoomLoading(true)
    renderPdfPageToDataUrl(opened.doc, zoomedCard.sourcePageIndex + 1, 1280)
      .then((url) => {
        if (!cancelled) setZoomImgUrl(url)
      })
      .finally(() => {
        if (!cancelled) setZoomLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [zoomedCard])

  // 预览弹窗键盘翻页与关闭
  useEffect(() => {
    if (zoomIndex === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomIndex(null)
      else if (e.key === 'ArrowLeft') setZoomIndex((i) => (i !== null ? Math.max(0, i - 1) : null))
      else if (e.key === 'ArrowRight') setZoomIndex((i) => (i !== null ? Math.min(pages.length - 1, i + 1) : null))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomIndex, pages.length])

  // ==================== 范围解析与高亮映射 ====================
  const parsedRange = useMemo(
    () => (exportMode === 'range' ? parsePageRanges(rangeInput, pages.length) : null),
    [exportMode, rangeInput, pages.length],
  )

  /** 在范围拆分模式下，映射每个 0-based 页面索引到所属分组标签（如 "组1"） */
  const pageRangeBadgeMap = useMemo(() => {
    const map = new Map<number, string>()
    if (exportMode !== 'range' || !parsedRange?.ok) return map
    parsedRange.groups.forEach((group, gIdx) => {
      const label = rangeOutputMode === 'separate' && parsedRange.groups.length > 1 ? `份${gIdx + 1}` : '提取'
      group.forEach((pageIdx) => {
        if (!map.has(pageIdx)) map.set(pageIdx, label)
      })
    })
    return map
  }, [exportMode, parsedRange, rangeOutputMode])

  // ==================== 执行导出 ====================
  const onExport = async () => {
    if (!pages.length) return
    setExporting(true)
    setProgress(null)
    const cleanBase = outputName.trim().replace(/\.pdf$/i, '') || 'litebox-pdf'

    try {
      if (exportMode === 'merge') {
        const targetPages =
          mergeOnlySelected && selectedUids.size > 0
            ? pages.filter((p) => selectedUids.has(p.uid))
            : pages
        if (!targetPages.length) {
          toast.error('请先勾选需要导出的页面')
          return
        }
        const blob = await exportMergedPdf(targetPages, rawBytesRef.current)
        downloadBlob(blob, `${cleanBase}.pdf`)
        toast.success(`导出成功 · 共 ${targetPages.length} 页 · ${formatBytes(blob.size)}`)
      } else if (exportMode === 'range') {
        if (!parsedRange || !parsedRange.ok) {
          toast.error(parsedRange?.error || '请输入有效的页码范围')
          return
        }
        const res = await exportByRanges(
          pages,
          rawBytesRef.current,
          parsedRange.groups,
          rangeOutputMode === 'combined',
          cleanBase,
          (done, total) => setProgress({ done, total }),
        )
        const fileName = res.isZip ? timestampName(`${cleanBase}-拆分${res.fileCount}份`, 'zip') : `${cleanBase}-提取.pdf`
        downloadBlob(res.blob, fileName)
        toast.success(
          res.isZip
            ? `已拆分为 ${res.fileCount} 份 PDF 并打包 ZIP · ${formatBytes(res.blob.size)}`
            : `已提取目标页为 1 份 PDF · ${formatBytes(res.blob.size)}`,
        )
      } else {
        const res = await exportByFixedSize(
          pages,
          rawBytesRef.current,
          fixedSize,
          cleanBase,
          (done, total) => setProgress({ done, total }),
        )
        const fileName = res.isZip ? timestampName(`${cleanBase}-每${fixedSize}页拆分`, 'zip') : `${cleanBase}.pdf`
        downloadBlob(res.blob, fileName)
        toast.success(`已拆分为 ${res.fileCount} 份 PDF · ${formatBytes(res.blob.size)}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'PDF 导出失败')
    } finally {
      setExporting(false)
      setProgress(null)
    }
  }

  // 空状态
  if (!pages.length) {
    return (
      <div className="space-y-6">
        <FileDropzone
          accept=".pdf,application/pdf"
          multiple
          pasteable={false}
          onFiles={addPdfFiles}
          title={loadingFiles ? '正在解析 PDF 页面结构…' : '拖放一份或多份 PDF 到这里，开始合并或拆分'}
          hint="支持多文档拖拽合并、可视化页面重排、单页旋转删除与按页码拆分，全程本地处理绝不上传"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: <Layers />, t: '多份 PDF 无损合并', d: '原矢量文字与排版零损合并，支持整份文件或单页拖拽排序' },
            { icon: <Scissors />, t: '灵活页码范围拆分', d: '支持 1-3, 5, 8-10 按段拆多份或每 N 页拆分，一键打包 ZIP' },
            { icon: <RotateCw />, t: '可视化页面精修', d: '实时缩略图与高清放大预览，支持单页旋转、复制与批量删页' },
          ].map((f, i) => (
            <motion.div
              key={f.t}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 + i * 0.06 }}
              className="bg-card flex items-start gap-3 rounded-2xl border p-4 backdrop-blur-xl"
            >
              <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-4">
                {f.icon}
              </span>
              <span>
                <span className="block text-sm font-medium">{f.t}</span>
                <span className="text-muted-foreground text-xs">{f.d}</span>
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    )
  }

  const fixedFileCount = Math.ceil(pages.length / Math.max(1, fixedSize))

  const panel = (
    <>
      {/* 导出模式 */}
      <Field label="操作模式">
        <Segmented<ExportMode>
          size="sm"
          value={exportMode}
          onChange={setExportMode}
          options={[
            { value: 'merge', label: '合并 PDF' },
            { value: 'range', label: '范围拆分' },
            { value: 'fixed', label: '按页数拆' },
          ]}
        />
      </Field>

      {/* 模式一：合并导出 */}
      {exportMode === 'merge' && (
        <div className="space-y-4">
          <Field label="导出范围">
            <Segmented<'all' | 'selected'>
              size="sm"
              value={mergeOnlySelected ? 'selected' : 'all'}
              onChange={(v) => setMergeOnlySelected(v === 'selected')}
              options={[
                { value: 'all', label: `全部页 (${pages.length})` },
                { value: 'selected', label: `仅选中 (${selectedUids.size})` },
              ]}
            />
          </Field>
          <Field label="导出文件名">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={outputName}
                onChange={(e) => setOutputName(e.target.value)}
                placeholder="merged"
                className="bg-card-solid focus:ring-ring/50 h-9 w-full rounded-xl border px-3 text-xs outline-none focus:ring-2"
              />
              <span className="text-muted-foreground shrink-0 font-mono text-xs">.pdf</span>
            </div>
          </Field>
        </div>
      )}

      {/* 模式二：按页码范围拆分 */}
      {exportMode === 'range' && (
        <div className="space-y-4">
          <Field
            label="页码范围"
            value={
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const mid = Math.max(1, Math.ceil(pages.length / 2))
                    setRangeInput(pages.length > 1 ? `1-${mid}, ${mid + 1}-${pages.length}` : '1')
                  }}
                  className="text-primary hover:underline"
                >
                  一分为二
                </button>
                {selectedUids.size > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const nums = pages
                        .map((p, idx) => (selectedUids.has(p.uid) ? idx + 1 : -1))
                        .filter((n) => n > 0)
                      setRangeInput(nums.join(', '))
                    }}
                    className="text-primary hover:underline"
                  >
                    填入选中页
                  </button>
                )}
              </span>
            }
          >
            <input
              type="text"
              value={rangeInput}
              onChange={(e) => setRangeInput(e.target.value)}
              placeholder="例如：1-3, 5, 8-10"
              className="bg-card-solid focus:ring-ring/50 h-9 w-full rounded-xl border px-3 font-mono text-xs outline-none focus:ring-2"
            />
            {parsedRange && !parsedRange.ok ? (
              <p className="text-xs text-red-500">{parsedRange.error}</p>
            ) : parsedRange?.ok ? (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                已匹配 {parsedRange.indexSet.size} 页（{parsedRange.groups.length} 个分段），右侧已绿色标出。
              </p>
            ) : null}
          </Field>

          <Field label="输出方式">
            <Segmented<RangeOutputMode>
              size="sm"
              value={rangeOutputMode}
              onChange={setRangeOutputMode}
              options={[
                { value: 'separate', label: '每段拆为独立 PDF' },
                { value: 'combined', label: '合成为 1 份 PDF' },
              ]}
            />
          </Field>
        </div>
      )}

      {/* 模式三：按固定页数拆分 */}
      {exportMode === 'fixed' && (
        <div className="space-y-3">
          <Field label="每份包含页数" value={`每 ${fixedSize} 页一份`}>
            <Slider
              value={fixedSize}
              min={1}
              max={Math.max(2, Math.min(30, pages.length))}
              onChange={setFixedSize}
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {[1, 2, 3, 5, 10]
                .filter((n) => n <= Math.max(1, pages.length))
                .map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setFixedSize(n)}
                    className={cn(
                      'rounded-lg border px-2 py-0.5 font-mono text-[11px] transition-colors',
                      fixedSize === n
                        ? 'border-primary bg-primary/10 text-primary font-semibold'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {n === 1 ? '逐页 (1页)' : `${n}页/份`}
                  </button>
                ))}
            </div>
          </Field>
          <p className="text-muted-foreground rounded-xl bg-foreground/[0.04] px-3 py-2 text-xs">
            当前共 {pages.length} 页，将自动拆分为 <span className="text-foreground font-semibold">{fixedFileCount}</span>{' '}
            份 PDF 文件{fixedFileCount > 1 ? '并打包为 ZIP 下载' : ''}。
          </p>
        </div>
      )}

      {/* 源 PDF 文件列表（支持整份文档调序与追加） */}
      <div className="space-y-2.5 border-t pt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-foreground/80 font-medium">已导入 PDF（{files.length}）</span>
          <button
            type="button"
            onClick={clearAll}
            className="text-muted-foreground hover:text-red-500 flex items-center gap-1 transition-colors"
          >
            <Trash2 className="size-3" />
            清空全部
          </button>
        </div>
        <div className="space-y-1.5">
          {files.map((f, idx) => (
            <div
              key={f.id}
              className="bg-card-solid/70 flex items-center gap-2 rounded-xl border px-2.5 py-2 text-xs"
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: f.color }} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium" title={f.name}>
                  {f.name}
                </div>
                <div className="text-muted-foreground font-mono text-[10px]">
                  {f.pageCount} 页 · {formatBytes(f.size)}
                </div>
              </div>
              {files.length > 1 && (
                <div className="flex items-center">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => moveSourceFile(idx, -1)}
                    title="整份上移"
                    className="text-muted-foreground hover:text-foreground flex size-6 items-center justify-center rounded disabled:opacity-25"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === files.length - 1}
                    onClick={() => moveSourceFile(idx, 1)}
                    title="整份下移"
                    className="text-muted-foreground hover:text-foreground flex size-6 items-center justify-center rounded disabled:opacity-25"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={() => removeSourceFile(f.id)}
                title="移除此文档"
                className="text-muted-foreground flex size-6 items-center justify-center rounded hover:bg-red-500/15 hover:text-red-500"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        <FileDropzone
          compact
          accept=".pdf,application/pdf"
          multiple
          pasteable={false}
          onFiles={addPdfFiles}
          title={loadingFiles ? '正在解析 PDF…' : '继续添加 PDF 参与合并'}
        />
      </div>
    </>
  )

  const exportLabel = (() => {
    if (progress) return `生成中 ${progress.done}/${progress.total}…`
    if (exporting) return '正在生成…'
    if (exportMode === 'merge') {
      const n = mergeOnlySelected ? selectedUids.size : pages.length
      return `导出合并 PDF（${n} 页）`
    }
    if (exportMode === 'range') {
      if (!parsedRange?.ok) return '按范围拆分导出'
      return rangeOutputMode === 'separate' && parsedRange.groups.length > 1
        ? `拆分为 ${parsedRange.groups.length} 份 ZIP`
        : `提取为 1 份 PDF（${parsedRange.indexSet.size} 页）`
    }
    return fixedFileCount > 1 ? `拆分为 ${fixedFileCount} 份 ZIP` : '导出 PDF'
  })()

  const actions = (
    <Button
      variant="primary"
      size="lg"
      onClick={onExport}
      disabled={
        exporting ||
        (exportMode === 'merge' && mergeOnlySelected && selectedUids.size === 0) ||
        (exportMode === 'range' && !parsedRange?.ok)
      }
    >
      {exporting ? (
        <Loader2 className="animate-spin" />
      ) : exportMode === 'merge' || (exportMode === 'range' && rangeOutputMode === 'combined') ? (
        <Download />
      ) : (
        <Archive />
      )}
      {exportLabel}
    </Button>
  )

  return (
    <>
      <ToolShell panel={panel} actions={actions} panelTitle="合并与拆分设置">
        <div className="space-y-4">
          {/* 顶部页面批量操作条 */}
          <div className="glass shadow-soft flex flex-wrap items-center gap-2 rounded-2xl px-3.5 py-2.5 text-xs">
            <span className="flex items-center gap-1.5 font-medium">
              <FileStack className="text-primary size-4" />
              共 {pages.length} 页
              {selectedUids.size > 0 && (
                <span className="bg-primary/15 text-primary rounded-full px-2 py-0.5 font-mono text-[11px]">
                  已选 {selectedUids.size}
                </span>
              )}
            </span>

            <span className="bg-border mx-1 hidden h-4 w-px sm:inline-block" />

            {/* 快捷勾选 */}
            <div className="flex flex-wrap items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => selectPreset(selectedUids.size === pages.length ? 'none' : 'all')}
              >
                {selectedUids.size === pages.length ? <Square /> : <CheckSquare />}
                {selectedUids.size === pages.length ? '取消全选' : '全选'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => selectPreset('invert')}>
                反选
              </Button>
              <Button variant="ghost" size="sm" onClick={() => selectPreset('odd')}>
                奇数页
              </Button>
              <Button variant="ghost" size="sm" onClick={() => selectPreset('even')}>
                偶数页
              </Button>
            </div>

            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => rotateSelected(-90)}
                title={selectedUids.size ? '左旋选中页' : '左旋全部页'}
              >
                <RotateCcw />
                <span className="hidden xl:inline">左旋</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => rotateSelected(90)}
                title={selectedUids.size ? '右旋选中页' : '右旋全部页'}
              >
                <RotateCw />
                <span className="hidden xl:inline">右旋</span>
              </Button>
              {selectedUids.size > 0 && (
                <Button variant="danger" size="sm" onClick={deleteSelected}>
                  <Trash2 />
                  删除 ({selectedUids.size})
                </Button>
              )}
              <label className="cursor-pointer">
                <span className="bg-muted hover:bg-foreground/10 inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition-colors">
                  <FilePlus2 className="size-3.5" />
                  <span className="hidden sm:inline">加 PDF</span>
                </span>
                <input
                  type="file"
                  hidden
                  multiple
                  accept=".pdf,application/pdf"
                  onChange={(e) => {
                    if (e.target.files?.length) void addPdfFiles(Array.from(e.target.files))
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
          </div>

          {/* 可拖拽重排的 PDF 页面卡片网格 */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5">
            {pages.map((card, index) => (
              <PageThumbnail
                key={card.uid}
                card={card}
                displayIndex={index + 1}
                thumbUrl={thumbs[`${card.fileId}:${card.sourcePageIndex}`]}
                selected={selectedUids.has(card.uid)}
                rangeBadge={pageRangeBadgeMap.get(index) ?? null}
                isDragging={dragUid === card.uid}
                isDragOver={dragOverUid === card.uid && dragUid !== card.uid}
                onRequestThumb={requestThumb}
                onToggleSelect={() => toggleSelect(card.uid)}
                onRotate={(d) => rotatePage(card.uid, d)}
                onDuplicate={() => duplicatePage(card.uid)}
                onDelete={() => deletePage(card.uid)}
                onZoom={() => setZoomIndex(index)}
                onDragStart={() => setDragUid(card.uid)}
                onDragOver={() => setDragOverUid(card.uid)}
                onDragEnd={handleDragEnd}
              />
            ))}
          </div>

          <p className="text-muted-foreground text-center text-xs">
            提示：拖动任意页面卡片即可自由重排顺序；点击缩略图勾选多页，点击放大镜可高清查看文字内容
          </p>
        </div>
      </ToolShell>

      {/* 高清页面放大预览弹窗 */}
      <AnimatePresence>
        {zoomedCard && zoomIndex !== null && (
          <div
            onClick={() => setZoomIndex(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              onClick={(e) => e.stopPropagation()}
              className="glass shadow-lift relative flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl"
            >
              <div className="flex items-center gap-2 border-b px-4 py-3 text-xs">
                <span className="size-2.5 rounded-full" style={{ background: zoomedCard.color }} />
                <span className="font-mono font-bold">
                  #{zoomIndex + 1} / {pages.length}
                </span>
                <span className="text-muted-foreground truncate">
                  {zoomedCard.fileName} · 原第 {zoomedCard.sourcePageIndex + 1} 页
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={() => rotatePage(zoomedCard.uid, -90)} title="逆时针旋转">
                    <RotateCcw className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => rotatePage(zoomedCard.uid, 90)} title="顺时针旋转">
                    <RotateCw className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => setZoomIndex(null)} aria-label="关闭预览">
                    <X className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="relative flex min-h-[360px] flex-1 items-center justify-center overflow-auto p-4 sm:p-6">
                {zoomLoading ? (
                  <Loader2 className="text-primary size-8 animate-spin" />
                ) : zoomImgUrl ? (
                  <img
                    src={zoomImgUrl}
                    alt={`第 ${zoomIndex + 1} 页预览`}
                    style={{ transform: `rotate(${zoomedCard.rotation}deg)` }}
                    className="max-h-[72dvh] max-w-full rounded bg-white object-contain shadow-2xl transition-transform duration-300"
                  />
                ) : null}

                {zoomIndex > 0 && (
                  <button
                    type="button"
                    onClick={() => setZoomIndex(zoomIndex - 1)}
                    aria-label="上一页"
                    className="glass shadow-lift absolute top-1/2 left-3 flex size-10 -translate-y-1/2 items-center justify-center rounded-full transition-transform hover:scale-105"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                )}
                {zoomIndex < pages.length - 1 && (
                  <button
                    type="button"
                    onClick={() => setZoomIndex(zoomIndex + 1)}
                    aria-label="下一页"
                    className="glass shadow-lift absolute top-1/2 right-3 flex size-10 -translate-y-1/2 items-center justify-center rounded-full transition-transform hover:scale-105"
                  >
                    <ChevronRight className="size-5" />
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}
