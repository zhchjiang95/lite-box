import { useCallback, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  Code2,
  Copy,
  Download,
  FileUp,
  Info,
  Sparkles,
  Table2,
  Trash2,
  Wand2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { downloadBlob, timestampName } from '@/lib/file'
import { cn, formatBytes } from '@/lib/utils'
import {
  convertData,
  DEFAULT_CONVERT_OPTIONS,
  detectSourceFormat,
  extractTablePreview,
  highlightOutput,
  SAMPLE_INPUTS,
  SOURCE_FORMATS,
  TARGET_FORMATS,
  type ConvertOptions,
  type SourceFormat,
  type TargetFormat,
} from './engine'

const FILE_EXT_TO_SOURCE: Record<string, SourceFormat> = {
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  csv: 'csv',
  tsv: 'tsv',
}

/** 语法高亮双主题样式（内联作用域，轻量无全局污染） */
const HLJS_SCOPED_CSS = `
.dc-code .hljs-attr, .dc-code .hljs-attribute { color: #0284c7; }
.dc-code .hljs-string { color: #059669; }
.dc-code .hljs-number, .dc-code .hljs-literal { color: #d97706; }
.dc-code .hljs-keyword, .dc-code .hljs-built_in { color: #7c3aed; font-weight: 600; }
.dc-code .hljs-title, .dc-code .hljs-type, .dc-code .hljs-section { color: #2563eb; font-weight: 600; }
.dc-code .hljs-comment { color: #94a3b8; font-style: italic; }
.dark .dc-code .hljs-attr, .dark .dc-code .hljs-attribute { color: #38bdf8; }
.dark .dc-code .hljs-string { color: #34d399; }
.dark .dc-code .hljs-number, .dark .dc-code .hljs-literal { color: #fbbf24; }
.dark .dc-code .hljs-keyword, .dark .dc-code .hljs-built_in { color: #c084fc; }
.dark .dc-code .hljs-title, .dark .dc-code .hljs-type, .dark .dc-code .hljs-section { color: #60a5fa; }
`

export default function DataConvertTool() {
  const [sourceFormat, setSourceFormat] = useState<SourceFormat>('json')
  const [targetFormat, setTargetFormat] = useState<TargetFormat>('typescript')
  const [input, setInput] = useState<string>(SAMPLE_INPUTS.json)
  const [opts, setOpts] = useState<ConvertOptions>(DEFAULT_CONVERT_OPTIONS)
  const [outputView, setOutputView] = useState<'code' | 'table'>('code')
  const [dragging, setDragging] = useState(false)
  const [copied, setCopied] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const patchOpts = useCallback((patch: Partial<ConvertOptions>) => {
    setOpts((prev) => ({ ...prev, ...patch }))
  }, [])

  // 实时执行转换
  const result = useMemo(
    () => convertData(input, sourceFormat, targetFormat, opts),
    [input, sourceFormat, targetFormat, opts],
  )

  const highlightedHtml = useMemo(
    () => (result.ok ? highlightOutput(result.output, targetFormat) : ''),
    [result, targetFormat],
  )

  const tablePreview = useMemo(
    () => (result.ok ? extractTablePreview(result.parsedData) : null),
    [result],
  )

  const targetMeta = useMemo(
    () => TARGET_FORMATS.find((t) => t.id === targetFormat)!,
    [targetFormat],
  )

  const canSwap =
    result.ok &&
    (targetFormat === 'json' || targetFormat === 'yaml' || targetFormat === 'toml' || targetFormat === 'csv')

  // 交换源与目标格式（把右侧结果放回左侧继续转换）
  const handleSwap = () => {
    if (!result.ok || !canSwap) return
    const nextSource = targetFormat as SourceFormat
    const nextTarget: TargetFormat = sourceFormat === 'tsv' ? 'csv' : sourceFormat
    setInput(result.output)
    setSourceFormat(nextSource)
    setTargetFormat(nextTarget)
    setOutputView('code')
    toast.success(`已切换为 ${nextSource.toUpperCase()} → ${nextTarget.toUpperCase()}`)
  }

  // 智能识别当前输入格式
  const handleAutoDetect = () => {
    if (!input.trim()) {
      toast.info('请先输入或粘贴源数据')
      return
    }
    const detected = detectSourceFormat(input)
    setSourceFormat(detected)
    toast.success(`已自动识别为 ${detected.toUpperCase()}`)
  }

  // 导入文本文件（自动按后缀切换源格式）
  const loadTextFile = async (file: File) => {
    if (file.size > 15 * 1024 * 1024) {
      toast.error('文件过大（超过 15MB），请分批处理')
      return
    }
    try {
      const text = await file.text()
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      const fmt = FILE_EXT_TO_SOURCE[ext] ?? detectSourceFormat(text)
      setSourceFormat(fmt)
      setInput(text)
      toast.success(`已导入「${file.name}」并切换为 ${fmt.toUpperCase()}`)
    } catch {
      toast.error('读取文件失败')
    }
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void loadTextFile(file)
  }

  // 左栏输入支持 Tab 键插入两空格缩进
  const handleTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.currentTarget
      const start = el.selectionStart
      const end = el.selectionEnd
      const next = input.slice(0, start) + '  ' + input.slice(end)
      setInput(next)
      requestAnimationFrame(() => {
        el.setSelectionRange(start + 2, start + 2)
      })
    }
  }

  // 一键美化当前 JSON 输入
  const handleFormatInputJson = () => {
    try {
      const parsed = JSON.parse(input)
      setInput(JSON.stringify(parsed, null, 2))
      toast.success('已格式化源 JSON')
    } catch {
      toast.error('当前输入不是合法 JSON，无法格式化')
    }
  }

  // 复制输出
  const handleCopy = async () => {
    if (!result.ok || !result.output) return
    try {
      await navigator.clipboard.writeText(result.output)
      setCopied(true)
      toast.success(`已复制 ${targetMeta.label} 结果`)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('复制失败，请手动选中复制')
    }
  }

  // 下载输出文件（CSV 自动添加 UTF-8 BOM 给 Excel 无乱码打开）
  const handleDownload = () => {
    if (!result.ok || !result.output) return
    const content = targetFormat === 'csv' ? '\uFEFF' + result.output : result.output
    const blob = new Blob([content], { type: targetMeta.mime })
    const prefix = targetFormat === 'typescript' || targetFormat === 'zod' ? opts.rootName || 'types' : 'converted'
    downloadBlob(blob, timestampName(prefix.toLowerCase(), targetMeta.ext))
    toast.success(`已下载 .${targetMeta.ext} 文件`)
  }

  const showTsOpts = targetFormat === 'typescript' || targetFormat === 'zod'
  const showJsonYamlOpts = targetFormat === 'json' || targetFormat === 'yaml'
  const showCsvOpts = sourceFormat === 'csv' || sourceFormat === 'tsv' || targetFormat === 'csv'

  return (
    <div className="space-y-4">
      <style>{HLJS_SCOPED_CSS}</style>

      {/* ================= 顶部格式选择与互换控制栏 ================= */}
      <section className="glass shadow-soft space-y-3 rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* 源格式 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground mr-1 text-xs font-semibold">源格式</span>
            {SOURCE_FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setSourceFormat(f.id)}
                className={cn(
                  'rounded-xl px-2.5 py-1.5 font-mono text-xs font-medium transition',
                  sourceFormat === f.id
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'bg-foreground/[0.05] text-muted-foreground hover:text-foreground',
                )}
              >
                {f.label}
              </button>
            ))}
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleAutoDetect} title="自动识别输入格式">
              <Wand2 className="!size-3.5" />
              自动识别
            </Button>
          </div>

          {/* 左右互换 */}
          <Button
            size="sm"
            variant="outline"
            disabled={!canSwap}
            onClick={handleSwap}
            title={canSwap ? '将右侧输出放回左侧并互换格式' : '当前目标格式（如 TypeScript/Zod）为单向代码生成'}
          >
            <ArrowLeftRight className="!size-3.5" />
            结果互换
          </Button>

          {/* 目标格式 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground mr-1 text-xs font-semibold">转为</span>
            {TARGET_FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setTargetFormat(f.id)
                  setOutputView('code')
                }}
                className={cn(
                  'rounded-xl px-2.5 py-1.5 font-mono text-xs font-medium transition',
                  targetFormat === f.id
                    ? 'bg-emerald-600 text-white shadow-xs dark:bg-emerald-500'
                    : 'bg-foreground/[0.05] text-muted-foreground hover:text-foreground',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* 上下文智能配置条（仅展示当前转换相关项） */}
        <div className="border-border/60 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3 text-xs">
          {showTsOpts && (
            <>
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground">根名称</span>
                <input
                  type="text"
                  value={opts.rootName}
                  onChange={(e) => patchOpts({ rootName: e.target.value })}
                  placeholder="Root"
                  className="border-border/70 bg-background/60 focus:border-primary h-7 w-28 rounded-lg border px-2 font-mono text-xs outline-none"
                />
              </label>

              {targetFormat === 'typescript' && (
                <div className="bg-foreground/[0.06] inline-flex rounded-lg p-0.5">
                  {(['interface', 'type'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => patchOpts({ tsKind: k })}
                      className={cn(
                        'rounded-md px-2 py-0.5 font-mono transition',
                        opts.tsKind === k ? 'bg-card-solid text-foreground shadow-2xs' : 'text-muted-foreground',
                      )}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              )}

              <label className="flex items-center gap-1.5">
                <span className="text-muted-foreground">export</span>
                <Switch checked={opts.tsExport} onChange={(v) => patchOpts({ tsExport: v })} label="导出修饰" />
              </label>

              {targetFormat === 'typescript' && (
                <label className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">readonly</span>
                  <Switch checked={opts.tsReadonly} onChange={(v) => patchOpts({ tsReadonly: v })} label="只读属性" />
                </label>
              )}

              <label className="flex items-center gap-1.5">
                <span className="text-muted-foreground">全部可选 (?)</span>
                <Switch
                  checked={opts.tsAllOptional}
                  onChange={(v) => patchOpts({ tsAllOptional: v })}
                  label="全部属性可选"
                />
              </label>
            </>
          )}

          {showJsonYamlOpts && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">缩进</span>
                <div className="bg-foreground/[0.06] inline-flex rounded-lg p-0.5">
                  {(targetFormat === 'json'
                    ? [
                        [2, '2 空格'],
                        [4, '4 空格'],
                        [0, '单行压缩'],
                      ]
                    : [
                        [2, '2 空格'],
                        [4, '4 空格'],
                      ]
                  ).map(([val, label]) => (
                    <button
                      key={String(val)}
                      type="button"
                      onClick={() => patchOpts({ indent: val as 0 | 2 | 4 })}
                      className={cn(
                        'rounded-md px-2 py-0.5 transition',
                        opts.indent === val ? 'bg-card-solid text-foreground shadow-2xs' : 'text-muted-foreground',
                      )}
                    >
                      {label as string}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Key 字母排序</span>
                <Switch checked={opts.sortKeys} onChange={(v) => patchOpts({ sortKeys: v })} label="Key 排序" />
              </label>
            </>
          )}

          {showCsvOpts && (
            <>
              {sourceFormat !== 'tsv' && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">分隔符</span>
                  <div className="bg-foreground/[0.06] inline-flex rounded-lg p-0.5 font-mono">
                    {(
                      [
                        [',', '逗号 ,'],
                        [';', '分号 ;'],
                        ['\t', 'Tab'],
                      ] as const
                    ).map(([d, label]) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => patchOpts({ csvDelimiter: d })}
                        className={cn(
                          'rounded-md px-2 py-0.5 transition',
                          opts.csvDelimiter === d ? 'bg-card-solid text-foreground shadow-2xs' : 'text-muted-foreground',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <label className="flex items-center gap-1.5">
                <span className="text-muted-foreground">点号展平嵌套 (a.b)</span>
                <Switch checked={opts.csvFlatten} onChange={(v) => patchOpts({ csvFlatten: v })} label="嵌套展平" />
              </label>

              {(sourceFormat === 'csv' || sourceFormat === 'tsv') && (
                <label className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">自动推断数字/布尔</span>
                  <Switch
                    checked={opts.csvInferTypes}
                    onChange={(v) => patchOpts({ csvInferTypes: v })}
                    label="类型推断"
                  />
                </label>
              )}
            </>
          )}
        </div>
      </section>

      {/* ================= 双栏输入与结果工作区 ================= */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 左栏：源数据编辑器（支持文件拖放） */}
        <section
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={cn(
            'glass shadow-soft flex min-h-[520px] flex-col overflow-hidden rounded-2xl border transition',
            dragging && 'border-primary ring-primary/25 ring-2',
          )}
        >
          <div className="border-border/60 bg-foreground/[0.025] flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="bg-primary/12 text-primary rounded-md px-2 py-0.5 font-mono font-semibold uppercase">
                {sourceFormat}
              </span>
              <span className="text-muted-foreground">输入区（可拖入文件）</span>
            </div>

            <div className="flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                hidden
                accept=".json,.yaml,.yml,.toml,.csv,.tsv,.txt"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void loadTextFile(f)
                  e.target.value = ''
                }}
              />
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => fileInputRef.current?.click()}>
                <FileUp className="!size-3.5" />
                导入
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setInput(SAMPLE_INPUTS[sourceFormat])}
              >
                <Sparkles className="!size-3.5" />
                示例
              </Button>
              {sourceFormat === 'json' && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleFormatInputJson}>
                  美化
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="size-7 text-muted-foreground hover:text-rose-500"
                onClick={() => setInput('')}
                title="清空输入"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            spellCheck={false}
            placeholder={`粘贴或拖入 ${sourceFormat.toUpperCase()} 文件内容，右侧将实时转换…`}
            className="placeholder:text-muted-foreground/50 min-h-[440px] flex-1 resize-none bg-transparent p-4 font-mono text-xs leading-relaxed outline-none sm:text-[13px]"
          />

          <div className="border-border/60 bg-foreground/[0.02] text-muted-foreground flex items-center justify-between border-t px-4 py-2 font-mono text-[11px]">
            <span>{input ? `${input.split('\n').length} 行` : '0 行'}</span>
            <span>{formatBytes(new Blob([input]).size)}</span>
          </div>
        </section>

        {/* 右栏：转换输出（代码高亮 + 可选表格预览） */}
        <section className="glass shadow-soft flex min-h-[520px] flex-col overflow-hidden rounded-2xl border">
          <div className="border-border/60 bg-foreground/[0.025] flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 font-mono font-semibold text-emerald-700 dark:text-emerald-300">
                {targetMeta.label}
              </span>
              {tablePreview && (
                <Segmented
                  size="sm"
                  value={outputView}
                  onChange={setOutputView}
                  className="w-auto"
                  options={[
                    { value: 'code', label: '代码', icon: <Code2 className="!size-3" /> },
                    { value: 'table', label: '表格', icon: <Table2 className="!size-3" /> },
                  ]}
                />
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" disabled={!result.ok} onClick={handleCopy}>
                {copied ? <Check className="!size-3.5 text-emerald-500" /> : <Copy className="!size-3.5" />}
                {copied ? '已复制' : '复制'}
              </Button>
              <Button size="sm" variant="primary" className="h-7 px-2.5 text-xs" disabled={!result.ok} onClick={handleDownload}>
                <Download className="!size-3.5" />
                .{targetMeta.ext}
              </Button>
            </div>
          </div>

          {/* 温和提示条（如 TOML 跳过 null、自动包装顶层数组等） */}
          {result.ok && result.notices.length > 0 && (
            <div className="border-border/50 space-y-1 border-b bg-amber-500/[0.06] px-4 py-2 text-[11px] text-amber-800 dark:text-amber-300">
              {result.notices.map((n, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Info className="size-3.5 shrink-0" />
                  <span>{n}</span>
                </div>
              ))}
            </div>
          )}

          {/* 主输出内容区 */}
          <div className="relative flex-1 overflow-auto">
            {!result.ok ? (
              result.empty ? (
                <div className="text-muted-foreground flex h-full min-h-[380px] flex-col items-center justify-center gap-2 p-6 text-center text-xs">
                  <Code2 className="size-9 opacity-25" />
                  <span>在左侧输入或拖入数据文件，即可实时生成 {targetMeta.label}</span>
                </div>
              ) : (
                <div className="p-5">
                  <div className="flex items-start gap-2.5 rounded-2xl border border-rose-500/30 bg-rose-500/[0.06] p-4 text-xs text-rose-600 dark:text-rose-400">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <div className="space-y-1">
                      <div className="font-semibold">格式解析或转换失败</div>
                      <pre className="font-mono leading-relaxed break-all whitespace-pre-wrap">{result.error}</pre>
                    </div>
                  </div>
                </div>
              )
            ) : outputView === 'table' && tablePreview ? (
              <div className="p-3">
                <div className="text-muted-foreground mb-2 flex items-center justify-between px-1 text-[11px]">
                  <span>
                    表格视图（数据源：{tablePreview.label}，共 {tablePreview.rows.length} 行 × {tablePreview.headers.length} 列）
                  </span>
                </div>
                <div className="border-border/70 overflow-auto rounded-xl border">
                  <table className="w-full border-collapse text-left font-mono text-xs">
                    <thead className="bg-foreground/[0.04] border-b">
                      <tr>
                        <th className="text-muted-foreground w-10 px-2.5 py-2 text-center">#</th>
                        {tablePreview.headers.map((h) => (
                          <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-border/40 divide-y">
                      {tablePreview.rows.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-foreground/[0.025]">
                          <td className="text-muted-foreground px-2.5 py-1.5 text-center">{rIdx + 1}</td>
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} className="max-w-[240px] truncate px-3 py-1.5" title={cell}>
                              {cell || <span className="opacity-30">—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <pre className="dc-code min-h-[440px] p-4 font-mono text-xs leading-relaxed select-all sm:text-[13px]">
                <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
              </pre>
            )}
          </div>

          {/* 底部统计条 */}
          <div className="border-border/60 bg-foreground/[0.02] text-muted-foreground flex items-center justify-between border-t px-4 py-2 font-mono text-[11px]">
            <span>
              {result.ok
                ? `${result.stats.lines} 行${result.stats.itemCount !== undefined ? ` · ${result.stats.itemCount} 项` : ''}`
                : '等待有效输入'}
            </span>
            <span>{result.ok ? formatBytes(result.stats.bytes) : '0 B'}</span>
          </div>
        </section>
      </div>
    </div>
  )
}
