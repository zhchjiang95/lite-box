import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  BookmarkPlus,
  Check,
  Code2,
  Copy,
  Download,
  Eraser,
  Maximize2,
  Minimize2,
  Palette,
  PenTool,
  Redo2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { Button } from '@/components/ui/button'
import { ColorPicker, Field, Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { Slider } from '@/components/ui/slider'
import { copyImageToClipboard, downloadBlob, timestampName } from '@/lib/file'
import { cn } from '@/lib/utils'
import {
  buildSignaturePreviewDataUrl,
  computeStrokesBounds,
  exportSignaturePngBlob,
  exportSignatureSvgBlob,
  INK_COLORS,
  loadSavedSignatures,
  PEN_STYLES,
  persistSavedSignatures,
  renderSignatureOnCanvas,
  type CanvasGuide,
  type ExportBgMode,
  type PenStyle,
  type SavedSignature,
  type SignatureStroke,
  type StrokePoint,
} from './engine'

/** 固定高精度虚拟逻辑画布宽度（X/Y 等比映射，缩放窗口或切全屏光标 100% 精准且绝不拉伸变形） */
const VIRTUAL_W = 960
const VIRTUAL_H = 540

export default function SignaturePadTool() {
  // 笔刷参数
  const [penStyle, setPenStyle] = useState<PenStyle>('fountain')
  const [inkColor, setInkColor] = useState('#0F172A')
  const [strokeWidth, setStrokeWidth] = useState(11)
  const [smoothing, setSmoothing] = useState(55) // 0–100

  // 画布与导出参数
  const [guide, setGuide] = useState<CanvasGuide>('baseline')
  const [autoTrim, setAutoTrim] = useState(true)
  const [trimPadding, setTrimPadding] = useState(28)
  const [exportScale, setExportScale] = useState<string>('2')
  const [exportBg, setExportBg] = useState<ExportBgMode>('transparent')
  const [fullscreen, setFullscreen] = useState(false)

  // 笔画历史栈（支持撤销/重做）
  const [strokes, setStrokes] = useState<SignatureStroke[]>([])
  const [redoStack, setRedoStack] = useState<SignatureStroke[]>([])
  const [savedList, setSavedList] = useState<SavedSignature[]>(() => loadSavedSignatures())
  const [copiedPng, setCopiedPng] = useState(false)
  const [busyExport, setBusyExport] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const activeStrokeRef = useRef<SignatureStroke | null>(null)
  const strokesRef = useRef<SignatureStroke[]>(strokes)
  strokesRef.current = strokes
  const drawingPointerIdRef = useRef<number | null>(null)

  /** 将所有笔画绘制到当前 Retina 画布 */
  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return

    const targetW = Math.round(rect.width * dpr)
    const targetH = Math.round(rect.height * dpr)
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
    }

    // 使用与指针输入严格一致的等比缩放（devScale = cssScale * dpr），保证光标与落笔像素级重合
    const devScale = targetW / VIRTUAL_W
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, targetW, targetH)
    ctx.setTransform(devScale, 0, 0, devScale, 0, 0)

    const list = activeStrokeRef.current
      ? [...strokesRef.current, activeStrokeRef.current]
      : strokesRef.current
    renderSignatureOnCanvas(ctx, list)
    ctx.restore()
  }, [])

  // 笔画变更或切换全屏时重绘
  useEffect(() => {
    const raf = requestAnimationFrame(redraw)
    return () => cancelAnimationFrame(raf)
  }, [strokes, fullscreen, redraw])

  // 监听画布容器尺寸变化
  useEffect(() => {
    const el = stageRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => redraw())
    ro.observe(el)
    return () => ro.disconnect()
  }, [redraw])

  /** 将指针客户端坐标等比映射到虚拟画布逻辑坐标（X/Y 同比例，光标与落笔严丝合缝） */
  const mapEventToPoint = (clientX: number, clientY: number, pressure: number, timeStamp: number): StrokePoint | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const cssScale = rect.width / VIRTUAL_W
    return {
      x: (clientX - rect.left) / cssScale,
      y: (clientY - rect.top) / cssScale,
      t: timeStamp || performance.now(),
      pressure: pressure > 0 ? pressure : 0.5,
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    if (drawingPointerIdRef.current !== null) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawingPointerIdRef.current = e.pointerId

    const pt = mapEventToPoint(e.clientX, e.clientY, e.pressure, e.timeStamp)
    if (!pt) return
    activeStrokeRef.current = {
      points: [pt],
      color: inkColor,
      baseWidth: strokeWidth,
      penStyle,
      smoothing: smoothing / 100,
    }
    redraw()
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawingPointerIdRef.current !== e.pointerId || !activeStrokeRef.current) return
    // 优先使用浏览器高刷合并事件（支持 120Hz/240Hz 手写笔与触控板细腻轨迹）
    const native = e.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] }
    const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : []
    const events = coalesced.length > 0 ? coalesced : [native]

    const pts = activeStrokeRef.current.points
    for (const ev of events) {
      const pt = mapEventToPoint(ev.clientX, ev.clientY, ev.pressure, ev.timeStamp)
      if (!pt) continue
      const last = pts[pts.length - 1]
      if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) >= 1.2) {
        pts.push(pt)
      }
    }
    redraw()
  }

  const finishStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawingPointerIdRef.current !== e.pointerId) return
    drawingPointerIdRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    const finished = activeStrokeRef.current
    activeStrokeRef.current = null
    if (finished && finished.points.length > 0) {
      setStrokes((prev) => [...prev, finished])
      setRedoStack([])
    }
    redraw()
  }

  /** 撤销 / 重做 / 清空 */
  const handleUndo = useCallback(() => {
    setStrokes((prev) => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      setRedoStack((r) => [...r, last])
      return prev.slice(0, -1)
    })
  }, [])

  const handleRedo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      setStrokes((s) => [...s, last])
      return prev.slice(0, -1)
    })
  }, [])

  const handleClear = useCallback(() => {
    if (strokes.length === 0) return
    setStrokes([])
    setRedoStack([])
  }, [strokes.length])

  /** 快捷键 Ctrl/Cmd+Z 撤销与重做，ESC 退出全屏 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (/INPUT|TEXTAREA/.test(el.tagName) || el.isContentEditable)) return
      if (e.key === 'Escape' && fullscreen) {
        setFullscreen(false)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) handleRedo()
        else handleUndo()
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        handleRedo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen, handleUndo, handleRedo])

  /** 将当前笔刷颜色/样式/粗细一键同步到已书写的全部笔画（免重写秒换色） */
  const handleRestyleExisting = () => {
    if (strokes.length === 0) return
    setStrokes((prev) =>
      prev.map((s) => ({
        ...s,
        color: inkColor,
        baseWidth: strokeWidth,
        penStyle,
        smoothing: smoothing / 100,
      })),
    )
    toast.success('已将当前墨色与笔锋同步应用到签名')
  }

  /** 实时估算导出尺寸 */
  const estimatedExportDims = useMemo(() => {
    const scale = Number(exportScale) || 2
    if (strokes.length === 0 || !autoTrim) {
      return { width: VIRTUAL_W * scale, height: VIRTUAL_H * scale }
    }
    const b = computeStrokesBounds(strokes, VIRTUAL_W, VIRTUAL_H)
    return {
      width: Math.round(Math.ceil(b.width + trimPadding * 2) * scale),
      height: Math.round(Math.ceil(b.height + trimPadding * 2) * scale),
    }
  }, [strokes, autoTrim, trimPadding, exportScale])

  /** 导出高清 PNG */
  const handleDownloadPng = async () => {
    if (strokes.length === 0) {
      toast.error('请先在右侧画布手写签名')
      return
    }
    setBusyExport(true)
    try {
      const { blob, width, height } = await exportSignaturePngBlob(strokes, {
        canvasWidth: VIRTUAL_W,
        canvasHeight: VIRTUAL_H,
        autoTrim,
        padding: trimPadding,
        scale: Number(exportScale) || 2,
        background: exportBg,
      })
      downloadBlob(blob, timestampName('signature', 'png'))
      toast.success(
        `已导出${exportBg === 'transparent' ? '透明底' : '白底'} PNG（${width} × ${height} px）`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出 PNG 失败')
    } finally {
      setBusyExport(false)
    }
  }

  /** 一键复制透明 PNG 到剪贴板 */
  const handleCopyPng = async () => {
    if (strokes.length === 0) {
      toast.error('请先手写签名')
      return
    }
    setBusyExport(true)
    try {
      const { blob } = await exportSignaturePngBlob(strokes, {
        canvasWidth: VIRTUAL_W,
        canvasHeight: VIRTUAL_H,
        autoTrim,
        padding: trimPadding,
        scale: Number(exportScale) || 2,
        background: exportBg,
      })
      await copyImageToClipboard(blob)
      setCopiedPng(true)
      toast.success('已复制透明签名，可直接粘贴到 Word / WPS / 聊天窗口')
      setTimeout(() => setCopiedPng(false), 1800)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制失败，请检查剪贴板权限')
    } finally {
      setBusyExport(false)
    }
  }

  /** 导出无损矢量 SVG */
  const handleDownloadSvg = () => {
    if (strokes.length === 0) {
      toast.error('请先手写签名')
      return
    }
    try {
      const blob = exportSignatureSvgBlob(strokes, {
        canvasWidth: VIRTUAL_W,
        canvasHeight: VIRTUAL_H,
        autoTrim,
        padding: trimPadding,
        background: exportBg,
      })
      downloadBlob(blob, timestampName('signature', 'svg'))
      toast.success('已导出无损矢量 SVG 签名')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出 SVG 失败')
    }
  }

  /** 保存当前签名到本机签名库 */
  const handleSaveToVault = () => {
    if (strokes.length === 0) {
      toast.error('请先手写签名再保存')
      return
    }
    const previewDataUrl = buildSignaturePreviewDataUrl(strokes, VIRTUAL_W, VIRTUAL_H)
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const item: SavedSignature = {
      id: `sig-${Date.now()}`,
      name: `签名 ${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      createdAt: Date.now(),
      canvasWidth: VIRTUAL_W,
      canvasHeight: VIRTUAL_H,
      strokes: strokes.map((s) => ({ ...s, points: [...s.points] })),
      previewDataUrl,
    }
    const next = [item, ...savedList].slice(0, 12)
    setSavedList(next)
    persistSavedSignatures(next)
    toast.success('已保存到本机签名库，下次打开可一键复用')
  }

  // ============================================================================
  // 左侧笔触与导出参数面板
  // ============================================================================
  const panel = (
    <div className="space-y-6">
      {/* 1. 笔触风格 */}
      <div className="space-y-2">
        <div className="text-foreground/80 text-sm font-medium">笔触风格</div>
        <div className="space-y-1.5">
          {PEN_STYLES.map((p) => {
            const active = penStyle === p.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPenStyle(p.id)}
                className={cn(
                  'flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition-all',
                  active
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border/60 bg-background/40 text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                <span className="text-xs font-semibold">{p.label}</span>
                <span className="text-muted-foreground text-[11px]">{p.desc}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 2. 墨水颜色与粗细 */}
      <div className="space-y-4">
        <Field label="墨水颜色" value={inkColor.toUpperCase()}>
          <ColorPicker
            value={inkColor}
            onChange={setInkColor}
            presets={INK_COLORS.map((c) => c.hex)}
          />
        </Field>

        <Field label="笔尖粗细" value={`${strokeWidth} px`}>
          <Slider value={strokeWidth} onChange={setStrokeWidth} min={4} max={28} step={1} />
        </Field>

        <Field label="防抖平滑度" value={`${smoothing}%`}>
          <Slider value={smoothing} onChange={setSmoothing} min={0} max={100} step={5} />
        </Field>

        {strokes.length > 0 && (
          <Button variant="outline" size="sm" className="w-full" onClick={handleRestyleExisting}>
            <Palette />
            将当前颜色 / 笔锋应用到已写签名
          </Button>
        )}
      </div>

      <hr className="border-border/60" />

      {/* 3. 画布参考线与导出配置 */}
      <div className="space-y-4">
        <div className="text-foreground/80 text-xs font-semibold tracking-wider uppercase">画布与导出</div>

        <Field label="书写参考线（仅预览不导出）">
          <Segmented<CanvasGuide>
            size="sm"
            value={guide}
            onChange={setGuide}
            options={[
              { value: 'baseline', label: '签字基线' },
              { value: 'grid', label: '田字参考' },
              { value: 'blank', label: '纯净无格' },
            ]}
          />
        </Field>

        <Field label="导出背景">
          <Segmented<ExportBgMode>
            size="sm"
            value={exportBg}
            onChange={setExportBg}
            options={[
              { value: 'transparent', label: '透明底（推荐）' },
              { value: 'white', label: '纯白底' },
            ]}
          />
        </Field>

        <div className="flex items-center justify-between text-sm">
          <span className="text-foreground/80 font-medium">自动紧致裁切留白</span>
          <Switch checked={autoTrim} onChange={setAutoTrim} label="自动裁切透明白边" />
        </div>

        {autoTrim && (
          <Field label="四周呼吸边距" value={`${trimPadding} px`}>
            <Slider value={trimPadding} onChange={setTrimPadding} min={0} max={80} step={4} />
          </Field>
        )}

        <Field
          label="PNG 清晰度倍率"
          value={strokes.length > 0 ? `${estimatedExportDims.width} × ${estimatedExportDims.height} px` : `${exportScale}×`}
        >
          <Segmented<string>
            size="sm"
            value={exportScale}
            onChange={setExportScale}
            options={[
              { value: '1', label: '1× 标准' },
              { value: '2', label: '2× 高清' },
              { value: '3', label: '3× 超清打印' },
            ]}
          />
        </Field>
      </div>
    </div>
  )

  const actions = (
    <>
      <Button variant="primary" size="md" disabled={strokes.length === 0 || busyExport} onClick={() => void handleDownloadPng()}>
        <Download />
        导出透明 PNG
      </Button>
      <Button variant="outline" size="md" disabled={strokes.length === 0 || busyExport} onClick={() => void handleCopyPng()}>
        {copiedPng ? <Check className="text-emerald-500" /> : <Copy />}
        {copiedPng ? '已复制' : '复制图片'}
      </Button>
    </>
  )

  /** 主手写画板卡片（同时用于常规视图与全屏手写模式） */
  const canvasBoard = (
    <div
      className={cn(
        'glass shadow-soft flex flex-col overflow-hidden rounded-2xl',
        fullscreen && 'bg-card-solid fixed inset-0 z-50 rounded-none',
      )}
    >
      {/* 画板顶部操控条 */}
      <div className="border-border/60 flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" disabled={strokes.length === 0} onClick={handleUndo} title="撤销 (Ctrl+Z)">
            <Undo2 />
            <span className="hidden sm:inline">撤销</span>
          </Button>
          <Button variant="outline" size="sm" disabled={redoStack.length === 0} onClick={handleRedo} title="重做 (Ctrl+Shift+Z)">
            <Redo2 />
            <span className="hidden sm:inline">重做</span>
          </Button>
          <Button variant="ghost" size="sm" disabled={strokes.length === 0} onClick={handleClear}>
            <Eraser />
            清空
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="sm" disabled={strokes.length === 0} onClick={handleSaveToVault}>
            <BookmarkPlus />
            <span className="hidden sm:inline">存到签名库</span>
          </Button>
          <Button variant="outline" size="sm" disabled={strokes.length === 0} onClick={handleDownloadSvg}>
            <Code2 />
            <span className="hidden sm:inline">导出 SVG</span>
          </Button>
          {fullscreen && (
            <Button variant="primary" size="sm" disabled={strokes.length === 0 || busyExport} onClick={() => void handleDownloadPng()}>
              <Download />
              导出 PNG
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? '退出全屏 (ESC)' : '全屏手写（平板/手机更顺手）'}
          >
            {fullscreen ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </div>
      </div>

      {/* 手写区舞台 */}
      <div
        ref={stageRef}
        className={cn(
          'relative w-full overflow-hidden select-none',
          fullscreen ? 'flex-1' : 'aspect-[16/9] min-h-[300px] sm:min-h-[420px]',
          exportBg === 'transparent'
            ? inkColor.toLowerCase() === '#ffffff'
              ? 'bg-neutral-900'
              : 'checkerboard'
            : 'bg-white',
        )}
      >
        {/* 书写辅助参考线（纯视觉提示，导出时绝不写入图片） */}
        {guide === 'baseline' && (
          <div className="pointer-events-none absolute inset-x-10 bottom-[26%] flex items-end gap-3 border-b-2 border-dashed border-neutral-400/50 pb-1.5">
            <span className="font-serif text-xl font-light text-neutral-400/70">×</span>
          </div>
        )}
        {guide === 'grid' && (
          <div
            className="pointer-events-none absolute inset-0 opacity-35"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgba(148,163,184,0.45) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.45) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
            }}
          />
        )}

        {/* 空画布引导提示 */}
        {strokes.length === 0 && !activeStrokeRef.current && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center select-none">
            <PenTool className="size-8 text-neutral-400/60" />
            <div className="text-sm font-medium text-neutral-500/80">
              在此区域手写你的签名（支持鼠标、触控屏与手写笔压感）
            </div>
            <div className="text-[11px] text-neutral-400/80">
              默认自动裁切多余白边，一键导出高清透明底 PNG 或矢量 SVG
            </div>
          </div>
        )}

        {/* 高清交互手写 Canvas */}
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          className="relative z-10 block size-full cursor-crosshair touch-none"
        />

        {/* 右下角实时导出尺寸指示 */}
        {strokes.length > 0 && (
          <div className="bg-card-solid/85 border-border/60 text-muted-foreground pointer-events-none absolute right-3 bottom-3 z-20 rounded-lg border px-2.5 py-1 font-mono text-[11px] backdrop-blur-sm">
            {strokes.length} 笔 · 预计导出 {estimatedExportDims.width} × {estimatedExportDims.height} px
            {autoTrim ? '（已自动去白边）' : ''}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <ToolShell panel={panel} actions={actions} panelTitle="笔触与导出设置">
      <div className="space-y-4">
        {canvasBoard}

        {/* 本地常用签名库 */}
        <div className="glass shadow-soft space-y-3 rounded-2xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 font-semibold">
              <Sparkles className="text-primary size-4" />
              本机常用签名库（{savedList.length}）
            </div>
            <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
              <ShieldCheck className="size-3.5 text-emerald-500" />
              仅保存在本机浏览器，不上传服务器
            </span>
          </div>

          {savedList.length === 0 ? (
            <div className="text-muted-foreground py-5 text-center text-xs">
              写好满意的签名后，点击上方「存到签名库」，以后随时一键调出换色或导出透明图
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {savedList.map((item) => (
                <div
                  key={item.id}
                  className="bg-background/50 border-border/60 group flex flex-col overflow-hidden rounded-xl border transition-all hover:border-primary/60"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setStrokes(item.strokes.map((s) => ({ ...s, points: [...s.points] })))
                      setRedoStack([])
                      toast.success(`已载入「${item.name}」到画板`)
                    }}
                    className="checkerboard flex h-22 items-center justify-center p-2"
                    title="点击载入到画板"
                  >
                    <img src={item.previewDataUrl} alt={item.name} className="max-h-full max-w-full object-contain" />
                  </button>
                  <div className="border-border/50 flex items-center justify-between border-t px-2.5 py-1.5 text-[11px]">
                    <span className="text-muted-foreground truncate">{item.name}</span>
                    <button
                      type="button"
                      title="删除记录"
                      onClick={() => {
                        const next = savedList.filter((s) => s.id !== item.id)
                        setSavedList(next)
                        persistSavedSignatures(next)
                      }}
                      className="text-muted-foreground/60 hover:text-red-500 p-0.5"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ToolShell>
  )
}
