import { AnimatePresence, motion } from 'motion/react'
import {
  Archive,
  ArrowRight,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileWarning,
  Layers,
  Loader2,
  SlidersHorizontal,
  Sparkles,
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
import { copyImageToClipboard, downloadBlob, timestampName } from '@/lib/file'
import { IMAGE_ACCEPT, decodeHeicToPngFile, isHeicLike, isImageLike } from '@/lib/image'
import { cn, formatBytes, uid } from '@/lib/utils'
import { CompareView } from './CompareView'
import { compressPool, detectAvifSupport, packCompressedZip, readImageDimensions } from './engine'
import {
  defaultOptions,
  mimeLabel,
  outputFileName,
  presets,
  qualityToPngColors,
  savedPercent,
  type CompressItem,
  type CompressOptions,
  type OutputFormat,
} from './types'

const SIZE_PRESETS = [800, 1280, 1920, 2560, 3840] as const

export default function ImageCompress() {
  const [items, setItems] = useState<CompressItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [opts, setOpts] = useState<CompressOptions>(defaultOptions)
  const [avifSupported, setAvifSupported] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [copying, setCopying] = useState(false)

  // 最新引用，避免异步回调闭包过期或内存泄漏
  const itemsRef = useRef(items)
  itemsRef.current = items
  const optsRef = useRef(opts)
  optsRef.current = opts
  const avifRef = useRef(avifSupported)
  avifRef.current = avifSupported
  const versionRef = useRef(1)

  const set = <K extends keyof CompressOptions>(k: K, v: CompressOptions[K]) =>
    setOpts((prev) => ({ ...prev, [k]: v }))

  // 探测 AVIF 编码能力
  useEffect(() => {
    detectAvifSupport().then(setAvifSupported)
  }, [])

  // 卸载时释放所有 ObjectURL
  useEffect(
    () => () => {
      itemsRef.current.forEach((it) => {
        URL.revokeObjectURL(it.originalUrl)
        if (it.compressedUrl) URL.revokeObjectURL(it.compressedUrl)
      })
    },
    [],
  )

  /** 调度压缩单张图片（带版本号防竞态） */
  const runCompressOne = useCallback((id: string, file: File, options: CompressOptions, version: number) => {
    compressPool
      .compress(file, options, avifRef.current)
      .then((result) => {
        const current = itemsRef.current.find((it) => it.id === id)
        // 图片已移除或已有更新的配置版本，直接丢弃旧结果
        if (!current || current.version !== version) return
        const nextUrl = URL.createObjectURL(result.blob)
        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== id) return it
            if (it.compressedUrl) URL.revokeObjectURL(it.compressedUrl)
            return { ...it, status: 'done', result, compressedUrl: nextUrl, error: undefined }
          }),
        )
      })
      .catch((err) => {
        const current = itemsRef.current.find((it) => it.id === id)
        if (!current || current.version !== version) return
        setItems((prev) =>
          prev.map((it) =>
            it.id === id
              ? { ...it, status: 'error', error: err instanceof Error ? err.message : '压缩失败' }
              : it,
          ),
        )
      })
  }, [])

  /** 参数变化时防抖触发全队列重新压缩 */
  const firstOptsEffect = useRef(true)
  useEffect(() => {
    if (firstOptsEffect.current) {
      firstOptsEffect.current = false
      return
    }
    if (!itemsRef.current.length) return

    const timer = window.setTimeout(() => {
      const nextVer = ++versionRef.current
      const snapshot = itemsRef.current
      setItems((prev) => prev.map((it) => ({ ...it, status: 'processing', version: nextVer })))
      snapshot.forEach((it) => runCompressOne(it.id, it.workFile, opts, nextVer))
    }, 180)

    return () => window.clearTimeout(timer)
  }, [opts, runCompressOne])

  /** 添加图片并立即入队压缩（支持普通位图与 iPhone 15/16 HEIC 照片） */
  const addFiles = useCallback(
    async (files: File[]) => {
      const valid = files.filter(isImageLike)
      if (!valid.length) {
        toast.error('请选择有效的图片文件')
        return
      }
      const ver = versionRef.current
      const loaded = await Promise.allSettled(
        valid.map(async (file): Promise<CompressItem> => {
          let workFile = file
          let dims: { width: number; height: number }
          if (isHeicLike(file)) {
            workFile = await decodeHeicToPngFile(file)
            dims = await readImageDimensions(workFile)
          } else {
            try {
              dims = await readImageDimensions(file)
            } catch {
              workFile = await decodeHeicToPngFile(file)
              dims = await readImageDimensions(workFile)
            }
          }
          return {
            id: uid(),
            file,
            workFile,
            originalUrl: URL.createObjectURL(workFile),
            originalWidth: dims.width,
            originalHeight: dims.height,
            status: 'processing',
            version: ver,
          }
        }),
      )
      const ok = loaded
        .filter((r): r is PromiseFulfilledResult<CompressItem> => r.status === 'fulfilled')
        .map((r) => r.value)
      const failedCount = loaded.length - ok.length
      if (failedCount > 0) toast.error(`${failedCount} 张图片无法读取，可能已损坏或格式不受支持`)
      if (!ok.length) return

      setItems((prev) => [...prev, ...ok])
      setSelectedId((prev) => prev ?? ok[0].id)
      ok.forEach((it) => runCompressOne(it.id, it.workFile, optsRef.current, ver))
    },
    [runCompressOne],
  )

  const removeItem = (id: string) => {
    setItems((prev) => {
      const target = prev.find((it) => it.id === id)
      if (target) {
        URL.revokeObjectURL(target.originalUrl)
        if (target.compressedUrl) URL.revokeObjectURL(target.compressedUrl)
      }
      const rest = prev.filter((it) => it.id !== id)
      setSelectedId((cur) => (cur === id ? (rest[0]?.id ?? null) : cur))
      return rest
    })
  }

  const clearAll = () => {
    items.forEach((it) => {
      URL.revokeObjectURL(it.originalUrl)
      if (it.compressedUrl) URL.revokeObjectURL(it.compressedUrl)
    })
    setItems([])
    setSelectedId(null)
  }

  const selectedItem = useMemo(
    () => items.find((it) => it.id === selectedId) ?? items[0] ?? null,
    [items, selectedId],
  )

  // 汇总统计
  const stats = useMemo(() => {
    let originalTotal = 0
    let compressedTotal = 0
    let doneCount = 0
    let busyCount = 0
    for (const it of items) {
      originalTotal += it.file.size
      if (it.status === 'done' && it.result) {
        doneCount++
        compressedTotal += it.result.blob.size
      } else if (it.status === 'pending' || it.status === 'processing') {
        busyCount++
      }
    }
    const savedBytes = Math.max(0, originalTotal - compressedTotal)
    const savedPct = doneCount > 0 ? savedPercent(originalTotal, compressedTotal) : 0
    return { originalTotal, compressedTotal, doneCount, busyCount, savedBytes, savedPct }
  }, [items])

  const downloadOne = (it: CompressItem) => {
    if (!it.result) return
    downloadBlob(it.result.blob, outputFileName(it.file.name, it.result.mime))
    toast.success(`已保存 ${outputFileName(it.file.name, it.result.mime)}`)
  }

  const copySelected = async () => {
    if (!selectedItem?.result) return
    setCopying(true)
    try {
      let blob = selectedItem.result.blob
      // 浏览器剪贴板通常只可靠支持 image/png，非 PNG 需转换一次
      if (blob.type !== 'image/png') {
        const bitmap = await createImageBitmap(blob)
        const c = document.createElement('canvas')
        c.width = bitmap.width
        c.height = bitmap.height
        c.getContext('2d')!.drawImage(bitmap, 0, 0)
        bitmap.close()
        blob = await new Promise<Blob>((resolve, reject) =>
          c.toBlob((b) => (b ? resolve(b) : reject(new Error('转换失败'))), 'image/png'),
        )
        c.width = 0
        c.height = 0
      }
      await copyImageToClipboard(blob)
      toast.success('已复制压缩后的图片到剪贴板')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制失败')
    } finally {
      setCopying(false)
    }
  }

  const downloadAllZip = async () => {
    if (stats.doneCount === 0) return
    if (items.length === 1 && selectedItem?.result) {
      downloadOne(selectedItem)
      return
    }
    setZipping(true)
    try {
      const zipBlob = await packCompressedZip(items)
      downloadBlob(zipBlob, timestampName('轻匣-图片压缩', 'zip'))
      toast.success(`已打包 ${stats.doneCount} 张图片 · ${formatBytes(zipBlob.size)}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ZIP 打包失败')
    } finally {
      setZipping(false)
    }
  }

  // 空状态
  if (!items.length) {
    return (
      <div className="space-y-6">
        <FileDropzone
          accept={IMAGE_ACCEPT}
          onFiles={addFiles}
          title="拖放图片到这里，支持批量压缩"
          hint="支持 JPG / PNG / WebP / AVIF / HEIC，可直接 Ctrl / ⌘ + V 粘贴，全程浏览器本地处理"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: <Sparkles />, t: '智能 PNG 量化', d: '调色板量化压缩透明 PNG，体积极速瘦身' },
            { icon: <Eye />, t: '实时画质对比', d: 'Before / After 滑动条与 4 倍细节放大镜' },
            { icon: <Archive />, t: '批量一键打包', d: '多图后台并发处理，完成一键导出 ZIP' },
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

  const pngColors = qualityToPngColors(opts.quality)
  const hasPng =
    opts.format === 'image/png' ||
    (opts.format === 'original' && items.some((it) => it.file.type === 'image/png'))
  const showJpegBg =
    opts.format === 'image/jpeg' ||
    (opts.format === 'original' && items.some((it) => it.file.type === 'image/jpeg'))

  const panel = (
    <>
      {/* 快捷预设 */}
      <Field label="快捷预设">
        <div className="grid grid-cols-3 gap-2">
          {presets.map((p) => {
            const active = opts.quality === p.quality
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => set('quality', p.quality)}
                className={cn(
                  'rounded-xl border px-2.5 py-2 text-left transition-all active:scale-[0.98]',
                  active
                    ? 'border-primary bg-primary/10 text-foreground shadow-soft'
                    : 'bg-card-solid/50 text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]',
                )}
              >
                <div className="text-xs font-semibold">{p.label}</div>
                <div className="text-muted-foreground mt-0.5 font-mono text-[11px]">{p.quality}%</div>
              </button>
            )
          })}
        </div>
      </Field>

      {/* 输出格式 */}
      <Field label="输出格式">
        <Segmented<OutputFormat>
          size="sm"
          value={opts.format}
          onChange={(v) => set('format', v)}
          options={[
            { value: 'original', label: '原格式' },
            { value: 'image/webp', label: 'WebP' },
            { value: 'image/jpeg', label: 'JPG' },
            { value: 'image/png', label: 'PNG' },
            ...(avifSupported ? [{ value: 'image/avif' as const, label: 'AVIF' }] : []),
          ]}
        />
        {!avifSupported && (
          <p className="text-muted-foreground text-[11px]">提示：当前浏览器暂不支持 AVIF 编码，已自动隐藏该格式。</p>
        )}
      </Field>

      {/* 压缩画质 */}
      <Field
        label="压缩画质"
        value={
          <span>
            {opts.quality}%
            {hasPng && (
              <span className="text-muted-foreground ml-1.5">
                ({pngColors === 0 ? 'PNG 无损' : `PNG ${pngColors} 色`})
              </span>
            )}
          </span>
        }
      >
        <Slider value={opts.quality} min={10} max={100} onChange={(v) => set('quality', v)} />
        <div className="text-muted-foreground flex justify-between text-[11px]">
          <span>体积更小</span>
          <span>推荐 75–85%</span>
          <span>画质最高</span>
        </div>
      </Field>

      {/* 尺寸限制 */}
      <div className="space-y-3 border-t pt-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-foreground/80 text-sm font-medium">限制最大边长</div>
            <div className="text-muted-foreground text-xs">超出则等比缩小，小图不放大</div>
          </div>
          <Switch checked={opts.limitSize} onChange={(v) => set('limitSize', v)} label="限制最大边长" />
        </div>
        <AnimatePresence initial={false}>
          {opts.limitSize && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-3 overflow-hidden pt-1"
            >
              <Field label="最大宽高" value={`${opts.maxDimension} px`}>
                <Slider value={opts.maxDimension} min={320} max={4096} step={64} onChange={(v) => set('maxDimension', v)} />
              </Field>
              <div className="flex flex-wrap gap-1.5">
                {SIZE_PRESETS.map((px) => (
                  <button
                    key={px}
                    type="button"
                    onClick={() => set('maxDimension', px)}
                    className={cn(
                      'rounded-lg border px-2 py-1 font-mono text-[11px] transition-colors',
                      opts.maxDimension === px
                        ? 'border-primary bg-primary/10 text-primary font-semibold'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {px}px
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 透明底转 JPG 填充色 */}
      {showJpegBg && (
        <Field label="JPG 背景填充色" value={opts.jpegBg}>
          <ColorPicker
            value={opts.jpegBg}
            onChange={(v) => set('jpegBg', v)}
            presets={['#ffffff', '#000000', '#f5f5f4', '#1e1e2e', '#fde68a', '#bfdbfe']}
          />
        </Field>
      )}

      {/* 保留更小体积开关 */}
      <div className="flex items-center justify-between border-t pt-5">
        <div>
          <div className="text-foreground/80 text-sm font-medium">防反向增大</div>
          <div className="text-muted-foreground text-xs">同格式下若压缩后更大则保留原图</div>
        </div>
        <Switch checked={opts.keepSmaller} onChange={(v) => set('keepSmaller', v)} label="防反向增大" />
      </div>
    </>
  )

  const actions =
    items.length === 1 ? (
      <>
        <Button
          variant="outline"
          size="lg"
          onClick={copySelected}
          disabled={!selectedItem?.result || copying}
          className="max-lg:!flex-none max-lg:px-4"
        >
          {copying ? <Loader2 className="animate-spin" /> : <Copy />}
          <span className="max-sm:hidden">复制</span>
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={() => selectedItem && downloadOne(selectedItem)}
          disabled={!selectedItem?.result}
        >
          <Download />
          下载图片
        </Button>
      </>
    ) : (
      <Button
        variant="primary"
        size="lg"
        onClick={downloadAllZip}
        disabled={stats.doneCount === 0 || zipping}
      >
        {zipping ? <Loader2 className="animate-spin" /> : <Archive />}
        {zipping ? '正在打包…' : `打包 ZIP 下载（${stats.doneCount}/${items.length}）`}
      </Button>
    )

  return (
    <ToolShell panel={panel} actions={actions} panelTitle="压缩参数">
      <div className="space-y-5">
        {/* 顶部汇总统计卡片 */}
        <div className="glass shadow-soft flex flex-wrap items-center gap-4 rounded-2xl px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="bg-primary/12 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
              {stats.busyCount > 0 ? <Loader2 className="size-5 animate-spin" /> : <Layers className="size-5" />}
            </span>
            <div>
              <div className="text-muted-foreground text-xs">
                {stats.busyCount > 0
                  ? `后台压缩中（已完成 ${stats.doneCount}/${items.length}）`
                  : `共 ${items.length} 张图片已完成压缩`}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-sm font-semibold tabular-nums">
                <span className="text-muted-foreground line-through decoration-1">
                  {formatBytes(stats.originalTotal)}
                </span>
                <ArrowRight className="text-muted-foreground size-3.5" />
                <span>{stats.doneCount > 0 ? formatBytes(stats.compressedTotal) : '…'}</span>
                {stats.doneCount > 0 && stats.savedBytes > 0 && (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    共省 {formatBytes(stats.savedBytes)} (-{stats.savedPct}%)
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={clearAll} className="text-muted-foreground hover:text-red-500">
              <Trash2 />
              清空
            </Button>
          </div>
        </div>

        {/* Before / After 对比视口 */}
        {selectedItem && (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium truncate max-w-[260px] sm:max-w-md">{selectedItem.file.name}</span>
              <span className="text-muted-foreground font-mono tabular-nums">
                {selectedItem.originalWidth}×{selectedItem.originalHeight}
                {selectedItem.result &&
                  (selectedItem.result.width !== selectedItem.originalWidth ||
                    selectedItem.result.height !== selectedItem.originalHeight) && (
                    <> → {selectedItem.result.width}×{selectedItem.result.height}</>
                  )}
              </span>
              {selectedItem.result && (
                <span className="text-muted-foreground hidden sm:inline">
                  · 耗时 {selectedItem.result.durationMs}ms
                </span>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copySelected}
                  disabled={!selectedItem.result || copying}
                >
                  <Copy />
                  复制
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => downloadOne(selectedItem)}
                  disabled={!selectedItem.result}
                >
                  <Download />
                  下载此图
                </Button>
              </div>
            </div>

            <CompareView item={selectedItem} />
          </div>
        )}

        {/* 批量图片队列 */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
              <SlidersHorizontal className="size-3.5" />
              图片队列（点击切换上方画质对比）
            </span>
            <span className="text-muted-foreground font-mono">{items.length} 项</span>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <AnimatePresence initial={false}>
              {items.map((it) => {
                const active = selectedItem?.id === it.id
                const res = it.result
                const pct = res ? savedPercent(it.file.size, res.blob.size) : 0
                return (
                  <motion.div
                    key={it.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96 }}
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
                      'group bg-card relative flex cursor-pointer items-center gap-3 rounded-2xl border p-2.5 backdrop-blur-xl transition-all',
                      active
                        ? 'border-primary ring-primary/20 ring-2'
                        : 'hover:border-foreground/20',
                    )}
                  >
                    <div className="checkerboard relative size-12 shrink-0 overflow-hidden rounded-xl border">
                      <img src={it.originalUrl} alt="" className="size-full object-cover" draggable={false} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{it.file.name}</span>
                        {res && (
                          <span className="bg-foreground/[0.06] text-muted-foreground shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]">
                            {mimeLabel(res.mime)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                        {it.status === 'processing' || it.status === 'pending' ? (
                          <span className="text-primary flex items-center gap-1">
                            <Loader2 className="size-3 animate-spin" />
                            压缩中…
                          </span>
                        ) : it.status === 'error' ? (
                          <span className="flex items-center gap-1 text-red-500">
                            <FileWarning className="size-3" />
                            {it.error || '压缩失败'}
                          </span>
                        ) : res ? (
                          <>
                            <span className="text-muted-foreground font-mono tabular-nums">
                              {formatBytes(it.file.size)}
                            </span>
                            <ArrowRight className="text-muted-foreground size-3" />
                            <span className="font-mono font-semibold tabular-nums">
                              {formatBytes(res.blob.size)}
                            </span>
                            {res.keptOriginal ? (
                              <span className="bg-foreground/[0.07] text-muted-foreground inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px]">
                                <CheckCircle2 className="size-2.5" />
                                已最优
                              </span>
                            ) : (
                              <span
                                className={cn(
                                  'rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold',
                                  pct > 0
                                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                                )}
                              >
                                {pct > 0 ? `-${pct}%` : `+${Math.abs(pct)}%`}
                              </span>
                            )}
                          </>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        disabled={!res}
                        onClick={() => downloadOne(it)}
                        aria-label="下载此图片"
                        className="text-muted-foreground hover:text-primary hover:bg-primary/10 flex size-8 items-center justify-center rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-35"
                      >
                        <Download className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(it.id)}
                        aria-label="移除此图片"
                        className="text-muted-foreground flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-red-500/10 hover:text-red-500"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>

          <FileDropzone compact accept={IMAGE_ACCEPT} onFiles={addFiles} title="继续添加图片（支持拖放或 Ctrl/⌘ + V 粘贴）" />
        </div>
      </div>
    </ToolShell>
  )
}
