import { AnimatePresence, motion } from 'motion/react'
import {
  Archive,
  Copy,
  Download,
  Grid3x3,
  Image as ImageIcon,
  Layers,
  Loader2,
  Move,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { toast } from 'sonner'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Slider } from '@/components/ui/slider'
import { ColorPicker, Field, Switch } from '@/components/ui/field'
import { copyImageToClipboard, downloadBlob, timestampName } from '@/lib/file'
import { IMAGE_ACCEPT, decodeImageFile, isImageLike } from '@/lib/image'
import { cn, formatBytes, uid } from '@/lib/utils'
import { exportBatchWatermarkZip, exportWatermarkedBlob, renderWatermarkedCanvas } from './engine'
import {
  ANCHOR_GRID,
  BLEND_MODES,
  WATERMARK_PRESETS,
  defaultWatermarkOptions,
  type BlendMode,
  type ExportFormat,
  type FontStyle,
  type ImageEntry,
  type LayoutMode,
  type WatermarkOptions,
  type WatermarkType,
} from './types'

const ANGLE_PRESETS = [-45, -30, 0, 30, 45] as const
const PREVIEW_MAX_SIDE = 1600

export default function ImageWatermark() {
  const [entries, setEntries] = useState<ImageEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [opts, setOpts] = useState<WatermarkOptions>(defaultWatermarkOptions)
  const [logo, setLogo] = useState<{ bitmap: ImageBitmap; url: string; name: string } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)
  const [draggingPos, setDraggingPos] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const logoRef = useRef(logo)
  logoRef.current = logo
  const dragStartRef = useRef<{ x: number; y: number; ox: number; oy: number; w: number; h: number } | null>(null)

  const set = <K extends keyof WatermarkOptions>(k: K, v: WatermarkOptions[K]) =>
    setOpts((prev) => ({ ...prev, [k]: v }))

  // 卸载时释放所有 ImageBitmap 与 URL
  useEffect(
    () => () => {
      entriesRef.current.forEach((e) => {
        e.bitmap.close()
        URL.revokeObjectURL(e.url)
      })
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

  /** 添加待加水印图片（支持普通位图与 iPhone HEIC / HEIF） */
  const addImages = useCallback(async (files: File[]) => {
    const valid = files.filter(isImageLike)
    if (!valid.length) {
      toast.error('请选择有效的图片文件')
      return
    }
    const loaded = await Promise.allSettled(
      valid.map(async (file): Promise<ImageEntry> => {
        const decoded = await decodeImageFile(file)
        return {
          id: uid(),
          file,
          name: file.name || '粘贴的图片',
          size: file.size,
          url: decoded.previewUrl,
          bitmap: decoded.bitmap,
          width: decoded.width,
          height: decoded.height,
        }
      }),
    )
    const ok = loaded
      .filter((r): r is PromiseFulfilledResult<ImageEntry> => r.status === 'fulfilled')
      .map((r) => r.value)
    if (loaded.length - ok.length > 0) toast.error(`${loaded.length - ok.length} 张图片无法解析`)
    if (!ok.length) return

    setEntries((prev) => [...prev, ...ok])
    setSelectedId((prev) => prev ?? ok[0].id)
  }, [])

  /** 载入图片 Logo 水印 */
  const loadLogoFile = async (file: File) => {
    try {
      const decoded = await decodeImageFile(file)
      if (logoRef.current) {
        logoRef.current.bitmap.close()
        URL.revokeObjectURL(logoRef.current.url)
      }
      setLogo({ bitmap: decoded.bitmap, url: decoded.previewUrl, name: file.name })
      set('type', 'image')
    } catch {
      toast.error('无法读取该 Logo 图片')
    }
  }

  const removeLogo = () => {
    if (logo) {
      logo.bitmap.close()
      URL.revokeObjectURL(logo.url)
      setLogo(null)
    }
  }

  const removeEntry = (id: string) => {
    setEntries((prev) => {
      const target = prev.find((e) => e.id === id)
      if (target) {
        target.bitmap.close()
        URL.revokeObjectURL(target.url)
      }
      const rest = prev.filter((e) => e.id !== id)
      setSelectedId((cur) => (cur === id ? (rest[0]?.id ?? null) : cur))
      return rest
    })
  }

  const clearAll = () => {
    entries.forEach((e) => {
      e.bitmap.close()
      URL.revokeObjectURL(e.url)
    })
    setEntries([])
    setSelectedId(null)
  }

  // 实时渲染当前选中图片预览（rAF 合帧，拖动滑块丝滑流畅）
  useEffect(() => {
    if (!selected || !canvasRef.current) return
    const raf = requestAnimationFrame(() => {
      if (!canvasRef.current) return
      const scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(selected.width, selected.height))
      renderWatermarkedCanvas(canvasRef.current, selected.bitmap, opts, logo?.bitmap ?? null, scale)
    })
    return () => cancelAnimationFrame(raf)
  }, [selected, opts, logo])

  // 单点模式下支持在预览画布上按住自由拖拽调整水印位置
  const onCanvasDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (opts.layout !== 'single' || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDraggingPos(true)
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      ox: opts.offsetX,
      oy: opts.offsetY,
      w: rect.width,
      h: rect.height,
    }
  }
  const onCanvasMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = dragStartRef.current
    if (!d) return
    const nx = Math.max(-0.5, Math.min(0.5, d.ox + (e.clientX - d.x) / d.w))
    const ny = Math.max(-0.5, Math.min(0.5, d.oy + (e.clientY - d.y) / d.h))
    setOpts((prev) => ({ ...prev, offsetX: nx, offsetY: ny }))
  }
  const onCanvasUp = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!dragStartRef.current) return
    dragStartRef.current = null
    setDraggingPos(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  /** 导出当前选中图 */
  const onExportOne = async (entry: ImageEntry, mode: 'download' | 'copy' = 'download') => {
    setExporting(true)
    try {
      await new Promise((r) => setTimeout(r, 20))
      const { blob, filename } = await exportWatermarkedBlob(entry, opts, logo?.bitmap ?? null, mode === 'copy')
      if (mode === 'copy') {
        await copyImageToClipboard(blob)
        toast.success('已复制带水印图片到剪贴板')
      } else {
        downloadBlob(blob, filename)
        toast.success(`导出成功 · ${formatBytes(blob.size)}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  /** 批量导出 ZIP */
  const onExportAllZip = async () => {
    if (!entries.length) return
    if (entries.length === 1) {
      await onExportOne(entries[0], 'download')
      return
    }
    setExporting(true)
    setBatchProgress({ done: 0, total: entries.length })
    try {
      const zipBlob = await exportBatchWatermarkZip(entries, opts, logo?.bitmap ?? null, (done, total) => {
        setBatchProgress({ done, total })
      })
      downloadBlob(zipBlob, timestampName('轻匣-图片水印', 'zip'))
      toast.success(`已为 ${entries.length} 张图片添加水印并打包 · ${formatBytes(zipBlob.size)}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '批量打包失败')
    } finally {
      setExporting(false)
      setBatchProgress(null)
    }
  }

  // 空状态
  if (!entries.length) {
    return (
      <div className="space-y-6">
        <FileDropzone
          accept={IMAGE_ACCEPT}
          multiple
          onFiles={addImages}
          title="拖放图片到这里添加水印（支持多图批量处理）"
          hint="证件防盗水印、原创版权署名或透明 Logo 叠加，支持 Ctrl / ⌘ + V 粘贴，100% 本地安全不上传"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: <ShieldCheck />, t: '证件防盗平铺', d: '身份证、营业执照全屏斜向错行水印，本地安全不泄露' },
            { icon: <ImageIcon />, t: '文字与图片 Logo', d: '支持多行文字描边阴影或透明 PNG / SVG 商标水印' },
            { icon: <Layers />, t: '批量加水印打包', d: '按图片短边自适应大小，多张图一次配置一键导出 ZIP' },
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

  const previewFontPx = selected ? Math.round((Math.min(selected.width, selected.height) * opts.fontSizePct) / 100) : 0

  const panel = (
    <>
      {/* 快捷场景预设 */}
      <Field label="快捷模板">
        <div className="grid grid-cols-3 gap-1.5">
          {WATERMARK_PRESETS.map((p) => (
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
      </Field>

      {/* 水印类型 */}
      <Field label="水印类型">
        <Segmented<WatermarkType>
          size="sm"
          value={opts.type}
          onChange={(v) => set('type', v)}
          options={[
            { value: 'text', label: '文字水印', icon: <Type /> },
            { value: 'image', label: '图片 Logo', icon: <ImageIcon /> },
          ]}
        />
      </Field>

      {/* 文字水印配置 或 图片 Logo 配置 */}
      {opts.type === 'text' ? (
        <div className="space-y-4">
          <Field label="水印文字" value="支持换行">
            <textarea
              rows={2}
              value={opts.text}
              onChange={(e) => set('text', e.target.value)}
              placeholder="输入水印内容，可换行…"
              className="bg-card-solid focus:ring-ring/50 w-full resize-none rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2"
            />
          </Field>

          <Field label="字体样式">
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
                title="加粗"
              >
                B
              </Button>
            </div>
          </Field>

          <Field label="文字颜色" value={opts.color}>
            <ColorPicker
              value={opts.color}
              onChange={(v) => set('color', v)}
              presets={['#ffffff', '#000000', '#9ca3af', '#ef4444', '#f59e0b', '#3b82f6']}
            />
          </Field>

          <Field label="文字大小" value={`${opts.fontSizePct}% (≈${previewFontPx}px)`}>
            <Slider value={opts.fontSizePct} min={1.5} max={14} step={0.2} onChange={(v) => set('fontSizePct', v)} />
          </Field>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-foreground/80 text-sm font-medium">文字柔和阴影</div>
              <div className="text-muted-foreground text-xs">在亮/暗交错背景上更清晰</div>
            </div>
            <Switch checked={opts.shadow} onChange={(v) => set('shadow', v)} label="文字柔和阴影" />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="上传 Logo 图片">
            {logo ? (
              <div className="bg-card-solid flex items-center gap-3 rounded-xl border p-2">
                <div className="checkerboard size-11 shrink-0 overflow-hidden rounded-lg border p-1">
                  <img src={logo.url} alt="" className="size-full object-contain" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{logo.name}</div>
                  <div className="text-muted-foreground font-mono text-[11px]">
                    {logo.bitmap.width}×{logo.bitmap.height}
                  </div>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={removeLogo} aria-label="移除 Logo">
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <label className="hover:border-primary/50 hover:text-primary text-muted-foreground flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed py-5 text-xs transition-colors">
                <Upload className="size-4" />
                <span>选择透明 PNG / SVG / WebP 商标图</span>
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

          <Field label="Logo 大小" value={`${opts.logoSizePct}%`}>
            <Slider value={opts.logoSizePct} min={5} max={60} step={1} onChange={(v) => set('logoSizePct', v)} />
          </Field>
        </div>
      )}

      {/* 排布方式：平铺 / 九宫格定位 */}
      <div className="space-y-4 border-t pt-4">
        <Field label="排布方式">
          <Segmented<LayoutMode>
            size="sm"
            value={opts.layout}
            onChange={(v) => set('layout', v)}
            options={[
              { value: 'tile', label: '全屏平铺', icon: <Grid3x3 /> },
              { value: 'single', label: '单点定位', icon: <Move /> },
            ]}
          />
        </Field>

        {opts.layout === 'tile' ? (
          <div className="space-y-4">
            <Field label="水平间距" value={`${opts.gapXPct}%`}>
              <Slider value={opts.gapXPct} min={4} max={55} step={1} onChange={(v) => set('gapXPct', v)} />
            </Field>
            <Field label="垂直间距" value={`${opts.gapYPct}%`}>
              <Slider value={opts.gapYPct} min={4} max={55} step={1} onChange={(v) => set('gapYPct', v)} />
            </Field>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-foreground/80 text-sm font-medium">错行交错排布</div>
                <div className="text-muted-foreground text-xs">砖墙式错开，防盗防裁更美观</div>
              </div>
              <Switch checked={opts.stagger} onChange={(v) => set('stagger', v)} label="错行交错排布" />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Field
              label="九宫格位置"
              value={
                (opts.offsetX !== 0 || opts.offsetY !== 0) && (
                  <button
                    type="button"
                    onClick={() => setOpts((p) => ({ ...p, offsetX: 0, offsetY: 0 }))}
                    className="text-primary flex items-center gap-1 hover:underline"
                  >
                    <RotateCcw className="size-3" />
                    复位偏移
                  </button>
                )
              }
            >
              <div className="grid grid-cols-3 gap-1.5">
                {ANCHOR_GRID.map((a) => {
                  const active = opts.anchor === a.id
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setOpts((p) => ({ ...p, anchor: a.id, offsetX: 0, offsetY: 0 }))}
                      className={cn(
                        'rounded-lg border py-1.5 text-xs font-medium transition-all active:scale-95',
                        active
                          ? 'border-primary bg-primary/10 text-primary font-semibold'
                          : 'bg-card-solid/50 text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {a.label}
                    </button>
                  )
                })}
              </div>
            </Field>
            <Field label="边缘边距" value={`${opts.marginPct}%`}>
              <Slider value={opts.marginPct} min={0} max={20} step={0.5} onChange={(v) => set('marginPct', v)} />
            </Field>
          </div>
        )}
      </div>

      {/* 透明度、角度与混合模式 */}
      <div className="space-y-4 border-t pt-4">
        <Field label="不透明度" value={`${opts.opacity}%`}>
          <Slider value={opts.opacity} min={5} max={100} step={1} onChange={(v) => set('opacity', v)} />
        </Field>

        <Field label="旋转角度" value={`${opts.angle}°`}>
          <Slider value={opts.angle} min={-90} max={90} step={1} onChange={(v) => set('angle', v)} />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {ANGLE_PRESETS.map((deg) => (
              <button
                key={deg}
                type="button"
                onClick={() => set('angle', deg)}
                className={cn(
                  'rounded-lg border px-2 py-0.5 font-mono text-[11px] transition-colors',
                  opts.angle === deg
                    ? 'border-primary bg-primary/10 text-primary font-semibold'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {deg}°
              </button>
            ))}
          </div>
        </Field>

        <Field label="混合模式">
          <div className="flex flex-wrap gap-1.5">
            {BLEND_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => set('blendMode', m.value as BlendMode)}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-xs transition-colors',
                  opts.blendMode === m.value
                    ? 'border-primary bg-primary/10 text-primary font-semibold'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {/* 导出设置 */}
      <div className="space-y-4 border-t pt-4">
        <Field label="导出格式">
          <Segmented<ExportFormat>
            size="sm"
            value={opts.format}
            onChange={(v) => set('format', v)}
            options={[
              { value: 'original', label: '原格式' },
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPG' },
              { value: 'webp', label: 'WebP' },
            ]}
          />
        </Field>
        {opts.format !== 'png' && (
          <Field label="导出质量" value={`${opts.quality}%`}>
            <Slider value={opts.quality} min={50} max={100} onChange={(v) => set('quality', v)} />
          </Field>
        )}
      </div>
    </>
  )

  const actions =
    entries.length === 1 ? (
      <>
        <Button
          variant="outline"
          size="lg"
          onClick={() => selected && onExportOne(selected, 'copy')}
          disabled={exporting || !selected}
          className="max-lg:!flex-none max-lg:px-4"
        >
          <Copy />
          <span className="max-sm:hidden">复制</span>
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={() => selected && onExportOne(selected, 'download')}
          disabled={exporting || !selected}
        >
          {exporting ? <Loader2 className="animate-spin" /> : <Download />}
          {exporting ? '处理中…' : '导出图片'}
        </Button>
      </>
    ) : (
      <Button variant="primary" size="lg" onClick={onExportAllZip} disabled={exporting}>
        {exporting ? <Loader2 className="animate-spin" /> : <Archive />}
        {batchProgress
          ? `处理中 ${batchProgress.done}/${batchProgress.total}…`
          : `批量导出 ZIP（${entries.length} 张）`}
      </Button>
    )

  return (
    <ToolShell panel={panel} actions={actions} panelTitle="水印参数">
      <div className="space-y-4">
        {/* 顶栏信息 */}
        {selected && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="max-w-[200px] truncate font-medium sm:max-w-sm">{selected.name}</span>
            <span className="glass rounded-full px-2.5 py-1 font-mono tabular-nums">
              {selected.width} × {selected.height} px
            </span>
            {opts.layout === 'single' && (
              <span className="text-muted-foreground hidden sm:inline">· 可在预览图上直接拖动水印微调位置</span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              {entries.length > 1 && (
                <>
                  <Button variant="outline" size="sm" onClick={() => onExportOne(selected, 'copy')} disabled={exporting}>
                    <Copy />
                    复制
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => onExportOne(selected, 'download')} disabled={exporting}>
                    <Download />
                    下载此图
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" onClick={clearAll} className="text-muted-foreground hover:text-red-500">
                <Trash2 />
                清空
              </Button>
            </div>
          </div>
        )}

        {/* 实时水印预览区 */}
        <div className="checkerboard shadow-soft relative flex h-[min(62dvh,640px)] min-h-[300px] w-full items-center justify-center overflow-hidden rounded-3xl border p-3 sm:p-6">
          <canvas
            ref={canvasRef}
            onPointerDown={onCanvasDown}
            onPointerMove={onCanvasMove}
            onPointerUp={onCanvasUp}
            onPointerCancel={onCanvasUp}
            className={cn(
              'shadow-lift max-h-full max-w-full rounded-sm object-contain touch-none',
              opts.layout === 'single' && (draggingPos ? 'cursor-grabbing' : 'cursor-grab'),
            )}
            style={{ width: 'auto', height: 'auto' }}
          />
          <AnimatePresence>
            {exporting && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="bg-background/45 absolute inset-0 flex items-center justify-center backdrop-blur-[2px]"
              >
                <div className="glass shadow-lift flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium">
                  <Loader2 className="text-primary size-4 animate-spin" />
                  {batchProgress ? `正在处理 ${batchProgress.done}/${batchProgress.total}…` : '正在全分辨率导出…'}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 批量缩略图条 + 继续添加 */}
        <div className="space-y-2.5">
          {entries.length > 1 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-medium">
                已载入 {entries.length} 张图片（点击切换实时预览，所有图片共享同一水印方案）
              </span>
            </div>
          )}
          <div className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-1">
            {entries.map((e) => {
              const active = selected?.id === e.id
              return (
                <div
                  key={e.id}
                  onClick={() => setSelectedId(e.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault()
                      setSelectedId(e.id)
                    }
                  }}
                  className={cn(
                    'group bg-card relative flex w-44 shrink-0 cursor-pointer items-center gap-2 rounded-xl border p-1.5 pr-7 transition-all',
                    active ? 'border-primary ring-primary/20 ring-2' : 'hover:border-foreground/20',
                  )}
                >
                  <img src={e.url} alt="" className="size-10 shrink-0 rounded-lg object-cover" draggable={false} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{e.name}</div>
                    <div className="text-muted-foreground font-mono text-[10px]">
                      {e.width}×{e.height}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation()
                      removeEntry(e.id)
                    }}
                    aria-label="移除图片"
                    className="text-muted-foreground absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-md hover:bg-red-500/15 hover:text-red-500"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
          <FileDropzone compact accept={IMAGE_ACCEPT} onFiles={addImages} title="继续添加图片（批量统一加水印）" />
        </div>
      </div>
    </ToolShell>
  )
}
