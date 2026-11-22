import { AnimatePresence, motion } from 'motion/react'
import {
  Archive,
  Download,
  Eye,
  GripHorizontal,
  ImagePlus,
  Loader2,
  Pipette,
  Plus,
  RotateCcw,
  ScissorsLineDashed,
  Sparkles,
  Wand2,
  X,
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
  cutsToSegments,
  exportSlicesZip,
  generateAutoCuts,
  renderSliceBlob,
  sampleBottomEdgeColor,
  sliceFileName,
  snapCutsToWhitespace,
} from './engine'
import {
  RATIO_PRESETS,
  defaultSliceOptions,
  type ExportFormat,
  type LastPageMode,
  type SliceMode,
  type SliceOptions,
} from './types'

interface SourceLongImage {
  name: string
  url: string
  bitmap: ImageBitmap
  width: number
  height: number
  bottomColor: string
}

interface PreviewCard {
  index: number
  url: string
  width: number
  height: number
}

type ViewTab = 'editor' | 'pages'

export default function ImageSlice() {
  const [image, setImage] = useState<SourceLongImage | null>(null)
  const [opts, setOpts] = useState<SliceOptions>(defaultSliceOptions)
  /** 水平切线 Y 坐标（原图像素，允许自由增删拖拽） */
  const [cuts, setCuts] = useState<number[]>([])
  const [viewTab, setViewTab] = useState<ViewTab>('editor')
  const [previews, setPreviews] = useState<PreviewCard[]>([])
  const [renderingPreviews, setRenderingPreviews] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [draggingCutIdx, setDraggingCutIdx] = useState<number | null>(null)

  const imageRef = useRef(image)
  imageRef.current = image
  const previewsRef = useRef(previews)
  previewsRef.current = previews
  const imgBoxRef = useRef<HTMLDivElement>(null)

  const set = <K extends keyof SliceOptions>(k: K, v: SliceOptions[K]) =>
    setOpts((prev) => ({ ...prev, [k]: v }))

  // 卸载释放显存与 ObjectURL
  useEffect(
    () => () => {
      if (imageRef.current) {
        imageRef.current.bitmap.close()
        URL.revokeObjectURL(imageRef.current.url)
      }
      previewsRef.current.forEach((p) => URL.revokeObjectURL(p.url))
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
      const bottomColor = sampleBottomEdgeColor(decoded.bitmap)
      setImage({
        name: file.name || '长截图',
        url: decoded.previewUrl,
        bitmap: decoded.bitmap,
        width: decoded.width,
        height: decoded.height,
        bottomColor,
      })
      setOpts((prev) => ({ ...prev, background: bottomColor }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '无法解析该图片')
    }
  }, [])

  // 载入后支持随时 Ctrl/⌘ + V 粘贴换图
  useEffect(() => {
    if (!image) return
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement
      if (/INPUT|TEXTAREA/.test(el.tagName) || el.isContentEditable) return
      const img = Array.from(e.clipboardData?.files ?? []).find(isImageLike)
      if (img) {
        e.preventDefault()
        void loadFile([img])
        toast.success('已载入剪贴板图片')
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [image, loadFile])

  // 非手动模式下，图片或切分参数变化时自动重算切线
  useEffect(() => {
    if (!image || opts.mode === 'manual') return
    setCuts(generateAutoCuts(image.width, image.height, opts))
  }, [image, opts.mode, opts.ratioId, opts.sliceHeight, opts.sliceCount, opts.lastPageMode])

  const segments = useMemo(
    () => (image ? cutsToSegments(image.width, image.height, cuts, opts) : []),
    [image, cuts, opts],
  )

  // 切到“分页预览”时防抖渲染每页缩略图
  useEffect(() => {
    if (!image || viewTab !== 'pages') return
    let cancelled = false
    setRenderingPreviews(true)
    const timer = window.setTimeout(async () => {
      try {
        const list: PreviewCard[] = []
        for (const seg of segments) {
          const blob = await renderSliceBlob(image.bitmap, seg, opts, 480)
          if (cancelled) return
          list.push({
            index: seg.index,
            url: URL.createObjectURL(blob),
            width: image.width,
            height: seg.outHeight,
          })
        }
        if (cancelled) {
          list.forEach((p) => URL.revokeObjectURL(p.url))
          return
        }
        setPreviews((prev) => {
          prev.forEach((p) => URL.revokeObjectURL(p.url))
          return list
        })
      } finally {
        if (!cancelled) setRenderingPreviews(false)
      }
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [image, segments, opts, viewTab])

  /** 一键智能避字吸附：将全部切线微调到邻近空白缝隙 */
  const onSmartSnap = () => {
    if (!image || !cuts.length) {
      toast.info('当前还没有切线，请先调整高度或添加切线')
      return
    }
    const snapped = snapCutsToWhitespace(image.bitmap, cuts, 95)
    setOpts((prev) => ({ ...prev, mode: 'manual' }))
    setCuts(snapped)
    toast.success('已智能将切线对齐到邻近空白缝隙，避免切到文字')
  }

  /** 在图片点击处新增一条手动切线 */
  const onImageClickAddCut = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!image || !imgBoxRef.current) return
    const rect = imgBoxRef.current.getBoundingClientRect()
    if (!rect.height) return
    const ratioY = (e.clientY - rect.top) / rect.height
    const y = Math.round(ratioY * image.height)
    if (y < 24 || y > image.height - 24) return
    setOpts((prev) => ({ ...prev, mode: 'manual' }))
    setCuts((prev) => [...prev, y].sort((a, b) => a - b))
  }

  // 拖拽切线上下自由调整位置
  const onCutDown = (index: number, e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDraggingCutIdx(index)
    if (opts.mode !== 'manual') {
      setOpts((prev) => ({ ...prev, mode: 'manual' }))
    }
  }
  const onCutMove = (index: number, e: PointerEvent<HTMLDivElement>) => {
    if (draggingCutIdx !== index || !image || !imgBoxRef.current) return
    const rect = imgBoxRef.current.getBoundingClientRect()
    if (!rect.height) return
    const ratioY = Math.max(0.01, Math.min(0.99, (e.clientY - rect.top) / rect.height))
    const nextY = Math.max(20, Math.min(image.height - 20, Math.round(ratioY * image.height)))
    setCuts((prev) => prev.map((v, i) => (i === index ? nextY : v)))
  }
  const onCutUp = (e: PointerEvent<HTMLDivElement>) => {
    if (draggingCutIdx === null) return
    setDraggingCutIdx(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setCuts((prev) => [...prev].sort((a, b) => a - b))
  }

  const removeCut = (index: number) => {
    setOpts((prev) => ({ ...prev, mode: 'manual' }))
    setCuts((prev) => prev.filter((_, i) => i !== index))
  }

  const downloadOnePage = async (segIndex: number) => {
    if (!image) return
    const seg = segments.find((s) => s.index === segIndex)
    if (!seg) return
    try {
      const blob = await renderSliceBlob(image.bitmap, seg, opts, 0)
      const name = sliceFileName(image.name, seg.index, segments.length, opts.format)
      downloadBlob(blob, name)
      toast.success(`已保存第 ${seg.index} 页 · ${name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    }
  }

  const onExportAllZip = async () => {
    if (!image || !segments.length) return
    if (segments.length === 1) {
      await downloadOnePage(1)
      return
    }
    setExporting(true)
    setProgress({ done: 0, total: segments.length })
    try {
      await new Promise((r) => setTimeout(r, 20))
      const blob = await exportSlicesZip(image.bitmap, image.name, segments, opts, (done, total) =>
        setProgress({ done, total }),
      )
      downloadBlob(blob, timestampName(`轻匣-长图切分${segments.length}页`, 'zip'))
      toast.success(`已切分 ${segments.length} 页并打包 · ${formatBytes(blob.size)}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ZIP 打包失败')
    } finally {
      setExporting(false)
      setProgress(null)
    }
  }

  // 空状态
  if (!image) {
    return (
      <div className="space-y-6">
        <FileDropzone
          accept={IMAGE_ACCEPT}
          multiple={false}
          onFiles={loadFile}
          title="拖放长截图或超长海报到这里开始分页"
          hint="适合小红书 3:4 多图、公众号长图、聊天记录滚动截图，支持 Ctrl / ⌘ + V 粘贴"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: <ScissorsLineDashed />, t: '社媒比例一键分页', d: '内置小红书 3:4、方形 1:1、手机屏 9:16 等标准比例' },
            { icon: <Wand2 />, t: '智能避开文字行', d: '一键扫描像素空白缝隙，自动对齐切线不再拦腰切字' },
            { icon: <Archive />, t: '拖拽微调与 ZIP 导出', d: '支持点击增删切线、上下自由微调与末页同色补边' },
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
      {/* 切分模式 */}
      <Field label="切分方式" value={`共 ${segments.length} 页`}>
        <Segmented<SliceMode>
          size="sm"
          value={opts.mode}
          onChange={(v) => set('mode', v)}
          options={[
            { value: 'ratio', label: '按比例' },
            { value: 'height', label: '按高度' },
            { value: 'count', label: '按页数' },
            { value: 'manual', label: '手动' },
          ]}
        />
      </Field>

      {/* 各模式专属参数 */}
      {opts.mode === 'ratio' && (
        <Field label="每页画幅比例">
          <div className="grid grid-cols-5 gap-1.5">
            {RATIO_PRESETS.map((p) => {
              const active = opts.ratioId === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => set('ratioId', p.id)}
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
      )}

      {opts.mode === 'height' && (
        <Field label="每页像素高度" value={`${opts.sliceHeight} px`}>
          <Slider
            value={opts.sliceHeight}
            min={300}
            max={Math.max(1200, Math.min(4800, image.height))}
            step={40}
            onChange={(v) => set('sliceHeight', v)}
          />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {[1080, 1440, 1920, 2400].map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => set('sliceHeight', h)}
                className={cn(
                  'rounded-lg border px-2 py-0.5 font-mono text-[11px] transition-colors',
                  opts.sliceHeight === h
                    ? 'border-primary bg-primary/10 text-primary font-semibold'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {h}px
              </button>
            ))}
          </div>
        </Field>
      )}

      {opts.mode === 'count' && (
        <Field label="等分页数" value={`${opts.sliceCount} 页`}>
          <Slider value={opts.sliceCount} min={2} max={20} onChange={(v) => set('sliceCount', v)} />
        </Field>
      )}

      {opts.mode === 'manual' && (
        <div className="bg-foreground/[0.04] space-y-2 rounded-xl p-3 text-xs">
          <div className="font-medium">手动切线模式（当前 {cuts.length} 条切线）</div>
          <p className="text-muted-foreground leading-relaxed">
            在右侧长图任意位置点击即可新增切线，拖动切线手柄微调位置，点击 × 删除切线。
          </p>
          <div className="flex gap-1.5 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setCuts(generateAutoCuts(image.width, image.height, { ...opts, mode: 'ratio' }))}
            >
              <RotateCcw />
              按比例重置
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCuts([])}>
              清空切线
            </Button>
          </div>
        </div>
      )}

      {/* 智能避字按钮 */}
      <Button variant="secondary" className="w-full" onClick={onSmartSnap} disabled={!cuts.length}>
        <Wand2 className="text-primary" />
        智能吸附到空白缝隙（不切文字）
      </Button>

      {/* 末页处理与重叠衔接 */}
      <div className="space-y-4 border-t pt-4">
        {(opts.mode === 'ratio' || opts.mode === 'height') && (
          <Field label="末页处理">
            <Segmented<LastPageMode>
              size="sm"
              value={opts.lastPageMode}
              onChange={(v) => set('lastPageMode', v)}
              options={[
                { value: 'keep', label: '保留剩余' },
                { value: 'pad', label: '同高补边' },
                { value: 'merge', label: '过矮合并' },
              ]}
            />
          </Field>
        )}

        {(opts.lastPageMode === 'pad' || opts.format === 'jpeg') && (
          <Field
            label="补边 / 底色"
            value={
              <button
                type="button"
                onClick={() => set('background', image.bottomColor)}
                className="text-primary flex items-center gap-1 hover:underline"
              >
                <Pipette className="size-3" />
                取原图底边色
              </button>
            }
          >
            <ColorPicker
              value={opts.background}
              onChange={(v) => set('background', v)}
              presets={[image.bottomColor, '#ffffff', '#000000', '#f5f5f4', '#1e1e2e', 'transparent']}
            />
          </Field>
        )}

        <Field label="上下页重叠衔接" value={opts.overlapPx === 0 ? '无重叠' : `${opts.overlapPx} px`}>
          <Slider value={opts.overlapPx} min={0} max={120} step={4} onChange={(v) => set('overlapPx', v)} />
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
      </div>
    </>
  )

  const actions = (
    <Button variant="primary" size="lg" onClick={onExportAllZip} disabled={exporting || !segments.length}>
      {exporting ? <Loader2 className="animate-spin" /> : segments.length === 1 ? <Download /> : <Archive />}
      {progress
        ? `切分中 ${progress.done}/${progress.total}…`
        : segments.length === 1
          ? '导出图片'
          : `打包下载全部（${segments.length} 页）`}
    </Button>
  )

  return (
    <ToolShell panel={panel} actions={actions} panelTitle="切分设置">
      <div className="space-y-4">
        {/* 顶栏切换与快捷操作 */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <div className="w-56">
            <Segmented<ViewTab>
              size="sm"
              value={viewTab}
              onChange={setViewTab}
              options={[
                { value: 'editor', label: '切线编辑', icon: <ScissorsLineDashed /> },
                { value: 'pages', label: '分页预览', icon: <Eye /> },
              ]}
            />
          </div>
          <span className="glass rounded-full px-2.5 py-1 font-mono tabular-nums">
            {image.width} × {image.height} px · {segments.length} 页
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="secondary" size="sm" onClick={onSmartSnap} disabled={!cuts.length}>
              <Sparkles />
              智能避字
            </Button>
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

        {/* 视图一：交互式长图水平切线编辑画布 */}
        {viewTab === 'editor' ? (
          <div className="space-y-2">
            <div className="checkerboard shadow-soft relative max-h-[75dvh] overflow-y-auto rounded-3xl border p-4 select-none sm:p-6">
              <div
                ref={imgBoxRef}
                onClick={onImageClickAddCut}
                className="relative mx-auto w-full max-w-[540px] cursor-crosshair shadow-2xl"
              >
                <img src={image.url} alt={image.name} draggable={false} className="block w-full h-auto" />

                {/* 每页序号与高度标注 */}
                {segments.map((seg) => {
                  const topPct = (seg.startY / image.height) * 100
                  return (
                    <div
                      key={`badge-${seg.index}`}
                      style={{ top: `${topPct}%` }}
                      className="pointer-events-none absolute left-2 z-10 mt-2 flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-white backdrop-blur-xs"
                    >
                      <span>P{seg.index}</span>
                      <span className="text-white/65">
                        {image.width}×{seg.outHeight}
                      </span>
                    </div>
                  )
                })}

                {/* 可拖拽水平切线 */}
                {cuts.map((y, idx) => {
                  const topPct = (y / image.height) * 100
                  const active = draggingCutIdx === idx
                  return (
                    <div
                      key={`cut-${idx}`}
                      style={{ top: `${topPct}%` }}
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => onCutDown(idx, e)}
                      onPointerMove={(e) => onCutMove(idx, e)}
                      onPointerUp={onCutUp}
                      onPointerCancel={onCutUp}
                      className="group absolute inset-x-0 z-20 -mt-3 flex h-6 cursor-ns-resize items-center touch-none"
                    >
                      {/* 红色/主题色虚线切刀 */}
                      <span
                        className={cn(
                          'w-full border-t-2 border-dashed transition-colors',
                          active ? 'border-primary' : 'border-rose-500/90 group-hover:border-primary',
                        )}
                      />
                      {/* 右侧拖拽手柄 + 像素坐标 + 删除按钮 */}
                      <div
                        className={cn(
                          'absolute right-2 flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold text-white shadow-md transition-transform',
                          active ? 'bg-primary scale-105' : 'bg-rose-500 group-hover:bg-primary',
                        )}
                      >
                        <GripHorizontal className="size-3" />
                        <span>{y}px</span>
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation()
                            removeCut(idx)
                          }}
                          aria-label="删除切线"
                          className="ml-0.5 rounded-full p-0.5 hover:bg-black/25"
                        >
                          <X className="size-2.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-center text-xs">
              <Plus className="size-3.5" />
              点击长图任意位置可添加切线，上下拖动切线微调位置，或点击「智能避字」自动对齐段落空白
            </p>
          </div>
        ) : (
          /* 视图二：分页卡片预览（支持单独下载任意一页） */
          <div className="bg-card shadow-soft relative min-h-[360px] rounded-3xl border p-4 backdrop-blur-xl sm:p-6">
            <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3">
              {previews.map((p) => (
                <motion.div
                  key={`${p.index}-${p.url}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-card-solid group flex flex-col overflow-hidden rounded-2xl border shadow-soft"
                >
                  <div className="checkerboard relative flex aspect-[3/4] items-center justify-center overflow-hidden p-2">
                    <img
                      src={p.url}
                      alt={`第 ${p.index} 页`}
                      className="max-h-full max-w-full rounded-sm object-contain shadow"
                      draggable={false}
                    />
                    <span className="absolute top-2 left-2 rounded-full bg-black/65 px-2 py-0.5 font-mono text-[11px] font-bold text-white">
                      P{p.index}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t px-3 py-2 text-xs">
                    <span className="text-muted-foreground font-mono tabular-nums">
                      {p.width} × {p.height}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => downloadOnePage(p.index)}>
                      <Download />
                      保存
                    </Button>
                  </div>
                </motion.div>
              ))}
            </div>

            <AnimatePresence>
              {renderingPreviews && (
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
        )}
      </div>
    </ToolShell>
  )
}
