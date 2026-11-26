import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Building2,
  CalendarDays,
  Check,
  Code2,
  Copy,
  Dices,
  Download,
  FileImage,
  Info,
  Move,
  Receipt,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Stamp,
  Trash2,
  Type,
  Upload,
  UserRound,
} from 'lucide-react'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { Button } from '@/components/ui/button'
import { ColorPicker, Field, Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { Slider } from '@/components/ui/slider'
import { copyImageToClipboard, downloadBlob, timestampName } from '@/lib/file'
import { decodeImageFile, IMAGE_ACCEPT } from '@/lib/image'
import { cn } from '@/lib/utils'
import {
  computeSealMetrics,
  exportSealPngBlob,
  exportSealSvgBlob,
  exportStampedDocumentPng,
  loadCustomFontFile,
  renderSealToCanvas,
  type CustomFontAsset,
  type StampOverlayOptions,
} from './engine'
import {
  DEFAULT_SEAL_CONFIG,
  FONT_OPTIONS,
  getTodayDotDate,
  INK_PRESETS,
  resolveExportDimensions,
  SEAL_PRESETS,
  type CenterEmblem,
  type ExportSizeMode,
  type FrameStyle,
  type PersonalCarveStyle,
  type PersonalFlow,
  type PreviewBackdrop,
  type RectBorderStyle,
  type RectLayout,
  type SealConfig,
  type SealPreset,
  type SealType,
  type ThreeCharLayout,
} from './types'

const inputCls =
  'border-border/70 bg-background/60 focus:border-primary focus:ring-primary/20 w-full rounded-xl border px-3 py-2 text-sm transition outline-none focus:ring-2'

const SEAL_TYPE_CARDS: { id: SealType; label: string; desc: string; icon: typeof Building2 }[] = [
  { id: 'company', label: '企业公章', desc: '圆形 · 合同/行政', icon: Building2 },
  { id: 'oval', label: '发票财务', desc: '椭圆 · 税号/财务', icon: Receipt },
  { id: 'personal', label: '个人私章', desc: '方章 · 朱文/白文', icon: UserRound },
  { id: 'rect', label: '条形日期', desc: '长方 · 审核/付讫', icon: CalendarDays },
]

const EXPORT_SIZE_OPTIONS: { value: ExportSizeMode; label: string }[] = [
  { value: '512', label: '512px' },
  { value: '1024', label: '1024px' },
  { value: '2048', label: '2048px' },
  { value: 'print300', label: '300DPI 实体' },
]

const BACKDROP_OPTIONS: { value: PreviewBackdrop; label: string }[] = [
  { value: 'checker', label: '透明底' },
  { value: 'paper', label: '素雅宣纸' },
  { value: 'contract', label: '模拟合同' },
  { value: 'custom', label: '图片盖章' },
]

/** 生成随机 13 位公章防伪编码 */
function randomSealCode(): string {
  const prefix = '110105'
  let rest = ''
  for (let i = 0; i < 7; i++) {
    rest += String(Math.floor(Math.random() * 10))
  }
  return prefix + rest
}

/** 生成随机 18 位示例统一社会信用代码 */
function randomCreditCode(): string {
  const chars = '0123456789ABCDEFGHJKLMNPQRTUWXY'
  let tail = ''
  for (let i = 0; i < 10; i++) {
    tail += chars[Math.floor(Math.random() * chars.length)]
  }
  return `91110105${tail}`
}

interface UploadedDocImage {
  name: string
  previewUrl: string
  width: number
  height: number
  imgEl: HTMLImageElement
}

export default function SealGeneratorTool() {
  const [config, setConfig] = useState<SealConfig>(DEFAULT_SEAL_CONFIG)
  const [activePresetId, setActivePresetId] = useState<string>('company-contract')
  const [backdrop, setBackdrop] = useState<PreviewBackdrop>('checker')
  const [exportSize, setExportSize] = useState<ExportSizeMode>('1024')
  const [customFont, setCustomFont] = useState<CustomFontAsset | null>(null)
  const [copiedPng, setCopiedPng] = useState(false)
  const [busyExport, setBusyExport] = useState(false)

  // 图片盖章模式状态
  const [docImage, setDocImage] = useState<UploadedDocImage | null>(null)
  const [stampOverlay, setStampOverlay] = useState<StampOverlayOptions>({
    normX: 0.72,
    normY: 0.76,
    widthRatio: 0.24,
    opacity: 0.94,
    multiply: true,
  })
  const [sealDataUrl, setSealDataUrl] = useState<string>('')
  const [draggingStamp, setDraggingStamp] = useState(false)

  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const stampStageRef = useRef<HTMLDivElement>(null)
  const fontInputRef = useRef<HTMLInputElement>(null)

  const update = useCallback(<K extends keyof SealConfig>(key: K, value: SealConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
    setActivePresetId('')
  }, [])

  /** 切换大类时自动应用该类别最经典的首个模板，避免跨类型残留不合理文案 */
  const handleSelectType = useCallback((nextType: SealType) => {
    if (nextType === config.type) return
    const first = SEAL_PRESETS.find((p) => p.type === nextType)
    if (first) {
      setConfig((prev) => ({ ...prev, ...first.patch }))
      setActivePresetId(first.id)
    } else {
      setConfig((prev) => ({ ...prev, type: nextType }))
      setActivePresetId('')
    }
  }, [config.type])

  /** 应用精选模板 */
  const applyPreset = useCallback((preset: SealPreset) => {
    setConfig((prev) => ({ ...prev, ...preset.patch }))
    setActivePresetId(preset.id)
  }, [])

  /** 重置到默认 */
  const handleReset = useCallback(() => {
    setConfig(DEFAULT_SEAL_CONFIG)
    setActivePresetId('company-contract')
    toast.success('已恢复默认公章样式')
  }, [])

  /** 逻辑画布与导出尺寸估算 */
  const metrics = useMemo(() => computeSealMetrics(config), [config])
  const exportDims = useMemo(() => resolveExportDimensions(config, exportSize), [config, exportSize])

  /** 实时渲染预览 Canvas（并同步更新「图片盖章」悬浮层用图） */
  useEffect(() => {
    let cancelled = false
    const draw = () => {
      if (cancelled) return
      const canvas = previewCanvasRef.current
      if (canvas) {
        renderSealToCanvas(canvas, config, 720, customFont?.familyName)
      }
      if (backdrop === 'custom') {
        const off = document.createElement('canvas')
        renderSealToCanvas(off, config, 640, customFont?.familyName)
        setSealDataUrl(off.toDataURL('image/png'))
      }
    }
    const raf = requestAnimationFrame(draw)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [config, customFont, backdrop])

  /** 清理上传底图 ObjectURL */
  useEffect(() => {
    return () => {
      if (docImage?.previewUrl) URL.revokeObjectURL(docImage.previewUrl)
    }
  }, [docImage?.previewUrl])

  /** 导入本地自定义字体 */
  const handleCustomFontChange = async (file?: File) => {
    if (!file) return
    try {
      const loaded = await loadCustomFontFile(file)
      setCustomFont(loaded)
      setConfig((prev) => ({ ...prev, fontId: 'custom' }))
      toast.success(`已加载本地字体「${loaded.displayName}」`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '字体加载失败')
    } finally {
      if (fontInputRef.current) fontInputRef.current.value = ''
    }
  }

  /** 导出透明底 PNG */
  const handleDownloadPng = async () => {
    setBusyExport(true)
    try {
      const { blob, width, height } = await exportSealPngBlob(config, exportSize, customFont?.familyName)
      const label = (config.mainText.trim().slice(0, 12) || 'seal').replace(/[\\/:*?"<>|]/g, '')
      downloadBlob(blob, timestampName(`seal-${label}`, 'png'))
      toast.success(`已导出透明 PNG（${width} × ${height} px）`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出 PNG 失败')
    } finally {
      setBusyExport(false)
    }
  }

  /** 复制透明 PNG 到剪贴板（可直接粘贴进 Word / WPS / 微信） */
  const handleCopyPng = async () => {
    setBusyExport(true)
    try {
      const { blob } = await exportSealPngBlob(config, exportSize, customFont?.familyName)
      await copyImageToClipboard(blob)
      setCopiedPng(true)
      toast.success('已复制透明印章，可直接粘贴到 Word / WPS / 聊天窗口')
      setTimeout(() => setCopiedPng(false), 1800)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制失败，请检查浏览器剪贴板权限')
    } finally {
      setBusyExport(false)
    }
  }

  /** 导出矢量 SVG */
  const handleDownloadSvg = () => {
    try {
      const blob = exportSealSvgBlob(config, customFont?.familyName)
      const label = (config.mainText.trim().slice(0, 12) || 'seal').replace(/[\\/:*?"<>|]/g, '')
      downloadBlob(blob, timestampName(`seal-${label}`, 'svg'))
      toast.success('已导出矢量 SVG 文件')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出 SVG 失败')
    }
  }

  /** 加载用户上传的文档图片（用于在线盖章） */
  const handleDocFiles = async (files: File[]) => {
    const file = files[0]
    if (!file) return
    try {
      const decoded = await decodeImageFile(file)
      const imgEl = new Image()
      await new Promise<void>((resolve, reject) => {
        imgEl.onload = () => resolve()
        imgEl.onerror = () => reject(new Error('图片加载失败'))
        imgEl.src = decoded.previewUrl
      })
      decoded.bitmap.close()
      setDocImage((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl)
        return {
          name: file.name,
          previewUrl: decoded.previewUrl,
          width: decoded.width,
          height: decoded.height,
          imgEl,
        }
      })
      setBackdrop('custom')
      toast.success(`已载入「${file.name}」，可拖动印章调整落点`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '文档图片解析失败')
    }
  }

  /** 导出盖好章的文档成品图 */
  const handleExportStampedDoc = async () => {
    if (!docImage) return
    setBusyExport(true)
    try {
      const blob = await exportStampedDocumentPng(docImage.imgEl, config, stampOverlay, customFont?.familyName)
      const base = docImage.name.replace(/\.[^.]+$/, '').slice(0, 20) || 'document'
      downloadBlob(blob, timestampName(`${base}-stamped`, 'png'))
      toast.success('已导出盖章成品图（PNG）')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '合成导出失败')
    } finally {
      setBusyExport(false)
    }
  }

  /** 图片盖章舞台指针拖拽 */
  const updateStampPositionFromPointer = (clientX: number, clientY: number) => {
    const el = stampStageRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const nx = Math.min(0.96, Math.max(0.04, (clientX - rect.left) / rect.width))
    const ny = Math.min(0.96, Math.max(0.04, (clientY - rect.top) / rect.height))
    setStampOverlay((prev) => ({ ...prev, normX: nx, normY: ny }))
  }

  /** 个人印章快捷补字（「印」「之印」） */
  const appendPersonalSuffix = (suffix: '印' | '之印') => {
    const pure = config.mainText.replace(/\s+/g, '').replace(/(之印|私印|之章|印)$/u, '')
    if (!pure) return
    update('mainText', `${pure}${suffix}`)
  }

  const personalCharCount = Array.from(config.mainText.replace(/\s+/g, '')).length

  // ============================================================================
  // 左侧参数面板
  // ============================================================================
  const panel = (
    <div className="space-y-6">
      {/* 1. 印章大类 */}
      <div className="space-y-2.5">
        <div className="text-foreground/80 text-sm font-medium">印章类型</div>
        <div className="grid grid-cols-2 gap-2">
          {SEAL_TYPE_CARDS.map((item) => {
            const Icon = item.icon
            const active = config.type === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectType(item.id)}
                className={cn(
                  'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all',
                  active
                    ? 'border-primary bg-primary/10 text-foreground shadow-xs'
                    : 'border-border/60 bg-background/40 text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                    active ? 'bg-primary text-primary-foreground' : 'bg-foreground/[0.06] text-foreground/70',
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold">{item.label}</span>
                  <span className="text-muted-foreground block truncate text-[10px]">{item.desc}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 2. 精选场景模板 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-foreground/80 flex items-center gap-1.5 font-medium">
            <Sparkles className="text-primary size-3.5" />
            快捷场景模板
          </span>
          <button
            type="button"
            onClick={handleReset}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11px] transition-colors"
          >
            <RotateCcw className="size-3" />
            重置
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {SEAL_PRESETS.map((preset) => {
            const active = activePresetId === preset.id
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-left transition-all',
                  active
                    ? 'border-primary/80 bg-primary/10 text-foreground'
                    : 'border-border/50 bg-background/40 text-foreground/80 hover:border-border hover:bg-foreground/[0.04]',
                )}
              >
                <div className="truncate text-xs font-medium">{preset.name}</div>
                <div className="text-muted-foreground truncate text-[10px]">{preset.tag}</div>
              </button>
            )
          })}
        </div>
      </div>

      <hr className="border-border/60" />

      {/* 3. 文案内容（按当前印章类型自适应） */}
      <div className="space-y-4">
        <div className="text-foreground/80 text-xs font-semibold tracking-wider uppercase">文案内容</div>

        {config.type === 'company' && (
          <>
            <Field label="单位 / 环绕主文字" value={`${Array.from(config.mainText.trim()).length} 字`}>
              <input
                type="text"
                value={config.mainText}
                onChange={(e) => update('mainText', e.target.value)}
                placeholder="例如：轻匣数字科技有限公司"
                className={inputCls}
              />
            </Field>
            <Field label="副标题（留空即标准公章）">
              <input
                type="text"
                value={config.subText}
                onChange={(e) => update('subText', e.target.value)}
                placeholder="例如：合同专用章 / 财务专用章"
                className={inputCls}
              />
            </Field>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground/80 font-medium">底部防伪编码</span>
                <Switch checked={config.showCode} onChange={(v) => update('showCode', v)} label="显示防伪编码" />
              </div>
              {config.showCode && (
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={config.codeText}
                    onChange={(e) => update('codeText', e.target.value)}
                    placeholder="13 位编码"
                    className={cn(inputCls, 'font-mono text-xs')}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-auto px-2.5"
                    title="随机生成 13 位示例编码"
                    onClick={() => update('codeText', randomSealCode())}
                  >
                    <Dices className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </>
        )}

        {config.type === 'oval' && (
          <>
            <Field label="顶部单位名称" value={`${Array.from(config.mainText.trim()).length} 字`}>
              <input
                type="text"
                value={config.mainText}
                onChange={(e) => update('mainText', e.target.value)}
                placeholder="例如：轻匣数字科技有限公司"
                className={inputCls}
              />
            </Field>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground/80 font-medium">统一社会信用代码 / 税号</span>
                <Switch checked={config.showCode} onChange={(v) => update('showCode', v)} label="显示税号" />
              </div>
              {config.showCode && (
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={config.codeText}
                    onChange={(e) => update('codeText', e.target.value.toUpperCase())}
                    placeholder="18 位税号"
                    className={cn(inputCls, 'font-mono text-xs')}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-auto px-2.5"
                    title="随机示例税号"
                    onClick={() => update('codeText', randomCreditCode())}
                  >
                    <Dices className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>
            <Field label="底部章名">
              <input
                type="text"
                value={config.subText}
                onChange={(e) => update('subText', e.target.value)}
                placeholder="例如：发票专用章 / 财务专用章"
                className={inputCls}
              />
            </Field>
          </>
        )}

        {config.type === 'personal' && (
          <>
            <Field label="印文内容（1–9 字）" value={`${Math.min(9, personalCharCount)} 字`}>
              <input
                type="text"
                value={config.mainText}
                onChange={(e) => update('mainText', e.target.value)}
                placeholder="例如：张明远印 / 清风明月"
                maxLength={12}
                className={inputCls}
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => appendPersonalSuffix('印')}
                  className="bg-foreground/[0.06] hover:bg-foreground/10 rounded-md px-2 py-0.5 text-[11px] transition-colors"
                >
                  + 补“印”
                </button>
                <button
                  type="button"
                  onClick={() => appendPersonalSuffix('之印')}
                  className="bg-foreground/[0.06] hover:bg-foreground/10 rounded-md px-2 py-0.5 text-[11px] transition-colors"
                >
                  + 补“之印”
                </button>
              </div>
            </Field>
          </>
        )}

        {config.type === 'rect' && (
          <>
            <Field label="条形章版式">
              <Segmented<RectLayout>
                size="sm"
                value={config.rectLayout}
                onChange={(v) => update('rectLayout', v)}
                options={[
                  { value: 'dated', label: '三段日期章' },
                  { value: 'single', label: '单栏条形章' },
                ]}
              />
            </Field>
            <Field label="主标题">
              <input
                type="text"
                value={config.mainText}
                onChange={(e) => update('mainText', e.target.value)}
                placeholder="例如：已 审 核 / 银 行 付 讫"
                className={inputCls}
              />
            </Field>
            {config.rectLayout === 'dated' && (
              <Field label="中间日期栏">
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={config.codeText}
                    onChange={(e) => update('codeText', e.target.value)}
                    placeholder="2026.11.26"
                    className={cn(inputCls, 'font-mono text-xs')}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-auto px-2.5 text-xs"
                    onClick={() => update('codeText', getTodayDotDate())}
                  >
                    今日
                  </Button>
                </div>
              </Field>
            )}
            <Field label={config.rectLayout === 'dated' ? '底部部门 / 经办人' : '下方英文或小号附注（可选）'}>
              <input
                type="text"
                value={config.rectExtraText}
                onChange={(e) => update('rectExtraText', e.target.value)}
                placeholder={config.rectLayout === 'dated' ? '例如：综合管理部' : '例如：PAID · 财务专用'}
                className={inputCls}
              />
            </Field>
          </>
        )}
      </div>

      <hr className="border-border/60" />

      {/* 4. 印泥颜色与字体 */}
      <div className="space-y-4">
        <div className="text-foreground/80 text-xs font-semibold tracking-wider uppercase">印泥与字体</div>

        <Field label="印泥颜色" value={config.color.toUpperCase()}>
          <ColorPicker
            value={config.color}
            onChange={(v) => update('color', v)}
            presets={INK_PRESETS.map((p) => p.hex)}
          />
        </Field>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground/80 flex items-center gap-1.5 font-medium">
              <Type className="size-3.5" />
              印章字体
            </span>
            <button
              type="button"
              onClick={() => fontInputRef.current?.click()}
              className="text-primary hover:underline inline-flex items-center gap-1 text-xs font-medium"
            >
              <Upload className="size-3" />
              导入本地字体
            </button>
            <input
              ref={fontInputRef}
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              className="hidden"
              onChange={(e) => handleCustomFontChange(e.target.files?.[0])}
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {FONT_OPTIONS.map((f) => {
              const active = config.fontId === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => update('fontId', f.id)}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5 text-left transition-all',
                    active
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border/50 bg-background/40 text-foreground/80 hover:border-border',
                  )}
                >
                  <div className="text-xs font-medium" style={{ fontFamily: f.family }}>
                    {f.label}
                  </div>
                  <div className="text-muted-foreground truncate text-[10px]">{f.hint}</div>
                </button>
              )
            })}
          </div>

          {customFont && (
            <div className="border-primary/40 bg-primary/5 flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs">
              <button
                type="button"
                onClick={() => update('fontId', 'custom')}
                className="min-w-0 flex-1 truncate text-left font-medium"
              >
                {config.fontId === 'custom' ? '● ' : ''}自定义：{customFont.displayName}
              </button>
              <button
                type="button"
                title="移除自定义字体"
                onClick={() => {
                  setCustomFont(null)
                  if (config.fontId === 'custom') update('fontId', 'song')
                }}
                className="text-muted-foreground hover:text-red-500 ml-2 p-0.5"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          )}
        </div>

        <Field label="字重">
          <Segmented<string>
            size="sm"
            value={String(config.fontWeight)}
            onChange={(v) => update('fontWeight', Number(v))}
            options={[
              { value: '400', label: '标准' },
              { value: '600', label: '偏粗' },
              { value: '700', label: '加粗' },
            ]}
          />
        </Field>
      </div>

      <hr className="border-border/60" />

      {/* 5. 版式精细调节 */}
      <div className="space-y-4">
        <div className="text-foreground/80 text-xs font-semibold tracking-wider uppercase">版式精细调节</div>

        <Field label="边框线宽" value={`${config.borderWidth}px`}>
          <Slider
            value={config.borderWidth}
            onChange={(v) => update('borderWidth', v)}
            min={4}
            max={28}
            step={1}
          />
        </Field>

        {config.type === 'company' && (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground/80 font-medium">内圈细线</span>
              <Switch checked={config.showInnerRing} onChange={(v) => update('showInnerRing', v)} label="内圈细线" />
            </div>

            <Field label="中心图徽">
              <Segmented<CenterEmblem>
                size="sm"
                value={config.emblem}
                onChange={(v) => update('emblem', v)}
                options={[
                  { value: 'star', label: '五角星' },
                  { value: 'hollow-star', label: '空心星' },
                  { value: 'double-star', label: '双环星' },
                  { value: 'none', label: '无' },
                ]}
              />
            </Field>

            {config.emblem !== 'none' && (
              <Field label="中心图徽大小" value={`${config.emblemSize}px`}>
                <Slider
                  value={config.emblemSize}
                  onChange={(v) => update('emblemSize', v)}
                  min={36}
                  max={108}
                  step={2}
                />
              </Field>
            )}

            <Field label="环绕张角" value={`${config.ringSpanDeg}°`}>
              <Slider
                value={config.ringSpanDeg}
                onChange={(v) => update('ringSpanDeg', v)}
                min={140}
                max={300}
                step={2}
              />
            </Field>

            <Field label="主文字字号" value={`${config.mainFontSize}px`}>
              <Slider
                value={config.mainFontSize}
                onChange={(v) => update('mainFontSize', v)}
                min={28}
                max={74}
                step={1}
              />
            </Field>

            <Field label="字宽压缩比" value={`${Math.round(config.textStretchX * 100)}%`}>
              <Slider
                value={Math.round(config.textStretchX * 100)}
                onChange={(v) => update('textStretchX', v / 100)}
                min={55}
                max={115}
                step={1}
              />
            </Field>

            {config.subText.trim() && (
              <>
                <Field label="副标题字号" value={`${config.subFontSize}px`}>
                  <Slider
                    value={config.subFontSize}
                    onChange={(v) => update('subFontSize', v)}
                    min={22}
                    max={56}
                    step={1}
                  />
                </Field>
                <Field label="副标题下移" value={`${config.subOffsetY}px`}>
                  <Slider
                    value={config.subOffsetY}
                    onChange={(v) => update('subOffsetY', v)}
                    min={40}
                    max={140}
                    step={2}
                  />
                </Field>
              </>
            )}

            {config.showCode && config.codeText.trim() && (
              <Field label="防伪码弧度" value={`${config.codeSpanDeg}°`}>
                <Slider
                  value={config.codeSpanDeg}
                  onChange={(v) => update('codeSpanDeg', v)}
                  min={44}
                  max={136}
                  step={2}
                />
              </Field>
            )}
          </>
        )}

        {config.type === 'oval' && (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground/80 font-medium">内椭圆细线</span>
              <Switch checked={config.showInnerRing} onChange={(v) => update('showInnerRing', v)} label="内椭圆细线" />
            </div>
            <Field label="顶部弧度张角" value={`${Math.min(205, config.ringSpanDeg)}°`}>
              <Slider
                value={Math.min(205, config.ringSpanDeg)}
                onChange={(v) => update('ringSpanDeg', v)}
                min={110}
                max={205}
                step={2}
              />
            </Field>
            <Field label="单位名大小" value={`${config.mainFontSize}px`}>
              <Slider
                value={config.mainFontSize}
                onChange={(v) => update('mainFontSize', v)}
                min={24}
                max={54}
                step={1}
              />
            </Field>
            <Field label="字宽压缩比" value={`${Math.round(config.textStretchX * 100)}%`}>
              <Slider
                value={Math.round(config.textStretchX * 100)}
                onChange={(v) => update('textStretchX', v / 100)}
                min={55}
                max={110}
                step={1}
              />
            </Field>
            {config.showCode && (
              <>
                <Field label="税号字号" value={`${config.taxFontSize}px`}>
                  <Slider
                    value={config.taxFontSize}
                    onChange={(v) => update('taxFontSize', v)}
                    min={18}
                    max={38}
                    step={1}
                  />
                </Field>
                <Field label="税号字距" value={`${config.taxLetterSpacing}px`}>
                  <Slider
                    value={config.taxLetterSpacing}
                    onChange={(v) => update('taxLetterSpacing', v)}
                    min={0}
                    max={8}
                    step={0.5}
                  />
                </Field>
              </>
            )}
            <Field label="底字大小" value={`${config.subFontSize}px`}>
              <Slider
                value={config.subFontSize}
                onChange={(v) => update('subFontSize', v)}
                min={22}
                max={48}
                step={1}
              />
            </Field>
          </>
        )}

        {config.type === 'personal' && (
          <>
            <Field label="雕刻工艺">
              <Segmented<PersonalCarveStyle>
                size="sm"
                value={config.carveStyle}
                onChange={(v) => update('carveStyle', v)}
                options={[
                  { value: 'zhuwen', label: '朱文（阳刻红字）' },
                  { value: 'baiwen', label: '白文（阴刻镂空）' },
                ]}
              />
            </Field>

            <Field label="边框样式">
              <Segmented<FrameStyle>
                size="sm"
                value={config.personalFrame}
                onChange={(v) => update('personalFrame', v)}
                options={[
                  { value: 'single', label: '单框' },
                  { value: 'double', label: '双框' },
                  { value: 'none', label: '无框' },
                ]}
              />
            </Field>

            <Field label="文字走向">
              <Segmented<PersonalFlow>
                size="sm"
                value={config.personalFlow}
                onChange={(v) => update('personalFlow', v)}
                options={[
                  { value: 'traditional', label: '传统竖排（右→左）' },
                  { value: 'modern', label: '现代横排（左→右）' },
                ]}
              />
            </Field>

            {personalCharCount === 3 && config.personalFlow === 'traditional' && (
              <Field label="三字分布">
                <Segmented<ThreeCharLayout>
                  size="sm"
                  value={config.threeCharLayout}
                  onChange={(v) => update('threeCharLayout', v)}
                  options={[
                    { value: 'left-two', label: '右一左二（大姓）' },
                    { value: 'right-two', label: '右二左一' },
                  ]}
                />
              </Field>
            )}

            <Field label="边角圆润度" value={`${config.cornerRadius}px`}>
              <Slider
                value={config.cornerRadius}
                onChange={(v) => update('cornerRadius', v)}
                min={0}
                max={48}
                step={2}
              />
            </Field>

            <Field label="印文留白边距" value={`${config.innerPadding}px`}>
              <Slider
                value={config.innerPadding}
                onChange={(v) => update('innerPadding', v)}
                min={10}
                max={68}
                step={2}
              />
            </Field>
          </>
        )}

        {config.type === 'rect' && (
          <>
            <Field label="边框线型">
              <Segmented<RectBorderStyle>
                size="sm"
                value={config.rectBorderStyle}
                onChange={(v) => update('rectBorderStyle', v)}
                options={[
                  { value: 'single', label: '单线' },
                  { value: 'double', label: '双线' },
                  { value: 'dashed', label: '虚线' },
                ]}
              />
            </Field>
            <Field label="边角圆角" value={`${config.cornerRadius}px`}>
              <Slider
                value={config.cornerRadius}
                onChange={(v) => update('cornerRadius', v)}
                min={0}
                max={36}
                step={2}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="宽度 (mm)" value={`${config.physicalWidthMm}`}>
                <Slider
                  value={config.physicalWidthMm}
                  onChange={(v) => update('physicalWidthMm', v)}
                  min={28}
                  max={72}
                  step={1}
                />
              </Field>
              <Field label="高度 (mm)" value={`${config.physicalHeightMm}`}>
                <Slider
                  value={config.physicalHeightMm}
                  onChange={(v) => update('physicalHeightMm', v)}
                  min={14}
                  max={42}
                  step={1}
                />
              </Field>
            </div>
          </>
        )}
      </div>

      <hr className="border-border/60" />

      {/* 6. 印泥做旧与姿态 */}
      <div className="space-y-4">
        <div className="text-foreground/80 text-xs font-semibold tracking-wider uppercase">做旧质感与导出</div>

        <Field
          label="印泥做旧斑驳"
          value={
            <span className="inline-flex items-center gap-1.5">
              <span>{config.aging === 0 ? '纯净矢量' : `${config.aging}%`}</span>
              {config.aging > 0 && (
                <button
                  type="button"
                  onClick={() => update('agingSeed', Math.floor(Math.random() * 900000) + 100000)}
                  className="text-primary hover:underline inline-flex items-center gap-0.5 text-[11px]"
                  title="更换随机印泥颗粒纹理"
                >
                  <RefreshCw className="size-3" />
                  换纹理
                </button>
              )}
            </span>
          }
        >
          <Slider value={config.aging} onChange={(v) => update('aging', v)} min={0} max={85} step={1} />
        </Field>

        <Field
          label="盖章倾角"
          value={
            <span className="inline-flex items-center gap-1.5">
              <span>{config.rotation > 0 ? `+${config.rotation}°` : `${config.rotation}°`}</span>
              {config.rotation !== 0 && (
                <button
                  type="button"
                  onClick={() => update('rotation', 0)}
                  className="text-primary hover:underline text-[11px]"
                >
                  归正
                </button>
              )}
            </span>
          }
        >
          <Slider value={config.rotation} onChange={(v) => update('rotation', v)} min={-35} max={35} step={1} />
        </Field>

        <div className="flex items-center justify-between text-sm">
          <span className="text-foreground/80 font-medium">叠加「样例」斜标</span>
          <Switch checked={config.showSampleMark} onChange={(v) => update('showSampleMark', v)} label="叠加样例斜标" />
        </div>

        <Field label="PNG 导出规格" value={`${exportDims.width} × ${exportDims.height} px`}>
          <Segmented<ExportSizeMode>
            size="sm"
            value={exportSize}
            onChange={setExportSize}
            options={EXPORT_SIZE_OPTIONS}
          />
        </Field>
      </div>
    </div>
  )

  const actions = (
    <>
      <Button variant="primary" size="md" onClick={handleDownloadPng} disabled={busyExport}>
        <Download />
        下载 PNG
      </Button>
      <Button variant="outline" size="md" onClick={handleCopyPng} disabled={busyExport}>
        {copiedPng ? <Check className="text-emerald-500" /> : <Copy />}
        {copiedPng ? '已复制' : '复制图片'}
      </Button>
    </>
  )

  return (
    <ToolShell panel={panel} actions={actions} panelTitle="印章定制参数">
      <div className="space-y-4">
        {/* 顶部底衬切换与规格指示 */}
        <div className="glass shadow-soft flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
          <div className="w-full sm:w-auto sm:min-w-[320px]">
            <Segmented<PreviewBackdrop>
              size="sm"
              value={backdrop}
              onChange={setBackdrop}
              options={BACKDROP_OPTIONS}
            />
          </div>

          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
            <span className="bg-foreground/[0.06] rounded-lg px-2.5 py-1 font-mono tabular-nums">
              实体参考 {config.physicalWidthMm} × {config.physicalHeightMm} mm
            </span>
            <Button variant="outline" size="sm" onClick={handleDownloadSvg}>
              <Code2 />
              导出 SVG
            </Button>
          </div>
        </div>

        {/* 主预览画布 / 图片盖章舞台 */}
        {backdrop !== 'custom' ? (
          <div
            className={cn(
              'glass shadow-soft relative flex min-h-[420px] flex-col items-center justify-center overflow-hidden rounded-2xl p-6 sm:min-h-[540px] sm:p-10',
              backdrop === 'checker' && 'checkerboard',
            )}
            style={
              backdrop === 'paper'
                ? {
                    backgroundColor: '#f5efe2',
                    backgroundImage:
                      'radial-gradient(rgba(138, 108, 66, 0.08) 1px, transparent 0), radial-gradient(rgba(138, 108, 66, 0.05) 1px, transparent 0)',
                    backgroundSize: '22px 22px',
                    backgroundPosition: '0 0, 11px 11px',
                  }
                : backdrop === 'contract'
                  ? {
                      backgroundColor: '#ffffff',
                    }
                  : undefined
            }
          >
            {/* 模拟合同背景落款排印 */}
            {backdrop === 'contract' && (
              <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-8 text-neutral-700 select-none sm:p-14">
                <div className="space-y-3 text-xs leading-relaxed text-neutral-400 sm:text-sm">
                  <div className="text-center text-base font-semibold tracking-widest text-neutral-700 sm:text-lg">
                    合作协议落款示例（正片叠底透字预览）
                  </div>
                  <p className="indent-6">
                    本协议一式两份，甲乙双方各执一份，自双方法定代表人或授权代表签字并加盖单位公章（或合同专用章）之日起生效，具有同等法律效力。
                  </p>
                  <p className="indent-6">
                    本页面底纹仅用于直观检查印章在白纸黑字上的透明度、做旧质感与视觉比例。
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-8 border-t border-dashed border-neutral-200 pt-8 text-sm text-neutral-700">
                  <div className="space-y-3">
                    <div className="font-medium">甲方（盖章）：{config.type === 'personal' ? '________' : config.mainText || '________'}</div>
                    <div>授权代表：张明远</div>
                    <div>日期：{getTodayDotDate().replace(/\./g, ' 年 ').replace(/ 年 (\d+)$/, ' 月 $1 日')}</div>
                  </div>
                  <div className="space-y-3">
                    <div className="font-medium">乙方（盖章）：轻匣创意工作室</div>
                    <div>授权代表：________</div>
                    <div>日期：{getTodayDotDate().replace(/\./g, ' 年 ').replace(/ 年 (\d+)$/, ' 月 $1 日')}</div>
                  </div>
                </div>
              </div>
            )}

            {/* 实时高清印章画布 */}
            <div className="relative z-10 flex flex-col items-center">
              <canvas
                ref={previewCanvasRef}
                style={{
                  width: 'min(100%, 420px)',
                  maxHeight: '420px',
                  aspectRatio: `${metrics.viewW} / ${metrics.viewH}`,
                  mixBlendMode: backdrop === 'contract' || backdrop === 'paper' ? 'multiply' : 'normal',
                }}
                className="h-auto object-contain drop-shadow-[0_6px_18px_rgba(0,0,0,0.06)] transition-transform duration-200"
              />
            </div>

            {/* 右下角轻提示 */}
            <div className="bg-card-solid/85 text-muted-foreground border-border/60 pointer-events-none absolute right-3 bottom-3 rounded-lg border px-2.5 py-1 text-[11px] backdrop-blur-sm">
              {backdrop === 'checker' && '透明通道实时预览（白文与做旧斑驳均为真镂空）'}
              {backdrop === 'paper' && '宣纸正片叠底预览 · 适合个人私章与书画篆刻'}
              {backdrop === 'contract' && '模拟合同白纸黑字 · 开启正片叠底真实透字'}
            </div>
          </div>
        ) : (
          /* 图片在线盖章模式 */
          <div className="glass shadow-soft space-y-4 rounded-2xl p-5">
            {!docImage ? (
              <FileDropzone
                accept={IMAGE_ACCEPT}
                multiple={false}
                onFiles={handleDocFiles}
                title="拖放或粘贴需要盖章的图片 / 合同截图"
                hint="支持 PNG / JPG / WebP / HEIC · 100% 本地合成，文件不上传服务器"
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="text-muted-foreground flex items-center gap-2">
                    <FileImage className="text-primary size-4" />
                    <span className="text-foreground max-w-[220px] truncate font-medium">{docImage.name}</span>
                    <span className="font-mono">
                      {docImage.width} × {docImage.height}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setDocImage((prev) => {
                          if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl)
                          return null
                        })
                      }
                    >
                      <Trash2 />
                      换一张图
                    </Button>
                    <Button variant="primary" size="sm" onClick={handleExportStampedDoc} disabled={busyExport}>
                      <Stamp />
                      导出盖章成品图
                    </Button>
                  </div>
                </div>

                {/* 可交互拖拽盖章画布 */}
                <div className="bg-foreground/[0.04] flex justify-center overflow-hidden rounded-xl border p-3">
                  <div
                    ref={stampStageRef}
                    className="relative inline-block max-w-full cursor-crosshair select-none touch-none"
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId)
                      setDraggingStamp(true)
                      updateStampPositionFromPointer(e.clientX, e.clientY)
                    }}
                    onPointerMove={(e) => {
                      if (!draggingStamp) return
                      updateStampPositionFromPointer(e.clientX, e.clientY)
                    }}
                    onPointerUp={(e) => {
                      if (draggingStamp) {
                        e.currentTarget.releasePointerCapture(e.pointerId)
                        setDraggingStamp(false)
                      }
                    }}
                  >
                    <img
                      src={docImage.previewUrl}
                      alt="待盖章文档"
                      draggable={false}
                      className="block max-h-[480px] max-w-full rounded-lg object-contain"
                    />
                    {sealDataUrl && (
                      <img
                        src={sealDataUrl}
                        alt="印章浮层"
                        draggable={false}
                        style={{
                          left: `${stampOverlay.normX * 100}%`,
                          top: `${stampOverlay.normY * 100}%`,
                          width: `${stampOverlay.widthRatio * 100}%`,
                          opacity: stampOverlay.opacity,
                          mixBlendMode: stampOverlay.multiply ? 'multiply' : 'normal',
                          transform: 'translate(-50%, -50%)',
                        }}
                        className={cn(
                          'pointer-events-none absolute h-auto select-none',
                          draggingStamp && 'ring-primary/50 rounded-lg ring-2 ring-dashed',
                        )}
                      />
                    )}
                  </div>
                </div>

                {/* 盖章微调栏 */}
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="印章占比" value={`${Math.round(stampOverlay.widthRatio * 100)}%`}>
                    <Slider
                      value={Math.round(stampOverlay.widthRatio * 100)}
                      onChange={(v) => setStampOverlay((p) => ({ ...p, widthRatio: v / 100 }))}
                      min={6}
                      max={65}
                      step={1}
                    />
                  </Field>
                  <Field label="印泥不透明度" value={`${Math.round(stampOverlay.opacity * 100)}%`}>
                    <Slider
                      value={Math.round(stampOverlay.opacity * 100)}
                      onChange={(v) => setStampOverlay((p) => ({ ...p, opacity: v / 100 }))}
                      min={40}
                      max={100}
                      step={1}
                    />
                  </Field>
                  <div className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2 text-xs">
                    <span className="text-foreground/80 flex items-center gap-1.5 font-medium">
                      <Move className="size-3.5" />
                      正片叠底（透字）
                    </span>
                    <Switch
                      checked={stampOverlay.multiply}
                      onChange={(v) => setStampOverlay((p) => ({ ...p, multiply: v }))}
                      label="正片叠底"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* 快捷操作与使用贴士卡片 */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="glass flex items-start gap-2.5 rounded-2xl p-3.5 text-xs">
            <Info className="text-primary mt-0.5 size-4 shrink-0" />
            <div className="text-muted-foreground space-y-1 leading-relaxed">
              <div className="text-foreground font-medium">实用小技巧</div>
              <p>
                点击「复制图片」可直接粘贴到 Word / WPS（建议设置文字环绕为「浮于文字上方」）；若需篆书、金文或手写书法印章，可在左侧导入本机{' '}
                <code>.ttf / .otf</code> 字体文件，纯离线秒生效。
              </p>
            </div>
          </div>

          <div className="glass flex items-start gap-2.5 rounded-2xl p-3.5 text-xs">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div className="text-muted-foreground space-y-1 leading-relaxed">
              <div className="text-foreground font-medium">隐私与合规提示</div>
              <p>
                所有印章绘制与图片盖章均在本地浏览器完成，不上传任何文字或文件。生成结果仅供设计演示、个人书画印签与内部测试模拟，请勿用于伪造企事业单位或国家机关合法印章。
              </p>
            </div>
          </div>
        </div>
      </div>
    </ToolShell>
  )
}
