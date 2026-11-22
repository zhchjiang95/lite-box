import { motion } from 'motion/react'
import {
  Archive,
  Check,
  Code2,
  Copy,
  Download,
  FileJson,
  Globe,
  Image as ImageIcon,
  Loader2,
  Smartphone,
  Type,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Slider } from '@/components/ui/slider'
import { ColorPicker, Field } from '@/components/ui/field'
import { downloadBlob } from '@/lib/file'
import { IMAGE_ACCEPT, decodeImageFile, isImageLike } from '@/lib/image'
import { cn, formatBytes } from '@/lib/utils'
import {
  buildHtmlSnippet,
  buildManifestJson,
  drawFaviconCanvas,
  exportFaviconPackageZip,
  renderFaviconIco,
  renderFaviconPng,
} from './engine'
import {
  ICON_GRADIENTS,
  PNG_SPECS,
  defaultFaviconOptions,
  type BgStyle,
  type FaviconOptions,
  type ImageFit,
  type SourceMode,
} from './types'

const RADIUS_PRESETS = [
  { label: '直角', val: 0 },
  { label: '圆角', val: 22 },
  { label: '圆形', val: 50 },
]

export default function FaviconGenerator() {
  const [opts, setOpts] = useState<FaviconOptions>(defaultFaviconOptions)
  const [uploaded, setUploaded] = useState<{ name: string; bitmap: ImageBitmap } | null>(null)
  const [previewDataUrl, setPreviewDataUrl] = useState<string>('')
  const [codeTab, setCodeTab] = useState<'html' | 'manifest'>('html')
  const [copiedCode, setCopiedCode] = useState(false)
  const [exporting, setExporting] = useState(false)

  const uploadedRef = useRef(uploaded)
  uploadedRef.current = uploaded

  const set = <K extends keyof FaviconOptions>(k: K, v: FaviconOptions[K]) =>
    setOpts((prev) => ({ ...prev, [k]: v }))

  useEffect(
    () => () => {
      uploadedRef.current?.bitmap.close()
    },
    [],
  )

  const loadImageFile = useCallback(async (file: File) => {
    if (!isImageLike(file)) {
      toast.error('请选择有效的图片文件')
      return
    }
    try {
      const decoded = await decodeImageFile(file)
      URL.revokeObjectURL(decoded.previewUrl)
      uploadedRef.current?.bitmap.close()
      setUploaded({ name: file.name || 'logo.png', bitmap: decoded.bitmap })
      setOpts((prev) => ({
        ...prev,
        sourceMode: 'image',
        bgStyle: 'transparent',
        paddingPct: 0,
      }))
      toast.success(`已载入 ${file.name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '无法解析图片')
    }
  }, [])

  // 支持全局 Ctrl/⌘ + V 粘贴图片直接作为图标源
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement
      if (/INPUT|TEXTAREA/.test(el.tagName) || el.isContentEditable) return
      const img = Array.from(e.clipboardData?.files ?? []).find(isImageLike)
      if (img) {
        e.preventDefault()
        void loadImageFile(img)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [loadImageFile])

  // 实时渲染一份 256px 高清预览图供所有预览位复用（毫秒级，零闪烁）
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const canvas = document.createElement('canvas')
      drawFaviconCanvas(canvas, 256, opts, uploaded?.bitmap ?? null)
      setPreviewDataUrl(canvas.toDataURL('image/png'))
      canvas.width = 0
      canvas.height = 0
    })
    return () => cancelAnimationFrame(raf)
  }, [opts, uploaded])

  const htmlCode = useMemo(() => buildHtmlSnippet(opts), [opts])
  const manifestCode = useMemo(() => buildManifestJson(opts), [opts])

  const copyCode = async () => {
    const text = codeTab === 'html' ? htmlCode : manifestCode
    try {
      await navigator.clipboard.writeText(text)
      setCopiedCode(true)
      toast.success(codeTab === 'html' ? '已复制 HTML 引入代码' : '已复制 site.webmanifest')
      setTimeout(() => setCopiedCode(false), 1400)
    } catch {
      toast.error('复制失败')
    }
  }

  /** 单独下载 favicon.ico 或某个尺寸 PNG */
  const downloadSingle = async (filename: string, size?: number) => {
    try {
      const blob =
        filename === 'favicon.ico'
          ? await renderFaviconIco(opts, uploaded?.bitmap ?? null)
          : await renderFaviconPng(size ?? 192, opts, uploaded?.bitmap ?? null)
      downloadBlob(blob, filename)
      toast.success(`已保存 ${filename} · ${formatBytes(blob.size)}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成失败')
    }
  }

  /** 一键打包全套 ZIP */
  const onExportZip = async () => {
    setExporting(true)
    try {
      const zipBlob = await exportFaviconPackageZip(opts, uploaded?.bitmap ?? null)
      downloadBlob(zipBlob, 'favicon-package.zip')
      toast.success(`已生成全套 Favicon 压缩包（含 ICO、5 尺寸 PNG、Manifest 与 HTML）· ${formatBytes(zipBlob.size)}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打包失败')
    } finally {
      setExporting(false)
    }
  }

  const panel = (
    <>
      {/* 图标来源：图片 或 文字/Emoji */}
      <Field label="图标来源">
        <Segmented<SourceMode>
          size="sm"
          value={opts.sourceMode}
          onChange={(v) => set('sourceMode', v)}
          options={[
            { value: 'text', label: '文字 / Emoji', icon: <Type /> },
            { value: 'image', label: '上传图片', icon: <ImageIcon /> },
          ]}
        />
      </Field>

      {opts.sourceMode === 'image' ? (
        <div className="space-y-4">
          <Field label="源图片" value={uploaded?.name}>
            <label className="hover:border-primary/50 hover:text-primary text-muted-foreground flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed py-4 text-xs transition-colors">
              <Upload className="size-4" />
              <span>{uploaded ? '点击更换图片（也可 Ctrl/⌘ + V 粘贴）' : '选择 PNG / SVG / JPG / HEIC 图片'}</span>
              <input
                type="file"
                hidden
                accept={IMAGE_ACCEPT}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void loadImageFile(f)
                  e.target.value = ''
                }}
              />
            </label>
          </Field>
          <Field label="图片适配">
            <Segmented<ImageFit>
              size="sm"
              value={opts.imageFit}
              onChange={(v) => set('imageFit', v)}
              options={[
                { value: 'contain', label: '完整保留' },
                { value: 'cover', label: '裁切铺满' },
              ]}
            />
          </Field>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="文字或 Emoji" value="1–2 字最佳">
            <input
              type="text"
              maxLength={4}
              value={opts.text}
              onChange={(e) => set('text', e.target.value)}
              placeholder="如 轻 / ⚡ / A"
              className="bg-card-solid focus:ring-ring/50 h-10 w-full rounded-xl border px-3 text-base font-bold outline-none focus:ring-2"
            />
          </Field>
          <Field label="文字颜色" value={opts.textColor}>
            <ColorPicker
              value={opts.textColor}
              onChange={(v) => set('textColor', v)}
              presets={['#ffffff', '#111827', '#fde047', '#38bdf8', '#f472b6']}
            />
          </Field>
          <Field label="文字大小" value={`${opts.textScalePct}%`}>
            <Slider value={opts.textScalePct} min={30} max={85} onChange={(v) => set('textScalePct', v)} />
          </Field>
        </div>
      )}

      {/* 背景、圆角与留白 */}
      <div className="space-y-4 border-t pt-4">
        <Field label="背景样式">
          <Segmented<BgStyle>
            size="sm"
            value={opts.bgStyle}
            onChange={(v) => set('bgStyle', v)}
            options={[
              { value: 'gradient', label: '渐变' },
              { value: 'solid', label: '纯色' },
              { value: 'transparent', label: '透明' },
            ]}
          />
        </Field>

        {opts.bgStyle === 'gradient' && (
          <div className="grid grid-cols-4 gap-2">
            {ICON_GRADIENTS.map((g) => (
              <button
                key={g.id}
                type="button"
                title={g.name}
                onClick={() => setOpts((p) => ({ ...p, gradientId: g.id, themeColor: g.from }))}
                className={cn(
                  'h-8 rounded-lg border border-black/10 transition-transform hover:scale-105 dark:border-white/15',
                  opts.gradientId === g.id && 'ring-primary ring-offset-background ring-2 ring-offset-2',
                )}
                style={{ background: `linear-gradient(135deg, ${g.from}, ${g.to})` }}
              />
            ))}
          </div>
        )}

        {opts.bgStyle === 'solid' && (
          <Field label="背景颜色" value={opts.bgColor}>
            <ColorPicker
              value={opts.bgColor}
              onChange={(v) => setOpts((p) => ({ ...p, bgColor: v, themeColor: v === 'transparent' ? p.themeColor : v }))}
              presets={['#6366f1', '#0ea5e9', '#10b981', '#f97316', '#ef4444', '#18181b', '#ffffff']}
            />
          </Field>
        )}

        <Field
          label="圆角"
          value={
            <span className="flex items-center gap-1.5">
              {RADIUS_PRESETS.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => set('radiusPct', r.val)}
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] transition-colors',
                    opts.radiusPct === r.val ? 'bg-primary/15 text-primary font-semibold' : 'hover:text-foreground',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </span>
          }
        >
          <Slider value={opts.radiusPct} min={0} max={50} onChange={(v) => set('radiusPct', v)} />
        </Field>

        <Field label="内容留白" value={`${opts.paddingPct}%`}>
          <Slider value={opts.paddingPct} min={0} max={30} onChange={(v) => set('paddingPct', v)} />
        </Field>
      </div>

      {/* 站点 Manifest 信息 */}
      <div className="space-y-3 border-t pt-4">
        <div className="text-foreground/80 text-sm font-medium">站点信息（Manifest & HTML）</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-muted-foreground text-[11px]">网站名称</span>
            <input
              type="text"
              value={opts.siteName}
              onChange={(e) => set('siteName', e.target.value)}
              className="bg-card-solid focus:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-xs outline-none focus:ring-2"
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-[11px]">图标路径前缀</span>
            <input
              type="text"
              value={opts.pathPrefix}
              onChange={(e) => set('pathPrefix', e.target.value)}
              placeholder="/"
              className="bg-card-solid focus:ring-ring/50 h-8 w-full rounded-lg border px-2.5 font-mono text-xs outline-none focus:ring-2"
            />
          </label>
        </div>
      </div>
    </>
  )

  const actions = (
    <>
      <Button
        variant="outline"
        size="lg"
        onClick={() => downloadSingle('favicon.ico')}
        disabled={exporting}
        className="max-lg:!flex-none max-lg:px-4"
      >
        <Download />
        <span className="max-sm:hidden">仅 ICO</span>
      </Button>
      <Button variant="primary" size="lg" onClick={onExportZip} disabled={exporting}>
        {exporting ? <Loader2 className="animate-spin" /> : <Archive />}
        {exporting ? '生成中…' : '下载全套 ZIP'}
      </Button>
    </>
  )

  return (
    <ToolShell panel={panel} actions={actions} panelTitle="图标样式">
      <div className="space-y-5">
        {/* 多端真实场景实时预览 */}
        <div className="grid gap-4 xl:grid-cols-[1fr_240px]">
          {/* 亮 / 暗双主题浏览器标签页模拟 */}
          <div className="glass shadow-soft space-y-3 rounded-3xl p-4 sm:p-5">
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
              <Globe className="size-3.5" />
              浏览器标签页预览（亮色 & 暗色对比）
            </div>

            {/* 浅色浏览器顶栏 */}
            <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 text-zinc-800 shadow-xs">
              <div className="flex items-end gap-2 px-3 pt-2.5">
                <div className="mb-2 flex gap-1.5">
                  <span className="size-2.5 rounded-full bg-[#ff5f57]" />
                  <span className="size-2.5 rounded-full bg-[#febc2e]" />
                  <span className="size-2.5 rounded-full bg-[#28c840]" />
                </div>
                <div className="flex max-w-[220px] items-center gap-2 rounded-t-xl bg-white px-3 py-2 text-xs font-medium shadow-xs">
                  {previewDataUrl && <img src={previewDataUrl} alt="" className="size-4 shrink-0" />}
                  <span className="truncate">{opts.siteName || '我的网站'}</span>
                </div>
                <div className="mb-2 text-[11px] text-zinc-400">+ 新标签页</div>
              </div>
              <div className="h-2 bg-white" />
            </div>

            {/* 暗色浏览器顶栏 */}
            <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 text-zinc-200 shadow-xs">
              <div className="flex items-end gap-2 px-3 pt-2.5">
                <div className="mb-2 flex gap-1.5">
                  <span className="size-2.5 rounded-full bg-[#ff5f57]" />
                  <span className="size-2.5 rounded-full bg-[#febc2e]" />
                  <span className="size-2.5 rounded-full bg-[#28c840]" />
                </div>
                <div className="flex max-w-[220px] items-center gap-2 rounded-t-xl bg-zinc-800 px-3 py-2 text-xs font-medium">
                  {previewDataUrl && <img src={previewDataUrl} alt="" className="size-4 shrink-0" />}
                  <span className="truncate">{opts.siteName || '我的网站'}</span>
                </div>
                <div className="mb-2 text-[11px] text-zinc-500">+ 新标签页</div>
              </div>
              <div className="h-2 bg-zinc-800" />
            </div>
          </div>

          {/* 手机主屏幕 App 图标预览 */}
          <div className="glass shadow-soft flex flex-col items-center justify-center gap-3 rounded-3xl p-5 text-center">
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
              <Smartphone className="size-3.5" />
              手机主屏幕预览
            </div>
            <div className="checkerboard flex size-24 items-center justify-center overflow-hidden rounded-[22%] border shadow-lg">
              {previewDataUrl && <img src={previewDataUrl} alt="桌面图标预览" className="size-full object-contain" />}
            </div>
            <span className="max-w-[140px] truncate text-xs font-medium">
              {opts.shortName || opts.siteName || 'App'}
            </span>
          </div>
        </div>

        {/* 全套产物清单（点击任意一项单独下载） */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground font-medium">将生成的全套文件（点击可单独下载）</span>
            <span className="text-muted-foreground font-mono">6 个图标 + 2 个配置文件</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {/* 多尺寸 ICO */}
            <motion.button
              type="button"
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => downloadSingle('favicon.ico')}
              className="bg-card hover:border-primary/40 group flex items-center gap-3 rounded-2xl border p-3 text-left backdrop-blur-xl transition-all"
            >
              <div className="checkerboard flex size-11 shrink-0 items-center justify-center rounded-xl border p-1.5">
                {previewDataUrl && <img src={previewDataUrl} alt="" className="size-full object-contain" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs font-bold">favicon.ico</div>
                <div className="text-muted-foreground text-[11px]">16 / 32 / 48 合并</div>
              </div>
              <Download className="text-muted-foreground group-hover:text-primary size-4 shrink-0 transition-colors" />
            </motion.button>

            {/* 5 张 PNG */}
            {PNG_SPECS.map((spec) => (
              <motion.button
                key={spec.filename}
                type="button"
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => downloadSingle(spec.filename, spec.size)}
                className="bg-card hover:border-primary/40 group flex items-center gap-3 rounded-2xl border p-3 text-left backdrop-blur-xl transition-all"
              >
                <div className="checkerboard flex size-11 shrink-0 items-center justify-center rounded-xl border p-1.5">
                  {previewDataUrl && (
                    <img
                      src={previewDataUrl}
                      alt=""
                      className="object-contain"
                      style={{
                        width: spec.size <= 16 ? 16 : spec.size <= 32 ? 24 : '100%',
                        height: spec.size <= 16 ? 16 : spec.size <= 32 ? 24 : '100%',
                      }}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs font-semibold">{spec.filename}</div>
                  <div className="text-muted-foreground text-[11px]">
                    {spec.label} · {spec.usage}
                  </div>
                </div>
                <Download className="text-muted-foreground group-hover:text-primary size-4 shrink-0 transition-colors" />
              </motion.button>
            ))}
          </div>
        </div>

        {/* HTML <head> 代码与 site.webmanifest 一键复制 */}
        <div className="glass shadow-soft overflow-hidden rounded-2xl">
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
            <div className="w-56">
              <Segmented<'html' | 'manifest'>
                size="sm"
                value={codeTab}
                onChange={setCodeTab}
                options={[
                  { value: 'html', label: 'HTML <head>', icon: <Code2 /> },
                  { value: 'manifest', label: 'Manifest', icon: <FileJson /> },
                ]}
              />
            </div>
            <Button variant="secondary" size="sm" className="ml-auto" onClick={copyCode}>
              {copiedCode ? <Check className="text-emerald-500" /> : <Copy />}
              {copiedCode ? '已复制' : '复制代码'}
            </Button>
          </div>
          <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-foreground/85">
            <code>{codeTab === 'html' ? htmlCode : manifestCode}</code>
          </pre>
        </div>
      </div>
    </ToolShell>
  )
}
