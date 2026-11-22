import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Camera,
  Copy,
  Download,
  ImagePlus,
  Loader2,
  Palette,
  RotateCcw,
  Sparkles,
  Type,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Slider } from '@/components/ui/slider'
import { Field, Switch } from '@/components/ui/field'
import { copyImageToClipboard, downloadBlob } from '@/lib/file'
import { IMAGE_ACCEPT, decodeImageFile, isImageLike } from '@/lib/image'
import { cn, formatBytes } from '@/lib/utils'
import { parseImageMetadata } from '@/tools/image-exif/parser'
import { extractPalette } from '@/tools/image-palette/color'
import { ensureArtFontsLoaded } from './fonts'
import { computeFrameLayout, createDemoPhoto, exportPhotoFrameBlob, renderPhotoFrame } from './engine'
import {
  ART_FONTS,
  BRAND_OPTIONS,
  FORMAT_EXT,
  FRAME_THEMES,
  SAMPLE_EXIFS,
  defaultFrameOptions,
  type ArtFontId,
  type BarPosition,
  type BrandBadgeId,
  type ExportFormat,
  type PhotoExifFields,
  type PhotoFrameOptions,
} from './types'

interface LoadedPhoto {
  name: string
  bitmap: ImageBitmap
  width: number
  height: number
  palette: string[]
}

const PREVIEW_MAX_SIDE = 1600

/** 将 EXIF 日期 "2026:11:22 14:30:05" 规整为 "2026.11.22" */
function normalizeDate(raw?: string): string {
  if (!raw) return ''
  const m = raw.match(/(\d{4})[:-](\d{2})[:-](\d{2})/)
  return m ? `${m[1]}.${m[2]}.${m[3]}` : raw.slice(0, 10)
}

export default function PhotoFrame() {
  const [photo, setPhoto] = useState<LoadedPhoto | null>(null)
  const [exif, setExif] = useState<PhotoExifFields>(SAMPLE_EXIFS[0].data)
  const [opts, setOpts] = useState<PhotoFrameOptions>(defaultFrameOptions)
  const [fontTick, setFontTick] = useState(0)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const photoRef = useRef(photo)
  photoRef.current = photo

  const set = <K extends keyof PhotoFrameOptions>(k: K, v: PhotoFrameOptions[K]) =>
    setOpts((prev) => ({ ...prev, [k]: v }))
  const setField = <K extends keyof PhotoExifFields>(k: K, v: PhotoExifFields[K]) =>
    setExif((prev) => ({ ...prev, [k]: v }))

  // 按需加载精选艺术字体，加载就绪后自动重绘 Canvas
  useEffect(() => {
    ensureArtFontsLoaded(() => setFontTick((t) => t + 1))
  }, [])

  useEffect(
    () => () => {
      photoRef.current?.bitmap.close()
    },
    [],
  )

  /** 载入摄影照片：同时解码图像（兼容 iPhone HEIC）、提取真实 EXIF 参数与主色调色点 */
  const loadPhotoFiles = useCallback(async (files: File[]) => {
    const file = files.find(isImageLike)
    if (!file) {
      toast.error('请选择有效的图片文件')
      return
    }
    setLoading(true)
    try {
      const [decoded, meta] = await Promise.all([decodeImageFile(file), parseImageMetadata(file)])
      URL.revokeObjectURL(decoded.previewUrl)
      photoRef.current?.bitmap.close()

      const palette = extractPalette(decoded.bitmap, 5).map((s) => s.hex)
      setPhoto({
        name: file.name || 'photo.jpg',
        bitmap: decoded.bitmap,
        width: decoded.width,
        height: decoded.height,
        palette,
      })

      // 自动回填解析到的真实 EXIF 参数（若无 EXIF 则保留友好占位可手动修改）
      const cam = meta.camera
      const hasRealExif = Boolean(cam.camera || cam.aperture || cam.shutter || cam.iso)
      if (hasRealExif) {
        setExif({
          camera: cam.camera ?? '',
          lens: cam.lens ?? '',
          focalLength: cam.focalLength?.split('（')[0] ?? '',
          aperture: cam.aperture ?? '',
          shutter: cam.shutter?.replace(/\s+s$/, 's') ?? '',
          iso: cam.iso ?? '',
          date: normalizeDate(cam.dateTime),
          caption: '',
          make: cam.camera ?? '',
        })
        toast.success('已自动读取照片 EXIF 拍摄设备与参数')
      } else {
        setExif((prev) => ({
          ...prev,
          date: normalizeDate(new Date().toISOString()),
        }))
        toast.info('该照片未含 EXIF 元数据，可在左侧自由编辑设备与参数')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '无法解析该照片')
    } finally {
      setLoading(false)
    }
  }, [])

  /** 载入内置摄影示范图 */
  const loadDemo = async () => {
    const bitmap = await createDemoPhoto()
    photoRef.current?.bitmap.close()
    const palette = extractPalette(bitmap, 5).map((s) => s.hex)
    setPhoto({
      name: 'sunset-ridge.jpg',
      bitmap,
      width: bitmap.width,
      height: bitmap.height,
      palette,
    })
    setExif(SAMPLE_EXIFS[0].data)
  }

  // 载入后支持随时 Ctrl/⌘ + V 粘贴换图
  useEffect(() => {
    if (!photo) return
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement
      if (/INPUT|TEXTAREA/.test(el.tagName) || el.isContentEditable) return
      const img = Array.from(e.clipboardData?.files ?? []).find(isImageLike)
      if (img) {
        e.preventDefault()
        void loadPhotoFiles([img])
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [photo, loadPhotoFiles])

  const layout = useMemo(
    () => (photo ? computeFrameLayout(photo.width, photo.height, opts) : null),
    [photo, opts],
  )

  // 实时渲染预览画布（含字体就绪重绘）
  useEffect(() => {
    if (!photo || !layout || !canvasRef.current) return
    void fontTick
    const raf = requestAnimationFrame(() => {
      if (!canvasRef.current) return
      const scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(layout.outW, layout.outH))
      renderPhotoFrame(canvasRef.current, photo.bitmap, exif, opts, photo.palette, scale)
    })
    return () => cancelAnimationFrame(raf)
  }, [photo, layout, exif, opts, fontTick])

  const onExport = async (mode: 'download' | 'copy') => {
    if (!photo) return
    setExporting(true)
    try {
      await new Promise((r) => setTimeout(r, 20))
      const { blob, width, height } = await exportPhotoFrameBlob(
        photo.bitmap,
        exif,
        opts,
        photo.palette,
        mode === 'copy',
      )
      if (mode === 'copy') {
        await copyImageToClipboard(blob)
        toast.success(`已复制作品分享图 · ${width}×${height}`)
      } else {
        const base = photo.name.replace(/\.[^.]+$/, '') || 'photo'
        downloadBlob(blob, `${base}-作品框.${FORMAT_EXT[opts.format]}`)
        toast.success(`导出成功 · ${width}×${height} · ${formatBytes(blob.size)}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  // 空状态
  if (!photo || !layout) {
    return (
      <div className="space-y-6">
        <FileDropzone
          accept={IMAGE_ACCEPT}
          multiple={false}
          onFiles={loadPhotoFiles}
          title={loading ? '正在解析照片与 EXIF 参数…' : '拖放摄影原图到这里，自动生成参数画框'}
          hint="支持 JPG / PNG / WebP / iPhone 15 HEIC，自动提取相机型号、镜头、光圈快门与主色调"
        />
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadDemo}>
            <Sparkles className="text-primary" />
            先加载示例摄影作品体验
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: <Camera />, t: '自动识别 EXIF 参数', d: '上传原图自动读取品牌、镜头、焦距光圈快门，也支持自由编辑' },
            { icon: <Type />, t: '上/下/左/右 + 6 套艺术字体', d: '四方向画框排版，覆盖画廊衬线、手写签名、电影宽字与胶片等宽' },
            { icon: <Palette />, t: '6 种风格 + 自动色点', d: '徕卡画廊白、暗夜黑、拍立得、弥散毛玻璃、35mm 胶片与主色点缀' },
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
      {/* 信息栏方位：上 / 下 / 左 / 右 */}
      <Field label="信息栏方位">
        <Segmented<BarPosition>
          size="sm"
          value={opts.position}
          onChange={(v) => set('position', v)}
          options={[
            { value: 'bottom', label: '下', icon: <ArrowDownToLine /> },
            { value: 'top', label: '上', icon: <ArrowUpToLine /> },
            { value: 'left', label: '左', icon: <ArrowLeftToLine /> },
            { value: 'right', label: '右', icon: <ArrowRightToLine /> },
          ]}
        />
      </Field>

      {/* 画框风格主题 */}
      <Field label="画框风格">
        <div className="grid grid-cols-2 gap-1.5">
          {FRAME_THEMES.map((t) => {
            const active = opts.theme === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => set('theme', t.id)}
                className={cn(
                  'flex flex-col items-start rounded-xl border px-2.5 py-2 text-left transition-all active:scale-[0.98]',
                  active
                    ? 'border-primary bg-primary/10 text-foreground shadow-soft'
                    : 'bg-card-solid/50 text-foreground/85 hover:bg-foreground/[0.04]',
                )}
              >
                <span className="text-xs font-semibold">{t.label}</span>
                <span className="text-muted-foreground mt-0.5 line-clamp-1 text-[10px]">{t.desc}</span>
              </button>
            )
          })}
        </div>
      </Field>

      {/* 艺术字体 */}
      <Field label="艺术字体">
        <div className="grid grid-cols-2 gap-1.5">
          {ART_FONTS.map((f) => {
            const active = opts.font === f.id
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => set('font', f.id as ArtFontId)}
                className={cn(
                  'flex flex-col items-start rounded-xl border px-2.5 py-2 text-left transition-all active:scale-[0.98]',
                  active
                    ? 'border-primary bg-primary/10 text-foreground shadow-soft'
                    : 'bg-card-solid/50 text-foreground/85 hover:bg-foreground/[0.04]',
                )}
              >
                <span
                  className={cn('text-sm font-semibold leading-tight', f.italic && 'italic')}
                  style={{ fontFamily: f.displayFamily }}
                >
                  {f.sample}
                </span>
                <span className="text-muted-foreground mt-0.5 text-[10px]">{f.label}</span>
              </button>
            )
          })}
        </div>
      </Field>

      {/* 拍摄设备与参数编辑 */}
      <div className="space-y-3 border-t pt-4">
        <div className="flex items-center justify-between">
          <span className="text-foreground/80 text-sm font-medium">设备与拍摄参数</span>
          <div className="flex items-center gap-1.5">
            {SAMPLE_EXIFS.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => setExif(s.data)}
                className="text-primary text-[10px] hover:underline"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <input
            type="text"
            value={exif.camera}
            onChange={(e) => setField('camera', e.target.value)}
            placeholder="相机型号（如 LEICA M11）"
            className="bg-card-solid focus:ring-ring/50 h-8.5 w-full rounded-lg border px-2.5 text-xs outline-none focus:ring-2"
          />
          <input
            type="text"
            value={exif.lens}
            onChange={(e) => setField('lens', e.target.value)}
            placeholder="镜头型号（可选）"
            className="bg-card-solid focus:ring-ring/50 h-8.5 w-full rounded-lg border px-2.5 text-xs outline-none focus:ring-2"
          />
          <div className="grid grid-cols-2 gap-1.5">
            <input
              type="text"
              value={exif.focalLength}
              onChange={(e) => setField('focalLength', e.target.value)}
              placeholder="焦距 50mm"
              className="bg-card-solid focus:ring-ring/50 h-8 rounded-lg border px-2.5 font-mono text-xs outline-none focus:ring-2"
            />
            <input
              type="text"
              value={exif.aperture}
              onChange={(e) => setField('aperture', e.target.value)}
              placeholder="光圈 f/1.8"
              className="bg-card-solid focus:ring-ring/50 h-8 rounded-lg border px-2.5 font-mono text-xs outline-none focus:ring-2"
            />
            <input
              type="text"
              value={exif.shutter}
              onChange={(e) => setField('shutter', e.target.value)}
              placeholder="快门 1/500s"
              className="bg-card-solid focus:ring-ring/50 h-8 rounded-lg border px-2.5 font-mono text-xs outline-none focus:ring-2"
            />
            <input
              type="text"
              value={exif.iso}
              onChange={(e) => setField('iso', e.target.value)}
              placeholder="ISO 100"
              className="bg-card-solid focus:ring-ring/50 h-8 rounded-lg border px-2.5 font-mono text-xs outline-none focus:ring-2"
            />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <input
              type="text"
              value={exif.caption}
              onChange={(e) => setField('caption', e.target.value)}
              placeholder="作品标题 / 地点签名"
              className="bg-card-solid focus:ring-ring/50 h-8 rounded-lg border px-2.5 text-xs outline-none focus:ring-2"
            />
            <input
              type="text"
              value={exif.date}
              onChange={(e) => setField('date', e.target.value)}
              placeholder="日期 2026.11.22"
              className="bg-card-solid focus:ring-ring/50 h-8 rounded-lg border px-2.5 font-mono text-xs outline-none focus:ring-2"
            />
          </div>
        </div>
      </div>

      {/* 品牌徽标与细部样式 */}
      <div className="space-y-4 border-t pt-4">
        <Field label="品牌徽标">
          <div className="flex flex-wrap gap-1.5">
            {BRAND_OPTIONS.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => set('brand', b.id as BrandBadgeId)}
                className={cn(
                  'rounded-lg border px-2 py-1 text-[11px] transition-colors',
                  opts.brand === b.id
                    ? 'border-primary bg-primary/10 text-primary font-semibold'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {b.label}
              </button>
            ))}
          </div>
        </Field>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-foreground/80 text-xs font-medium">自动主色调色点</span>
            <Switch checked={opts.showPaletteDots} onChange={(v) => set('showPaletteDots', v)} label="显示主色调色点" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-foreground/80 text-xs font-medium">显示镜头 / 日期</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => set('showLens', !opts.showLens)}
                className={cn(
                  'rounded-md border px-2 py-0.5 text-[11px]',
                  opts.showLens ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground',
                )}
              >
                镜头
              </button>
              <button
                type="button"
                onClick={() => set('showDate', !opts.showDate)}
                className={cn(
                  'rounded-md border px-2 py-0.5 text-[11px]',
                  opts.showDate ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground',
                )}
              >
                日期
              </button>
            </div>
          </div>
        </div>

        <Field label="信息栏厚度" value={`${opts.barSizePct}%`}>
          <Slider value={opts.barSizePct} min={10} max={24} step={1} onChange={(v) => set('barSizePct', v)} />
        </Field>
        {opts.theme !== 'overlay' && (
          <>
            <Field label="外框留白" value={`${opts.borderPct}%`}>
              <Slider value={opts.borderPct} min={0} max={12} step={0.5} onChange={(v) => set('borderPct', v)} />
            </Field>
            <Field label="照片圆角" value={`${opts.photoRadius}px`}>
              <Slider value={opts.photoRadius} min={0} max={36} step={1} onChange={(v) => set('photoRadius', v)} />
            </Field>
            <Field label="照片阴影" value={`${opts.photoShadow}%`}>
              <Slider value={opts.photoShadow} min={0} max={100} step={5} onChange={(v) => set('photoShadow', v)} />
            </Field>
          </>
        )}
        <Field label="字体缩放" value={`${Math.round(opts.fontScale * 100)}%`}>
          <Slider value={opts.fontScale} min={0.75} max={1.35} step={0.05} onChange={(v) => set('fontScale', v)} />
        </Field>
      </div>

      {/* 导出设置 */}
      <div className="space-y-4 border-t pt-4">
        <Field label="导出格式">
          <Segmented<ExportFormat>
            size="sm"
            value={opts.format}
            onChange={(v) => set('format', v)}
            options={[
              { value: 'jpeg', label: 'JPG' },
              { value: 'png', label: 'PNG' },
              { value: 'webp', label: 'WebP' },
            ]}
          />
        </Field>
        {opts.format !== 'png' && (
          <Field label="导出质量" value={`${opts.quality}%`}>
            <Slider value={opts.quality} min={60} max={100} onChange={(v) => set('quality', v)} />
          </Field>
        )}
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
        {exporting ? '渲染中…' : '导出作品图'}
      </Button>
    </>
  )

  return (
    <ToolShell panel={panel} actions={actions} panelTitle="画框与参数">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="max-w-[200px] truncate font-medium sm:max-w-xs">{photo.name}</span>
          <span className="glass rounded-full px-2.5 py-1 font-mono tabular-nums">
            {layout.outW} × {layout.outH} px
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setOpts(defaultFrameOptions)}>
              <RotateCcw />
              重置样式
            </Button>
            <label className="cursor-pointer">
              <span className="bg-muted hover:bg-foreground/10 inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors">
                <ImagePlus className="size-3.5" />
                换照片
              </span>
              <input
                type="file"
                hidden
                accept={IMAGE_ACCEPT}
                onChange={(e) => {
                  if (e.target.files?.length) void loadPhotoFiles(Array.from(e.target.files))
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        </div>

        <div className="checkerboard shadow-soft relative flex h-[min(70dvh,740px)] min-h-[340px] w-full items-center justify-center overflow-hidden rounded-3xl border p-4 sm:p-6">
          <canvas
            ref={canvasRef}
            className="shadow-lift max-h-full max-w-full rounded-sm object-contain"
            style={{ width: 'auto', height: 'auto' }}
          />
          <AnimatePresence>
            {(loading || exporting) && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="bg-background/45 absolute inset-0 flex items-center justify-center backdrop-blur-[2px]"
              >
                <div className="glass shadow-lift flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium">
                  <Loader2 className="text-primary size-4 animate-spin" />
                  {loading ? '正在解析照片与 EXIF…' : '正在全分辨率导出…'}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="text-muted-foreground text-center text-xs">
          支持随时 Ctrl / ⌘ + V 粘贴换图 · 艺术字体联网自动加载，离线自动优雅降级为系统字体
        </p>
      </div>
    </ToolShell>
  )
}
