import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Barcode as BarcodeIcon,
  CheckCircle2,
  Code2,
  Copy,
  Dices,
  Download,
  FileArchive,
  Hash,
  Layers,
  Printer,
  Sparkles,
  Wrench,
} from 'lucide-react'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { Button } from '@/components/ui/button'
import { ColorPicker, Field, Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { Slider } from '@/components/ui/slider'
import { copyImageToClipboard, downloadBlob, timestampName } from '@/lib/file'
import { cn } from '@/lib/utils'
import {
  buildBarcodeSvgString,
  exportBarcodePngBlob,
  exportBarcodeSvgBlob,
  exportBatchBarcodesZip,
  parseBatchBarcodeLines,
  printBarcodeLabels,
  renderBarcodeToCanvas,
} from './engine'
import {
  BARCODE_FORMAT_MAP,
  BARCODE_FORMATS,
  BARCODE_STYLE_PRESETS,
  BG_COLOR_PRESETS,
  DEFAULT_BARCODE_STYLE,
  evaluateBarcodeReadability,
  generateRandomSample,
  LINE_COLOR_PRESETS,
  validateAndNormalizeBarcode,
  type BarcodeFontFamily,
  type BarcodeFormat,
  type BarcodeStyleConfig,
  type BarcodeSubMode,
  type BarcodeTextAlign,
  type BarcodeTextPosition,
} from './types'

const inputCls =
  'border-border/70 bg-background/60 focus:border-primary focus:ring-primary/20 w-full rounded-xl border px-3 py-2 text-sm transition outline-none focus:ring-2'

const SAMPLE_BATCH_LINES = [
  '货位A01 | LB-2026-0001',
  '货位A02 | LB-2026-0002',
  '货位A03 | LB-2026-0003',
  '货位A04 | LB-2026-0004',
  '货位A05 | LB-2026-0005',
  '货位A06 | LB-2026-0006',
].join('\n')

export default function BarcodeTool() {
  const [subMode, setSubMode] = useState<BarcodeSubMode>('single')
  const [style, setStyle] = useState<BarcodeStyleConfig>(DEFAULT_BARCODE_STYLE)
  const [value, setValue] = useState(BARCODE_FORMAT_MAP.CODE128.sample)

  // 批量模式状态
  const [batchInput, setBatchInput] = useState(SAMPLE_BATCH_LINES)
  const [batchFormat, setBatchFormat] = useState<'png' | 'svg'>('png')
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)

  // 连号生成器状态
  const [seqPrefix, setSeqPrefix] = useState('SKU-2026-')
  const [seqStart, setSeqStart] = useState(1)
  const [seqCount, setSeqCount] = useState(12)
  const [seqPad, setSeqPad] = useState(4)

  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [previewDims, setPreviewDims] = useState<{ width: number; height: number } | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)

  const patchStyle = useCallback((patch: Partial<BarcodeStyleConfig>) => {
    setStyle((prev) => ({ ...prev, ...patch }))
  }, [])

  const formatMeta = BARCODE_FORMAT_MAP[style.format]

  // 切换条码制式时，若当前内容不符合新制式则自动切换为该制式的标准示例（体验丝滑不报错）
  const handleFormatChange = (nextFormat: BarcodeFormat) => {
    patchStyle({ format: nextFormat })
    const check = validateAndNormalizeBarcode(value, nextFormat)
    if (check.error) {
      setValue(BARCODE_FORMAT_MAP[nextFormat].sample)
    }
  }

  // 批量行实时校验
  const batchItems = useMemo(() => parseBatchBarcodeLines(batchInput, style.format), [batchInput, style.format])
  const validBatchItems = useMemo(() => batchItems.filter((i) => !i.error), [batchItems])
  const invalidBatchItems = useMemo(() => batchItems.filter((i) => i.error), [batchItems])

  // 当前用于实时预览的值
  const activePreviewRaw = useMemo(() => {
    if (subMode === 'batch') {
      return validBatchItems[0]?.encodedValue || formatMeta.sample
    }
    return value
  }, [subMode, validBatchItems, value, formatMeta.sample])

  const singleCheck = useMemo(() => validateAndNormalizeBarcode(value, style.format), [value, style.format])
  const previewCheck = useMemo(
    () => validateAndNormalizeBarcode(activePreviewRaw, style.format),
    [activePreviewRaw, style.format],
  )

  // 实时渲染预览 Canvas
  useEffect(() => {
    const canvas = previewCanvasRef.current
    if (!canvas) return
    if (previewCheck.error || !previewCheck.encodedValue) {
      setRenderError(previewCheck.error || '请输入条码内容')
      setPreviewDims(null)
      return
    }
    try {
      const renderStyle: BarcodeStyleConfig = subMode === 'batch' ? { ...style, customText: '' } : style
      const dims = renderBarcodeToCanvas(canvas, previewCheck.encodedValue, renderStyle, 2)
      setPreviewDims({ width: Math.round(dims.width / 2), height: Math.round(dims.height / 2) })
      setRenderError(null)
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : '当前内容无法按此制式编码')
      setPreviewDims(null)
    }
  }, [previewCheck, style, subMode])

  const readabilityWarnings = useMemo(() => evaluateBarcodeReadability(style), [style])

  // 导出高清 PNG
  const handleDownloadPng = async () => {
    if (singleCheck.error || !singleCheck.encodedValue) {
      toast.error(singleCheck.error || '请输入有效条码')
      return
    }
    setBusyAction('png')
    try {
      const blob = await exportBarcodePngBlob(singleCheck.encodedValue, style)
      downloadBlob(blob, timestampName(`barcode-${style.format.toLowerCase()}`, 'png'))
      toast.success(`已导出 ${style.exportScale}× 高清 PNG`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出 PNG 失败')
    } finally {
      setBusyAction(null)
    }
  }

  // 导出矢量 SVG
  const handleDownloadSvg = () => {
    if (singleCheck.error || !singleCheck.encodedValue) {
      toast.error(singleCheck.error || '请输入有效条码')
      return
    }
    try {
      const blob = exportBarcodeSvgBlob(singleCheck.encodedValue, style)
      downloadBlob(blob, timestampName(`barcode-${style.format.toLowerCase()}`, 'svg'))
      toast.success('已导出无损矢量 SVG')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出 SVG 失败')
    }
  }

  // 复制 PNG 到剪贴板
  const handleCopyPng = async () => {
    if (singleCheck.error || !singleCheck.encodedValue) return
    setBusyAction('copy')
    try {
      const blob = await exportBarcodePngBlob(singleCheck.encodedValue, style)
      await copyImageToClipboard(blob)
      toast.success('已复制条形码图片到剪贴板')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制失败，请尝试下载 PNG')
    } finally {
      setBusyAction(null)
    }
  }

  // 复制 SVG 源码
  const handleCopySvgCode = async () => {
    if (singleCheck.error || !singleCheck.encodedValue) return
    try {
      const svg = buildBarcodeSvgString(singleCheck.encodedValue, style)
      await navigator.clipboard.writeText(svg)
      toast.success('已复制无损 SVG 代码')
    } catch {
      toast.error('复制 SVG 代码失败')
    }
  }

  // 批量打包 ZIP
  const handleBatchZip = async () => {
    if (!validBatchItems.length) {
      toast.error('当前没有符合制式规则的有效条码')
      return
    }
    setBusyAction('batch')
    setBatchProgress({ done: 0, total: validBatchItems.length })
    try {
      const { blob, exportedCount } = await exportBatchBarcodesZip(
        validBatchItems,
        style,
        batchFormat,
        (done, total) => setBatchProgress({ done, total }),
      )
      downloadBlob(blob, timestampName(`barcodes-${style.format.toLowerCase()}-${exportedCount}`, 'zip'))
      toast.success(`已打包导出 ${exportedCount} 张 ${batchFormat.toUpperCase()} 条形码`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '批量导出失败')
    } finally {
      setBusyAction(null)
      setBatchProgress(null)
    }
  }

  // 打印标签（支持单码或批量多列排版）
  const handlePrint = () => {
    try {
      if (subMode === 'single') {
        if (singleCheck.error || !singleCheck.encodedValue) {
          toast.error(singleCheck.error || '请输入有效条码')
          return
        }
        printBarcodeLabels([{ value: singleCheck.encodedValue }], style)
      } else {
        if (!validBatchItems.length) {
          toast.error('没有可打印的有效条码')
          return
        }
        printBarcodeLabels(
          validBatchItems.map((it) => ({
            title: it.filename !== it.encodedValue ? it.filename : undefined,
            value: it.encodedValue,
          })),
          style,
        )
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开打印视图失败')
    }
  }

  // 连号批量生成填充
  const handleGenerateSequence = () => {
    const count = Math.max(1, Math.min(200, seqCount))
    const padLen = Math.max(0, Math.min(12, seqPad))
    const lines: string[] = []
    for (let i = 0; i < count; i++) {
      const numStr = String(seqStart + i).padStart(padLen, '0')
      lines.push(`${seqPrefix}${numStr}`)
    }
    setBatchInput(lines.join('\n'))
    toast.success(`已生成 ${count} 条连号序列`)
  }

  // ===== 左侧参数面板 =====
  const panel = (
    <>
      {/* 1. 一键配色预设 */}
      <Field label="外观预设">
        <div className="grid grid-cols-2 gap-2">
          {BARCODE_STYLE_PRESETS.map((preset) => {
            const active = style.lineColor === preset.patch.lineColor && style.background === preset.patch.background
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => patchStyle(preset.patch)}
                className={cn(
                  'border-border/70 hover:border-primary/50 flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-xs font-medium transition',
                  active && 'border-primary bg-primary/8 text-primary ring-primary/20 ring-1',
                )}
              >
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-md border border-black/15',
                    preset.colors[1] === 'transparent' && 'checkerboard',
                  )}
                  style={preset.colors[1] === 'transparent' ? undefined : { backgroundColor: preset.colors[1] }}
                >
                  <span className="h-3 w-2.5 rounded-[1px]" style={{ backgroundColor: preset.colors[0] }} />
                </span>
                <span className="truncate">{preset.name}</span>
              </button>
            )
          })}
        </div>
      </Field>

      {/* 2. 条纹几何参数 */}
      <Field label="单条线宽" value={`${style.barWidth.toFixed(1)} px`}>
        <Slider
          value={Math.round(style.barWidth * 10)}
          min={10}
          max={50}
          step={2}
          onChange={(v) => patchStyle({ barWidth: v / 10 })}
        />
      </Field>

      <Field label="条码高度" value={`${style.height} px`}>
        <Slider value={style.height} min={30} max={200} step={2} onChange={(v) => patchStyle({ height: v })} />
      </Field>

      <Field label="四周静区留白" value={`${style.margin} px`}>
        <Slider value={style.margin} min={0} max={40} step={2} onChange={(v) => patchStyle({ margin: v })} />
      </Field>

      {/* 3. 色彩设置 */}
      <Field label="条纹颜色" value={style.lineColor.toUpperCase()}>
        <ColorPicker
          value={style.lineColor}
          onChange={(v) => patchStyle({ lineColor: v === 'transparent' ? '#111827' : v })}
          presets={LINE_COLOR_PRESETS}
        />
      </Field>

      <Field label="背景颜色" value={style.background === 'transparent' ? '透明' : style.background.toUpperCase()}>
        <ColorPicker value={style.background} onChange={(v) => patchStyle({ background: v })} presets={BG_COLOR_PRESETS} />
      </Field>

      {/* 4. 人类可读文字（HRI）排版 */}
      <div className="space-y-3 border-t pt-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-foreground/85 font-medium">显示底部/顶部文字</span>
          <Switch
            checked={style.displayValue}
            onChange={(v) => patchStyle({ displayValue: v })}
            label="显示可读文字"
          />
        </div>

        {style.displayValue && (
          <div className="space-y-3.5">
            {subMode === 'single' && (
              <Field label="自定义显示文案（可选）">
                <input
                  type="text"
                  value={style.customText}
                  onChange={(e) => patchStyle({ customText: e.target.value })}
                  placeholder="留空则默认显示条码原始编码"
                  className={inputCls}
                />
              </Field>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <Field label="文字位置">
                <Segmented<BarcodeTextPosition>
                  size="sm"
                  value={style.textPosition}
                  onChange={(v) => patchStyle({ textPosition: v })}
                  options={[
                    { value: 'bottom', label: '底部' },
                    { value: 'top', label: '顶部' },
                  ]}
                />
              </Field>
              <Field label="对齐方式">
                <Segmented<BarcodeTextAlign>
                  size="sm"
                  value={style.textAlign}
                  onChange={(v) => patchStyle({ textAlign: v })}
                  options={[
                    { value: 'left', label: '左' },
                    { value: 'center', label: '中' },
                    { value: 'right', label: '右' },
                  ]}
                />
              </Field>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Segmented<BarcodeFontFamily>
                  size="sm"
                  value={style.font}
                  onChange={(v) => patchStyle({ font: v })}
                  options={[
                    { value: 'monospace', label: '等宽' },
                    { value: 'sans-serif', label: '黑体' },
                    { value: 'serif', label: '衬线' },
                  ]}
                />
              </div>
              <Button
                size="sm"
                variant={style.bold ? 'primary' : 'outline'}
                onClick={() => patchStyle({ bold: !style.bold })}
                className="font-bold"
              >
                B
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="字号" value={`${style.fontSize}px`}>
                <Slider value={style.fontSize} min={10} max={36} onChange={(v) => patchStyle({ fontSize: v })} />
              </Field>
              <Field label="文字间距" value={`${style.textMargin}px`}>
                <Slider value={style.textMargin} min={0} max={24} onChange={(v) => patchStyle({ textMargin: v })} />
              </Field>
            </div>
          </div>
        )}
      </div>

      {/* 5. PNG 导出清晰度 */}
      <Field label="PNG 导出倍率" value={`${style.exportScale}× 印刷清晰度`}>
        <Segmented
          size="sm"
          value={String(style.exportScale)}
          onChange={(v) => patchStyle({ exportScale: Number(v) as 1 | 2 | 3 })}
          options={[
            { value: '1', label: '1× 标准' },
            { value: '2', label: '2× 高清' },
            { value: '3', label: '3× 印刷级' },
          ]}
        />
      </Field>
    </>
  )

  const actions =
    subMode === 'single' ? (
      <>
        <Button
          variant="primary"
          size="lg"
          disabled={Boolean(singleCheck.error) || busyAction !== null}
          onClick={handleDownloadPng}
        >
          <Download />
          {busyAction === 'png' ? '导出中…' : '导出 PNG'}
        </Button>
        <Button variant="outline" size="lg" disabled={Boolean(singleCheck.error)} onClick={handleDownloadSvg}>
          <Code2 />
          SVG
        </Button>
      </>
    ) : (
      <Button
        variant="primary"
        size="lg"
        disabled={validBatchItems.length === 0 || busyAction !== null}
        onClick={handleBatchZip}
      >
        <FileArchive />
        {batchProgress
          ? `打包中 (${batchProgress.done}/${batchProgress.total})`
          : `导出 ${validBatchItems.length} 张 ZIP`}
      </Button>
    )

  return (
    <div className="space-y-5">
      {/* 顶部模式切换条 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<BarcodeSubMode>
          value={subMode}
          onChange={setSubMode}
          className="max-w-xs"
          options={[
            { value: 'single', label: '单码精调', icon: <Sparkles /> },
            { value: 'batch', label: '批量与连号生成', icon: <Layers /> },
          ]}
        />

        <Button
          size="sm"
          variant="outline"
          disabled={subMode === 'single' ? Boolean(singleCheck.error) : validBatchItems.length === 0}
          onClick={handlePrint}
        >
          <Printer className="!size-3.5" />
          {subMode === 'single' ? '打印条码' : `打印 ${validBatchItems.length} 枚标签`}
        </Button>
      </div>

      <ToolShell panel={panel} actions={actions} panelTitle="条码样式与排版">
        <div className="space-y-5">
          {/* 1. 制式选择与内容输入卡片 */}
          <section className="glass shadow-soft space-y-4 rounded-2xl p-4 sm:p-5">
            {/* 条码制式选择网格 */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-foreground/85 font-semibold">条形码制式（12 种国际标准）</span>
                <span className="text-muted-foreground">{formatMeta.desc}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {BARCODE_FORMATS.map((fmt) => {
                  const active = style.format === fmt.id
                  return (
                    <button
                      key={fmt.id}
                      type="button"
                      onClick={() => handleFormatChange(fmt.id)}
                      className={cn(
                        'rounded-xl px-2.5 py-1.5 text-xs font-medium transition',
                        active
                          ? 'bg-primary text-primary-foreground shadow-xs'
                          : 'bg-foreground/[0.05] text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {fmt.label}
                    </button>
                  )
                })}
              </div>
              <div className="text-muted-foreground text-[11px]">
                编码规则：{formatMeta.rule}
              </div>
            </div>

            {subMode === 'single' ? (
              /* 单码输入区 */
              <div className="space-y-2.5">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={formatMeta.placeholder}
                    className={cn(inputCls, 'font-mono text-base font-medium')}
                  />
                  <Button
                    variant="outline"
                    onClick={() => setValue(generateRandomSample(style.format))}
                    title="随机生成一个符合当前制式的合法测试条码"
                    className="shrink-0"
                  >
                    <Dices className="size-4" />
                    <span className="hidden sm:inline">随机示例</span>
                  </Button>
                </div>

                {/* GS1 校验位自动补全提示 */}
                {singleCheck.autoCompletedNote && (
                  <div className="flex items-center gap-1.5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="size-3.5 shrink-0" />
                    <span>{singleCheck.autoCompletedNote}</span>
                  </div>
                )}

                {/* 校验位填错时的一键修正条 */}
                {singleCheck.error && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="size-3.5 shrink-0" />
                      <span>{singleCheck.error}</span>
                    </div>
                    {singleCheck.suggestedFix && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        onClick={() => {
                          setValue(singleCheck.suggestedFix!)
                          toast.success(`已自动修正为 ${singleCheck.suggestedFix}`)
                        }}
                      >
                        <Wrench className="!size-3" />
                        一键修正为 {singleCheck.suggestedFix}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* 批量模式：连号生成器 + 多行文本框 */
              <div className="space-y-3.5">
                {/* 连号快捷生成器 */}
                <div className="border-border/60 bg-foreground/[0.025] space-y-2.5 rounded-xl border p-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <Hash className="text-primary size-3.5" />
                    <span>连号批量生成器（快速生成流水号）</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <input
                      type="text"
                      value={seqPrefix}
                      onChange={(e) => setSeqPrefix(e.target.value)}
                      placeholder="前缀（如 SKU-）"
                      className={cn(inputCls, 'py-1.5 font-mono text-xs sm:col-span-2')}
                    />
                    <input
                      type="number"
                      value={seqStart}
                      onChange={(e) => setSeqStart(Number(e.target.value) || 0)}
                      placeholder="起始号"
                      className={cn(inputCls, 'py-1.5 font-mono text-xs')}
                      title="起始编号"
                    />
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={seqCount}
                        onChange={(e) => setSeqCount(Number(e.target.value) || 1)}
                        className={cn(inputCls, 'py-1.5 font-mono text-xs')}
                        title="生成条数（最多 200）"
                      />
                      <span className="text-muted-foreground shrink-0 text-[11px]">条</span>
                    </div>
                    <Button size="sm" variant="secondary" onClick={handleGenerateSequence} className="w-full">
                      生成连号
                    </Button>
                  </div>
                  <div className="text-muted-foreground flex items-center gap-2 text-[11px]">
                    <span>编号补零位数：</span>
                    {[0, 3, 4, 6].map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setSeqPad(p)}
                        className={cn(
                          'rounded-md px-1.5 py-0.5 font-mono transition',
                          seqPad === p ? 'bg-primary text-primary-foreground' : 'bg-foreground/[0.06]',
                        )}
                      >
                        {p === 0 ? '不补零' : `${p}位`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 多行编辑区 */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium">每行一条（支持「标签名 | 条码值」自定义文件名与打印标题）</span>
                    <Segmented
                      size="sm"
                      value={batchFormat}
                      onChange={setBatchFormat}
                      className="w-28"
                      options={[
                        { value: 'png', label: 'PNG' },
                        { value: 'svg', label: 'SVG' },
                      ]}
                    />
                  </div>
                  <textarea
                    rows={5}
                    value={batchInput}
                    onChange={(e) => setBatchInput(e.target.value)}
                    placeholder={'每行输入一个条码，或使用「文件名 | 条码内容」\n例如：\n商品A | 6901234567892'}
                    className={cn(inputCls, 'font-mono text-xs leading-relaxed')}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                      ✓ 合法可导出：{validBatchItems.length} 条
                    </span>
                    {invalidBatchItems.length > 0 && (
                      <span className="text-rose-500">
                        ✕ {invalidBatchItems.length} 条不符合 {formatMeta.label} 规则（如第 {invalidBatchItems[0].lineNumber} 行：{invalidBatchItems[0].error}）
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* 2. 高清实时预览舞台 */}
          <section className="glass shadow-soft flex flex-col items-center gap-5 rounded-2xl p-6 sm:p-8">
            <div className="flex w-full flex-wrap items-center justify-between gap-2 text-xs">
              <div className="text-muted-foreground flex items-center gap-2">
                <span className="bg-foreground/[0.06] text-foreground rounded-md px-2 py-0.5 font-medium">
                  {subMode === 'batch' ? '首条样式预览' : '实时预览'}
                </span>
                <span className="font-mono">{formatMeta.label}</span>
                {previewDims && (
                  <span className="font-mono tabular-nums">
                    · {previewDims.width * style.exportScale} × {previewDims.height * style.exportScale} px
                  </span>
                )}
              </div>

              {subMode === 'single' && !renderError && (
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" disabled={busyAction !== null} onClick={handleCopyPng}>
                    <Copy className="!size-3.5" />
                    {busyAction === 'copy' ? '复制中…' : '复制图片'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleCopySvgCode}>
                    <Code2 className="!size-3.5" />
                    复制 SVG
                  </Button>
                </div>
              )}
            </div>

            {/* 预览画布框 */}
            <div
              className={cn(
                'relative flex min-h-[160px] w-full max-w-2xl items-center justify-center overflow-x-auto rounded-2xl border border-black/10 p-5 shadow-lg dark:border-white/10',
                style.background === 'transparent' ? 'checkerboard' : 'bg-white/75 dark:bg-black/20',
              )}
            >
              {renderError ? (
                <div className="text-muted-foreground flex flex-col items-center gap-2 py-4 text-center text-xs">
                  <BarcodeIcon className="size-10 opacity-30" />
                  <span className="max-w-sm text-rose-500">{renderError}</span>
                </div>
              ) : null}
              <canvas
                ref={previewCanvasRef}
                className={cn('block h-auto max-w-full rounded-lg', renderError && 'hidden')}
              />
            </div>

            {/* 扫码枪可读性体检条 */}
            {!renderError && (
              <div className="w-full max-w-xl space-y-2">
                {readabilityWarnings.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3.5 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="size-4 shrink-0" />
                    <span>条纹对比度与静区留白符合标准，红外扫码枪与手机均可秒扫</span>
                  </div>
                ) : (
                  readabilityWarnings.map((w, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-3.5 py-2 text-xs text-amber-800 dark:text-amber-300"
                    >
                      <AlertTriangle className="size-4 shrink-0" />
                      <span>{w}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>
        </div>
      </ToolShell>
    </div>
  )
}
