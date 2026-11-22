import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Download,
  Eye,
  FileText,
  List,
  Pencil,
  Plus,
  Replace,
  RotateCcw,
  ScanSearch,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { Button } from '@/components/ui/button'
import { Field, Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { downloadBlob, timestampName } from '@/lib/file'
import { cn, uid } from '@/lib/utils'
import { computeLineDiff, runBatchReplace, runExtraction, type MatchItem } from './engine'
import {
  EXTRACT_PRESETS,
  REPLACE_PRESETS,
  SAMPLE_MESSY_TEXT,
  defaultExtractOptions,
  type ExtractOptions,
  type OutputFormat,
  type RegexFlags,
  type ReplacePreset,
  type ReplaceRule,
  type SortMode,
  type WorkMode,
} from './types'

/** 高亮渲染阈值，防止超大日志导致 DOM 节点过多 */
const HIGHLIGHT_CHAR_LIMIT = 120_000
const HIGHLIGHT_MATCH_LIMIT = 2_000

const FLAG_META: { key: keyof RegexFlags; label: string; title: string }[] = [
  { key: 'i', label: 'i', title: '忽略大小写' },
  { key: 'm', label: 'm', title: '多行模式（^ 与 $ 匹配行首行尾）' },
  { key: 's', label: 's', title: '点号匹配换行符' },
  { key: 'u', label: 'u', title: 'Unicode 完整模式' },
]

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'none', label: '保持原序' },
  { value: 'asc', label: '升序 A→Z' },
  { value: 'desc', label: '降序 Z→A' },
  { value: 'numeric', label: '按数值' },
  { value: 'length-asc', label: '短→长' },
  { value: 'length-desc', label: '长→短' },
]

const FORMAT_OPTIONS: { value: OutputFormat; label: string; ext: string }[] = [
  { value: 'newline', label: '逐行', ext: 'txt' },
  { value: 'comma', label: '逗号', ext: 'txt' },
  { value: 'semicolon', label: '分号', ext: 'txt' },
  { value: 'tab', label: 'Tab', ext: 'txt' },
  { value: 'json', label: 'JSON', ext: 'json' },
  { value: 'csv', label: 'CSV', ext: 'csv' },
]

function createRuleFromPreset(p: ReplacePreset): ReplaceRule {
  return {
    id: uid(),
    name: p.name,
    enabled: true,
    isRegex: p.isRegex,
    pattern: p.pattern,
    replacement: p.replacement,
    ignoreCase: p.ignoreCase ?? false,
    multiline: p.multiline ?? false,
    unescapeReplacement: true,
  }
}

function createEmptyRule(): ReplaceRule {
  return {
    id: uid(),
    name: '自定义替换规则',
    enabled: true,
    isRegex: true,
    pattern: '',
    replacement: '',
    ignoreCase: false,
    multiline: true,
    unescapeReplacement: true,
  }
}

/** 原文高亮视图：将命中的片段用柔和交替色块标出 */
function HighlightedSource({ text, matches }: { text: string; matches: MatchItem[] }) {
  const pieces = useMemo(() => {
    if (!text) return null
    if (text.length > HIGHLIGHT_CHAR_LIMIT || matches.length > HIGHLIGHT_MATCH_LIMIT) {
      return 'too-large' as const
    }
    const nodes: { text: string; hitIndex?: number }[] = []
    let cursor = 0
    for (const m of matches) {
      if (m.start < cursor) continue
      if (m.start > cursor) {
        nodes.push({ text: text.slice(cursor, m.start) })
      }
      if (m.end > m.start) {
        nodes.push({ text: text.slice(m.start, m.end), hitIndex: m.index })
      }
      cursor = m.end
    }
    if (cursor < text.length) {
      nodes.push({ text: text.slice(cursor) })
    }
    return nodes
  }, [text, matches])

  if (!text) {
    return <div className="text-muted-foreground p-4 text-xs">暂无文本，请先粘贴或填入示例文本。</div>
  }

  if (pieces === 'too-large') {
    return (
      <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 p-8 text-center text-xs">
        <AlertCircle className="size-5 text-amber-500" />
        <div>文本或命中数较大，为保证页面流畅已自动关闭逐字高亮预览；右侧提取结果仍完整准确。</div>
      </div>
    )
  }

  return (
    <pre className="max-h-[420px] min-h-[260px] overflow-auto p-4 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
      {pieces?.map((part, idx) =>
        part.hitIndex !== undefined ? (
          <mark
            key={idx}
            title={`第 ${part.hitIndex} 处命中`}
            className={cn(
              'rounded px-0.5 py-0.5 font-medium text-foreground',
              part.hitIndex % 2 === 1
                ? 'bg-sky-500/25 ring-1 ring-sky-500/40'
                : 'bg-violet-500/25 ring-1 ring-violet-500/40',
            )}
          >
            {part.text}
          </mark>
        ) : (
          <span key={idx}>{part.text}</span>
        ),
      )}
    </pre>
  )
}

export default function TextExtract() {
  const [mode, setMode] = useState<WorkMode>('extract')
  const [sourceText, setSourceText] = useState(SAMPLE_MESSY_TEXT)
  const [inputView, setInputView] = useState<'edit' | 'highlight'>('edit')
  const [extractView, setExtractView] = useState<'text' | 'table'>('text')
  const [replaceView, setReplaceView] = useState<'text' | 'diff'>('text')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const [extractOpts, setExtractOpts] = useState<ExtractOptions>(defaultExtractOptions)
  const [rules, setRules] = useState<ReplaceRule[]>(() => [createRuleFromPreset(REPLACE_PRESETS[0])])

  const fileInputRef = useRef<HTMLInputElement>(null)

  const setExtract = <K extends keyof ExtractOptions>(k: K, v: ExtractOptions[K]) =>
    setExtractOpts((prev) => ({ ...prev, [k]: v }))

  /** 计算提取结果 */
  const extractResult = useMemo(() => {
    if (mode !== 'extract') {
      return { error: null, truncated: false, matches: [], values: [], formattedText: '' }
    }
    return runExtraction(sourceText, extractOpts)
  }, [mode, sourceText, extractOpts])

  /** 计算批量替换结果 */
  const replaceResult = useMemo(() => {
    if (mode !== 'replace') {
      return { output: sourceText, totalReplacements: 0, stats: [], hasError: false }
    }
    return runBatchReplace(sourceText, rules)
  }, [mode, sourceText, rules])

  /** 计算替换行级差异 */
  const diffRows = useMemo(() => {
    if (mode !== 'replace' || replaceView !== 'diff') return null
    return computeLineDiff(sourceText, replaceResult.output)
  }, [mode, replaceView, sourceText, replaceResult.output])

  const ruleStatMap = useMemo(
    () => new Map(replaceResult.stats.map((s) => [s.ruleId, s])),
    [replaceResult.stats],
  )

  /** 选择内置提取预设 */
  const selectExtractPreset = (presetId: string) => {
    const preset = EXTRACT_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    setExtractOpts((prev) => ({
      ...prev,
      presetId: preset.id,
      pattern: preset.pattern,
      template: preset.template ?? '',
      flags: {
        i: preset.flags.i ?? false,
        m: preset.flags.m ?? true,
        s: preset.flags.s ?? false,
        u: preset.flags.u ?? false,
      },
    }))
  }

  /** 复制文本并弹出轻提示 */
  const copyText = async (text: string, key = 'main') => {
    if (!text) {
      toast.error('当前没有可复制的结果')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      toast.success('已复制到剪贴板')
      setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500)
    } catch {
      toast.error('剪贴板写入失败，请手动选中复制')
    }
  }

  /** 导出当前结果文件 */
  const handleDownload = () => {
    if (mode === 'extract') {
      if (!extractResult.formattedText) {
        toast.error('暂无提取结果可导出')
        return
      }
      const fmt = FORMAT_OPTIONS.find((f) => f.value === extractOpts.format) ?? FORMAT_OPTIONS[0]
      const mime =
        fmt.ext === 'json'
          ? 'application/json;charset=utf-8'
          : fmt.ext === 'csv'
            ? 'text/csv;charset=utf-8'
            : 'text/plain;charset=utf-8'
      // CSV 附带 UTF-8 BOM，避免 Excel 打开中文乱码
      const payload = fmt.ext === 'csv' ? `\uFEFF${extractResult.formattedText}` : extractResult.formattedText
      downloadBlob(new Blob([payload], { type: mime }), timestampName('提取结果', fmt.ext))
      toast.success(`已导出 .${fmt.ext} 文件`)
    } else {
      if (!replaceResult.output) {
        toast.error('暂无替换结果可导出')
        return
      }
      downloadBlob(
        new Blob([replaceResult.output], { type: 'text/plain;charset=utf-8' }),
        timestampName('批量替换结果', 'txt'),
      )
      toast.success('已导出替换结果 .txt')
    }
  }

  /** 导入本地文本文件 */
  const handleImportFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error('单个文本文件请小于 10 MB')
      return
    }
    try {
      const content = await file.text()
      setSourceText(content)
      toast.success(`已导入「${file.name}」（${content.length.toLocaleString()} 字符）`)
    } catch {
      toast.error('读取文件失败，请确认为 UTF-8 纯文本文件')
    }
  }

  /** 更新单条替换规则 */
  const updateRule = (id: string, patch: Partial<ReplaceRule>) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const moveRule = (index: number, delta: -1 | 1) => {
    setRules((prev) => {
      const nextIdx = index + delta
      if (nextIdx < 0 || nextIdx >= prev.length) return prev
      const copy = [...prev]
      const [item] = copy.splice(index, 1)
      copy.splice(nextIdx, 0, item)
      return copy
    })
  }

  const removeRule = (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id))
  }

  const addPresetRule = (preset: ReplacePreset) => {
    setRules((prev) => [...prev, createRuleFromPreset(preset)])
    toast.success(`已添加规则：${preset.label}`)
  }

  const applyReplaceToSource = () => {
    setSourceText(replaceResult.output)
    toast.success('已将替换结果覆盖为新原文，可继续二次处理')
  }

  /** 左侧参数面板 */
  const panel = (
    <div className="space-y-5">
      <Segmented<WorkMode>
        value={mode}
        onChange={setMode}
        options={[
          { value: 'extract', label: '正则提取', icon: <ScanSearch /> },
          { value: 'replace', label: '批量替换', icon: <Replace /> },
        ]}
      />

      {mode === 'extract' ? (
        <div className="space-y-5">
          {/* 快捷一键提取预设 */}
          <Field label="一键提取预设">
            <div className="grid grid-cols-2 gap-1.5">
              {EXTRACT_PRESETS.map((p) => {
                const active = extractOpts.presetId === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    title={p.desc}
                    onClick={() => selectExtractPreset(p.id)}
                    className={cn(
                      'rounded-xl border px-2.5 py-2 text-left transition',
                      active
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-foreground/10 hover:border-foreground/25 text-muted-foreground',
                    )}
                  >
                    <div className="text-xs font-semibold">{p.label}</div>
                    <div className="mt-0.5 truncate text-[10px] opacity-75">{p.desc}</div>
                  </button>
                )
              })}
            </div>
          </Field>

          {/* 自定义正则表达式 */}
          <Field label="正则表达式" value={extractOpts.presetId === 'custom' ? '自定义' : '已选预设'}>
            <div className="space-y-2">
              <div className="bg-background focus-within:border-primary flex items-center rounded-xl border px-2.5 py-1.5 font-mono text-xs transition">
                <span className="text-muted-foreground select-none">/</span>
                <input
                  type="text"
                  value={extractOpts.pattern}
                  onChange={(e) =>
                    setExtractOpts((prev) => ({
                      ...prev,
                      presetId: 'custom',
                      pattern: e.target.value,
                    }))
                  }
                  placeholder="输入正则表达式，如 (\w+)@(\w+\.\w+)"
                  className="mx-1 min-w-0 flex-1 bg-transparent outline-none"
                />
                <span className="text-muted-foreground select-none">
                  /g{extractOpts.flags.i ? 'i' : ''}
                  {extractOpts.flags.m ? 'm' : ''}
                  {extractOpts.flags.s ? 's' : ''}
                  {extractOpts.flags.u ? 'u' : ''}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {FLAG_META.map((f) => {
                  const active = extractOpts.flags[f.key]
                  return (
                    <button
                      key={f.key}
                      type="button"
                      title={f.title}
                      onClick={() =>
                        setExtract('flags', {
                          ...extractOpts.flags,
                          [f.key]: !active,
                        })
                      }
                      className={cn(
                        'rounded-lg border px-2 py-1 font-mono text-[11px] font-medium transition',
                        active
                          ? 'border-primary bg-primary/15 text-primary'
                          : 'border-foreground/10 text-muted-foreground hover:text-foreground',
                      )}
                    >
                      -{f.label} {f.key === 'i' ? '忽略大小写' : f.key === 'm' ? '多行' : f.key === 's' ? '跨行点' : 'Unicode'}
                    </button>
                  )
                })}
              </div>

              {extractResult.error && (
                <div className="flex items-start gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-[11px] text-red-600 dark:text-red-400">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{extractResult.error}</span>
                </div>
              )}
            </div>
          </Field>

          {/* 捕获组输出模板 */}
          <Field label="输出模板（可选）" value="$& / $1 / $<name>">
            <input
              type="text"
              value={extractOpts.template}
              onChange={(e) => setExtract('template', e.target.value)}
              placeholder="留空输出完整匹配，如 $1 或 邮箱: $&"
              className="bg-background focus:border-primary w-full rounded-xl border px-3 py-2 font-mono text-xs outline-none"
            />
          </Field>

          {/* 清洗与排序 */}
          <div className="space-y-3 border-t pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">结果自动去重</span>
              <Switch checked={extractOpts.dedupe} onChange={(v) => setExtract('dedupe', v)} label="结果去重" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">去除每项首尾空白</span>
              <Switch checked={extractOpts.trimEach} onChange={(v) => setExtract('trimEach', v)} label="去除首尾空白" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">过滤空结果</span>
              <Switch checked={extractOpts.ignoreEmpty} onChange={(v) => setExtract('ignoreEmpty', v)} label="过滤空结果" />
            </div>
          </div>

          <Field label="排序方式">
            <div className="grid grid-cols-3 gap-1.5">
              {SORT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setExtract('sort', o.value)}
                  className={cn(
                    'rounded-lg border py-1.5 text-xs font-medium transition',
                    extractOpts.sort === o.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-foreground/10 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="导出 / 拼接格式">
            <div className="grid grid-cols-3 gap-1.5">
              {FORMAT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setExtract('format', o.value)}
                  className={cn(
                    'rounded-lg border py-1.5 text-xs font-medium transition',
                    extractOpts.format === o.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-foreground/10 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Field>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 一键添加常用脱敏与清洗规则 */}
          <Field label="快捷添加常用规则">
            <div className="flex flex-wrap gap-1.5">
              {REPLACE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => addPresetRule(p)}
                  className="border-foreground/10 hover:border-primary/50 hover:text-primary inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition"
                >
                  <Plus className="size-3" />
                  {p.label}
                </button>
              ))}
            </div>
          </Field>

          {/* 替换规则流水线列表 */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">替换规则流水线（{rules.length}）</span>
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setRules((prev) => [...prev, createEmptyRule()])}>
                <Plus className="size-3.5" />
                新增规则
              </Button>
            </div>

            {rules.length === 0 ? (
              <div className="text-muted-foreground rounded-xl border border-dashed p-4 text-center text-xs">
                暂无替换规则，点击上方快捷规则或「新增规则」开始。
              </div>
            ) : (
              <div className="space-y-2.5">
                {rules.map((rule, idx) => {
                  const stat = ruleStatMap.get(rule.id)
                  return (
                    <div
                      key={rule.id}
                      className={cn(
                        'rounded-xl border p-3 transition',
                        rule.enabled ? 'bg-background/60 border-foreground/15' : 'bg-muted/30 opacity-65',
                      )}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="bg-primary/10 text-primary flex size-5 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-bold">
                            {idx + 1}
                          </span>
                          <input
                            type="text"
                            value={rule.name}
                            onChange={(e) => updateRule(rule.id, { name: e.target.value })}
                            className="min-w-0 flex-1 bg-transparent text-xs font-semibold outline-none"
                          />
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {stat && !stat.error && (
                            <span className="bg-emerald-500/10 rounded px-1.5 py-0.5 font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
                              {stat.count} 处
                            </span>
                          )}
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveRule(idx, -1)}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                            title="上移"
                          >
                            <ArrowUp className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === rules.length - 1}
                            onClick={() => moveRule(idx, 1)}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                            title="下移"
                          >
                            <ArrowDown className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeRule(rule.id)}
                            className="text-muted-foreground hover:text-destructive"
                            title="删除规则"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <input
                          type="text"
                          value={rule.pattern}
                          onChange={(e) => updateRule(rule.id, { pattern: e.target.value })}
                          placeholder={rule.isRegex ? '查找正则，例如 (\\d{3})\\d{4}(\\d{4})' : '查找纯文本'}
                          className="bg-background focus:border-primary w-full rounded-lg border px-2.5 py-1.5 font-mono text-xs outline-none"
                        />
                        <input
                          type="text"
                          value={rule.replacement}
                          onChange={(e) => updateRule(rule.id, { replacement: e.target.value })}
                          placeholder="替换为（支持 $1、$&、\n、\t，留空即删除）"
                          className="bg-background focus:border-primary w-full rounded-lg border px-2.5 py-1.5 font-mono text-xs outline-none"
                        />

                        {stat?.error && (
                          <div className="flex items-start gap-1 text-[11px] text-red-500">
                            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                            <span>{stat.error}</span>
                          </div>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                          <div className="flex flex-wrap items-center gap-1">
                            <button
                              type="button"
                              onClick={() => updateRule(rule.id, { isRegex: !rule.isRegex })}
                              className={cn(
                                'rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium',
                                rule.isRegex
                                  ? 'border-primary bg-primary/15 text-primary'
                                  : 'border-foreground/10 text-muted-foreground',
                              )}
                            >
                              .* 正则
                            </button>
                            <button
                              type="button"
                              onClick={() => updateRule(rule.id, { ignoreCase: !rule.ignoreCase })}
                              className={cn(
                                'rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium',
                                rule.ignoreCase
                                  ? 'border-primary bg-primary/15 text-primary'
                                  : 'border-foreground/10 text-muted-foreground',
                              )}
                            >
                              Aa 忽略大小写
                            </button>
                            <button
                              type="button"
                              onClick={() => updateRule(rule.id, { multiline: !rule.multiline })}
                              className={cn(
                                'rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium',
                                rule.multiline
                                  ? 'border-primary bg-primary/15 text-primary'
                                  : 'border-foreground/10 text-muted-foreground',
                              )}
                            >
                              ^$ 多行
                            </button>
                          </div>

                          <Switch
                            checked={rule.enabled}
                            onChange={(v) => updateRule(rule.id, { enabled: v })}
                            label="启用该规则"
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )

  const currentOutput = mode === 'extract' ? extractResult.formattedText : replaceResult.output

  const actions = (
    <>
      <Button
        variant="primary"
        size="lg"
        disabled={!currentOutput}
        onClick={() => void copyText(currentOutput, 'main')}
      >
        {copiedKey === 'main' ? <Check /> : <Copy />}
        {copiedKey === 'main' ? '已复制' : '复制结果'}
      </Button>
      <Button variant="outline" size="lg" disabled={!currentOutput} onClick={handleDownload}>
        <Download />
        导出文件
      </Button>
    </>
  )

  return (
    <ToolShell panel={panel} actions={actions} panelTitle={mode === 'extract' ? '提取规则配置' : '批量替换流水线'}>
      <div className="space-y-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.log,.csv,.md,.json,.xml,.html,.js,.ts,text/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void handleImportFile(file)
          }}
        />

        {/* 上半区：原始杂乱文本输入与匹配高亮 */}
        <div className="glass overflow-hidden rounded-2xl">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
            <div className="flex items-center gap-2">
              <FileText className="text-primary size-4" />
              <span className="text-sm font-semibold">原始文本</span>
              <span className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 font-mono text-[11px]">
                {sourceText.length.toLocaleString()} 字 · {sourceText ? sourceText.split('\n').length : 0} 行
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {mode === 'extract' && (
                <div className="bg-foreground/[0.06] inline-flex rounded-lg p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setInputView('edit')}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition',
                      inputView === 'edit' ? 'bg-card-solid text-foreground shadow-sm' : 'text-muted-foreground',
                    )}
                  >
                    <Pencil className="size-3" />
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputView('highlight')}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition',
                      inputView === 'highlight' ? 'bg-card-solid text-foreground shadow-sm' : 'text-muted-foreground',
                    )}
                  >
                    <Eye className="size-3" />
                    高亮命中
                  </button>
                </div>
              )}

              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => fileInputRef.current?.click()}>
                <Upload className="size-3.5" />
                导入文件
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setSourceText(SAMPLE_MESSY_TEXT)
                  toast.success('已填入综合示例文本')
                }}
              >
                <Sparkles className="size-3.5" />
                示例
              </Button>
              {sourceText && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive h-7 px-2 text-xs"
                  onClick={() => setSourceText('')}
                >
                  <Trash2 className="size-3.5" />
                  清空
                </Button>
              )}
            </div>
          </div>

          {mode === 'extract' && inputView === 'highlight' ? (
            <HighlightedSource text={sourceText} matches={extractResult.matches} />
          ) : (
            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder="在此粘贴日志、聊天记录、网页源码或任意杂乱文本，也可点击右上角「导入文件」..."
              spellCheck={false}
              className="min-h-[240px] w-full resize-y bg-transparent p-4 font-mono text-xs leading-relaxed outline-none"
            />
          )}
        </div>

        {/* 下半区：提取结果或批量替换结果 */}
        <div className="glass overflow-hidden rounded-2xl">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">
                {mode === 'extract' ? '提取结果' : '批量替换结果'}
              </span>

              {mode === 'extract' ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="bg-primary/10 text-primary rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold">
                    共命中 {extractResult.matches.length} 处
                  </span>
                  {extractOpts.dedupe && extractResult.values.length !== extractResult.matches.length && (
                    <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                      去重后 {extractResult.values.length} 条
                    </span>
                  )}
                  {extractResult.truncated && (
                    <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                      已达 50,000 条安全上限
                    </span>
                  )}
                </div>
              ) : (
                <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  共替换 {replaceResult.totalReplacements} 处
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {mode === 'extract' ? (
                <div className="bg-foreground/[0.06] inline-flex rounded-lg p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setExtractView('text')}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition',
                      extractView === 'text' ? 'bg-card-solid text-foreground shadow-sm' : 'text-muted-foreground',
                    )}
                  >
                    <FileText className="size-3" />
                    纯文本
                  </button>
                  <button
                    type="button"
                    onClick={() => setExtractView('table')}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition',
                      extractView === 'table' ? 'bg-card-solid text-foreground shadow-sm' : 'text-muted-foreground',
                    )}
                  >
                    <List className="size-3" />
                    命中明细
                  </button>
                </div>
              ) : (
                <>
                  <div className="bg-foreground/[0.06] inline-flex rounded-lg p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setReplaceView('text')}
                      className={cn(
                        'rounded-md px-2 py-1 font-medium transition',
                        replaceView === 'text' ? 'bg-card-solid text-foreground shadow-sm' : 'text-muted-foreground',
                      )}
                    >
                      替换结果
                    </button>
                    <button
                      type="button"
                      onClick={() => setReplaceView('diff')}
                      className={cn(
                        'rounded-md px-2 py-1 font-medium transition',
                        replaceView === 'diff' ? 'bg-card-solid text-foreground shadow-sm' : 'text-muted-foreground',
                      )}
                    >
                      变动对比
                    </button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={replaceResult.totalReplacements === 0}
                    onClick={applyReplaceToSource}
                    title="将结果写回原始文本输入框，方便继续下一轮处理"
                  >
                    <RotateCcw className="size-3.5" />
                    写回原文
                  </Button>
                </>
              )}

              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={!currentOutput}
                onClick={() => void copyText(currentOutput, 'bar')}
              >
                {copiedKey === 'bar' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                复制
              </Button>
            </div>
          </div>

          {/* 结果主体 */}
          {mode === 'extract' ? (
            extractView === 'text' ? (
              <textarea
                readOnly
                value={extractResult.formattedText}
                placeholder="匹配结果将实时显示在此处..."
                spellCheck={false}
                className="min-h-[240px] w-full resize-y bg-transparent p-4 font-mono text-xs leading-relaxed outline-none"
              />
            ) : extractResult.matches.length === 0 ? (
              <div className="text-muted-foreground p-8 text-center text-xs">暂未匹配到任何内容</div>
            ) : (
              <div className="max-h-[380px] overflow-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="bg-muted/50 text-muted-foreground sticky top-0 border-b text-[11px]">
                    <tr>
                      <th className="w-12 px-3 py-2">#</th>
                      <th className="w-24 px-3 py-2">行:列</th>
                      <th className="px-3 py-2">提取值</th>
                      <th className="hidden px-3 py-2 sm:table-cell">捕获组</th>
                      <th className="w-14 px-3 py-2 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {extractResult.matches.slice(0, 1000).map((m) => (
                      <tr key={m.index} className="hover:bg-foreground/[0.03]">
                        <td className="text-muted-foreground px-3 py-2">{m.index}</td>
                        <td className="text-muted-foreground px-3 py-2">
                          L{m.line}:{m.col}
                        </td>
                        <td className="max-w-[320px] px-3 py-2 break-all font-medium">{m.value || '（空）'}</td>
                        <td className="text-muted-foreground hidden px-3 py-2 sm:table-cell">
                          {m.groups.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {m.groups.map((g, gi) => (
                                <span key={gi} className="bg-muted rounded px-1.5 py-0.5 text-[10px]">
                                  ${gi + 1}={g}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="opacity-40">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => void copyText(m.value, `row-${m.index}`)}
                            className="text-muted-foreground hover:text-primary inline-flex items-center justify-center rounded p-1"
                            title="复制此项"
                          >
                            {copiedKey === `row-${m.index}` ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {extractResult.matches.length > 1000 && (
                  <div className="text-muted-foreground border-t p-2.5 text-center text-[11px]">
                    明细表仅预览前 1,000 条，切换到「纯文本」或导出文件可获取全部 {extractResult.matches.length} 条。
                  </div>
                )}
              </div>
            )
          ) : replaceView === 'text' ? (
            <textarea
              readOnly
              value={replaceResult.output}
              placeholder="批量替换后的文本将实时显示在此处..."
              spellCheck={false}
              className="min-h-[240px] w-full resize-y bg-transparent p-4 font-mono text-xs leading-relaxed outline-none"
            />
          ) : diffRows === null ? (
            <div className="text-muted-foreground p-8 text-center text-xs">
              文本超过 600 行，已跳过行级 Diff 视图以保证流畅，请查看「替换结果」标签页。
            </div>
          ) : (
            <div className="max-h-[400px] overflow-auto font-mono text-xs">
              {diffRows.map((row, idx) => (
                <div
                  key={idx}
                  className={cn(
                    'flex gap-3 border-b border-foreground/[0.04] px-3 py-1 leading-relaxed break-all whitespace-pre-wrap',
                    row.type === 'del' && 'bg-red-500/10 text-red-700 dark:text-red-300',
                    row.type === 'add' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                  )}
                >
                  <span className="text-muted-foreground w-8 shrink-0 text-right select-none">
                    {row.oldLine ?? ''}
                  </span>
                  <span className="text-muted-foreground w-8 shrink-0 text-right select-none">
                    {row.newLine ?? ''}
                  </span>
                  <span className="w-3 shrink-0 font-bold select-none">
                    {row.type === 'del' ? '-' : row.type === 'add' ? '+' : ' '}
                  </span>
                  <span className="min-w-0 flex-1">{row.text || ' '}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ToolShell>
  )
}
