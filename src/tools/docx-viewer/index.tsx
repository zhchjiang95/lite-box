import {
  AlertTriangle,
  Archive,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FilePlus2,
  FileText,
  Info,
  Loader2,
  MessageSquareWarning,
  Printer,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { downloadBlob, timestampName } from '@/lib/file'
import { cn, formatBytes, uid } from '@/lib/utils'
import {
  checkDocxFile,
  cleanDocxBatchZip,
  cleanDocxMetadata,
  defaultCleanOptions,
  inspectDocxBytes,
  type CleanOptions,
  type DocxInspection,
} from './inspector'

interface DocxEntry {
  id: string
  name: string
  size: number
  bytes: Uint8Array
  inspection: DocxInspection
  cleanedOnce?: boolean
}

type ViewTab = 'preview' | 'metadata'

export default function DocxViewer() {
  const [entries, setEntries] = useState<DocxEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ViewTab>('preview')

  // 预览渲染选项
  const [zoom, setZoom] = useState(100)
  const [showHeaders, setShowHeaders] = useState(true)
  const [showComments, setShowComments] = useState(false)
  const [showChanges, setShowChanges] = useState(true)
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)

  // 脱敏清理选项
  const [cleanOpts, setCleanOpts] = useState<CleanOptions>(defaultCleanOptions)
  const [exporting, setExporting] = useState(false)
  const [copiedJson, setCopiedJson] = useState(false)

  const bodyRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selected = useMemo(
    () => entries.find((e) => e.id === selectedId) ?? entries[0] ?? null,
    [entries, selectedId],
  )

  const setCleanOpt = <K extends keyof CleanOptions>(k: K, v: CleanOptions[K]) =>
    setCleanOpts((prev) => ({ ...prev, [k]: v }))

  /** 导入一份或多份 .docx 文档 */
  const loadDocxFiles = useCallback(async (files: File[]) => {
    if (!files.length) return
    const added: DocxEntry[] = []

    for (const file of files) {
      const check = checkDocxFile(file)
      if (!check.ok) {
        toast.error(check.reason)
        continue
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const inspection = inspectDocxBytes(bytes)
        added.push({
          id: uid(),
          name: file.name,
          size: file.size,
          bytes,
          inspection,
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `解析「${file.name}」失败`)
      }
    }

    if (added.length) {
      setEntries((prev) => [...prev, ...added])
      setSelectedId((cur) => cur ?? added[0].id)
      toast.success(`已解析 ${added.length} 份 Word 文档`)
    }
  }, [])

  // 使用 docx-preview 按需渲染当前选中的 Word 文档
  useEffect(() => {
    if (activeTab !== 'preview' || !selected) return
    const bodyEl = bodyRef.current
    const styleEl = styleRef.current
    if (!bodyEl || !styleEl) return

    let cancelled = false
    setRendering(true)
    setRenderError(null)
    bodyEl.innerHTML = ''
    styleEl.innerHTML = ''

    void (async () => {
      try {
        const { renderAsync } = await import('docx-preview')
        if (cancelled) return
        const copy = new Uint8Array(selected.bytes.byteLength)
        copy.set(selected.bytes)
        const blob = new Blob([copy.buffer], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        })
        await renderAsync(blob, bodyEl, styleEl, {
          className: 'litebox-docx',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          renderHeaders: showHeaders,
          renderFooters: showHeaders,
          renderFootnotes: true,
          renderEndnotes: true,
          renderComments: showComments,
          renderChanges: showChanges,
          useBase64URL: true,
        })
      } catch (err) {
        if (!cancelled) {
          setRenderError(err instanceof Error ? err.message : 'Word 文档渲染失败')
        }
      } finally {
        if (!cancelled) setRendering(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeTab, selected, showHeaders, showComments, showChanges])

  /** 单文件脱敏导出（并可选立刻刷新当前预览校验脱敏结果） */
  const handleCleanAndDownload = async () => {
    if (!entries.length) return
    setExporting(true)
    try {
      if (entries.length === 1 && selected) {
        const cleanedBytes = cleanDocxMetadata(selected.bytes, cleanOpts)
        const copy = new Uint8Array(cleanedBytes.byteLength)
        copy.set(cleanedBytes)
        const blob = new Blob([copy.buffer], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        })
        const outName = `${selected.name.replace(/\.docx$/i, '')}-已脱敏.docx`
        downloadBlob(blob, outName)

        // 同时重新体检脱敏后的字节并刷新当前文档状态，让用户直观看到风险归零
        const nextInspection = inspectDocxBytes(cleanedBytes)
        setEntries((prev) =>
          prev.map((item) =>
            item.id === selected.id
              ? { ...item, bytes: cleanedBytes, size: cleanedBytes.byteLength, inspection: nextInspection, cleanedOnce: true }
              : item,
          ),
        )
        toast.success(`已导出脱敏文档「${outName}」，当前隐私体检已刷新`)
      } else {
        const zipBlob = cleanDocxBatchZip(
          entries.map((e) => ({ name: e.name, bytes: e.bytes })),
          cleanOpts,
        )
        downloadBlob(zipBlob, timestampName('Word批量脱敏文档', 'zip'))
        toast.success(`已批量脱敏并打包 ${entries.length} 份 .docx`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '脱敏导出失败')
    } finally {
      setExporting(false)
    }
  }

  /** 打印当前渲染的 Word 文档 */
  const handlePrintPreview = () => {
    const bodyEl = bodyRef.current
    const styleEl = styleRef.current
    if (!bodyEl || !bodyEl.innerHTML.trim()) {
      toast.error('请先切换到「排版预览」等待文档渲染完成')
      return
    }

    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    document.body.appendChild(iframe)

    const cleanup = () => iframe.remove()
    const doc = iframe.contentDocument
    if (!doc || !iframe.contentWindow) {
      cleanup()
      toast.error('无法唤起打印窗口')
      return
    }

    doc.open()
    doc.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${selected?.name ?? 'Word 打印预览'}</title>
  <style>
    @page { margin: 0; }
    body { margin: 0; background: #fff; color: #111827; }
    .litebox-docx-wrapper { background: #fff !important; padding: 0 !important; }
    .litebox-docx-wrapper > section.litebox-docx { box-shadow: none !important; margin: 0 auto !important; }
  </style>
  ${styleEl?.innerHTML ?? ''}
</head>
<body>${bodyEl.innerHTML}</body>
</html>`)
    doc.close()

    const win = iframe.contentWindow
    win.addEventListener('afterprint', cleanup, { once: true })
    window.setTimeout(cleanup, 60_000)
    window.setTimeout(() => {
      win.focus()
      win.print()
    }, 150)
  }

  /** 复制元数据 JSON 报告 */
  const copyMetadataJson = async () => {
    if (!selected) return
    const payload = {
      fileName: selected.name,
      fileSize: selected.size,
      riskLevel: selected.inspection.riskLevel,
      stats: selected.inspection.stats,
      metadata: Object.fromEntries(selected.inspection.fields.map((f) => [f.label, f.value])),
      comments: selected.inspection.comments,
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
      setCopiedJson(true)
      toast.success('已复制完整元数据 JSON')
      window.setTimeout(() => setCopiedJson(false), 1500)
    } catch {
      toast.error('复制失败')
    }
  }

  const removeEntry = (id: string) => {
    setEntries((prev) => {
      const next = prev.filter((e) => e.id !== id)
      setSelectedId((cur) => (cur === id ? (next[0]?.id ?? null) : cur))
      return next
    })
  }

  /** 左侧参数与隐私清理面板 */
  const panel = selected ? (
    <div className="space-y-5">
      {/* 隐私体检结论卡 */}
      <div
        className={cn(
          'rounded-2xl border p-3.5 text-xs',
          selected.inspection.riskLevel === 'high'
            ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
            : selected.inspection.riskLevel === 'medium'
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        )}
      >
        <div className="flex items-center gap-2 font-semibold">
          {selected.inspection.riskLevel === 'high' ? (
            <ShieldAlert className="size-4 shrink-0" />
          ) : selected.inspection.riskLevel === 'medium' ? (
            <AlertTriangle className="size-4 shrink-0" />
          ) : (
            <ShieldCheck className="size-4 shrink-0" />
          )}
          <span>
            {selected.inspection.riskLevel === 'high'
              ? `发现 ${selected.inspection.findings.length} 项隐私信息暴露`
              : selected.inspection.riskLevel === 'medium'
                ? `发现 ${selected.inspection.findings.length} 项常规属性信息`
                : '隐私安全 · 未检测到敏感隐藏属性'}
          </span>
        </div>
        {selected.inspection.findings.length > 0 && (
          <ul className="mt-2 space-y-1 text-[11px] opacity-90">
            {selected.inspection.findings.slice(0, 4).map((f, i) => (
              <li key={i}>• {f.title}</li>
            ))}
          </ul>
        )}
      </div>

      {/* 脱敏清理项勾选 */}
      <div className="space-y-3">
        <div className="text-muted-foreground text-xs font-semibold">隐私元数据清理项</div>

        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-medium">作者 / 修改人 / 公司</div>
            <div className="text-muted-foreground text-[11px]">含 people.xml 账号目录</div>
          </div>
          <Switch checked={cleanOpts.clearIdentity} onChange={(v) => setCleanOpt('clearIdentity', v)} label="清理身份信息" />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-medium">时间与累计编辑时长</div>
            <div className="text-muted-foreground text-[11px]">创建/修改/打印时间与版本号</div>
          </div>
          <Switch checked={cleanOpts.clearTimestamps} onChange={(v) => setCleanOpt('clearTimestamps', v)} label="清理时间与时长" />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-medium">编辑软件与模板来源</div>
            <div className="text-muted-foreground text-[11px]">Word / WPS 版本号与模板名</div>
          </div>
          <Switch checked={cleanOpts.clearAppInfo} onChange={(v) => setCleanOpt('clearAppInfo', v)} label="清理软件信息" />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-medium">自定义文档属性</div>
            <div className="text-muted-foreground text-[11px]">清理 custom.xml 内部字段</div>
          </div>
          <Switch checked={cleanOpts.clearCustomProps} onChange={(v) => setCleanOpt('clearCustomProps', v)} label="清理自定义属性" />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-medium">标题 / 主题 / 关键词</div>
            <div className="text-muted-foreground text-[11px]">摘要与备注字段</div>
          </div>
          <Switch checked={cleanOpts.clearDescriptive} onChange={(v) => setCleanOpt('clearDescriptive', v)} label="清理描述字段" />
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <div>
            <div className="text-xs font-medium">同时清除文档内全部批注</div>
            <div className="text-muted-foreground text-[11px]">
              当前检测到 {selected.inspection.stats.commentCount} 条批注
            </div>
          </div>
          <Switch checked={cleanOpts.stripComments} onChange={(v) => setCleanOpt('stripComments', v)} label="清除批注" />
        </div>
      </div>

      {/* 预览渲染选项 */}
      <div className="space-y-3 border-t pt-4">
        <div className="text-muted-foreground text-xs font-semibold">预览显示控制</div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">显示页眉与页脚</span>
          <Switch checked={showHeaders} onChange={setShowHeaders} label="显示页眉页脚" />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">高亮显示修订痕迹</span>
          <Switch checked={showChanges} onChange={setShowChanges} label="显示修订痕迹" />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">在正文旁显示批注</span>
          <Switch checked={showComments} onChange={setShowComments} label="显示批注" />
        </div>
      </div>
    </div>
  ) : undefined

  const actions = selected ? (
    <>
      <Button variant="primary" size="lg" disabled={exporting} onClick={() => void handleCleanAndDownload()}>
        {exporting ? <Loader2 className="animate-spin" /> : entries.length > 1 ? <Archive /> : <Sparkles />}
        {entries.length > 1 ? `批量脱敏 (${entries.length} 份)` : '一键脱敏导出'}
      </Button>
      {activeTab === 'preview' && (
        <Button variant="outline" size="lg" onClick={handlePrintPreview}>
          <Printer />
          打印
        </Button>
      )}
    </>
  ) : undefined

  return (
    <ToolShell panel={panel} actions={actions} panelTitle="隐私体检与脱敏清理">
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        multiple
        className="hidden"
        onChange={(e) => {
          const list = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (list.length) void loadDocxFiles(list)
        }}
      />

      {!selected ? (
        <div className="space-y-4">
          <FileDropzone
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            multiple
            onFiles={(files) => void loadDocxFiles(files)}
            title="拖入或选择 .docx Word 文档（支持多份批量脱敏）"
            hint="100% 浏览器本地解析与渲染，文档内容绝不上传任何服务器 · 免装 Office 秒看排版并检查隐藏元数据"
          />

          <div className="glass grid gap-3 rounded-2xl p-4 text-xs sm:grid-cols-3">
            <div className="space-y-1">
              <div className="text-foreground flex items-center gap-1.5 font-semibold">
                <Eye className="text-primary size-4" />
                免装 Office 本地秒开
              </div>
              <p className="text-muted-foreground leading-relaxed">
                还原 Word 分页、表格、图片、页眉页脚与修订痕迹，支持自由缩放与直接打印。
              </p>
            </div>
            <div className="space-y-1">
              <div className="text-foreground flex items-center gap-1.5 font-semibold">
                <ShieldAlert className="size-4 text-amber-500" />
                隐藏隐私深度体检
              </div>
              <p className="text-muted-foreground leading-relaxed">
                自动揪出文档作者、公司名称、累计编辑时长、内部批注与自定义属性，防对外泄密。
              </p>
            </div>
            <div className="space-y-1">
              <div className="text-foreground flex items-center gap-1.5 font-semibold">
                <Sparkles className="size-4 text-emerald-500" />
                无损排版一键脱敏
              </div>
              <p className="text-muted-foreground leading-relaxed">
                精准清理 XML 元数据节点，正文排版与图片 100% 原样保留，支持多文件批量打包 ZIP。
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 顶部文档切换条 & 视图 Tab */}
          <div className="glass space-y-3 rounded-2xl p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="w-full sm:w-64">
                <Segmented<ViewTab>
                  value={activeTab}
                  onChange={setActiveTab}
                  size="sm"
                  options={[
                    { value: 'preview', label: '排版预览', icon: <Eye className="size-3.5" /> },
                    {
                      value: 'metadata',
                      label: `元数据 (${selected.inspection.fields.length})`,
                      icon: <Info className="size-3.5" />,
                    },
                  ]}
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {activeTab === 'preview' && (
                  <div className="bg-foreground/[0.05] inline-flex items-center gap-1 rounded-xl px-1.5 py-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.max(50, z - 10))}
                      className="hover:bg-foreground/10 rounded-lg p-1"
                      title="缩小"
                    >
                      <ZoomOut className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoom(100)}
                      className="min-w-[44px] font-mono text-[11px] font-medium"
                      title="恢复 100%"
                    >
                      {zoom}%
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.min(150, z + 10))}
                      className="hover:bg-foreground/10 rounded-lg p-1"
                      title="放大"
                    >
                      <ZoomIn className="size-3.5" />
                    </button>
                  </div>
                )}

                <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={() => fileInputRef.current?.click()}>
                  <FilePlus2 className="size-3.5" />
                  添加文档
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive h-8 px-2 text-xs"
                  onClick={() => {
                    setEntries([])
                    setSelectedId(null)
                  }}
                >
                  <Trash2 className="size-3.5" />
                  清空
                </Button>
              </div>
            </div>

            {/* 已导入文档标签页（支持多文档切换） */}
            <div className="flex flex-wrap items-center gap-1.5 border-t pt-2.5">
              {entries.map((item) => {
                const active = item.id === selected.id
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'inline-flex max-w-[240px] items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs transition',
                      active
                        ? 'border-primary bg-primary/10 text-foreground font-semibold'
                        : 'border-foreground/10 text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className="flex min-w-0 items-center gap-1.5"
                    >
                      <FileText className="text-primary size-3.5 shrink-0" />
                      <span className="truncate">{item.name}</span>
                      <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
                        {formatBytes(item.size)}
                      </span>
                    </button>
                    {item.cleanedOnce && (
                      <span title="已完成脱敏">
                        <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeEntry(item.id)}
                      className="text-muted-foreground hover:text-destructive ml-0.5 shrink-0"
                      title="移除"
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Tab 1：Word 高还原排版预览 */}
          {activeTab === 'preview' ? (
            <div className="glass relative overflow-hidden rounded-2xl">
              <div ref={styleRef} className="hidden" />
              {rendering && (
                <div className="bg-background/70 absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 backdrop-blur-xs">
                  <Loader2 className="text-primary size-7 animate-spin" />
                  <span className="text-xs font-medium">正在本地解析并排版渲染 Word 文档…</span>
                </div>
              )}

              {renderError ? (
                <div className="flex flex-col items-center justify-center gap-2 p-10 text-center text-xs text-rose-500">
                  <AlertTriangle className="size-6" />
                  <div>{renderError}</div>
                </div>
              ) : (
                <div className="max-h-[76dvh] overflow-auto bg-slate-200/80 p-3 sm:p-5 dark:bg-slate-900/90">
                  <div
                    style={{
                      transform: `scale(${zoom / 100})`,
                      transformOrigin: 'top center',
                    }}
                    className="mx-auto w-fit text-[#111827] [&_.litebox-docx-wrapper]:!bg-transparent [&_.litebox-docx-wrapper]:!p-0 [&_.litebox-docx-wrapper>section.litebox-docx]:!mb-5 [&_.litebox-docx-wrapper>section.litebox-docx]:!shadow-xl"
                  >
                    <div ref={bodyRef} />
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Tab 2：完整元数据、统计指标与隐藏批注/修订明细 */
            <div className="space-y-4">
              {/* 顶部统计速览卡片 */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {[
                  { label: '页数', value: selected.inspection.stats.pages ?? '—' },
                  { label: '字数统计', value: selected.inspection.stats.words?.toLocaleString() ?? '—' },
                  {
                    label: '累计编辑时长',
                    value:
                      selected.inspection.stats.totalTimeMin !== null
                        ? `${selected.inspection.stats.totalTimeMin} 分钟`
                        : '无记录',
                  },
                  {
                    label: '内嵌图片 / 媒体',
                    value:
                      selected.inspection.stats.mediaCount > 0
                        ? `${selected.inspection.stats.mediaCount} 个 (${formatBytes(selected.inspection.stats.mediaTotalBytes)})`
                        : '0 个',
                  },
                ].map((stat) => (
                  <div key={stat.label} className="glass rounded-2xl p-3.5">
                    <div className="text-muted-foreground text-[11px]">{stat.label}</div>
                    <div className="mt-1 font-mono text-base font-bold">{stat.value}</div>
                  </div>
                ))}
              </div>

              {/* 完整元数据键值表 */}
              <div className="glass overflow-hidden rounded-2xl">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Info className="text-primary size-4" />
                    文档属性与隐藏元数据
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => void copyMetadataJson()}>
                      {copiedJson ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {copiedJson ? '已复制 JSON' : '复制 JSON'}
                    </Button>
                    <Button variant="primary" size="sm" className="h-7 px-2.5 text-xs" onClick={() => void handleCleanAndDownload()}>
                      <Download className="size-3.5" />
                      一键脱敏导出
                    </Button>
                  </div>
                </div>

                {selected.inspection.fields.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-10 text-center text-xs text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="size-7" />
                    <div className="font-semibold">当前文档非常干净，未包含任何可见的隐藏属性元数据</div>
                  </div>
                ) : (
                  <div className="divide-y text-xs">
                    {selected.inspection.fields.map((f) => (
                      <div key={f.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground font-medium">{f.label}</span>
                          {f.sensitive && (
                            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                              敏感
                            </span>
                          )}
                        </div>
                        <span className="font-mono font-medium break-all">{f.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 修订痕迹与隐藏批注明细 */}
              {(selected.inspection.comments.length > 0 ||
                selected.inspection.stats.revisionInsertCount + selected.inspection.stats.revisionDeleteCount > 0) && (
                <div className="glass space-y-3 rounded-2xl p-4 text-xs">
                  <div className="flex items-center gap-2 text-sm font-semibold text-rose-600 dark:text-rose-400">
                    <MessageSquareWarning className="size-4" />
                    隐藏批注与修订痕迹明细
                  </div>

                  {selected.inspection.stats.revisionInsertCount + selected.inspection.stats.revisionDeleteCount > 0 && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-200">
                      检测到 <strong>{selected.inspection.stats.revisionInsertCount}</strong> 处插入修订、
                      <strong>{selected.inspection.stats.revisionDeleteCount}</strong> 处删除修订
                      {selected.inspection.stats.revisionAuthors.length > 0 &&
                        `（修订人：${selected.inspection.stats.revisionAuthors.join('、')}）`}
                      。建议在对外发送前在 Word 中“接受所有修订”或开启左侧“显示修订痕迹”核查。
                    </div>
                  )}

                  {selected.inspection.comments.length > 0 && (
                    <div className="space-y-2">
                      {selected.inspection.comments.map((c) => (
                        <div key={c.id} className="bg-background/70 rounded-xl border p-3">
                          <div className="text-muted-foreground mb-1 flex items-center justify-between text-[11px]">
                            <span className="text-foreground font-semibold">批注 #{c.id} · {c.author}</span>
                            <span className="font-mono">{c.date}</span>
                          </div>
                          <div className="leading-relaxed">{c.text || '（空批注）'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </ToolShell>
  )
}
