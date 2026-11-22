import { AnimatePresence, motion } from 'motion/react'
import {
  Archive,
  Download,
  Eye,
  Grid3x3,
  ImagePlus,
  LayoutGrid,
  Loader2,
  Move,
  RotateCcw,
  Share2,
  Sparkles,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { toast } from 'sonner'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Slider } from '@/components/ui/slider'
import { ColorPicker, Field } from '@/components/ui/field'
import { downloadBlob, timestampName } from '@/lib/file'
import { IMAGE_ACCEPT, decodeImageFile, isImageLike } from '@/lib/image'
import { cn, formatBytes } from '@/lib/utils'
import {
  computeSplitGeometry,
  exportSplitZip,
  generatePreviewTiles,
  renderSingleTileBlob,
  tileFileName,
} from './engine'
import {
  GRID_PRESETS,
  defaultSplitOptions,
  type ExportFormat,
  type FitMode,
  type SplitOptions,
  type TilePreview,
} from './types'

interface SourceImage {
  name: string
  url: string
  bitmap: ImageBitmap
  width: number
  height: number
}

type ViewTab = 'guide' | 'tiles'

export default function ImageSplit() {
  const [image, setImage] = useState<SourceImage | null>(null)
  const [opts, setOpts] = useState<SplitOptions>(defaultSplitOptions)
  const [viewTab, setViewTab] = useState<ViewTab>('guide')
  const [tiles, setTiles] = useState<TilePreview[]>([])
  const [renderingTiles, setRenderingTiles] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [draggingPan, setDraggingPan] = useState(false)
  const [showNumbers, setShowNumbers] = useState(true)

  const imageRef = useRef(image)
  imageRef.current = image
  const tilesRef = useRef(tiles)
  tilesRef.current = tiles
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; freeX: number; freeY: number } | null>(
    null,
  )

  const set = <K extends keyof SplitOptions>(k: K, v: SplitOptions[K]) =>
    setOpts((prev) => ({ ...prev, [k]: v }))

  // 卸载时释放全部显存与 ObjectURL
  useEffect(
    () => () => {
      if (imageRef.current) {
        imageRef.current.bitmap.close()
        URL.revokeObjectURL(imageRef.current.url)
      }
      tilesRef.current.forEach((t) => URL.revokeObjectURL(t.url))
    },
    [],
  )

  const loadFile = useCallback(async (files: File[]) => {
    const file = files.find(isImageLike)
    if (!file) {
      toast.error('请选择有效的图片文件')
      return
    }
    try {
      const decoded = await decodeImageFile(file)
      if (imageRef.current) {
        imageRef.current.bitmap.close()
        URL.revokeObjectURL(imageRef.current.url)
      }
      setImage({
        name: file.name || '粘贴的图片',
        url: decoded.previewUrl,
        bitmap: decoded.bitmap,
        width: decoded.width,
        height: decoded.height,
      })
      setOpts((prev) => ({ ...prev, panX: 0.5, panY: 0.5 }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '无法解析该图片文件')
    }
  }, [])

  // 载入后支持随时 Ctrl/⌘ + V 粘贴换图
  useEffect(() => {
    if (!image) return
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement
      if (/INPUT|TEXTAREA/.test(el.tagName) || el.isContentEditable) return
      const img = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'))
      if (img) {
        e.preventDefault()
        void loadFile([img])
        toast.success('已载入剪贴板图片')
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [image, loadFile])

  const geo = useMemo(
    () => (image ? computeSplitGeometry(image.width, image.height, opts) : null),
    [image, opts],
  )

  // 切到“发图效果预览”时，或在该视图下调整参数时，防抖生成轻量切片图
  useEffect(() => {
    if (!image || viewTab !== 'tiles') return
    let cancelled = false
    setRenderingTiles(true)
    const timer = window.setTimeout(async () => {
      try {
        const next = await generatePreviewTiles(image.bitmap, opts)
        if (cancelled) {
          next.forEach((t) => URL.revokeObjectURL(t.url))
          return
        }
        setTiles((prev) => {
          prev.forEach((t) => URL.revokeObjectURL(t.url))
          return next
        })
      } finally {
        if (!cancelled) setRenderingTiles(false)
      }
    }, 120)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [image, opts, viewTab])

  // 在“原图切线视图”的 square-cover 模式下，支持直接拖拽取景框平移
  const canPanX = Boolean(geo && opts.fitMode === 'square-cover' && geo.cropRect.w < 0.999)
  const canPanY = Boolean(geo && opts.fitMode === 'square-cover' && geo.cropRect.h < 0.999)
  const canPan = canPanX || canPanY

  const onCropDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!canPan || !stageRef.current || !geo) return
    const rect = stageRef.current.getBoundingClientRect()
    const freeX = rect.width * (1 - geo.cropRect.w)
    const freeY = rect.height * (1 - geo.cropRect.h)
    e.currentTarget.setPointerCapture(e.pointerId)
    setDraggingPan(true)
    dragRef.current = { x: e.clientX, y: e.clientY, panX: opts.panX, panY: opts.panY, freeX, freeY }
  }
  const onCropMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    const nextPanX = d.freeX > 1 ? Math.max(0, Math.min(1, d.panX + (e.clientX - d.x) / d.freeX)) : d.panX
    const nextPanY = d.freeY > 1 ? Math.max(0, Math.min(1, d.panY + (e.clientY - d.y) / d.freeY)) : d.panY
    setOpts((prev) => ({ ...prev, panX: nextPanX, panY: nextPanY }))
  }
  const onCropUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    setDraggingPan(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  /** 下载单张指定编号切片（全分辨率） */
  const downloadOneTile = async (row: number, col: number, index: number) => {
    if (!image) return
    try {
      const { blob } = await renderSingleTileBlob(image.bitmap, opts, row, col, 0)
      const name = tileFileName(image.name, index, opts.rows * opts.cols, opts.format)
      downloadBlob(blob, name)
      toast.success(`已保存第 ${index} 张 · ${name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    }
  }

  /** 全部切图打包 ZIP 下载 */
  const onExportZip = async () => {
    if (!image) return
    const total = opts.rows * opts.cols
    setExporting(true)
    setProgress({ done: 0, total })
    try {
      await new Promise((r) => setTimeout(r, 20))
      const blob = await exportSplitZip(image.bitmap, image.name, opts, (done, t) => {
        setProgress({ done, total: t })
      })
      downloadBlob(blob, timestampName(`轻匣-${opts.rows}x${opts.cols}切图`, 'zip'))
      toast.success(`已切分 ${total} 张图片并打包 · ${formatBytes(blob.size)}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ZIP 打包失败')
    } finally {
      setExporting(false)
      setProgress(null)
    }
  }

  const totalCount = opts.rows * opts.cols

  // 空状态
  if (!image || !geo) {
    return (
      <div className="space-y-6">
        <FileDropzone
          accept={IMAGE_ACCEPT}
          multiple={false}
          onFiles={loadFile}
          title="拖放图片到这里，一键切分为九宫格"
          hint="支持 3×3 九宫格、2×2 四宫格与任意行列，支持 Ctrl / ⌘ + V 粘贴图片"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: <Grid3x3 />, t: '朋友圈正方形适配', d: '每格精准 1:1，支持拖拽取景或自动补边，发图不裁脸' },
            { icon: <Share2 />, t: '发图效果实时预览', d: '模拟朋友圈带缝九宫格排布，按序号 1–9 防发错顺序' },
            { icon: <Archive />, t: '一键打包 ZIP 下载', d: '按序命名全分辨率导出，也可点击任意小格单独保存' },
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
      {/* 快捷网格预设 */}
      <Field label="快捷网格" value={`共 ${totalCount} 张`}>
        <div className="grid grid-cols-5 gap-1.5">
          {GRID_PRESETS.map((p) => {
            const active = opts.rows === p.rows && opts.cols === p.cols
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setOpts((prev) => ({ ...prev, rows: p.rows, cols: p.cols, panX: 0.5, panY: 0.5 }))}
                className={cn(
                  'flex flex-col items-center rounded-xl border py-2 text-center transition-all active:scale-95',
                  active
                    ? 'border-primary bg-primary/10 text-primary font-semibold'
                    : 'bg-card-solid/50 text-foreground/80 hover:bg-foreground/[0.04]',
                )}
              >
                <span className="font-mono text-xs">{p.label}</span>
                <span className="text-muted-foreground text-[10px] font-normal">{p.hint}</span>
              </button>
            )
          })}
        </div>
      </Field>

      {/* 自定义行列数 */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="行数" value={opts.rows}>
          <Slider
            value={opts.rows}
            min={1}
            max={8}
            onChange={(v) => setOpts((prev) => ({ ...prev, rows: v, panX: 0.5, panY: 0.5 }))}
          />
        </Field>
        <Field label="列数" value={opts.cols}>
          <Slider
            value={opts.cols}
            min={1}
            max={8}
            onChange={(v) => setOpts((prev) => ({ ...prev, cols: v, panX: 0.5, panY: 0.5 }))}
          />
        </Field>
      </div>

      {/* 构图比例适配 */}
      <div className="space-y-4 border-t pt-4">
        <Field label="单格比例适配">
          <Segmented<FitMode>
            size="sm"
            value={opts.fitMode}
            onChange={(v) => setOpts((prev) => ({ ...prev, fitMode: v, panX: 0.5, panY: 0.5 }))}
            options={[
              { value: 'square-cover', label: '方形裁切' },
              { value: 'square-contain', label: '方形补边' },
              { value: 'original', label: '原图等分' },
            ]}
          />
          <p className="text-muted-foreground text-[11px]">
            {opts.fitMode === 'square-cover'
              ? '每格严格 1:1（朋友圈/微博最佳），可在右侧原图拖动取景框。'
              : opts.fitMode === 'square-contain'
                ? '每格严格 1:1 且完整保留整张图，多余区域填充底色。'
                : '不裁切不补边，直接按原图比例均分。'}
          </p>
        </Field>

        {(opts.fitMode === 'square-contain' || opts.format === 'jpeg') && (
          <Field label="补边 / 底色" value={opts.background === 'transparent' ? '透明' : opts.background}>
            <ColorPicker value={opts.background} onChange={(v) => set('background', v)} />
          </Field>
        )}
      </div>

      {/* 精细调节：缝隙补偿与圆角 */}
      <div className="space-y-4 border-t pt-4">
        <Field label="宫格缝隙补偿" value={opts.gutterPct === 0 ? '关闭' : `${opts.gutterPct}%`}>
          <Slider value={opts.gutterPct} min={0} max={6} step={0.5} onChange={(v) => set('gutterPct', v)} />
        </Field>
        <Field label="单格圆角" value={opts.radiusPct === 0 ? '直角' : `${opts.radiusPct}%`}>
          <Slider value={opts.radiusPct} min={0} max={25} step={1} onChange={(v) => set('radiusPct', v)} />
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
        <Field label="单格尺寸" value={`${geo.tileW} × ${geo.tileH} px`}>
          <Segmented
            size="sm"
            value={String(opts.maxTileSide)}
            onChange={(v) => set('maxTileSide', Number(v))}
            options={[
              { value: '0', label: '原画质' },
              { value: '1080', label: '1080px' },
              { value: '720', label: '720px' },
            ]}
          />
        </Field>
      </div>
    </>
  )

  const actions = (
    <Button variant="primary" size="lg" onClick={onExportZip} disabled={exporting}>
      {exporting ? <Loader2 className="animate-spin" /> : <Archive />}
      {progress
        ? `切图中 ${progress.done}/${progress.total}…`
        : `打包下载全部（${totalCount} 张）`}
    </Button>
  )

  return (
    <ToolShell panel={panel} actions={actions} panelTitle="切图设置">
      <div className="space-y-4">
        {/* 顶栏视图切换与图片信息 */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <div className="w-56">
            <Segmented<ViewTab>
              size="sm"
              value={viewTab}
              onChange={setViewTab}
              options={[
                { value: 'guide', label: '切线构图', icon: <LayoutGrid /> },
                { value: 'tiles', label: '发图预览', icon: <Eye /> },
              ]}
            />
          </div>
          <span className="glass rounded-full px-2.5 py-1 font-mono tabular-nums">
            单格 {geo.tileW}×{geo.tileH} · 共 {totalCount} 张
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setShowNumbers((v) => !v)}>
              <Sparkles />
              {showNumbers ? '隐藏序号' : '显示序号'}
            </Button>
            {canPan && (opts.panX !== 0.5 || opts.panY !== 0.5) && (
              <Button variant="ghost" size="sm" onClick={() => setOpts((p) => ({ ...p, panX: 0.5, panY: 0.5 }))}>
                <RotateCcw />
                居中
              </Button>
            )}
            <label className="cursor-pointer">
              <span className="bg-muted hover:bg-foreground/10 inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors">
                <ImagePlus className="size-3.5" />
                换图
              </span>
              <input
                type="file"
                hidden
                accept={IMAGE_ACCEPT}
                onChange={(e) => {
                  const f = e.target.files
                  if (f?.length) void loadFile(Array.from(f))
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        </div>

        {/* 视图一：原图切线构图预览（square-cover 时可拖拽平移取景框） */}
        {viewTab === 'guide' ? (
          <div className="space-y-2.5">
            <div className="checkerboard shadow-soft relative flex h-[min(62dvh,640px)] min-h-[300px] w-full items-center justify-center overflow-hidden rounded-3xl border p-4 select-none sm:p-6">
              {opts.fitMode === 'square-contain' ? (
                /* 方形补边预览：直接展示补边后的整体切线 */
                <div
                  className="relative flex max-h-full max-w-full items-center justify-center overflow-hidden shadow-2xl"
                  style={{
                    aspectRatio: `${opts.cols} / ${opts.rows}`,
                    height: opts.cols / opts.rows < 1 ? '100%' : undefined,
                    width: opts.cols / opts.rows >= 1 ? '100%' : undefined,
                    background: opts.background === 'transparent' ? undefined : opts.background,
                  }}
                >
                  <img
                    src={image.url}
                    alt={image.name}
                    draggable={false}
                    className="max-h-full max-w-full object-contain"
                  />
                  <GridOverlay rows={opts.rows} cols={opts.cols} showNumbers={showNumbers} />
                </div>
              ) : (
                /* 原图 + 切线取景框叠加 */
                <div ref={stageRef} className="relative inline-flex max-h-full max-w-full overflow-hidden shadow-2xl">
                  <img
                    src={image.url}
                    alt={image.name}
                    draggable={false}
                    className="block max-h-[min(56dvh,580px)] max-w-full object-contain"
                  />
                  <div
                    onPointerDown={onCropDown}
                    onPointerMove={onCropMove}
                    onPointerUp={onCropUp}
                    onPointerCancel={onCropUp}
                    style={{
                      left: `${geo.cropRect.x * 100}%`,
                      top: `${geo.cropRect.y * 100}%`,
                      width: `${geo.cropRect.w * 100}%`,
                      height: `${geo.cropRect.h * 100}%`,
                      boxShadow: canPan ? '0 0 0 9999px rgba(0,0,0,0.52)' : undefined,
                    }}
                    className={cn(
                      'absolute border-2 border-white/90 touch-none',
                      canPan && (draggingPan ? 'cursor-grabbing' : 'cursor-grab'),
                    )}
                  >
                    <GridOverlay rows={opts.rows} cols={opts.cols} showNumbers={showNumbers} />
                    {canPan && (
                      <div className="pointer-events-none absolute right-2 bottom-2 flex items-center gap-1 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
                        <Move className="size-3" />
                        拖动调整构图
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <p className="text-muted-foreground text-center text-xs">
              {canPan
                ? '在取景框内按住拖动可自由平移裁切位置；切换到「发图预览」可模拟朋友圈效果并单独下载任意一格'
                : '切换到「发图预览」可预览带缝效果并点击任意一格单独下载'}
            </p>
          </div>
        ) : (
          /* 视图二：朋友圈 / 微博九宫格发图效果模拟（点击任意小格单独下载） */
          <div className="space-y-3">
            <div className="bg-card shadow-soft relative flex min-h-[360px] flex-col items-center justify-center rounded-3xl border p-5 backdrop-blur-xl sm:p-8">
              <div
                className="grid w-full max-w-[540px] gap-1.5 sm:gap-2"
                style={{ gridTemplateColumns: `repeat(${opts.cols}, minmax(0, 1fr))` }}
              >
                {tiles.map((t) => (
                  <motion.button
                    key={`${t.row}-${t.col}-${t.url}`}
                    type="button"
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: Math.min(t.index * 0.025, 0.3) }}
                    onClick={() => downloadOneTile(t.row, t.col, t.index)}
                    className="checkerboard group relative overflow-hidden rounded-lg border shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
                    title={`点击单独下载第 ${t.index} 张`}
                  >
                    <img src={t.url} alt={`第 ${t.index} 格`} className="block w-full h-auto" draggable={false} />
                    {showNumbers && (
                      <span className="pointer-events-none absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded-full bg-black/60 font-mono text-[10px] font-bold text-white backdrop-blur-xs">
                        {t.index}
                      </span>
                    )}
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
                      <Download className="size-5" />
                    </span>
                  </motion.button>
                ))}
              </div>

              <AnimatePresence>
                {renderingTiles && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="bg-background/50 absolute inset-0 flex items-center justify-center rounded-3xl backdrop-blur-[2px]"
                  >
                    <Loader2 className="text-primary size-7 animate-spin" />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <p className="text-muted-foreground text-center text-xs">
              按编号 1 → {totalCount} 依次发图即可完美拼合 · 点击任意小格可单独保存全分辨率图片
            </p>
          </div>
        )}
      </div>
    </ToolShell>
  )
}

/** 切线与序号网格叠加层 */
function GridOverlay({ rows, cols, showNumbers }: { rows: number; cols: number; showNumbers: boolean }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 grid"
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
    >
      {Array.from({ length: rows * cols }).map((_, i) => (
        <div
          key={i}
          className="relative flex items-center justify-center border border-white/65 shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.28)]"
        >
          {showNumbers && (
            <span className="flex size-6 items-center justify-center rounded-full bg-black/50 font-mono text-xs font-bold text-white backdrop-blur-[2px]">
              {i + 1}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
