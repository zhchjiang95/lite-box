import { AnimatePresence, Reorder, motion, useDragControls } from 'motion/react'
import {
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignStartHorizontal,
  ArrowDownUp,
  ArrowLeftRight,
  Copy,
  Download,
  Grid3x3,
  GripVertical,
  Loader2,
  Maximize2,
  MoveVertical,
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
import { ColorPicker, Field, Switch } from '@/components/ui/field'
import { canvasToBlob, copyImageToClipboard, downloadBlob, timestampName } from '@/lib/file'
import { cn, formatBytes, uid } from '@/lib/utils'
import {
  computeLayout,
  defaultOptions,
  renderStitch,
  safeScale,
  type Align,
  type CellRatio,
  type Fit,
  type StitchMode,
  type StitchOptions,
} from './stitch'

interface Item {
  id: string
  name: string
  size: number
  url: string
  bitmap: ImageBitmap
  width: number
  height: number
}

type Format = 'png' | 'jpeg' | 'webp'
const mime: Record<Format, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }

/** 预览渲染的像素预算，超出则降采样以保证流畅 */
const PREVIEW_AREA = 6_000_000

export default function ImageStitch() {
  const [items, setItems] = useState<Item[]>([])
  const [opts, setOpts] = useState<StitchOptions>(defaultOptions)
  const [format, setFormat] = useState<Format>('png')
  const [quality, setQuality] = useState(92)
  const [outScale, setOutScale] = useState('1')
  const [fitMode, setFitMode] = useState<'contain' | 'width'>('contain')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items

  const set = <K extends keyof StitchOptions>(k: K, v: StitchOptions[K]) => setOpts((o) => ({ ...o, [k]: v }))

  // 卸载时释放内存
  useEffect(
    () => () => {
      itemsRef.current.forEach((it) => {
        it.bitmap.close()
        URL.revokeObjectURL(it.url)
      })
    },
    [],
  )

  /** 添加图片 */
  const addFiles = useCallback(async (files: File[]) => {
    setLoading(true)
    const results = await Promise.allSettled(
      files.map(async (file) => {
        const bitmap = await createImageBitmap(file)
        return {
          id: uid(),
          name: file.name || '粘贴的图片',
          size: file.size,
          url: URL.createObjectURL(file),
          bitmap,
          width: bitmap.width,
          height: bitmap.height,
        } satisfies Item
      }),
    )
    const ok = results.filter((r): r is PromiseFulfilledResult<Item> => r.status === 'fulfilled').map((r) => r.value)
    const failed = results.length - ok.length
    if (failed) toast.error(`${failed} 张图片无法解析，可能格式不受当前浏览器支持`)
    if (ok.length) setItems((prev) => [...prev, ...ok])
    setLoading(false)
  }, [])

  const remove = (id: string) =>
    setItems((prev) => {
      const it = prev.find((p) => p.id === id)
      if (it) {
        it.bitmap.close()
        URL.revokeObjectURL(it.url)
      }
      return prev.filter((p) => p.id !== id)
    })

  const clear = () => {
    items.forEach((it) => {
      it.bitmap.close()
      URL.revokeObjectURL(it.url)
    })
    setItems([])
  }

  const sizes = useMemo(() => items.map((i) => ({ width: i.width, height: i.height })), [items])
  const layout = useMemo(() => computeLayout(sizes, opts), [sizes, opts])
  const exportScale = useMemo(() => safeScale(layout.width, layout.height, Number(outScale)), [layout, outScale])
  const outW = Math.round(layout.width * exportScale)
  const outH = Math.round(layout.height * exportScale)
  const clamped = exportScale < Number(outScale) - 1e-6

  // 实时预览（rAF 合并多次更新）
  useEffect(() => {
    if (!items.length || !canvasRef.current) return
    const raf = requestAnimationFrame(() => {
      const area = layout.width * layout.height
      const s = Math.min(safeScale(layout.width, layout.height), Math.sqrt(PREVIEW_AREA / area), 1)
      renderStitch(canvasRef.current!, items.map((i) => i.bitmap), sizes, layout, opts, s)
    })
    return () => cancelAnimationFrame(raf)
  }, [items, sizes, layout, opts])

  /** 全尺寸渲染导出 */
  const renderFull = async () => {
    const canvas = document.createElement('canvas')
    renderStitch(canvas, items.map((i) => i.bitmap), sizes, layout, opts, exportScale)
    return canvas
  }

  const onDownload = async () => {
    setExporting(true)
    try {
      // 让出主线程，先渲染 loading 状态
      await new Promise((r) => setTimeout(r, 30))
      const canvas = await renderFull()
      const fmt = format
      const blob = await canvasToBlob(canvas, mime[fmt], fmt === 'png' ? undefined : quality / 100)
      downloadBlob(blob, timestampName('拼接', fmt === 'jpeg' ? 'jpg' : fmt))
      toast.success(`导出成功 · ${outW}×${outH} · ${formatBytes(blob.size)}`)
      canvas.width = canvas.height = 0
    } catch (e) {
      toast.error((e as Error).message || '导出失败')
    } finally {
      setExporting(false)
    }
  }

  const onCopy = async () => {
    setExporting(true)
    try {
      await new Promise((r) => setTimeout(r, 30))
      const canvas = await renderFull()
      const blob = await canvasToBlob(canvas, 'image/png')
      await copyImageToClipboard(blob)
      toast.success('已复制到剪贴板')
    } catch (e) {
      toast.error((e as Error).message || '复制失败')
    } finally {
      setExporting(false)
    }
  }

  // 空状态：大号拖放区
  if (!items.length) {
    return (
      <div className="space-y-6">
        <FileDropzone
          accept="image/*"
          onFiles={addFiles}
          title={loading ? '正在读取图片…' : '拖放多张图片到这里，或点击选择'}
          hint="支持 JPG / PNG / WebP / GIF / AVIF 等，也可以直接 Ctrl / ⌘ + V 粘贴截图"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: <MoveVertical />, t: '长截图拼接', d: '聊天记录、网页截图纵向合成' },
            { icon: <ArrowLeftRight />, t: '横向对比', d: '前后对比图、多图并排展示' },
            { icon: <Grid3x3 />, t: '宫格拼图', d: '九宫格、四宫格，比例自由选' },
          ].map((f, i) => (
            <motion.div
              key={f.t}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.06 }}
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
      {/* 图片列表（可拖拽排序） */}
      <Field
        label={`图片列表（${items.length}）`}
        value={
          <button type="button" onClick={clear} className="hover:text-red-500 flex items-center gap-1 transition-colors">
            <Trash2 className="size-3.5" />
            清空
          </button>
        }
      >
        <Reorder.Group axis="y" values={items} onReorder={setItems} className="space-y-1.5">
          <AnimatePresence initial={false}>
            {items.map((it, i) => (
              <ImageRow key={it.id} item={it} index={i} onRemove={() => remove(it.id)} />
            ))}
          </AnimatePresence>
        </Reorder.Group>
        <FileDropzone compact accept="image/*" onFiles={addFiles} title={loading ? '读取中…' : '继续添加图片'} pasteable />
      </Field>

      <Field label="拼接方式">
        <Segmented<StitchMode>
          value={opts.mode}
          onChange={(v) => set('mode', v)}
          options={[
            { value: 'vertical', label: '纵向', icon: <ArrowDownUp /> },
            { value: 'horizontal', label: '横向', icon: <ArrowLeftRight /> },
            { value: 'grid', label: '宫格', icon: <Grid3x3 /> },
          ]}
        />
      </Field>

      <AnimatePresence mode="popLayout" initial={false}>
        {opts.mode === 'grid' ? (
          <motion.div key="grid" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-6">
            <Field label="列数" value={opts.columns}>
              <Slider value={opts.columns} min={1} max={8} onChange={(v) => set('columns', v)} />
            </Field>
            <Field label="单元格比例">
              <Segmented<CellRatio>
                size="sm"
                value={opts.cellRatio}
                onChange={(v) => set('cellRatio', v)}
                options={(['auto', '1:1', '4:3', '3:4', '16:9', '9:16'] as const).map((v) => ({
                  value: v,
                  label: v === 'auto' ? '首图' : v,
                }))}
              />
            </Field>
            <Field label="填充方式">
              <Segmented<Fit>
                size="sm"
                value={opts.fit}
                onChange={(v) => set('fit', v)}
                options={[
                  { value: 'cover', label: '裁剪铺满' },
                  { value: 'contain', label: '完整显示' },
                ]}
              />
            </Field>
          </motion.div>
        ) : (
          <motion.div key="line" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-foreground/80 text-sm font-medium">统一{opts.mode === 'vertical' ? '宽度' : '高度'}</div>
                <div className="text-muted-foreground text-xs">按最小{opts.mode === 'vertical' ? '宽度' : '高度'}等比缩放</div>
              </div>
              <Switch checked={opts.unify} onChange={(v) => set('unify', v)} label="统一尺寸" />
            </div>
            {!opts.unify && (
              <Field label="对齐方式">
                <Segmented<Align>
                  size="sm"
                  value={opts.align}
                  onChange={(v) => set('align', v)}
                  options={[
                    { value: 'start', label: opts.mode === 'vertical' ? '左' : '上', icon: <AlignStartHorizontal className={cn(opts.mode === 'vertical' && 'rotate-90')} /> },
                    { value: 'center', label: '居中', icon: <AlignCenterHorizontal className={cn(opts.mode === 'vertical' && 'rotate-90')} /> },
                    { value: 'end', label: opts.mode === 'vertical' ? '右' : '下', icon: <AlignEndHorizontal className={cn(opts.mode === 'vertical' && 'rotate-90')} /> },
                  ]}
                />
              </Field>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <Field label="图片间距" value={`${opts.gap}px`}>
        <Slider value={opts.gap} max={120} onChange={(v) => set('gap', v)} />
      </Field>
      <Field label="外边距" value={`${opts.padding}px`}>
        <Slider value={opts.padding} max={200} onChange={(v) => set('padding', v)} />
      </Field>
      <Field label="圆角" value={`${opts.radius}px`}>
        <Slider value={opts.radius} max={120} onChange={(v) => set('radius', v)} />
      </Field>
      <Field label="背景色" value={opts.background === 'transparent' ? '透明' : opts.background}>
        <ColorPicker value={opts.background} onChange={(v) => set('background', v)} />
      </Field>

      <div className="border-t pt-5">
        <div className="text-muted-foreground mb-4 text-xs font-medium tracking-wide">导出设置</div>
        <div className="space-y-6">
          <Field label="格式">
            <Segmented<Format>
              size="sm"
              value={format}
              onChange={setFormat}
              options={[
                { value: 'png', label: 'PNG' },
                { value: 'jpeg', label: 'JPG' },
                { value: 'webp', label: 'WebP' },
              ]}
            />
          </Field>
          {format !== 'png' && (
            <Field label="质量" value={`${quality}%`}>
              <Slider value={quality} min={40} max={100} onChange={setQuality} />
            </Field>
          )}
          {format === 'jpeg' && opts.background === 'transparent' && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
              JPG 不支持透明背景，透明区域将显示为黑色，建议选择 PNG 或 WebP。
            </p>
          )}
          <Field label="输出尺寸" value={`${outW} × ${outH}`}>
            <Segmented
              size="sm"
              value={outScale}
              onChange={setOutScale}
              options={[
                { value: '1', label: '100%' },
                { value: '0.75', label: '75%' },
                { value: '0.5', label: '50%' },
                { value: '0.25', label: '25%' },
              ]}
            />
          </Field>
          {clamped && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
              尺寸超出浏览器画布上限，已自动缩小到 {outW} × {outH}。
            </p>
          )}
        </div>
      </div>
    </>
  )

  const actions = (
    <>
      <Button variant="outline" size="lg" onClick={onCopy} disabled={exporting} className="max-lg:!flex-none max-lg:px-4">
        <Copy />
        <span className="max-sm:hidden">复制</span>
      </Button>
      <Button variant="primary" size="lg" onClick={onDownload} disabled={exporting}>
        {exporting ? <Loader2 className="animate-spin" /> : <Download />}
        {exporting ? '处理中…' : '导出图片'}
      </Button>
    </>
  )

  return (
    <ToolShell panel={panel} actions={actions}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="glass rounded-full px-3 py-1.5 font-mono tabular-nums">
            {outW} × {outH} px
          </span>
          <span className="text-muted-foreground max-sm:hidden">{items.length} 张图片</span>
          <div className="ml-auto w-44">
            <Segmented
              size="sm"
              value={fitMode}
              onChange={setFitMode}
              options={[
                { value: 'contain', label: '适应窗口', icon: <Maximize2 /> },
                { value: 'width', label: '适应宽度', icon: <MoveVertical /> },
              ]}
            />
          </div>
        </div>
        <div
          className={cn(
            'checkerboard shadow-soft relative flex justify-center overflow-auto rounded-3xl border p-3 sm:p-6',
            fitMode === 'contain' ? 'h-[min(72dvh,820px)] items-center' : 'max-h-[80dvh] items-start',
          )}
        >
          <canvas
            ref={canvasRef}
            className={cn(
              'shadow-lift rounded-sm transition-[max-width,max-height] duration-300',
              fitMode === 'contain' ? 'max-h-full max-w-full object-contain' : 'h-auto w-full',
            )}
            style={fitMode === 'contain' ? { width: 'auto', height: 'auto' } : undefined}
          />
          <AnimatePresence>
            {(loading || exporting) && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="bg-background/50 absolute inset-0 flex items-center justify-center backdrop-blur-sm"
              >
                <Loader2 className="text-primary size-8 animate-spin" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </ToolShell>
  )
}

/** 列表行：拖拽手柄排序 */
function ImageRow({ item, index, onRemove }: { item: Item; index: number; onRemove: () => void }) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12, height: 0, marginTop: 0 }}
      whileDrag={{ scale: 1.03, boxShadow: '0 12px 30px -10px rgb(0 0 0 / 0.3)', zIndex: 10 }}
      className="bg-card-solid group relative flex items-center gap-2.5 rounded-xl border p-1.5 pr-2"
    >
      <button
        type="button"
        onPointerDown={(e) => controls.start(e)}
        className="text-muted-foreground hover:text-foreground flex h-10 w-5 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
        aria-label="拖动排序"
      >
        <GripVertical className="size-4" />
      </button>
      <div className="relative shrink-0">
        <img src={item.url} alt="" className="size-10 rounded-lg object-cover" draggable={false} />
        <span className="bg-foreground text-background absolute -top-1 -left-1 flex size-4 items-center justify-center rounded-full text-[10px] font-bold">
          {index + 1}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{item.name}</div>
        <div className="text-muted-foreground font-mono text-[11px]">
          {item.width}×{item.height} · {formatBytes(item.size)}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground flex size-7 items-center justify-center rounded-lg transition-colors hover:bg-red-500/10 hover:text-red-500"
        aria-label="移除"
      >
        <X className="size-4" />
      </button>
    </Reorder.Item>
  )
}
