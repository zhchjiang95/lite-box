import { AnimatePresence, motion } from 'motion/react'
import {
  Archive,
  ArrowRight,
  Circle,
  Copy,
  Crop,
  Download,
  FileWarning,
  FlipHorizontal2,
  FlipVertical2,
  ImagePlus,
  Layers,
  Link2,
  Link2Off,
  Loader2,
  Maximize2,
  RotateCcw,
  RotateCw,
  Scissors,
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
import { IMAGE_ACCEPT, decodeImageFile, isImageLike } from '@/lib/image'
import { cn, formatBytes, uid } from '@/lib/utils'
import { CropCanvas } from './CropCanvas'
import {
  batchOutputName,
  exportCroppedImage,
  fitCropToRatio,
  getRotatedBounds,
  packResizedZip,
  processBatchItem,
} from './engine'
import {
  ASPECT_PRESETS,
  FORMAT_EXT,
  defaultBatchOptions,
  defaultTransform,
  type AspectPreset,
  type BatchFit,
  type BatchItem,
  type BatchResizeMode,
  type BatchResizeOptions,
  type ExportFormat,
  type NormalizedCrop,
  type TransformState,
  type WorkMode,
} from './types'

interface SingleImage {
  file: File
  name: string
  size: number
  bitmap: ImageBitmap
  width: number
  height: number
}

const PERCENT_PRESETS = [25, 50, 75, 150, 200] as const

export default function ImageCrop() {
  const [workMode, setWorkMode] = useState<WorkMode>('crop')

  // ==================== 单图精细裁剪状态 ====================
  const [single, setSingle] = useState<SingleImage | null>(null)
  const [transform, setTransform] = useState<TransformState>(defaultTransform)
  const [presetId, setPresetId] = useState<string>('free')
  const [crop, setCrop] = useState<NormalizedCrop>({ x: 0, y: 0, w: 1, h: 1 })
  const [circleMask, setCircleMask] = useState(false)
  const [customOutput, setCustomOutput] = useState(false)
  const [outW, setOutW] = useState(0)
  const [outH, setOutH] = useState(0)
  const [lockOutRatio, setLockOutRatio] = useState(true)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png')
  const [exportQuality, setExportQuality] = useState(92)
  const [jpegBg, setJpegBg] = useState('#ffffff')
  const [exporting, setExporting] = useState(false)
  const singleRef = useRef(single)
  singleRef.current = single

  // ==================== 多图批量缩放状态 ====================
  const [batchItems, setBatchItems] = useState<BatchItem[]>([])
  const [batchOpts, setBatchOpts] = useState<BatchResizeOptions>(defaultBatchOptions)
  const [zipping, setZipping] = useState(false)
  const batchBitmapsRef = useRef(new Map<string, ImageBitmap>())
  const batchItemsRef = useRef(batchItems)
  batchItemsRef.current = batchItems
  const batchOptsRef = useRef(batchOpts)
  batchOptsRef.current = batchOpts
  const batchVerRef = useRef(1)

  const setBatch = <K extends keyof BatchResizeOptions>(k: K, v: BatchResizeOptions[K]) =>
    setBatchOpts((prev) => ({ ...prev, [k]: v }))

  // 组件卸载时彻底释放显存与 URL
  useEffect(
    () => () => {
      singleRef.current?.bitmap.close()
      batchBitmapsRef.current.forEach((bmp) => bmp.close())
      batchBitmapsRef.current.clear()
      batchItemsRef.current.forEach((it) => URL.revokeObjectURL(it.url))
    },
    [],
  )

  const activePreset = useMemo(
    () => ASPECT_PRESETS.find((p) => p.id === presetId) ?? ASPECT_PRESETS[0],
    [presetId],
  )

  const singleBounds = useMemo(() => {
    if (!single) return { width: 1, height: 1 }
    return getRotatedBounds(single.width, single.height, transform.baseRotate + transform.fineRotate)
  }, [single, transform.baseRotate, transform.fineRotate])

  const cropPxW = Math.max(1, Math.round(crop.w * singleBounds.width))
  const cropPxH = Math.max(1, Math.round(crop.h * singleBounds.height))

  /** 载入单张图片进入精细裁剪（支持普通位图与 iPhone HEIC / HEIF） */
  const loadSingleFile = useCallback(async (file: File) => {
    try {
      const decoded = await decodeImageFile(file)
      // 精细裁剪直接基于 ImageBitmap 渲染，释放多余的 previewUrl
      URL.revokeObjectURL(decoded.previewUrl)
      singleRef.current?.bitmap.close()
      setSingle({
        file,
        name: file.name || '粘贴的图片',
        size: file.size,
        bitmap: decoded.bitmap,
        width: decoded.width,
        height: decoded.height,
      })
      setTransform(defaultTransform)
      setPresetId('free')
      setCrop({ x: 0, y: 0, w: 1, h: 1 })
      setCircleMask(false)
      setCustomOutput(false)
      setOutW(decoded.width)
      setOutH(decoded.height)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '无法读取该图片，请检查文件格式')
    }
  }, [])

  // 单图裁剪模式下支持随时 Ctrl/⌘ + V 粘贴替换图片
  useEffect(() => {
    if (workMode !== 'crop' || !single) return
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement
      if (/INPUT|TEXTAREA/.test(el.tagName) || el.isContentEditable) return
      const img = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'))
      if (img) {
        e.preventDefault()
        void loadSingleFile(img)
        toast.success('已载入剪贴板图片')
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [workMode, single, loadSingleFile])

  /** 切换裁剪比例或证件照预设 */
  const applyPreset = (preset: AspectPreset) => {
    setPresetId(preset.id)
    if (preset.ratio) {
      setCrop(fitCropToRatio(singleBounds.width, singleBounds.height, preset.ratio))
    }
    if (preset.outputSize) {
      setCustomOutput(true)
      setLockOutRatio(true)
      setOutW(preset.outputSize.width)
      setOutH(preset.outputSize.height)
    } else if (customOutput && preset.ratio) {
      setOutH(Math.max(1, Math.round(outW / preset.ratio)))
    }
  }

  /** 旋转 90° 或微调角度时，若锁定了比例则保持裁剪框比例合法 */
  const updateTransform = (patch: Partial<TransformState>) => {
    setTransform((prev) => {
      const next = { ...prev, ...patch }
      if (single && activePreset.ratio) {
        const nb = getRotatedBounds(single.width, single.height, next.baseRotate + next.fineRotate)
        setCrop(fitCropToRatio(nb.width, nb.height, activePreset.ratio))
      }
      return next
    })
  }

  const resetSingleTransform = () => {
    setTransform(defaultTransform)
    setPresetId('free')
    setCrop({ x: 0, y: 0, w: 1, h: 1 })
    setCircleMask(false)
    setCustomOutput(false)
  }

  const finalOutW = customOutput && outW > 0 ? outW : cropPxW
  const finalOutH = customOutput && outH > 0 ? outH : cropPxH

  const handleCustomW = (val: number) => {
    const w = Math.max(1, Math.min(16384, val || 1))
    setOutW(w)
    if (lockOutRatio) {
      const ratio = activePreset.ratio ?? cropPxW / cropPxH
      setOutH(Math.max(1, Math.round(w / ratio)))
    }
  }

  const handleCustomH = (val: number) => {
    const h = Math.max(1, Math.min(16384, val || 1))
    setOutH(h)
    if (lockOutRatio) {
      const ratio = activePreset.ratio ?? cropPxW / cropPxH
      setOutW(Math.max(1, Math.round(h * ratio)))
    }
  }

  /** 导出精细裁剪结果 */
  const onExportSingle = async (mode: 'download' | 'copy') => {
    if (!single) return
    setExporting(true)
    try {
      await new Promise((r) => setTimeout(r, 20))
      const fmt: ExportFormat = mode === 'copy' ? 'png' : exportFormat
      const blob = await exportCroppedImage({
        bitmap: single.bitmap,
        transform,
        crop,
        outWidth: finalOutW,
        outHeight: finalOutH,
        format: fmt,
        quality: exportQuality,
        background: jpegBg,
        circleMask: circleMask && fmt !== 'jpeg',
      })
      if (mode === 'copy') {
        await copyImageToClipboard(blob)
        toast.success(`已复制裁剪图片 · ${finalOutW}×${finalOutH}`)
      } else {
        const base = single.name.replace(/\.[^.]+$/, '') || 'cropped'
        downloadBlob(blob, `${base}-${finalOutW}x${finalOutH}.${FORMAT_EXT[fmt]}`)
        toast.success(`导出成功 · ${finalOutW}×${finalOutH} · ${formatBytes(blob.size)}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  // ==================== 批量缩放逻辑 ====================
  const runBatchOne = useCallback(async (id: string, file: File, opts: BatchResizeOptions, ver: number) => {
    const bmp = batchBitmapsRef.current.get(id)
    if (!bmp) return
    try {
      const res = await processBatchItem(bmp, file.type, opts)
      const cur = batchItemsRef.current.find((it) => it.id === id)
      if (!cur || cur.version !== ver) return
      setBatchItems((prev) =>
        prev.map((it) =>
          it.id === id
            ? {
                ...it,
                status: 'done',
                outWidth: res.width,
                outHeight: res.height,
                outBlob: res.blob,
                outMime: res.mime,
                error: undefined,
              }
            : it,
        ),
      )
    } catch (err) {
      const cur = batchItemsRef.current.find((it) => it.id === id)
      if (!cur || cur.version !== ver) return
      setBatchItems((prev) =>
        prev.map((it) =>
          it.id === id
            ? { ...it, status: 'error', error: err instanceof Error ? err.message : '缩放失败' }
            : it,
        ),
      )
    }
  }, [])

  // 批量参数变更时防抖重算
  const batchInitRef = useRef(true)
  useEffect(() => {
    if (batchInitRef.current) {
      batchInitRef.current = false
      return
    }
    if (!batchItemsRef.current.length) return
    const timer = window.setTimeout(() => {
      const nextVer = ++batchVerRef.current
      const snapshot = batchItemsRef.current
      setBatchItems((prev) => prev.map((it) => ({ ...it, status: 'processing', version: nextVer })))
      const run = async () => {
        let i = 0
        const worker = async () => {
          while (i < snapshot.length) {
            const target = snapshot[i++]
            await runBatchOne(target.id, target.file, batchOpts, nextVer)
          }
        }
        await Promise.all(Array.from({ length: Math.min(3, snapshot.length) }, worker))
      }
      void run()
    }, 180)
    return () => window.clearTimeout(timer)
  }, [batchOpts, runBatchOne])

  const addBatchFiles = useCallback(
    async (files: File[]) => {
      const valid = files.filter(isImageLike)
      if (!valid.length) {
        toast.error('请选择有效的图片文件')
        return
      }
      const ver = batchVerRef.current
      const loaded = await Promise.allSettled(
        valid.map(async (file): Promise<{ item: BatchItem; bmp: ImageBitmap }> => {
          const decoded = await decodeImageFile(file)
          return {
            bmp: decoded.bitmap,
            item: {
              id: uid(),
              file,
              url: decoded.previewUrl,
              width: decoded.width,
              height: decoded.height,
              status: 'processing',
              version: ver,
            },
          }
        }),
      )
      const ok = loaded
        .filter((r): r is PromiseFulfilledResult<{ item: BatchItem; bmp: ImageBitmap }> => r.status === 'fulfilled')
        .map((r) => r.value)
      if (loaded.length - ok.length > 0) toast.error(`${loaded.length - ok.length} 张图片无法解析`)
      if (!ok.length) return

      ok.forEach(({ item, bmp }) => batchBitmapsRef.current.set(item.id, bmp))
      setBatchItems((prev) => [...prev, ...ok.map((x) => x.item)])

      let i = 0
      const worker = async () => {
        while (i < ok.length) {
          const { item } = ok[i++]
          await runBatchOne(item.id, item.file, batchOptsRef.current, ver)
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, ok.length) }, worker))
    },
    [runBatchOne],
  )

  const removeBatchItem = (id: string) => {
    const bmp = batchBitmapsRef.current.get(id)
    if (bmp) {
      bmp.close()
      batchBitmapsRef.current.delete(id)
    }
    setBatchItems((prev) => {
      const target = prev.find((it) => it.id === id)
      if (target) URL.revokeObjectURL(target.url)
      return prev.filter((it) => it.id !== id)
    })
  }

  const clearBatch = () => {
    batchBitmapsRef.current.forEach((bmp) => bmp.close())
    batchBitmapsRef.current.clear()
    batchItems.forEach((it) => URL.revokeObjectURL(it.url))
    setBatchItems([])
  }

  /** 智能接收文件：在裁剪模式拖入多张时自动切换到批量缩放 */
  const handleDropFiles = useCallback(
    async (files: File[]) => {
      if (workMode === 'crop') {
        if (files.length > 1) {
          setWorkMode('batch')
          toast.info(`已识别 ${files.length} 张图片，自动切换为「批量缩放」模式`)
          await addBatchFiles(files)
        } else if (files[0]) {
          await loadSingleFile(files[0])
        }
      } else {
        await addBatchFiles(files)
      }
    },
    [workMode, addBatchFiles, loadSingleFile],
  )

  const batchDoneCount = batchItems.filter((it) => it.status === 'done').length

  const downloadBatchZip = async () => {
    if (batchDoneCount === 0) return
    if (batchItems.length === 1 && batchItems[0].outBlob && batchItems[0].outMime) {
      const it = batchItems[0]
      downloadBlob(it.outBlob!, batchOutputName(it.file.name, it.outMime!))
      toast.success('导出成功')
      return
    }
    setZipping(true)
    try {
      const blob = await packResizedZip(batchItems)
      downloadBlob(blob, timestampName('轻匣-批量缩放', 'zip'))
      toast.success(`已打包 ${batchDoneCount} 张图片 · ${formatBytes(blob.size)}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ZIP 打包失败')
    } finally {
      setZipping(false)
    }
  }

  // 模式切换条（顶部共用）
  const modeBar = (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <div className="w-64">
        <Segmented<WorkMode>
          value={workMode}
          onChange={setWorkMode}
          options={[
            { value: 'crop', label: '精细裁剪', icon: <Scissors /> },
            { value: 'batch', label: '批量缩放', icon: <Layers /> },
          ]}
        />
      </div>
      <span className="text-muted-foreground text-xs">
        {workMode === 'crop'
          ? '单图可视化精准裁剪、旋转校正、证件照与圆形头像导出'
          : '多张图片按百分比或固定像素一键批量缩放与统一旋转'}
      </span>
    </div>
  )

  // ==================== 精细裁剪模式视图 ====================
  if (workMode === 'crop') {
    if (!single) {
      return (
        <div>
          {modeBar}
          <div className="space-y-6">
            <FileDropzone
              accept={IMAGE_ACCEPT}
              multiple
              onFiles={handleDropFiles}
              title="拖放图片到这里开始裁剪（拖入多张自动进入批量缩放）"
              hint="支持 JPG / PNG / WebP / HEIC / AVIF，也可以直接 Ctrl / ⌘ + V 粘贴"
            />
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { icon: <Crop />, t: '自由与证件照比例', d: '内置 1:1、16:9 及一寸/二寸/护照标准尺寸' },
                { icon: <RotateCw />, t: '精细旋转与翻转', d: '90° 快捷旋转、±45° 水平校正、镜像翻转' },
                { icon: <Layers />, t: '支持多图批量缩放', d: '按百分比、指定宽高或最大边批量处理并打包 ZIP' },
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
        </div>
      )
    }

    const commonPresets = ASPECT_PRESETS.filter((p) => p.group === 'common')
    const idPresets = ASPECT_PRESETS.filter((p) => p.group === 'idphoto')

    const cropPanel = (
      <>
        {/* 常用裁剪比例 */}
        <Field label="裁剪比例">
          <div className="grid grid-cols-4 gap-1.5">
            {commonPresets.map((p) => {
              const active = presetId === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className={cn(
                    'flex flex-col items-center justify-center rounded-xl border py-2 text-xs font-medium transition-all active:scale-95',
                    active
                      ? 'border-primary bg-primary/10 text-primary font-semibold'
                      : 'bg-card-solid/50 text-foreground/80 hover:bg-foreground/[0.04]',
                  )}
                >
                  <span>{p.label}</span>
                  {p.hint && <span className="text-muted-foreground text-[10px] font-normal">{p.hint}</span>}
                </button>
              )
            })}
          </div>
        </Field>

        {/* 证件照标准尺寸 */}
        <Field label="证件照尺寸" value="300 DPI">
          <div className="grid grid-cols-2 gap-1.5">
            {idPresets.map((p) => {
              const active = presetId === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className={cn(
                    'flex items-center justify-between rounded-xl border px-3 py-2 text-xs transition-all active:scale-95',
                    active
                      ? 'border-primary bg-primary/10 text-primary font-semibold'
                      : 'bg-card-solid/50 text-foreground/80 hover:bg-foreground/[0.04]',
                  )}
                >
                  <span>{p.label}</span>
                  <span className="text-muted-foreground font-mono text-[10px]">
                    {p.outputSize?.width}×{p.outputSize?.height}
                  </span>
                </button>
              )
            })}
          </div>
        </Field>

        {/* 圆形头像裁切 */}
        <div className="flex items-center justify-between border-t pt-4">
          <div className="flex items-center gap-2">
            <Circle className="text-muted-foreground size-4" />
            <div>
              <div className="text-foreground/80 text-sm font-medium">圆形头像裁切</div>
              <div className="text-muted-foreground text-xs">导出圆形透明背景（PNG / WebP）</div>
            </div>
          </div>
          <Switch
            checked={circleMask}
            onChange={(v) => {
              setCircleMask(v)
              if (v) {
                applyPreset(ASPECT_PRESETS.find((p) => p.id === '1:1')!)
                if (exportFormat === 'jpeg') setExportFormat('png')
              }
            }}
            label="圆形头像裁切"
          />
        </div>

        {/* 旋转与翻转 */}
        <div className="space-y-4 border-t pt-4">
          <Field
            label="旋转与翻转"
            value={
              <button type="button" onClick={resetSingleTransform} className="text-primary hover:underline">
                全部重置
              </button>
            }
          >
            <div className="grid grid-cols-4 gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateTransform({ baseRotate: (transform.baseRotate + 270) % 360 })}
                title="逆时针旋转 90°"
              >
                <RotateCcw />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateTransform({ baseRotate: (transform.baseRotate + 90) % 360 })}
                title="顺时针旋转 90°"
              >
                <RotateCw />
              </Button>
              <Button
                variant={transform.flipX ? 'primary' : 'outline'}
                size="sm"
                onClick={() => updateTransform({ flipX: !transform.flipX })}
                title="水平翻转"
              >
                <FlipHorizontal2 />
              </Button>
              <Button
                variant={transform.flipY ? 'primary' : 'outline'}
                size="sm"
                onClick={() => updateTransform({ flipY: !transform.flipY })}
                title="垂直翻转"
              >
                <FlipVertical2 />
              </Button>
            </div>
          </Field>

          <Field
            label="角度微调"
            value={
              <span className="flex items-center gap-2">
                <span>{transform.fineRotate > 0 ? `+${transform.fineRotate}°` : `${transform.fineRotate}°`}</span>
                {transform.fineRotate !== 0 && (
                  <button
                    type="button"
                    onClick={() => updateTransform({ fineRotate: 0 })}
                    className="text-primary hover:underline"
                  >
                    归零
                  </button>
                )}
              </span>
            }
          >
            <Slider
              value={transform.fineRotate}
              min={-45}
              max={45}
              step={1}
              onChange={(v) => updateTransform({ fineRotate: v })}
            />
          </Field>
        </div>

        {/* 输出尺寸设置 */}
        <div className="space-y-4 border-t pt-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-foreground/80 text-sm font-medium">自定义输出像素</div>
              <div className="text-muted-foreground text-xs">关闭时按选区原始分辨率导出</div>
            </div>
            <Switch
              checked={customOutput}
              onChange={(v) => {
                setCustomOutput(v)
                if (v && (outW <= 0 || outH <= 0)) {
                  setOutW(cropPxW)
                  setOutH(cropPxH)
                }
              }}
              label="自定义输出像素"
            />
          </div>

          {customOutput && (
            <div className="flex items-center gap-2">
              <label className="flex-1 space-y-1">
                <span className="text-muted-foreground text-[11px]">宽 (px)</span>
                <input
                  type="number"
                  min={1}
                  max={16384}
                  value={outW}
                  onChange={(e) => handleCustomW(Number(e.target.value))}
                  className="bg-card-solid focus:ring-ring/50 h-9 w-full rounded-xl border px-3 font-mono text-sm outline-none focus:ring-2"
                />
              </label>
              <button
                type="button"
                onClick={() => setLockOutRatio((v) => !v)}
                title={lockOutRatio ? '已锁定宽高比' : '自由宽高'}
                className={cn(
                  'mt-5 flex size-9 shrink-0 items-center justify-center rounded-xl border transition-colors',
                  lockOutRatio ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground',
                )}
              >
                {lockOutRatio ? <Link2 className="size-4" /> : <Link2Off className="size-4" />}
              </button>
              <label className="flex-1 space-y-1">
                <span className="text-muted-foreground text-[11px]">高 (px)</span>
                <input
                  type="number"
                  min={1}
                  max={16384}
                  value={outH}
                  onChange={(e) => handleCustomH(Number(e.target.value))}
                  className="bg-card-solid focus:ring-ring/50 h-9 w-full rounded-xl border px-3 font-mono text-sm outline-none focus:ring-2"
                />
              </label>
            </div>
          )}
        </div>

        {/* 导出格式与质量 */}
        <div className="space-y-4 border-t pt-4">
          <Field label="导出格式">
            <Segmented<ExportFormat>
              size="sm"
              value={exportFormat}
              onChange={setExportFormat}
              options={[
                { value: 'png', label: 'PNG' },
                { value: 'jpeg', label: 'JPG' },
                { value: 'webp', label: 'WebP' },
              ]}
            />
          </Field>
          {exportFormat !== 'png' && (
            <Field label="导出质量" value={`${exportQuality}%`}>
              <Slider value={exportQuality} min={40} max={100} onChange={setExportQuality} />
            </Field>
          )}
          {exportFormat === 'jpeg' && (
            <Field label="透明区域底色" value={jpegBg}>
              <ColorPicker
                value={jpegBg}
                onChange={setJpegBg}
                presets={['#ffffff', '#000000', '#2563eb', '#dc2626', '#f5f5f4']}
              />
            </Field>
          )}
        </div>
      </>
    )

    const cropActions = (
      <>
        <Button
          variant="outline"
          size="lg"
          onClick={() => onExportSingle('copy')}
          disabled={exporting}
          className="max-lg:!flex-none max-lg:px-4"
        >
          <Copy />
          <span className="max-sm:hidden">复制</span>
        </Button>
        <Button variant="primary" size="lg" onClick={() => onExportSingle('download')} disabled={exporting}>
          {exporting ? <Loader2 className="animate-spin" /> : <Download />}
          {exporting ? '处理中…' : '导出图片'}
        </Button>
      </>
    )

    return (
      <div>
        {modeBar}
        <ToolShell panel={cropPanel} actions={cropActions} panelTitle="裁剪与输出">
          <div className="space-y-3">
            {/* 画布顶栏信息 */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="max-w-[200px] truncate font-medium sm:max-w-xs">{single.name}</span>
              <span className="glass rounded-full px-2.5 py-1 font-mono tabular-nums">
                输出 {finalOutW} × {finalOutH} px
              </span>
              <span className="text-muted-foreground hidden sm:inline">
                原图 {single.width}×{single.height}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCrop({ x: 0, y: 0, w: 1, h: 1 })}
                >
                  <Maximize2 />
                  全选
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
                      const f = e.target.files?.[0]
                      if (f) void loadSingleFile(f)
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>
            </div>

            <CropCanvas
              bitmap={single.bitmap}
              transform={transform}
              crop={crop}
              onCropChange={setCrop}
              aspectRatio={activePreset.ratio}
              circleMask={circleMask}
            />

            <p className="text-muted-foreground text-center text-xs">
              拖动边框或四角调整选区，拖动选区内部平移，点击选区外可重新框选，选中后支持键盘方向键微调
            </p>
          </div>
        </ToolShell>
      </div>
    )
  }

  // ==================== 批量缩放模式视图 ====================
  if (!batchItems.length) {
    return (
      <div>
        {modeBar}
        <FileDropzone
          accept={IMAGE_ACCEPT}
          multiple
          onFiles={addBatchFiles}
          title="拖放多张图片到这里，一键批量缩放"
          hint="支持按百分比、固定宽/高、指定尺寸（含居中裁切）批量处理，并打包为 ZIP"
        />
      </div>
    )
  }

  const batchPanel = (
    <>
      <Field label="缩放方式">
        <div className="grid grid-cols-2 gap-1.5">
          {(
            [
              { id: 'percent', label: '按百分比' },
              { id: 'width', label: '按固定宽度' },
              { id: 'height', label: '按固定高度' },
              { id: 'max', label: '限制最大边' },
              { id: 'exact', label: '指定宽高' },
            ] as { id: BatchResizeMode; label: string }[]
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setBatch('mode', m.id)}
              className={cn(
                'rounded-xl border px-3 py-2 text-xs font-medium transition-all',
                m.id === 'exact' && 'col-span-2',
                batchOpts.mode === m.id
                  ? 'border-primary bg-primary/10 text-primary font-semibold'
                  : 'bg-card-solid/50 text-foreground/80 hover:bg-foreground/[0.04]',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </Field>

      {batchOpts.mode === 'percent' && (
        <Field label="缩放比例" value={`${batchOpts.percent}%`}>
          <Slider value={batchOpts.percent} min={10} max={200} step={5} onChange={(v) => setBatch('percent', v)} />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {PERCENT_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setBatch('percent', p)}
                className={cn(
                  'rounded-lg border px-2 py-1 font-mono text-[11px] transition-colors',
                  batchOpts.percent === p
                    ? 'border-primary bg-primary/10 text-primary font-semibold'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {p}%
              </button>
            ))}
          </div>
        </Field>
      )}

      {batchOpts.mode === 'width' && (
        <Field label="目标宽度 (px)" value={`${batchOpts.width}px（高度等比）`}>
          <input
            type="number"
            min={16}
            max={8192}
            value={batchOpts.width}
            onChange={(e) => setBatch('width', Math.max(16, Number(e.target.value) || 16))}
            className="bg-card-solid focus:ring-ring/50 h-9 w-full rounded-xl border px-3 font-mono text-sm outline-none focus:ring-2"
          />
        </Field>
      )}

      {batchOpts.mode === 'height' && (
        <Field label="目标高度 (px)" value={`${batchOpts.height}px（宽度等比）`}>
          <input
            type="number"
            min={16}
            max={8192}
            value={batchOpts.height}
            onChange={(e) => setBatch('height', Math.max(16, Number(e.target.value) || 16))}
            className="bg-card-solid focus:ring-ring/50 h-9 w-full rounded-xl border px-3 font-mono text-sm outline-none focus:ring-2"
          />
        </Field>
      )}

      {batchOpts.mode === 'max' && (
        <Field label="最大边长" value={`${batchOpts.maxDimension} px`}>
          <Slider
            value={batchOpts.maxDimension}
            min={320}
            max={4096}
            step={64}
            onChange={(v) => setBatch('maxDimension', v)}
          />
        </Field>
      )}

      {batchOpts.mode === 'exact' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-muted-foreground text-xs">宽 (px)</span>
              <input
                type="number"
                min={16}
                max={8192}
                value={batchOpts.width}
                onChange={(e) => setBatch('width', Math.max(16, Number(e.target.value) || 16))}
                className="bg-card-solid focus:ring-ring/50 h-9 w-full rounded-xl border px-3 font-mono text-sm outline-none focus:ring-2"
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-xs">高 (px)</span>
              <input
                type="number"
                min={16}
                max={8192}
                value={batchOpts.height}
                onChange={(e) => setBatch('height', Math.max(16, Number(e.target.value) || 16))}
                className="bg-card-solid focus:ring-ring/50 h-9 w-full rounded-xl border px-3 font-mono text-sm outline-none focus:ring-2"
              />
            </label>
          </div>
          <Field label="填充适配">
            <Segmented<BatchFit>
              size="sm"
              value={batchOpts.fit}
              onChange={(v) => setBatch('fit', v)}
              options={[
                { value: 'cover', label: '居中裁切' },
                { value: 'contain', label: '完整留白' },
                { value: 'fill', label: '拉伸填满' },
              ]}
            />
          </Field>
        </div>
      )}

      {/* 批量统一旋转翻转 */}
      <div className="border-t pt-4">
        <Field label="统一旋转 / 翻转" value={batchOpts.rotate ? `${batchOpts.rotate}°` : undefined}>
          <div className="grid grid-cols-4 gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBatch('rotate', (batchOpts.rotate + 270) % 360)}
              title="左转 90°"
            >
              <RotateCcw />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBatch('rotate', (batchOpts.rotate + 90) % 360)}
              title="右转 90°"
            >
              <RotateCw />
            </Button>
            <Button
              variant={batchOpts.flipX ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setBatch('flipX', !batchOpts.flipX)}
              title="水平翻转"
            >
              <FlipHorizontal2 />
            </Button>
            <Button
              variant={batchOpts.flipY ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setBatch('flipY', !batchOpts.flipY)}
              title="垂直翻转"
            >
              <FlipVertical2 />
            </Button>
          </div>
        </Field>
      </div>

      {/* 输出格式 */}
      <div className="space-y-4 border-t pt-4">
        <Field label="输出格式">
          <Segmented<'original' | ExportFormat>
            size="sm"
            value={batchOpts.format}
            onChange={(v) => setBatch('format', v)}
            options={[
              { value: 'original', label: '原格式' },
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPG' },
              { value: 'webp', label: 'WebP' },
            ]}
          />
        </Field>
        {batchOpts.format !== 'png' && (
          <Field label="输出质量" value={`${batchOpts.quality}%`}>
            <Slider value={batchOpts.quality} min={40} max={100} onChange={(v) => setBatch('quality', v)} />
          </Field>
        )}
        {(batchOpts.format === 'jpeg' || (batchOpts.mode === 'exact' && batchOpts.fit === 'contain')) && (
          <Field label="留白 / 底色" value={batchOpts.background === 'transparent' ? '透明' : batchOpts.background}>
            <ColorPicker value={batchOpts.background} onChange={(v) => setBatch('background', v)} />
          </Field>
        )}
      </div>
    </>
  )

  const batchActions = (
    <Button variant="primary" size="lg" onClick={downloadBatchZip} disabled={batchDoneCount === 0 || zipping}>
      {zipping ? <Loader2 className="animate-spin" /> : batchItems.length === 1 ? <Download /> : <Archive />}
      {zipping
        ? '正在打包…'
        : batchItems.length === 1
          ? '下载图片'
          : `打包 ZIP 下载（${batchDoneCount}/${batchItems.length}）`}
    </Button>
  )

  return (
    <div>
      {modeBar}
      <ToolShell panel={batchPanel} actions={batchActions} panelTitle="批量缩放设置">
        <div className="space-y-4">
          <div className="glass shadow-soft flex items-center gap-3 rounded-2xl px-4 py-3.5 sm:px-5">
            <span className="bg-primary/12 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
              <Layers className="size-5" />
            </span>
            <div className="text-sm font-medium">
              共 {batchItems.length} 张图片，已完成 {batchDoneCount} 张
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearBatch}
              className="text-muted-foreground ml-auto hover:text-red-500"
            >
              <Trash2 />
              清空
            </Button>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <AnimatePresence initial={false}>
              {batchItems.map((it) => (
                <motion.div
                  key={it.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  className="bg-card flex items-center gap-3 rounded-2xl border p-2.5 backdrop-blur-xl"
                >
                  <div className="checkerboard size-12 shrink-0 overflow-hidden rounded-xl border">
                    <img src={it.url} alt="" className="size-full object-cover" draggable={false} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{it.file.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      {it.status === 'processing' ? (
                        <span className="text-primary flex items-center gap-1">
                          <Loader2 className="size-3 animate-spin" />
                          处理中…
                        </span>
                      ) : it.status === 'error' ? (
                        <span className="flex items-center gap-1 text-red-500">
                          <FileWarning className="size-3" />
                          {it.error}
                        </span>
                      ) : (
                        <>
                          <span className="text-muted-foreground font-mono tabular-nums">
                            {it.width}×{it.height}
                          </span>
                          <ArrowRight className="text-muted-foreground size-3" />
                          <span className="text-primary font-mono font-semibold tabular-nums">
                            {it.outWidth}×{it.outHeight}
                          </span>
                          {it.outBlob && (
                            <span className="text-muted-foreground font-mono text-[11px]">
                              · {formatBytes(it.outBlob.size)}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="进入精细裁剪"
                      onClick={async () => {
                        await loadSingleFile(it.file)
                        setWorkMode('crop')
                      }}
                      className="text-muted-foreground hover:text-primary hover:bg-primary/10 flex size-8 items-center justify-center rounded-lg transition-colors"
                    >
                      <Scissors className="size-4" />
                    </button>
                    <button
                      type="button"
                      disabled={!it.outBlob || !it.outMime}
                      onClick={() => {
                        if (it.outBlob && it.outMime) {
                          downloadBlob(it.outBlob, batchOutputName(it.file.name, it.outMime))
                        }
                      }}
                      aria-label="下载此图片"
                      className="text-muted-foreground hover:text-primary hover:bg-primary/10 flex size-8 items-center justify-center rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-35"
                    >
                      <Download className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeBatchItem(it.id)}
                      aria-label="移除"
                      className="text-muted-foreground flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-red-500/10 hover:text-red-500"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <FileDropzone compact accept={IMAGE_ACCEPT} onFiles={addBatchFiles} title="继续添加图片进行批量缩放" />
        </div>
      </ToolShell>
    </div>
  )
}
