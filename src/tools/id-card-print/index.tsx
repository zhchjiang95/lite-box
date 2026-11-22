import {
  AlertTriangle,
  ArrowLeftRight,
  Crop,
  Download,
  FileDown,
  Image as ImageIcon,
  Loader2,
  Printer,
  RefreshCw,
  RotateCw,
  Scan,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { Button } from '@/components/ui/button'
import { ColorPicker, Field, Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { Slider } from '@/components/ui/slider'
import { downloadBlob, timestampName } from '@/lib/file'
import { IMAGE_ACCEPT, decodeImageFile, isImageLike } from '@/lib/image'
import { cn } from '@/lib/utils'
import { CropEditorModal } from './CropEditorModal'
import {
  computeA4Layout,
  createDefaultCardEdit,
  exportIdCardImage,
  exportIdCardPdf,
  printIdCardA4,
  renderA4SheetToCanvas,
  renderProcessedCard,
  type A4LayoutPlan,
} from './engine'
import {
  DOC_PRESETS,
  LAYOUT_OPTIONS,
  WATERMARK_PRESETS,
  defaultPrintOptions,
  getActiveDocSpec,
  type CardEditState,
  type CardSide,
  type CardSource,
  type DocPresetId,
  type FilterMode,
  type PrintOptions,
  type WatermarkScope,
} from './types'

type PanelTab = 'layout' | 'filter' | 'watermark'

/** 单面证件缩略预览组件（实时展示裁切拉直与滤镜后的效果） */
function CardThumbPreview({
  source,
  opts,
  aspect,
}: {
  source: CardSource
  opts: PrintOptions
  aspect: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const raf = requestAnimationFrame(() => {
      const w = 320
      const h = Math.max(100, Math.round(w / aspect))
      const rendered = renderProcessedCard(source, opts, w, h, { maxSourceSide: 800 })
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(rendered, 0, 0)
      rendered.width = 0
      rendered.height = 0
    })
    return () => cancelAnimationFrame(raf)
  }, [source, opts, aspect])

  return (
    <canvas
      ref={ref}
      className="max-h-28 w-full rounded-lg object-contain shadow-sm"
      style={{ aspectRatio: String(aspect) }}
    />
  )
}

export default function IdCardPrint() {
  const [front, setFront] = useState<CardSource | null>(null)
  const [back, setBack] = useState<CardSource | null>(null)
  const [opts, setOpts] = useState<PrintOptions>(defaultPrintOptions)
  const [tab, setTab] = useState<PanelTab>('layout')

  const [editingSide, setEditingSide] = useState<CardSide | null>(null)
  const [loadingSide, setLoadingSide] = useState<CardSide | null>(null)
  const [busyAction, setBusyAction] = useState<'pdf' | 'print' | 'png' | null>(null)
  const [dragOverSide, setDragOverSide] = useState<CardSide | null>(null)

  const a4CanvasRef = useRef<HTMLCanvasElement>(null)
  const frontInputRef = useRef<HTMLInputElement>(null)
  const backInputRef = useRef<HTMLInputElement>(null)
  const layoutPlanRef = useRef<A4LayoutPlan | null>(null)

  const frontRef = useRef(front)
  const backRef = useRef(back)
  frontRef.current = front
  backRef.current = back

  const docSpec = useMemo(() => getActiveDocSpec(opts), [opts])
  const targetAspect = docSpec.widthMm / docSpec.heightMm
  const layoutPlan = useMemo(() => computeA4Layout(opts), [opts])
  layoutPlanRef.current = layoutPlan

  const hasAnyCard = Boolean(front || back)

  const set = <K extends keyof PrintOptions>(key: K, value: PrintOptions[K]) =>
    setOpts((prev) => ({ ...prev, [key]: value }))

  /** 释放单个 CardSource 占用的显存与对象 URL */
  const disposeCard = (card: CardSource | null) => {
    if (!card) return
    card.bitmap.close()
    URL.revokeObjectURL(card.previewUrl)
  }

  // 组件卸载时彻底回收图片资源
  useEffect(
    () => () => {
      disposeCard(frontRef.current)
      disposeCard(backRef.current)
    },
    [],
  )

  /** 解码并载入单面或双面证件图（一次选两张时自动填入正面与反面） */
  const loadFilesForSide = useCallback(
    async (side: CardSide, fileList: File[]) => {
      const images = fileList.filter(isImageLike)
      if (!images.length) {
        toast.error('请选择图片文件（支持 JPG / PNG / WebP / HEIC）')
        return
      }

      const loadOne = async (targetSide: CardSide, file: File) => {
        setLoadingSide(targetSide)
        try {
          const decoded = await decodeImageFile(file)
          const card: CardSource = {
            fileName: file.name,
            bitmap: decoded.bitmap,
            width: decoded.width,
            height: decoded.height,
            previewUrl: decoded.previewUrl,
            edit: createDefaultCardEdit(decoded.width, decoded.height, targetAspect, 0),
          }
          if (targetSide === 'front') {
            disposeCard(frontRef.current)
            setFront(card)
          } else {
            disposeCard(backRef.current)
            setBack(card)
          }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : `读取「${file.name}」失败`)
        } finally {
          setLoadingSide(null)
        }
      }

      if (images.length >= 2) {
        await loadOne('front', images[0])
        await loadOne('back', images[1])
        toast.success('已自动载入正面与反面，可点击「裁切 / 拉直」精细调整')
      } else {
        await loadOne(side, images[0])
      }
    },
    [targetAspect],
  )

  // 全局粘贴图片快捷载入（自动填入第一个空槽位）
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (editingSide) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const files = Array.from(e.clipboardData?.files ?? []).filter(isImageLike)
      if (!files.length) return
      e.preventDefault()
      const targetSide: CardSide = !frontRef.current ? 'front' : !backRef.current ? 'back' : 'front'
      void loadFilesForSide(targetSide, files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [editingSide, loadFilesForSide])

  // 切换证件预设导致宽高比变化时，自动适配常规裁剪框比例
  const handleChangeDocPreset = (presetId: DocPresetId) => {
    const nextOpts: PrintOptions = { ...opts, docPreset: presetId }
    setOpts(nextOpts)
    const nextSpec = getActiveDocSpec(nextOpts)
    const nextAspect = nextSpec.widthMm / nextSpec.heightMm
    setFront((prev) =>
      prev
        ? {
            ...prev,
            edit:
              prev.edit.mode === 'rect'
                ? createDefaultCardEdit(prev.width, prev.height, nextAspect, prev.edit.rotation90)
                : prev.edit,
          }
        : prev,
    )
    setBack((prev) =>
      prev
        ? {
            ...prev,
            edit:
              prev.edit.mode === 'rect'
                ? createDefaultCardEdit(prev.width, prev.height, nextAspect, prev.edit.rotation90)
                : prev.edit,
          }
        : prev,
    )
  }

  /** 快速顺时针旋转 90° */
  const quickRotate = (side: CardSide) => {
    const updater = (prev: CardSource | null): CardSource | null => {
      if (!prev) return null
      const nextRot = ((prev.edit.rotation90 + 90) % 360) as 0 | 90 | 180 | 270
      const reset = createDefaultCardEdit(prev.width, prev.height, targetAspect, nextRot)
      return { ...prev, edit: { ...reset, mode: prev.edit.mode } }
    }
    if (side === 'front') setFront(updater)
    else setBack(updater)
  }

  /** 互换正反面 */
  const swapSides = () => {
    const f = frontRef.current
    const b = backRef.current
    setFront(b)
    setBack(f)
    toast.success('已互换正反面位置')
  }

  /** 删除单面 */
  const removeSide = (side: CardSide) => {
    if (side === 'front') {
      disposeCard(frontRef.current)
      setFront(null)
    } else {
      disposeCard(backRef.current)
      setBack(null)
    }
  }

  /** 隐私一键清空全部证件 */
  const clearAll = () => {
    disposeCard(frontRef.current)
    disposeCard(backRef.current)
    setFront(null)
    setBack(null)
    toast.success('已彻底清空本地内存中的证件图片')
  }

  /** 一键还原 1:1 国标黄金排版 */
  const resetStandardLayout = () => {
    setOpts((prev) => ({
      ...prev,
      layout: 'vertical-center',
      scalePercent: 100,
      gapMm: 18,
      roundCorners: true,
      cardBorder: true,
    }))
    toast.success('已恢复 1:1 标准 A4 居中排版')
  }

  /** 应用裁切/透视编辑结果 */
  const applyCropEdit = (nextEdit: CardEditState) => {
    if (!editingSide) return
    if (editingSide === 'front') {
      setFront((prev) => (prev ? { ...prev, edit: nextEdit } : prev))
    } else {
      setBack((prev) => (prev ? { ...prev, edit: nextEdit } : prev))
    }
    setEditingSide(null)
  }

  // 实时渲染 A4 预览画布（rAF 合帧避免滑块卡顿）
  useEffect(() => {
    const canvas = a4CanvasRef.current
    if (!canvas) return
    const raf = requestAnimationFrame(() => {
      // 预览按约 120 DPI（4.72 px/mm）渲染，清晰且耗时 < 25ms
      renderA4SheetToCanvas(canvas, { front, back }, opts, 4.6, {
        isPreview: true,
        maxSourceSide: 1200,
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [front, back, opts])

  /** 点击 A4 预览中的证件槽位：已上传直接打开裁切拉直，未上传触发文件选择 */
  const handlePreviewCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = a4CanvasRef.current
    const plan = layoutPlanRef.current
    if (!canvas || !plan) return
    const rect = canvas.getBoundingClientRect()
    const xMm = ((e.clientX - rect.left) / rect.width) * plan.pageWmm
    const yMm = ((e.clientY - rect.top) / rect.height) * plan.pageHmm

    const hit = plan.slots.find(
      (s) => xMm >= s.xMm && xMm <= s.xMm + s.wMm && yMm >= s.yMm && yMm <= s.yMm + s.hMm,
    )
    if (!hit) return

    if (hit.side === 'front') {
      if (front) setEditingSide('front')
      else frontInputRef.current?.click()
    } else {
      if (back) setEditingSide('back')
      else backInputRef.current?.click()
    }
  }

  /** 导出 1:1 标准 A4 PDF */
  const handleExportPdf = async () => {
    if (!hasAnyCard) {
      toast.error('请先上传证件正面或反面图片')
      return
    }
    setBusyAction('pdf')
    try {
      const blob = await exportIdCardPdf({ front, back }, opts)
      downloadBlob(blob, timestampName(`${docSpec.shortLabel}-A4打印`, 'pdf'))
      toast.success('已导出 1:1 真实物理尺寸 A4 PDF，打印时请选择「实际大小 / 100%」')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'PDF 生成失败')
    } finally {
      setBusyAction(null)
    }
  }

  /** 直接调用浏览器打印 */
  const handleDirectPrint = async () => {
    if (!hasAnyCard) {
      toast.error('请先上传证件正面或反面图片')
      return
    }
    setBusyAction('print')
    try {
      await printIdCardA4({ front, back }, opts)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打印调用失败，建议先导出 PDF')
    } finally {
      setBusyAction(null)
    }
  }

  /** 导出 300 DPI 高清 A4 PNG 图片 */
  const handleExportPng = async () => {
    if (!hasAnyCard) {
      toast.error('请先上传证件正面或反面图片')
      return
    }
    setBusyAction('png')
    try {
      const blob = await exportIdCardImage({ front, back }, opts, 'png')
      downloadBlob(blob, timestampName(`${docSpec.shortLabel}-A4-300DPI`, 'png'))
      toast.success('已导出 300 DPI 高清 A4 图片')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '图片导出失败')
    } finally {
      setBusyAction(null)
    }
  }

  /** 渲染单个上传/管理卡片（正面或反面） */
  const renderSideCard = (side: CardSide) => {
    const source = side === 'front' ? front : back
    const label = side === 'front' ? docSpec.frontLabel : docSpec.backLabel
    const inputRef = side === 'front' ? frontInputRef : backInputRef
    const isLoading = loadingSide === side
    const isDragOver = dragOverSide === side

    return (
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOverSide(side)
        }}
        onDragLeave={() => setDragOverSide((cur) => (cur === side ? null : cur))}
        onDrop={(e) => {
          e.preventDefault()
          setDragOverSide(null)
          void loadFilesForSide(side, Array.from(e.dataTransfer.files))
        }}
        className={cn(
          'glass relative flex flex-col justify-between rounded-2xl p-3.5 transition-all',
          isDragOver && 'border-primary bg-primary/5 ring-primary/30 ring-2',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            const list = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (list.length) void loadFilesForSide(side, list)
          }}
        />

        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex size-5 items-center justify-center rounded-md text-[11px] font-bold text-white',
                side === 'front' ? 'bg-primary' : 'bg-slate-600 dark:bg-slate-500',
              )}
            >
              {side === 'front' ? '正' : '反'}
            </span>
            <span className="text-sm font-semibold">{label}</span>
          </div>
          {source && (
            <span className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-[11px]">
              {source.edit.mode === 'perspective' ? '已四点拉直' : '比例裁剪'}
            </span>
          )}
        </div>

        {source ? (
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => setEditingSide(side)}
              className="group bg-muted/40 relative flex w-full items-center justify-center overflow-hidden rounded-xl border p-2 transition hover:border-primary/50"
              title="点击进入裁切与四点透视拉直"
            >
              <CardThumbPreview source={source} opts={opts} aspect={targetAspect} />
              <span className="bg-background/90 text-foreground pointer-events-none absolute right-2 bottom-2 flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium opacity-90 shadow-sm transition group-hover:opacity-100">
                <Scan className="text-primary size-3" />
                裁切 / 拉直
              </span>
            </button>

            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="primary" size="sm" className="h-7 flex-1 text-xs" onClick={() => setEditingSide(side)}>
                <Crop className="size-3.5" />
                裁切 / 四点拉直
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                title="顺时针旋转 90°"
                onClick={() => quickRotate(side)}
              >
                <RotateCw className="size-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                title="更换图片"
                onClick={() => inputRef.current?.click()}
              >
                <Upload className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive h-7 px-2 text-xs"
                title="移除"
                onClick={() => removeSide(side)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="border-foreground/15 hover:border-primary/60 hover:bg-primary/[0.03] flex min-h-[124px] w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-center transition"
          >
            {isLoading ? (
              <Loader2 className="text-primary size-6 animate-spin" />
            ) : (
              <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-xl">
                <Upload className="size-5" />
              </div>
            )}
            <div className="text-xs font-medium">点击上传或拖入{label}</div>
            <div className="text-muted-foreground text-[11px]">
              支持 iPhone HEIC / JPG / PNG · 可一次拖入两张
            </div>
          </button>
        )}
      </div>
    )
  }

  /** 左侧参数面板 */
  const panel = (
    <div className="space-y-5">
      <Segmented
        value={tab}
        onChange={setTab}
        size="sm"
        options={[
          { value: 'layout', label: '尺寸与排版' },
          { value: 'filter', label: '复印滤镜' },
          { value: 'watermark', label: '防盗水印' },
        ]}
      />

      {tab === 'layout' && (
        <div className="space-y-5">
          {/* 证件物理尺寸预设 */}
          <Field label="证件类型" value={`${docSpec.widthMm} × ${docSpec.heightMm} mm`}>
            <div className="grid grid-cols-2 gap-1.5">
              {DOC_PRESETS.map((p) => {
                const active = opts.docPreset === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleChangeDocPreset(p.id)}
                    className={cn(
                      'rounded-xl border px-2.5 py-2 text-left transition',
                      active
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-foreground/10 hover:border-foreground/25 text-muted-foreground',
                      p.id === 'id-card' && 'col-span-2',
                    )}
                  >
                    <div className="text-xs font-semibold">{p.label}</div>
                    <div className="text-[11px] opacity-75">{p.desc}</div>
                  </button>
                )
              })}
            </div>
          </Field>

          {opts.docPreset === 'custom' && (
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="宽度 (mm)">
                <input
                  type="number"
                  min={20}
                  max={200}
                  step={0.5}
                  value={opts.customWidthMm}
                  onChange={(e) => set('customWidthMm', Number(e.target.value) || 85.6)}
                  className="bg-background focus:border-primary w-full rounded-lg border px-2.5 py-1.5 font-mono text-xs outline-none"
                />
              </Field>
              <Field label="高度 (mm)">
                <input
                  type="number"
                  min={20}
                  max={200}
                  step={0.5}
                  value={opts.customHeightMm}
                  onChange={(e) => set('customHeightMm', Number(e.target.value) || 54)}
                  className="bg-background focus:border-primary w-full rounded-lg border px-2.5 py-1.5 font-mono text-xs outline-none"
                />
              </Field>
            </div>
          )}

          {/* 一键排版方案 */}
          <Field label="一键 A4 排版">
            <div className="grid grid-cols-2 gap-1.5">
              {LAYOUT_OPTIONS.map((item) => {
                const active = opts.layout === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => set('layout', item.id)}
                    className={cn(
                      'rounded-xl border px-2.5 py-2 text-left transition',
                      active
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-foreground/10 hover:border-foreground/25 text-muted-foreground',
                    )}
                  >
                    <div className="text-xs font-semibold">{item.label}</div>
                    <div className="mt-0.5 text-[10px] leading-snug opacity-75">{item.desc}</div>
                  </button>
                )
              })}
            </div>
          </Field>

          {/* 1:1 尺寸比例 */}
          <Field
            label="证件缩放比例"
            value={opts.scalePercent === 100 ? '100%（1:1 原大）' : `${opts.scalePercent}%`}
          >
            <div className="mb-2 flex gap-1.5">
              {[100, 110, 120].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => set('scalePercent', pct)}
                  className={cn(
                    'flex-1 rounded-lg border py-1 text-xs font-medium transition',
                    opts.scalePercent === pct
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-foreground/10 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {pct === 100 ? '1:1 原大' : `${pct}%`}
                </button>
              ))}
            </div>
            <Slider
              value={opts.scalePercent}
              min={80}
              max={140}
              step={2}
              onChange={(v) => set('scalePercent', v)}
            />
          </Field>

          <Field label="正反面间距" value={`${opts.gapMm} mm`}>
            <Slider value={opts.gapMm} min={4} max={45} step={1} onChange={(v) => set('gapMm', v)} />
          </Field>

          {/* 细节开关 */}
          <div className="space-y-3 border-t pt-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-medium">自动国标圆角裁切</div>
                <div className="text-muted-foreground text-[11px]">切除身份证四角外的桌面白边</div>
              </div>
              <Switch checked={opts.roundCorners} onChange={(v) => set('roundCorners', v)} label="国标圆角" />
            </div>

            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-medium">淡灰证件轮廓线</div>
                <div className="text-muted-foreground text-[11px]">白底证件打印后边缘更清晰</div>
              </div>
              <Switch checked={opts.cardBorder} onChange={(v) => set('cardBorder', v)} label="淡灰轮廓线" />
            </div>

            {opts.layout === 'double-set' && (
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium">中间裁剪虚线</div>
                  <div className="text-muted-foreground text-[11px]">方便将一页双份沿中线裁开</div>
                </div>
                <Switch checked={opts.cutGuides} onChange={(v) => set('cutGuides', v)} label="裁剪虚线" />
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'filter' && (
        <div className="space-y-5">
          <Field label="复印件增强预设">
            <Segmented<FilterMode>
              value={opts.filter}
              onChange={(v) => set('filter', v)}
              size="sm"
              options={[
                { value: 'original', label: '原图色彩' },
                { value: 'scan', label: '扫描增白' },
                { value: 'bw', label: '黑白复印' },
              ]}
            />
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              {opts.filter === 'original' && '保留证件原始色彩，适合彩色打印或电子版提交。'}
              {opts.filter === 'scan' && '自动提亮发灰底色、增强文字清晰度，模拟实体扫描仪效果。'}
              {opts.filter === 'bw' && '模拟激光复印机高对比黑白效果，底色干净不费墨，人像清晰可辨。'}
            </p>
          </Field>

          <Field label="亮度微调" value={opts.brightness > 0 ? `+${opts.brightness}` : String(opts.brightness)}>
            <Slider
              value={opts.brightness}
              min={-30}
              max={30}
              step={1}
              onChange={(v) => set('brightness', v)}
            />
          </Field>

          <Field label="对比度微调" value={opts.contrast > 0 ? `+${opts.contrast}` : String(opts.contrast)}>
            <Slider
              value={opts.contrast}
              min={-30}
              max={40}
              step={1}
              onChange={(v) => set('contrast', v)}
            />
          </Field>

          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setOpts((prev) => ({ ...prev, filter: 'original', brightness: 0, contrast: 0 }))}
          >
            <RefreshCw className="size-3.5" />
            重置滤镜参数
          </Button>
        </div>
      )}

      {tab === 'watermark' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">启用防盗用途签注</div>
              <div className="text-muted-foreground text-xs">防止证件复印件被挪作他用</div>
            </div>
            <Switch
              checked={opts.enableWatermark}
              onChange={(v) => set('enableWatermark', v)}
              label="启用防盗水印"
            />
          </div>

          {opts.enableWatermark && (
            <div className="space-y-4 border-t pt-4">
              <div className="flex flex-wrap gap-1.5">
                {WATERMARK_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => set('watermarkText', p.text)}
                    className="border-foreground/10 hover:border-primary/50 hover:text-primary rounded-lg border px-2 py-1 text-[11px] font-medium transition"
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <Field label="签注文字">
                <textarea
                  rows={2}
                  value={opts.watermarkText}
                  onChange={(e) => set('watermarkText', e.target.value)}
                  placeholder="例如：仅供办理 XX 业务使用，他用无效"
                  className="bg-background focus:border-primary w-full resize-none rounded-xl border px-3 py-2 text-xs outline-none"
                />
              </Field>

              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">自动附加今日日期</span>
                <Switch
                  checked={opts.watermarkIncludeDate}
                  onChange={(v) => set('watermarkIncludeDate', v)}
                  label="附加今日日期"
                />
              </div>

              <Field label="覆盖范围">
                <Segmented<WatermarkScope>
                  value={opts.watermarkScope}
                  onChange={(v) => set('watermarkScope', v)}
                  size="sm"
                  options={[
                    { value: 'cards', label: '仅压在证件上' },
                    { value: 'page', label: '整页斜铺' },
                  ]}
                />
              </Field>

              <Field label="水印颜色">
                <ColorPicker
                  value={opts.watermarkColor}
                  onChange={(v) => set('watermarkColor', v)}
                  presets={['#dc2626', '#475569', '#2563eb', '#0f172a', '#d97706']}
                />
              </Field>

              <Field label="不透明度" value={`${opts.watermarkOpacity}%`}>
                <Slider
                  value={opts.watermarkOpacity}
                  min={10}
                  max={70}
                  step={2}
                  onChange={(v) => set('watermarkOpacity', v)}
                />
              </Field>

              <Field label="字号大小" value={`${opts.watermarkFontSize} pt`}>
                <Slider
                  value={opts.watermarkFontSize}
                  min={8}
                  max={24}
                  step={1}
                  onChange={(v) => set('watermarkFontSize', v)}
                />
              </Field>

              <Field label="倾斜角度" value={`${opts.watermarkAngle}°`}>
                <Slider
                  value={opts.watermarkAngle}
                  min={-60}
                  max={60}
                  step={2}
                  onChange={(v) => set('watermarkAngle', v)}
                />
              </Field>
            </div>
          )}
        </div>
      )}
    </div>
  )

  /** 底部操作栏 */
  const actions = (
    <div className="flex w-full flex-col gap-2">
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        disabled={!hasAnyCard || busyAction !== null}
        onClick={handleExportPdf}
      >
        {busyAction === 'pdf' ? <Loader2 className="animate-spin" /> : <FileDown />}
        导出 1:1 标准 A4 PDF
      </Button>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="md"
          disabled={!hasAnyCard || busyAction !== null}
          onClick={handleDirectPrint}
        >
          {busyAction === 'print' ? <Loader2 className="animate-spin" /> : <Printer />}
          直接打印
        </Button>
        <Button
          variant="outline"
          size="md"
          disabled={!hasAnyCard || busyAction !== null}
          onClick={handleExportPng}
        >
          {busyAction === 'png' ? <Loader2 className="animate-spin" /> : <ImageIcon />}
          导出高清图
        </Button>
      </div>
    </div>
  )

  return (
    <>
      <ToolShell panel={panel} actions={actions} panelTitle="A4 排版与增强设置">
        <div className="space-y-4">
          {/* 隐私安全提示栏 */}
          <div className="glass flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-2.5 text-xs">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="size-4 shrink-0" />
              <span className="font-medium">
                100% 纯本地离线处理：身份证照片仅保存在浏览器内存中，绝不上传任何服务器
              </span>
            </div>
            {hasAnyCard && (
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive h-7 px-2 text-xs" onClick={clearAll}>
                <Trash2 className="size-3.5" />
                一键清空隐私
              </Button>
            )}
          </div>

          {/* 正反面双槽上传与快速裁切区 */}
          <div className="relative grid gap-3 sm:grid-cols-2">
            {renderSideCard('front')}
            {renderSideCard('back')}

            {hasAnyCard && (
              <button
                type="button"
                onClick={swapSides}
                title="互换正反面"
                className="bg-card-solid hover:border-primary hover:text-primary absolute top-1/2 left-1/2 z-10 hidden size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-md transition sm:flex"
              >
                <ArrowLeftRight className="size-3.5" />
              </button>
            )}
          </div>

          {/* 1:1 A4 实时排版预览台 */}
          <div className="glass overflow-hidden rounded-2xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold">A4 实时预览</span>
                <span className="bg-muted text-muted-foreground rounded-md px-2 py-0.5 font-mono text-[11px]">
                  A4 {layoutPlan.orientation === 'portrait' ? '210×297' : '297×210'} mm · 证件{' '}
                  {layoutPlan.cardWmm.toFixed(1)}×{layoutPlan.cardHmm.toFixed(1)} mm
                </span>
                {opts.scalePercent === 100 && (
                  <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    1:1 真实物理原大
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {hasAnyCard && (
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={swapSides}>
                    <ArrowLeftRight className="size-3.5" />
                    <span className="sm:hidden">互换</span>
                  </Button>
                )}
                <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={resetStandardLayout}>
                  <Sparkles className="size-3.5" />
                  一键 1:1 复位
                </Button>
              </div>
            </div>

            {layoutPlan.overflowWarning && (
              <div className="flex items-center gap-2 border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-4 shrink-0" />
                当前缩放比例或间距下证件接近/超出 A4 纸边距，建议调小比例或切换「横向 A4 并排」。
              </div>
            )}

            <div className="bg-foreground/[0.03] flex flex-col items-center justify-center p-4 sm:p-7">
              <div
                className={cn(
                  'relative overflow-hidden rounded-sm bg-white shadow-[0_14px_40px_-10px_rgba(15,23,42,0.22)] ring-1 ring-black/10 transition-all',
                  layoutPlan.orientation === 'portrait' ? 'w-full max-w-[440px]' : 'w-full max-w-[600px]',
                )}
              >
                <canvas
                  ref={a4CanvasRef}
                  onClick={handlePreviewCanvasClick}
                  className="block h-auto w-full cursor-pointer"
                  title="点击画布中的证件可直接打开裁切 / 四点拉直编辑器"
                />
              </div>

              <p className="text-muted-foreground mt-3 flex items-center gap-1.5 text-center text-xs">
                <Download className="size-3.5" />
                提示：点击预览纸上的证件可直接裁切或四点拉直；打印机设置选择「实际大小 / 100% 缩放」即可严格 1:1 出纸。
              </p>
            </div>
          </div>
        </div>
      </ToolShell>

      {/* 精细裁切与四点透视拉直弹窗 */}
      <CropEditorModal
        open={editingSide !== null}
        title={editingSide === 'front' ? docSpec.frontLabel : docSpec.backLabel}
        source={editingSide === 'front' ? front : editingSide === 'back' ? back : null}
        targetAspect={targetAspect}
        printOpts={opts}
        onCancel={() => setEditingSide(null)}
        onApply={applyCropEdit}
      />
    </>
  )
}
