import { AnimatePresence, motion } from 'motion/react'
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Circle,
  Download,
  EyeOff,
  FilePlus2,
  FileText,
  Grid3x3,
  Hash,
  Image as ImageIcon,
  Loader2,
  MousePointer2,
  Move,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Slider } from '@/components/ui/slider'
import { ColorPicker, Field, Switch } from '@/components/ui/field'
import { downloadBlob, timestampName } from '@/lib/file'
import { IMAGE_ACCEPT, decodeImageFile } from '@/lib/image'
import { isPdfFile, openPdfDocument, renderPdfPageToDataUrl, type OpenedPdf } from '@/lib/pdf'
import { cn, formatBytes, uid } from '@/lib/utils'
import { applyWatermarkBatchZip, applyWatermarkToPdf, drawPreviewOverlay, getRedactionsForPage } from './engine'
import { RedactOverlay } from './RedactOverlay'
import {
  ANCHOR_GRID,
  PAGENUM_POSITIONS,
  PAGENUM_STYLES,
  PDF_WM_PRESETS,
  REDACT_COLOR_PRESETS,
  defaultPdfWatermarkOptions,
  type ApplyScope,
  type FontStyle,
  type PageNumPos,
  type PageNumStyle,
  type PdfWatermarkOptions,
  type RedactMark,
  type RedactTool,
  type WatermarkLayout,
  type WatermarkType,
} from './types'

interface PdfEntry {
  id: string
  name: string
  size: number
  numPages: number
  bytes: Uint8Array
}

export default function PdfWatermark() {
  const [entries, setEntries] = useState<PdfEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewPage, setPreviewPage] = useState(1)
  const [pageBgUrl, setPageBgUrl] = useState('')
  const [pageSizePt, setPageSizePt] = useState<{ w: number; h: number }>({ w: 595, h: 842 })
  const [renderingPage, setRenderingPage] = useState(false)

  const [opts, setOpts] = useState<PdfWatermarkOptions>(defaultPdfWatermarkOptions)
  const [logo, setLogo] = useState<{ bitmap: ImageBitmap; url: string; name: string } | null>(null)
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  // ===== 内容打码遮挡状态（按文档 ID 独立存储） =====
  const [redactTool, setRedactTool] = useState<RedactTool>('select')
  const [redactColor, setRedactColor] = useState('#000000')
  const [redactAllPages, setRedactAllPages] = useState(false)
  const [redactionsByDoc, setRedactionsByDoc] = useState<Record<string, RedactMark[]>>({})
  const [selectedMarkId, setSelectedMarkId] = useState<string | null>(null)

  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const docsRef = useRef(new Map<string, OpenedPdf>())
  const logoRef = useRef(logo)
  logoRef.current = logo

  const set = <K extends keyof PdfWatermarkOptions>(k: K, v: PdfWatermarkOptions[K]) =>
    setOpts((prev) => ({ ...prev, [k]: v }))

  useEffect(
    () => () => {
      docsRef.current.forEach((d) => void d.destroy())
      docsRef.current.clear()
      if (logoRef.current) {
        logoRef.current.bitmap.close()
        URL.revokeObjectURL(logoRef.current.url)
      }
    },
    [],
  )

  const selected = useMemo(
    () => entries.find((e) => e.id === selectedId) ?? entries[0] ?? null,
    [entries, selectedId],
  )

  /** 载入一份或多份 PDF */
  const addPdfFiles = useCallback(async (files: File[]) => {
    const valid = files.filter(isPdfFile)
    if (!valid.length) {
      toast.error('请选择有效的 PDF 文件')
      return
    }
    setLoadingPdf(true)
    const added: PdfEntry[] = []

    for (const file of valid) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const opened = await openPdfDocument(bytes)
        const id = uid()
        docsRef.current.set(id, opened)
        added.push({
          id,
          name: file.name,
          size: file.size,
          numPages: opened.doc.numPages,
          bytes,
        })
      } catch {
        toast.error(`无法解析「${file.name}」，可能已加密或文件损坏`)
      }
    }

    if (added.length) {
      setEntries((prev) => [...prev, ...added])
      setSelectedId((prev) => prev ?? added[0].id)
      setPreviewPage(1)
      toast.success(`已载入 ${added.length} 份 PDF`)
    }
    setLoadingPdf(false)
  }, [])

  const removeEntry = (id: string) => {
    const d = docsRef.current.get(id)
    if (d) {
      void d.destroy()
      docsRef.current.delete(id)
    }
    setRedactionsByDoc((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setSelectedMarkId(null)
    setEntries((prev) => {
      const rest = prev.filter((e) => e.id !== id)
      setSelectedId((cur) => (cur === id ? (rest[0]?.id ?? null) : cur))
      return rest
    })
    setPreviewPage(1)
  }

  const clearAll = () => {
    docsRef.current.forEach((d) => void d.destroy())
    docsRef.current.clear()
    setEntries([])
    setRedactionsByDoc({})
    setSelectedMarkId(null)
    setSelectedId(null)
    setPageBgUrl('')
    setPreviewPage(1)
  }

  // 当前文档的打码遮挡操作辅助函数
  const currentDocMarks = useMemo(
    () => (selected ? (redactionsByDoc[selected.id] ?? []) : []),
    [selected, redactionsByDoc],
  )
  const currentPageMarks = useMemo(
    () => getRedactionsForPage(currentDocMarks, previewPage),
    [currentDocMarks, previewPage],
  )
  const totalRedactionCount = useMemo(
    () => Object.values(redactionsByDoc).reduce((sum, list) => sum + list.length, 0),
    [redactionsByDoc],
  )

  const addRedaction = useCallback(
    (mark: RedactMark) => {
      if (!selected) return
      setRedactionsByDoc((prev) => ({
        ...prev,
        [selected.id]: [...(prev[selected.id] ?? []), mark],
      }))
    },
    [selected],
  )

  const updateRedaction = useCallback(
    (id: string, patch: Partial<RedactMark>) => {
      if (!selected) return
      setRedactionsByDoc((prev) => ({
        ...prev,
        [selected.id]: (prev[selected.id] ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m)),
      }))
    },
    [selected],
  )

  const deleteRedaction = useCallback(
    (id: string) => {
      if (!selected) return
      setRedactionsByDoc((prev) => ({
        ...prev,
        [selected.id]: (prev[selected.id] ?? []).filter((m) => m.id !== id),
      }))
      setSelectedMarkId((cur) => (cur === id ? null : cur))
    },
    [selected],
  )

  const undoLastRedaction = useCallback(() => {
    if (!selected) return
    setRedactionsByDoc((prev) => {
      const list = prev[selected.id] ?? []
      if (!list.length) return prev
      const popped = list[list.length - 1]
      setSelectedMarkId((cur) => (cur === popped.id ? null : cur))
      return { ...prev, [selected.id]: list.slice(0, -1) }
    })
  }, [selected])

  const clearCurrentPageRedactions = () => {
    if (!selected) return
    setRedactionsByDoc((prev) => ({
      ...prev,
      [selected.id]: (prev[selected.id] ?? []).filter((m) => m.page !== previewPage && !m.applyAllPages),
    }))
    setSelectedMarkId(null)
  }

  const clearDocRedactions = () => {
    if (!selected) return
    setRedactionsByDoc((prev) => ({ ...prev, [selected.id]: [] }))
    setSelectedMarkId(null)
  }

  // 支持 Ctrl/⌘ + Z 撤销最近绘制的打码块
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /INPUT|TEXTAREA/.test(target.tagName)) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (currentDocMarks.length > 0) {
          e.preventDefault()
          undoLastRedaction()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [currentDocMarks.length, undoLastRedaction])

  const loadLogoFile = async (file: File) => {
    try {
      const decoded = await decodeImageFile(file)
      if (logoRef.current) {
        logoRef.current.bitmap.close()
        URL.revokeObjectURL(logoRef.current.url)
      }
      setLogo({ bitmap: decoded.bitmap, url: decoded.previewUrl, name: file.name })
      setOpts((p) => ({ ...p, enableWatermark: true, watermarkType: 'image' }))
    } catch {
      toast.error('无法解析该 Logo 图片')
    }
  }

  const removeLogo = () => {
    if (logo) {
      logo.bitmap.close()
      URL.revokeObjectURL(logo.url)
      setLogo(null)
    }
  }

  // 切换文档或翻页时清空选中态，避免误删非当前页打码块
  useEffect(() => {
    setSelectedMarkId(null)
  }, [selected?.id, previewPage])

  // 切换文档或翻页时渲染当前 PDF 页面的预览底图
  useEffect(() => {
    if (!selected) return
    const opened = docsRef.current.get(selected.id)
    if (!opened) return
    const safePage = Math.max(1, Math.min(selected.numPages, previewPage))
    if (safePage !== previewPage) setPreviewPage(safePage)

    let cancelled = false
    setRenderingPage(true)
    ;(async () => {
      try {
        const page = await opened.doc.getPage(safePage)
        const vp = page.getViewport({ scale: 1 })
        page.cleanup()
        const url = await renderPdfPageToDataUrl(opened.doc, safePage, 960)
        if (cancelled) return
        setPageSizePt({ w: vp.width, h: vp.height })
        setPageBgUrl(url)
      } finally {
        if (!cancelled) setRenderingPage(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selected, previewPage])

  // 水印/页码任意参数变动时，零延迟实时重绘预览叠加层
  useEffect(() => {
    const canvas = overlayCanvasRef.current
    if (!canvas || !selected) return
    const raf = requestAnimationFrame(() => {
      // 以 2× 逻辑分辨率渲染覆盖层确保预览文字锐利清晰
      const scale = Math.min(2, 1200 / Math.max(pageSizePt.w, pageSizePt.h))
      canvas.width = Math.max(1, Math.round(pageSizePt.w * scale))
      canvas.height = Math.max(1, Math.round(pageSizePt.h * scale))
      drawPreviewOverlay(
        canvas,
        pageSizePt.w,
        pageSizePt.h,
        previewPage - 1,
        selected.numPages,
        opts,
        logo?.bitmap ?? null,
      )
    })
    return () => cancelAnimationFrame(raf)
  }, [selected, previewPage, pageSizePt, opts, logo])

  /** 导出当前单份 PDF 或批量打包 ZIP */
  const canExport = opts.enableWatermark || opts.enablePageNum || totalRedactionCount > 0

  const onExport = async () => {
    if (!entries.length) return
    if (!canExport) {
      toast.info('请至少开启“水印”、“页码”或绘制一个打码遮挡块')
      return
    }
    setExporting(true)
    setProgress(null)
    try {
      if (entries.length === 1) {
        const item = entries[0]
        const docMarks = redactionsByDoc[item.id] ?? []
        const blob = await applyWatermarkToPdf(item.bytes, opts, logo?.bitmap ?? null, docMarks)
        const base = item.name.replace(/\.pdf$/i, '') || 'document'
        const suffix = docMarks.length > 0 && !opts.enableWatermark && !opts.enablePageNum ? '打码' : '处理'
        downloadBlob(blob, `${base}-${suffix}.pdf`)
        toast.success(`导出成功 · ${formatBytes(blob.size)}`)
      } else {
        setProgress({ done: 0, total: entries.length })
        const zipBlob = await applyWatermarkBatchZip(
          entries.map((e) => ({ name: e.name, bytes: e.bytes, redactions: redactionsByDoc[e.id] ?? [] })),
          opts,
          logo?.bitmap ?? null,
          (done, total) => setProgress({ done, total }),
        )
        downloadBlob(zipBlob, timestampName(`轻匣-PDF处理${entries.length}份`, 'zip'))
        toast.success(`已处理 ${entries.length} 份 PDF 并打包 ZIP · ${formatBytes(zipBlob.size)}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'PDF 导出失败')
    } finally {
      setExporting(false)
      setProgress(null)
    }
  }

  // 空状态
  if (!entries.length) {
    return (
      <div className="space-y-6">
        <FileDropzone
          accept=".pdf,application/pdf"
          multiple
          pasteable={false}
          onFiles={addPdfFiles}
          title={loadingPdf ? '正在解析 PDF 文档…' : '拖放一份或多份 PDF 到这里，加水印、页码或打码遮挡'}
          hint="支持中英文/Logo 水印、公文页码，以及在预览画布直接绘制矩形/圆形纯色打码（可选防复制彻底抹除）"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: <EyeOff />, t: '内容打码脱敏', d: '直接在页面上绘制矩形、圆形纯色遮挡（含白底涂改液），可选彻底抹除底层防复制文字' },
            { icon: <Grid3x3 />, t: '中文与 Logo 水印', d: '全屏斜向错行平铺或九宫格精准定位，内置保密/合同模板，原文件文字无损' },
            { icon: <Hash />, t: '公文级页码排版', d: '6 方位页码、5 种中英文格式，支持跳过封面与多文档批量打包' },
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

  const panel = (
    <>
      {/* ==================== 内容打码遮挡工具 ==================== */}
      <div className="space-y-3.5 border-b pb-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-foreground/90 flex items-center gap-1.5 text-sm font-semibold">
              <EyeOff className="text-primary size-4" />
              <span>内容打码遮挡</span>
            </div>
            <div className="text-muted-foreground text-xs">在右侧预览页直接拖拽绘制纯色遮挡</div>
          </div>
          {currentDocMarks.length > 0 && (
            <span className="bg-primary/12 text-primary rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold">
              {currentDocMarks.length} 处
            </span>
          )}
        </div>

        <Segmented<RedactTool>
          size="sm"
          value={redactTool}
          onChange={setRedactTool}
          options={[
            { value: 'select', label: '选择调整', icon: <MousePointer2 className="!size-3.5" /> },
            { value: 'rect', label: '画矩形', icon: <Square className="!size-3.5" /> },
            { value: 'ellipse', label: '画圆形', icon: <Circle className="!size-3.5" /> },
          ]}
        />

        <Field
          label="遮挡纯色"
          value={redactColor.toLowerCase() === '#ffffff' ? '纯白（涂改液）' : redactColor.toUpperCase()}
        >
          <ColorPicker
            value={redactColor}
            onChange={(v) => setRedactColor(v === 'transparent' ? '#000000' : v)}
            presets={REDACT_COLOR_PRESETS}
          />
        </Field>

        {selected && selected.numPages > 1 && (
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-foreground/80 text-xs font-medium">新绘制自动应用全部页</div>
              <div className="text-muted-foreground text-[11px]">适合统一遮挡每页固定页眉/编号</div>
            </div>
            <Switch checked={redactAllPages} onChange={setRedactAllPages} label="新绘制自动应用全部页" />
          </div>
        )}

        <div className="bg-foreground/[0.03] space-y-1.5 rounded-xl border p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <ShieldCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              彻底抹除底层文字（防复制）
            </span>
            <Switch
              checked={opts.flattenRedactedPages}
              onChange={(v) => set('flattenRedactedPages', v)}
              label="彻底抹除底层文字"
            />
          </div>
          <p className="text-muted-foreground text-[11px] leading-relaxed">
            {opts.flattenRedactedPages
              ? '已开启：仅将有打码的页面高清栅格化烘焙，底层敏感文字彻底不可选中复制；其余页面仍保持矢量无损。'
              : '默认矢量色块遮挡，体积最小；若涉高度敏感信息，建议开启上方防复制物理抹除。'}
          </p>
        </div>

        {currentDocMarks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" onClick={undoLastRedaction}>
              <Undo2 className="!size-3.5" />
              撤销
            </Button>
            {currentPageMarks.length > 0 && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearCurrentPageRedactions}>
                清本页 ({currentPageMarks.length})
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-rose-500 hover:text-rose-600"
              onClick={clearDocRedactions}
            >
              清全部
            </Button>
          </div>
        )}
      </div>

      {/* ==================== 水印层开关与设置 ==================== */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-foreground/90 text-sm font-semibold">添加水印</div>
            <div className="text-muted-foreground text-xs">文字或透明图片 Logo 水印</div>
          </div>
          <Switch checked={opts.enableWatermark} onChange={(v) => set('enableWatermark', v)} label="添加水印" />
        </div>

        {opts.enableWatermark && (
          <div className="space-y-4">
            {/* 快捷场景预设 */}
            <div className="grid grid-cols-3 gap-1.5">
              {PDF_WM_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setOpts((prev) => ({ ...prev, ...p.patch }))}
                  className="bg-card-solid/60 hover:border-primary/40 hover:bg-primary/5 flex flex-col items-start rounded-xl border px-2.5 py-2 text-left transition-all active:scale-[0.98]"
                >
                  <span className="flex items-center gap-1 text-xs font-semibold">
                    <Sparkles className="text-primary size-3" />
                    {p.label}
                  </span>
                  <span className="text-muted-foreground mt-0.5 line-clamp-1 text-[10px]">{p.desc}</span>
                </button>
              ))}
            </div>

            <Segmented<WatermarkType>
              size="sm"
              value={opts.watermarkType}
              onChange={(v) => set('watermarkType', v)}
              options={[
                { value: 'text', label: '文字水印', icon: <Type /> },
                { value: 'image', label: '图片 Logo', icon: <ImageIcon /> },
              ]}
            />

            {opts.watermarkType === 'text' ? (
              <div className="space-y-4">
                <Field label="水印内容" value="支持中文与换行">
                  <textarea
                    rows={2}
                    value={opts.text}
                    onChange={(e) => set('text', e.target.value)}
                    placeholder="输入水印文字，支持多行…"
                    className="bg-card-solid focus:ring-ring/50 w-full resize-none rounded-xl border px-3 py-2 text-xs outline-none focus:ring-2"
                  />
                </Field>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <Segmented<FontStyle>
                      size="sm"
                      value={opts.fontStyle}
                      onChange={(v) => set('fontStyle', v)}
                      options={[
                        { value: 'sans', label: '黑体' },
                        { value: 'serif', label: '宋体' },
                        { value: 'mono', label: '等宽' },
                      ]}
                    />
                  </div>
                  <Button
                    variant={opts.bold ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => set('bold', !opts.bold)}
                    className="font-bold"
                  >
                    B
                  </Button>
                </div>
                <Field label="水印颜色" value={opts.color}>
                  <ColorPicker
                    value={opts.color}
                    onChange={(v) => set('color', v === 'transparent' ? '#64748b' : v)}
                    presets={['#64748b', '#dc2626', '#2563eb', '#18181b', '#d97706', '#059669']}
                  />
                </Field>
                <Field label="文字大小" value={`${opts.fontSize} pt`}>
                  <Slider value={opts.fontSize} min={12} max={84} onChange={(v) => set('fontSize', v)} />
                </Field>
              </div>
            ) : (
              <div className="space-y-4">
                <Field label="上传 Logo">
                  {logo ? (
                    <div className="bg-card-solid flex items-center gap-2.5 rounded-xl border p-2">
                      <div className="checkerboard size-10 shrink-0 overflow-hidden rounded-lg border p-1">
                        <img src={logo.url} alt="" className="size-full object-contain" />
                      </div>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">{logo.name}</span>
                      <Button variant="ghost" size="icon-sm" onClick={removeLogo}>
                        <X className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    <label className="hover:border-primary/50 hover:text-primary text-muted-foreground flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed py-4 text-xs transition-colors">
                      <Upload className="size-4" />
                      <span>选择透明 PNG / SVG / WebP 图标</span>
                      <input
                        type="file"
                        hidden
                        accept={IMAGE_ACCEPT}
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) void loadLogoFile(f)
                          e.target.value = ''
                        }}
                      />
                    </label>
                  )}
                </Field>
                <Field label="Logo 宽度" value={`${opts.logoWidth} pt`}>
                  <Slider value={opts.logoWidth} min={40} max={360} step={8} onChange={(v) => set('logoWidth', v)} />
                </Field>
              </div>
            )}

            {/* 排布方式 */}
            <Field label="排布方式">
              <Segmented<WatermarkLayout>
                size="sm"
                value={opts.layout}
                onChange={(v) => set('layout', v)}
                options={[
                  { value: 'tile', label: '全屏平铺', icon: <Grid3x3 /> },
                  { value: 'single', label: '九宫格', icon: <Move /> },
                ]}
              />
            </Field>

            {opts.layout === 'tile' ? (
              <div className="space-y-3">
                <Field label="水平间距" value={`${opts.gapX} pt`}>
                  <Slider value={opts.gapX} min={30} max={280} step={5} onChange={(v) => set('gapX', v)} />
                </Field>
                <Field label="垂直间距" value={`${opts.gapY} pt`}>
                  <Slider value={opts.gapY} min={30} max={280} step={5} onChange={(v) => set('gapY', v)} />
                </Field>
                <div className="flex items-center justify-between">
                  <span className="text-foreground/80 text-xs font-medium">错行交错排布</span>
                  <Switch checked={opts.stagger} onChange={(v) => set('stagger', v)} label="错行交错排布" />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-1.5">
                  {ANCHOR_GRID.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => set('anchor', a.id)}
                      className={cn(
                        'rounded-lg border py-1.5 text-xs transition-colors',
                        opts.anchor === a.id
                          ? 'border-primary bg-primary/10 text-primary font-semibold'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
                <Field label="边缘边距" value={`${opts.margin} pt`}>
                  <Slider value={opts.margin} min={0} max={120} step={4} onChange={(v) => set('margin', v)} />
                </Field>
              </div>
            )}

            <Field label="不透明度" value={`${opts.opacity}%`}>
              <Slider value={opts.opacity} min={5} max={100} onChange={(v) => set('opacity', v)} />
            </Field>
            <Field label="旋转角度" value={`${opts.angle}°`}>
              <Slider value={opts.angle} min={-90} max={90} onChange={(v) => set('angle', v)} />
            </Field>

            <Field label="水印生效页面">
              <Segmented<ApplyScope>
                size="sm"
                value={opts.scope}
                onChange={(v) => set('scope', v)}
                options={[
                  { value: 'all', label: '全部页' },
                  { value: 'skip-first', label: '跳过首页' },
                  { value: 'custom', label: '指定页' },
                ]}
              />
              {opts.scope === 'custom' && (
                <input
                  type="text"
                  value={opts.customRange}
                  onChange={(e) => set('customRange', e.target.value)}
                  placeholder="例如：2-5, 8"
                  className="bg-card-solid focus:ring-ring/50 mt-2 h-8.5 w-full rounded-xl border px-3 font-mono text-xs outline-none focus:ring-2"
                />
              )}
            </Field>
          </div>
        )}
      </div>

      {/* ==================== 页码层开关与设置 ==================== */}
      <div className="space-y-4 border-t pt-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-foreground/90 text-sm font-semibold">添加页码</div>
            <div className="text-muted-foreground text-xs">底部或顶部自动编号</div>
          </div>
          <Switch checked={opts.enablePageNum} onChange={(v) => set('enablePageNum', v)} label="添加页码" />
        </div>

        {opts.enablePageNum && (
          <div className="space-y-4">
            <Field label="页码格式">
              <div className="flex flex-wrap gap-1.5">
                {PAGENUM_STYLES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => set('pageNumStyle', s.value as PageNumStyle)}
                    className={cn(
                      'rounded-lg border px-2.5 py-1 text-xs transition-colors',
                      opts.pageNumStyle === s.value
                        ? 'border-primary bg-primary/10 text-primary font-semibold'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="页码位置">
              <div className="grid grid-cols-3 gap-1.5">
                {PAGENUM_POSITIONS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => set('pageNumPos', p.id as PageNumPos)}
                    className={cn(
                      'rounded-lg border py-1.5 text-xs transition-colors',
                      opts.pageNumPos === p.id
                        ? 'border-primary bg-primary/10 text-primary font-semibold'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="字号" value={`${opts.pageNumSize}pt`}>
                <Slider value={opts.pageNumSize} min={8} max={24} onChange={(v) => set('pageNumSize', v)} />
              </Field>
              <Field label="距边缘" value={`${opts.pageNumMargin}pt`}>
                <Slider value={opts.pageNumMargin} min={8} max={64} step={2} onChange={(v) => set('pageNumMargin', v)} />
              </Field>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-foreground/80 text-xs font-medium">封面首页不编页码</span>
              <Switch
                checked={opts.pageNumSkipFirst}
                onChange={(v) => set('pageNumSkipFirst', v)}
                label="封面首页不编页码"
              />
            </div>

            <Field label="页码颜色" value={opts.pageNumColor}>
              <ColorPicker
                value={opts.pageNumColor}
                onChange={(v) => set('pageNumColor', v === 'transparent' ? '#475569' : v)}
                presets={['#475569', '#18181b', '#64748b', '#94a3b8', '#2563eb']}
              />
            </Field>
          </div>
        )}
      </div>
    </>
  )

  const actions = (
    <Button variant="primary" size="lg" onClick={onExport} disabled={exporting || !canExport}>
      {exporting ? <Loader2 className="animate-spin" /> : entries.length > 1 ? <Archive /> : <Download />}
      {progress
        ? `处理中 ${progress.done}/${progress.total}…`
        : exporting
          ? '正在生成 PDF…'
          : entries.length > 1
            ? `批量导出 ZIP（${entries.length} 份）`
            : totalRedactionCount > 0 && !opts.enableWatermark && !opts.enablePageNum
              ? '导出打码 PDF'
              : '导出处理后 PDF'}
    </Button>
  )

  return (
    <ToolShell panel={panel} actions={actions} panelTitle="打码、水印与页码设置">
      <div className="space-y-4">
        {/* 顶栏信息与翻页器 */}
        {selected && (
          <div className="glass shadow-soft flex flex-wrap items-center gap-2 rounded-2xl px-3.5 py-2.5 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 font-medium">
              <FileText className="text-primary size-4 shrink-0" />
              <span className="max-w-[180px] truncate sm:max-w-xs">{selected.name}</span>
            </span>

            {/* 翻页控制 */}
            <div className="bg-foreground/[0.05] ml-auto flex items-center gap-1 rounded-xl p-0.5 sm:ml-2">
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={previewPage <= 1}
                onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                aria-label="上一页"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="px-2 font-mono text-xs tabular-nums">
                {previewPage} / {selected.numPages}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={previewPage >= selected.numPages}
                onClick={() => setPreviewPage((p) => Math.min(selected.numPages, p + 1))}
                aria-label="下一页"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>

            <div className="flex items-center gap-1 sm:ml-auto">
              <label className="cursor-pointer">
                <span className="bg-muted hover:bg-foreground/10 inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition-colors">
                  <FilePlus2 className="size-3.5" />
                  加 PDF
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
              <Button variant="ghost" size="sm" onClick={clearAll} className="text-muted-foreground hover:text-red-500">
                <Trash2 />
                清空
              </Button>
            </div>
          </div>
        )}

        {/* 画布快捷打码工具条（就在预览正上方，随手切换矩形/圆形/涂黑/涂白与撤销） */}
        {selected && (
          <div className="glass flex flex-wrap items-center justify-between gap-2 rounded-2xl px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground mr-0.5 hidden font-medium sm:inline">画布打码：</span>
              {(
                [
                  { id: 'select', label: '选择', icon: <MousePointer2 className="size-3.5" /> },
                  { id: 'rect', label: '矩形遮挡', icon: <Square className="size-3.5" /> },
                  { id: 'ellipse', label: '圆形遮挡', icon: <Circle className="size-3.5" /> },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setRedactTool(item.id)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-xl px-2.5 py-1 font-medium transition',
                    redactTool === item.id
                      ? 'bg-primary text-primary-foreground shadow-xs'
                      : 'bg-foreground/[0.05] text-muted-foreground hover:text-foreground',
                  )}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}

              <div className="bg-border mx-1 h-4 w-px" />

              {REDACT_COLOR_PRESETS.slice(0, 4).map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c === '#000000' ? '纯黑打码' : c === '#ffffff' ? '纯白涂改液' : c}
                  onClick={() => setRedactColor(c)}
                  className={cn(
                    'size-5 rounded-full border border-black/20 transition-transform hover:scale-110 dark:border-white/20',
                    redactColor.toLowerCase() === c && 'ring-primary ring-offset-background ring-2 ring-offset-1',
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>

            <div className="text-muted-foreground flex items-center gap-2">
              <span className="hidden md:inline">
                {redactTool === 'select'
                  ? '点选色块可拖动/四角缩放'
                  : '在页面拖拽绘制（按住 Shift 锁正圆/正方形）'}
              </span>
              {currentDocMarks.length > 0 && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={undoLastRedaction}>
                  <Undo2 className="!size-3.5" />
                  撤销
                </Button>
              )}
            </div>
          </div>
        )}

        {/* 所见即所得实时预览画布（PDF 底图 + 交互式打码遮挡层 + 水印页码叠加层） */}
        <div className="checkerboard shadow-soft relative flex h-[min(68dvh,720px)] min-h-[340px] w-full items-center justify-center overflow-hidden rounded-3xl border p-4 sm:p-6">
          {pageBgUrl ? (
            <div
              className="relative max-h-full max-w-full rounded-sm bg-white shadow-2xl"
              style={{
                aspectRatio: `${pageSizePt.w} / ${pageSizePt.h}`,
                height: pageSizePt.h >= pageSizePt.w ? '100%' : undefined,
                width: pageSizePt.w > pageSizePt.h ? '100%' : undefined,
              }}
            >
              <img
                src={pageBgUrl}
                alt={`第 ${previewPage} 页预览`}
                draggable={false}
                className="block size-full rounded-sm object-contain"
              />
              {/* 交互式矩形/圆形打码遮挡层 */}
              {selected && (
                <RedactOverlay
                  page={previewPage}
                  totalPages={selected.numPages}
                  marks={currentPageMarks}
                  tool={redactTool}
                  drawColor={redactColor}
                  defaultAllPages={redactAllPages}
                  selectedMarkId={selectedMarkId}
                  onSelectMark={setSelectedMarkId}
                  onAddMark={addRedaction}
                  onUpdateMark={updateRedaction}
                  onDeleteMark={deleteRedaction}
                />
              )}
              {/* 实时水印与页码 Canvas 覆盖层 */}
              <canvas
                ref={overlayCanvasRef}
                className="pointer-events-none absolute inset-0 z-20 size-full"
              />
            </div>
          ) : (
            <Loader2 className="text-primary size-8 animate-spin" />
          )}

          <AnimatePresence>
            {(renderingPage || exporting) && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="bg-background/40 absolute inset-0 z-30 flex items-center justify-center backdrop-blur-[1px]"
              >
                <div className="glass shadow-lift flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium">
                  <Loader2 className="text-primary size-4 animate-spin" />
                  {exporting
                    ? opts.flattenRedactedPages && totalRedactionCount > 0
                      ? '正在高清脱敏烘焙并写入 PDF…'
                      : '正在写入 PDF 打码、水印与页码…'
                    : '正在渲染页面…'}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 多份 PDF 批量队列条 */}
        {entries.length > 1 && (
          <div className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-1">
            {entries.map((e) => {
              const active = selected?.id === e.id
              return (
                <div
                  key={e.id}
                  onClick={() => {
                    setSelectedId(e.id)
                    setPreviewPage(1)
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault()
                      setSelectedId(e.id)
                      setPreviewPage(1)
                    }
                  }}
                  className={cn(
                    'bg-card relative flex w-48 shrink-0 cursor-pointer items-center gap-2 rounded-xl border py-2 pr-7 pl-3 text-xs transition-all',
                    active ? 'border-primary ring-primary/20 font-semibold ring-2' : 'hover:border-foreground/20',
                  )}
                >
                  <FileText className="text-primary size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{e.name}</div>
                    <div className="text-muted-foreground font-mono text-[10px]">
                      {e.numPages} 页 · {formatBytes(e.size)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation()
                      removeEntry(e.id)
                    }}
                    aria-label="移除"
                    className="text-muted-foreground absolute top-2 right-1.5 flex size-5 items-center justify-center rounded hover:bg-red-500/15 hover:text-red-500"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </ToolShell>
  )
}
