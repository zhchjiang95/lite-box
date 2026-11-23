import {
  ArrowLeftRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Columns2,
  Copy,
  Download,
  FileDiff,
  FileText,
  Rows3,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { downloadBlob, timestampName } from '@/lib/file'
import { cn, formatBytes } from '@/lib/utils'
import {
  buildDiffHtmlReport,
  computeDocDiff,
  createSampleContractDocs,
  defaultDiffOptions,
  parseDocForDiff,
  type DiffOptions,
  type DiffRow,
  type ParsedDoc,
} from './engine'

type ViewMode = 'split' | 'inline'

const ACCEPT_DOCS =
  '.docx,.txt,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown'

export default function DocxDiff() {
  const [docA, setDocA] = useState<ParsedDoc | null>(null)
  const [docB, setDocB] = useState<ParsedDoc | null>(null)
  const [opts, setOpts] = useState<DiffOptions>(defaultDiffOptions)
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [onlyChanges, setOnlyChanges] = useState(false)
  const [dragSide, setDragSide] = useState<'A' | 'B' | null>(null)
  const [activeChangePtr, setActiveChangePtr] = useState(0)
  const [copiedDiff, setCopiedDiff] = useState(false)

  const inputARef = useRef<HTMLInputElement>(null)
  const inputBRef = useRef<HTMLInputElement>(null)
  const rowRefs = useRef(new Map<number, HTMLDivElement>())

  const toggleOpt = (k: keyof DiffOptions) => setOpts((prev) => ({ ...prev, [k]: !prev[k] }))

  /** 载入单份或一次拖入两份文档 */
  const handleFiles = useCallback(async (side: 'A' | 'B', files: File[]) => {
    if (!files.length) return
    if (files.length >= 2) {
      try {
        const [a, b] = await Promise.all([parseDocForDiff(files[0]), parseDocForDiff(files[1])])
        setDocA(a)
        setDocB(b)
        setActiveChangePtr(0)
        toast.success('已自动载入两份文档并完成差异比对')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '解析文档失败')
      }
      return
    }

    try {
      const parsed = await parseDocForDiff(files[0])
      if (side === 'A') setDocA(parsed)
      else setDocB(parsed)
      setActiveChangePtr(0)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '解析文档失败')
    }
  }, [])

  const swapDocs = () => {
    setDocA(docB)
    setDocB(docA)
    setActiveChangePtr(0)
    toast.success('已互换原文档与新文档位置')
  }

  const loadSample = () => {
    const { docA: a, docB: b } = createSampleContractDocs()
    setDocA(a)
    setDocB(b)
    setActiveChangePtr(0)
    toast.success('已载入合同 V1.0 vs V2.0 修订示例')
  }

  /** 执行实时对比 */
  const summary = useMemo(() => {
    if (!docA || !docB) return null
    return computeDocDiff(docA, docB, opts)
  }, [docA, docB, opts])

  const displayRows = useMemo(() => {
    if (!summary) return []
    return onlyChanges ? summary.rows.filter((r) => r.status !== 'equal') : summary.rows
  }, [summary, onlyChanges])

  const totalChanges = summary?.changeRowIndices.length ?? 0

  /** 跳转到上一处 / 下一处差异并平滑滚动至视口中央 */
  const jumpChange = (delta: -1 | 1) => {
    if (!summary || summary.changeRowIndices.length === 0) return
    const len = summary.changeRowIndices.length
    const nextPtr = (activeChangePtr + delta + len) % len
    setActiveChangePtr(nextPtr)
    const targetRow = summary.rows[summary.changeRowIndices[nextPtr]]
    if (targetRow) {
      const el = rowRefs.current.get(targetRow.id)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  /** 复制纯文本差异摘要 */
  const copyPlainDiff = async () => {
    if (!summary || !docA || !docB) return
    const lines = [
      `文档对比：${docA.name}  VS  ${docB.name}`,
      `相似度：${summary.similarityPercent}%（修改 ${summary.modifiedCount} · 新增 ${summary.addedCount} · 删除 ${summary.removedCount}）`,
      '----------------------------------------',
    ]
    for (const r of summary.rows) {
      if (r.status === 'equal') continue
      if (r.status === 'removed') lines.push(`[-] (${r.leftBlock?.tag}) ${r.leftBlock?.text}`)
      else if (r.status === 'added') lines.push(`[+] (${r.rightBlock?.tag}) ${r.rightBlock?.text}`)
      else if (r.status === 'modified') {
        lines.push(`[~] (${r.leftBlock?.tag})`)
        lines.push(`  旧：${r.leftBlock?.text}`)
        lines.push(`  新：${r.rightBlock?.text}`)
      }
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopiedDiff(true)
      toast.success('已复制差异明细文本')
      window.setTimeout(() => setCopiedDiff(false), 1500)
    } catch {
      toast.error('复制失败')
    }
  }

  /** 导出独立可打印 HTML 审阅报告 */
  const exportHtmlReport = () => {
    if (!summary || !docA || !docB) return
    const html = buildDiffHtmlReport(docA, docB, summary)
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), timestampName('Word差异审阅报告', 'html'))
    toast.success('已导出 HTML 审阅报告，双击即可离线查阅或打印')
  }

  /** 渲染单侧文档导入槽 */
  const renderUploadCard = (side: 'A' | 'B') => {
    const doc = side === 'A' ? docA : docB
    const ref = side === 'A' ? inputARef : inputBRef
    const isOver = dragSide === side

    return (
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragSide(side)
        }}
        onDragLeave={() => setDragSide((cur) => (cur === side ? null : cur))}
        onDrop={(e) => {
          e.preventDefault()
          setDragSide(null)
          void handleFiles(side, Array.from(e.dataTransfer.files))
        }}
        className={cn(
          'glass rounded-2xl p-3.5 transition-all',
          isOver && 'border-primary bg-primary/5 ring-primary/30 ring-2',
        )}
      >
        <input
          ref={ref}
          type="file"
          accept={ACCEPT_DOCS}
          multiple
          className="hidden"
          onChange={(e) => {
            const list = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (list.length) void handleFiles(side, list)
          }}
        />

        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex size-5 items-center justify-center rounded-md text-[11px] font-bold text-white',
                side === 'A' ? 'bg-rose-500' : 'bg-emerald-500',
              )}
            >
              {side}
            </span>
            <span className="text-sm font-semibold">{side === 'A' ? '原文档（旧版）' : '对比文档（新版）'}</span>
          </div>
          {doc && (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={() => ref.current?.click()}>
                更换
              </Button>
              <button
                type="button"
                onClick={() => (side === 'A' ? setDocA(null) : setDocB(null))}
                className="text-muted-foreground hover:text-destructive p-1"
                title="移除"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          )}
        </div>

        {doc ? (
          <div className="bg-background/70 flex items-center gap-3 rounded-xl border p-3">
            <div
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-xl',
                side === 'A' ? 'bg-rose-500/10 text-rose-500' : 'bg-emerald-500/10 text-emerald-500',
              )}
            >
              <FileText className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold" title={doc.name}>
                {doc.name}
              </div>
              <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-2 font-mono text-[11px]">
                <span>{formatBytes(doc.size)}</span>
                <span>·</span>
                <span>{doc.blocks.length} 段/行</span>
                {doc.tableCount > 0 && (
                  <>
                    <span>·</span>
                    <span>{doc.tableCount} 个表格</span>
                  </>
                )}
                <span>·</span>
                <span>{doc.charCount.toLocaleString()} 字</span>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => ref.current?.click()}
            className="border-foreground/15 hover:border-primary/60 hover:bg-primary/[0.03] flex min-h-[82px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed p-3 text-center transition"
          >
            <div className="text-primary flex items-center gap-1.5 text-xs font-semibold">
              <Upload className="size-4" />
              点击选择或拖入 .docx 文档
            </div>
            <span className="text-muted-foreground text-[11px]">支持一次拖入两份自动填入 A / B（也兼容 .txt / .md）</span>
          </button>
        )}
      </div>
    )
  }

  /** 渲染单条修改行的逐字红绿高亮 */
  const renderCharDiff = (row: DiffRow, side: 'left' | 'right' | 'inline') => {
    const changes = row.charChanges ?? []
    return changes.map((c, idx) => {
      if (side === 'left') {
        if (c.added) return null
        return c.removed ? (
          <mark
            key={idx}
            className="rounded bg-rose-500/25 px-0.5 text-rose-800 line-through decoration-rose-500/80 dark:text-rose-200"
          >
            {c.value}
          </mark>
        ) : (
          <span key={idx}>{c.value}</span>
        )
      }
      if (side === 'right') {
        if (c.removed) return null
        return c.added ? (
          <mark
            key={idx}
            className="rounded bg-emerald-500/25 px-0.5 font-semibold text-emerald-800 dark:text-emerald-200"
          >
            {c.value}
          </mark>
        ) : (
          <span key={idx}>{c.value}</span>
        )
      }
      // inline 合并视图
      if (c.removed) {
        return (
          <mark
            key={idx}
            className="rounded bg-rose-500/20 px-0.5 text-rose-700 line-through decoration-rose-500 dark:text-rose-300"
          >
            {c.value}
          </mark>
        )
      }
      if (c.added) {
        return (
          <mark
            key={idx}
            className="rounded bg-emerald-500/25 px-0.5 font-semibold text-emerald-800 underline decoration-emerald-500/60 underline-offset-2 dark:text-emerald-200"
          >
            {c.value}
          </mark>
        )
      }
      return <span key={idx}>{c.value}</span>
    })
  }

  const activeTargetRowId =
    summary && summary.changeRowIndices.length > 0
      ? summary.rows[summary.changeRowIndices[activeChangePtr % summary.changeRowIndices.length]]?.id
      : null

  return (
    <div className="space-y-4">
      {/* 顶部隐私提示与一键示例 */}
      <div className="glass flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-2.5 text-xs">
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
          <ShieldCheck className="size-4 shrink-0" />
          <span className="font-medium">100% 本地比对：合同与机密文档完全在浏览器内存中解析，绝不上传服务器</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={loadSample}>
            <Sparkles className="size-3.5" />
            载入合同对比示例
          </Button>
          {(docA || docB) && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive h-7 px-2 text-xs"
              onClick={() => {
                setDocA(null)
                setDocB(null)
              }}
            >
              <Trash2 className="size-3.5" />
              清空
            </Button>
          )}
        </div>
      </div>

      {/* 双文档导入区 */}
      <div className="relative grid gap-3 sm:grid-cols-2">
        {renderUploadCard('A')}
        {renderUploadCard('B')}

        {(docA || docB) && (
          <button
            type="button"
            onClick={swapDocs}
            title="互换文档 A / B"
            className="bg-card-solid hover:border-primary hover:text-primary absolute top-1/2 left-1/2 z-10 hidden size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-md transition sm:flex"
          >
            <ArrowLeftRight className="size-3.5" />
          </button>
        )}
      </div>

      {/* 对比结果控制栏与主视图 */}
      {summary && docA && docB ? (
        <div className="space-y-3">
          {/* 吸顶对比工具栏 */}
          <div className="glass sticky top-2 z-20 space-y-2.5 rounded-2xl p-3.5 text-xs shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              {/* 统计摘要 */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="bg-primary/10 text-primary rounded-lg px-2.5 py-1 font-mono font-bold">
                  相似度 {summary.similarityPercent}%
                </span>
                <span className="rounded-lg bg-amber-500/15 px-2 py-1 font-medium text-amber-700 dark:text-amber-300">
                  修改 {summary.modifiedCount}
                </span>
                <span className="rounded-lg bg-emerald-500/15 px-2 py-1 font-medium text-emerald-700 dark:text-emerald-300">
                  新增 {summary.addedCount}
                </span>
                <span className="rounded-lg bg-rose-500/15 px-2 py-1 font-medium text-rose-700 dark:text-rose-300">
                  删除 {summary.removedCount}
                </span>
              </div>

              {/* 差异跳转 & 导出 */}
              <div className="flex flex-wrap items-center gap-1.5">
                {totalChanges > 0 && (
                  <div className="bg-foreground/[0.05] inline-flex items-center gap-1 rounded-xl px-1.5 py-0.5">
                    <button
                      type="button"
                      onClick={() => jumpChange(-1)}
                      className="hover:bg-foreground/10 rounded-lg p-1"
                      title="上一处差异"
                    >
                      <ChevronUp className="size-3.5" />
                    </button>
                    <span className="px-1 font-mono text-[11px]">
                      {(activeChangePtr % totalChanges) + 1} / {totalChanges}
                    </span>
                    <button
                      type="button"
                      onClick={() => jumpChange(1)}
                      className="hover:bg-foreground/10 rounded-lg p-1"
                      title="下一处差异"
                    >
                      <ChevronDown className="size-3.5" />
                    </button>
                  </div>
                )}

                <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => void copyPlainDiff()}>
                  {copiedDiff ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  复制差异
                </Button>
                <Button variant="primary" size="sm" className="h-7 px-2.5 text-xs" onClick={exportHtmlReport}>
                  <Download className="size-3.5" />
                  导出审阅报告
                </Button>
              </div>
            </div>

            {/* 第二排：视图模式与比对规则开关 */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="w-44">
                  <Segmented<ViewMode>
                    value={viewMode}
                    onChange={setViewMode}
                    size="sm"
                    options={[
                      { value: 'split', label: '双栏', icon: <Columns2 className="size-3.5" /> },
                      { value: 'inline', label: '行内', icon: <Rows3 className="size-3.5" /> },
                    ]}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setOnlyChanges((v) => !v)}
                  className={cn(
                    'h-7 rounded-xl border px-2.5 font-medium transition',
                    onlyChanges
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-foreground/10 text-muted-foreground hover:text-foreground',
                  )}
                >
                  仅看差异 ({totalChanges})
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { key: 'ignoreWhitespace' as const, label: '忽略多余空格' },
                  { key: 'ignorePunctuation' as const, label: '忽略中英标点' },
                  { key: 'ignoreCase' as const, label: '忽略大小写' },
                  { key: 'includeHeaderFooter' as const, label: '比对页眉页脚' },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => toggleOpt(item.key)}
                    className={cn(
                      'rounded-lg border px-2 py-1 text-[11px] font-medium transition',
                      opts[item.key]
                        ? 'border-primary/50 bg-primary/10 text-primary'
                        : 'border-foreground/10 text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 差异正文展示区 */}
          {totalChanges === 0 ? (
            <div className="glass flex flex-col items-center justify-center gap-2 rounded-3xl py-14 text-center">
              <CheckCircle2 className="size-10 text-emerald-500" />
              <div className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                两份文档内容完全一致，未发现差异！
              </div>
              <p className="text-muted-foreground text-xs">
                共逐段核对 {summary.equalCount} 处正文与表格行（若需检查空格或标点微调，可关闭上方“忽略”项）
              </p>
            </div>
          ) : (
            <div className="glass overflow-hidden rounded-2xl">
              {viewMode === 'split' && (
                <div className="bg-muted/50 text-muted-foreground hidden grid-cols-2 border-b text-xs font-semibold sm:grid">
                  <div className="border-r px-4 py-2.5 truncate">A · {docA.name}</div>
                  <div className="px-4 py-2.5 truncate">B · {docB.name}</div>
                </div>
              )}

              <div className="divide-y">
                {displayRows.map((row) => {
                  const isFocused = activeTargetRowId === row.id && row.status !== 'equal'
                  const tagText = row.leftBlock?.tag || row.rightBlock?.tag || ''
                  const isTable = row.leftBlock?.kind === 'table-row' || row.rightBlock?.kind === 'table-row'

                  if (viewMode === 'split') {
                    return (
                      <div
                        key={row.id}
                        ref={(el) => {
                          if (el) rowRefs.current.set(row.id, el)
                          else rowRefs.current.delete(row.id)
                        }}
                        className={cn(
                          'grid grid-cols-1 text-sm leading-relaxed sm:grid-cols-2',
                          isFocused && 'ring-primary/60 ring-2 ring-inset',
                        )}
                      >
                        {/* 左栏：旧版 A */}
                        <div
                          className={cn(
                            'border-b px-4 py-3 break-words whitespace-pre-wrap sm:border-r sm:border-b-0',
                            row.status === 'removed' && 'bg-rose-500/[0.08]',
                            row.status === 'modified' && 'bg-amber-500/[0.05]',
                            row.status === 'added' && 'bg-foreground/[0.02] text-muted-foreground/50 italic',
                          )}
                        >
                          <div className="mb-1 flex items-center gap-1.5 text-[10px]">
                            {row.leftBlock && (
                              <span
                                className={cn(
                                  'rounded px-1.5 py-0.5 font-mono',
                                  isTable
                                    ? 'bg-violet-500/15 text-violet-600 dark:text-violet-300'
                                    : 'bg-muted text-muted-foreground',
                                )}
                              >
                                {row.leftBlock.tag}
                              </span>
                            )}
                            {row.status === 'removed' && (
                              <span className="rounded bg-rose-500/15 px-1.5 py-0.5 font-semibold text-rose-600 dark:text-rose-300">
                                已删除
                              </span>
                            )}
                          </div>
                          {row.status === 'equal' && (
                            <span className="text-foreground/85">{row.leftBlock?.text}</span>
                          )}
                          {row.status === 'removed' && (
                            <span className="text-rose-700 line-through decoration-rose-400 dark:text-rose-300">
                              {row.leftBlock?.text}
                            </span>
                          )}
                          {row.status === 'modified' && renderCharDiff(row, 'left')}
                          {row.status === 'added' && <span className="text-xs">（原文档无此内容）</span>}
                        </div>

                        {/* 右栏：新版 B */}
                        <div
                          className={cn(
                            'px-4 py-3 break-words whitespace-pre-wrap',
                            row.status === 'added' && 'bg-emerald-500/[0.08]',
                            row.status === 'modified' && 'bg-amber-500/[0.05]',
                            row.status === 'removed' && 'bg-foreground/[0.02] text-muted-foreground/50 italic',
                          )}
                        >
                          <div className="mb-1 flex items-center gap-1.5 text-[10px]">
                            {row.rightBlock && (
                              <span
                                className={cn(
                                  'rounded px-1.5 py-0.5 font-mono',
                                  isTable
                                    ? 'bg-violet-500/15 text-violet-600 dark:text-violet-300'
                                    : 'bg-muted text-muted-foreground',
                                )}
                              >
                                {row.rightBlock.tag}
                              </span>
                            )}
                            {row.status === 'added' && (
                              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-600 dark:text-emerald-300">
                                新增
                              </span>
                            )}
                          </div>
                          {row.status === 'equal' && (
                            <span className="text-foreground/85">{row.rightBlock?.text}</span>
                          )}
                          {row.status === 'added' && (
                            <span className="font-medium text-emerald-700 dark:text-emerald-300">
                              {row.rightBlock?.text}
                            </span>
                          )}
                          {row.status === 'modified' && renderCharDiff(row, 'right')}
                          {row.status === 'removed' && <span className="text-xs">（新文档已删除）</span>}
                        </div>
                      </div>
                    )
                  }

                  // 合并行内视图（类似 Word 修订模式）
                  return (
                    <div
                      key={row.id}
                      ref={(el) => {
                        if (el) rowRefs.current.set(row.id, el)
                        else rowRefs.current.delete(row.id)
                      }}
                      className={cn(
                        'px-4 py-3 text-sm leading-relaxed break-words whitespace-pre-wrap',
                        row.status === 'removed' && 'bg-rose-500/[0.08]',
                        row.status === 'added' && 'bg-emerald-500/[0.08]',
                        row.status === 'modified' && 'bg-amber-500/[0.05]',
                        isFocused && 'ring-primary/60 ring-2 ring-inset',
                      )}
                    >
                      <div className="mb-1 flex items-center gap-1.5 text-[10px]">
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 font-mono',
                            isTable
                              ? 'bg-violet-500/15 text-violet-600 dark:text-violet-300'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {tagText}
                        </span>
                        {row.status === 'modified' && (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-700 dark:text-amber-300">
                            修改
                          </span>
                        )}
                        {row.status === 'added' && (
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">
                            新增
                          </span>
                        )}
                        {row.status === 'removed' && (
                          <span className="rounded bg-rose-500/15 px-1.5 py-0.5 font-semibold text-rose-700 dark:text-rose-300">
                            删除
                          </span>
                        )}
                      </div>

                      {row.status === 'equal' && (
                        <span className="text-foreground/85">{row.leftBlock?.text}</span>
                      )}
                      {row.status === 'removed' && (
                        <span className="text-rose-700 line-through decoration-rose-400 dark:text-rose-300">
                          {row.leftBlock?.text}
                        </span>
                      )}
                      {row.status === 'added' && (
                        <span className="font-medium text-emerald-700 dark:text-emerald-300">
                          {row.rightBlock?.text}
                        </span>
                      )}
                      {row.status === 'modified' && renderCharDiff(row, 'inline')}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="glass flex flex-col items-center justify-center rounded-3xl py-14 text-center">
          <div className="bg-primary/10 text-primary mb-3 flex size-14 items-center justify-center rounded-2xl">
            <FileDiff className="size-7" />
          </div>
          <div className="text-base font-semibold">分别导入两份 .docx 文档即可秒查所有修改条款</div>
          <p className="text-muted-foreground mt-1.5 max-w-md text-xs leading-relaxed">
            支持正文段落、标题、合同报价表格及页眉页脚的逐段对齐与逐字红绿高亮，哪怕对方悄悄改了一个标点或小数点也能一眼揪出。
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={loadSample}>
            <Sparkles className="size-3.5" />
            一键体验合同 V1 vs V2 示例对比
          </Button>
        </div>
      )}
    </div>
  )
}
