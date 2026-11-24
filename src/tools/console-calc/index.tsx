import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import {
  BookOpen,
  Calculator,
  Check,
  ChevronRight,
  CornerDownLeft,
  Copy,
  Delete,
  Download,
  FileText,
  Hash,
  Keyboard,
  Search,
  Sparkles,
  Star,
  Terminal,
  Trash2,
  Variable,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { downloadBlob, timestampName } from '@/lib/file'
import { cn } from '@/lib/utils'
import {
  BUILTIN_FUNCTION_DOCS,
  evaluateExpression,
  evaluatePreview,
  evaluateScratchpad,
  formatChineseScale,
  formatRadices,
  formatResultValue,
  formatRmbUpperSimple,
  MATH_CONSTANTS,
  type AngleUnit,
  type CalcFunctionMeta,
} from './engine'

type ViewMode = 'console' | 'scratchpad'
type PrecisionMode = 'auto' | '2' | '4' | '6'
type DocCategory = 'all' | CalcFunctionMeta['category']

interface HistoryEntry {
  id: string
  /** 历史序号（递增，支持 #1 / $1 引用） */
  seq: number
  expr: string
  value: number
  assignedVar?: string
  preferredDisplay?: string
  starred?: boolean
  time: string
}

interface PersistedState {
  history: HistoryEntry[]
  variables: Record<string, number>
  angleUnit: AngleUnit
  thousands: boolean
  precision: PrecisionMode
  scratchpad: string
}

const STORAGE_KEY = 'litebox:console-calc:v1'

const QUICK_EXAMPLES = [
  { label: '0.1 + 0.2', hint: '零浮点误差' },
  { label: '200 + 15%', hint: '直观加百分比' },
  { label: '1.5万 * 12 + 8k', hint: '中文单位混算' },
  { label: '单价 = 299', hint: '中文变量赋值' },
  { label: '0xFF & 0b11001100', hint: '进制与位运算' },
  { label: 'avg(88, 92, 95, 100)', hint: '统计函数' },
]

const SCRATCHPAD_TEMPLATES: { id: string; name: string; content: string }[] = [
  {
    id: 'travel',
    name: '旅行预算',
    content: [
      '// 周末双人短途旅行预算',
      '人数 = 2',
      '往返高铁 = 328 * 人数',
      '酒店两晚 = 580 * 2',
      '餐饮预算 = 260 * 人数 * 2',
      '门票与市内交通 = 420',
      '',
      '// 预留 10% 机动费用',
      '基础总计 = 往返高铁 + 酒店两晚 + 餐饮预算 + 门票与市内交通',
      '基础总计 + 10%',
    ].join('\n'),
  },
  {
    id: 'salary',
    name: '年薪测算',
    content: [
      '// 年度总包快速估算',
      '月薪 = 2.4万',
      '月数 = 14',
      '年终绩效 = 1.5万',
      '基础年包 = 月薪 * 月数 + 年终绩效',
      '',
      '// 估算五险一金与个税后（示例系数 78%）',
      '基础年包 * 78%',
      'ans / 12 // 折合月均到手',
    ].join('\n'),
  },
  {
    id: 'party',
    name: '团建 AA 账单',
    content: [
      '// 部门聚餐 AA 分摊',
      '火锅买单 = 1288 - 15% // 85 折优惠',
      '奶茶甜品 = 186',
      'KTV包厢 = 460',
      '总花费 = 火锅买单 + 奶茶甜品 + KTV包厢',
      '总花费 / 8 // 8 人平摊',
    ].join('\n'),
  },
  {
    id: 'dev',
    name: '开发换算',
    content: [
      '// 常见二进制与存储计算',
      'MB = 1024 * 1024',
      'GB = MB * 1024',
      '4 * GB // 4GB 字节数',
      'hex(255 << 8 | 0xA5)',
      'bin(0x2A)',
      '2^16 - 1 // uint16 最大值',
    ].join('\n'),
  },
]

const KEYPAD_ROWS: { label: string; insert: string; variant?: 'op' | 'fn' | 'num' | 'accent' }[][] = [
  [
    { label: '(', insert: '(', variant: 'fn' },
    { label: ')', insert: ')', variant: 'fn' },
    { label: '%', insert: '%', variant: 'fn' },
    { label: '^', insert: '^', variant: 'fn' },
    { label: '√', insert: 'sqrt(', variant: 'fn' },
  ],
  [
    { label: '7', insert: '7', variant: 'num' },
    { label: '8', insert: '8', variant: 'num' },
    { label: '9', insert: '9', variant: 'num' },
    { label: '÷', insert: ' / ', variant: 'op' },
    { label: 'ans', insert: 'ans', variant: 'accent' },
  ],
  [
    { label: '4', insert: '4', variant: 'num' },
    { label: '5', insert: '5', variant: 'num' },
    { label: '6', insert: '6', variant: 'num' },
    { label: '×', insert: ' * ', variant: 'op' },
    { label: 'π', insert: 'pi', variant: 'fn' },
  ],
  [
    { label: '1', insert: '1', variant: 'num' },
    { label: '2', insert: '2', variant: 'num' },
    { label: '3', insert: '3', variant: 'num' },
    { label: '−', insert: ' - ', variant: 'op' },
    { label: '万', insert: '万', variant: 'fn' },
  ],
  [
    { label: '0', insert: '0', variant: 'num' },
    { label: '.', insert: '.', variant: 'num' },
    { label: '00', insert: '00', variant: 'num' },
    { label: '+', insert: ' + ', variant: 'op' },
    { label: '!', insert: '!', variant: 'fn' },
  ],
]

function loadInitialState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>
      return {
        history: Array.isArray(parsed.history) ? parsed.history : [],
        variables: parsed.variables && typeof parsed.variables === 'object' ? parsed.variables : {},
        angleUnit: parsed.angleUnit === 'rad' ? 'rad' : 'deg',
        thousands: typeof parsed.thousands === 'boolean' ? parsed.thousands : true,
        precision:
          parsed.precision === '2' || parsed.precision === '4' || parsed.precision === '6' ? parsed.precision : 'auto',
        scratchpad: typeof parsed.scratchpad === 'string' ? parsed.scratchpad : SCRATCHPAD_TEMPLATES[0].content,
      }
    }
  } catch {
    // localStorage 异常时静默使用默认值
  }
  return {
    history: [],
    variables: {},
    angleUnit: 'deg',
    thousands: true,
    precision: 'auto',
    scratchpad: SCRATCHPAD_TEMPLATES[0].content,
  }
}

function nowTimeStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export default function ConsoleCalcTool() {
  const initial = useMemo(() => loadInitialState(), [])

  const [viewMode, setViewMode] = useState<ViewMode>('console')
  const [history, setHistory] = useState<HistoryEntry[]>(initial.history)
  const [variables, setVariables] = useState<Record<string, number>>(initial.variables)
  const [angleUnit, setAngleUnit] = useState<AngleUnit>(initial.angleUnit)
  const [thousands, setThousands] = useState<boolean>(initial.thousands)
  const [precision, setPrecision] = useState<PrecisionMode>(initial.precision)
  const [scratchpad, setScratchpad] = useState<string>(initial.scratchpad)

  // 控制台输入相关状态
  const [input, setInput] = useState('')
  const [navCursor, setNavCursor] = useState<number | null>(null)
  const [draftBeforeNav, setDraftBeforeNav] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [onlyStarred, setOnlyStarred] = useState(false)
  const [showKeypad, setShowKeypad] = useState(false)
  const [docCat, setDocCat] = useState<DocCategory>('all')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  // 持久化状态到 localStorage
  useEffect(() => {
    try {
      const payload: PersistedState = {
        history: history.slice(-150),
        variables,
        angleUnit,
        thousands,
        precision,
        scratchpad,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // 忽略配额错误
    }
  }, [history, variables, angleUnit, thousands, precision, scratchpad])

  const formatOptions = useMemo(
    () => ({
      precision: precision === 'auto' ? ('auto' as const) : Number(precision),
      thousands,
    }),
    [precision, thousands],
  )

  // 构造当前求值上下文
  const evalCtx = useMemo(
    () => ({
      variables,
      historyValues: history.map((h) => h.value),
      lastAnswer: history.length > 0 ? history[history.length - 1].value : undefined,
      angleUnit,
    }),
    [variables, history, angleUnit],
  )

  // 实时 Eager Preview 求值
  const preview = useMemo(() => evaluatePreview(input, evalCtx), [input, evalCtx])

  // 自动补全候选（匹配输入框尾部正在敲的标识符）
  const autocomplete = useMemo(() => {
    const match = input.match(/([a-zA-Z_\u4e00-\u9fa5][a-zA-Z0-9_\u4e00-\u9fa5]*)$/)
    if (!match) return []
    const prefix = match[1].toLowerCase()
    if (!prefix) return []

    const candidates: { label: string; insert: string; desc: string; kind: 'fn' | 'var' | 'const' }[] = []

    // 自定义变量
    for (const [k, v] of Object.entries(variables)) {
      if (k.toLowerCase().startsWith(prefix) && k.toLowerCase() !== prefix) {
        candidates.push({
          label: k,
          insert: k,
          desc: `= ${formatResultValue(v, formatOptions)}`,
          kind: 'var',
        })
      }
    }
    // ans
    if ('ans'.startsWith(prefix) && prefix !== 'ans' && evalCtx.lastAnswer !== undefined) {
      candidates.push({
        label: 'ans',
        insert: 'ans',
        desc: `上次结果 (${formatResultValue(evalCtx.lastAnswer, formatOptions)})`,
        kind: 'var',
      })
    }
    // 内置常量
    for (const [k, meta] of Object.entries(MATH_CONSTANTS)) {
      if (k.startsWith(prefix) && k !== prefix) {
        candidates.push({ label: k, insert: k, desc: meta.desc, kind: 'const' })
      }
    }
    // 内置函数
    for (const fn of BUILTIN_FUNCTION_DOCS) {
      if (fn.name.startsWith(prefix) && fn.name !== prefix) {
        candidates.push({ label: fn.signature, insert: `${fn.name}(`, desc: fn.desc, kind: 'fn' })
      }
    }

    return candidates.slice(0, 6)
  }, [input, variables, evalCtx.lastAnswer, formatOptions])

  // 应用补全候选项
  const applyAutocomplete = useCallback((insertText: string) => {
    setInput((prev) => prev.replace(/([a-zA-Z_\u4e00-\u9fa5][a-zA-Z0-9_\u4e00-\u9fa5]*)$/, insertText))
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  // 在光标处插入文本
  const insertAtCursor = useCallback((snippet: string) => {
    const el = inputRef.current
    if (!el) {
      setInput((prev) => prev + snippet)
      return
    }
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    setInput((prev) => prev.slice(0, start) + snippet + prev.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + snippet.length
      el.setSelectionRange(pos, pos)
    })
  }, [])

  // 提交当前控制台算式
  const submitExpression = useCallback(
    (overrideExpr?: string) => {
      const target = (overrideExpr ?? input).trim()
      if (!target) return

      const res = evaluateExpression(target, evalCtx)
      if (!res.ok) {
        if (!res.empty) toast.error(res.error)
        return
      }

      if (res.command === 'clear') {
        setHistory([])
        setInput('')
        setNavCursor(null)
        toast.success('已清空控制台历史记录')
        return
      }

      if (res.command === 'reset') {
        setVariables({})
        setInput('')
        setNavCursor(null)
        toast.success('已重置所有自定义变量')
        return
      }

      if (res.assignedVar) {
        setVariables((prev) => ({ ...prev, [res.assignedVar!]: res.value }))
      }

      const nextSeq = history.length + 1
      const entry: HistoryEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        seq: nextSeq,
        expr: target,
        value: res.value,
        assignedVar: res.assignedVar,
        preferredDisplay: res.preferredDisplay,
        time: nowTimeStr(),
      }
      setHistory((prev) => [...prev, entry])
      setInput('')
      setNavCursor(null)
      setDraftBeforeNav('')

      requestAnimationFrame(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
        inputRef.current?.focus()
      })
    },
    [input, evalCtx, history.length],
  )

  // 键盘事件：Enter 提交、↑↓ 历史切换、Tab 补全、Ctrl+L 清屏、空输入按运算符自动接续 ans
  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submitExpression()
      return
    }

    if (e.key === 'Tab' && autocomplete.length > 0) {
      e.preventDefault()
      applyAutocomplete(autocomplete[0].insert)
      return
    }

    if (e.key === 'Escape') {
      if (input) {
        e.preventDefault()
        setInput('')
        setNavCursor(null)
      }
      return
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
      e.preventDefault()
      setHistory([])
      toast.success('已清空控制台历史记录')
      return
    }

    // 输入框为空且已有上一条结果时，直接按 + - * / ^ 自动接续 "ans <op> "
    if (
      !input &&
      evalCtx.lastAnswer !== undefined &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      ['+', '-', '*', '/', '^'].includes(e.key)
    ) {
      e.preventDefault()
      setInput(`ans ${e.key} `)
      return
    }

    // 终端式历史记录上下翻页
    if (e.key === 'ArrowUp') {
      if (history.length === 0) return
      e.preventDefault()
      if (navCursor === null) {
        setDraftBeforeNav(input)
        const nextIdx = history.length - 1
        setNavCursor(nextIdx)
        setInput(history[nextIdx].expr)
      } else if (navCursor > 0) {
        const nextIdx = navCursor - 1
        setNavCursor(nextIdx)
        setInput(history[nextIdx].expr)
      }
      return
    }

    if (e.key === 'ArrowDown') {
      if (navCursor === null) return
      e.preventDefault()
      if (navCursor < history.length - 1) {
        const nextIdx = navCursor + 1
        setNavCursor(nextIdx)
        setInput(history[nextIdx].expr)
      } else {
        setNavCursor(null)
        setInput(draftBeforeNav)
      }
    }
  }

  // 复制并给出柔和反馈
  const copyValue = async (text: string, key: string, tip = '已复制') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      toast.success(tip)
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1500)
    } catch {
      toast.error('复制失败，请手动选中复制')
    }
  }

  // 过滤后的历史记录
  const filteredHistory = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return history.filter((item) => {
      if (onlyStarred && !item.starred) return false
      if (!q) return true
      return (
        item.expr.toLowerCase().includes(q) ||
        String(item.value).includes(q) ||
        `#${item.seq}` === q ||
        (item.assignedVar?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [history, searchQuery, onlyStarred])

  // 历史记录所有数值汇总（排除变量声明或包含全部）
  const historySum = useMemo(() => {
    if (filteredHistory.length === 0) return 0
    return filteredHistory.reduce((acc, item) => acc + item.value, 0)
  }, [filteredHistory])

  // 草稿纸实时逐行求值
  const scratchEval = useMemo(() => evaluateScratchpad(scratchpad, angleUnit), [scratchpad, angleUnit])

  // 导出控制台或草稿纸为文本账单
  const exportTranscript = (asDownload: boolean) => {
    let content = ''
    if (viewMode === 'console') {
      if (history.length === 0) {
        toast.error('暂无历史记录可导出')
        return
      }
      content = [
        '# 控制台计算器记录',
        '',
        ...history.map(
          (h) =>
            `#${h.seq} [${h.time}]  ${h.expr}  =  ${formatResultValue(h.value, { ...formatOptions, preferredDisplay: h.preferredDisplay })}`,
        ),
        '',
        `合计（共 ${history.length} 条）：${formatResultValue(historySum, formatOptions)}`,
      ].join('\n')
    } else {
      content = [
        '# 多行草稿纸计算记录',
        '',
        ...scratchEval.lines.map((line) => {
          if (!line.raw.trim()) return ''
          if (line.result.ok && !line.result.command) {
            const valStr = formatResultValue(line.result.value, {
              ...formatOptions,
              preferredDisplay: line.result.preferredDisplay,
            })
            return `${line.raw}    =>  ${valStr}`
          }
          return line.raw
        }),
        '',
        `合计（${scratchEval.validCount} 项计算）：${formatResultValue(scratchEval.totalSum, formatOptions)}`,
      ].join('\n')
    }

    if (asDownload) {
      downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), timestampName('calc-log', 'txt'))
      toast.success('已导出计算记录')
    } else {
      copyValue(content, 'export-all', '已复制完整计算账单')
    }
  }

  // 当前预览洞察（中文数量级、人民币大写、进制）
  const previewInsights = useMemo(() => {
    if (!preview.ok || preview.command) return null
    const val = preview.value
    return {
      plain: formatResultValue(val, { ...formatOptions, preferredDisplay: preview.preferredDisplay }),
      rawNum: String(val),
      cnScale: formatChineseScale(val),
      rmb: formatRmbUpperSimple(val),
      radices: formatRadices(val),
    }
  }, [preview, formatOptions])

  const filteredDocs = useMemo(
    () => (docCat === 'all' ? BUILTIN_FUNCTION_DOCS : BUILTIN_FUNCTION_DOCS.filter((d) => d.category === docCat)),
    [docCat],
  )

  return (
    <div className="space-y-4">
      {/* ================= 顶部控制条 ================= */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={viewMode}
          onChange={setViewMode}
          className="max-w-sm"
          options={[
            { value: 'console', label: '控制台 REPL', icon: <Terminal /> },
            { value: 'scratchpad', label: '多行草稿纸', icon: <FileText /> },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2">
          {/* 角度/弧度模式 */}
          <div className="bg-foreground/[0.06] inline-flex rounded-xl p-0.5 text-xs">
            {(['deg', 'rad'] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setAngleUnit(u)}
                title={u === 'deg' ? '角度制（如 sin(30) = 0.5）' : '弧度制（如 sin(pi/6) = 0.5）'}
                className={cn(
                  'rounded-lg px-2.5 py-1 font-mono font-semibold uppercase transition',
                  angleUnit === u ? 'bg-card-solid text-primary shadow-xs' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {u}
              </button>
            ))}
          </div>

          {/* 精度 */}
          <div className="bg-foreground/[0.06] inline-flex rounded-xl p-0.5 text-xs">
            {(
              [
                ['auto', '自动小数'],
                ['2', '2位'],
                ['4', '4位'],
                ['6', '6位'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setPrecision(val)}
                className={cn(
                  'rounded-lg px-2 py-1 font-medium transition',
                  precision === val ? 'bg-card-solid text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 千分位开关 */}
          <Button
            size="sm"
            variant={thousands ? 'secondary' : 'ghost'}
            onClick={() => setThousands((v) => !v)}
            title="切换千分位逗号分隔"
            className="font-mono text-xs"
          >
            1,000
          </Button>

          <Button size="sm" variant="outline" onClick={() => exportTranscript(false)}>
            <Copy className="!size-3.5" />
            复制账单
          </Button>
          <Button size="sm" variant="ghost" onClick={() => exportTranscript(true)} title="下载文本记录">
            <Download className="!size-3.5" />
          </Button>
        </div>
      </div>

      {/* ================= 模式一：控制台 REPL 模式 ================= */}
      {viewMode === 'console' ? (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
          {/* 左侧：主控制台窗口 */}
          <section className="glass shadow-soft flex min-h-[540px] flex-col overflow-hidden rounded-2xl border">
            {/* 控制台顶部工具栏 */}
            <div className="border-border/60 bg-foreground/[0.025] flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-rose-400/80" />
                  <span className="size-2.5 rounded-full bg-amber-400/80" />
                  <span className="size-2.5 rounded-full bg-emerald-400/80" />
                </div>
                <span className="text-muted-foreground ml-1 font-mono text-xs font-medium">
                  Console · {history.length} 条记录
                </span>
                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={() => insertAtCursor(String(historySum))}
                    title="点击将当前历史总和插入输入框"
                    className="bg-primary/10 text-primary hover:bg-primary/15 hidden items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[11px] font-medium transition sm:inline-flex"
                  >
                    Σ {formatResultValue(historySum, formatOptions)}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {history.length > 0 && (
                  <>
                    <div className="relative">
                      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="筛查历史…"
                        className="border-border/70 bg-background/60 focus:border-primary h-7 w-28 rounded-lg border pr-2 pl-7 text-xs outline-none transition focus:w-40"
                      />
                    </div>
                    <Button
                      size="icon"
                      variant={onlyStarred ? 'secondary' : 'ghost'}
                      className="size-7"
                      onClick={() => setOnlyStarred((v) => !v)}
                      title={onlyStarred ? '显示全部历史' : '仅看收藏记录'}
                    >
                      <Star className={cn('size-3.5', onlyStarred && 'fill-amber-400 text-amber-500')} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 text-muted-foreground hover:text-rose-500"
                      onClick={() => {
                        setHistory([])
                        toast.success('已清空历史记录')
                      }}
                      title="清空历史记录（快捷键 Ctrl/⌘ + L）"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* 控制台历史记录滚动区 */}
            <div
              className="flex-1 overflow-y-auto px-3 py-3 sm:px-4"
              style={{ maxHeight: 'calc(100dvh - 370px)', minHeight: '280px' }}
              onClick={(e) => {
                // 点击空白区自动聚焦命令行，和浏览器控制台习惯完全一致
                if (e.target === e.currentTarget) inputRef.current?.focus()
              }}
            >
              {history.length === 0 ? (
                <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-4 px-3 py-6 text-center">
                  <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-2xl">
                    <Terminal className="size-6" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-semibold">像浏览器控制台一样直接输入算式</div>
                    <p className="text-muted-foreground max-w-md text-xs leading-relaxed">
                      边输入边在下方实时预览结果，按 <kbd className="bg-foreground/8 rounded px-1.5 py-0.5 font-mono">Enter</kbd> 记录历史，
                      <kbd className="bg-foreground/8 rounded px-1.5 py-0.5 font-mono">↑ ↓</kbd> 翻阅历史，空输入直接敲{' '}
                      <kbd className="bg-foreground/8 rounded px-1.5 py-0.5 font-mono">+ - * /</kbd> 自动接续上次结果。
                    </p>
                  </div>
                  <div className="flex max-w-xl flex-wrap items-center justify-center gap-2">
                    {QUICK_EXAMPLES.map((ex) => (
                      <button
                        key={ex.label}
                        type="button"
                        onClick={() => {
                          setInput(ex.label)
                          requestAnimationFrame(() => inputRef.current?.focus())
                        }}
                        className="border-border/70 bg-background/60 hover:border-primary/60 hover:bg-primary/[0.05] group flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition"
                      >
                        <code className="text-foreground font-mono font-medium">{ex.label}</code>
                        <span className="text-muted-foreground text-[11px]">{ex.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : filteredHistory.length === 0 ? (
                <div className="text-muted-foreground py-16 text-center text-xs">
                  没有匹配「{searchQuery || '已收藏'}」的历史记录
                </div>
              ) : (
                <div className="divide-border/40 divide-y font-mono">
                  {filteredHistory.map((item) => {
                    const formatted = formatResultValue(item.value, {
                      ...formatOptions,
                      preferredDisplay: item.preferredDisplay,
                    })
                    const cnScale = formatChineseScale(item.value)
                    return (
                      <div
                        key={item.id}
                        className="hover:bg-foreground/[0.03] group rounded-xl px-2.5 py-2.5 transition"
                      >
                        {/* 输入表达式行 */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-1 items-baseline gap-2">
                            <button
                              type="button"
                              onClick={() => insertAtCursor(`#${item.seq}`)}
                              title={`点击插入 #${item.seq} 引用此结果`}
                              className="text-muted-foreground/70 hover:text-primary shrink-0 rounded px-1 text-[11px] transition hover:bg-primary/10"
                            >
                              #{item.seq}
                            </button>
                            <ChevronRight className="text-primary/70 size-3.5 shrink-0 translate-y-0.5" />
                            <button
                              type="button"
                              onClick={() => {
                                setInput(item.expr)
                                requestAnimationFrame(() => inputRef.current?.focus())
                              }}
                              title="点击将表达式放回输入框编辑"
                              className="text-foreground/90 hover:text-primary min-w-0 break-all text-left text-sm transition"
                            >
                              {item.expr}
                            </button>
                          </div>

                          {/* 悬浮操作按钮 */}
                          <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                            <span className="text-muted-foreground/60 mr-1.5 hidden text-[10px] md:inline">
                              {item.time}
                            </span>
                            <button
                              type="button"
                              onClick={() => copyValue(formatted, item.id, `已复制 ${formatted}`)}
                              className="text-muted-foreground hover:text-foreground rounded-md p-1 transition"
                              title="复制计算结果"
                            >
                              {copiedKey === item.id ? (
                                <Check className="size-3.5 text-emerald-500" />
                              ) : (
                                <Copy className="size-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setHistory((prev) =>
                                  prev.map((h) => (h.id === item.id ? { ...h, starred: !h.starred } : h)),
                                )
                              }
                              className="text-muted-foreground hover:text-amber-500 rounded-md p-1 transition"
                              title={item.starred ? '取消收藏' : '收藏此记录'}
                            >
                              <Star
                                className={cn('size-3.5', item.starred && 'fill-amber-400 text-amber-500 opacity-100')}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => setHistory((prev) => prev.filter((h) => h.id !== item.id))}
                              className="text-muted-foreground hover:text-rose-500 rounded-md p-1 transition"
                              title="删除此记录"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* 输出结果行 */}
                        <div className="mt-1 flex flex-wrap items-baseline gap-2 pl-9">
                          <span className="text-muted-foreground/60 select-none text-xs">‹</span>
                          <button
                            type="button"
                            onClick={() => insertAtCursor(String(item.value))}
                            title="点击将此数值插入当前输入框"
                            className="text-primary hover:underline text-base font-semibold tabular-nums"
                          >
                            {formatted}
                          </button>
                          {item.assignedVar && (
                            <span className="rounded-md bg-violet-500/12 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-300">
                              变量 {item.assignedVar}
                            </span>
                          )}
                          {cnScale && (
                            <span className="text-muted-foreground text-[11px] font-sans">≈ {cnScale}</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  <div ref={logEndRef} />
                </div>
              )}
            </div>

            {/* ================= 命令行输入 + 实时 Eager Preview ================= */}
            <div className="border-border/70 bg-background/70 border-t px-3 py-3 sm:px-4">
              {/* Tab 自动补全建议条 */}
              {autocomplete.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground text-[11px]">Tab 补全：</span>
                  {autocomplete.map((cand, idx) => (
                    <button
                      key={cand.label}
                      type="button"
                      onClick={() => applyAutocomplete(cand.insert)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs transition',
                        idx === 0
                          ? 'border-primary/50 bg-primary/10 text-primary'
                          : 'border-border/70 bg-background/80 text-foreground/80 hover:border-primary/40',
                      )}
                    >
                      <code className="font-mono font-semibold">{cand.label}</code>
                      <span className="text-muted-foreground text-[11px]">{cand.desc}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* 主输入行 */}
              <div className="border-border/80 bg-card-solid/90 focus-within:border-primary focus-within:ring-primary/20 flex items-center gap-2 rounded-xl border px-3 py-2 shadow-xs transition focus-within:ring-2">
                <ChevronRight className="text-primary size-4.5 shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  autoFocus
                  spellCheck={false}
                  autoComplete="off"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value)
                    setNavCursor(null)
                  }}
                  onKeyDown={handleInputKeyDown}
                  placeholder="输入算式，如 (1280 + 360) * 0.85 或 单价 = 199…"
                  className="placeholder:text-muted-foreground/60 min-w-0 flex-1 bg-transparent font-mono text-base outline-none sm:text-[17px]"
                />
                {input && (
                  <button
                    type="button"
                    onClick={() => {
                      setInput('')
                      setNavCursor(null)
                      inputRef.current?.focus()
                    }}
                    className="text-muted-foreground hover:text-foreground rounded-md p-1 transition"
                    title="清空输入 (Esc)"
                  >
                    <X className="size-4" />
                  </button>
                )}
                <Button
                  size="icon"
                  variant={showKeypad ? 'secondary' : 'ghost'}
                  className="size-8 shrink-0"
                  onClick={() => setShowKeypad((v) => !v)}
                  title={showKeypad ? '收起快捷键盘' : '展开快捷键盘'}
                >
                  <Keyboard className="size-4" />
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!input.trim()}
                  onClick={() => submitExpression()}
                  className="shrink-0"
                >
                  <CornerDownLeft className="!size-3.5" />
                  <span className="hidden sm:inline">记录</span>
                </Button>
              </div>

              {/* 浏览器控制台风格实时预览行 */}
              <div className="mt-2.5 min-h-[28px] px-2">
                {!input.trim() ? (
                  <div className="text-muted-foreground/70 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span>提示：输入 <code className="font-mono">clear</code> 清屏</span>
                    <span>·</span>
                    <span>输入 <code className="font-mono">reset</code> 清空变量</span>
                    <span>·</span>
                    <span>支持 <code className="font-mono">200+15%</code>、<code className="font-mono">1.5万</code>、<code className="font-mono">#1</code> 引用历史</span>
                  </div>
                ) : preview.ok && preview.command ? (
                  <div className="text-primary flex items-center gap-2 font-mono text-sm">
                    <span className="opacity-60">‹</span>
                    <span>
                      按 Enter 执行内置命令：
                      {preview.command === 'clear' ? '清空控制台历史记录' : '重置所有自定义变量'}
                    </span>
                  </div>
                ) : preview.ok && previewInsights ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-baseline gap-2 font-mono">
                        <span className="text-muted-foreground select-none text-sm">‹</span>
                        <span
                          className={cn(
                            'text-xl font-bold tabular-nums tracking-tight transition',
                            preview.partial ? 'text-foreground/55' : 'text-emerald-600 dark:text-emerald-400',
                          )}
                        >
                          {previewInsights.plain}
                        </span>
                        {preview.assignedVar && (
                          <span className="rounded-md bg-violet-500/12 px-1.5 py-0.5 font-sans text-[11px] font-medium text-violet-600 dark:text-violet-300">
                            将赋值 {preview.assignedVar}
                          </span>
                        )}
                        {preview.partial && (
                          <span className="text-muted-foreground font-sans text-[11px]">（继续输入中…）</span>
                        )}
                      </div>

                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => copyValue(previewInsights.plain, 'preview-val', `已复制 ${previewInsights.plain}`)}
                      >
                        {copiedKey === 'preview-val' ? (
                          <Check className="!size-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="!size-3.5" />
                        )}
                        复制结果
                      </Button>
                    </div>

                    {/* 多维结果洞察胶囊（中文读法 / 人民币大写 / 程序员进制） */}
                    {(previewInsights.cnScale || previewInsights.rmb || previewInsights.radices) && (
                      <div className="flex flex-wrap items-center gap-1.5 pl-4 text-[11px]">
                        {previewInsights.cnScale && (
                          <button
                            type="button"
                            onClick={() => copyValue(previewInsights.cnScale!, 'cn-scale', '已复制中文简写')}
                            className="bg-foreground/[0.05] hover:bg-foreground/[0.1] text-foreground/80 rounded-md px-2 py-0.5 transition"
                            title="点击复制"
                          >
                            约 {previewInsights.cnScale}
                          </button>
                        )}
                        {previewInsights.rmb && (
                          <button
                            type="button"
                            onClick={() => copyValue(previewInsights.rmb!, 'rmb', '已复制人民币大写')}
                            className="bg-amber-500/10 hover:bg-amber-500/18 text-amber-800 dark:text-amber-300 max-w-full truncate rounded-md px-2 py-0.5 transition"
                            title={`点击复制大写：${previewInsights.rmb}`}
                          >
                            大写：{previewInsights.rmb}
                          </button>
                        )}
                        {previewInsights.radices && (
                          <>
                            <button
                              type="button"
                              onClick={() => copyValue(previewInsights.radices!.hex, 'hex', '已复制十六进制')}
                              className="bg-indigo-500/10 hover:bg-indigo-500/18 font-mono text-indigo-700 dark:text-indigo-300 rounded-md px-2 py-0.5 transition"
                            >
                              HEX {previewInsights.radices.hex}
                            </button>
                            <button
                              type="button"
                              onClick={() => copyValue(previewInsights.radices!.bin.replace(/\s+/g, ''), 'bin', '已复制二进制')}
                              className="bg-cyan-500/10 hover:bg-cyan-500/18 font-mono text-cyan-700 dark:text-cyan-300 rounded-md px-2 py-0.5 transition"
                            >
                              BIN {previewInsights.radices.bin}
                            </button>
                            <button
                              type="button"
                              onClick={() => copyValue(previewInsights.radices!.oct, 'oct', '已复制八进制')}
                              className="bg-teal-500/10 hover:bg-teal-500/18 font-mono text-teal-700 dark:text-teal-300 rounded-md px-2 py-0.5 transition"
                            >
                              OCT {previewInsights.radices.oct}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ) : !preview.ok && !preview.empty ? (
                  <div className="flex items-center gap-2 font-mono text-xs text-rose-500 dark:text-rose-400">
                    <span>✕</span>
                    <span>{preview.error}</span>
                  </div>
                ) : null}
              </div>

              {/* 可折叠快捷键盘 */}
              {showKeypad && (
                <div className="border-border/60 mt-3 grid gap-1.5 border-t pt-3">
                  {KEYPAD_ROWS.map((row, rIdx) => (
                    <div key={rIdx} className="grid grid-cols-5 gap-1.5">
                      {row.map((btn) => (
                        <button
                          key={btn.label}
                          type="button"
                          onClick={() => insertAtCursor(btn.insert)}
                          className={cn(
                            'h-9 rounded-xl font-mono text-sm font-semibold transition active:scale-95',
                            btn.variant === 'num' && 'bg-foreground/[0.06] hover:bg-foreground/[0.11] text-foreground',
                            btn.variant === 'op' && 'bg-primary/12 hover:bg-primary/20 text-primary',
                            btn.variant === 'fn' && 'bg-foreground/[0.04] hover:bg-foreground/[0.09] text-muted-foreground hover:text-foreground',
                            btn.variant === 'accent' && 'bg-emerald-500/12 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
                          )}
                        >
                          {btn.label}
                        </button>
                      ))}
                    </div>
                  ))}
                  <div className="grid grid-cols-3 gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setInput((prev) => prev.slice(0, -1))
                        inputRef.current?.focus()
                      }}
                    >
                      <Delete className="!size-3.5" />
                      退格
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setInput('')
                        inputRef.current?.focus()
                      }}
                    >
                      清空输入
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => submitExpression()}>
                      = 回车计算
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 右侧：变量与函数速查侧栏 */}
          <aside className="space-y-4">
            {/* 变量工作台 */}
            <section className="glass shadow-soft space-y-3 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <Variable className="text-primary size-4" />
                  <span>内存变量</span>
                </div>
                {Object.keys(variables).length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setVariables({})
                      toast.success('已清空所有自定义变量')
                    }}
                    className="text-muted-foreground hover:text-rose-500 text-xs transition"
                  >
                    重置全部
                  </button>
                )}
              </div>

              <div className="space-y-1.5">
                {/* 内置 ans 卡片 */}
                <button
                  type="button"
                  disabled={evalCtx.lastAnswer === undefined}
                  onClick={() => insertAtCursor('ans')}
                  className="border-border/60 bg-foreground/[0.025] hover:border-primary/40 flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-xs transition disabled:opacity-50"
                >
                  <div className="flex items-center gap-1.5">
                    <code className="text-primary font-mono font-semibold">ans</code>
                    <span className="text-muted-foreground text-[11px]">上次结果</span>
                  </div>
                  <span className="font-mono font-semibold tabular-nums">
                    {evalCtx.lastAnswer !== undefined ? formatResultValue(evalCtx.lastAnswer, formatOptions) : '—'}
                  </span>
                </button>

                {/* 用户自定义变量 */}
                {Object.entries(variables).length === 0 ? (
                  <p className="text-muted-foreground px-1 py-2 text-xs leading-relaxed">
                    输入 <code className="bg-foreground/8 rounded px-1 py-0.5 font-mono">单价 = 199</code> 或{' '}
                    <code className="bg-foreground/8 rounded px-1 py-0.5 font-mono">tax = 0.06</code> 即可声明变量，后续算式直接复用。
                  </p>
                ) : (
                  Object.entries(variables).map(([name, val]) => (
                    <div
                      key={name}
                      className="border-border/60 bg-background/50 hover:border-primary/40 group flex items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-xs transition"
                    >
                      <button
                        type="button"
                        onClick={() => insertAtCursor(name)}
                        className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                        title="点击插入变量名"
                      >
                        <code className="text-violet-600 dark:text-violet-300 truncate font-mono font-semibold">
                          {name}
                        </code>
                        <span className="font-mono font-medium tabular-nums">
                          {formatResultValue(val, formatOptions)}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setVariables((prev) => {
                            const next = { ...prev }
                            delete next[name]
                            return next
                          })
                        }
                        className="text-muted-foreground hover:text-rose-500 p-0.5 opacity-60 transition hover:opacity-100"
                        title="删除变量"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* 函数与语法速查 */}
            <section className="glass shadow-soft space-y-3 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <BookOpen className="text-primary size-4" />
                  <span>函数速查（点击试用）</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ['all', '全部'],
                    ['math', '常用'],
                    ['trig', '三角'],
                    ['stats', '统计'],
                    ['prog', '进制'],
                  ] as const
                ).map(([cat, label]) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setDocCat(cat)}
                    className={cn(
                      'rounded-lg px-2 py-1 text-xs font-medium transition',
                      docCat === cat
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-foreground/[0.05] text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="max-h-[300px] space-y-1 overflow-y-auto pr-1">
                {filteredDocs.map((fn) => (
                  <button
                    key={fn.name}
                    type="button"
                    onClick={() => {
                      setInput(fn.example)
                      requestAnimationFrame(() => inputRef.current?.focus())
                    }}
                    className="hover:bg-foreground/[0.05] flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition"
                    title={`点击试用示例：${fn.example}`}
                  >
                    <code className="text-primary font-mono font-medium">{fn.signature}</code>
                    <span className="text-muted-foreground truncate text-[11px]">{fn.desc}</span>
                  </button>
                ))}
              </div>
            </section>
          </aside>
        </div>
      ) : (
        /* ================= 模式二：多行草稿纸模式（Soulver 风格） ================= */
        <div className="space-y-4">
          {/* 场景模板快捷条 */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground mr-1 flex items-center gap-1 text-xs">
                <Sparkles className="size-3.5" />
                场景模板：
              </span>
              {SCRATCHPAD_TEMPLATES.map((tpl) => (
                <Button key={tpl.id} size="sm" variant="outline" onClick={() => setScratchpad(tpl.content)}>
                  {tpl.name}
                </Button>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setScratchpad('')}>
              <Trash2 className="!size-3.5" />
              清空草稿
            </Button>
          </div>

          {/* 同步对齐双栏编辑与结果卡 */}
          <section className="glass shadow-soft overflow-hidden rounded-2xl border">
            <div className="border-border/60 bg-foreground/[0.025] text-muted-foreground grid grid-cols-[minmax(0,1fr)_180px] border-b px-4 py-2 text-xs font-medium sm:grid-cols-[minmax(0,1fr)_240px]">
              <span>表达式与注释（修改上方变量，下方整张账单自动重算）</span>
              <span className="text-right">每行实时结果（点击复制）</span>
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_180px] sm:grid-cols-[minmax(0,1fr)_240px]">
              {/* 左侧编辑器 */}
              <textarea
                value={scratchpad}
                onChange={(e) => setScratchpad(e.target.value)}
                spellCheck={false}
                rows={Math.max(12, scratchEval.lines.length + 2)}
                placeholder={'// 像记事本一样写下每行账目\n房租 = 3200\n水电网 = 280\n餐饮 = 65 * 30\n房租 + 水电网 + 餐饮'}
                className="border-border/60 placeholder:text-muted-foreground/50 min-h-[340px] w-full resize-none border-r bg-transparent px-4 py-3 font-mono text-sm leading-8 outline-none"
              />

              {/* 右侧逐行对齐结果列 */}
              <div className="bg-foreground/[0.015] py-3 pr-4 pl-3 font-mono text-sm leading-8 select-none">
                {scratchEval.lines.map((line) => {
                  if (!line.raw.trim() || (!line.result.ok && line.result.empty)) {
                    return (
                      <div key={line.lineNumber} className="h-8 text-right text-xs text-transparent">
                        ·
                      </div>
                    )
                  }
                  if (!line.result.ok) {
                    return (
                      <div
                        key={line.lineNumber}
                        className="h-8 truncate text-right font-sans text-xs text-rose-500/80"
                        title={line.result.error}
                      >
                        {line.result.error}
                      </div>
                    )
                  }
                  const valStr = formatResultValue(line.result.value, {
                    ...formatOptions,
                    preferredDisplay: line.result.preferredDisplay,
                  })
                  return (
                    <div key={line.lineNumber} className="flex h-8 items-center justify-end gap-1.5">
                      {line.result.assignedVar && (
                        <span className="hidden rounded bg-violet-500/12 px-1 py-0.5 font-sans text-[10px] text-violet-600 sm:inline dark:text-violet-300">
                          {line.result.assignedVar}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => copyValue(valStr, `sp-${line.lineNumber}`, `已复制 ${valStr}`)}
                        className={cn(
                          'truncate font-semibold tabular-nums transition hover:underline',
                          line.result.assignedVar ? 'text-foreground/75' : 'text-emerald-600 dark:text-emerald-400',
                        )}
                        title={`点击复制 ${valStr}`}
                      >
                        {valStr}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 底部汇总统计条 */}
            <div className="border-border/60 bg-foreground/[0.03] flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs">
              <div className="text-muted-foreground flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1">
                  <Calculator className="size-3.5" />
                  独立算式 {scratchEval.validCount} 行
                </span>
                <span className="inline-flex items-center gap-1">
                  <Hash className="size-3.5" />
                  已定义变量 {Object.keys(scratchEval.variables).length} 个
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {formatRmbUpperSimple(scratchEval.totalSum) && scratchEval.totalSum > 0 && (
                  <span className="text-muted-foreground hidden lg:inline">
                    大写：{formatRmbUpperSimple(scratchEval.totalSum)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() =>
                    copyValue(
                      formatResultValue(scratchEval.totalSum, formatOptions),
                      'sp-total',
                      '已复制草稿纸合计',
                    )
                  }
                  className="bg-primary/12 text-primary hover:bg-primary/18 inline-flex items-center gap-1.5 rounded-xl px-3 py-1 font-mono text-sm font-bold tabular-nums transition"
                  title="点击复制非赋值算式行总和"
                >
                  <span>Σ 合计</span>
                  <span>{formatResultValue(scratchEval.totalSum, formatOptions)}</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
