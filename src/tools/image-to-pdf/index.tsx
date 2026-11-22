import { motion } from 'motion/react'
import {
  ArrowDownAZ,
  ArrowUpZA,
  Download,
  FileImage,
  FileText,
  ImagePlus,
  Loader2,
  RotateCcw,
  RotateCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Slider } from '@/components/ui/slider'
import { ColorPicker, Field, Switch } from '@/components/ui/field'
import { downloadBlob } from '@/lib/file'
import { IMAGE_ACCEPT, decodeImageFile, isImageLike } from '@/lib/image'
import { cn, formatBytes, uid } from '@/lib/utils'
import { generatePdfFromImages, resolvePageDimensions } from './engine'
import {
  PAGE_SIZES,
  defaultImageToPdfOptions,
  type ImageFitMode,
  type ImageToPdfOptions,
  type PageOrientation,
  type PdfImageItem,
} from './types'

const MARGIN_PRESETS = [
  { label: '无', val: 0 },
  { label: '窄', val: 16 },
  { label: '标准', val: 32 },
  { label: '宽', val: 56 },
]

export default function ImageToPdf() {
  const [items, setItems] = useState<PdfImageItem[]>([])
  const [opts, setOpts] = useState<ImageToPdfOptions>(defaultImageToPdfOptions)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const itemsRef = useRef(items)
  itemsRef.current = items

  const set = <K extends keyof ImageToPdfOptions>(k: K, v: ImageToPdfOptions[K]) =>
    setOpts((prev) => ({ ...prev, [k]: v }))

  useEffect(
    () => () => {
      itemsRef.current.forEach((it) => {
        it.bitmap.close()
        URL.revokeObjectURL(it.previewUrl)
      })
    },
    [],
  )

  const addFiles = useCallback(async (files: File[]) => {
    const valid = files.filter(isImageLike)
    if (!valid.length) {
      toast.error('请选择有效的图片文件')
      return
    }
    setLoading(true)
    const loaded = await Promise.allSettled(
      valid.map(async (file): Promise<PdfImageItem> => {
        const decoded = await decodeImageFile(file)
        return {
          id: uid(),
          file,
          name: file.name || '粘贴的图片',
          size: file.size,
          previewUrl: decoded.previewUrl,
          bitmap: decoded.bitmap,
          width: decoded.width,
          height: decoded.height,
          rotation: 0,
        }
      }),
    )
    const ok = loaded
      .filter((r): r is PromiseFulfilledResult<PdfImageItem> => r.status === 'fulfilled')
      .map((r) => r.value)
    if (loaded.length - ok.length > 0) toast.error(`${loaded.length - ok.length} 张图片无法解析`)
    if (ok.length) {
      setItems((prev) => {
        if (prev.length === 0) {
          const base = ok[0].name.replace(/\.[^.]+$/, '') || '图片合成'
          setOpts((o) => ({ ...o, filename: ok.length > 1 ? `${base}等${ok.length}页` : base }))
        }
        return [...prev, ...ok]
      })
    }
    setLoading(false)
  }, [])

  const removeItem = (id: string) => {
    setItems((prev) => {
      const target = prev.find((it) => it.id === id)
      if (target) {
        target.bitmap.close()
        URL.revokeObjectURL(target.previewUrl)
      }
      return prev.filter((it) => it.id !== id)
    })
  }

  const clearAll = () => {
    items.forEach((it) => {
      it.bitmap.close()
      URL.revokeObjectURL(it.previewUrl)
    })
    setItems([])
  }

  const rotateItem = (id: string, delta: 90 | -90) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, rotation: (it.rotation + delta + 360) % 360 } : it)),
    )
  }

  const sortByName = (asc: boolean) => {
    setItems((prev) =>
      [...prev].sort((a, b) =>
        asc
          ? a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
          : b.name.localeCompare(a.name, 'zh-CN', { numeric: true }),
      ),
    )
  }

  const handleDragEnd = () => {
    if (dragId && dragOverId && dragId !== dragOverId) {
      setItems((prev) => {
        const from = prev.findIndex((x) => x.id === dragId)
        const to = prev.findIndex((x) => x.id === dragOverId)
        if (from < 0 || to < 0) return prev
        const next = [...prev]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        return next
      })
    }
    setDragId(null)
    setDragOverId(null)
  }

  const onExportPdf = async () => {
    if (!items.length) return
    setExporting(true)
    setProgress({ done: 0, total: items.length })
    try {
      await new Promise((r) => setTimeout(r, 20))
      const blob = await generatePdfFromImages(items, opts, (done, total) => setProgress({ done, total }))
      const cleanName = opts.filename.trim().replace(/\.pdf$/i, '') || '图片合成'
      downloadBlob(blob, `${cleanName}.pdf`)
      toast.success(`PDF 生成成功 · 共 ${items.length} 页 · ${formatBytes(blob.size)}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'PDF 生成失败')
    } finally {
      setExporting(false)
      setProgress(null)
    }
  }

  // 空状态
  if (!items.length) {
    return (
      <div className="space-y-6">
        <FileDropzone
          accept={IMAGE_ACCEPT}
          multiple
          onFiles={addFiles}
          title={loading ? '正在载入图片…' : '拖放多张图片到这里，一键生成 PDF'}
          hint="支持 JPG / PNG / WebP / SVG / iPhone HEIC，也可直接 Ctrl / ⌘ + V 粘贴，纯浏览器本地合成"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: <FileText />, t: 'A4 与自适应纸张', d: '支持 A4/A3/A5/Letter/16:9 与无白边原图自适应尺寸' },
            { icon: <Sparkles />, t: '智能匹配横竖方向', d: '自动按每张图片长宽切换纵/横向页面，实时所见即所得' },
            { icon: <FileImage />, t: '体积压缩与拖拽排页', d: '支持拖拽调整页面顺序、单页旋转、页码与可选体积压缩' },
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
      {/* 纸张尺寸 */}
      <Field label="纸张大小">
        <div className="grid grid-cols-2 gap-1.5">
          {PAGE_SIZES.map((s) => {
            const active = opts.pageSize === s.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => set('pageSize', s.id)}
                className={cn(
                  'flex flex-col items-start rounded-xl border px-2.5 py-2 text-left transition-all active:scale-[0.98]',
                  active
                    ? 'border-primary bg-primary/10 text-foreground shadow-soft'
                    : 'bg-card-solid/50 text-foreground/85 hover:bg-foreground/[0.04]',
                )}
              >
                <span className="text-xs font-semibold">{s.label}</span>
                <span className="text-muted-foreground mt-0.5 text-[10px]">{s.hint}</span>
              </button>
            )
          })}
        </div>
      </Field>

      {/* 方向与图片适配（固定纸张时生效） */}
      {opts.pageSize !== 'fit' && (
        <div className="space-y-4">
          <Field label="页面方向">
            <Segmented<PageOrientation>
              size="sm"
              value={opts.orientation}
              onChange={(v) => set('orientation', v)}
              options={[
                { value: 'auto', label: '自动' },
                { value: 'portrait', label: '纵向' },
                { value: 'landscape', label: '横向' },
              ]}
            />
          </Field>

          <Field label="图片适配">
            <Segmented<ImageFitMode>
              size="sm"
              value={opts.fitMode}
              onChange={(v) => set('fitMode', v)}
              options={[
                { value: 'contain', label: '完整居中' },
                { value: 'cover', label: '裁切铺满' },
              ]}
            />
          </Field>
        </div>
      )}

      {/* 页边距与纸张底色 */}
      <div className="space-y-4 border-t pt-4">
        <Field
          label="页边距"
          value={
            <span className="flex items-center gap-1.5">
              {MARGIN_PRESETS.map((m) => (
                <button
                  key={m.label}
                  type="button"
                  onClick={() => set('marginPt', m.val)}
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] transition-colors',
                    opts.marginPt === m.val ? 'bg-primary/15 text-primary font-semibold' : 'hover:text-foreground',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </span>
          }
        >
          <Slider value={opts.marginPt} min={0} max={80} step={2} onChange={(v) => set('marginPt', v)} />
        </Field>

        <Field label="页面背景色" value={opts.background}>
          <ColorPicker
            value={opts.background}
            onChange={(v) => set('background', v === 'transparent' ? '#ffffff' : v)}
            presets={['#ffffff', '#faf8f5', '#f1f5f9', '#18181b', '#000000']}
          />
        </Field>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-foreground/80 text-sm font-medium">显示底部页码</div>
            <div className="text-muted-foreground text-xs">在每页底部居中标注 1 / N</div>
          </div>
          <Switch checked={opts.showPageNumbers} onChange={(v) => set('showPageNumbers', v)} label="显示底部页码" />
        </div>
      </div>

      {/* 体积压缩与文件名 */}
      <div className="space-y-4 border-t pt-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-foreground/80 text-sm font-medium">压缩 PDF 体积</div>
            <div className="text-muted-foreground text-xs">将图片转为高压缩比 JPG 再嵌入</div>
          </div>
          <Switch checked={opts.compressJpeg} onChange={(v) => set('compressJpeg', v)} label="压缩 PDF 体积" />
        </div>

        {opts.compressJpeg && (
          <Field label="图片压缩质量" value={`${opts.jpegQuality}%`}>
            <Slider value={opts.jpegQuality} min={50} max={96} step={2} onChange={(v) => set('jpegQuality', v)} />
          </Field>
        )}

        <Field label="输出文件名">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={opts.filename}
              onChange={(e) => set('filename', e.target.value)}
              placeholder="图片合成"
              className="bg-card-solid focus:ring-ring/50 h-9 w-full rounded-xl border px-3 text-xs outline-none focus:ring-2"
            />
            <span className="text-muted-foreground shrink-0 font-mono text-xs">.pdf</span>
          </div>
        </Field>
      </div>
    </>
  )

  const actions = (
    <Button variant="primary" size="lg" onClick={onExportPdf} disabled={exporting}>
      {exporting ? <Loader2 className="animate-spin" /> : <Download />}
      {progress ? `合成中 ${progress.done}/${progress.total}…` : `生成 PDF（共 ${items.length} 页）`}
    </Button>
  )

  return (
    <ToolShell panel={panel} actions={actions} panelTitle="PDF 排版设置">
      <div className="space-y-4">
        {/* 顶部工具栏 */}
        <div className="glass shadow-soft flex flex-wrap items-center gap-2 rounded-2xl px-4 py-2.5 text-xs">
          <span className="flex items-center gap-1.5 font-medium">
            <FileText className="text-primary size-4" />
            共 {items.length} 页
          </span>
          <span className="text-muted-foreground hidden sm:inline">· 拖动卡片即可自由调整页面顺序</span>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => sortByName(true)} title="按文件名升序">
              <ArrowDownAZ />
              <span className="hidden sm:inline">正序</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => sortByName(false)} title="按文件名降序">
              <ArrowUpZA />
              <span className="hidden sm:inline">倒序</span>
            </Button>
            <label className="cursor-pointer">
              <span className="bg-muted hover:bg-foreground/10 inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition-colors">
                <ImagePlus className="size-3.5" />
                加图
              </span>
              <input
                type="file"
                hidden
                multiple
                accept={IMAGE_ACCEPT}
                onChange={(e) => {
                  if (e.target.files?.length) void addFiles(Array.from(e.target.files))
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

        {/* 所见即所得 PDF 页面模拟网格 */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5">
          {items.map((it, idx) => {
            const { pageW, pageH } = resolvePageDimensions(it.width, it.height, it.rotation, opts)
            const padPct = Math.min(28, (opts.marginPt / Math.min(pageW, pageH)) * 100)
            const dragging = dragId === it.id
            const dragOver = dragOverId === it.id && dragId !== it.id

            return (
              <div
                key={it.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', it.id)
                  setDragId(it.id)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDragOverId(it.id)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  handleDragEnd()
                }}
                onDragEnd={handleDragEnd}
                className={cn(
                  'group bg-card relative flex cursor-grab flex-col overflow-hidden rounded-2xl border backdrop-blur-xl transition-all active:cursor-grabbing',
                  dragging && 'scale-95 opacity-45',
                  dragOver ? 'border-primary ring-primary scale-[1.02] ring-2' : 'hover:border-foreground/25',
                )}
              >
                {/* 纸张比例模拟舞台 */}
                <div className="bg-foreground/[0.04] relative flex aspect-[3/4] w-full items-center justify-center p-3">
                  <div
                    className="relative flex max-h-full max-w-full items-center justify-center overflow-hidden rounded-[2px] shadow-[0_6px_18px_rgb(0_0_0/0.16)]"
                    style={{
                      aspectRatio: `${pageW} / ${pageH}`,
                      width: pageW >= pageH ? '100%' : 'auto',
                      height: pageW < pageH ? '100%' : 'auto',
                      background: opts.background,
                      padding: `${padPct}%`,
                    }}
                  >
                    <img
                      src={it.previewUrl}
                      alt={it.name}
                      draggable={false}
                      style={{ transform: `rotate(${it.rotation}deg)` }}
                      className={cn(
                        'transition-transform duration-300',
                        opts.pageSize !== 'fit' && opts.fitMode === 'cover'
                          ? 'size-full object-cover'
                          : 'max-h-full max-w-full object-contain',
                        it.rotation % 180 !== 0 && 'scale-[0.76]',
                      )}
                    />
                    {opts.showPageNumbers && (
                      <span className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 font-mono text-[8px] opacity-55">
                        {idx + 1} / {items.length}
                      </span>
                    )}
                  </div>

                  {/* 悬浮单页快捷操作 */}
                  <div className="glass shadow-lift absolute inset-x-2 bottom-2 flex items-center justify-center gap-0.5 rounded-xl p-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => rotateItem(it.id, -90)}
                      title="逆时针旋转 90°"
                      className="hover:bg-foreground/10 flex size-7 items-center justify-center rounded-lg"
                    >
                      <RotateCcw className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => rotateItem(it.id, 90)}
                      title="顺时针旋转 90°"
                      className="hover:bg-foreground/10 flex size-7 items-center justify-center rounded-lg"
                    >
                      <RotateCw className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeItem(it.id)}
                      title="移除此页"
                      className="flex size-7 items-center justify-center rounded-lg text-red-500 hover:bg-red-500/15"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                </div>

                {/* 页脚 */}
                <div className="flex items-center justify-between gap-2 border-t px-2.5 py-2 text-[11px]">
                  <span className="bg-foreground/[0.07] shrink-0 rounded-md px-1.5 py-0.5 font-mono font-bold tabular-nums">
                    P{idx + 1}
                  </span>
                  <span className="text-muted-foreground min-w-0 truncate" title={it.name}>
                    {it.name}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        <FileDropzone
          compact
          accept={IMAGE_ACCEPT}
          multiple
          onFiles={addFiles}
          title={loading ? '正在读取图片…' : '继续添加图片（支持拖放或 Ctrl/⌘ + V 粘贴）'}
        />
      </div>
    </ToolShell>
  )
}
