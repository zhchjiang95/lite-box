import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ALargeSmall,
  AlertCircle,
  ArrowLeftRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Eraser,
  Filter,
  Loader2,
  RotateCcw,
  Scissors,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-react'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { Button } from '@/components/ui/button'
import { Field, Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { downloadBlob } from '@/lib/file'
import { cn, formatBytes } from '@/lib/utils'
import {
  CHAR_BLOCKS,
  classifyCodePoint,
  exportSubsetFont,
  extractUniqueCodePoints,
  formatCodePoint,
  loadFontFile,
  QUICK_KEEP_PACKS,
  type CharBlockId,
  type ExportFontFormat,
  type ExportFontResult,
  type LoadedFontAsset,
} from './engine'

const FONT_ACCEPT = '.ttf,.otf,.woff,font/ttf,font/otf,font/woff,application/font-woff,application/x-font-ttf'
const PAGE_SIZE = 120

type PanelTab = 'keep' | 'delete' | 'meta'
type StatusFilter = 'all' | 'kept' | 'deleted'

const inputCls =
  'border-border/70 bg-background/60 focus:border-primary focus:ring-primary/20 w-full rounded-xl border px-3 py-2 text-xs transition outline-none focus:ring-2'

export default function FontEditorTool() {
  const [asset, setAsset] = useState<LoadedFontAsset | null>(null)
  const [loadingFont, setLoadingFont] = useState(false)

  // 核心裁剪状态：标记为删除的 Unicode 码点集合（所有保留/删字/区段操作均同步到同一份状态）
  const [deletedSet, setDeletedSet] = useState<Set<number>>(() => new Set())

  // 左侧操作面板状态
  const [panelTab, setPanelTab] = useState<PanelTab>('keep')
  const [keepInput, setKeepInput] = useState('')
  const [deleteInput, setDeleteInput] = useState('')

  // 可修改的字体元信息与导出配置
  const [editFamily, setEditFamily] = useState('')
  const [editSubFamily, setEditSubFamily] = useState('')
  const [editCopyright, setEditCopyright] = useState('')
  const [exportFormat, setExportFormat] = useState<ExportFontFormat>('ttf')
  const [keepKerning, setKeepKerning] = useState(true)

  // 右侧字形网格筛选与分页
  const [blockFilter, setBlockFilter] = useState<CharBlockId>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)

  // 导出结果与实时试打验证
  const [exporting, setExporting] = useState(false)
  const [exportResult, setExportResult] = useState<ExportFontResult | null>(null)
  const [testTyping, setTestTyping] = useState('')
  const [copiedCss, setCopiedCss] = useState(false)

  /** 载入本地字体文件 */
  const handleFontFiles = async (files: File[]) => {
    const file = files[0]
    if (!file) return
    setLoadingFont(true)
    try {
      const loaded = await loadFontFile(file)
      setAsset(loaded)
      setDeletedSet(new Set())
      setEditFamily(loaded.meta.fontFamily)
      setEditSubFamily(loaded.meta.fontSubFamily)
      setEditCopyright(loaded.meta.copyright)
      setBlockFilter('all')
      setStatusFilter('all')
      setSearchQuery('')
      setPage(1)
      setExportResult(null)
      setTestTyping(
        loaded.blockCounts['cjk-basic'] > 0
          ? '轻匣字体子集化预览 0123456789 ABCabc'
          : 'LiteBox Font Subsetter Preview 0123456789',
      )
      toast.success(
        `已解析「${loaded.meta.fontFamily}」，共 ${loaded.codePoints.length.toLocaleString()} 个有效字符`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '字体解析失败')
    } finally {
      setLoadingFont(false)
    }
  }

  /** 计算「仅保留模式」输入文本的命中与缺失情况 */
  const keepAnalysis = useMemo(() => {
    if (!asset || !keepInput) return { totalUnique: 0, matched: [] as number[], missing: [] as number[] }
    const cps = extractUniqueCodePoints(keepInput)
    const matched: number[] = []
    const missing: number[] = []
    for (const cp of cps) {
      if (asset.codePointSet.has(cp)) matched.push(cp)
      else missing.push(cp)
    }
    return { totalUnique: cps.length, matched, missing }
  }, [asset, keepInput])

  /** 执行「仅保留这些字，快捷删除其他所有字」 */
  const handleKeepOnlyInput = () => {
    if (!asset) return
    if (keepAnalysis.matched.length === 0) {
      toast.error('输入文本中没有命中该字体包含的任何字符')
      return
    }
    const keepSet = new Set(keepAnalysis.matched)
    const nextDeleted = new Set<number>()
    for (const cp of asset.codePoints) {
      if (!keepSet.has(cp)) nextDeleted.add(cp)
    }
    setDeletedSet(nextDeleted)
    setExportResult(null)
    setPage(1)
    toast.success(
      `已设置为仅保留 ${keepSet.size} 字，快捷标记删除其余 ${nextDeleted.size.toLocaleString()} 字`,
    )
  }

  /** 将输入文字追加为保留（从删除集合中恢复） */
  const handleRestoreKeepInput = () => {
    if (!asset || keepAnalysis.matched.length === 0) return
    setDeletedSet((prev) => {
      const next = new Set(prev)
      keepAnalysis.matched.forEach((cp) => next.delete(cp))
      return next
    })
    setExportResult(null)
    toast.success(`已确保保留这 ${keepAnalysis.matched.length} 个字符`)
  }

  /** 执行「批量删除输入的文字」 */
  const handleBatchDeleteInput = () => {
    if (!asset) return
    const cps = extractUniqueCodePoints(deleteInput).filter((cp) => asset.codePointSet.has(cp))
    if (cps.length === 0) {
      toast.error('未在字体中匹配到可删除的字符')
      return
    }
    setDeletedSet((prev) => {
      const next = new Set(prev)
      cps.forEach((cp) => next.add(cp))
      return next
    })
    setExportResult(null)
    toast.success(`已批量标记删除 ${cps.length} 个字符`)
  }

  /** 按区段一键删除或恢复 */
  const handleToggleBlockDelete = (blockId: Exclude<CharBlockId, 'all'>, action: 'delete' | 'restore') => {
    if (!asset) return
    let affected = 0
    setDeletedSet((prev) => {
      const next = new Set(prev)
      for (const cp of asset.codePoints) {
        if (classifyCodePoint(cp) === blockId) {
          if (action === 'delete') {
            if (!next.has(cp)) affected++
            next.add(cp)
          } else {
            if (next.has(cp)) affected++
            next.delete(cp)
          }
        }
      }
      return next
    })
    setExportResult(null)
    const label = CHAR_BLOCKS.find((b) => b.id === blockId)?.shortLabel ?? blockId
    toast.success(
      action === 'delete' ? `已批量删除「${label}」区段（${affected.toLocaleString()} 字）` : `已恢复「${label}」区段（${affected.toLocaleString()} 字）`,
    )
  }

  /** 反选（保留 ↔ 删除互换） */
  const handleInvertSelection = () => {
    if (!asset) return
    setDeletedSet((prev) => {
      const next = new Set<number>()
      for (const cp of asset.codePoints) {
        if (!prev.has(cp)) next.add(cp)
      }
      return next
    })
    setExportResult(null)
    toast.success('已互换保留与删除集合')
  }

  /** 恢复全部字形 */
  const handleRestoreAll = () => {
    setDeletedSet(new Set())
    setExportResult(null)
    toast.success('已恢复字体全部字符')
  }

  /** 切换单个字形的保留/删除状态 */
  const toggleSingleCodePoint = useCallback((cp: number) => {
    setDeletedSet((prev) => {
      const next = new Set(prev)
      if (next.has(cp)) next.delete(cp)
      else next.add(cp)
      return next
    })
    setExportResult(null)
  }, [])

  /** 筛选后的网格码点列表 */
  const filteredCodePoints = useMemo(() => {
    if (!asset) return []
    const q = searchQuery.trim()
    let searchSet: Set<number> | null = null
    let hexQuery = ''

    if (q) {
      if (/^(u\+|0x)?[0-9a-f]{2,6}$/i.test(q)) {
        hexQuery = q.replace(/^(u\+|0x)/i, '').toUpperCase()
      }
      searchSet = new Set(extractUniqueCodePoints(q))
    }

    return asset.codePoints.filter((cp) => {
      const isDel = deletedSet.has(cp)
      if (statusFilter === 'kept' && isDel) return false
      if (statusFilter === 'deleted' && !isDel) return false
      if (blockFilter !== 'all' && classifyCodePoint(cp) !== blockFilter) return false
      if (q) {
        const hitChar = searchSet?.has(cp)
        const hitHex = hexQuery ? cp.toString(16).toUpperCase().includes(hexQuery) : false
        return Boolean(hitChar || hitHex)
      }
      return true
    })
  }, [asset, deletedSet, statusFilter, blockFilter, searchQuery])

  const totalPages = Math.max(1, Math.ceil(filteredCodePoints.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageCodePoints = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE
    return filteredCodePoints.slice(start, start + PAGE_SIZE)
  }, [filteredCodePoints, safePage])

  /** 批量删除/恢复当前筛选结果或当前页 */
  const handleBatchPage = (list: number[], action: 'delete' | 'restore', label: string) => {
    if (list.length === 0) return
    setDeletedSet((prev) => {
      const next = new Set(prev)
      for (const cp of list) {
        if (action === 'delete') next.add(cp)
        else next.delete(cp)
      }
      return next
    })
    setExportResult(null)
    toast.success(`已${action === 'delete' ? '删除' : '恢复'}${label}（${list.length.toLocaleString()} 字）`)
  }

  const keptCount = asset ? asset.codePoints.length - deletedSet.size : 0
  const deletedCount = deletedSet.size

  /** 生成并导出精简后的字体 */
  const handleGenerateExport = async (autoDownload = true) => {
    if (!asset) return
    const keepList = asset.codePoints.filter((cp) => !deletedSet.has(cp))
    if (keepList.length === 0) {
      toast.error('当前已删除全部字符，请至少保留 1 个字符')
      return
    }
    setExporting(true)
    try {
      const result = await exportSubsetFont(asset, {
        format: exportFormat,
        keepCodePoints: keepList,
        fontFamily: editFamily,
        fontSubFamily: editSubFamily,
        copyright: editCopyright,
        keepKerning,
      })
      setExportResult(result)
      // 自动带入几个保留字方便试打验证
      if (!testTyping.trim()) {
        setTestTyping(keepList.slice(0, 24).map((cp) => String.fromCodePoint(cp)).join(''))
      }
      if (autoDownload) {
        downloadBlob(result.blob, result.filename)
      }
      const savedPct =
        asset.size > 0 ? Math.max(0, Math.round((1 - result.size / asset.size) * 1000) / 10) : 0
      toast.success(
        `导出成功：保留 ${result.keptCount.toLocaleString()} 字，体积 ${formatBytes(result.size)}${savedPct > 0 ? `（瘦身 ${savedPct}%）` : ''}`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '字体裁剪导出失败')
    } finally {
      setExporting(false)
    }
  }

  // ============================================================================
  // 空态：上传字体
  // ============================================================================
  if (!asset) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="glass shadow-soft rounded-3xl p-6 sm:p-8">
          <FileDropzone
            accept={FONT_ACCEPT}
            multiple={false}
            onFiles={handleFontFiles}
            title={loadingFont ? '正在解析字体字符表与字形...' : '拖放或点击选择本地字体文件'}
            hint="支持 .ttf / .otf / .woff 字体文件 · 毫秒级解析万字中文字库，纯本地裁剪不上传"
          />
          <div className="border-border/60 text-muted-foreground mt-4 flex items-center justify-center gap-1.5 border-t pt-4 text-xs">
            <ShieldCheck className="size-4 text-emerald-500" />
            <span>100% 浏览器本地完成字形裁剪与打包，适合网页字体瘦身、Logo/标题精简字库与定制字符集</span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="glass rounded-2xl p-4 text-xs">
            <div className="mb-1.5 flex items-center gap-2 font-semibold">
              <Scissors className="text-primary size-4" />
              仅保留指定字（快捷删其余）
            </div>
            <p className="text-muted-foreground leading-relaxed">
              粘贴文案或勾选数字/字母/标点包，一键只保留需要的字，自动删除其余几万个多余字形，体积瞬间从 10MB 降到几十 KB。
            </p>
          </div>
          <div className="glass rounded-2xl p-4 text-xs">
            <div className="mb-1.5 flex items-center gap-2 font-semibold">
              <Eraser className="size-4 text-red-500" />
              可视化批量删字
            </div>
            <p className="text-muted-foreground leading-relaxed">
              支持在真实渲染的字形网格里点选删字、粘贴批量删字，或按区段一键清除扩展生僻字、日韩假名与符号。
            </p>
          </div>
          <div className="glass rounded-2xl p-4 text-xs">
            <div className="mb-1.5 flex items-center gap-2 font-semibold">
              <Download className="size-4 text-emerald-500" />
              精简 TTF / WOFF 实时验效
            </div>
            <p className="text-muted-foreground leading-relaxed">
              支持修改字体族名并导出精简 TTF / WOFF / SVG，导出后立即可在页面打字检验裁剪效果并复制 `@font-face` 代码。
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ============================================================================
  // 左侧操作控制面板（ToolShell）
  // ============================================================================
  const panel = (
    <div className="space-y-5">
      <Segmented<PanelTab>
        size="sm"
        value={panelTab}
        onChange={setPanelTab}
        options={[
          { value: 'keep', label: '仅保留字', icon: <Scissors className="size-3.5" /> },
          { value: 'delete', label: '批量删字', icon: <Eraser className="size-3.5" /> },
          { value: 'meta', label: '名称/导出', icon: <Type className="size-3.5" /> },
        ]}
      />

      {/* Tab 1：仅保留指定字（白名单快捷删除其他所有字） */}
      {panelTab === 'keep' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold">输入或粘贴需要保留的文字</span>
              {keepInput && (
                <button
                  type="button"
                  onClick={() => setKeepInput('')}
                  className="text-muted-foreground hover:text-foreground text-[11px]"
                >
                  清空
                </button>
              )}
            </div>
            <textarea
              rows={5}
              value={keepInput}
              onChange={(e) => setKeepInput(e.target.value)}
              placeholder="粘贴你的标题、网页文案、歌词或常用字列表，点击下方按钮即可【仅保留这些字，一键删除其他所有字】..."
              className="border-border/70 bg-background/60 focus:border-primary w-full resize-y rounded-xl border p-2.5 text-xs leading-relaxed outline-none"
            />
          </div>

          {/* 快捷字符包追加 */}
          <div className="space-y-1.5">
            <div className="text-muted-foreground text-[11px] font-medium">快捷追加常用字符包：</div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_KEEP_PACKS.map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => setKeepInput((prev) => `${prev}${pack.chars}`)}
                  className="bg-foreground/[0.06] hover:bg-primary/14 hover:text-primary rounded-lg px-2 py-1 text-[11px] font-medium transition-colors"
                  title={pack.desc}
                >
                  + {pack.label}
                </button>
              ))}
            </div>
          </div>

          {/* 命中与缺失统计 */}
          {keepInput.trim() && (
            <div className="bg-foreground/[0.03] border-border/60 space-y-1.5 rounded-xl border p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">去重输入字符</span>
                <span className="font-mono font-semibold">{keepAnalysis.totalUnique} 字</span>
              </div>
              <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
                <span>原字体已包含（将保留）</span>
                <span className="font-mono font-semibold">{keepAnalysis.matched.length} 字</span>
              </div>
              {keepAnalysis.missing.length > 0 && (
                <div className="space-y-1 border-t border-border/50 pt-1.5 text-amber-600 dark:text-amber-400">
                  <div className="flex items-center gap-1 text-[11px] font-medium">
                    <AlertCircle className="size-3.5 shrink-0" />
                    原字体缺失 {keepAnalysis.missing.length} 字：
                  </div>
                  <div className="bg-amber-500/10 max-h-14 overflow-y-auto rounded-lg px-2 py-1 font-mono text-[11px] break-all">
                    {keepAnalysis.missing.map((cp) => String.fromCodePoint(cp)).join(' ')}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Button
              variant="primary"
              size="md"
              className="w-full"
              disabled={keepAnalysis.matched.length === 0}
              onClick={handleKeepOnlyInput}
            >
              <Scissors />
              仅保留这 {keepAnalysis.matched.length} 字（删除其余全部）
            </Button>
            {deletedCount > 0 && keepAnalysis.matched.length > 0 && (
              <Button variant="outline" size="sm" className="w-full" onClick={handleRestoreKeepInput}>
                <Sparkles />
                在现有基础上追加保留这些字
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Tab 2：批量删除字（黑名单 + 按区段一键删） */}
      {panelTab === 'delete' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold">输入要批量删除的字</span>
              {deleteInput && (
                <button
                  type="button"
                  onClick={() => setDeleteInput('')}
                  className="text-muted-foreground hover:text-foreground text-[11px]"
                >
                  清空
                </button>
              )}
            </div>
            <textarea
              rows={4}
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
              placeholder="输入或粘贴要从字体中剔除的字符，支持中文、英文、数字与标点..."
              className="border-border/70 bg-background/60 focus:border-primary w-full resize-y rounded-xl border p-2.5 text-xs leading-relaxed outline-none"
            />
            <Button
              variant="danger"
              size="sm"
              className="w-full"
              disabled={!deleteInput.trim()}
              onClick={handleBatchDeleteInput}
            >
              <Trash2 />
              批量标记删除以上字符
            </Button>
          </div>

          <hr className="border-border/60" />

          {/* 按字符区段一键批量删/恢复 */}
          <div className="space-y-2">
            <div className="text-xs font-semibold">按字符区段一键清理</div>
            <div className="space-y-1.5">
              {CHAR_BLOCKS.filter((b) => b.id !== 'all' && asset.blockCounts[b.id] > 0).map((b) => {
                const blockId = b.id as Exclude<CharBlockId, 'all'>
                return (
                  <div
                    key={b.id}
                    className="border-border/50 bg-background/40 flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{b.label}</div>
                      <div className="text-muted-foreground font-mono text-[10px]">
                        {asset.blockCounts[b.id].toLocaleString()} 字
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => handleToggleBlockDelete(blockId, 'delete')}
                        className="rounded-lg bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-500 transition-colors hover:bg-red-500/20"
                      >
                        全删
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleBlockDelete(blockId, 'restore')}
                        className="bg-foreground/[0.06] hover:bg-foreground/12 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors"
                      >
                        恢复
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={handleInvertSelection}>
              <ArrowLeftRight />
              反选留/删
            </Button>
            <Button variant="outline" size="sm" disabled={deletedCount === 0} onClick={handleRestoreAll}>
              <RotateCcw />
              恢复全部
            </Button>
          </div>
        </div>
      )}

      {/* Tab 3：字体名称与导出格式 */}
      {panelTab === 'meta' && (
        <div className="space-y-4">
          <Field label="导出格式">
            <Segmented<ExportFontFormat>
              size="sm"
              value={exportFormat}
              onChange={setExportFormat}
              options={[
                { value: 'ttf', label: 'TTF（通用）' },
                { value: 'woff', label: 'WOFF（网页压缩）' },
                { value: 'svg', label: 'SVG' },
              ]}
            />
          </Field>

          <Field label="字体族名 (Font Family)">
            <input
              type="text"
              value={editFamily}
              onChange={(e) => setEditFamily(e.target.value)}
              placeholder="例如：MyCustomFont"
              className={inputCls}
            />
          </Field>

          <Field label="字重 / 样式 (Subfamily)">
            <input
              type="text"
              value={editSubFamily}
              onChange={(e) => setEditSubFamily(e.target.value)}
              placeholder="Regular / Bold"
              className={inputCls}
            />
          </Field>

          <Field label="版权说明 (Copyright)">
            <input
              type="text"
              value={editCopyright}
              onChange={(e) => setEditCopyright(e.target.value)}
              placeholder="可选"
              className={inputCls}
            />
          </Field>

          <div className="flex items-center justify-between text-xs">
            <span className="text-foreground/80 font-medium">保留字距微调 (Kerning)</span>
            <Switch checked={keepKerning} onChange={setKeepKerning} label="保留字距微调" />
          </div>

          <div className="bg-foreground/[0.03] border-border/60 space-y-1 rounded-xl border p-3 font-mono text-[11px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">源格式 / UPM</span>
              <span>
                {asset.format.toUpperCase()} · {asset.meta.unitsPerEm}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">原始大小</span>
              <span>{formatBytes(asset.size)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">版本</span>
              <span className="max-w-[160px] truncate">{asset.meta.version}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  const actions = (
    <Button
      variant="primary"
      size="md"
      disabled={exporting || keptCount === 0}
      onClick={() => void handleGenerateExport(true)}
    >
      {exporting ? <Loader2 className="animate-spin" /> : <Download />}
      {exporting ? '正在裁剪打包...' : `导出 ${exportFormat.toUpperCase()}（留 ${keptCount.toLocaleString()} 字）`}
    </Button>
  )

  return (
    <ToolShell panel={panel} actions={actions} panelTitle="字体裁剪与编辑">
      <div className="space-y-4">
        {/* 顶部字体概览与统计条 */}
        <div className="glass shadow-soft flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="bg-primary/12 text-primary flex size-11 shrink-0 items-center justify-center rounded-2xl">
              <ALargeSmall className="size-5.5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-sm font-bold">{asset.meta.fontFamily}</h2>
                <span className="bg-foreground/[0.07] rounded-md px-1.5 py-0.5 font-mono text-[10px] uppercase">
                  {asset.format}
                </span>
                <span className="text-muted-foreground font-mono text-xs">{formatBytes(asset.size)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                <span className="text-muted-foreground">
                  原总计 <strong className="text-foreground font-mono">{asset.codePoints.length.toLocaleString()}</strong> 字
                </span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  保留 <strong className="font-mono">{keptCount.toLocaleString()}</strong> 字
                </span>
                <span className="text-red-500">
                  将删 <strong className="font-mono">{deletedCount.toLocaleString()}</strong> 字
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {deletedCount > 0 && (
              <Button variant="outline" size="sm" onClick={handleRestoreAll}>
                <RotateCcw />
                恢复全部
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAsset(null)
                setDeletedSet(new Set())
                setExportResult(null)
              }}
            >
              <Upload />
              换一个字体
            </Button>
          </div>
        </div>

        {/* 导出成果对比与实时打字检验区 */}
        {exportResult && (
          <div className="glass shadow-soft border-emerald-500/30 space-y-3 rounded-2xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <span>裁剪成品就绪：{exportResult.filename}</span>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                    {formatBytes(asset.size)} → {formatBytes(exportResult.size)}
                    {asset.size > exportResult.size
                      ? `（瘦身 ${Math.round((1 - exportResult.size / asset.size) * 1000) / 10}%）`
                      : ''}
                  </span>
                </div>
                <div className="text-muted-foreground text-xs">
                  已保留 {exportResult.keptCount.toLocaleString()} 个字形 · 下方可实时打字验证裁剪后的真实字体效果（已删字会自动回退为系统默认字体）
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(exportResult.cssSnippet).then(() => {
                      setCopiedCss(true)
                      toast.success('已复制 @font-face CSS 代码')
                      setTimeout(() => setCopiedCss(false), 1600)
                    })
                  }}
                >
                  {copiedCss ? <Check className="text-emerald-500" /> : <Code2 />}
                  {copiedCss ? '已复制 CSS' : '复制 @font-face'}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => downloadBlob(exportResult.blob, exportResult.filename)}
                >
                  <Download />
                  重新下载
                </Button>
              </div>
            </div>

            {exportResult.previewFamily && (
              <input
                type="text"
                value={testTyping}
                onChange={(e) => setTestTyping(e.target.value)}
                placeholder="在这里打字测试裁剪后的字体效果..."
                style={{ fontFamily: `"${exportResult.previewFamily}", sans-serif` }}
                className="border-border/70 bg-background/70 w-full rounded-xl border px-4 py-3 text-xl outline-none"
              />
            )}
          </div>
        )}

        {/* 可视化字形浏览与点选删除网格 */}
        <div className="glass shadow-soft space-y-3.5 rounded-2xl p-4">
          {/* 顶部检索与状态过滤 */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setPage(1)
                }}
                placeholder="输入字符或 Unicode 码点搜索（如 中 或 4E2D）..."
                className="border-border/70 bg-background/60 focus:border-primary w-full rounded-xl border py-1.5 pr-8 pl-8 text-xs outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('')
                    setPage(1)
                  }}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            <div className="w-full sm:w-56">
              <Segmented<StatusFilter>
                size="sm"
                value={statusFilter}
                onChange={(v) => {
                  setStatusFilter(v)
                  setPage(1)
                }}
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'kept', label: '仅保留' },
                  { value: 'deleted', label: '仅已删' },
                ]}
              />
            </div>
          </div>

          {/* 字符区段过滤胶囊 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Filter className="text-muted-foreground mr-0.5 size-3.5 shrink-0" />
            {CHAR_BLOCKS.filter((b) => b.id === 'all' || asset.blockCounts[b.id] > 0).map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  setBlockFilter(b.id)
                  setPage(1)
                }}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                  blockFilter === b.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-foreground/[0.05] text-muted-foreground hover:text-foreground',
                )}
              >
                {b.shortLabel}
                <span className="ml-1 font-mono text-[10px] opacity-75">
                  {asset.blockCounts[b.id].toLocaleString()}
                </span>
              </button>
            ))}
          </div>

          {/* 本页/当前筛选快捷批操作条 */}
          <div className="border-border/50 flex flex-wrap items-center justify-between gap-2 border-y py-2 text-xs">
            <span className="text-muted-foreground">
              点击任意字符卡片即可切换「保留 / 删除」· 当前筛选共{' '}
              <strong className="text-foreground font-mono">{filteredCodePoints.length.toLocaleString()}</strong> 字
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleBatchPage(pageCodePoints, 'delete', '本页')}
                className="rounded-lg bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-500 hover:bg-red-500/20"
              >
                删除本页 ({pageCodePoints.length})
              </button>
              <button
                type="button"
                onClick={() => handleBatchPage(pageCodePoints, 'restore', '本页')}
                className="bg-foreground/[0.06] hover:bg-foreground/12 rounded-lg px-2 py-1 text-[11px] font-medium"
              >
                恢复本页
              </button>
              {filteredCodePoints.length !== pageCodePoints.length && filteredCodePoints.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleBatchPage(filteredCodePoints, 'delete', '当前筛选全部')}
                  className="rounded-lg border border-red-500/30 px-2 py-1 text-[11px] font-medium text-red-500 hover:bg-red-500/10"
                >
                  删除筛选全部 ({filteredCodePoints.length.toLocaleString()})
                </button>
              )}
            </div>
          </div>

          {/* 字符网格 */}
          {pageCodePoints.length === 0 ? (
            <div className="text-muted-foreground flex min-h-[240px] flex-col items-center justify-center gap-2 text-xs">
              <Copy className="size-7 opacity-35" />
              <span>当前筛选条件下没有字符</span>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
              {pageCodePoints.map((cp) => {
                const isDel = deletedSet.has(cp)
                const ch = cp === 0x20 ? '␣' : String.fromCodePoint(cp)
                return (
                  <button
                    key={cp}
                    type="button"
                    onClick={() => toggleSingleCodePoint(cp)}
                    title={`${ch} (${formatCodePoint(cp)}) · 点击${isDel ? '恢复保留' : '标记删除'}`}
                    className={cn(
                      'group relative flex flex-col items-center justify-between rounded-xl border px-1.5 py-2 transition-all select-none',
                      isDel
                        ? 'border-dashed border-red-500/45 bg-red-500/[0.06] opacity-55 hover:opacity-85'
                        : 'border-border/60 bg-background/50 hover:border-primary/70 hover:bg-primary/[0.06]',
                    )}
                  >
                    {isDel && (
                      <span className="absolute top-1 right-1 rounded bg-red-500/85 px-1 text-[9px] font-bold text-white">
                        删
                      </span>
                    )}
                    <span
                      style={{ fontFamily: `"${asset.previewFamily}", sans-serif` }}
                      className={cn(
                        'flex h-10 items-center justify-center text-2xl leading-none',
                        isDel && 'line-through decoration-red-500/80',
                      )}
                    >
                      {ch}
                    </span>
                    <span className="text-muted-foreground mt-1 font-mono text-[9px]">
                      {cp.toString(16).toUpperCase().padStart(4, '0')}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {/* 分页器 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 text-xs">
              <span className="text-muted-foreground font-mono">
                第 {safePage} / {totalPages} 页
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft />
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  下一页
                  <ChevronRight />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ToolShell>
  )
}
