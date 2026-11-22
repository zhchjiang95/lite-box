import { AnimatePresence, motion } from 'motion/react'
import {
  Archive,
  ArrowRight,
  Check,
  Copy,
  Download,
  FileWarning,
  Grid2x2,
  Image as ImageIcon,
  Layers,
  Loader2,
  RefreshCw,
  Smartphone,
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
import { ColorPicker, Field } from '@/components/ui/field'
import { copyImageToClipboard, downloadBlob, timestampName } from '@/lib/file'
import { cn, formatBytes, uid } from '@/lib/utils'
import { convertBitmap, decodeInputFile, detectAvifSupport, packConvertedZip } from './engine'
import {
  FORMAT_LIST,
  FORMAT_MAP,
  ICO_SIZES,
  convertedFileName,
  defaultConvertOptions,
  detectSourceLabel,
  isHeicFile,
  isSupportedInputImage,
  type ConvertItem,
  type ConvertOptions,
  type IcoFit,
  type IcoSize,
  type ScaleMode,
} from './types'

const SCALE_PRESETS = [
  { value: '0.5', label: '0.5×' },
  { value: '0.75', label: '0.75×' },
  { value: '1', label: '1×' },
  { value: '2', label: '2×' },
]

const ACCEPT_ATTR = 'image/*,.heic,.heif,.ico,.bmp,.svg'

export default function ImageConvert() {
  const [items, setItems] = useState<ConvertItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [opts, setOpts] = useState<ConvertOptions>(defaultConvertOptions)
  const [avifSupported, setAvifSupported] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [copying, setCopying] = useState(false)

  // 缓存已解码的 ImageBitmap（HEIC 等重格式只需解码一次，切换目标格式可秒级重编码）
  const bitmapCacheRef = useRef(new Map<string, ImageBitmap>())
  const itemsRef = useRef(items)
  itemsRef.current = items
  const optsRef = useRef(opts)
  optsRef.current = opts
  const avifRef = useRef(avifSupported)
  avifRef.current = avifSupported
  const versionRef = useRef(1)

  const set = <K extends keyof ConvertOptions>(k: K, v: ConvertOptions[K]) =>
    setOpts((prev) => ({ ...prev, [k]: v }))

  useEffect(() => {
    detectAvifSupport().then(setAvifSupported)
  }, [])

  // 卸载时释放所有 ImageBitmap 与 ObjectURL
  useEffect(
    () => () => {
      bitmapCacheRef.current.forEach((bmp) => bmp.close())
      bitmapCacheRef.current.clear()
      itemsRef.current.forEach((it) => {
        if (it.sourcePreviewUrl) URL.revokeObjectURL(it.sourcePreviewUrl)
        if (it.result?.previewUrl) URL.revokeObjectURL(it.result.previewUrl)
      })
    },
    [],
  )

  /** 对已解码的单项执行格式转换 */
  const runConvertOne = useCallback(async (id: string, options: ConvertOptions, version: number) => {
    const bitmap = bitmapCacheRef.current.get(id)
    if (!bitmap) return
    try {
      const result = await convertBitmap(bitmap, options, avifRef.current)
      const current = itemsRef.current.find((it) => it.id === id)
      if (!current || current.version !== version) {
        URL.revokeObjectURL(result.previewUrl)
        return
      }
      setItems((prev) =>
        prev.map((it) => {
          if (it.id !== id) return it
          if (it.result?.previewUrl) URL.revokeObjectURL(it.result.previewUrl)
          return { ...it, status: 'done', result, error: undefined }
        }),
      )
    } catch (err) {
      const current = itemsRef.current.find((it) => it.id === id)
      if (!current || current.version !== version) return
      setItems((prev) =>
        prev.map((it) =>
          it.id === id
            ? { ...it, status: 'error', error: err instanceof Error ? err.message : '转换失败' }
            : it,
        ),
      )
    }
  }, [])

  /** 参数变更时防抖重新转换所有已解码图片 */
  const firstRunRef = useRef(true)
  useEffect(() => {
    if (firstRunRef.current) {
      firstRunRef.current = false
      return
    }
    if (!itemsRef.current.length) return

    const timer = window.setTimeout(() => {
      const nextVer = ++versionRef.current
      const snapshot = itemsRef.current.filter((it) => bitmapCacheRef.current.has(it.id))
      setItems((prev) =>
        prev.map((it) =>
          bitmapCacheRef.current.has(it.id) ? { ...it, status: 'converting', version: nextVer } : it,
        ),
      )
      // 顺序或轻量并发转换，避免大量高分辨率画布瞬时占满显存
      const runBatch = async () => {
        const concurrency = 3
        let idx = 0
        const worker = async () => {
          while (idx < snapshot.length) {
            const target = snapshot[idx++]
            await runConvertOne(target.id, opts, nextVer)
          }
        }
        await Promise.all(Array.from({ length: Math.min(concurrency, snapshot.length) }, worker))
      }
      void runBatch()
    }, 160)

    return () => window.clearTimeout(timer)
  }, [opts, runConvertOne])

  /** 添加文件：入队后先解码（支持 HEIC/SVG），再立即按当前配置转换 */
  const addFiles = useCallback(
    async (files: File[]) => {
      const valid = files.filter(isSupportedInputImage)
      if (!valid.length) {
        toast.error('未检测到支持的图片文件（支持 PNG/JPG/WebP/AVIF/BMP/ICO/SVG/HEIC）')
        return
      }
      const ver = versionRef.current
      const newItems: ConvertItem[] = valid.map((file) => ({
        id: uid(),
        file,
        sourceLabel: detectSourceLabel(file),
        isHeic: isHeicFile(file),
        sourcePreviewUrl: '',
        originalWidth: 0,
        originalHeight: 0,
        status: 'decoding',
        version: ver,
      }))

      setItems((prev) => [...prev, ...newItems])
      setSelectedId((prev) => prev ?? newItems[0].id)

      // 逐批解码与转换（控制并发数为 2，防止批量 HEIC 解码占用过多内存）
      let cursor = 0
      const runner = async () => {
        while (cursor < newItems.length) {
          const item = newItems[cursor++]
          try {
            const decoded = await decodeInputFile(item.file)
            // 若在解码期间用户已移除该文件，立即释放内存
            if (!itemsRef.current.some((x) => x.id === item.id)) {
              decoded.bitmap.close()
              URL.revokeObjectURL(decoded.previewUrl)
              continue
            }
            bitmapCacheRef.current.set(item.id, decoded.bitmap)
            const latestVer = versionRef.current
            setItems((prev) =>
              prev.map((x) =>
                x.id === item.id
                  ? {
                      ...x,
                      sourcePreviewUrl: decoded.previewUrl,
                      originalWidth: decoded.width,
                      originalHeight: decoded.height,
                      status: 'converting',
                      version: latestVer,
                    }
                  : x,
              ),
            )
            await runConvertOne(item.id, optsRef.current, latestVer)
          } catch (err) {
            setItems((prev) =>
              prev.map((x) =>
                x.id === item.id
                  ? { ...x, status: 'error', error: err instanceof Error ? err.message : '解码失败' }
                  : x,
              ),
            )
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(2, newItems.length) }, runner))
    },
    [runConvertOne],
  )

  const removeItem = (id: string) => {
    const bmp = bitmapCacheRef.current.get(id)
    if (bmp) {
      bmp.close()
      bitmapCacheRef.current.delete(id)
    }
    setItems((prev) => {
      const target = prev.find((it) => it.id === id)
      if (target) {
        if (target.sourcePreviewUrl) URL.revokeObjectURL(target.sourcePreviewUrl)
        if (target.result?.previewUrl) URL.revokeObjectURL(target.result.previewUrl)
      }
      const rest = prev.filter((it) => it.id !== id)
      setSelectedId((cur) => (cur === id ? (rest[0]?.id ?? null) : cur))
      return rest
    })
  }

  const clearAll = () => {
    bitmapCacheRef.current.forEach((bmp) => bmp.close())
    bitmapCacheRef.current.clear()
    items.forEach((it) => {
      if (it.sourcePreviewUrl) URL.revokeObjectURL(it.sourcePreviewUrl)
      if (it.result?.previewUrl) URL.revokeObjectURL(it.result.previewUrl)
    })
    setItems([])
    setSelectedId(null)
  }

  const toggleIcoSize = (size: IcoSize) => {
    setOpts((prev) => {
      const exists = prev.icoSizes.includes(size)
      if (exists && prev.icoSizes.length <= 1) {
        toast.info('至少保留 1 个 ICO 图标尺寸')
        return prev
      }
      const next = exists ? prev.icoSizes.filter((s) => s !== size) : [...prev.icoSizes, size].sort((a, b) => a - b)
      return { ...prev, icoSizes: next }
    })
  }

  const selectedItem = useMemo(
    () => items.find((it) => it.id === selectedId) ?? items[0] ?? null,
    [items, selectedId],
  )

  const stats = useMemo(() => {
    let originalTotal = 0
    let outputTotal = 0
    let doneCount = 0
    let busyCount = 0
    for (const it of items) {
      originalTotal += it.file.size
      if (it.status === 'done' && it.result) {
        doneCount++
        outputTotal += it.result.blob.size
      } else if (it.status === 'decoding' || it.status === 'converting') {
        busyCount++
      }
    }
    const diffPct =
      doneCount > 0 && originalTotal > 0 ? Math.round(((outputTotal - originalTotal) / originalTotal) * 100) : 0
    return { originalTotal, outputTotal, doneCount, busyCount, diffPct }
  }, [items])

  const formatInfo = FORMAT_MAP[opts.format]

  const downloadOne = (it: ConvertItem) => {
    if (!it.result) return
    const name = convertedFileName(it.file.name, it.result.format)
    downloadBlob(it.result.blob, name)
    toast.success(`已保存 ${name}`)
  }

  const copySelected = async () => {
    if (!selectedItem?.result) return
    setCopying(true)
    try {
      // 剪贴板仅可靠支持 image/png，将预览图渲染为 PNG 后写入剪贴板
      const resp = await fetch(selectedItem.result.previewUrl)
      let blob = await resp.blob()
      if (blob.type !== 'image/png') {
        const bmp = await createImageBitmap(blob)
        const c = document.createElement('canvas')
        c.width = bmp.width
        c.height = bmp.height
        c.getContext('2d')!.drawImage(bmp, 0, 0)
        bmp.close()
        blob = await new Promise<Blob>((resolve, reject) =>
          c.toBlob((b) => (b ? resolve(b) : reject(new Error('复制失败'))), 'image/png'),
        )
        c.width = 0
        c.height = 0
      }
      await copyImageToClipboard(blob)
      toast.success('已复制图像到剪贴板')
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
      const zipBlob = await packConvertedZip(items)
      downloadBlob(zipBlob, timestampName(`轻匣-转${formatInfo.label}`, 'zip'))
      toast.success(`已打包 ${stats.doneCount} 个 ${formatInfo.label} 文件 · ${formatBytes(zipBlob.size)}`)
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
          accept={ACCEPT_ATTR}
          onFiles={addFiles}
          title="拖放图片到这里，批量转换格式"
          hint="支持 PNG / JPG / WebP / AVIF / BMP / ICO / SVG 以及苹果 HEIC / HEIF，可直接 Ctrl / ⌘ + V 粘贴"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: <RefreshCw />, t: '6 大格式互转', d: 'PNG、JPG、WebP、AVIF、真 24 位 BMP 与 ICO' },
            { icon: <Smartphone />, t: '支持苹果 HEIC / HEIF', d: '自动按需解码 iPhone 照片，直转 JPG / PNG' },
            { icon: <Grid2x2 />, t: '多尺寸 ICO 图标封装', d: '一键将 16–256px 多分辨率打包为标准 Favicon' },
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
      {/* 目标格式：6 格卡片选择 */}
      <Field label="目标格式" value={`.${formatInfo.ext}`}>
        <div className="grid grid-cols-2 gap-2">
          {FORMAT_LIST.map((f) => {
            const disabled = f.id === 'avif' && !avifSupported
            const active = opts.format === f.id
            return (
              <button
                key={f.id}
                type="button"
                disabled={disabled}
                onClick={() => set('format', f.id)}
                className={cn(
                  'relative flex flex-col items-start rounded-xl border px-3 py-2.5 text-left transition-all active:scale-[0.98]',
                  disabled && 'cursor-not-allowed opacity-45',
                  active
                    ? 'border-primary bg-primary/10 text-foreground shadow-soft'
                    : 'bg-card-solid/50 text-foreground/85 hover:bg-foreground/[0.04]',
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="font-mono text-sm font-bold">{f.label}</span>
                  {active && <Check className="text-primary size-3.5" />}
                </div>
                <span className="text-muted-foreground mt-0.5 text-[11px]">
                  {disabled ? '浏览器不支持' : f.tag}
                </span>
              </button>
            )
          })}
        </div>
      </Field>

      {/* 有损格式质量滑块 */}
      <AnimatePresence initial={false}>
        {formatInfo.lossy && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <Field label="输出质量" value={`${opts.quality}%`}>
              <Slider value={opts.quality} min={10} max={100} onChange={(v) => set('quality', v)} />
              <div className="text-muted-foreground flex justify-between text-[11px]">
                <span>小体积</span>
                <span>推荐 85–92%</span>
                <span>高画质</span>
              </div>
            </Field>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 无透明通道格式（JPG / BMP）的背景填充色 */}
      <AnimatePresence initial={false}>
        {!formatInfo.alpha && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <Field label="透明区域底色" value={opts.background}>
              <ColorPicker
                value={opts.background}
                onChange={(v) => set('background', v)}
                presets={['#ffffff', '#000000', '#f5f5f4', '#1e1e2e', '#fde68a', '#bfdbfe']}
              />
            </Field>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ICO 专属配置：多尺寸勾选 + 裁切模式 */}
      {opts.format === 'ico' ? (
        <div className="space-y-5 border-t pt-5">
          <Field
            label="包含图标尺寸"
            value={
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => set('icoSizes', [16, 32, 48])}
                  className="text-primary hover:underline"
                >
                  Favicon
                </button>
                <button
                  type="button"
                  onClick={() => set('icoSizes', [...ICO_SIZES])}
                  className="text-primary hover:underline"
                >
                  全选
                </button>
              </span>
            }
          >
            <div className="grid grid-cols-3 gap-1.5">
              {ICO_SIZES.map((s) => {
                const checked = opts.icoSizes.includes(s)
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleIcoSize(s)}
                    className={cn(
                      'flex items-center justify-center gap-1 rounded-lg border py-1.5 font-mono text-xs transition-all',
                      checked
                        ? 'border-primary bg-primary/10 text-primary font-semibold'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {checked && <Check className="size-3" />}
                    {s}×{s}
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label="正方形适配">
            <Segmented<IcoFit>
              size="sm"
              value={opts.icoFit}
              onChange={(v) => set('icoFit', v)}
              options={[
                { value: 'contain', label: '保持比例' },
                { value: 'cover', label: '裁切铺满' },
              ]}
            />
          </Field>
        </div>
      ) : (
        /* 非 ICO 的尺寸调整选项 */
        <div className="space-y-4 border-t pt-5">
          <Field label="输出尺寸">
            <Segmented<ScaleMode>
              size="sm"
              value={opts.scaleMode}
              onChange={(v) => set('scaleMode', v)}
              options={[
                { value: 'original', label: '原尺寸' },
                { value: 'scale', label: '按倍率' },
                { value: 'max', label: '限最大边' },
              ]}
            />
          </Field>
          {opts.scaleMode === 'scale' && (
            <Field label="缩放倍率" value={`${opts.scaleFactor}×`}>
              <Segmented
                size="sm"
                value={String(opts.scaleFactor)}
                onChange={(v) => set('scaleFactor', Number(v))}
                options={SCALE_PRESETS}
              />
            </Field>
          )}
          {opts.scaleMode === 'max' && (
            <Field label="最大边长" value={`${opts.maxDimension} px`}>
              <Slider
                value={opts.maxDimension}
                min={256}
                max={4096}
                step={64}
                onChange={(v) => set('maxDimension', v)}
              />
            </Field>
          )}
        </div>
      )}
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
          下载 .{formatInfo.ext}
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
    <ToolShell panel={panel} actions={actions} panelTitle="转换设置">
      <div className="space-y-5">
        {/* 顶部汇总状态条 */}
        <div className="glass shadow-soft flex flex-wrap items-center gap-4 rounded-2xl px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="bg-primary/12 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
              {stats.busyCount > 0 ? <Loader2 className="size-5 animate-spin" /> : <Layers className="size-5" />}
            </span>
            <div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">
                  {stats.busyCount > 0
                    ? `正在本地转换（${stats.doneCount}/${items.length}）`
                    : `共 ${items.length} 张图片已转为`}
                </span>
                <span className="bg-primary/12 text-primary rounded-md px-1.5 py-0.5 font-mono font-semibold">
                  {formatInfo.label}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-sm font-semibold tabular-nums">
                <span className="text-muted-foreground">{formatBytes(stats.originalTotal)}</span>
                <ArrowRight className="text-muted-foreground size-3.5" />
                <span>{stats.doneCount > 0 ? formatBytes(stats.outputTotal) : '…'}</span>
                {stats.doneCount > 0 && stats.diffPct !== 0 && (
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-semibold',
                      stats.diffPct < 0
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-foreground/[0.07] text-muted-foreground',
                    )}
                  >
                    {stats.diffPct > 0 ? `+${stats.diffPct}%` : `${stats.diffPct}%`}
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

        {/* 选中图片的转换结果预览 */}
        {selectedItem && (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="max-w-[240px] truncate font-medium sm:max-w-md">{selectedItem.file.name}</span>
              <span className="bg-foreground/[0.06] inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono">
                <span>{selectedItem.sourceLabel}</span>
                <ArrowRight className="size-3 opacity-60" />
                <span className="text-primary font-semibold">{formatInfo.label}</span>
              </span>
              {selectedItem.result && (
                <span className="text-muted-foreground font-mono tabular-nums">
                  {selectedItem.result.icoSizes
                    ? `含 ${selectedItem.result.icoSizes.join('/')}px`
                    : `${selectedItem.result.width}×${selectedItem.result.height}`}
                  {' · '}
                  {selectedItem.result.durationMs}ms
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

            <div className="checkerboard shadow-soft relative flex h-[min(48dvh,460px)] min-h-[240px] w-full items-center justify-center overflow-hidden rounded-3xl border p-4 sm:p-6">
              {selectedItem.result?.previewUrl || selectedItem.sourcePreviewUrl ? (
                <motion.img
                  key={`${selectedItem.id}-${selectedItem.result?.previewUrl ?? 'src'}`}
                  initial={{ opacity: 0.4, scale: 0.985 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.22 }}
                  src={selectedItem.result?.previewUrl || selectedItem.sourcePreviewUrl}
                  alt={selectedItem.file.name}
                  className="shadow-lift max-h-full max-w-full rounded-sm object-contain"
                />
              ) : (
                <div className="text-muted-foreground flex flex-col items-center gap-2 text-sm">
                  <ImageIcon className="size-8 opacity-40" />
                  <span>{selectedItem.status === 'error' ? selectedItem.error : '正在准备预览…'}</span>
                </div>
              )}

              {/* 右下角输出文件体积胶囊 */}
              {selectedItem.result && (
                <div className="pointer-events-none absolute right-3 bottom-3 flex items-center gap-1.5 rounded-full bg-black/65 px-3 py-1 text-xs font-medium text-white backdrop-blur-md">
                  <span className="font-mono">{convertedFileName(selectedItem.file.name, selectedItem.result.format)}</span>
                  <span className="opacity-60">·</span>
                  <span className="font-mono tabular-nums">{formatBytes(selectedItem.result.blob.size)}</span>
                </div>
              )}

              <AnimatePresence>
                {(selectedItem.status === 'decoding' || selectedItem.status === 'converting') && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="bg-background/45 absolute inset-0 flex items-center justify-center backdrop-blur-[2px]"
                  >
                    <div className="glass shadow-lift flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium">
                      <Loader2 className="text-primary size-4 animate-spin" />
                      {selectedItem.status === 'decoding' && selectedItem.isHeic
                        ? '正在解码 HEIC 照片…'
                        : '正在转换格式…'}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* 批量转换队列 */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground font-medium">转换队列（点击任意项切换预览）</span>
            <span className="text-muted-foreground font-mono">{items.length} 项</span>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <AnimatePresence initial={false}>
              {items.map((it) => {
                const active = selectedItem?.id === it.id
                const res = it.result
                const thumb = res?.previewUrl || it.sourcePreviewUrl
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
                      active ? 'border-primary ring-primary/20 ring-2' : 'hover:border-foreground/20',
                    )}
                  >
                    <div className="checkerboard relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border">
                      {thumb ? (
                        <img src={thumb} alt="" className="size-full object-cover" draggable={false} />
                      ) : (
                        <Loader2 className="text-muted-foreground size-4 animate-spin" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{it.file.name}</span>
                        <span className="bg-foreground/[0.06] text-muted-foreground inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 font-mono text-[10px]">
                          {it.sourceLabel}
                          <ArrowRight className="size-2.5" />
                          <span className="text-primary font-semibold">{formatInfo.label}</span>
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                        {it.status === 'decoding' ? (
                          <span className="text-primary flex items-center gap-1">
                            <Loader2 className="size-3 animate-spin" />
                            {it.isHeic ? '解码 HEIC 中…' : '读取中…'}
                          </span>
                        ) : it.status === 'converting' ? (
                          <span className="text-primary flex items-center gap-1">
                            <Loader2 className="size-3 animate-spin" />
                            转换中…
                          </span>
                        ) : it.status === 'error' ? (
                          <span className="flex items-center gap-1 text-red-500">
                            <FileWarning className="size-3" />
                            {it.error || '转换失败'}
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
                            <span className="text-muted-foreground font-mono text-[11px]">
                              · {res.icoSizes ? `${res.icoSizes.length} 尺寸` : `${res.width}×${res.height}`}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        disabled={!res}
                        onClick={() => downloadOne(it)}
                        aria-label="下载转换后的图片"
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

          <FileDropzone
            compact
            accept={ACCEPT_ATTR}
            onFiles={addFiles}
            title="继续添加图片（支持 PNG/JPG/WebP/HEIC/SVG 或粘贴）"
          />
        </div>
      </div>
    </ToolShell>
  )
}
