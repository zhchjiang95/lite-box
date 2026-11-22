import { AnimatePresence, motion } from 'motion/react'
import {
  Copy,
  Download,
  ImagePlus,
  Layout,
  Loader2,
  Palette,
  Pipette,
  RotateCcw,
  Shuffle,
  Sparkles,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Slider } from '@/components/ui/slider'
import { ColorPicker, Field, Switch } from '@/components/ui/field'
import { copyImageToClipboard, downloadBlob } from '@/lib/file'
import { IMAGE_ACCEPT, decodeImageFile, isImageLike } from '@/lib/image'
import { cn, formatBytes } from '@/lib/utils'
import {
  computeBeautifyDimensions,
  createDemoScreenshot,
  exportBeautifyBlob,
  renderBeautifyCanvas,
  sampleEdgeColor,
} from './engine'
import {
  ASPECT_OPTIONS,
  FORMAT_EXT,
  FRAME_OPTIONS,
  GRADIENT_PRESETS,
  defaultBeautifyOptions,
  type BeautifyOptions,
  type BgMode,
  type ExportFormat,
} from './types'

interface SourceShot {
  name: string
  bitmap: ImageBitmap
  width: number
  height: number
  edgeColor: string
}

const PREVIEW_MAX_SIDE = 1600

export default function ScreenshotBeautify() {
  const [shot, setShot] = useState<SourceShot | null>(null)
  const [opts, setOpts] = useState<BeautifyOptions>(defaultBeautifyOptions)
  const [exporting, setExporting] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const shotRef = useRef(shot)
  shotRef.current = shot

  const set = <K extends keyof BeautifyOptions>(k: K, v: BeautifyOptions[K]) =>
    setOpts((prev) => ({ ...prev, [k]: v }))

  useEffect(
    () => () => {
      shotRef.current?.bitmap.close()
    },
    [],
  )

  const loadFiles = useCallback(async (files: File[]) => {
    const file = files.find(isImageLike)
    if (!file) {
      toast.error('请选择有效的图片文件')
      return
    }
    try {
      const decoded = await decodeImageFile(file)
      URL.revokeObjectURL(decoded.previewUrl)
      shotRef.current?.bitmap.close()
      const edgeColor = sampleEdgeColor(decoded.bitmap)
      setShot({
        name: file.name || '截图',
        bitmap: decoded.bitmap,
        width: decoded.width,
        height: decoded.height,
        edgeColor,
      })
      setOpts((prev) => ({ ...prev, insetColor: edgeColor }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '无法解析该图片')
    }
  }, [])

  const loadDemo = async () => {
    const demo = await createDemoScreenshot()
    shotRef.current?.bitmap.close()
    const edgeColor = sampleEdgeColor(demo.bitmap)
    setShot({
      name: demo.name,
      bitmap: demo.bitmap,
      width: demo.bitmap.width,
      height: demo.bitmap.height,
      edgeColor,
    })
    setOpts((prev) => ({ ...prev, insetColor: edgeColor }))
  }

  // 载入后支持随时 Ctrl/⌘ + V 直接粘贴新截图替换
  useEffect(() => {
    if (!shot) return
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement
      if (/INPUT|TEXTAREA/.test(el.tagName) || el.isContentEditable) return
      const img = Array.from(e.clipboardData?.files ?? []).find(isImageLike)
      if (img) {
        e.preventDefault()
        void loadFiles([img])
        toast.success('已载入剪贴板新截图')
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [shot, loadFiles])

  const dims = useMemo(
    () => (shot ? computeBeautifyDimensions(shot.width, shot.height, opts) : null),
    [shot, opts],
  )

  // 实时渲染预览画布
  useEffect(() => {
    if (!shot || !dims || !canvasRef.current) return
    const raf = requestAnimationFrame(() => {
      if (!canvasRef.current) return
      const scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(dims.outW, dims.outH))
      renderBeautifyCanvas(canvasRef.current, shot.bitmap, opts, scale)
    })
    return () => cancelAnimationFrame(raf)
  }, [shot, dims, opts])

  /** 随机切换一套渐变与角度 */
  const randomizeGradient = () => {
    const others = GRADIENT_PRESETS.filter((g) => g.id !== opts.gradientId)
    const pick = others[Math.floor(Math.random() * others.length)] ?? GRADIENT_PRESETS[0]
    setOpts((prev) => ({
      ...prev,
      bgMode: 'gradient',
      gradientId: pick.id,
      gradientAngle: pick.angle,
    }))
  }

  const onExport = async (mode: 'download' | 'copy') => {
    if (!shot) return
    setExporting(true)
    try {
      await new Promise((r) => setTimeout(r, 20))
      const { blob, width, height } = await exportBeautifyBlob(shot.bitmap, opts, mode === 'copy')
      if (mode === 'copy') {
        await copyImageToClipboard(blob)
        toast.success(`已复制美化截图到剪贴板 · ${width}×${height}`)
      } else {
        const base = shot.name.replace(/\.[^.]+$/, '') || 'beautify'
        downloadBlob(blob, `${base}-美化.${FORMAT_EXT[opts.format]}`)
        toast.success(`导出成功 · ${width}×${height} · ${formatBytes(blob.size)}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  // 空状态
  if (!shot || !dims) {
    return (
      <div className="space-y-6">
        <FileDropzone
          accept={IMAGE_ACCEPT}
          multiple={false}
          onFiles={loadFiles}
          title="拖放或 Ctrl / ⌘ + V 粘贴截图，3 秒生成宣传级美图"
          hint="支持自动套上 macOS 窗口栏、浏览器边框、极光渐变背景与三层柔和阴影"
        />
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadDemo}>
            <Sparkles className="text-primary" />
            没有截图？加载示例图体验一下
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: <Layout />, t: 'macOS & 浏览器套壳', d: '内置亮/暗窗口标题栏、地址栏与 VisionOS 玻璃外框' },
            { icon: <Palette />, t: '12 套精选弥散渐变', d: '可调渐变角度与磨砂胶片颗粒，支持透明底贴入 PPT' },
            { icon: <Copy />, t: '粘贴即美化，一键复制', d: '支持 2× 高清导出或直接复制粘贴到文档与社媒' },
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

  const showTitleInput =
    opts.frame === 'mac-light' ||
    opts.frame === 'mac-dark' ||
    opts.frame === 'browser-light' ||
    opts.frame === 'browser-dark'

  const finalOutW = Math.round(dims.outW * Math.min(opts.exportScale, 10000 / Math.max(dims.outW, dims.outH)))
  const finalOutH = Math.round(dims.outH * Math.min(opts.exportScale, 10000 / Math.max(dims.outW, dims.outH)))

  const panel = (
    <>
      {/* 窗口套壳风格 */}
      <Field label="窗口套壳">
        <div className="grid grid-cols-3 gap-1.5">
          {FRAME_OPTIONS.map((f) => {
            const active = opts.frame === f.id
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => set('frame', f.id)}
                className={cn(
                  'rounded-xl border py-2 text-xs font-medium transition-all active:scale-95',
                  active
                    ? 'border-primary bg-primary/10 text-primary font-semibold'
                    : 'bg-card-solid/50 text-foreground/80 hover:bg-foreground/[0.04]',
                )}
              >
                {f.label}
              </button>
            )
          })}
        </div>
      </Field>

      {showTitleInput && (
        <Field label={opts.frame.startsWith('browser') ? '地址栏网址' : '窗口标题'}>
          <input
            type="text"
            value={opts.windowTitle}
            onChange={(e) => set('windowTitle', e.target.value)}
            placeholder="留空则不显示文字…"
            className="bg-card-solid focus:ring-ring/50 h-9 w-full rounded-xl border px-3 text-xs outline-none focus:ring-2"
          />
        </Field>
      )}

      {/* 背景设置 */}
      <div className="space-y-4 border-t pt-4">
        <Field
          label="背景风格"
          value={
            opts.bgMode === 'gradient' && (
              <button
                type="button"
                onClick={randomizeGradient}
                className="text-primary flex items-center gap-1 hover:underline"
              >
                <Shuffle className="size-3" />
                随机渐变
              </button>
            )
          }
        >
          <Segmented<BgMode>
            size="sm"
            value={opts.bgMode}
            onChange={(v) => set('bgMode', v)}
            options={[
              { value: 'gradient', label: '渐变' },
              { value: 'solid', label: '纯色' },
              { value: 'transparent', label: '透明' },
            ]}
          />
        </Field>

        {opts.bgMode === 'gradient' && (
          <>
            <div className="grid grid-cols-6 gap-2">
              {GRADIENT_PRESETS.map((g) => {
                const active = opts.gradientId === g.id
                return (
                  <button
                    key={g.id}
                    type="button"
                    title={g.name}
                    onClick={() => setOpts((p) => ({ ...p, gradientId: g.id, gradientAngle: g.angle }))}
                    className={cn(
                      'h-8 rounded-lg border border-black/10 transition-transform hover:scale-110 dark:border-white/15',
                      active && 'ring-primary ring-offset-background ring-2 ring-offset-2',
                    )}
                    style={{ background: `linear-gradient(${g.angle}deg, ${g.colors.join(', ')})` }}
                  />
                )
              })}
            </div>
            <Field label="渐变角度" value={`${opts.gradientAngle}°`}>
              <Slider value={opts.gradientAngle} min={0} max={360} step={5} onChange={(v) => set('gradientAngle', v)} />
            </Field>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-foreground/80 text-sm font-medium">磨砂颗粒质感</div>
                <div className="text-muted-foreground text-xs">叠加微弱噪点，消除渐变色带</div>
              </div>
              <Switch checked={opts.noise} onChange={(v) => set('noise', v)} label="磨砂颗粒质感" />
            </div>
          </>
        )}

        {opts.bgMode === 'solid' && (
          <Field label="背景颜色" value={opts.solidColor}>
            <ColorPicker
              value={opts.solidColor}
              onChange={(v) => set('solidColor', v)}
              presets={['#ffffff', '#f1f5f9', '#0f172a', '#18181b', '#ede9fe', '#dbeafe', '#fce7f3', '#fef3c7']}
            />
          </Field>
        )}
      </div>

      {/* 比例、留白、圆角与阴影 */}
      <div className="space-y-4 border-t pt-4">
        <Field label="画幅比例">
          <div className="grid grid-cols-3 gap-1.5">
            {ASPECT_OPTIONS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => set('aspect', a.id)}
                className={cn(
                  'rounded-lg border py-1.5 font-mono text-xs transition-colors',
                  opts.aspect === a.id
                    ? 'border-primary bg-primary/10 text-primary font-semibold'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="外部留白" value={`${opts.paddingPct}%`}>
          <Slider value={opts.paddingPct} min={0} max={24} step={1} onChange={(v) => set('paddingPct', v)} />
        </Field>
        <Field label="窗口圆角" value={`${opts.radius}px`}>
          <Slider value={opts.radius} min={0} max={44} step={1} onChange={(v) => set('radius', v)} />
        </Field>
        <Field label="多层柔和阴影" value={`${opts.shadow}%`}>
          <Slider value={opts.shadow} min={0} max={100} step={2} onChange={(v) => set('shadow', v)} />
        </Field>
        <Field label="内衬留白" value={opts.inset === 0 ? '关闭' : `${opts.inset}px`}>
          <Slider value={opts.inset} min={0} max={48} step={2} onChange={(v) => set('inset', v)} />
        </Field>
        {opts.inset > 0 && (
          <Field
            label="内衬颜色"
            value={
              <button
                type="button"
                onClick={() => set('insetColor', shot.edgeColor)}
                className="text-primary flex items-center gap-1 hover:underline"
              >
                <Pipette className="size-3" />
                吸取截图边色
              </button>
            }
          >
            <ColorPicker
              value={opts.insetColor}
              onChange={(v) => set('insetColor', v)}
              presets={[shot.edgeColor, '#ffffff', '#11131a', '#1e1f26', '#f8fafc']}
            />
          </Field>
        )}
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
            <Slider value={opts.quality} min={60} max={100} onChange={(v) => set('quality', v)} />
          </Field>
        )}
        <Field label="输出分辨率" value={`${finalOutW} × ${finalOutH}`}>
          <Segmented
            size="sm"
            value={String(opts.exportScale)}
            onChange={(v) => set('exportScale', Number(v))}
            options={[
              { value: '1', label: '1× 标准' },
              { value: '2', label: '2× 高清' },
            ]}
          />
        </Field>
      </div>
    </>
  )

  const actions = (
    <>
      <Button
        variant="outline"
        size="lg"
        onClick={() => onExport('copy')}
        disabled={exporting}
        className="max-lg:!flex-none max-lg:px-4"
      >
        <Copy />
        <span className="max-sm:hidden">复制</span>
      </Button>
      <Button variant="primary" size="lg" onClick={() => onExport('download')} disabled={exporting}>
        {exporting ? <Loader2 className="animate-spin" /> : <Download />}
        {exporting ? '渲染中…' : '导出美图'}
      </Button>
    </>
  )

  return (
    <ToolShell panel={panel} actions={actions} panelTitle="美化样式">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="max-w-[200px] truncate font-medium sm:max-w-xs">{shot.name}</span>
          <span className="glass rounded-full px-2.5 py-1 font-mono tabular-nums">
            {finalOutW} × {finalOutH} px
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={randomizeGradient}>
              <Shuffle />
              换渐变
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpts({ ...defaultBeautifyOptions, insetColor: shot.edgeColor })}
            >
              <RotateCcw />
              重置
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
                  if (f?.length) void loadFiles(Array.from(f))
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        </div>

        <div className="checkerboard shadow-soft relative flex h-[min(68dvh,700px)] min-h-[320px] w-full items-center justify-center overflow-hidden rounded-3xl border p-4 sm:p-6">
          <canvas
            ref={canvasRef}
            className="shadow-lift max-h-full max-w-full rounded-xl object-contain"
            style={{ width: 'auto', height: 'auto' }}
          />
          <AnimatePresence>
            {exporting && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="bg-background/45 absolute inset-0 flex items-center justify-center backdrop-blur-[2px]"
              >
                <Loader2 className="text-primary size-8 animate-spin" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="text-muted-foreground text-center text-xs">
          随时可直接按 Ctrl / ⌘ + V 粘贴新截图实时替换，无需反复选文件
        </p>
      </div>
    </ToolShell>
  )
}
