import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Archive,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  File,
  FileArchive,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderArchive,
  FolderDown,
  FolderOpen,
  KeyRound,
  Languages,
  Layers,
  Loader2,
  Lock,
  Music,
  Package,
  Search,
  ShieldCheck,
  Unlock,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/field'
import { downloadBlob, timestampName } from '@/lib/file'
import { cn, formatBytes } from '@/lib/utils'
import { PreviewDrawer } from './PreviewDrawer'
import {
  buildFolderTree,
  closeZipArchive,
  extractItemsToLocalDirectory,
  extractItemToBlob,
  FILENAME_ENCODING_OPTIONS,
  formatDateTime,
  openZipArchive,
  repackSelectedItemsAsZip,
  supportsDirectoryExtraction,
  verifyArchivePassword,
  type EntryKind,
  type ExtractProgress,
  type FilenameEncoding,
  type FolderTreeNode,
  type OpenedArchive,
  type ZipItem,
} from './engine'

const ZIP_ACCEPT = '.zip,.jar,.war,.apk,.ipa,.epub,.cbz,.xpi,.crx,.docx,.xlsx,.pptx,application/zip,application/x-zip-compressed'

type TypeFilter = 'all' | 'image' | 'text' | 'doc' | 'media' | 'other'
type SortKey = 'default' | 'name' | 'size-desc' | 'date-desc'

const TYPE_FILTERS: { id: TypeFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'image', label: '图片' },
  { id: 'text', label: '文本/代码' },
  { id: 'doc', label: 'PDF/文档' },
  { id: 'media', label: '音视频' },
  { id: 'other', label: '其他' },
]

function renderFileIcon(kind: EntryKind) {
  switch (kind) {
    case 'image':
      return <FileImage className="size-4 text-pink-500" />
    case 'text':
      return <FileCode2 className="size-4 text-sky-500" />
    case 'pdf':
      return <FileText className="size-4 text-red-500" />
    case 'office':
      return <FileSpreadsheet className="size-4 text-blue-500" />
    case 'audio':
      return <Music className="size-4 text-emerald-500" />
    case 'video':
      return <Video className="size-4 text-purple-500" />
    case 'zip':
      return <FileArchive className="size-4 text-amber-500" />
    default:
      return <File className="text-muted-foreground size-4" />
  }
}

function matchTypeFilter(kind: EntryKind, filter: TypeFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'image') return kind === 'image'
  if (filter === 'text') return kind === 'text'
  if (filter === 'doc') return kind === 'pdf' || kind === 'office'
  if (filter === 'media') return kind === 'audio' || kind === 'video'
  return kind === 'zip' || kind === 'binary'
}

export default function ZipExtractTool() {
  // 支持嵌套 ZIP 面包屑栈（打开压缩包内嵌的 .zip 时可随时返回上级）
  const [archiveStack, setArchiveStack] = useState<OpenedArchive[]>([])
  const archive = archiveStack[archiveStack.length - 1] ?? null

  const [opening, setOpening] = useState(false)
  const [encoding, setEncoding] = useState<FilenameEncoding>('auto')
  const [hideJunk, setHideJunk] = useState(true)

  // 目录浏览、搜索与筛选
  const [activeDir, setActiveDir] = useState<string>('')
  const [includeSubdirs, setIncludeSubdirs] = useState(true)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set(['']))
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [sortBy, setSortBy] = useState<SortKey>('default')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())

  // 密码解锁状态
  const [passwordInput, setPasswordInput] = useState('')
  const [verifiedPassword, setVerifiedPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [checkingPassword, setCheckingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const passwordInputRef = useRef<HTMLInputElement>(null)

  // 解压进度 & 预览弹窗
  const [createSubfolder, setCreateSubfolder] = useState(true)
  const [progress, setProgress] = useState<ExtractProgress | null>(null)
  const [extractModeLabel, setExtractModeLabel] = useState('')
  const [previewItem, setPreviewItem] = useState<ZipItem | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const canExtractToDir = useMemo(() => supportsDirectoryExtraction(), [])

  // 卸载时释放所有已打开的 ZipReader
  const stackRef = useRef(archiveStack)
  stackRef.current = archiveStack
  useEffect(() => {
    return () => {
      stackRef.current.forEach((a) => {
        void closeZipArchive(a)
      })
    }
  }, [])

  /** 重置当前浏览状态 */
  const resetViewState = useCallback(() => {
    setActiveDir('')
    setExpandedDirs(new Set(['']))
    setQuery('')
    setTypeFilter('all')
    setSortBy('default')
    setSelectedIds(new Set())
    setPasswordInput('')
    setVerifiedPassword('')
    setPasswordError('')
    setPreviewItem(null)
  }, [])

  /** 打开一个新的顶层 ZIP 文件 */
  const handleFiles = async (files: File[]) => {
    const file = files[0]
    if (!file) return
    setOpening(true)
    try {
      const opened = await openZipArchive(file, file.name, encoding)
      // 关闭旧栈
      await Promise.all(archiveStack.map((a) => closeZipArchive(a)))
      setArchiveStack([opened])
      resetViewState()
      toast.success(
        `已解析「${file.name}」，共 ${opened.items.length} 个文件${opened.encryptedCount > 0 ? '（含加密文件）' : ''}`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开压缩包失败')
    } finally {
      setOpening(false)
    }
  }

  /** 打开压缩包内部的嵌套 ZIP */
  const handleOpenNestedZip = async (blob: Blob, filename: string) => {
    setOpening(true)
    try {
      const opened = await openZipArchive(blob, filename, encoding)
      setArchiveStack((prev) => [...prev, opened])
      resetViewState()
      toast.success(`已进入嵌套压缩包「${filename}」`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开嵌套压缩包失败')
    } finally {
      setOpening(false)
    }
  }

  /** 返回上级压缩包（嵌套栈导航） */
  const handlePopToStackIndex = async (index: number) => {
    if (index < 0 || index >= archiveStack.length - 1) return
    const toClose = archiveStack.slice(index + 1)
    await Promise.all(toClose.map((a) => closeZipArchive(a)))
    setArchiveStack((prev) => prev.slice(0, index + 1))
    resetViewState()
  }

  /** 关闭当前压缩包回到上传页 */
  const handleCloseAll = async () => {
    await Promise.all(archiveStack.map((a) => closeZipArchive(a)))
    setArchiveStack([])
    resetViewState()
  }

  /** 切换文件名编码并即时重解析当前压缩包 */
  const handleChangeEncoding = async (nextEnc: FilenameEncoding) => {
    setEncoding(nextEnc)
    if (!archive) return
    setOpening(true)
    try {
      const reopened = await openZipArchive(archive.sourceBlob, archive.name, nextEnc)
      await closeZipArchive(archive)
      setArchiveStack((prev) => [...prev.slice(0, -1), reopened])
      setActiveDir('')
      setExpandedDirs(new Set(['']))
      setSelectedIds(new Set())
      toast.success(`已切换编码为 ${FILENAME_ENCODING_OPTIONS.find((o) => o.value === nextEnc)?.label ?? nextEnc}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重新解析编码失败')
    } finally {
      setOpening(false)
    }
  }

  /** 校验解压密码 */
  const handleVerifyPassword = async () => {
    if (!archive) return
    if (!passwordInput) {
      setPasswordError('请输入解压密码')
      return
    }
    setCheckingPassword(true)
    setPasswordError('')
    try {
      const ok = await verifyArchivePassword(archive.items, passwordInput)
      if (ok) {
        setVerifiedPassword(passwordInput)
        toast.success('密码校验通过，可直接预览与提取全部文件')
      } else {
        setPasswordError('密码不正确，请核对后重试')
      }
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : '校验密码失败')
    } finally {
      setCheckingPassword(false)
    }
  }

  /** 过滤系统垃圾文件后的全量可见文件 */
  const cleanItems = useMemo(() => {
    if (!archive) return []
    return hideJunk ? archive.items.filter((i) => !i.isSystemJunk) : archive.items
  }, [archive, hideJunk])

  /** 目录树 */
  const folderTree = useMemo(() => {
    if (!archive) return null
    return buildFolderTree(cleanItems, archive.name)
  }, [archive, cleanItems])

  /** 当前视图筛选、搜索并排序后的文件列表 */
  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = cleanItems.filter((item) => {
      if (!matchTypeFilter(item.kind, typeFilter)) return false
      if (q) {
        // 全局搜索路径与文件名
        return item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q)
      }
      if (!activeDir) {
        return includeSubdirs ? true : item.dir === ''
      }
      if (includeSubdirs) {
        return item.dir === activeDir || item.dir.startsWith(`${activeDir}/`)
      }
      return item.dir === activeDir
    })

    if (sortBy === 'name') {
      return [...list].sort((a, b) => a.path.localeCompare(b.path, 'zh-CN', { numeric: true }))
    }
    if (sortBy === 'size-desc') {
      return [...list].sort((a, b) => b.uncompressedSize - a.uncompressedSize)
    }
    if (sortBy === 'date-desc') {
      return [...list].sort((a, b) => (b.lastModDate?.getTime() ?? 0) - (a.lastModDate?.getTime() ?? 0))
    }
    return list
  }, [cleanItems, query, typeFilter, activeDir, includeSubdirs, sortBy])

  /** 当前勾选的文件集合（跨筛选保留有效 ID） */
  const selectedItems = useMemo(() => {
    if (selectedIds.size === 0) return []
    return cleanItems.filter((it) => selectedIds.has(it.id))
  }, [cleanItems, selectedIds])

  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every((i) => selectedIds.has(i.id))

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        visibleItems.forEach((i) => next.delete(i.id))
      } else {
        visibleItems.forEach((i) => next.add(i.id))
      }
      return next
    })
  }

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const activePassword = verifiedPassword || passwordInput

  /** 检查加密前提 */
  const ensureUnlocked = (targetItems: ZipItem[]): boolean => {
    const needPwd = targetItems.some((i) => i.encrypted)
    if (needPwd && !activePassword) {
      toast.error('选中的文件包含加密内容，请先在顶部输入解压密码')
      passwordInputRef.current?.focus()
      return false
    }
    return true
  }

  /** 提取单个文件直接下载 */
  const handleExtractSingle = async (item: ZipItem) => {
    if (!ensureUnlocked([item])) return
    try {
      const blob = await extractItemToBlob(item, activePassword)
      downloadBlob(blob, item.name)
      toast.success(`已提取「${item.name}」`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提取失败')
    }
  }

  /** 流式解压到本地文件夹（Chrome / Edge 原生保留目录树） */
  const handleExtractToDirectory = async (targetItems: ZipItem[]) => {
    if (!archive || targetItems.length === 0) return
    if (!ensureUnlocked(targetItems)) return

    const controller = new AbortController()
    abortRef.current = controller
    setExtractModeLabel('正在流式解压到本地目录')
    setProgress({
      completedFiles: 0,
      totalFiles: targetItems.length,
      completedBytes: 0,
      totalBytes: targetItems.reduce((s, it) => s + Math.max(1, it.uncompressedSize), 0),
      currentPath: targetItems[0].path,
    })

    try {
      const baseFolder = archive.name.replace(/\.[^.]+$/, '')
      const res = await extractItemsToLocalDirectory(targetItems, {
        password: activePassword,
        createSubfolderName: createSubfolder ? baseFolder : undefined,
        onProgress: setProgress,
        signal: controller.signal,
      })
      toast.success(`已成功解压 ${res.extractedCount} 个文件到「${res.folderName}」`)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // 用户取消选择文件夹对话框，不报错
      } else {
        toast.error(err instanceof Error ? err.message : '解压到本地文件夹失败')
      }
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }

  /** 将勾选项重打包为干净无密码 UTF-8 ZIP（或单文件直下） */
  const handleDownloadSelection = async (targetItems: ZipItem[]) => {
    if (!archive || targetItems.length === 0) return
    if (!ensureUnlocked(targetItems)) return

    if (targetItems.length === 1) {
      await handleExtractSingle(targetItems[0])
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setExtractModeLabel('正在整理并打包选中文件（UTF-8 无密码）')
    setProgress({
      completedFiles: 0,
      totalFiles: targetItems.length,
      completedBytes: 0,
      totalBytes: targetItems.reduce((s, it) => s + Math.max(1, it.uncompressedSize), 0),
      currentPath: targetItems[0].path,
    })

    try {
      const zipBlob = await repackSelectedItemsAsZip(targetItems, {
        password: activePassword,
        onProgress: setProgress,
        signal: controller.signal,
      })
      const base = archive.name.replace(/\.[^.]+$/, '').slice(0, 24) || 'extracted'
      downloadBlob(zipBlob, timestampName(`${base}-extracted`, 'zip'))
      toast.success(`已将 ${targetItems.length} 个文件打包为标准 UTF-8 ZIP 下载`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打包下载失败')
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }

  /** 逐个下载（最多 10 个，防浏览器拦截） */
  const handleDownloadIndividually = async (targetItems: ZipItem[]) => {
    if (targetItems.length === 0) return
    if (!ensureUnlocked(targetItems)) return
    if (targetItems.length > 10) {
      toast.error('逐个下载一次最多支持 10 个文件，更多文件请使用「解压到本地文件夹」或「打包下载」')
      return
    }
    for (const it of targetItems) {
      try {
        const blob = await extractItemToBlob(it, activePassword)
        downloadBlob(blob, it.name)
        await new Promise((r) => setTimeout(r, 160))
      } catch (err) {
        toast.error(`${it.name}：${err instanceof Error ? err.message : '提取失败'}`)
        break
      }
    }
    toast.success(`已依次触发 ${targetItems.length} 个文件下载`)
  }

  /** 递归渲染左侧文件夹树 */
  const renderTreeNode = (node: FolderTreeNode, depth = 0) => {
    const isRoot = node.path === ''
    const hasChildren = node.children.length > 0
    const isExpanded = expandedDirs.has(node.path)
    const isActive = activeDir === node.path && !query.trim()

    return (
      <div key={node.path || '__root__'}>
        <div
          className={cn(
            'group flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition-colors',
            isActive ? 'bg-primary/12 text-primary font-semibold' : 'text-foreground/80 hover:bg-foreground/[0.05]',
          )}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          onClick={() => {
            setActiveDir(node.path)
            setQuery('')
            if (hasChildren && !isExpanded) {
              setExpandedDirs((prev) => new Set(prev).add(node.path))
            }
          }}
        >
          <button
            type="button"
            className={cn(
              'flex size-4 shrink-0 items-center justify-center rounded hover:bg-foreground/10',
              !hasChildren && 'invisible',
            )}
            onClick={(e) => {
              e.stopPropagation()
              setExpandedDirs((prev) => {
                const next = new Set(prev)
                if (next.has(node.path)) next.delete(node.path)
                else next.add(node.path)
                return next
              })
            }}
          >
            {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          {isActive || isExpanded ? (
            <FolderOpen className={cn('size-3.5 shrink-0', isRoot ? 'text-primary' : 'text-amber-500')} />
          ) : (
            <Folder className={cn('size-3.5 shrink-0', isRoot ? 'text-primary' : 'text-amber-500')} />
          )}
          <span className="min-w-0 flex-1 truncate">{isRoot ? '全部文件' : node.name}</span>
          <span className="text-muted-foreground shrink-0 font-mono text-[10px]">{node.fileCount}</span>
        </div>
        {hasChildren && isExpanded && (
          <div>{node.children.map((child) => renderTreeNode(child, depth + 1))}</div>
        )}
      </div>
    )
  }

  const overallSavings =
    archive && archive.totalUncompressed > 0
      ? Math.max(0, Math.min(99, Math.round((1 - archive.archiveSize / archive.totalUncompressed) * 100)))
      : 0

  const extractTarget = selectedItems.length > 0 ? selectedItems : cleanItems
  const extractTargetLabel =
    selectedItems.length > 0 ? `已选 ${selectedItems.length} 项` : `全部 ${cleanItems.length} 项`

  // ============================================================================
  // 空态：上传压缩包
  // ============================================================================
  if (!archive) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="glass shadow-soft rounded-3xl p-6 sm:p-8">
          <FileDropzone
            accept={ZIP_ACCEPT}
            multiple={false}
            onFiles={handleFiles}
            title={opening ? '正在解析压缩包目录...' : '拖放、粘贴或点击选择 ZIP 压缩包'}
            hint="支持标准 ZIP / ZIP64、带密码加密压缩包（AES-256 / ZipCrypto），以及 JAR / APK / EPUB / DOCX 等 ZIP 容器"
          />

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4 text-xs">
            <div className="text-muted-foreground flex items-center gap-2">
              <Languages className="text-primary size-4 shrink-0" />
              <span>默认文件名编码：</span>
              <select
                value={encoding}
                onChange={(e) => setEncoding(e.target.value as FilenameEncoding)}
                className="border-border/70 bg-background/70 rounded-lg border px-2.5 py-1 text-xs font-medium outline-none"
              >
                {FILENAME_ENCODING_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="size-4 text-emerald-500" />
              <span>100% 浏览器本地解析，压缩包与密码绝不上传服务器</span>
            </div>
          </div>
        </div>

        {/* 核心能力速览 */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="glass rounded-2xl p-4 text-xs">
            <div className="mb-1.5 flex items-center gap-2 font-semibold">
              <KeyRound className="size-4 text-amber-500" />
              支持加密 ZIP 解密
            </div>
            <p className="text-muted-foreground leading-relaxed">
              完整兼容 AES-256 与传统 ZipCrypto 加密压缩包，输入一次密码即可流畅预览与批量提取。
            </p>
          </div>
          <div className="glass rounded-2xl p-4 text-xs">
            <div className="mb-1.5 flex items-center gap-2 font-semibold">
              <Languages className="size-4 text-sky-500" />
              Windows 中文防乱码
            </div>
            <p className="text-muted-foreground leading-relaxed">
              智能探测 UTF-8 与 GB18030/GBK，随时切换日文/繁体编码，彻底告别中文文件名乱码。
            </p>
          </div>
          <div className="glass rounded-2xl p-4 text-xs">
            <div className="mb-1.5 flex items-center gap-2 font-semibold">
              <FolderDown className="size-4 text-emerald-500" />
              免解压预览 &amp; 直写目录
            </div>
            <p className="text-muted-foreground leading-relaxed">
              按需预览图片、代码、PDF、音视频及嵌套 ZIP；Chrome/Edge 支持流式一键解压到本地文件夹。
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ============================================================================
  // 主工作台：目录树 + 文件浏览 + 密码解锁 + 解压操作
  // ============================================================================
  const breadcrumbs = activeDir ? activeDir.split('/') : []

  return (
    <div className="space-y-4">
      {/* 嵌套 ZIP 返回栈 */}
      {archiveStack.length > 1 && (
        <div className="glass flex flex-wrap items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs">
          <Layers className="text-primary size-3.5" />
          <span className="text-muted-foreground">压缩包层级：</span>
          {archiveStack.map((item, idx) => {
            const isLast = idx === archiveStack.length - 1
            return (
              <span key={`${item.name}-${idx}`} className="inline-flex items-center gap-1">
                {idx > 0 && <ChevronRight className="text-muted-foreground size-3.5" />}
                {isLast ? (
                  <span className="font-semibold">{item.name}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handlePopToStackIndex(idx)}
                    className="text-primary hover:underline"
                  >
                    {item.name}
                  </button>
                )}
              </span>
            )
          })}
        </div>
      )}

      {/* 顶部概览与主提取动作栏 */}
      <div className="glass shadow-soft space-y-4 rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="bg-primary/12 text-primary flex size-11 shrink-0 items-center justify-center rounded-2xl">
              <FolderArchive className="size-5.5" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="max-w-full truncate text-base font-semibold">{archive.name}</h2>
                {archive.encryptedCount > 0 && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                      verifiedPassword
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                    )}
                  >
                    {verifiedPassword ? <Unlock className="size-3" /> : <Lock className="size-3" />}
                    {verifiedPassword ? '已解锁' : `${archive.encryptedCount} 项已加密`}
                  </span>
                )}
              </div>
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span>共 {cleanItems.length} 个文件</span>
                <span>压缩包 {formatBytes(archive.archiveSize)}</span>
                <span>解压后 {formatBytes(archive.totalUncompressed)}</span>
                {overallSavings > 0 && (
                  <span className="text-emerald-600 dark:text-emerald-400">节省 {overallSavings}%</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canExtractToDir && (
              <Button
                variant="primary"
                size="sm"
                disabled={Boolean(progress) || extractTarget.length === 0}
                onClick={() => handleExtractToDirectory(extractTarget)}
              >
                <FolderDown />
                解压到本地文件夹（{extractTargetLabel}）
              </Button>
            )}
            <Button
              variant={canExtractToDir ? 'outline' : 'primary'}
              size="sm"
              disabled={Boolean(progress) || extractTarget.length === 0}
              onClick={() => handleDownloadSelection(extractTarget)}
            >
              <Package />
              {extractTarget.length === 1 ? '提取选中文件' : `打包下载（${extractTargetLabel}）`}
            </Button>
            {selectedItems.length > 1 && selectedItems.length <= 10 && (
              <Button
                variant="outline"
                size="sm"
                disabled={Boolean(progress)}
                onClick={() => handleDownloadIndividually(selectedItems)}
              >
                <Download />
                逐个下载 ({selectedItems.length})
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleCloseAll}>
              <Upload />
              换一个包
            </Button>
          </div>
        </div>

        {/* 次级控制行：编码修复 + 隐藏系统文件 + 子目录选项 */}
        <div className="border-border/60 flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-muted-foreground flex items-center gap-1.5">
              <Languages className="size-3.5" />
              <span>文件名编码</span>
              <select
                value={encoding}
                disabled={opening}
                onChange={(e) => handleChangeEncoding(e.target.value as FilenameEncoding)}
                className="border-border/70 bg-background/70 text-foreground rounded-lg border px-2 py-1 text-xs font-medium outline-none"
              >
                {FILENAME_ENCODING_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            {archive.junkCount > 0 && (
              <div className="flex items-center gap-2">
                <Switch checked={hideJunk} onChange={setHideJunk} label="隐藏系统垃圾文件" />
                <span className="text-muted-foreground">
                  隐藏 __MACOSX / .DS_Store（{archive.junkCount}）
                </span>
              </div>
            )}
          </div>

          {canExtractToDir && (
            <div className="flex items-center gap-2">
              <Switch checked={createSubfolder} onChange={setCreateSubfolder} label="自动创建同名子文件夹" />
              <span className="text-muted-foreground">解压时新建同名子文件夹</span>
            </div>
          )}
        </div>

        {/* 压缩包备注 */}
        {archive.comment && (
          <div className="bg-foreground/[0.03] border-border/60 rounded-xl border px-3 py-2 text-xs">
            <span className="text-muted-foreground font-medium">压缩包备注：</span>
            <span className="whitespace-pre-wrap">{archive.comment}</span>
          </div>
        )}

        {/* 密码解锁条（存在加密条目时自动显现） */}
        {archive.encryptedCount > 0 && !verifiedPassword && (
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
                <KeyRound className="size-4" />
                此压缩包包含加密文件，请输入密码解锁：
              </div>
              <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                <input
                  ref={passwordInputRef}
                  type={showPassword ? 'text' : 'password'}
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value)
                    setPasswordError('')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleVerifyPassword()
                  }}
                  placeholder="输入解压密码后回车"
                  className="border-amber-500/40 bg-background/85 focus:border-primary w-full rounded-lg border py-1.5 pr-8 pl-3 text-xs outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
                  title={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
              <Button variant="primary" size="sm" onClick={handleVerifyPassword} disabled={checkingPassword}>
                {checkingPassword ? <Loader2 className="animate-spin" /> : <Unlock />}
                验证解锁
              </Button>
            </div>
            {passwordError && <div className="mt-1.5 text-xs text-red-500">{passwordError}</div>}
          </div>
        )}

        {archive.encryptedCount > 0 && verifiedPassword && (
          <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            <span className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="size-4" />
              密码已验证（仅保存在当前页面内存，刷新自动清除）
            </span>
            <button
              type="button"
              onClick={() => {
                setVerifiedPassword('')
                setPasswordInput('')
              }}
              className="underline hover:opacity-80"
            >
              重新输入
            </button>
          </div>
        )}

        {/* 解压 / 重打包实时进度条 */}
        {progress && (
          <div className="bg-primary/5 border-primary/25 space-y-2 rounded-xl border p-3.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-2 font-medium">
                <Loader2 className="text-primary size-3.5 animate-spin" />
                {extractModeLabel}（{progress.completedFiles} / {progress.totalFiles}）
              </span>
              <div className="flex items-center gap-2">
                <span className="font-mono">
                  {Math.min(100, Math.round((progress.completedBytes / Math.max(1, progress.totalBytes)) * 100))}%
                </span>
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="text-red-500 hover:underline"
                >
                  取消
                </button>
              </div>
            </div>
            <div className="bg-foreground/10 h-1.5 overflow-hidden rounded-full">
              <div
                className="bg-primary h-full transition-all duration-150"
                style={{
                  width: `${Math.min(100, Math.round((progress.completedBytes / Math.max(1, progress.totalBytes)) * 100))}%`,
                }}
              />
            </div>
            <div className="text-muted-foreground truncate font-mono text-[11px]">{progress.currentPath}</div>
          </div>
        )}
      </div>

      {/* 主体双栏资源管理器：左侧目录树 + 右侧文件列表 */}
      <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* 左侧文件夹树（桌面常驻，移动端收起为上方可滚动卡片） */}
        <aside className="glass shadow-soft flex max-h-[300px] flex-col overflow-hidden rounded-2xl lg:sticky lg:top-6 lg:max-h-[calc(100dvh-10rem)]">
          <div className="border-border/60 flex items-center justify-between border-b px-3.5 py-2.5 text-xs">
            <span className="text-foreground/80 font-semibold">目录结构</span>
            <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-[11px]">
              <input
                type="checkbox"
                checked={includeSubdirs}
                onChange={(e) => setIncludeSubdirs(e.target.checked)}
                className="accent-primary rounded"
              />
              含子目录
            </label>
          </div>
          <div className="flex-1 overflow-y-auto p-2">{folderTree && renderTreeNode(folderTree, 0)}</div>
        </aside>

        {/* 右侧文件清单 */}
        <section className="glass shadow-soft min-w-0 overflow-hidden rounded-2xl">
          {/* 路径面包屑 + 搜索 + 排序 */}
          <div className="border-border/60 space-y-3 border-b p-3.5 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setActiveDir('')
                    setQuery('')
                  }}
                  className={cn(
                    'rounded-md px-1.5 py-0.5 transition-colors',
                    !activeDir && !query ? 'bg-primary/12 text-primary font-semibold' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  根目录
                </button>
                {breadcrumbs.map((seg, i) => {
                  const target = breadcrumbs.slice(0, i + 1).join('/')
                  const isLast = i === breadcrumbs.length - 1
                  return (
                    <span key={target} className="inline-flex items-center gap-1">
                      <ChevronRight className="text-muted-foreground size-3.5" />
                      <button
                        type="button"
                        onClick={() => {
                          setActiveDir(target)
                          setQuery('')
                        }}
                        className={cn(
                          'max-w-[160px] truncate rounded-md px-1.5 py-0.5 transition-colors',
                          isLast && !query ? 'bg-primary/12 text-primary font-semibold' : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {seg}
                      </button>
                    </span>
                  )
                })}
                {query.trim() && (
                  <span className="text-muted-foreground ml-1 text-[11px]">
                    （全包搜索 “{query.trim()}”，共 {visibleItems.length} 项）
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortKey)}
                  className="border-border/70 bg-background/60 rounded-lg border px-2 py-1 text-xs outline-none"
                >
                  <option value="default">原包顺序</option>
                  <option value="name">按名称排序</option>
                  <option value="size-desc">按体积从大到小</option>
                  <option value="date-desc">按修改时间最新</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px] flex-1">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索压缩包内任意文件名或路径..."
                  className="border-border/70 bg-background/60 focus:border-primary w-full rounded-xl border py-1.5 pr-8 pl-8 text-xs outline-none"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-1">
                {TYPE_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setTypeFilter(f.id)}
                    className={cn(
                      'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                      typeFilter === f.id
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-foreground/[0.05] text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 批量勾选状态栏 */}
          <div className="bg-foreground/[0.025] border-border/60 flex items-center justify-between border-b px-3.5 py-2 text-xs">
            <label className="flex cursor-pointer items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAllVisible}
                className="accent-primary size-3.5 rounded"
              />
              <span className="text-muted-foreground">
                {selectedIds.size > 0
                  ? `已勾选 ${selectedIds.size} 个文件（${formatBytes(selectedItems.reduce((s, i) => s + i.uncompressedSize, 0))}）`
                  : `当前列表 ${visibleItems.length} 个文件`}
              </span>
            </label>
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-primary hover:underline"
              >
                取消全选
              </button>
            )}
          </div>

          {/* 文件条目列表 */}
          {visibleItems.length === 0 ? (
            <div className="text-muted-foreground flex min-h-[260px] flex-col items-center justify-center gap-2 p-8 text-center text-xs">
              <Archive className="size-8 opacity-40" />
              <div>当前目录或筛选条件下没有匹配的文件</div>
              {(query || typeFilter !== 'all') && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuery('')
                    setTypeFilter('all')
                  }}
                >
                  清除筛选条件
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-border/50 max-h-[65dvh] divide-y overflow-y-auto">
              {visibleItems.map((item) => {
                const checked = selectedIds.has(item.id)
                const showSubPath = Boolean(query.trim()) || (includeSubdirs && item.dir !== activeDir)
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'group flex items-center gap-3 px-3.5 py-2.5 text-xs transition-colors',
                      checked ? 'bg-primary/[0.06]' : 'hover:bg-foreground/[0.03]',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSelectOne(item.id)}
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                        checked
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background/60 hover:border-primary/60',
                      )}
                      aria-label={`选择 ${item.name}`}
                    >
                      {checked && <Check className="size-3 stroke-[3]" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => setPreviewItem(item)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <span className="shrink-0">{renderFileIcon(item.kind)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="group-hover:text-primary truncate font-medium transition-colors">
                            {item.name}
                          </span>
                          {item.encrypted && (
                            <Lock className="size-3 shrink-0 text-amber-500" />
                          )}
                        </span>
                        {showSubPath && item.dir && (
                          <span className="text-muted-foreground block truncate font-mono text-[10px]">
                            {item.dir}/
                          </span>
                        )}
                      </span>
                    </button>

                    <div className="text-muted-foreground hidden shrink-0 items-center gap-3 font-mono text-[11px] sm:flex">
                      <span className="w-18 text-right tabular-nums">{formatBytes(item.uncompressedSize)}</span>
                      {item.ratio > 0 ? (
                        <span className="w-11 rounded bg-emerald-500/10 px-1 py-0.5 text-center text-[10px] text-emerald-600 dark:text-emerald-400">
                          -{item.ratio}%
                        </span>
                      ) : (
                        <span className="w-11 text-center text-[10px] opacity-40">0%</span>
                      )}
                      <span className="hidden w-28 text-right xl:inline">{formatDateTime(item.lastModDate)}</span>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="在线预览"
                        onClick={() => setPreviewItem(item)}
                      >
                        <Eye className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="单独提取下载"
                        onClick={() => handleExtractSingle(item)}
                      >
                        <Download className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {/* 在线预览弹窗 */}
      <PreviewDrawer
        item={previewItem}
        password={activePassword}
        onClose={() => setPreviewItem(null)}
        onOpenNestedZip={handleOpenNestedZip}
        onRequestPassword={() => {
          setTimeout(() => passwordInputRef.current?.focus(), 60)
        }}
      />
    </div>
  )
}
