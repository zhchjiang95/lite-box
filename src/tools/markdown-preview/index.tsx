import 'katex/dist/katex.min.css'
import {
  Bold,
  Check,
  Code2,
  Columns2,
  Copy,
  Download,
  Eye,
  FileCode2,
  FileDown,
  Heading1,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link2,
  ListChecks,
  Loader2,
  Pencil,
  Printer,
  Quote,
  Sigma,
  Sparkles,
  Strikethrough,
  Table,
  Trash2,
  Upload,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/field'
import { downloadBlob, timestampName } from '@/lib/file'
import { cn } from '@/lib/utils'
import {
  buildStandaloneHtml,
  computeMarkdownStats,
  exportMarkdownLongPng,
  extractDocTitle,
  printMarkdownDoc,
  renderMarkdownHtml,
} from './renderer'
import { MARKDOWN_PROSE_CSS, MD_THEMES, SAMPLE_MARKDOWN, type MdThemeId } from './themes'

type LayoutMode = 'split' | 'edit' | 'preview'

const DRAFT_STORAGE_KEY = 'litebox-markdown-draft-v1'

function loadDraft(): string {
  try {
    const saved = localStorage.getItem(DRAFT_STORAGE_KEY)
    return saved !== null ? saved : SAMPLE_MARKDOWN
  } catch {
    return SAMPLE_MARKDOWN
  }
}

export default function MarkdownPreview() {
  const [markdown, setMarkdown] = useState<string>(loadDraft)
  const [themeId, setThemeId] = useState<MdThemeId>('github')
  const [layout, setLayout] = useState<LayoutMode>('split')
  const [syncScroll, setSyncScroll] = useState(true)
  const [exportingPng, setExportingPng] = useState(false)
  const [copiedRich, setCopiedRich] = useState(false)

  const editorRef = useRef<HTMLTextAreaElement>(null)
  const previewScrollRef = useRef<HTMLDivElement>(null)
  const exportArticleRef = useRef<HTMLElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollLockRef = useRef<'editor' | 'preview' | null>(null)

  // 自动暂存草稿到本地
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_STORAGE_KEY, markdown)
      } catch {
        // 忽略存储配额限制
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [markdown])

  const renderedHtml = useMemo(() => renderMarkdownHtml(markdown), [markdown])
  const stats = useMemo(() => computeMarkdownStats(markdown), [markdown])
  const docTitle = useMemo(() => extractDocTitle(markdown), [markdown])

  /** 在光标处插入或包裹 Markdown 语法 */
  const insertSyntax = (prefix: string, suffix = '', placeholder = '') => {
    const el = editorRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = markdown.slice(start, end) || placeholder
    const next = `${markdown.slice(0, start)}${prefix}${selected}${suffix}${markdown.slice(end)}`
    setMarkdown(next)
    requestAnimationFrame(() => {
      el.focus()
      const cursorStart = start + prefix.length
      el.setSelectionRange(cursorStart, cursorStart + selected.length)
    })
  }

  /** 编辑器与预览区双向比例同步滚动 */
  const handleEditorScroll = () => {
    if (!syncScroll || layout !== 'split' || scrollLockRef.current === 'preview') return
    const ed = editorRef.current
    const pv = previewScrollRef.current
    if (!ed || !pv) return
    const ratio = ed.scrollTop / Math.max(1, ed.scrollHeight - ed.clientHeight)
    scrollLockRef.current = 'editor'
    pv.scrollTop = ratio * (pv.scrollHeight - pv.clientHeight)
    window.setTimeout(() => {
      if (scrollLockRef.current === 'editor') scrollLockRef.current = null
    }, 60)
  }

  const handlePreviewScroll = () => {
    if (!syncScroll || layout !== 'split' || scrollLockRef.current === 'editor') return
    const ed = editorRef.current
    const pv = previewScrollRef.current
    if (!ed || !pv) return
    const ratio = pv.scrollTop / Math.max(1, pv.scrollHeight - pv.clientHeight)
    scrollLockRef.current = 'preview'
    ed.scrollTop = ratio * (ed.scrollHeight - ed.clientHeight)
    window.setTimeout(() => {
      if (scrollLockRef.current === 'preview') scrollLockRef.current = null
    }, 60)
  }

  /** 导入本地 .md / .txt 文件 */
  const handleImportFile = async (file: File) => {
    try {
      const content = await file.text()
      setMarkdown(content)
      toast.success(`已载入「${file.name}」`)
    } catch {
      toast.error('读取文件失败')
    }
  }

  /** 导出独立离线 HTML */
  const handleExportHtml = () => {
    if (!markdown.trim()) {
      toast.error('请先输入 Markdown 内容')
      return
    }
    const html = buildStandaloneHtml(renderedHtml, themeId, docTitle)
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${docTitle}.html`)
    toast.success(`已导出独立 HTML：${docTitle}.html`)
  }

  /** 导出 2× 高清长图 PNG */
  const handleExportLongPng = async () => {
    if (!markdown.trim()) {
      toast.error('请先输入 Markdown 内容')
      return
    }
    if (layout === 'edit') {
      toast.info('已切换至预览以生成高清长图')
      setLayout('split')
      return
    }
    const node = exportArticleRef.current
    if (!node) return

    setExportingPng(true)
    try {
      const blob = await exportMarkdownLongPng(node, themeId)
      downloadBlob(blob, timestampName(docTitle, 'png'))
      toast.success('已导出 2× 高清排版长图 PNG')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '长图导出失败')
    } finally {
      setExportingPng(false)
    }
  }

  /** 复制富文本（可直接粘贴进微信公众号、飞书、Notion、Word） */
  const handleCopyRichHtml = async () => {
    if (!renderedHtml) {
      toast.error('当前没有可复制的排版内容')
      return
    }
    try {
      if ('ClipboardItem' in window && navigator.clipboard?.write) {
        const htmlWithStyle = `<style>${MARKDOWN_PROSE_CSS}</style><div class="md-prose" data-theme="${themeId}">${renderedHtml}</div>`
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([htmlWithStyle], { type: 'text/html' }),
            'text/plain': new Blob([markdown], { type: 'text/plain' }),
          }),
        ])
      } else {
        await navigator.clipboard.writeText(renderedHtml)
      }
      setCopiedRich(true)
      toast.success('已复制富文本排版，可直接粘贴至公众号 / 飞书 / Word')
      window.setTimeout(() => setCopiedRich(false), 1600)
    } catch {
      toast.error('富文本复制失败，请尝试导出 HTML')
    }
  }

  /** 保存原始 .md 文件 */
  const handleSaveMd = () => {
    if (!markdown.trim()) return
    downloadBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), `${docTitle}.md`)
    toast.success(`已保存 ${docTitle}.md`)
  }

  /** 打印 / 存为 PDF */
  const handlePrint = () => {
    if (!markdown.trim()) {
      toast.error('请先输入 Markdown 内容')
      return
    }
    try {
      printMarkdownDoc(renderedHtml, themeId, docTitle)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打印调起失败')
    }
  }

  const formatButtons = [
    { icon: Heading1, title: '一级标题', onClick: () => insertSyntax('# ', '', '标题文字') },
    { icon: Heading2, title: '二级标题', onClick: () => insertSyntax('## ', '', '二级标题') },
    { icon: Bold, title: '加粗', onClick: () => insertSyntax('**', '**', '加粗文字') },
    { icon: Italic, title: '斜体', onClick: () => insertSyntax('*', '*', '斜体文字') },
    { icon: Strikethrough, title: '删除线', onClick: () => insertSyntax('~~', '~~', '删除文字') },
    { icon: Quote, title: '引用块', onClick: () => insertSyntax('> ', '', '引用内容') },
    { icon: Code2, title: '代码块', onClick: () => insertSyntax('\n```typescript\n', '\n```\n', '// 在此输入代码') },
    {
      icon: Table,
      title: '插入表格',
      onClick: () => insertSyntax('\n| 列 1 | 列 2 | 列 3 |\n| :--- | :---: | ---: |\n| 内容 A | 内容 B | 内容 C |\n'),
    },
    { icon: ListChecks, title: '任务清单', onClick: () => insertSyntax('\n- [ ] 待办事项 1\n- [x] 已完成事项\n') },
    { icon: Sigma, title: '数学公式', onClick: () => insertSyntax('\n$$\n', '\n$$\n', 'E = mc^2') },
    { icon: Link2, title: '插入链接', onClick: () => insertSyntax('[', '](https://example.com)', '链接文字') },
  ]

  return (
    <div className="space-y-3">
      {/* 注入预览排版与语法高亮样式 */}
      <style>{MARKDOWN_PROSE_CSS}</style>

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void handleImportFile(f)
        }}
      />

      {/* 顶部控制与导出栏 */}
      <div className="glass flex flex-wrap items-center justify-between gap-2.5 rounded-2xl px-3.5 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-48">
            <Segmented<LayoutMode>
              value={layout}
              onChange={setLayout}
              size="sm"
              options={[
                { value: 'edit', label: '编辑', icon: <Pencil className="size-3" /> },
                { value: 'split', label: '分屏', icon: <Columns2 className="size-3" /> },
                { value: 'preview', label: '预览', icon: <Eye className="size-3" /> },
              ]}
            />
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {MD_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setThemeId(t.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 font-medium transition',
                  themeId === t.id
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-foreground/10 text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="size-2.5 rounded-full" style={{ backgroundColor: t.swatch }} />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={() => void handleCopyRichHtml()}>
            {copiedRich ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
            复制富文本
          </Button>
          <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={handleExportHtml}>
            <FileCode2 className="size-3.5" />
            导出 HTML
          </Button>
          <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={handlePrint}>
            <Printer className="size-3.5" />
            打印 / PDF
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="h-8 px-3 text-xs"
            disabled={exportingPng}
            onClick={() => void handleExportLongPng()}
          >
            {exportingPng ? <Loader2 className="size-3.5 animate-spin" /> : <ImageIcon className="size-3.5" />}
            导出 2× 长图
          </Button>
        </div>
      </div>

      {/* 第二排：快捷写作语法栏 + 导入/示例/同步滚动 */}
      <div className="glass flex flex-wrap items-center justify-between gap-2 rounded-2xl px-3 py-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-0.5">
          {formatButtons.map((btn) => {
            const Icon = btn.icon
            return (
              <button
                key={btn.title}
                type="button"
                title={btn.title}
                onClick={btn.onClick}
                className="text-muted-foreground hover:bg-foreground/5 hover:text-foreground inline-flex size-7 items-center justify-center rounded-lg transition"
              >
                <Icon className="size-3.5" />
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {layout === 'split' && (
            <label className="hidden items-center gap-1.5 text-[11px] sm:flex">
              <span className="text-muted-foreground">同步滚动</span>
              <Switch checked={syncScroll} onChange={setSyncScroll} label="同步滚动" />
            </label>
          )}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => fileInputRef.current?.click()}>
            <Upload className="size-3.5" />
            导入 .md
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleSaveMd}>
            <FileDown className="size-3.5" />
            存 .md
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              setMarkdown(SAMPLE_MARKDOWN)
              toast.success('已载入综合语法示例')
            }}
          >
            <Sparkles className="size-3.5" />
            示例
          </Button>
          {markdown && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive h-7 px-2 text-xs"
              onClick={() => setMarkdown('')}
            >
              <Trash2 className="size-3.5" />
              清空
            </Button>
          )}
        </div>
      </div>

      {/* 主编辑 / 实时预览双栏画布 */}
      <div
        className={cn(
          'grid gap-3',
          layout === 'split' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1',
        )}
      >
        {/* 左侧源码编辑器 */}
        {layout !== 'preview' && (
          <div className="glass flex h-[68dvh] min-h-[460px] flex-col overflow-hidden rounded-2xl">
            <div className="text-muted-foreground flex items-center justify-between border-b px-4 py-2 text-[11px]">
              <span className="font-semibold">Markdown 源码</span>
              <span className="font-mono">
                {stats.totalWords} 词 · {stats.chars} 字符 · {stats.lines} 行
              </span>
            </div>
            <textarea
              ref={editorRef}
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              onScroll={handleEditorScroll}
              spellCheck={false}
              placeholder="在此输入或拖入 Markdown 内容，支持 GFM 表格、代码高亮、$行内公式$ 与 $$块级公式$$..."
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const f = e.dataTransfer.files?.[0]
                if (f) void handleImportFile(f)
              }}
              className="flex-1 resize-none bg-transparent p-4 font-mono text-[13px] leading-relaxed outline-none"
            />
          </div>
        )}

        {/* 右侧实时排版预览区 */}
        {layout !== 'edit' && (
          <div className="glass flex h-[68dvh] min-h-[460px] flex-col overflow-hidden rounded-2xl">
            <div className="text-muted-foreground flex items-center justify-between border-b px-4 py-2 text-[11px]">
              <span className="font-semibold">实时排版预览</span>
              <span className="font-mono">预计阅读 {stats.readMin} 分钟</span>
            </div>
            <div
              ref={previewScrollRef}
              onScroll={handlePreviewScroll}
              className={cn(
                'flex-1 overflow-y-auto p-3 sm:p-5',
                themeId === 'dark' ? 'bg-slate-950/90' : 'bg-slate-100/75 dark:bg-slate-900/70',
              )}
            >
              {markdown.trim() ? (
                <article
                  ref={exportArticleRef}
                  data-theme={themeId}
                  className="md-prose mx-auto max-w-[780px] rounded-2xl p-6 shadow-md sm:p-9"
                  dangerouslySetInnerHTML={{ __html: renderedHtml }}
                />
              ) : (
                <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-xs">
                  <Download className="size-6 opacity-40" />
                  <span>在左侧输入 Markdown，右侧将实时呈现精致排版</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
