import { AnimatePresence, motion } from 'motion/react'
import {
  Archive,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileUp,
  Images,
  Layers,
  Loader2,
  MoveVertical,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Slider } from '@/components/ui/slider'
import { ColorPicker, Field } from '@/components/ui/field'
import { copyImageToClipboard, downloadBlob, timestampName } from '@/lib/file'
import {
  isPdfFile,
  openPdfDocument,
  parsePageRanges,
  renderPdfPageToDataUrl,
  type OpenedPdf,
} from '@/lib/pdf'
import { formatBytes } from '@/lib/utils'
import {
  FORMAT_EXT,
  defaultPdfToImageOptions,
  exportPagesToLongImage,
  exportPagesToZip,
  pageImageName,
  renderSinglePageBlob,
  type ExportFormat,
  type OutputLayout,
  type PdfToImageOptions,
} from './engine'
import { PageCard } from './PageCard'

interface LoadedPdfMeta {
  name: string
  size: number
  numPages: number
  /** 首页基础宽高（scale=1），用于估算输出像素 */
  baseW: number
  baseH: number
}

const SCALE_OPTIONS = [
  { value: '1', label: '1× 标清' },
  { value: '1.5', label: '1.5×' },
  { value: '2', label: '2× 高清' },
  { value: '3', label: '3× 超清' },
]

export default function PdfToImage() {
  const [pdfMeta, setPdfMeta] = useState<LoadedPdfMeta | null>(null)
  const [selectedPages, setSelectedPages] = useState<Set<number>>(() => new Set())
  const [thumbs, setThumbs] = useState<Record<number, string>>({})
  const [opts, setOpts] = useState<PdfToImageOptions>(defaultPdfToImageOptions)
  const [rangeText, setRangeText] = useState('')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  // 高清预览弹窗
  const [zoomPage, setZoomPage] = useState<number | null>(null)
  const [zoomUrl, setZoomUrl] = useState('')
  const [zoomLoading, setZoomLoading] = useState(false)

  const openedRef = useRef<OpenedPdf | null>(null)
  const queuedThumbsRef = useRef(new Set<number>())
  const thumbQueueRef = useRef<number[]>([])
  const activeThumbRef = useRef(0)

  const set = <K extends keyof PdfToImageOptions>(k: K, v: PdfToImageOptions[K]) =>
    setOpts((prev) => ({ ...prev, [k]: v }))

  useEffect(
    () => () => {
      if (openedRef.current) {
        void openedRef.current.destroy()
        openedRef.current = null
      }
    },
    [],
  )

  const pumpThumbQueue = useCallback(() => {
    const opened = openedRef.current
    if (!opened) return
    while (activeThumbRef.current < 2 && thumbQueueRef.current.length > 0) {
      const pNum = thumbQueueRef.current.shift()!
      activeThumbRef.current++
      renderPdfPageToDataUrl(opened.doc, pNum, 320)
        .then((url) => setThumbs((prev) => ({ ...prev, [pNum]: url })))
        .catch(() => {})
        .finally(() => {
          activeThumbRef.current--
          pumpThumbQueue()
        })
    }
  }, [])

  const requestThumb = useCallback(
    (pageNumber: number) => {
      if (queuedThumbsRef.current.has(pageNumber)) return
      queuedThumbsRef.current.add(pageNumber)
      thumbQueueRef.current.push(pageNumber)
      pumpThumbQueue()
    },
    [pumpThumbQueue],
  )

  /** 载入 PDF 文档 */
  const loadPdfFile = useCallback(async (files: File[]) => {
    const file = files.find(isPdfFile)
    if (!file) {
      toast.error('请选择有效的 PDF 文件')
      return
    }
    setLoading(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const opened = await openPdfDocument(bytes)

      // 销毁旧文档并清空缩略图队列
      if (openedRef.current) void openedRef.current.destroy()
      openedRef.current = opened
      queuedThumbsRef.current.clear()
      thumbQueueRef.current = []
      setThumbs({})
      setZoomPage(null)

      const firstPage = await opened.doc.getPage(1)
      const vp = firstPage.getViewport({ scale: 1 })
      firstPage.cleanup()

      const numPages = opened.doc.numPages
      setPdfMeta({
        name: file.name,
        size: file.size,
        numPages,
        baseW: Math.round(vp.width),
        baseH: Math.round(vp.height),
      })
      setSelectedPages(new Set(Array.from({ length: numPages }, (_, i) => i + 1)))
      setRangeText(`1-${numPages}`)
      toast.success(`已载入「${file.name}」，共 ${numPages} 页`)
    } catch {
      toast.error('无法解析该 PDF 文件，可能已加密或文件损坏')
    } finally {
      setLoading(false)
    }
  }, [])

  // 高清弹窗渲染
  useEffect(() => {
    const opened = openedRef.current
    if (!zoomPage || !opened) {
      setZoomUrl('')
      return
    }
    let cancelled = false
    setZoomLoading(true)
    renderPdfPageToDataUrl(opened.doc, zoomPage, 1280)
      .then((url) => {
        if (!cancelled) setZoomUrl(url)
      })
      .finally(() => {
        if (!cancelled) setZoomLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [zoomPage])

  // 弹窗键盘翻页
  useEffect(() => {
    if (!zoomPage || !pdfMeta) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomPage(null)
      else if (e.key === 'ArrowLeft') setZoomPage((p) => (p ? Math.max(1, p - 1) : null))
      else if (e.key === 'ArrowRight') setZoomPage((p) => (p ? Math.min(pdfMeta.numPages, p + 1) : null))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomPage, pdfMeta])

  const togglePage = useCallback((pNum: number) => {
    setSelectedPages((prev) => {
      const next = new Set(prev)
      if (next.has(pNum)) next.delete(pNum)
      else next.add(pNum)
      return next
    })
  }, [])

  const applySelectionPreset = (kind: 'all' | 'none' | 'invert' | 'odd' | 'even') => {
    if (!pdfMeta) return
    const all = Array.from({ length: pdfMeta.numPages }, (_, i) => i + 1)
    if (kind === 'all') setSelectedPages(new Set(all))
    else if (kind === 'none') setSelectedPages(new Set())
    else if (kind === 'invert') setSelectedPages(new Set(all.filter((p) => !selectedPages.has(p))))
    else if (kind === 'odd') setSelectedPages(new Set(all.filter((p) => p % 2 === 1)))
    else setSelectedPages(new Set(all.filter((p) => p % 2 === 0)))
  }

  /** 应用手动输入的页码范围到勾选集合 */
  const applyRangeSelection = () => {
    if (!pdfMeta) return
    const parsed = parsePageRanges(rangeText, pdfMeta.numPages)
    if (!parsed.ok) {
      toast.error(parsed.error)
      return
    }
    const next = new Set<number>()
    parsed.indexSet.forEach((idx0) => next.add(idx0 + 1))
    setSelectedPages(next)
    toast.success(`已勾选 ${next.size} 个页面`)
  }

  const orderedSelected = useMemo(
    () => Array.from(selectedPages).sort((a, b) => a - b),
    [selectedPages],
  )

  /** 单页高清下载或复制 */
  const handleSinglePage = async (pageNumber: number, mode: 'download' | 'copy') => {
    const opened = openedRef.current
    if (!opened || !pdfMeta) return
    setExporting(true)
    try {
      const { blob, width, height } = await renderSinglePageBlob(opened.doc, pageNumber, opts, mode === 'copy')
      if (mode === 'copy') {
        await copyImageToClipboard(blob)
        toast.success(`已复制第 ${pageNumber} 页高清图 · ${width}×${height}`)
      } else {
        const name = pageImageName(pdfMeta.name, pageNumber, pdfMeta.numPages, opts.format)
        downloadBlob(blob, name)
        toast.success(`已保存 ${name} · ${width}×${height} · ${formatBytes(blob.size)}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '单页渲染失败')
    } finally {
      setExporting(false)
    }
  }

  /** 批量导出（逐页 ZIP 或 纵向拼接长图） */
  const handleBatchExport = async () => {
    const opened = openedRef.current
    if (!opened || !pdfMeta || !orderedSelected.length) return

    if (opts.layout === 'pages' && orderedSelected.length === 1) {
      await handleSinglePage(orderedSelected[0], 'download')
      return
    }

    setExporting(true)
    setProgress({ done: 0, total: orderedSelected.length })
    try {
      const base = pdfMeta.name.replace(/\.pdf$/i, '') || 'pdf'
      if (opts.layout === 'long') {
        const res = await exportPagesToLongImage(opened.doc, orderedSelected, opts, (done, total) =>
          setProgress({ done, total }),
        )
        downloadBlob(res.blob, `${base}-长图.${FORMAT_EXT[opts.format]}`)
        toast.success(
          `长图合成成功 · ${res.width}×${res.height} · ${formatBytes(res.blob.size)}${res.scaledDown ? '（已按画布上限自动适配尺寸）' : ''}`,
        )
      } else {
        const zipBlob = await exportPagesToZip(opened.doc, pdfMeta.name, orderedSelected, opts, (done, total) =>
          setProgress({ done, total }),
        )
        downloadBlob(zipBlob, timestampName(`${base}-${orderedSelected.length}页图片`, 'zip'))
        toast.success(`已渲染 ${orderedSelected.length} 页高清图并打包 ZIP · ${formatBytes(zipBlob.size)}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
      setProgress(null)
    }
  }

  // 空状态
  if (!pdfMeta) {
    return (
      <div className="space-y-6">
        <FileDropzone
          accept=".pdf,application/pdf"
          multiple={false}
          pasteable={false}
          onFiles={loadPdfFile}
          title={loading ? '正在解析 PDF 文档…' : '拖放 PDF 文件到这里，转为高清图片'}
          hint="支持高达 3× 超清渲染、PNG / JPG / WebP 导出、单页保存、整本 ZIP 打包或一键拼成长图"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: <Sparkles />, t: '高达 3× 超清渲染', d: '文字矢量抗锯齿清晰呈现，自由切换标清 / 高清 / 超清' },
            { icon: <Archive />, t: '按页挑选或整本打包', d: '勾选或输入页码范围精准导出，支持单页复制与 ZIP 打包' },
            { icon: <MoveVertical />, t: '一键合成超清长图', d: '将多页合同、课件或简历直接拼接为一张纵向长图发微信' },
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

  const estW = Math.round(pdfMeta.baseW * opts.scale)
  const estH = Math.round(pdfMeta.baseH * opts.scale)

  const panel = (
    <>
      {/* 导出形态 */}
      <Field label="输出形态">
        <Segmented<OutputLayout>
          size="sm"
          value={opts.layout}
          onChange={(v) => set('layout', v)}
          options={[
            { value: 'pages', label: '逐页图片', icon: <Layers /> },
            { value: 'long', label: '合成长图', icon: <MoveVertical /> },
          ]}
        />
      </Field>

      {/* 格式与清晰度 */}
      <Field label="图片格式">
        <Segmented<ExportFormat>
          size="sm"
          value={opts.format}
          onChange={(v) => set('format', v)}
          options={[
            { value: 'png', label: 'PNG' },
            { value: 'jpeg', label: 'JPG' },
            { value: 'webp', label: 'WebP' },
          ]}
        />
      </Field>

      <Field label="渲染清晰度" value={`≈ ${estW} × ${estH} px`}>
        <Segmented
          size="sm"
          value={String(opts.scale)}
          onChange={(v) => set('scale', Number(v))}
          options={SCALE_OPTIONS}
        />
      </Field>

      {opts.format !== 'png' && (
        <Field label="图片质量" value={`${opts.quality}%`}>
          <Slider value={opts.quality} min={50} max={100} onChange={(v) => set('quality', v)} />
        </Field>
      )}

      {/* 长图页间距 */}
      {opts.layout === 'long' && (
        <Field label="长图页间距" value={opts.longGap === 0 ? '无缝' : `${opts.longGap} px`}>
          <Slider value={opts.longGap} min={0} max={64} step={4} onChange={(v) => set('longGap', v)} />
        </Field>
      )}

      {/* 背景色 */}
      <Field label="页面底色" value={opts.background === 'transparent' ? '透明' : opts.background}>
        <ColorPicker
          value={opts.background}
          onChange={(v) => set('background', v)}
          presets={['#ffffff', '#faf8f5', '#f3f4f6', '#18181b', 'transparent']}
        />
      </Field>

      {/* 页码范围快捷勾选 */}
      <div className="space-y-2.5 border-t pt-4">
        <Field label="按页码范围勾选" value={`已选 ${orderedSelected.length}/${pdfMeta.numPages}`}>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={rangeText}
              onChange={(e) => setRangeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyRangeSelection()
              }}
              placeholder="如 1-5, 8, 10-12"
              className="bg-card-solid focus:ring-ring/50 h-9 min-w-0 flex-1 rounded-xl border px-3 font-mono text-xs outline-none focus:ring-2"
            />
            <Button variant="secondary" size="sm" className="h-9" onClick={applyRangeSelection}>
              应用
            </Button>
          </div>
        </Field>
      </div>
    </>
  )

  const exportBtnText = (() => {
    if (progress) return `渲染中 ${progress.done}/${progress.total}…`
    if (exporting) return '处理中…'
    if (opts.layout === 'long') return `合成长图（${orderedSelected.length} 页）`
    if (orderedSelected.length === 1) return `下载第 ${orderedSelected[0]} 页`
    return `打包 ZIP 下载（${orderedSelected.length} 张）`
  })()

  const actions = (
    <Button variant="primary" size="lg" onClick={handleBatchExport} disabled={exporting || orderedSelected.length === 0}>
      {exporting ? (
        <Loader2 className="animate-spin" />
      ) : opts.layout === 'long' || orderedSelected.length === 1 ? (
        <Download />
      ) : (
        <Archive />
      )}
      {exportBtnText}
    </Button>
  )

  return (
    <>
      <ToolShell panel={panel} actions={actions} panelTitle="渲染与导出">
        <div className="space-y-4">
          {/* 顶部文档信息与快捷选择栏 */}
          <div className="glass shadow-soft flex flex-wrap items-center gap-2 rounded-2xl px-3.5 py-2.5 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 font-medium">
              <Images className="text-primary size-4 shrink-0" />
              <span className="max-w-[180px] truncate sm:max-w-xs">{pdfMeta.name}</span>
              <span className="text-muted-foreground font-mono">({pdfMeta.numPages} 页)</span>
            </span>

            <span className="bg-border mx-1 hidden h-4 w-px sm:inline-block" />

            <div className="flex flex-wrap items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  applySelectionPreset(orderedSelected.length === pdfMeta.numPages ? 'none' : 'all')
                }
              >
                {orderedSelected.length === pdfMeta.numPages ? <Square /> : <CheckSquare />}
                {orderedSelected.length === pdfMeta.numPages ? '全不选' : '全选'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => applySelectionPreset('invert')}>
                反选
              </Button>
              <Button variant="ghost" size="sm" onClick={() => applySelectionPreset('odd')}>
                奇数页
              </Button>
              <Button variant="ghost" size="sm" onClick={() => applySelectionPreset('even')}>
                偶数页
              </Button>
            </div>

            <div className="ml-auto">
              <label className="cursor-pointer">
                <span className="bg-muted hover:bg-foreground/10 inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors">
                  <FileUp className="size-3.5" />
                  换 PDF
                </span>
                <input
                  type="file"
                  hidden
                  accept=".pdf,application/pdf"
                  onChange={(e) => {
                    if (e.target.files?.length) void loadPdfFile(Array.from(e.target.files))
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
          </div>

          {/* 懒渲染 PDF 页面网格 */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5">
            {Array.from({ length: pdfMeta.numPages }, (_, i) => i + 1).map((pNum) => (
              <PageCard
                key={pNum}
                pageNumber={pNum}
                thumbUrl={thumbs[pNum]}
                selected={selectedPages.has(pNum)}
                busy={exporting}
                onRequestThumb={requestThumb}
                onToggleSelect={() => togglePage(pNum)}
                onDownloadOne={() => handleSinglePage(pNum, 'download')}
                onCopyOne={() => handleSinglePage(pNum, 'copy')}
                onZoom={() => setZoomPage(pNum)}
              />
            ))}
          </div>
        </div>
      </ToolShell>

      {/* 高清页面放大预览弹窗 */}
      <AnimatePresence>
        {zoomPage !== null && (
          <div
            onClick={() => setZoomPage(null)}
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
                <span className="font-mono font-bold">
                  第 {zoomPage} / {pdfMeta.numPages} 页
                </span>
                <span className="text-muted-foreground hidden sm:inline">
                  · 导出尺寸 ≈ {estW} × {estH} px
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={exporting}
                    onClick={() => handleSinglePage(zoomPage, 'copy')}
                  >
                    <Copy />
                    复制图片
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={exporting}
                    onClick={() => handleSinglePage(zoomPage, 'download')}
                  >
                    <Download />
                    下载此页
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => setZoomPage(null)} aria-label="关闭">
                    <X className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="relative flex min-h-[360px] flex-1 items-center justify-center overflow-auto p-4 sm:p-6">
                {zoomLoading ? (
                  <Loader2 className="text-primary size-8 animate-spin" />
                ) : zoomUrl ? (
                  <img
                    src={zoomUrl}
                    alt={`第 ${zoomPage} 页`}
                    className="max-h-[72dvh] max-w-full rounded bg-white object-contain shadow-2xl"
                  />
                ) : null}

                {zoomPage > 1 && (
                  <button
                    type="button"
                    onClick={() => setZoomPage(zoomPage - 1)}
                    aria-label="上一页"
                    className="glass shadow-lift absolute top-1/2 left-3 flex size-10 -translate-y-1/2 items-center justify-center rounded-full transition-transform hover:scale-105"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                )}
                {zoomPage < pdfMeta.numPages && (
                  <button
                    type="button"
                    onClick={() => setZoomPage(zoomPage + 1)}
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
