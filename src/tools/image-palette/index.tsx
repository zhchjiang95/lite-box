import { AnimatePresence, motion } from 'motion/react'
import {
  Check,
  Code2,
  Copy,
  Download,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  Palette,
  Pipette,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Field } from '@/components/ui/field'
import { copyImageToClipboard, downloadBlob } from '@/lib/file'
import { IMAGE_ACCEPT, decodeImageFile, isImageLike } from '@/lib/image'
import { cn, uid } from '@/lib/utils'
import { LoupeCanvas } from './LoupeCanvas'
import {
  buildColorDetail,
  buildHarmonies,
  extractPalette,
  hexToRgb,
  renderPaletteCardBlob,
  type ColorDetail,
  type RGB,
  type Swatch,
} from './color'

interface LoadedImage {
  name: string
  bitmap: ImageBitmap
  width: number
  height: number
}

interface PickedRecord {
  id: string
  detail: ColorDetail
  nx: number
  ny: number
  x: number
  y: number
}

declare global {
  interface Window {
    EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> }
  }
}

const COUNT_OPTIONS = [
  { value: '5', label: '5 色' },
  { value: '6', label: '6 色' },
  { value: '8', label: '8 色' },
  { value: '10', label: '10 色' },
]

export default function ImagePalette() {
  const [image, setImage] = useState<LoadedImage | null>(null)
  const [paletteCount, setPaletteCount] = useState('6')
  const [swatches, setSwatches] = useState<Swatch[]>([])
  const [selectedColor, setSelectedColor] = useState<ColorDetail | null>(null)
  const [pickedList, setPickedList] = useState<PickedRecord[]>([])
  const [showPins, setShowPins] = useState(true)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [exportingCard, setExportingCard] = useState(false)

  const imageRef = useRef(image)
  imageRef.current = image
  const eyeDropperSupported = typeof window !== 'undefined' && 'EyeDropper' in window

  useEffect(
    () => () => {
      imageRef.current?.bitmap.close()
    },
    [],
  )

  const loadFile = useCallback(async (files: File[]) => {
    const file = files.find(isImageLike)
    if (!file) {
      toast.error('请选择有效的图片文件')
      return
    }
    try {
      const decoded = await decodeImageFile(file)
      // 取色页直接基于 ImageBitmap 渲染，释放多余的 previewUrl
      URL.revokeObjectURL(decoded.previewUrl)
      imageRef.current?.bitmap.close()
      setImage({
        name: file.name || '粘贴的图片',
        bitmap: decoded.bitmap,
        width: decoded.width,
        height: decoded.height,
      })
      setPickedList([])
      setSelectedColor(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '无法解析该图片文件')
    }
  }, [])

  // 图片载入或色数变更时，提取主色调
  useEffect(() => {
    if (!image) return
    const list = extractPalette(image.bitmap, Number(paletteCount))
    setSwatches(list)
    setSelectedColor((prev) => prev ?? list[0] ?? null)
  }, [image, paletteCount])

  // 已载入图片时支持随时 Ctrl/⌘ + V 粘贴换图
  useEffect(() => {
    if (!image) return
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement
      if (/INPUT|TEXTAREA/.test(el.tagName) || el.isContentEditable) return
      const img = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'))
      if (img) {
        e.preventDefault()
        void loadFile([img])
        toast.success('已载入剪贴板图片')
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [image, loadFile])

  const copyText = async (text: string, key: string, label?: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      toast.success(label ? `已复制 ${label}` : `已复制 ${text}`)
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1400)
    } catch {
      toast.error('复制失败，请检查剪贴板权限')
    }
  }

  /** 调用浏览器原生 EyeDropper 屏幕吸管 */
  const openEyeDropper = async () => {
    if (!window.EyeDropper) return
    try {
      const picker = new window.EyeDropper()
      const { sRGBHex } = await picker.open()
      const rgb = hexToRgb(sRGBHex)
      if (!rgb) return
      const detail = buildColorDetail(rgb)
      setSelectedColor(detail)
      void copyText(detail.hex, 'eyedropper', `屏幕色 ${detail.hex}`)
    } catch {
      // 用户按 Esc 取消吸管，静默忽略
    }
  }

  /** 在图片画布上点击像素采样 */
  const handleCanvasPick = useCallback((rgb: RGB, pos: { x: number; y: number; nx: number; ny: number }) => {
    const detail = buildColorDetail(rgb)
    setSelectedColor(detail)
    setPickedList((prev) => [{ id: uid(), detail, ...pos }, ...prev].slice(0, 12))
    navigator.clipboard?.writeText(detail.hex).catch(() => {})
    toast.success(`已取色 ${detail.hex}（已自动复制）`)
  }, [])

  /** 导出色板为 CSS Variables 或 JSON */
  const copyPaletteCode = (kind: 'css' | 'json') => {
    if (!swatches.length) return
    if (kind === 'css') {
      const css = `:root {\n${swatches.map((s, i) => `  --palette-${i + 1}: ${s.hex}; /* ${s.oklchStr} */`).join('\n')}\n}`
      void copyText(css, 'export-css', 'CSS 变量色板')
    } else {
      const json = JSON.stringify(
        swatches.map((s) => ({ hex: s.hex, rgb: s.rgbStr, hsl: s.hslStr, oklch: s.oklchStr, ratio: `${s.ratio}%` })),
        null,
        2,
      )
      void copyText(json, 'export-json', 'JSON 色板数据')
    }
  }

  /** 生成并导出/复制色卡海报图 */
  const exportPosterCard = async (mode: 'download' | 'copy') => {
    if (!image || !swatches.length) return
    setExportingCard(true)
    try {
      const blob = await renderPaletteCardBlob(image.bitmap, swatches, image.name)
      if (mode === 'copy') {
        await copyImageToClipboard(blob)
        toast.success('已复制高清色卡海报到剪贴板')
      } else {
        const base = image.name.replace(/\.[^.]+$/, '') || 'palette'
        downloadBlob(blob, `${base}-色卡.png`)
        toast.success('色卡海报已保存')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成色卡失败')
    } finally {
      setExportingCard(false)
    }
  }

  const harmonies = useMemo(() => (selectedColor ? buildHarmonies(selectedColor.rgb) : null), [selectedColor])

  // 空状态
  if (!image) {
    return (
      <div className="space-y-6">
        <FileDropzone
          accept={IMAGE_ACCEPT}
          multiple={false}
          onFiles={loadFile}
          title="拖放图片到这里取色与提取主色调"
          hint="支持任意图片或直接 Ctrl / ⌘ + V 粘贴截图，悬停开启 11×11 像素放大镜"
        />
        {eyeDropperSupported && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={openEyeDropper}>
              <Pipette />
              不传图，直接打开屏幕吸管取色
            </Button>
          </div>
        )}
        {selectedColor && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass shadow-soft mx-auto flex max-w-md items-center gap-3 rounded-2xl p-3.5"
          >
            <span className="size-11 shrink-0 rounded-xl border shadow-sm" style={{ background: selectedColor.hex }} />
            <div className="min-w-0 flex-1 font-mono text-xs">
              <div className="text-sm font-bold">{selectedColor.hex}</div>
              <div className="text-muted-foreground truncate">{selectedColor.oklchStr}</div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => copyText(selectedColor.hex, 'empty-hex')}>
              <Copy />
              复制
            </Button>
          </motion.div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: <Pipette />, t: '11×11 像素放大镜', d: '悬停精准锁定单个像素，点击自动复制 HEX 色值' },
            { icon: <Palette />, t: 'K-Means++ 主色提取', d: '自动聚类提取核心配色与占比，附带衍生和谐色' },
            { icon: <Sparkles />, t: '色卡海报与 CSS 导出', d: '一键复制 OKLCH/CSS 变量，或导出高清配色分享图' },
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

  const activeColor = selectedColor ?? swatches[0] ?? null

  const colorRows = activeColor
    ? [
        { key: 'hex', label: 'HEX', val: activeColor.hex },
        { key: 'rgb', label: 'RGB', val: activeColor.rgbStr },
        { key: 'hsl', label: 'HSL', val: activeColor.hslStr },
        { key: 'oklch', label: 'OKLCH', val: activeColor.oklchStr },
        { key: 'cmyk', label: 'CMYK', val: activeColor.cmykStr },
      ]
    : []

  const panel = (
    <>
      {/* 当前选中色详情卡片 */}
      {activeColor && (
        <div className="space-y-4">
          <div
            className="relative flex h-28 flex-col justify-between rounded-2xl border border-black/10 p-4 shadow-inner transition-colors duration-200 dark:border-white/10"
            style={{ background: activeColor.hex, color: activeColor.textOnColor }}
          >
            <div className="flex items-start justify-between">
              <span className="font-mono text-xl font-bold tracking-tight">{activeColor.hex}</span>
              <button
                type="button"
                onClick={() => copyText(activeColor.hex, 'hero-hex')}
                className="flex items-center gap-1 rounded-lg bg-black/15 px-2.5 py-1 text-xs font-medium backdrop-blur-sm transition-opacity hover:bg-black/25"
              >
                {copiedKey === 'hero-hex' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                复制
              </button>
            </div>
            <div className="flex items-center justify-between text-[11px] opacity-85">
              <span>
                配白字 {activeColor.contrastWhite}:1
                {activeColor.contrastWhite >= 4.5 ? ' (AA)' : ''}
              </span>
              <span>
                配黑字 {activeColor.contrastBlack}:1
                {activeColor.contrastBlack >= 4.5 ? ' (AA)' : ''}
              </span>
            </div>
          </div>

          {/* 5 种格式一键复制 */}
          <div className="space-y-1.5">
            {colorRows.map((row) => (
              <button
                key={row.key}
                type="button"
                onClick={() => copyText(row.val, row.key)}
                className="bg-card-solid/60 hover:bg-foreground/[0.06] group flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors"
              >
                <span className="text-muted-foreground w-12 shrink-0 font-mono text-[11px] font-semibold">
                  {row.label}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{row.val}</span>
                {copiedKey === row.key ? (
                  <Check className="size-3.5 shrink-0 text-emerald-500" />
                ) : (
                  <Copy className="text-muted-foreground size-3.5 shrink-0 opacity-50 transition-opacity group-hover:opacity-100" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 提取色数与屏幕吸管 */}
      <div className="space-y-4 border-t pt-4">
        <Field label="提取主色调数量">
          <Segmented size="sm" value={paletteCount} onChange={setPaletteCount} options={COUNT_OPTIONS} />
        </Field>

        {eyeDropperSupported && (
          <Button variant="outline" className="w-full" onClick={openEyeDropper}>
            <Pipette />
            屏幕全局吸管取色
          </Button>
        )}
      </div>

      {/* 衍生和谐配色方案 */}
      {harmonies && (
        <div className="space-y-3 border-t pt-4">
          <div className="text-foreground/80 text-sm font-medium">基于当前色的推荐配色</div>
          {[
            { label: '明暗色阶', list: harmonies.shades },
            { label: '类似色', list: harmonies.analogous },
            { label: '互补色', list: harmonies.complementary },
            { label: '三等分色', list: harmonies.triadic },
          ].map((g) => (
            <div key={g.label} className="space-y-1.5">
              <div className="text-muted-foreground text-[11px]">{g.label}</div>
              <div className="flex overflow-hidden rounded-xl border">
                {g.list.map((c, idx) => (
                  <button
                    key={`${g.label}-${idx}`}
                    type="button"
                    title={`${c.hex}（点击选中并复制）`}
                    onClick={() => {
                      setSelectedColor(c)
                      void copyText(c.hex, `${g.label}-${idx}`)
                    }}
                    className="group relative flex h-9 flex-1 items-center justify-center transition-all hover:flex-[1.35]"
                    style={{ background: c.hex, color: c.textOnColor }}
                  >
                    <span className="font-mono text-[10px] font-semibold opacity-0 transition-opacity group-hover:opacity-100">
                      {c.hex}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 导出代码 */}
      <div className="space-y-2 border-t pt-4">
        <div className="text-foreground/80 text-sm font-medium">导出色板代码</div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={() => copyPaletteCode('css')}>
            <Code2 />
            CSS 变量
          </Button>
          <Button variant="outline" size="sm" onClick={() => copyPaletteCode('json')}>
            <Copy />
            JSON 数据
          </Button>
        </div>
      </div>
    </>
  )

  const actions = (
    <>
      <Button
        variant="outline"
        size="lg"
        onClick={() => exportPosterCard('copy')}
        disabled={exportingCard || !swatches.length}
        className="max-lg:!flex-none max-lg:px-4"
      >
        <Copy />
        <span className="max-sm:hidden">复制色卡</span>
      </Button>
      <Button
        variant="primary"
        size="lg"
        onClick={() => exportPosterCard('download')}
        disabled={exportingCard || !swatches.length}
      >
        {exportingCard ? <Loader2 className="animate-spin" /> : <Download />}
        {exportingCard ? '生成中…' : '导出色卡海报'}
      </Button>
    </>
  )

  return (
    <ToolShell panel={panel} actions={actions} panelTitle="色值与配色方案">
      <div className="space-y-5">
        {/* 顶栏操作条 */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="max-w-[200px] truncate font-medium sm:max-w-sm">{image.name}</span>
          <span className="glass rounded-full px-2.5 py-1 font-mono tabular-nums">
            {image.width} × {image.height} px
          </span>
          <span className="text-muted-foreground hidden sm:inline">· 移动光标放大像素，点击即取色并复制</span>
          <div className="ml-auto flex items-center gap-1.5">
            {pickedList.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setShowPins((v) => !v)}>
                {showPins ? <Eye /> : <EyeOff />}
                {showPins ? '隐藏标记' : '显示标记'}
              </Button>
            )}
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
                  if (f?.length) void loadFile(Array.from(f))
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        </div>

        {/* 11×11 像素放大镜画布 */}
        <LoupeCanvas
          bitmap={image.bitmap}
          pins={pickedList.map((p) => ({ id: p.id, nx: p.nx, ny: p.ny, hex: p.detail.hex }))}
          showPins={showPins}
          onPick={handleCanvasPick}
        />

        {/* 自动提取的主色调调色板 */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
              <Palette className="size-3.5" />
              自动提取主色调（点击色块查看详情并复制 HEX）
            </span>
            <span className="text-muted-foreground">{swatches.length} 色</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 min-[480px]:grid-cols-3 sm:grid-cols-5 xl:grid-cols-6">
            {swatches.map((sw, i) => {
              const active = activeColor?.hex === sw.hex
              return (
                <motion.button
                  key={`${sw.hex}-${i}`}
                  type="button"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    setSelectedColor(sw)
                    void copyText(sw.hex, `sw-${sw.hex}`)
                  }}
                  className={cn(
                    'bg-card group flex flex-col overflow-hidden rounded-2xl border text-left transition-all',
                    active ? 'border-primary ring-primary/25 ring-2' : 'hover:border-foreground/25',
                  )}
                >
                  <div
                    className="relative flex h-16 w-full items-end justify-between p-2"
                    style={{ background: sw.hex, color: sw.textOnColor }}
                  >
                    <span className="rounded bg-black/15 px-1.5 py-0.5 font-mono text-[10px] backdrop-blur-xs">
                      {sw.ratio}%
                    </span>
                    {copiedKey === `sw-${sw.hex}` && <Check className="size-3.5" />}
                  </div>
                  <div className="px-2.5 py-2">
                    <div className="font-mono text-xs font-bold">{sw.hex}</div>
                    <div className="text-muted-foreground truncate font-mono text-[10px]">{sw.rgbStr}</div>
                  </div>
                </motion.button>
              )
            })}
          </div>
        </div>

        {/* 手动取色历史记录 */}
        <AnimatePresence>
          {pickedList.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-2.5"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground font-medium">最近手动取色（{pickedList.length}）</span>
                <button
                  type="button"
                  onClick={() => setPickedList([])}
                  className="text-muted-foreground hover:text-red-500 flex items-center gap-1 transition-colors"
                >
                  <Trash2 className="size-3.5" />
                  清空记录
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {pickedList.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedColor(item.detail)
                      void copyText(item.detail.hex, `pick-${item.id}`)
                    }}
                    className={cn(
                      'bg-card flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs transition-all hover:border-foreground/25',
                      activeColor?.hex === item.detail.hex && 'border-primary ring-primary/20 ring-2',
                    )}
                  >
                    <span
                      className="size-5 rounded-md border border-black/10 dark:border-white/15"
                      style={{ background: item.detail.hex }}
                    />
                    <span className="font-mono font-semibold">{item.detail.hex}</span>
                    <span className="text-muted-foreground font-mono text-[10px]">
                      ({item.x},{item.y})
                    </span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ToolShell>
  )
}
