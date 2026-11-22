import {
  ArrowUpRight,
  Circle,
  Download,
  Eraser,
  Grid2x2,
  Highlighter,
  ImagePlus,
  Maximize2,
  Minimize2,
  Minus,
  MousePointer2,
  PenTool,
  Pointer,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { downloadBlob, timestampName } from '@/lib/file'
import { IMAGE_ACCEPT, decodeImageFile, isImageLike } from '@/lib/image'
import { cn, uid } from '@/lib/utils'
import {
  exportBoardPng,
  getElementBounds,
  hitTestElement,
  renderBoard,
  translateElement,
  type LaserTrailPoint,
} from './renderer'
import {
  BOARD_H,
  BOARD_THEMES,
  BOARD_THEME_MAP,
  BOARD_W,
  FONT_FAMILY_MAP,
  STROKE_WIDTHS,
  TEXT_SIZES,
  type BoardElement,
  type BoardPattern,
  type BoardThemeId,
  type DrawTool,
  type ImageItem,
  type Pt,
  type ShapeItem,
  type StrokeItem,
  type TextFontStyle,
  type TextItem,
} from './types'

const STORAGE_KEY = 'litebox-blackboard-v1'
const MAX_HISTORY = 50

interface PersistedState {
  themeId: BoardThemeId
  pattern: BoardPattern
  elements: BoardElement[]
}

const PATTERN_LIST: { id: BoardPattern; label: string }[] = [
  { id: 'none', label: '纯色' },
  { id: 'grid', label: '方格' },
  { id: 'dots', label: '点阵' },
  { id: 'lines', label: '横线' },
]

/** 读取本地暂存，意外刷新不丢板书 */
function loadSavedBoard(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    if (!parsed || !Array.isArray(parsed.elements)) return null
    return {
      themeId: parsed.themeId && parsed.themeId in BOARD_THEME_MAP ? parsed.themeId : 'chalk-green',
      pattern: parsed.pattern ?? 'none',
      elements: parsed.elements,
    }
  } catch {
    return null
  }
}

export default function Blackboard() {
  const initial = useMemo(() => loadSavedBoard(), [])

  const [themeId, setThemeId] = useState<BoardThemeId>(initial?.themeId ?? 'chalk-green')
  const [pattern, setPattern] = useState<BoardPattern>(initial?.pattern ?? 'none')
  const [elements, setElements] = useState<BoardElement[]>(initial?.elements ?? [])
  const [past, setPast] = useState<BoardElement[][]>([])
  const [future, setFuture] = useState<BoardElement[][]>([])

  const [tool, setTool] = useState<DrawTool>('pen')
  const [color, setColor] = useState<string>(BOARD_THEME_MAP[initial?.themeId ?? 'chalk-green'].defaultColor)
  const [strokeWidth, setStrokeWidth] = useState<number>(7)
  const [fontSize, setFontSize] = useState<number>(54)
  const [fontBold, setFontBold] = useState<boolean>(true)
  const [fontStyle, setFontStyle] = useState<TextFontStyle>('sans')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState<TextItem | null>(null)

  // 全屏沉浸放映状态（原生 Fullscreen + 视口铺满降级）
  const [nativeFs, setNativeFs] = useState(false)
  const [pseudoFs, setPseudoFs] = useState(false)
  const [curtain, setCurtain] = useState<'none' | 'black' | 'white'>('none')
  const [hudVisible, setHudVisible] = useState(true)

  const isFullscreen = nativeFs || pseudoFs
  const theme = BOARD_THEME_MAP[themeId]

  const stageRef = useRef<HTMLDivElement>(null)
  const boardWrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)

  const draftRef = useRef<BoardElement | null>(null)
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const laserTrailRef = useRef<LaserTrailPoint[]>([])
  const laserRafRef = useRef<number>(0)
  const hudTimerRef = useRef<number | null>(null)
  const elementsRef = useRef(elements)
  elementsRef.current = elements

  const dragRef = useRef<
    | { kind: 'draw-stroke'; item: StrokeItem }
    | { kind: 'draw-shape'; item: ShapeItem }
    | { kind: 'move'; id: string; startPt: Pt; baseSnapshot: BoardElement[]; origEl: BoardElement }
    | { kind: 'resize-image'; id: string; startPt: Pt; baseSnapshot: BoardElement[]; origEl: ImageItem }
    | { kind: 'erase'; erasedAny: boolean; baseSnapshot: BoardElement[] }
    | { kind: 'laser' }
    | null
  >(null)

  const [renderTick, setRenderTick] = useState(0)

  /** 推入撤销栈并更新当前画布元素 */
  const commitElements = useCallback((next: BoardElement[], prevSnapshot?: BoardElement[]) => {
    const snap = prevSnapshot ?? elementsRef.current
    setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), snap])
    setFuture([])
    setElements(next)
  }, [])

  /** 撤销 / 重做 */
  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p
      const prev = p[p.length - 1]
      setFuture((f) => [elementsRef.current, ...f.slice(0, MAX_HISTORY - 1)])
      setElements(prev)
      setSelectedId(null)
      return p.slice(0, -1)
    })
  }, [])

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f
      const next = f[0]
      setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), elementsRef.current])
      setElements(next)
      setSelectedId(null)
      return f.slice(1)
    })
  }, [])

  // 自动保存到 localStorage
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ themeId, pattern, elements }))
      } catch {
        // 图片较大超出 localStorage 额度时静默跳过，不影响正常绘制与导出
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [themeId, pattern, elements])

  // 预加载所有贴图元素到内存 Image 缓存
  useEffect(() => {
    let changed = false
    for (const el of elements) {
      if (el.kind !== 'image') continue
      if (imageCacheRef.current.has(el.id)) continue
      const img = new Image()
      img.onload = () => setRenderTick((t) => t + 1)
      img.src = el.dataUrl
      imageCacheRef.current.set(el.id, img)
      changed = true
    }
    if (changed) setRenderTick((t) => t + 1)
  }, [elements])

  /** 重绘画布 */
  const paintNow = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    renderBoard({
      canvas,
      themeId,
      pattern,
      elements,
      draftElement: draftRef.current,
      selectedId,
      editingTextId: editingText?.id ?? null,
      imageCache: imageCacheRef.current,
      laserTrail: laserTrailRef.current,
    })
  }, [themeId, pattern, elements, selectedId, editingText?.id])

  useEffect(() => {
    paintNow()
  }, [paintNow, renderTick, isFullscreen])

  // 容器缩放时重绘高清画布
  useEffect(() => {
    const wrap = boardWrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => paintNow())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [paintNow])

  /** 激光笔拖尾渐隐动画循环 */
  const startLaserLoop = useCallback(() => {
    cancelAnimationFrame(laserRafRef.current)
    const step = () => {
      const now = performance.now()
      laserTrailRef.current = laserTrailRef.current.filter((p) => now - p.t < 850)
      paintNow()
      if (laserTrailRef.current.length > 0 || dragRef.current?.kind === 'laser') {
        laserRafRef.current = requestAnimationFrame(step)
      }
    }
    laserRafRef.current = requestAnimationFrame(step)
  }, [paintNow])

  useEffect(() => () => cancelAnimationFrame(laserRafRef.current), [])

  /** 切换全屏放映（进入全屏默认切到激光笔，方便立刻讲解） */
  const toggleFullscreen = useCallback(async () => {
    const el = stageRef.current
    if (!el) return

    if (nativeFs) {
      try {
        await document.exitFullscreen()
      } catch {
        setNativeFs(false)
      }
      return
    }
    if (pseudoFs) {
      setPseudoFs(false)
      setCurtain('none')
      return
    }

    // 进入全屏前自动提交正在输入的文字
    setSelectedId(null)
    setTool('laser')
    setHudVisible(true)

    if (typeof el.requestFullscreen === 'function') {
      try {
        await el.requestFullscreen()
        return
      } catch {
        // 降级为视口铺满全屏
      }
    }
    setPseudoFs(true)
  }, [nativeFs, pseudoFs])

  // 监听原生全屏切换
  useEffect(() => {
    const onFsChange = () => {
      const active = document.fullscreenElement === stageRef.current
      setNativeFs(active)
      if (!active) {
        setCurtain('none')
        setTool((cur) => (cur === 'laser' ? 'pen' : cur))
      }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // 全屏时 2.8 秒无鼠标移动自动隐藏底栏，呈现 100% 纯净大屏
  const bumpHud = useCallback(() => {
    if (!isFullscreen) return
    setHudVisible(true)
    if (hudTimerRef.current !== null) window.clearTimeout(hudTimerRef.current)
    hudTimerRef.current = window.setTimeout(() => setHudVisible(false), 2800)
  }, [isFullscreen])

  useEffect(() => {
    if (!isFullscreen) {
      setHudVisible(true)
      if (hudTimerRef.current !== null) window.clearTimeout(hudTimerRef.current)
      return
    }
    bumpHud()
    return () => {
      if (hudTimerRef.current !== null) window.clearTimeout(hudTimerRef.current)
    }
  }, [isFullscreen, bumpHud])

  // 伪全屏锁定页面滚动
  useEffect(() => {
    if (!pseudoFs) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [pseudoFs])

  /** 提交当前内联编辑的文字 */
  const commitEditingText = useCallback(() => {
    setEditingText((cur) => {
      if (!cur) return null
      const trimmed = cur.text.trim()
      const exists = elementsRef.current.some((e) => e.id === cur.id)
      if (!trimmed) {
        if (exists) {
          commitElements(elementsRef.current.filter((e) => e.id !== cur.id))
        }
        return null
      }
      if (exists) {
        commitElements(elementsRef.current.map((e) => (e.id === cur.id ? cur : e)))
      } else {
        commitElements([...elementsRef.current, cur])
      }
      return null
    })
  }, [commitElements])

  // 文字编辑器打开时自动聚焦
  useEffect(() => {
    if (editingText) {
      requestAnimationFrame(() => textAreaRef.current?.focus())
    }
  }, [editingText?.id])

  /** 插入图片（支持文件选择、拖拽和剪贴板 Ctrl+V 贴图） */
  const insertImageFile = useCallback(
    async (file: File) => {
      try {
        const decoded = await decodeImageFile(file)
        // 缩放到合理尺寸避免占用过大内存（最长边 1280px）
        const maxSide = 1280
        const scale = Math.min(1, maxSide / Math.max(decoded.width, decoded.height))
        const cw = Math.max(1, Math.round(decoded.width * scale))
        const ch = Math.max(1, Math.round(decoded.height * scale))
        const off = document.createElement('canvas')
        off.width = cw
        off.height = ch
        off.getContext('2d')!.drawImage(decoded.bitmap, 0, 0, cw, ch)
        const dataUrl = off.toDataURL('image/png')
        off.width = 0
        off.height = 0
        decoded.bitmap.close()
        URL.revokeObjectURL(decoded.previewUrl)

        // 在黑板中央以合适比例放置
        const fitScale = Math.min((BOARD_W * 0.45) / cw, (BOARD_H * 0.55) / ch, 1)
        const w = Math.round(cw * fitScale)
        const h = Math.round(ch * fitScale)
        const item: ImageItem = {
          id: uid(),
          kind: 'image',
          x: Math.round((BOARD_W - w) / 2),
          y: Math.round((BOARD_H - h) / 2),
          w,
          h,
          dataUrl,
        }
        commitElements([...elementsRef.current, item])
        setSelectedId(item.id)
        setTool('select')
        toast.success('已贴入图片，可拖动移位或拖拽右下角缩放，并直接在上面画标注')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '读取图片失败')
      }
    },
    [commitElements],
  )

  // 全局快捷键：撤销/重做、删除选中、全屏黑屏 B / 白屏 W、粘贴图片 Ctrl+V
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (editingText) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        commitElements(elementsRef.current.filter((el) => el.id !== selectedId))
        setSelectedId(null)
        return
      }
      if (e.key === 'Escape') {
        if (curtain !== 'none') {
          setCurtain('none')
        } else if (pseudoFs) {
          setPseudoFs(false)
        } else {
          setSelectedId(null)
        }
        return
      }
      if (isFullscreen && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 'b') {
          e.preventDefault()
          setCurtain((c) => (c === 'black' ? 'none' : 'black'))
        } else if (k === 'w') {
          e.preventDefault()
          setCurtain((c) => (c === 'white' ? 'none' : 'white'))
        }
      }
    }

    const onPaste = (e: ClipboardEvent) => {
      if (editingText) return
      const files = Array.from(e.clipboardData?.files ?? []).filter(isImageLike)
      if (!files.length) return
      e.preventDefault()
      void insertImageFile(files[0])
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('paste', onPaste)
    }
  }, [editingText, selectedId, curtain, pseudoFs, isFullscreen, undo, redo, commitElements, insertImageFile])

  /** 屏幕坐标转 1920×1080 逻辑画布坐标 */
  const clientToBoard = (clientX: number, clientY: number): Pt => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) / Math.max(1, rect.width)) * BOARD_W,
      y: ((clientY - rect.top) / Math.max(1, rect.height)) * BOARD_H,
    }
  }

  /** 按视觉叠放顺序从顶到底查找命中的元素 */
  const findTopHit = (pt: Pt): BoardElement | null => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return null
    const list = elementsRef.current
    // 非图片元素在上层，优先检测
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].kind !== 'image' && hitTestElement(ctx, list[i], pt)) return list[i]
    }
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].kind === 'image' && hitTestElement(ctx, list[i], pt)) return list[i]
    }
    return null
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (curtain !== 'none') {
      setCurtain('none')
      return
    }
    if (editingText) {
      commitEditingText()
      return
    }

    const pt = clientToBoard(e.clientX, e.clientY)
    e.currentTarget.setPointerCapture(e.pointerId)

    if (tool === 'laser') {
      dragRef.current = { kind: 'laser' }
      laserTrailRef.current.push({ x: pt.x, y: pt.y, t: performance.now() })
      startLaserLoop()
      return
    }

    if (tool === 'text') {
      const nextText: TextItem = {
        id: uid(),
        kind: 'text',
        x: Math.min(BOARD_W - 260, Math.max(36, pt.x)),
        y: Math.min(BOARD_H - 120, Math.max(36, pt.y - fontSize * 0.5)),
        text: '',
        color,
        fontSize,
        bold: fontBold,
        fontStyle,
      }
      setSelectedId(null)
      setEditingText(nextText)
      return
    }

    if (tool === 'select') {
      const ctx = canvasRef.current?.getContext('2d')
      // 先检测是否点中了当前已选中图片的右下角缩放柄
      if (selectedId && ctx) {
        const curSel = elementsRef.current.find((el) => el.id === selectedId)
        if (curSel?.kind === 'image') {
          const box = getElementBounds(ctx, curSel)
          const hx = box.x + box.w + 10
          const hy = box.y + box.h + 10
          if (Math.hypot(pt.x - hx, pt.y - hy) <= 28) {
            dragRef.current = {
              kind: 'resize-image',
              id: curSel.id,
              startPt: pt,
              baseSnapshot: elementsRef.current,
              origEl: curSel,
            }
            return
          }
        }
      }

      const hit = findTopHit(pt)
      setSelectedId(hit?.id ?? null)
      if (hit) {
        dragRef.current = {
          kind: 'move',
          id: hit.id,
          startPt: pt,
          baseSnapshot: elementsRef.current,
          origEl: hit,
        }
      }
      return
    }

    if (tool === 'eraser') {
      const hit = findTopHit(pt)
      const base = elementsRef.current
      if (hit) {
        setElements(base.filter((el) => el.id !== hit.id))
        if (selectedId === hit.id) setSelectedId(null)
        dragRef.current = { kind: 'erase', erasedAny: true, baseSnapshot: base }
      } else {
        dragRef.current = { kind: 'erase', erasedAny: false, baseSnapshot: base }
      }
      return
    }

    if (tool === 'pen' || tool === 'highlighter') {
      const item: StrokeItem = {
        id: uid(),
        kind: 'stroke',
        points: [pt],
        color,
        width: strokeWidth,
        highlighter: tool === 'highlighter',
        chalk: tool === 'pen' && theme.isDark,
      }
      draftRef.current = item
      dragRef.current = { kind: 'draw-stroke', item }
      setSelectedId(null)
      paintNow()
      return
    }

    // 矢量图形
    const item: ShapeItem = {
      id: uid(),
      kind: 'shape',
      shape: tool,
      x1: pt.x,
      y1: pt.y,
      x2: pt.x,
      y2: pt.y,
      color,
      width: strokeWidth,
    }
    draftRef.current = item
    dragRef.current = { kind: 'draw-shape', item }
    setSelectedId(null)
    paintNow()
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    bumpHud()
    const drag = dragRef.current
    if (!drag) return
    const pt = clientToBoard(e.clientX, e.clientY)

    if (drag.kind === 'laser') {
      laserTrailRef.current.push({ x: pt.x, y: pt.y, t: performance.now() })
      return
    }

    if (drag.kind === 'draw-stroke') {
      const pts = drag.item.points
      const last = pts[pts.length - 1]
      if (Math.hypot(pt.x - last.x, pt.y - last.y) >= 3) {
        pts.push(pt)
        paintNow()
      }
      return
    }

    if (drag.kind === 'draw-shape') {
      drag.item.x2 = pt.x
      drag.item.y2 = pt.y
      paintNow()
      return
    }

    if (drag.kind === 'move') {
      const dx = pt.x - drag.startPt.x
      const dy = pt.y - drag.startPt.y
      const moved = translateElement(drag.origEl, dx, dy)
      setElements(drag.baseSnapshot.map((el) => (el.id === drag.id ? moved : el)))
      return
    }

    if (drag.kind === 'resize-image') {
      const aspect = drag.origEl.w / Math.max(1, drag.origEl.h)
      const nextW = Math.max(120, Math.min(BOARD_W * 0.92, drag.origEl.w + (pt.x - drag.startPt.x)))
      const nextH = Math.round(nextW / aspect)
      const resized: ImageItem = { ...drag.origEl, w: Math.round(nextW), h: nextH }
      setElements(drag.baseSnapshot.map((el) => (el.id === drag.id ? resized : el)))
      return
    }

    if (drag.kind === 'erase') {
      const hit = findTopHit(pt)
      if (hit) {
        drag.erasedAny = true
        setElements((prev) => prev.filter((el) => el.id !== hit.id))
        if (selectedId === hit.id) setSelectedId(null)
      }
    }
  }

  const handlePointerUp = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return

    if (drag.kind === 'draw-stroke') {
      draftRef.current = null
      commitElements([...elementsRef.current, drag.item])
      return
    }

    if (drag.kind === 'draw-shape') {
      draftRef.current = null
      const len = Math.hypot(drag.item.x2 - drag.item.x1, drag.item.y2 - drag.item.y1)
      if (len >= 8) {
        commitElements([...elementsRef.current, drag.item])
      } else {
        paintNow()
      }
      return
    }

    if (drag.kind === 'move' || drag.kind === 'resize-image') {
      const moved = elementsRef.current.find((el) => el.id === drag.id)
      if (moved && moved !== drag.origEl) {
        setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), drag.baseSnapshot])
        setFuture([])
      }
      return
    }

    if (drag.kind === 'erase' && drag.erasedAny) {
      setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), drag.baseSnapshot])
      setFuture([])
    }
  }

  /** 双击文字对象直接原地二次编辑 */
  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pt = clientToBoard(e.clientX, e.clientY)
    const hit = findTopHit(pt)
    if (hit?.kind === 'text') {
      setEditingText({ ...hit })
      setSelectedId(null)
    }
  }

  /** 切换板面主题时智能同步默认画笔色（避免白底白笔看不见） */
  const switchTheme = (nextId: BoardThemeId) => {
    const prevDark = BOARD_THEME_MAP[themeId].isDark
    const nextTheme = BOARD_THEME_MAP[nextId]
    setThemeId(nextId)
    if (prevDark !== nextTheme.isDark) {
      setColor(nextTheme.defaultColor)
    }
  }

  /** 擦干净整块黑板 */
  const clearBoard = () => {
    if (elements.length === 0) return
    commitElements([])
    setSelectedId(null)
    toast.success('已擦净黑板（Ctrl+Z 可撤销）')
  }

  /** 导出高清 1920×1080 PNG */
  const handleExportPng = async () => {
    try {
      const blob = await exportBoardPng(themeId, pattern, elements, imageCacheRef.current)
      downloadBlob(blob, timestampName('演示黑板', 'png'))
      toast.success('已导出 1920×1080 高清板书 PNG')
    } catch {
      toast.error('导出失败')
    }
  }

  const toolButtons: { id: DrawTool; label: string; icon: typeof PenTool }[] = [
    { id: 'select', label: '选择拖动', icon: MousePointer2 },
    { id: 'pen', label: theme.isDark ? '粉笔' : '马克笔', icon: PenTool },
    { id: 'highlighter', label: '荧光笔', icon: Highlighter },
    { id: 'text', label: '输入文字', icon: Type },
    { id: 'arrow', label: '箭头', icon: ArrowUpRight },
    { id: 'line', label: '直线', icon: Minus },
    { id: 'rect', label: '矩形', icon: Square },
    { id: 'ellipse', label: '椭圆', icon: Circle },
    { id: 'eraser', label: '橡皮擦', icon: Eraser },
  ]

  const cursorStyle =
    tool === 'select'
      ? 'default'
      : tool === 'text'
        ? 'text'
        : tool === 'laser'
          ? 'none'
          : 'crosshair'

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void insertImageFile(file)
        }}
      />

      {/* 顶部紧凑创作工具栏（非全屏时展示） */}
      <div className="glass flex flex-wrap items-center justify-between gap-2.5 rounded-2xl px-3 py-2.5">
        {/* 绘图与输入工具组 */}
        <div className="flex flex-wrap items-center gap-1">
          {toolButtons.map((t) => {
            const Icon = t.icon
            const active = tool === t.id
            return (
              <button
                key={t.id}
                type="button"
                title={t.label}
                onClick={() => {
                  if (editingText) commitEditingText()
                  setTool(t.id)
                  if (t.id !== 'select') setSelectedId(null)
                }}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition',
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                )}
              >
                <Icon className="size-3.5" />
                <span className="hidden xl:inline">{t.label}</span>
              </button>
            )
          })}

          <div className="bg-foreground/10 mx-1 h-5 w-px" />

          {/* 插入贴图 */}
          <button
            type="button"
            title="插入图片（也可直接 Ctrl+V 粘贴截图）"
            onClick={() => fileInputRef.current?.click()}
            className="text-muted-foreground hover:bg-foreground/5 hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition"
          >
            <ImagePlus className="size-3.5" />
            <span className="hidden xl:inline">贴图</span>
          </button>
        </div>

        {/* 右侧操作：撤销重做、清板、导出、全屏播放 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="ghost" size="icon" className="size-8" disabled={past.length === 0} onClick={undo} title="撤销 (Ctrl+Z)">
            <Undo2 className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" disabled={future.length === 0} onClick={redo} title="重做 (Ctrl+Shift+Z)">
            <Redo2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive h-8 px-2.5 text-xs"
            disabled={elements.length === 0}
            onClick={clearBoard}
          >
            <Trash2 className="size-3.5" />
            擦黑板
          </Button>
          <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={handleExportPng}>
            <Download className="size-3.5" />
            存为图片
          </Button>
          <Button variant="primary" size="sm" className="h-8 px-3 text-xs" onClick={() => void toggleFullscreen()}>
            <Maximize2 className="size-3.5" />
            全屏放映
          </Button>
        </div>
      </div>

      {/* 第二排精简属性条：颜色、粗细/字号、板面主题与底纹 */}
      <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl px-3.5 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          {/* 色板 */}
          <div className="flex items-center gap-1.5">
            {theme.swatches.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setColor(c)
                  if (editingText) setEditingText((cur) => (cur ? { ...cur, color: c } : null))
                }}
                className={cn(
                  'size-6 rounded-full border border-black/15 transition-transform hover:scale-110 dark:border-white/25',
                  color === c && 'ring-primary ring-offset-background scale-110 ring-2 ring-offset-2',
                )}
                style={{ backgroundColor: c }}
                title={`颜色 ${c}`}
              />
            ))}
            <label
              title="自定义颜色"
              className="relative size-6 cursor-pointer overflow-hidden rounded-full border border-black/15 bg-[conic-gradient(red,yellow,lime,aqua,blue,magenta,red)]"
            >
              <input
                type="color"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value)
                  if (editingText) setEditingText((cur) => (cur ? { ...cur, color: e.target.value } : null))
                }}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
          </div>

          <div className="bg-foreground/10 h-4 w-px" />

          {/* 根据当前工具切换：文字属性 或 笔触粗细 */}
          {tool === 'text' || editingText ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {TEXT_SIZES.map((s) => {
                const active = (editingText?.fontSize ?? fontSize) === s.value
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => {
                      setFontSize(s.value)
                      if (editingText) setEditingText((cur) => (cur ? { ...cur, fontSize: s.value } : null))
                    }}
                    className={cn(
                      'rounded-lg border px-2 py-0.5 font-medium transition',
                      active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-foreground/10 text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {s.label}
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => {
                  const next = !fontBold
                  setFontBold(next)
                  if (editingText) setEditingText((cur) => (cur ? { ...cur, bold: next } : null))
                }}
                className={cn(
                  'rounded-lg border px-2 py-0.5 font-bold transition',
                  (editingText?.bold ?? fontBold)
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-foreground/10 text-muted-foreground',
                )}
              >
                B
              </button>
              <select
                value={editingText?.fontStyle ?? fontStyle}
                onChange={(e) => {
                  const next = e.target.value as TextFontStyle
                  setFontStyle(next)
                  if (editingText) setEditingText((cur) => (cur ? { ...cur, fontStyle: next } : null))
                }}
                className="bg-background rounded-lg border px-2 py-0.5 text-xs outline-none"
              >
                <option value="sans">黑体</option>
                <option value="serif">楷/衬线</option>
                <option value="mono">代码等宽</option>
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              {STROKE_WIDTHS.map((w) => (
                <button
                  key={w.value}
                  type="button"
                  onClick={() => setStrokeWidth(w.value)}
                  className={cn(
                    'rounded-lg border px-2 py-0.5 font-medium transition',
                    strokeWidth === w.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-foreground/10 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {w.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 板面主题与底纹 */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            {BOARD_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => switchTheme(t.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 font-medium transition',
                  themeId === t.id
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-foreground/10 text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="size-3 rounded-full border border-black/20" style={{ backgroundColor: t.bg }} />
                {t.label}
              </button>
            ))}
          </div>

          <div className="bg-foreground/10 hidden h-4 w-px sm:block" />

          <div className="flex items-center gap-1">
            <Grid2x2 className="text-muted-foreground size-3.5" />
            {PATTERN_LIST.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPattern(p.id)}
                className={cn(
                  'rounded-lg px-2 py-0.5 font-medium transition',
                  pattern === p.id
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 主黑板舞台（支持像 PPT 一样全屏沉浸展示） */}
      <div
        ref={stageRef}
        onMouseMove={bumpHud}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const file = Array.from(e.dataTransfer.files).find(isImageLike)
          if (file) void insertImageFile(file)
        }}
        className={cn(
          'relative flex items-center justify-center overflow-hidden select-none',
          isFullscreen
            ? 'fixed inset-0 z-50 h-dvh w-screen bg-black'
            : 'rounded-2xl border border-black/15 bg-black/90 p-1.5 shadow-xl sm:p-2 dark:border-white/10',
        )}
      >
        {/* 严格保持 16:9 比例的逻辑画布容器 */}
        <div
          ref={boardWrapRef}
          className={cn(
            'relative overflow-hidden',
            isFullscreen
              ? 'aspect-video max-h-full max-w-full w-full'
              : 'aspect-video w-full rounded-xl',
          )}
          style={
            isFullscreen
              ? {
                  width: 'min(100vw, calc(100dvh * 16 / 9))',
                  height: 'min(100dvh, calc(100vw * 9 / 16))',
                }
              : undefined
          }
        >
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDoubleClick={handleDoubleClick}
            className="block h-full w-full touch-none"
            style={{ cursor: cursorStyle }}
          />

          {/* 就地实时文字输入框（按 1920×1080 百分比精准定位，所见即所得） */}
          {editingText && (
            <textarea
              ref={textAreaRef}
              value={editingText.text}
              onChange={(e) => setEditingText((cur) => (cur ? { ...cur, text: e.target.value } : null))}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  commitEditingText()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  commitEditingText()
                }
              }}
              onBlur={commitEditingText}
              placeholder="输入文字（Ctrl+Enter 确认）"
              rows={Math.max(1, editingText.text.split('\n').length)}
              style={{
                left: `${(editingText.x / BOARD_W) * 100}%`,
                top: `${(editingText.y / BOARD_H) * 100}%`,
                color: editingText.color,
                fontFamily: FONT_FAMILY_MAP[editingText.fontStyle],
                fontWeight: editingText.bold ? 700 : 500,
                fontSize: `${(editingText.fontSize / BOARD_H) * (boardWrapRef.current?.clientHeight || 540)}px`,
                lineHeight: 1.35,
              }}
              className="absolute z-20 min-w-[140px] max-w-[80%] resize-none rounded-lg border border-sky-400/70 bg-black/25 px-2 py-0.5 outline-none backdrop-blur-[2px]"
            />
          )}

          {/* 全屏休场幕布（按 B 黑屏 / 按 W 白屏，点击任意处恢复） */}
          {isFullscreen && curtain !== 'none' && (
            <button
              type="button"
              onClick={() => setCurtain('none')}
              className={cn(
                'absolute inset-0 z-30 flex items-end justify-center pb-8 text-xs',
                curtain === 'black' ? 'bg-black text-white/35' : 'bg-white text-black/35',
              )}
            >
              点击画面或再按一次 {curtain === 'black' ? 'B' : 'W'} / ESC 恢复黑板
            </button>
          )}
        </div>

        {/* 全屏放映态自动隐藏的悬浮控制底栏 */}
        {isFullscreen && (
          <div
            onMouseEnter={() => {
              setHudVisible(true)
              if (hudTimerRef.current !== null) window.clearTimeout(hudTimerRef.current)
            }}
            onMouseLeave={bumpHud}
            className={cn(
              'fixed bottom-5 left-1/2 z-40 flex max-w-[95vw] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-white/15 bg-slate-950/85 px-3 py-2 text-xs text-white shadow-2xl backdrop-blur-xl transition-all duration-300',
              hudVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0',
            )}
          >
            <button
              type="button"
              onClick={() => setTool('laser')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 font-medium transition',
                tool === 'laser' ? 'bg-rose-500 text-white shadow' : 'text-white/75 hover:bg-white/10 hover:text-white',
              )}
            >
              <Pointer className="size-3.5" />
              激光笔
            </button>
            <button
              type="button"
              onClick={() => setTool('pen')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 font-medium transition',
                tool === 'pen' ? 'bg-primary text-white' : 'text-white/75 hover:bg-white/10 hover:text-white',
              )}
            >
              <PenTool className="size-3.5" />
              画笔
            </button>
            <button
              type="button"
              onClick={() => setTool('highlighter')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 font-medium transition',
                tool === 'highlighter' ? 'bg-primary text-white' : 'text-white/75 hover:bg-white/10 hover:text-white',
              )}
            >
              <Highlighter className="size-3.5" />
              荧光笔
            </button>
            <button
              type="button"
              onClick={() => setTool('text')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 font-medium transition',
                tool === 'text' ? 'bg-primary text-white' : 'text-white/75 hover:bg-white/10 hover:text-white',
              )}
            >
              <Type className="size-3.5" />
              文字
            </button>
            <button
              type="button"
              onClick={() => setTool('eraser')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 font-medium transition',
                tool === 'eraser' ? 'bg-primary text-white' : 'text-white/75 hover:bg-white/10 hover:text-white',
              )}
            >
              <Eraser className="size-3.5" />
              擦除
            </button>

            <div className="mx-1 h-4 w-px bg-white/15" />

            {/* 全屏快捷换色 */}
            <div className="flex items-center gap-1">
              {theme.swatches.slice(0, 5).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    'size-5 rounded-full border border-white/30 transition',
                    color === c && 'scale-125 ring-2 ring-white',
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>

            <div className="mx-1 h-4 w-px bg-white/15" />

            <button
              type="button"
              disabled={past.length === 0}
              onClick={undo}
              title="撤销"
              className="rounded-xl p-1.5 text-white/80 hover:bg-white/10 disabled:opacity-35"
            >
              <Undo2 className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setCurtain((c) => (c === 'black' ? 'none' : 'black'))}
              title="黑屏休场 (快捷键 B)"
              className="rounded-xl px-2 py-1.5 text-white/80 hover:bg-white/10"
            >
              黑屏(B)
            </button>
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              className="inline-flex items-center gap-1 rounded-xl bg-white/15 px-2.5 py-1.5 font-semibold text-white hover:bg-white/25"
            >
              <Minimize2 className="size-3.5" />
              退出(ESC)
            </button>
          </div>
        )}
      </div>

      {/* 底部极简提示条 */}
      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 px-1 text-xs">
        <div>
          快捷操作：<kbd className="bg-muted rounded px-1 font-mono">Ctrl+V</kbd> 直接粘贴截图到黑板 · 双击文字二次编辑 ·{' '}
          <kbd className="bg-muted rounded px-1 font-mono">Ctrl+Z</kbd> 撤销 · 全屏模式默认开启激光笔，按{' '}
          <kbd className="bg-muted rounded px-1 font-mono">B</kbd>/<kbd className="bg-muted rounded px-1 font-mono">W</kbd> 休场黑/白屏
        </div>
        <span>板书自动本地暂存，刷新不丢失</span>
      </div>
    </div>
  )
}
