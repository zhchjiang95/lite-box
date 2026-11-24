import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeftRight,
  Blend,
  Check,
  CheckCircle2,
  Copy,
  Dices,
  Download,
  Eye,
  Pipette,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { Slider } from '@/components/ui/slider'
import { canvasToBlob, downloadBlob, timestampName } from '@/lib/file'
import { cn, uid } from '@/lib/utils'
import {
  buildColorHarmonies,
  buildGradientCss,
  buildOklchScale,
  cmykToRgb,
  evaluateWcag,
  formatAllColorCodes,
  GRADIENT_PRESETS,
  hslToRgb,
  oklchToRgb,
  parseAnyColor,
  rgbaToHex,
  rgbToCmyk,
  rgbToHsl,
  rgbToOklch,
  suggestAccessibleForeground,
  type GradientConfig,
  type GradientInterpolation,
  type GradientType,
  type RGBA,
} from './engine'

type TabMode = 'convert' | 'contrast' | 'gradient'
type SliderSpace = 'oklch' | 'hsl' | 'rgb' | 'cmyk'

/** 浏览器原生 EyeDropper 宽松类型声明 */
interface EyeDropperCtor {
  new (): { open: () => Promise<{ sRGBHex: string }> }
}

const QUICK_SWATCHES = ['#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#8B5CF6', '#18181B']

export default function ColorConverterTool() {
  const [tab, setTab] = useState<TabMode>('convert')

  // ===== Tab 1：主色彩转换状态 =====
  const [rgba, setRgba] = useState<RGBA>({ r: 79, g: 70, b: 229, a: 1 })
  const [colorInput, setColorInput] = useState('#4F46E5')
  const [inputInvalid, setInputInvalid] = useState(false)
  const [sliderSpace, setSliderSpace] = useState<SliderSpace>('oklch')
  const [outOfGamut, setOutOfGamut] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // ===== Tab 2：WCAG 对比度状态 =====
  const [fgColor, setFgColor] = useState<RGBA>({ r: 255, g: 255, b: 255, a: 1 })
  const [bgColor, setBgColor] = useState<RGBA>({ r: 79, g: 70, b: 229, a: 1 })
  const [fgText, setFgText] = useState('#FFFFFF')
  const [bgText, setBgText] = useState('#4F46E5')

  // ===== Tab 3：CSS 渐变状态 =====
  const [grad, setGrad] = useState<GradientConfig>({
    type: 'linear',
    angle: 135,
    interpolation: 'oklch',
    stops: [
      { id: 's1', color: '#4f46e5', pos: 0 },
      { id: 's2', color: '#06b6d4', pos: 100 },
    ],
  })

  // 派生色彩空间数值
  const codes = useMemo(() => formatAllColorCodes(rgba), [rgba])
  const hsl = useMemo(() => rgbToHsl(rgba), [rgba])
  const oklch = useMemo(() => rgbToOklch(rgba), [rgba])
  const cmyk = useMemo(() => rgbToCmyk(rgba), [rgba])
  const scale11 = useMemo(() => buildOklchScale(rgba), [rgba])
  const harmonies = useMemo(() => buildColorHarmonies(rgba), [rgba])
  const wcag = useMemo(() => evaluateWcag(fgColor, bgColor), [fgColor, bgColor])
  const gradCss = useMemo(() => buildGradientCss(grad), [grad])

  const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window

  const copyText = async (text: string, key: string, label = '色值') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      toast.success(`已复制${label}：${text.length > 36 ? text.slice(0, 36) + '…' : text}`)
      setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500)
    } catch {
      toast.error('复制失败，请手动选中复制')
    }
  }

  /** 应用新的 RGBA 并同步输入框 */
  const applyRgba = (next: RGBA, syncText = true) => {
    setRgba(next)
    setOutOfGamut(false)
    setInputInvalid(false)
    if (syncText) setColorInput(rgbaToHex(next))
  }

  /** 处理任意格式色值输入 */
  const handleColorInputChange = (val: string) => {
    setColorInput(val)
    const parsed = parseAnyColor(val)
    if (parsed) {
      setRgba(parsed)
      setOutOfGamut(false)
      setInputInvalid(false)
    } else {
      setInputInvalid(val.trim().length > 0)
    }
  }

  /** 屏幕吸管取色 */
  const handleEyeDropper = async () => {
    const Ctor = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper
    if (!Ctor) {
      toast.info('当前浏览器不支持原生屏幕吸管（推荐使用 Chrome / Edge）')
      return
    }
    try {
      const res = await new Ctor().open()
      const parsed = parseAnyColor(res.sRGBHex)
      if (parsed) {
        applyRgba(parsed)
        toast.success(`吸管取色成功：${res.sRGBHex.toUpperCase()}`)
      }
    } catch {
      // 用户按 Esc 取消
    }
  }

  /** 随机灵感色 */
  const handleRandomColor = () => {
    const h = Math.round(Math.random() * 360)
    const l = 0.45 + Math.random() * 0.3
    const c = 0.12 + Math.random() * 0.14
    const rgb = oklchToRgb({ l, c, h })
    applyRgba({ r: rgb.r, g: rgb.g, b: rgb.b, a: 1 })
  }

  /** 一键复制 11 阶色板 CSS 变量 / Tailwind @theme */
  const handleCopyScaleVars = (format: 'css' | 'tailwind') => {
    const lines =
      format === 'css'
        ? [':root {', ...scale11.map((s) => `  --color-brand-${s.step}: ${s.oklch}; /* ${s.hex} */`), '}']
        : ['@theme {', ...scale11.map((s) => `  --color-brand-${s.step}: ${s.oklch};`), '}']
    copyText(lines.join('\n'), `scale-${format}`, format === 'css' ? 'CSS 变量色板' : 'Tailwind @theme 色板')
  }

  // WCAG 输入同步
  const updateFgFromText = (val: string) => {
    setFgText(val)
    const parsed = parseAnyColor(val)
    if (parsed) setFgColor(parsed)
  }

  const updateBgFromText = (val: string) => {
    setBgText(val)
    const parsed = parseAnyColor(val)
    if (parsed) setBgColor(parsed)
  }

  const swapContrastColors = () => {
    const nextFg = bgColor
    const nextBg = fgColor
    setFgColor(nextFg)
    setBgColor(nextBg)
    setFgText(rgbaToHex(nextFg))
    setBgText(rgbaToHex(nextBg))
  }

  const autoFixContrast = (target: 4.5 | 7.0) => {
    const fixed = suggestAccessibleForeground(fgColor, bgColor, target)
    if (!fixed) return
    setFgColor(fixed)
    setFgText(rgbaToHex(fixed))
    toast.success(`已保持原色相，自动微调文字亮度至 ${target === 7 ? 'AAA (7:1)' : 'AA (4.5:1)'} 达标`)
  }

  // 渐变导出高清 PNG（1600×900）
  const handleExportGradientPng = async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1600
    canvas.height = 900
    const ctx = canvas.getContext('2d')!
    const sorted = [...grad.stops].sort((a, b) => a.pos - b.pos)

    let fill: CanvasGradient
    if (grad.type === 'radial') {
      fill = ctx.createRadialGradient(800, 450, 0, 800, 450, 900)
    } else if (grad.type === 'conic' && typeof ctx.createConicGradient === 'function') {
      fill = ctx.createConicGradient(((grad.angle - 90) * Math.PI) / 180, 800, 450)
    } else {
      const rad = ((grad.angle - 90) * Math.PI) / 180
      const dx = Math.cos(rad) * 800
      const dy = Math.sin(rad) * 450
      fill = ctx.createLinearGradient(800 - dx, 450 - dy, 800 + dx, 450 + dy)
    }

    for (const s of sorted) {
      fill.addColorStop(Math.max(0, Math.min(1, s.pos / 100)), s.color)
    }
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, 1600, 900)
    const blob = await canvasToBlob(canvas, 'image/png')
    canvas.width = 0
    canvas.height = 0
    downloadBlob(blob, timestampName('gradient', 'png'))
    toast.success('已导出 1600×900 高清渐变 PNG')
  }

  const cssPreviewBg = `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${rgba.a})`

  return (
    <div className="space-y-5">
      {/* 顶部三视图切换 */}
      <Segmented<TabMode>
        value={tab}
        onChange={setTab}
        className="max-w-lg"
        options={[
          { value: 'convert', label: '色彩转换与色阶', icon: <Sparkles /> },
          { value: 'contrast', label: 'WCAG 对比度', icon: <Eye /> },
          { value: 'gradient', label: 'CSS 渐变生成', icon: <Blend /> },
        ]}
      />

      {/* ================= 视图一：色彩空间转换 + OKLCH 色阶 ================= */}
      {tab === 'convert' && (
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
            {/* 左卡：主色预览 + 任意格式输入 + 多通道实时滑块 */}
            <section className="glass shadow-soft space-y-5 rounded-2xl p-5">
              {/* 大色块预览 + 吸管/随机/原生拾色器 */}
              <div className="checkerboard relative h-32 overflow-hidden rounded-2xl border border-black/10 shadow-inner dark:border-white/10">
                <div className="size-full transition-colors duration-75" style={{ backgroundColor: cssPreviewBg }} />
                <div className="absolute right-3 bottom-3 left-3 flex items-center justify-between gap-2">
                  <span className="rounded-lg bg-black/55 px-2.5 py-1 font-mono text-xs font-semibold text-white backdrop-blur-md">
                    {rgba.a < 0.999 ? codes.hexAlpha : codes.hex}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <label
                      className="flex size-8 cursor-pointer items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur-md transition hover:bg-black/75"
                      title="打开系统拾色盘"
                    >
                      <span
                        className="size-4 rounded-full border border-white/70"
                        style={{ backgroundColor: codes.hex }}
                      />
                      <input
                        type="color"
                        value={codes.hex}
                        onChange={(e) => {
                          const p = parseAnyColor(e.target.value)
                          if (p) applyRgba({ ...p, a: rgba.a })
                        }}
                        className="sr-only"
                      />
                    </label>
                    {hasEyeDropper && (
                      <button
                        type="button"
                        onClick={handleEyeDropper}
                        className="flex size-8 items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur-md transition hover:bg-black/75"
                        title="屏幕吸管取色"
                      >
                        <Pipette className="size-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleRandomColor}
                      className="flex size-8 items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur-md transition hover:bg-black/75"
                      title="随机灵感色"
                    >
                      <Dices className="size-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* 任意格式智能色值输入 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">任意格式色值输入</span>
                  <span className="text-muted-foreground">支持 HEX / RGB / HSL / OKLCH / CMYK</span>
                </div>
                <input
                  type="text"
                  value={colorInput}
                  onChange={(e) => handleColorInputChange(e.target.value)}
                  placeholder="例如 #4f46e5、oklch(55% 0.24 260)、rgb(79,70,229)"
                  className={cn(
                    'bg-background/60 w-full rounded-xl border px-3 py-2 font-mono text-sm outline-none transition focus:ring-2',
                    inputInvalid
                      ? 'border-rose-500 focus:ring-rose-500/20'
                      : 'border-border/70 focus:border-primary focus:ring-primary/20',
                  )}
                />
                {inputInvalid && (
                  <p className="text-[11px] text-rose-500">无法识别此色值格式，请检查语法</p>
                )}
              </div>

              {/* 快捷灵感色块 */}
              <div className="flex flex-wrap items-center gap-2">
                {QUICK_SWATCHES.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => {
                      const p = parseAnyColor(hex)
                      if (p) applyRgba({ ...p, a: rgba.a })
                    }}
                    className={cn(
                      'size-6.5 rounded-lg border border-black/15 transition-transform hover:scale-110 dark:border-white/15',
                      codes.hex === hex && 'ring-primary ring-offset-background ring-2 ring-offset-2',
                    )}
                    style={{ backgroundColor: hex }}
                    title={hex}
                  />
                ))}
              </div>

              {/* 多色彩空间交互滑块 */}
              <div className="space-y-3.5 border-t pt-4">
                <Segmented<SliderSpace>
                  size="sm"
                  value={sliderSpace}
                  onChange={setSliderSpace}
                  options={[
                    { value: 'oklch', label: 'OKLCH' },
                    { value: 'hsl', label: 'HSL' },
                    { value: 'rgb', label: 'RGB' },
                    { value: 'cmyk', label: 'CMYK' },
                  ]}
                />

                {sliderSpace === 'oklch' && (
                  <div className="space-y-3">
                    <Field label="明度 L" value={`${(oklch.l * 100).toFixed(1)}%`}>
                      <Slider
                        value={Math.round(oklch.l * 1000)}
                        min={0}
                        max={1000}
                        onChange={(v) => {
                          const res = oklchToRgb({ l: v / 1000, c: oklch.c, h: oklch.h })
                          setOutOfGamut(res.outOfGamut)
                          setRgba({ r: res.r, g: res.g, b: res.b, a: rgba.a })
                          setColorInput(rgbaToHex({ r: res.r, g: res.g, b: res.b, a: rgba.a }))
                        }}
                      />
                    </Field>
                    <Field label="色度 C" value={oklch.c.toFixed(3)}>
                      <Slider
                        value={Math.round(oklch.c * 1000)}
                        min={0}
                        max={370}
                        onChange={(v) => {
                          const res = oklchToRgb({ l: oklch.l, c: v / 1000, h: oklch.h })
                          setOutOfGamut(res.outOfGamut)
                          setRgba({ r: res.r, g: res.g, b: res.b, a: rgba.a })
                          setColorInput(rgbaToHex({ r: res.r, g: res.g, b: res.b, a: rgba.a }))
                        }}
                      />
                    </Field>
                    <Field label="色相 H" value={`${oklch.h.toFixed(1)}°`}>
                      <Slider
                        value={Math.round(oklch.h)}
                        min={0}
                        max={360}
                        onChange={(v) => {
                          const res = oklchToRgb({ l: oklch.l, c: oklch.c, h: v })
                          setOutOfGamut(res.outOfGamut)
                          setRgba({ r: res.r, g: res.g, b: res.b, a: rgba.a })
                          setColorInput(rgbaToHex({ r: res.r, g: res.g, b: res.b, a: rgba.a }))
                        }}
                      />
                    </Field>
                    {outOfGamut && (
                      <div className="flex items-center gap-1.5 rounded-xl bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="size-3.5 shrink-0" />
                        <span>当前 OKLCH 色度超出 sRGB 色域，已映射至最接近的 sRGB 数值</span>
                      </div>
                    )}
                  </div>
                )}

                {sliderSpace === 'hsl' && (
                  <div className="space-y-3">
                    <Field label="色相 H" value={`${hsl.h}°`}>
                      <Slider
                        value={hsl.h}
                        min={0}
                        max={360}
                        onChange={(v) => applyRgba({ ...hslToRgb({ ...hsl, h: v }), a: rgba.a })}
                      />
                    </Field>
                    <Field label="饱和度 S" value={`${hsl.s}%`}>
                      <Slider
                        value={hsl.s}
                        min={0}
                        max={100}
                        onChange={(v) => applyRgba({ ...hslToRgb({ ...hsl, s: v }), a: rgba.a })}
                      />
                    </Field>
                    <Field label="亮度 L" value={`${hsl.l}%`}>
                      <Slider
                        value={hsl.l}
                        min={0}
                        max={100}
                        onChange={(v) => applyRgba({ ...hslToRgb({ ...hsl, l: v }), a: rgba.a })}
                      />
                    </Field>
                  </div>
                )}

                {sliderSpace === 'rgb' && (
                  <div className="space-y-3">
                    <Field label="红 R" value={rgba.r}>
                      <Slider value={rgba.r} min={0} max={255} onChange={(v) => applyRgba({ ...rgba, r: v })} />
                    </Field>
                    <Field label="绿 G" value={rgba.g}>
                      <Slider value={rgba.g} min={0} max={255} onChange={(v) => applyRgba({ ...rgba, g: v })} />
                    </Field>
                    <Field label="蓝 B" value={rgba.b}>
                      <Slider value={rgba.b} min={0} max={255} onChange={(v) => applyRgba({ ...rgba, b: v })} />
                    </Field>
                  </div>
                )}

                {sliderSpace === 'cmyk' && (
                  <div className="space-y-3">
                    {(
                      [
                        ['青 C', 'c'],
                        ['品红 M', 'm'],
                        ['黄 Y', 'y'],
                        ['黑 K', 'k'],
                      ] as const
                    ).map(([label, key]) => (
                      <Field key={key} label={label} value={`${cmyk[key]}%`}>
                        <Slider
                          value={cmyk[key]}
                          min={0}
                          max={100}
                          onChange={(v) => applyRgba({ ...cmykToRgb({ ...cmyk, [key]: v }), a: rgba.a })}
                        />
                      </Field>
                    ))}
                  </div>
                )}

                <Field label="透明度 Alpha" value={`${Math.round(rgba.a * 100)}%`}>
                  <Slider
                    value={Math.round(rgba.a * 100)}
                    min={0}
                    max={100}
                    onChange={(v) => applyRgba({ ...rgba, a: v / 100 })}
                  />
                </Field>
              </div>
            </section>

            {/* 右卡：全格式复制矩阵 + 11 阶 OKLCH 色板 + 和谐配色 */}
            <div className="space-y-5">
              {/* 全格式色值输出矩阵 */}
              <section className="glass shadow-soft space-y-3 rounded-2xl p-5">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">全色彩空间实时互转（点击即复制）</div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setBgColor({ ...rgba, a: 1 })
                      setBgText(codes.hex)
                      setTab('contrast')
                    }}
                  >
                    <Eye className="!size-3.5" />
                    用此色测对比度
                  </Button>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-2">
                  {[
                    { key: 'hex', label: 'HEX', val: rgba.a < 0.999 ? codes.hexAlpha : codes.hex },
                    { key: 'oklch', label: 'OKLCH（现代 CSS）', val: codes.oklch },
                    { key: 'rgb', label: 'RGB / RGBA', val: codes.rgb },
                    { key: 'rgb4', label: 'CSS Color 4 RGB', val: codes.rgbCss4 },
                    { key: 'hsl', label: 'HSL / HSLA', val: codes.hsl },
                    { key: 'cmyk', label: 'CMYK（印刷四色）', val: codes.cmyk },
                    { key: 'hsv', label: 'HSV / HSB', val: codes.hsv },
                    { key: 'hex8', label: '8 位 HEX（含透明）', val: codes.hexAlpha },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => copyText(item.val, item.key, item.label)}
                      className="border-border/60 bg-background/50 hover:border-primary/50 hover:bg-primary/[0.04] group flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left transition"
                    >
                      <div className="min-w-0">
                        <div className="text-muted-foreground text-[11px]">{item.label}</div>
                        <div className="truncate font-mono text-xs font-semibold sm:text-sm">{item.val}</div>
                      </div>
                      {copiedKey === item.key ? (
                        <Check className="size-4 shrink-0 text-emerald-500" />
                      ) : (
                        <Copy className="text-muted-foreground group-hover:text-primary size-3.5 shrink-0 transition" />
                      )}
                    </button>
                  ))}
                </div>
              </section>

              {/* 11 阶 OKLCH 感知均匀色板 */}
              <section className="glass shadow-soft space-y-3 rounded-2xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">OKLCH 11 阶设计系统色板（50 – 950）</div>
                    <p className="text-muted-foreground text-[11px]">基于感知均匀亮度生成，点击色块直接复制 HEX</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => handleCopyScaleVars('css')}>
                      <Copy className="!size-3" />
                      CSS 变量
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs" onClick={() => handleCopyScaleVars('tailwind')}>
                      Tailwind v4
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-11 gap-1 sm:gap-1.5">
                  {scale11.map((s) => (
                    <button
                      key={s.step}
                      type="button"
                      onClick={() => copyText(s.hex, `scale-${s.step}`, `色阶 ${s.step}`)}
                      className="group flex flex-col items-center gap-1"
                      title={`${s.step} · ${s.hex}\n${s.oklch}\n点击复制 HEX`}
                    >
                      <div
                        className="flex h-12 w-full items-end justify-center rounded-lg border border-black/10 pb-1 text-[9px] font-mono font-bold transition-transform group-hover:-translate-y-0.5 sm:h-14 dark:border-white/10"
                        style={{ backgroundColor: s.hex, color: s.textColor }}
                      >
                        {s.step}
                      </div>
                      <span className="text-muted-foreground hidden font-mono text-[9px] sm:inline">
                        {s.hex.slice(1)}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              {/* 色彩和谐衍生方案 */}
              <section className="glass shadow-soft space-y-3 rounded-2xl p-5">
                <div className="text-sm font-semibold">OKLCH 和谐配色推荐（点击切为主色）</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {harmonies.map((h) => (
                    <div key={h.name} className="border-border/60 bg-background/40 space-y-2 rounded-xl border p-3">
                      <div className="text-muted-foreground text-xs font-medium">{h.name}</div>
                      <div className="flex gap-1.5">
                        {h.colors.map((hex, i) => (
                          <button
                            key={`${hex}-${i}`}
                            type="button"
                            onClick={() => {
                              const p = parseAnyColor(hex)
                              if (p) applyRgba(p)
                            }}
                            className="flex h-9 flex-1 items-center justify-center rounded-lg border border-black/10 font-mono text-[10px] font-semibold transition-transform hover:scale-[1.03] dark:border-white/10"
                            style={{
                              backgroundColor: hex,
                              color:
                                evaluateWcag({ r: 255, g: 255, b: 255, a: 1 }, parseAnyColor(hex) ?? rgba).ratio >= 4.5
                                  ? '#ffffff'
                                  : '#111827',
                            }}
                          >
                            {hex}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* ================= 视图二：WCAG 2.1 无障碍对比度检查 ================= */}
      {tab === 'contrast' && (
        <div className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
          {/* 左：前景色/背景色配置与智能自动修正 */}
          <section className="glass shadow-soft space-y-5 rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">文字与背景配色</div>
              <Button size="sm" variant="outline" onClick={swapContrastColors}>
                <ArrowLeftRight className="!size-3.5" />
                互换前景/背景
              </Button>
            </div>

            {/* 文字前景色 */}
            <Field label="前景色（文字 / 图标）">
              <div className="flex items-center gap-2">
                <label className="relative size-10 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-black/15">
                  <div className="size-full" style={{ backgroundColor: rgbaToHex(fgColor) }} />
                  <input
                    type="color"
                    value={rgbaToHex({ ...fgColor, a: 1 })}
                    onChange={(e) => updateFgFromText(e.target.value)}
                    className="sr-only"
                  />
                </label>
                <input
                  type="text"
                  value={fgText}
                  onChange={(e) => updateFgFromText(e.target.value)}
                  className="border-border/70 bg-background/60 focus:border-primary flex-1 rounded-xl border px-3 py-2 font-mono text-sm outline-none"
                />
              </div>
            </Field>

            {/* 背景色 */}
            <Field label="背景色（底板）">
              <div className="flex items-center gap-2">
                <label className="relative size-10 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-black/15">
                  <div className="size-full" style={{ backgroundColor: rgbaToHex(bgColor) }} />
                  <input
                    type="color"
                    value={rgbaToHex({ ...bgColor, a: 1 })}
                    onChange={(e) => updateBgFromText(e.target.value)}
                    className="sr-only"
                  />
                </label>
                <input
                  type="text"
                  value={bgText}
                  onChange={(e) => updateBgFromText(e.target.value)}
                  className="border-border/70 bg-background/60 focus:border-primary flex-1 rounded-xl border px-3 py-2 font-mono text-sm outline-none"
                />
              </div>
            </Field>

            {/* 对比度大字读数与一键达标修正 */}
            <div className="border-border/60 bg-foreground/[0.03] space-y-3 rounded-2xl border p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-muted-foreground text-xs">WCAG 2.1 对比度</span>
                <span
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-bold',
                    wcag.aaaNormal
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : wcag.aaNormal
                        ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                        : wcag.aaLarge
                          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          : 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
                  )}
                >
                  {wcag.grade}
                </span>
              </div>

              <div className="font-mono text-4xl font-bold tabular-nums">
                {wcag.ratio.toFixed(2)} <span className="text-muted-foreground text-lg font-normal">: 1</span>
              </div>

              {(!wcag.aaNormal || !wcag.aaaNormal) && (
                <div className="space-y-2 pt-1">
                  <div className="text-muted-foreground text-[11px]">保持色相不变，智能微调文字亮度至达标：</div>
                  <div className="flex gap-2">
                    {!wcag.aaNormal && (
                      <Button size="sm" variant="primary" className="flex-1 text-xs" onClick={() => autoFixContrast(4.5)}>
                        <Wand2 className="!size-3.5" />
                        自动修正至 AA (4.5:1)
                      </Button>
                    )}
                    {!wcag.aaaNormal && (
                      <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => autoFixContrast(7.0)}>
                        <Wand2 className="!size-3.5" />
                        修正至 AAA (7:1)
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 右：实时排版预览 + 4 项标准通过矩阵 */}
          <div className="space-y-5">
            <section
              className="shadow-soft space-y-4 rounded-2xl border border-black/10 p-6 transition-colors sm:p-8 dark:border-white/10"
              style={{
                backgroundColor: `rgba(${bgColor.r}, ${bgColor.g}, ${bgColor.b}, ${bgColor.a})`,
                color: `rgba(${fgColor.r}, ${fgColor.g}, ${fgColor.b}, ${fgColor.a})`,
              }}
            >
              <div className="text-xs font-semibold tracking-wider uppercase opacity-80">实时可读性排版模拟</div>
              <h3 className="text-2xl font-bold tracking-tight sm:text-3xl">
                清晰优雅的界面，从合规的色彩对比开始
              </h3>
              <p className="max-w-2xl text-sm leading-relaxed sm:text-[15px]">
                WCAG 2.1 建议常规正文文字与背景的对比度至少达到 4.5:1（AA 级），面向高无障碍阅读场景建议达到 7.0:1（AAA 级）；18pt 以上大号标题或 14pt 粗体字及 UI 边框控件至少需满足 3.0:1。
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <span
                  className="inline-flex items-center rounded-xl border-2 px-4 py-1.5 text-sm font-semibold"
                  style={{ borderColor: `rgba(${fgColor.r}, ${fgColor.g}, ${fgColor.b}, ${fgColor.a})` }}
                >
                  描边按钮组件示例
                </span>
                <span className="font-mono text-xs opacity-85">
                  前景色 {rgbaToHex(fgColor)} · 背景色 {rgbaToHex(bgColor)}
                </span>
              </div>
            </section>

            {/* 4 项合规认证卡 */}
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { title: '正文文字 · AA 级', req: '对比度 ≥ 4.5 : 1', pass: wcag.aaNormal },
                { title: '正文文字 · AAA 级', req: '对比度 ≥ 7.0 : 1', pass: wcag.aaaNormal },
                { title: '大号文字（≥18pt / 14pt粗）· AA', req: '对比度 ≥ 3.0 : 1', pass: wcag.aaLarge },
                { title: 'UI 图标与输入框边界 · AA', req: '对比度 ≥ 3.0 : 1', pass: wcag.uiComponent },
              ].map((item) => (
                <div
                  key={item.title}
                  className={cn(
                    'glass flex items-center justify-between gap-3 rounded-2xl border p-4',
                    item.pass ? 'border-emerald-500/25' : 'border-rose-500/25',
                  )}
                >
                  <div>
                    <div className="text-sm font-semibold">{item.title}</div>
                    <div className="text-muted-foreground font-mono text-xs">{item.req}</div>
                  </div>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
                      item.pass
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
                    )}
                  >
                    {item.pass ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
                    {item.pass ? '通过' : '未通过'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================= 视图三：现代 CSS 渐变生成器 ================= */}
      {tab === 'gradient' && (
        <div className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
          {/* 左：渐变参数与色标编辑 */}
          <section className="glass shadow-soft space-y-4 rounded-2xl p-5">
            <Field label="精选预设">
              <div className="grid grid-cols-3 gap-2">
                {GRADIENT_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() =>
                      setGrad({
                        type: p.config.type,
                        angle: p.config.angle,
                        interpolation: p.config.interpolation,
                        stops: p.config.stops.map(([color, pos]) => ({ id: uid(), color, pos })),
                      })
                    }
                    className="group space-y-1 text-left"
                  >
                    <div
                      className="h-9 w-full rounded-xl border border-black/10 transition-transform group-hover:scale-[1.03] dark:border-white/10"
                      style={{
                        background: buildGradientCss({
                          ...p.config,
                          stops: p.config.stops.map(([color, pos], i) => ({ id: String(i), color, pos })),
                        }),
                      }}
                    />
                    <div className="text-muted-foreground truncate text-center text-[11px] font-medium">{p.name}</div>
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="渐变类型">
                <Segmented<GradientType>
                  size="sm"
                  value={grad.type}
                  onChange={(v) => setGrad((prev) => ({ ...prev, type: v }))}
                  options={[
                    { value: 'linear', label: '线性' },
                    { value: 'radial', label: '径向' },
                    { value: 'conic', label: '圆锥' },
                  ]}
                />
              </Field>
              <Field label="插值空间">
                <Segmented<GradientInterpolation>
                  size="sm"
                  value={grad.interpolation}
                  onChange={(v) => setGrad((prev) => ({ ...prev, interpolation: v }))}
                  options={[
                    { value: 'oklch', label: 'OKLCH' },
                    { value: 'srgb', label: 'sRGB' },
                  ]}
                />
              </Field>
            </div>

            {grad.type !== 'radial' && (
              <Field label="渐变角度" value={`${grad.angle}°`}>
                <Slider
                  value={grad.angle}
                  min={0}
                  max={360}
                  onChange={(v) => setGrad((prev) => ({ ...prev, angle: v }))}
                />
              </Field>
            )}

            {/* 色标列表 */}
            <div className="space-y-2.5 border-t pt-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">色标节点（{grad.stops.length}/6）</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  disabled={grad.stops.length >= 6}
                  onClick={() =>
                    setGrad((prev) => ({
                      ...prev,
                      stops: [...prev.stops, { id: uid(), color: codes.hex, pos: 50 }],
                    }))
                  }
                >
                  <Plus className="!size-3.5" />
                  添加色标
                </Button>
              </div>

              <div className="space-y-2">
                {grad.stops.map((stop) => (
                  <div
                    key={stop.id}
                    className="border-border/60 bg-background/50 flex items-center gap-2 rounded-xl border p-2"
                  >
                    <label className="relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-black/15">
                      <div className="size-full" style={{ backgroundColor: stop.color }} />
                      <input
                        type="color"
                        value={stop.color}
                        onChange={(e) =>
                          setGrad((prev) => ({
                            ...prev,
                            stops: prev.stops.map((s) => (s.id === stop.id ? { ...s, color: e.target.value } : s)),
                          }))
                        }
                        className="sr-only"
                      />
                    </label>
                    <span className="w-16 font-mono text-xs uppercase">{stop.color}</span>
                    <div className="flex-1">
                      <Slider
                        value={stop.pos}
                        min={0}
                        max={100}
                        onChange={(v) =>
                          setGrad((prev) => ({
                            ...prev,
                            stops: prev.stops.map((s) => (s.id === stop.id ? { ...s, pos: v } : s)),
                          }))
                        }
                      />
                    </div>
                    <span className="text-muted-foreground w-8 text-right font-mono text-[11px]">{stop.pos}%</span>
                    <button
                      type="button"
                      disabled={grad.stops.length <= 2}
                      onClick={() =>
                        setGrad((prev) => ({
                          ...prev,
                          stops: prev.stops.filter((s) => s.id !== stop.id),
                        }))
                      }
                      className="text-muted-foreground hover:text-rose-500 p-1 disabled:opacity-30"
                      title="删除色标"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* 右：实时渐变画布 + CSS 代码导出 */}
          <div className="space-y-4">
            <section
              className="shadow-soft min-h-[300px] w-full rounded-3xl border border-black/10 transition-all sm:min-h-[380px] dark:border-white/10"
              style={{ background: gradCss }}
            />

            <section className="glass shadow-soft space-y-3 rounded-2xl p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">CSS 渐变代码</span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyText(`background: ${gradCss};`, 'grad-css', 'CSS 渐变代码')}
                  >
                    <Copy className="!size-3.5" />
                    复制 CSS
                  </Button>
                  <Button size="sm" variant="primary" onClick={handleExportGradientPng}>
                    <Download className="!size-3.5" />
                    导出高清 PNG
                  </Button>
                </div>
              </div>
              <pre className="border-border/60 bg-background/60 overflow-x-auto rounded-xl border p-3.5 font-mono text-xs leading-relaxed select-all">
                {`background: ${gradCss};`}
              </pre>
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
