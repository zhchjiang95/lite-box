import { AnimatePresence, motion } from 'motion/react'
import {
  Check,
  Copy,
  Dices,
  Download,
  History,
  Maximize2,
  Minimize2,
  Play,
  RotateCcw,
  Shuffle,
  Sparkles,
  Trash2,
  Trophy,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { Button } from '@/components/ui/button'
import { Field, Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { Slider } from '@/components/ui/slider'
import { downloadBlob, timestampName } from '@/lib/file'
import { cn, uid } from '@/lib/utils'
import { launchConfetti, playTickSound, playWinFanfare } from './sound'
import {
  PICKER_PRESETS,
  parseItemsText,
  pickWeightedRandom,
  shuffleLines,
  type DrawRecord,
  type PickerItem,
  type PickerMode,
} from './types'
import { WheelCanvas, type WheelCanvasHandle } from './WheelCanvas'

function formatNowTime() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export default function RandomPicker() {
  const [mode, setMode] = useState<PickerMode>('wheel')
  const [stageTitle, setStageTitle] = useState(PICKER_PRESETS[0].title)
  const [itemsText, setItemsText] = useState(PICKER_PRESETS[0].itemsText)
  const [drawCount, setDrawCount] = useState(1)
  const [removeAfterPick, setRemoveAfterPick] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [confettiEnabled, setConfettiEnabled] = useState(true)
  const [spinDurationSec, setSpinDurationSec] = useState(4.2)

  // 已抽中移出的项（仅在 removeAfterPick 开启时生效）
  const [excludedIds, setExcludedIds] = useState<Set<string>>(() => new Set())
  // 转盘揭晓瞬间暂存展示快照，避免扇区立刻消失导致指针视觉跳变
  const [frozenWheelItems, setFrozenWheelItems] = useState<PickerItem[] | null>(null)

  const [isRunning, setIsRunning] = useState(false)
  const [rollingLabels, setRollingLabels] = useState<string[]>([])
  const [currentWinners, setCurrentWinners] = useState<PickerItem[]>([])
  const [history, setHistory] = useState<DrawRecord[]>([])
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // 全屏沉浸状态（优先原生 Fullscreen API，不支持时平滑降级为视口铺满全屏）
  const [nativeFs, setNativeFs] = useState(false)
  const [pseudoFs, setPseudoFs] = useState(false)
  const [fsHistoryOpen, setFsHistoryOpen] = useState(false)
  const [stageSize, setStageSize] = useState({ w: 560, h: 460 })

  const isFullscreen = nativeFs || pseudoFs

  const stageRef = useRef<HTMLDivElement>(null)
  const confettiCanvasRef = useRef<HTMLCanvasElement>(null)
  const wheelRef = useRef<WheelCanvasHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const confettiStopRef = useRef<(() => void) | null>(null)
  const drawTimerRef = useRef<number | null>(null)
  const pendingDrawWinnersRef = useRef<PickerItem[] | null>(null)

  const allItems = useMemo(() => parseItemsText(itemsText), [itemsText])
  const availableItems = useMemo(
    () => (removeAfterPick ? allItems.filter((it) => !excludedIds.has(it.id)) : allItems),
    [allItems, removeAfterPick, excludedIds],
  )

  const wheelItems = frozenWheelItems ?? availableItems

  const hasWeights = useMemo(() => allItems.some((it) => it.weight !== 1), [allItems])

  // 监听原生全屏变化
  useEffect(() => {
    const onFsChange = () => {
      const active = document.fullscreenElement === stageRef.current
      setNativeFs(active)
      if (!active) setFsHistoryOpen(false)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // 伪全屏下锁定页面滚动并支持 ESC 退出
  useEffect(() => {
    if (!pseudoFs) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPseudoFs(false)
        setFsHistoryOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [pseudoFs])

  // 动态测量舞台尺寸以计算最舒展的转盘直径
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = () => {
      setStageSize({ w: el.clientWidth, h: el.clientHeight })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [isFullscreen])

  // 卸载清理定时器与礼花动画
  useEffect(() => {
    return () => {
      if (drawTimerRef.current !== null) window.clearTimeout(drawTimerRef.current)
      confettiStopRef.current?.()
    }
  }, [])

  /** 切换全屏沉浸模式 */
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
      setFsHistoryOpen(false)
      return
    }

    if (typeof el.requestFullscreen === 'function') {
      try {
        await el.requestFullscreen()
        return
      } catch {
        // 某些受限环境或移动端降级为 CSS 视口全屏
      }
    }
    setPseudoFs(true)
  }, [nativeFs, pseudoFs])

  /** 触发礼花与胜利音效并记录历史 */
  const celebrateWinners = useCallback(
    (winners: PickerItem[], usedMode: PickerMode) => {
      setCurrentWinners(winners)
      setHistory((prev) => [
        {
          id: uid(),
          round: prev.length + 1,
          mode: usedMode,
          winners: winners.map((w) => w.label),
          time: formatNowTime(),
        },
        ...prev,
      ])

      if (removeAfterPick) {
        setExcludedIds((prev) => {
          const next = new Set(prev)
          winners.forEach((w) => next.add(w.id))
          return next
        })
      }

      if (soundEnabled) playWinFanfare()
      if (confettiEnabled && confettiCanvasRef.current) {
        confettiStopRef.current?.()
        confettiStopRef.current = launchConfetti(confettiCanvasRef.current)
      }
    },
    [removeAfterPick, soundEnabled, confettiEnabled],
  )

  /** 转盘开始与结束回调 */
  const handleWheelSpinStart = useCallback(() => {
    setIsRunning(true)
    setCurrentWinners([])
  }, [])

  const handleWheelSpinEnd = useCallback(
    (winner: PickerItem) => {
      setIsRunning(false)
      // 若开启不重复，先冻结当前转盘画面直到下一轮开转，防止扇区突兀消失
      if (removeAfterPick) {
        setFrozenWheelItems(availableItems)
      }
      celebrateWinners([winner], 'wheel')
    },
    [removeAfterPick, availableItems, celebrateWinners],
  )

  /** 启动一轮转盘 */
  const triggerWheel = useCallback(() => {
    if (isRunning) return
    if (availableItems.length < 2) {
      toast.error(
        removeAfterPick && allItems.length >= 2
          ? '候选池已不足 2 项，请点击「重置抽签池」继续'
          : '转盘至少需要 2 个候选项',
      )
      return
    }
    // 解除上轮冻结，立即以最新剩余池开转
    if (frozenWheelItems) {
      setFrozenWheelItems(null)
      requestAnimationFrame(() => wheelRef.current?.spin())
    } else {
      wheelRef.current?.spin()
    }
  }, [isRunning, availableItems.length, removeAfterPick, allItems.length, frozenWheelItems])

  /** 立即结束滚动抽签并揭晓 */
  const finishDrawNow = useCallback(() => {
    if (drawTimerRef.current !== null) {
      window.clearTimeout(drawTimerRef.current)
      drawTimerRef.current = null
    }
    const winners = pendingDrawWinnersRef.current
    pendingDrawWinnersRef.current = null
    setIsRunning(false)
    setRollingLabels([])
    if (winners && winners.length > 0) {
      celebrateWinners(winners, 'draw')
    }
  }, [celebrateWinners])

  /** 启动一轮滚动抽签（支持一次抽多人，带逐帧减速悬念） */
  const triggerDraw = useCallback(() => {
    if (isRunning) {
      // 滚动中再次点击 / 按空格直接瞬间揭晓
      finishDrawNow()
      return
    }
    if (availableItems.length === 0) {
      toast.error(
        removeAfterPick && allItems.length > 0
          ? '所有候选项已抽完，请点击「重置抽签池」'
          : '请先输入至少 1 个候选项',
      )
      return
    }

    const actualCount = Math.min(drawCount, availableItems.length)
    const winners = pickWeightedRandom(availableItems, actualCount)
    pendingDrawWinnersRef.current = winners
    setIsRunning(true)
    setCurrentWinners([])

    const totalSteps = 26
    let step = 0

    const tick = () => {
      step += 1
      const previewPick = pickWeightedRandom(availableItems, actualCount)
      setRollingLabels(previewPick.map((p) => p.label))
      if (soundEnabled) playTickSound(0.85 + (1 - step / totalSteps) * 0.35)

      if (step >= totalSteps) {
        finishDrawNow()
        return
      }
      // 间隔从 45ms 平滑减速至 240ms，营造倒计时悬念
      const progress = step / totalSteps
      const delay = Math.round(45 + Math.pow(progress, 2.4) * 210)
      drawTimerRef.current = window.setTimeout(tick, delay)
    }

    tick()
  }, [isRunning, availableItems, removeAfterPick, allItems.length, drawCount, soundEnabled, finishDrawNow])

  /** 统一触发入口（供主按钮与空格键快捷键调用） */
  const triggerAction = useCallback(() => {
    if (mode === 'wheel') triggerWheel()
    else triggerDraw()
  }, [mode, triggerWheel, triggerDraw])

  // 空格键快捷抽签（不在输入框内聚焦时生效，全屏大屏演示极其顺手）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'BUTTON' ||
          target.isContentEditable)
      ) {
        return
      }
      e.preventDefault()
      triggerAction()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [triggerAction])

  /** 载入预设场景 */
  const applyPreset = (presetId: string) => {
    const p = PICKER_PRESETS.find((item) => item.id === presetId)
    if (!p) return
    setStageTitle(p.title)
    setItemsText(p.itemsText)
    setMode(p.mode)
    setExcludedIds(new Set())
    setFrozenWheelItems(null)
    setCurrentWinners([])
    toast.success(`已载入场景「${p.label}」`)
  }

  /** 快速生成 1~N 序号名单 */
  const generateNumbers = (count: number) => {
    const lines = Array.from({ length: count }, (_, i) => `${i + 1} 号`).join('\n')
    setItemsText(lines)
    setExcludedIds(new Set())
    setFrozenWheelItems(null)
    setCurrentWinners([])
    toast.success(`已生成 1 ~ ${count} 号抽签池`)
  }

  /** 导入本地 TXT / CSV 名单 */
  const handleImportList = async (file: File) => {
    try {
      const content = await file.text()
      const cleaned = content
        .split(/[\r\n,，]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join('\n')
      if (!cleaned) {
        toast.error('未读取到有效名单内容')
        return
      }
      setItemsText(cleaned)
      setExcludedIds(new Set())
      setFrozenWheelItems(null)
      setCurrentWinners([])
      toast.success(`已导入 ${cleaned.split('\n').length} 个候选项`)
    } catch {
      toast.error('导入文件失败，请确认为 UTF-8 文本或 CSV')
    }
  }

  /** 重置不重复抽签池 */
  const resetPool = () => {
    setExcludedIds(new Set())
    setFrozenWheelItems(null)
    setCurrentWinners([])
    toast.success('已重置全部候选项')
  }

  /** 复制或导出中奖历史 */
  const copyHistory = async () => {
    if (!history.length) return
    const text = history
      .slice()
      .reverse()
      .map((h) => `第 ${h.round} 轮（${h.time}）：${h.winners.join('、')}`)
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey('history')
      toast.success('已复制全部抽签记录')
      setTimeout(() => setCopiedKey(null), 1500)
    } catch {
      toast.error('复制失败')
    }
  }

  const exportHistory = () => {
    if (!history.length) return
    const lines = [
      '轮次,时间,模式,抽中结果',
      ...history
        .slice()
        .reverse()
        .map((h) => `${h.round},${h.time},${h.mode === 'wheel' ? '大转盘' : '滚动抽签'},"${h.winners.join('、').replace(/"/g, '""')}"`),
    ]
    downloadBlob(
      new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }),
      timestampName('抽签记录', 'csv'),
    )
    toast.success('已导出抽签记录 CSV')
  }

  // 计算转盘最适直径（普通视口紧凑协调，全屏大屏舒展大气）
  const wheelSizePx = useMemo(() => {
    if (isFullscreen) {
      return Math.round(Math.max(280, Math.min(stageSize.h * 0.58, stageSize.w * 0.72, 600)))
    }
    return Math.round(Math.max(260, Math.min(stageSize.w - 48, 410)))
  }, [isFullscreen, stageSize])

  /** 左侧参数面板 */
  const panel = (
    <div className="space-y-5">
      <Segmented<PickerMode>
        value={mode}
        onChange={(v) => {
          if (isRunning) return
          setMode(v)
          setFrozenWheelItems(null)
        }}
        options={[
          { value: 'wheel', label: '幸运大转盘' },
          { value: 'draw', label: '滚动抽签' },
        ]}
      />

      {/* 快捷场景预设 */}
      <Field label="快捷场景预设">
        <div className="flex flex-wrap gap-1.5">
          {PICKER_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p.id)}
              className="border-foreground/10 hover:border-primary/50 hover:text-primary rounded-lg border px-2.5 py-1 text-xs font-medium transition"
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>

      {/* 大屏活动标题 */}
      <Field label="舞台大屏标题">
        <input
          type="text"
          value={stageTitle}
          onChange={(e) => setStageTitle(e.target.value)}
          placeholder="例如：今天吃什么？ / 年会幸运抽奖"
          className="bg-background focus:border-primary w-full rounded-xl border px-3 py-2 text-xs font-medium outline-none"
        />
      </Field>

      {/* 候选名单编辑 */}
      <Field
        label="候选项 / 名单"
        value={
          removeAfterPick
            ? `剩 ${availableItems.length} / ${allItems.length} 项`
            : `共 ${allItems.length} 项`
        }
      >
        <div className="space-y-2">
          <textarea
            rows={7}
            value={itemsText}
            onChange={(e) => {
              setItemsText(e.target.value)
              setFrozenWheelItems(null)
            }}
            placeholder="每行一个选项；支持权重语法，如：一等奖 * 2"
            className="bg-background focus:border-primary w-full resize-y rounded-xl border p-2.5 font-mono text-xs leading-relaxed outline-none"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                setItemsText((prev) => shuffleLines(prev))
                setFrozenWheelItems(null)
              }}
            >
              <Shuffle className="size-3" />
              打乱
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => generateNumbers(30)}
            >
              1~30号
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => generateNumbers(50)}
            >
              1~50号
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-3" />
              导入名单
            </Button>
          </div>
          <p className="text-muted-foreground text-[11px]">
            小技巧：在行尾加 <code className="bg-muted rounded px-1">* 权重</code> 可调整中签概率（如 <code className="bg-muted rounded px-1">火锅 * 3</code>）。
          </p>
        </div>
      </Field>

      {/* 抽签人数（滚动抽签模式） */}
      {mode === 'draw' ? (
        <Field label="单次抽取人数" value={`${drawCount} 个`}>
          <div className="mb-2 flex gap-1.5">
            {[1, 2, 3, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setDrawCount(n)}
                className={cn(
                  'flex-1 rounded-lg border py-1 text-xs font-medium transition',
                  drawCount === n
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-foreground/10 text-muted-foreground hover:text-foreground',
                )}
              >
                {n} 个
              </button>
            ))}
          </div>
          <Slider value={drawCount} min={1} max={12} step={1} onChange={setDrawCount} />
        </Field>
      ) : (
        <Field label="转盘旋转时长" value={`${spinDurationSec.toFixed(1)} 秒`}>
          <Slider
            value={spinDurationSec}
            min={2}
            max={7}
            step={0.2}
            onChange={setSpinDurationSec}
          />
        </Field>
      )}

      {/* 规则与沉浸感开关 */}
      <div className="space-y-3 border-t pt-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-medium">不重复抽签（抽后移出）</div>
            <div className="text-muted-foreground text-[11px]">适合点名、发奖、依次排班</div>
          </div>
          <Switch
            checked={removeAfterPick}
            onChange={(v) => {
              setRemoveAfterPick(v)
              if (!v) setFrozenWheelItems(null)
            }}
            label="不重复抽签"
          />
        </div>

        {removeAfterPick && excludedIds.size > 0 && (
          <Button variant="outline" size="sm" className="w-full" onClick={resetPool}>
            <RotateCcw className="size-3.5" />
            重置抽签池（已抽 {excludedIds.size} 项）
          </Button>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium">拨片与揭晓音效</span>
          <Switch checked={soundEnabled} onChange={setSoundEnabled} label="音效开关" />
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium">中签礼花彩带</span>
          <Switch checked={confettiEnabled} onChange={setConfettiEnabled} label="礼花开关" />
        </div>
      </div>
    </div>
  )

  const actions = (
    <>
      <Button variant="primary" size="lg" onClick={triggerAction}>
        <Play />
        {isRunning ? (mode === 'draw' ? '立即揭晓' : '转动中…') : mode === 'wheel' ? '开始转盘' : '开始抽签'}
      </Button>
      <Button variant="outline" size="lg" onClick={() => void toggleFullscreen()}>
        <Maximize2 />
        全屏沉浸
      </Button>
    </>
  )

  return (
    <ToolShell panel={panel} actions={actions} panelTitle="抽签与舞台设置">
      <div className="space-y-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.csv,text/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void handleImportList(f)
          }}
        />

        {/* 核心抽签舞台容器（支持一键进入真全屏沉浸大屏模式） */}
        <div
          ref={stageRef}
          className={cn(
            'relative flex flex-col overflow-hidden transition-all',
            isFullscreen
              ? 'fixed inset-0 z-50 h-dvh w-screen bg-[#070b18] text-white'
              : 'glass min-h-[560px] rounded-3xl',
          )}
        >
          {/* 沉浸式动态聚光极光氛围背景 */}
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-0 transition-opacity duration-500',
              isFullscreen ? 'opacity-100' : 'opacity-65 dark:opacity-80',
            )}
            style={{
              background: isFullscreen
                ? 'radial-gradient(circle at 50% 35%, rgba(99, 102, 241, 0.34), transparent 56%), radial-gradient(circle at 18% 82%, rgba(236, 72, 153, 0.24), transparent 48%), radial-gradient(circle at 82% 78%, rgba(14, 165, 233, 0.24), transparent 48%)'
                : 'radial-gradient(circle at 50% 25%, rgba(99, 102, 241, 0.12), transparent 60%), radial-gradient(circle at 85% 85%, rgba(236, 72, 153, 0.1), transparent 50%)',
            }}
          />

          {/* 礼花彩带画布（置于舞台内部，全屏模式同样丝滑绽放） */}
          <canvas
            ref={confettiCanvasRef}
            className="pointer-events-none absolute inset-0 z-30 h-full w-full"
          />

          {/* 舞台顶部 HUD 栏 */}
          <div
            className={cn(
              'relative z-20 flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6',
              isFullscreen ? 'border-b border-white/10 bg-white/[0.03] backdrop-blur-md' : 'border-b',
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                  isFullscreen ? 'bg-white/10 text-white/90' : 'bg-primary/10 text-primary',
                )}
              >
                <Dices className="size-3.5" />
                {mode === 'wheel' ? '幸运大转盘' : `滚动抽签 · 每次 ${Math.min(drawCount, Math.max(1, availableItems.length))} 项`}
              </span>
              <span
                className={cn(
                  'rounded-full px-2.5 py-1 font-mono text-xs',
                  isFullscreen ? 'bg-white/10 text-white/75' : 'bg-muted text-muted-foreground',
                )}
              >
                候选池 {availableItems.length} / {allItems.length}
                {hasWeights ? ' · 含权重' : ''}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {/* 全屏模式下的便捷快捷控制 */}
              {isFullscreen && (
                <>
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => {
                      setMode((m) => (m === 'wheel' ? 'draw' : 'wheel'))
                      setFrozenWheelItems(null)
                    }}
                    className="rounded-xl border border-white/15 bg-white/10 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-white/20 disabled:opacity-40"
                  >
                    切至{mode === 'wheel' ? '滚动抽签' : '大转盘'}
                  </button>
                  {mode === 'draw' && (
                    <div className="hidden items-center gap-1 rounded-xl border border-white/15 bg-white/10 p-0.5 sm:flex">
                      {[1, 2, 3, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setDrawCount(n)}
                          className={cn(
                            'rounded-lg px-2 py-1 text-xs font-medium transition',
                            drawCount === n ? 'bg-white text-slate-950' : 'text-white/75 hover:text-white',
                          )}
                        >
                          抽{n}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setFsHistoryOpen((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-xl border border-white/15 bg-white/10 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-white/20"
                  >
                    <History className="size-3.5" />
                    记录 ({history.length})
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => setSoundEnabled((v) => !v)}
                title={soundEnabled ? '关闭音效' : '开启音效'}
                className={cn(
                  'inline-flex size-8 items-center justify-center rounded-xl border transition',
                  isFullscreen
                    ? 'border-white/15 bg-white/10 text-white hover:bg-white/20'
                    : 'border-foreground/10 hover:bg-foreground/5',
                )}
              >
                {soundEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4 opacity-60" />}
              </button>

              <button
                type="button"
                onClick={() => void toggleFullscreen()}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition',
                  isFullscreen
                    ? 'border-white/20 bg-white/15 text-white hover:bg-white/25'
                    : 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20',
                )}
              >
                {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                {isFullscreen ? '退出全屏' : '全屏沉浸'}
              </button>
            </div>
          </div>

          {/* 舞台中央核心表演区 */}
          <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-5 px-4 py-6 sm:px-8">
            {/* 活动主标题 */}
            {stageTitle.trim() && (
              <h2
                className={cn(
                  'text-center font-extrabold tracking-tight',
                  isFullscreen
                    ? 'bg-gradient-to-r from-white via-sky-200 to-violet-200 bg-clip-text text-3xl text-transparent sm:text-5xl'
                    : 'text-xl sm:text-2xl',
                )}
              >
                {stageTitle}
              </h2>
            )}

            {/* 模式一：幸运大转盘 */}
            {mode === 'wheel' ? (
              <div className="flex flex-col items-center gap-5">
                <WheelCanvas
                  ref={wheelRef}
                  items={wheelItems}
                  spinning={isRunning}
                  soundEnabled={soundEnabled}
                  durationMs={spinDurationSec * 1000}
                  sizePx={wheelSizePx}
                  isFullscreen={isFullscreen}
                  onSpinStart={handleWheelSpinStart}
                  onSpinEnd={handleWheelSpinEnd}
                />

                {/* 揭晓结果高亮条 */}
                <div className="min-h-[64px] w-full max-w-xl text-center">
                  <AnimatePresence mode="wait">
                    {currentWinners.length > 0 ? (
                      <motion.div
                        key={currentWinners[0].id + history.length}
                        initial={{ opacity: 0, scale: 0.85, y: 12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ type: 'spring', stiffness: 360, damping: 24 }}
                        className={cn(
                          'inline-flex items-center gap-3 rounded-2xl border px-6 py-3 shadow-xl',
                          isFullscreen
                            ? 'border-amber-300/40 bg-gradient-to-r from-amber-500/25 via-pink-500/25 to-indigo-500/25 text-white backdrop-blur-md'
                            : 'border-primary/30 bg-primary/10 text-foreground',
                        )}
                      >
                        <Trophy className="size-6 shrink-0 text-amber-400" />
                        <span className={cn('font-extrabold', isFullscreen ? 'text-2xl sm:text-4xl' : 'text-xl sm:text-2xl')}>
                          {currentWinners[0].label}
                        </span>
                      </motion.div>
                    ) : (
                      <motion.p
                        key="hint"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className={cn('pt-3 text-xs sm:text-sm', isFullscreen ? 'text-white/55' : 'text-muted-foreground')}
                      >
                        {isRunning
                          ? '好运正在旋转中…'
                          : '点击转盘中心 GO、下方按钮或按下键盘 空格键 开始转动'}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            ) : (
              /* 模式二：大屏滚动抽签 / 点名 */
              <div className="flex w-full max-w-4xl flex-col items-center gap-6">
                <div
                  className={cn(
                    'flex w-full items-center justify-center rounded-3xl border p-6 sm:p-10',
                    isFullscreen
                      ? 'min-h-[260px] border-white/15 bg-white/[0.06] shadow-2xl backdrop-blur-xl sm:min-h-[340px]'
                      : 'bg-background/60 min-h-[230px] shadow-inner',
                  )}
                >
                  {isRunning && rollingLabels.length > 0 ? (
                    <div
                      className={cn(
                        'grid w-full gap-4',
                        rollingLabels.length === 1
                          ? 'grid-cols-1'
                          : rollingLabels.length === 2
                            ? 'grid-cols-1 sm:grid-cols-2'
                            : 'grid-cols-2 sm:grid-cols-3',
                      )}
                    >
                      {rollingLabels.map((lbl, idx) => (
                        <div
                          key={idx}
                          className={cn(
                            'flex items-center justify-center rounded-2xl border px-5 py-6 text-center font-black tracking-wide',
                            isFullscreen
                              ? 'border-sky-400/30 bg-sky-500/15 text-3xl text-white sm:text-5xl'
                              : 'border-primary/25 bg-primary/10 text-2xl sm:text-3xl',
                          )}
                        >
                          {lbl}
                        </div>
                      ))}
                    </div>
                  ) : currentWinners.length > 0 ? (
                    <div
                      className={cn(
                        'grid w-full gap-4',
                        currentWinners.length === 1
                          ? 'grid-cols-1'
                          : currentWinners.length === 2
                            ? 'grid-cols-1 sm:grid-cols-2'
                            : 'grid-cols-2 sm:grid-cols-3',
                      )}
                    >
                      {currentWinners.map((winner, idx) => (
                        <motion.div
                          key={`${winner.id}-${idx}-${history.length}`}
                          initial={{ opacity: 0, scale: 0.72, y: 18 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          transition={{ type: 'spring', stiffness: 360, damping: 22, delay: idx * 0.06 }}
                          className={cn(
                            'relative flex flex-col items-center justify-center gap-2 rounded-2xl border px-5 py-7 text-center shadow-xl',
                            isFullscreen
                              ? 'border-amber-300/45 bg-gradient-to-br from-amber-500/25 via-rose-500/20 to-indigo-500/25 text-white'
                              : 'border-primary/30 bg-gradient-to-br from-primary/15 to-accent/15',
                          )}
                        >
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-2.5 py-0.5 text-[11px] font-semibold text-amber-400">
                            <Trophy className="size-3" />
                            幸运揭晓 {currentWinners.length > 1 ? `#${idx + 1}` : ''}
                          </span>
                          <span
                            className={cn(
                              'font-black tracking-wide break-all',
                              currentWinners.length === 1
                                ? isFullscreen
                                  ? 'text-4xl sm:text-6xl'
                                  : 'text-3xl sm:text-5xl'
                                : isFullscreen
                                  ? 'text-2xl sm:text-4xl'
                                  : 'text-xl sm:text-2xl',
                            )}
                          >
                            {winner.label}
                          </span>
                        </motion.div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3 text-center">
                      <div
                        className={cn(
                          'flex size-16 items-center justify-center rounded-2xl',
                          isFullscreen ? 'bg-white/10 text-sky-300' : 'bg-primary/10 text-primary',
                        )}
                      >
                        <Sparkles className="size-8" />
                      </div>
                      <div className={cn('text-lg font-bold sm:text-xl', isFullscreen ? 'text-white' : 'text-foreground')}>
                        准备就绪 · 共 {availableItems.length} 个候选项
                      </div>
                      <p className={cn('text-xs sm:text-sm', isFullscreen ? 'text-white/60' : 'text-muted-foreground')}>
                        点击下方大按钮或按键盘 <kbd className="rounded border px-1.5 py-0.5 font-mono text-[11px]">Space</kbd> 开始滚动抽签
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 舞台底部主控按钮 */}
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                disabled={mode === 'wheel' && isRunning}
                onClick={triggerAction}
                className={cn(
                  'from-primary to-accent inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r font-bold text-white shadow-lg transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60',
                  isFullscreen ? 'px-10 py-4 text-lg shadow-indigo-500/35' : 'px-7 py-3 text-sm',
                )}
              >
                <Play className="size-5 fill-current" />
                {isRunning
                  ? mode === 'draw'
                    ? '立即停下揭晓'
                    : '好运旋转中…'
                  : mode === 'wheel'
                    ? '开始转动（空格键）'
                    : `抽取 ${Math.min(drawCount, Math.max(1, availableItems.length))} 项（空格键）`}
              </button>

              {removeAfterPick && excludedIds.size > 0 && (
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={resetPool}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-2xl border px-4 py-3 text-xs font-semibold transition disabled:opacity-40',
                    isFullscreen
                      ? 'border-white/20 bg-white/10 text-white hover:bg-white/20'
                      : 'border-foreground/15 hover:bg-foreground/5',
                  )}
                >
                  <RotateCcw className="size-4" />
                  重置候选池
                </button>
              )}
            </div>
          </div>

          {/* 全屏模式右侧悬浮记录抽屉 */}
          <AnimatePresence>
            {isFullscreen && fsHistoryOpen && (
              <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', stiffness: 360, damping: 32 }}
                className="absolute inset-y-0 right-0 z-40 flex w-80 max-w-[85vw] flex-col border-l border-white/15 bg-slate-950/90 p-4 text-white backdrop-blur-xl"
              >
                <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Trophy className="size-4 text-amber-400" />
                    抽签结果记录（{history.length}）
                  </div>
                  <button
                    type="button"
                    onClick={() => setFsHistoryOpen(false)}
                    className="rounded-lg p-1 text-white/70 hover:bg-white/10 hover:text-white"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto">
                  {history.length === 0 ? (
                    <div className="py-12 text-center text-xs text-white/50">暂无中签记录</div>
                  ) : (
                    history.map((h) => (
                      <div key={h.id} className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs">
                        <div className="mb-1 flex items-center justify-between text-[11px] text-white/55">
                          <span>第 {h.round} 轮</span>
                          <span className="font-mono">{h.time}</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {h.winners.map((w, i) => (
                            <span key={i} className="rounded-md bg-amber-400/20 px-2 py-0.5 font-semibold text-amber-300">
                              {w}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {history.length > 0 && (
                  <div className="mt-3 flex gap-2 border-t border-white/10 pt-3">
                    <button
                      type="button"
                      onClick={() => void copyHistory()}
                      className="flex-1 rounded-xl bg-white/15 py-2 text-xs font-medium hover:bg-white/25"
                    >
                      复制全部
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistory([])}
                      className="rounded-xl bg-red-500/20 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-500/30"
                    >
                      清空
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 常规模式下的抽签历史面板 */}
        <div className="glass rounded-2xl p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <History className="text-primary size-4" />
              <span className="text-sm font-semibold">抽签记录</span>
              <span className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 font-mono text-[11px]">
                共 {history.length} 轮
              </span>
            </div>

            {history.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => void copyHistory()}>
                  {copiedKey === 'history' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  复制
                </Button>
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={exportHistory}>
                  <Download className="size-3.5" />
                  导出 CSV
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive h-7 px-2 text-xs"
                  onClick={() => setHistory([])}
                >
                  <Trash2 className="size-3.5" />
                  清空
                </Button>
              </div>
            )}
          </div>

          {history.length === 0 ? (
            <div className="text-muted-foreground py-6 text-center text-xs">
              开始抽签后，每一轮结果将自动记录在此处（支持全屏模式内随时查看）
            </div>
          ) : (
            <div className="max-h-60 space-y-2 overflow-y-auto">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="bg-background/60 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold">
                      #{h.round}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {h.winners.map((w, i) => (
                        <span key={i} className="font-semibold">
                          {w}
                          {i < h.winners.length - 1 ? '、' : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="text-muted-foreground font-mono text-[11px]">
                    {h.mode === 'wheel' ? '大转盘' : '滚动抽签'} · {h.time}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ToolShell>
  )
}
