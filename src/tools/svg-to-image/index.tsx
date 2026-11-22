import { AnimatePresence, motion } from 'motion/react'
import {
  AlertCircle,
  Archive,
  Code2,
  Copy,
  Download,
  FileCode2,
  Link2,
  Link2Off,
  Loader2,
  Sparkles,
  Trash2,
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
import { ColorPicker, Field } from '@/components/ui/field'
import { copyImageToClipboard, downloadBlob, timestampName } from '@/lib/file'
import { cn, formatBytes, uid } from '@/lib/utils'
import {
  DEMO_SVG,
  FORMAT_EXT,
  blobToDataUrl,
  computeSvgOutputSize,
  defaultSvgOptions,
  exportSvgBatchZip,
  parseSvgCode,
  renderSvgToBlob,
  type ExportFormat,
  type SizeMode,
  type SvgExportOptions,
} from './engine'

interface SvgItem {
  id: string
  name: string
  code: string
}

const SCALE_OPTIONS = [
  { value: '1', label: '1×' },
  { value: '2', label: '2×' },
  { value: '3', label: '3×' },
  { value: '4', label: '4×' },
  { value: '8', label: '8×' },
]

export default function SvgToImage() {
  const [items, setItems] = useState<SvgItem[]>([{ id: 'editor', name: 'icon.svg', code: '' }])
  const [selectedId, setSelectedId] = useState<string>('editor')
  const [opts, setOpts] = useState<SvgExportOptions>(defaultSvgOptions)
  const [lockRatio, setLockRatio] = useState(true)
  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const previewUrlRef = useRef(previewUrl)
  previewUrlRef.current = previewUrl

  const set = <K extends keyof SvgExportOptions>(k: K, v: SvgExportOptions[K]) =>
    setOpts((prev) => ({ ...prev, [k]: v }))

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    },
    [],
  )

  const current = useMemo(
    () => items.find((it) => it.id === selectedId) ?? items[0],
    [items, selectedId],
  )

  const parsed = useMemo(() => parseSvgCode(current.code), [current.code])
  const outSize = useMemo(
    () => (parsed.ok ? computeSvgOutputSize(parsed.width, parsed.height, opts) : null),
    [parsed, opts],
  )

  // 当选中 SVG 的原生尺寸变化时，若当前在倍率模式，同步默认自定义宽高方便切换
  useEffect(() => {
    if (!parsed.ok) return
    setOpts((prev) =>
      prev.sizeMode === 'scale'
        ? { ...prev, customWidth: parsed.width * prev.scale, customHeight: parsed.height * prev.scale }
        : prev,
    )
  }, [parsed.ok ? parsed.width : 0, parsed.ok ? parsed.height : 0])

  // 实时生成预览图（防抖 120ms，代码输入或滑块拖动不卡顿）
  useEffect(() => {
    if (!parsed.ok) {
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return ''
      })
      return
    }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        // 预览图限幅在 1200px 以内加快实时响应，导出时按完整分辨率渲染
        const dim = computeSvgOutputSize(parsed.width, parsed.height, opts)
        const previewRatio = Math.min(1, 1200 / Math.max(dim.totalW, dim.totalH))
        const previewOpts: SvgExportOptions = {
          ...opts,
          sizeMode: 'custom',
          customWidth: Math.max(1, Math.round(dim.contentW * previewRatio)),
          customHeight: Math.max(1, Math.round(dim.contentH * previewRatio)),
          padding: Math.round(dim.pad * previewRatio),
        }
        const { blob } = await renderSvgToBlob(parsed, previewOpts)
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return url
        })
      } catch {
        // 忽略无效中间态
      }
    }, 120)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [parsed, opts])

  /** 读取上传的 .svg 文件（支持单文件与多文件批量） */
  const addSvgFiles = useCallback(async (files: File[]) => {
    const valid = files.filter((f) => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name))
    if (!valid.length) {
      toast.error('请选择 .svg 格式的矢量文件')
      return
    }
    const loaded: SvgItem[] = await Promise.all(
      valid.map(async (f) => ({
        id: uid(),
        name: f.name,
        code: await f.text(),
      })),
    )

    setItems((prev) => {
      // 如果当前只有一个空白初始项，直接替换掉
      if (prev.length === 1 && !prev[0].code.trim()) {
        return loaded
      }
      return [...prev, ...loaded]
    })
    setSelectedId(loaded[0].id)
    toast.success(`已载入 ${loaded.length} 个 SVG 文件`)
  }, [])

  const updateCurrentCode = (nextCode: string) => {
    setItems((prev) => prev.map((it) => (it.id === current.id ? { ...it, code: nextCode } : it)))
  }

  const removeItem = (id: string) => {
    setItems((prev) => {
      const rest = prev.filter((it) => it.id !== id)
      if (!rest.length) {
        const empty = { id: 'editor', name: 'icon.svg', code: '' }
        setSelectedId(empty.id)
        return [empty]
      }
      setSelectedId((cur) => (cur === id ? rest[0].id : cur))
      return rest
    })
  }

  const handleCustomW = (val: number) => {
    const w = Math.max(1, Math.min(8192, val || 1))
    if (lockRatio && parsed.ok) {
      setOpts((prev) => ({
        ...prev,
        customWidth: w,
        customHeight: Math.max(1, Math.round((w * parsed.height) / parsed.width)),
      }))
    } else {
      set('customWidth', w)
    }
  }

  const handleCustomH = (val: number) => {
    const h = Math.max(1, Math.min(8192, val || 1))
    if (lockRatio && parsed.ok) {
      setOpts((prev) => ({
        ...prev,
        customHeight: h,
        customWidth: Math.max(1, Math.round((h * parsed.width) / parsed.height)),
      }))
    } else {
      set('customHeight', h)
    }
  }

  /** 导出当前单张位图或复制到剪贴板 / DataURL */
  const onExportCurrent = async (mode: 'download' | 'copy' | 'dataurl') => {
    if (!parsed.ok) {
      toast.error(parsed.error)
      return
    }
    setExporting(true)
    try {
      const { blob, width, height } = await renderSvgToBlob(parsed, opts, mode === 'copy')
      if (mode === 'copy') {
        await copyImageToClipboard(blob)
        toast.success(`已复制位图到剪贴板 · ${width}×${height}`)
      } else if (mode === 'dataurl') {
        const dataUrl = await blobToDataUrl(blob)
        await navigator.clipboard.writeText(dataUrl)
        toast.success(`已复制 Base64 DataURL（${formatBytes(dataUrl.length)}）`)
      } else {
        const base = current.name.replace(/\.svg$/i, '') || 'svg-image'
        downloadBlob(blob, `${base}-${width}x${height}.${FORMAT_EXT[opts.format]}`)
        toast.success(`导出成功 · ${width}×${height} · ${formatBytes(blob.size)}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  /** 批量导出全部 SVG 为 ZIP */
  const onExportBatchZip = async () => {
    const validItems = items.filter((it) => it.code.trim().length > 0)
    if (!validItems.length) return
    if (validItems.length === 1) {
      await onExportCurrent('download')
      return
    }
    setExporting(true)
    setProgress({ done: 0, total: validItems.length })
    try {
      const zipBlob = await exportSvgBatchZip(validItems, opts, (done, total) => setProgress({ done, total }))
      downloadBlob(zipBlob, timestampName(`轻匣-SVG转${opts.format.toUpperCase()}`, 'zip'))
      toast.success(`已批量导出 ${validItems.length} 张图片 · ${formatBytes(zipBlob.size)}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '批量打包失败')
    } finally {
      setExporting(false)
      setProgress(null)
    }
  }

  const validCount = items.filter((it) => it.code.trim().length > 0).length

  const panel = (
    <>
      {/* 输出尺寸模式 */}
      <Field label="尺寸方式" value={outSize ? `${outSize.totalW} × ${outSize.totalH} px` : undefined}>
        <Segmented<SizeMode>
          size="sm"
          value={opts.sizeMode}
          onChange={(v) => set('sizeMode', v)}
          options={[
            { value: 'scale', label: '按倍率' },
            { value: 'custom', label: '自定义像素' },
          ]}
        />
      </Field>

      {opts.sizeMode === 'scale' ? (
        <Field label="缩放倍率" value={`${opts.scale}×`}>
          <Segmented
            size="sm"
            value={String(opts.scale)}
            onChange={(v) => set('scale', Number(v))}
            options={SCALE_OPTIONS}
          />
        </Field>
      ) : (
        <div className="flex items-center gap-2">
          <label className="flex-1 space-y-1">
            <span className="text-muted-foreground text-[11px]">内容宽 (px)</span>
            <input
              type="number"
              min={1}
              max={8192}
              value={opts.customWidth}
              onChange={(e) => handleCustomW(Number(e.target.value))}
              className="bg-card-solid focus:ring-ring/50 h-9 w-full rounded-xl border px-3 font-mono text-sm outline-none focus:ring-2"
            />
          </label>
          <button
            type="button"
            onClick={() => setLockRatio((v) => !v)}
            title={lockRatio ? '已锁定宽高比' : '自由宽高'}
            className={cn(
              'mt-5 flex size-9 shrink-0 items-center justify-center rounded-xl border transition-colors',
              lockRatio ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground',
            )}
          >
            {lockRatio ? <Link2 className="size-4" /> : <Link2Off className="size-4" />}
          </button>
          <label className="flex-1 space-y-1">
            <span className="text-muted-foreground text-[11px]">内容高 (px)</span>
            <input
              type="number"
              min={1}
              max={8192}
              value={opts.customHeight}
              onChange={(e) => handleCustomH(Number(e.target.value))}
              className="bg-card-solid focus:ring-ring/50 h-9 w-full rounded-xl border px-3 font-mono text-sm outline-none focus:ring-2"
            />
          </label>
        </div>
      )}

      {/* 留白与背景色 */}
      <div className="space-y-4 border-t pt-4">
        <Field label="四周留白" value={opts.padding === 0 ? '无' : `${opts.padding} px`}>
          <Slider value={opts.padding} min={0} max={120} step={4} onChange={(v) => set('padding', v)} />
        </Field>

        <Field label="背景颜色" value={opts.background === 'transparent' ? '透明' : opts.background}>
          <ColorPicker value={opts.background} onChange={(v) => set('background', v)} />
        </Field>

        {parsed.ok && parsed.usesCurrentColor && (
          <Field label="currentColor 图标色" value={opts.currentColor}>
            <ColorPicker
              value={opts.currentColor}
              onChange={(v) => set('currentColor', v)}
              presets={['#111827', '#ffffff', '#6366f1', '#ec4899', '#10b981', '#f59e0b', '#0ea5e9']}
            />
          </Field>
        )}
      </div>

      {/* 导出格式与 DataURL */}
      <div className="space-y-4 border-t pt-4">
        <Field label="导出格式">
          <Segmented<ExportFormat>
            size="sm"
            value={opts.format}
            onChange={(v) => set('format', v)}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'webp', label: 'WebP' },
              { value: 'jpeg', label: 'JPG' },
            ]}
          />
        </Field>
        {opts.format !== 'png' && (
          <Field label="输出质量" value={`${opts.quality}%`}>
            <Slider value={opts.quality} min={50} max={100} onChange={(v) => set('quality', v)} />
          </Field>
        )}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={!parsed.ok || exporting}
          onClick={() => onExportCurrent('dataurl')}
        >
          <Code2 />
          复制 Base64 DataURL
        </Button>
      </div>
    </>
  )

  const actions =
    validCount > 1 ? (
      <Button variant="primary" size="lg" onClick={onExportBatchZip} disabled={exporting}>
        {exporting ? <Loader2 className="animate-spin" /> : <Archive />}
        {progress ? `转换中 ${progress.done}/${progress.total}…` : `批量打包 ZIP（${validCount} 个）`}
      </Button>
    ) : (
      <>
        <Button
          variant="outline"
          size="lg"
          onClick={() => onExportCurrent('copy')}
          disabled={!parsed.ok || exporting}
          className="max-lg:!flex-none max-lg:px-4"
        >
          <Copy />
          <span className="max-sm:hidden">复制</span>
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={() => onExportCurrent('download')}
          disabled={!parsed.ok || exporting}
        >
          {exporting ? <Loader2 className="animate-spin" /> : <Download />}
          {exporting ? '渲染中…' : `导出 .${FORMAT_EXT[opts.format]}`}
        </Button>
      </>
    )

  return (
    <ToolShell panel={panel} actions={actions} panelTitle="渲染参数">
      <div className="space-y-5">
        {/* 上半区：实时位图预览 */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="max-w-[200px] truncate font-medium sm:max-w-xs">{current.name}</span>
            {parsed.ok && outSize && (
              <span className="glass rounded-full px-2.5 py-1 font-mono tabular-nums">
                原生 {parsed.width}×{parsed.height} → 导出 {outSize.totalW}×{outSize.totalH} px
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              {validCount > 1 && parsed.ok && (
                <Button variant="secondary" size="sm" onClick={() => onExportCurrent('download')} disabled={exporting}>
                  <Download />
                  导出当前
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => updateCurrentCode(DEMO_SVG)}>
                <Sparkles />
                示例 SVG
              </Button>
              <label className="cursor-pointer">
                <span className="bg-muted hover:bg-foreground/10 inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors">
                  <Upload className="size-3.5" />
                  上传 .svg
                </span>
                <input
                  type="file"
                  hidden
                  multiple
                  accept=".svg,image/svg+xml"
                  onChange={(e) => {
                    if (e.target.files?.length) void addSvgFiles(Array.from(e.target.files))
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
          </div>

          <div className="checkerboard shadow-soft relative flex h-[min(44dvh,420px)] min-h-[220px] w-full items-center justify-center overflow-hidden rounded-3xl border p-4 sm:p-6">
            {previewUrl ? (
              <motion.img
                key={previewUrl}
                initial={{ opacity: 0.5, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.18 }}
                src={previewUrl}
                alt="SVG 渲染预览"
                className="shadow-lift max-h-full max-w-full object-contain"
              />
            ) : current.code.trim() && !parsed.ok ? (
              <div className="flex flex-col items-center gap-2 text-center text-sm text-red-500">
                <AlertCircle className="size-8" />
                <span>{parsed.error}</span>
              </div>
            ) : (
              <div className="text-muted-foreground flex flex-col items-center gap-3 text-center text-sm">
                <FileCode2 className="size-10 opacity-35" />
                <div>在下方粘贴 SVG 代码，或拖放 .svg 文件到这里</div>
                <Button variant="outline" size="sm" onClick={() => updateCurrentCode(DEMO_SVG)}>
                  <Sparkles className="text-primary" />
                  加载示例 SVG
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* 多文件批量列表（上传多个 .svg 时显示） */}
        <AnimatePresence>
          {items.length > 1 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-1"
            >
              {items.map((it) => {
                const active = it.id === current.id
                return (
                  <div
                    key={it.id}
                    onClick={() => setSelectedId(it.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSelectedId(it.id)
                      }
                    }}
                    className={cn(
                      'bg-card relative flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border py-1.5 pr-7 pl-3 text-xs transition-all',
                      active ? 'border-primary ring-primary/20 font-semibold ring-2' : 'hover:border-foreground/20',
                    )}
                  >
                    <FileCode2 className="text-primary size-3.5 shrink-0" />
                    <span className="max-w-[140px] truncate">{it.name}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeItem(it.id)
                      }}
                      aria-label="移除"
                      className="text-muted-foreground absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded hover:bg-red-500/15 hover:text-red-500"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* 下半区：实时 SVG 代码编辑器 + 紧凑文件拖放区 */}
        <div className="glass shadow-soft overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b px-4 py-2.5 text-xs">
            <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
              <Code2 className="size-3.5" />
              SVG 源码（实时编辑，自动同步上方预览）
            </span>
            {current.code && (
              <button
                type="button"
                onClick={() => updateCurrentCode('')}
                className="text-muted-foreground hover:text-red-500 flex items-center gap-1 transition-colors"
              >
                <Trash2 className="size-3.5" />
                清空
              </button>
            )}
          </div>
          <textarea
            rows={7}
            spellCheck={false}
            value={current.code}
            onChange={(e) => updateCurrentCode(e.target.value)}
            placeholder='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">...</svg>'
            className="placeholder:text-muted-foreground/60 w-full resize-y bg-transparent p-4 font-mono text-xs leading-relaxed outline-none"
          />
        </div>

        <FileDropzone
          compact
          accept=".svg,image/svg+xml"
          multiple
          pasteable={false}
          onFiles={addSvgFiles}
          title="拖放或点击上传单个 / 多个 .svg 文件（支持批量转图打包 ZIP）"
        />
      </div>
    </ToolShell>
  )
}
