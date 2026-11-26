import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertCircle,
  Braces,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  FolderArchive,
  Image as ImageIcon,
  Loader2,
  Lock,
  Music,
  Video,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { copyImageToClipboard, downloadBlob } from '@/lib/file'
import { decodeImageFile } from '@/lib/image'
import { cn, formatBytes } from '@/lib/utils'
import {
  extractItemToBlob,
  extractItemToText,
  formatDateTime,
  formatHexPreview,
  type ZipItem,
} from './engine'

interface PreviewDrawerProps {
  item: ZipItem | null
  password: string
  onClose: () => void
  onOpenNestedZip: (blob: Blob, filename: string) => void
  onRequestPassword: () => void
}

type TextEncodingMode = 'auto' | 'utf-8' | 'gb18030'

interface LoadedPreview {
  blob: Blob
  blobUrl?: string
  text?: string
  highlightedHtml?: string
  detectedEncoding?: string
  truncated?: boolean
  hexPreview?: string
}

/** 扩展名映射到 highlight.js 语言名 */
function resolveHljsLang(ext: string): string | undefined {
  const map: Record<string, string> = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    mts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    json: 'json',
    jsonc: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    xml: 'xml',
    html: 'xml',
    htm: 'xml',
    svg: 'xml',
    css: 'css',
    scss: 'scss',
    less: 'less',
    md: 'markdown',
    markdown: 'markdown',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    sql: 'sql',
    java: 'java',
    kt: 'kotlin',
    go: 'go',
    rs: 'rust',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    rb: 'ruby',
    swift: 'swift',
    ini: 'ini',
    toml: 'ini',
    dockerfile: 'dockerfile',
    makefile: 'makefile',
  }
  return map[ext]
}

export function PreviewDrawer({
  item,
  password,
  onClose,
  onOpenNestedZip,
  onRequestPassword,
}: PreviewDrawerProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<LoadedPreview | null>(null)
  const [textEncoding, setTextEncoding] = useState<TextEncodingMode>('auto')
  const [prettyJson, setPrettyJson] = useState(false)
  const [copied, setCopied] = useState(false)
  const [wrapLines, setWrapLines] = useState(true)

  // 按 ESC 快速关闭预览浮层
  useEffect(() => {
    if (!item) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, onClose])

  // 切换文件时重置局部查看选项
  useEffect(() => {
    setTextEncoding('auto')
    setPrettyJson(false)
    setCopied(false)
  }, [item?.id])

  // 解压并加载预览内容
  useEffect(() => {
    if (!item) {
      setPreview(null)
      setError(null)
      return
    }

    let cancelled = false
    let createdUrl: string | undefined

    const load = async () => {
      setLoading(true)
      setError(null)
      setPreview(null)

      try {
        if (item.kind === 'text') {
          const { text, truncated, detectedEncoding } = await extractItemToText(item, password, textEncoding)
          if (cancelled) return

          let displayText = text
          if (prettyJson && (item.ext === 'json' || item.ext === 'jsonc')) {
            try {
              displayText = JSON.stringify(JSON.parse(text), null, 2)
            } catch {
              // JSON 格式不合法时原样展示
            }
          }

          let highlightedHtml: string | undefined
          if (displayText.length <= 200_000) {
            try {
              const hljs = (await import('highlight.js/lib/common')).default
              const lang = resolveHljsLang(item.ext)
              if (lang && hljs.getLanguage(lang)) {
                highlightedHtml = hljs.highlight(displayText, { language: lang }).value
              }
            } catch {
              // 高亮失败自动回退纯文本
            }
          }

          const blob = new Blob([text], { type: item.mime })
          if (!cancelled) {
            setPreview({ blob, text: displayText, highlightedHtml, detectedEncoding, truncated })
          }
          return
        }

        const blob = await extractItemToBlob(item, password)
        if (cancelled) return

        if (item.kind === 'image') {
          if (item.ext === 'heic' || item.ext === 'heif') {
            const file = new File([blob], item.name, { type: item.mime })
            const decoded = await decodeImageFile(file)
            decoded.bitmap.close()
            createdUrl = decoded.previewUrl
          } else {
            createdUrl = URL.createObjectURL(blob)
          }
          if (!cancelled) setPreview({ blob, blobUrl: createdUrl })
          return
        }

        if (item.kind === 'pdf' || item.kind === 'audio' || item.kind === 'video') {
          createdUrl = URL.createObjectURL(blob)
          if (!cancelled) setPreview({ blob, blobUrl: createdUrl })
          return
        }

        if (item.kind === 'zip') {
          if (!cancelled) setPreview({ blob })
          return
        }

        // 其他二进制 / Office 文件展示前 256 字节 Hex 头信息
        const headBytes = new Uint8Array(await blob.slice(0, 256).arrayBuffer())
        const hexPreview = formatHexPreview(headBytes, 256)
        if (!cancelled) setPreview({ blob, hexPreview })
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '预览加载失败')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [item, password, textEncoding, prettyJson])

  if (!item) return null

  const handleDownload = async () => {
    try {
      const blob = preview?.blob ?? (await extractItemToBlob(item, password))
      downloadBlob(blob, item.name)
      toast.success(`已提取「${item.name}」`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提取失败')
    }
  }

  const handleCopyContent = async () => {
    if (!preview) return
    try {
      if (item.kind === 'text' && preview.text !== undefined) {
        await navigator.clipboard.writeText(preview.text)
        setCopied(true)
        toast.success('已复制文本内容')
        setTimeout(() => setCopied(false), 1600)
      } else if (item.kind === 'image' && preview.blob) {
        // 统一转为 PNG 写入剪贴板以提高兼容性
        const pngBlob = preview.blob.type === 'image/png' ? preview.blob : await imageBlobToPng(preview.blob)
        await copyImageToClipboard(pngBlob)
        setCopied(true)
        toast.success('已复制图片到剪贴板')
        setTimeout(() => setCopied(false), 1600)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制失败')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        className="bg-card-solid border-border shadow-2xl flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏 */}
        <div className="border-border/70 flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl">
              {item.kind === 'image' && <ImageIcon className="size-4.5" />}
              {item.kind === 'text' && <FileCode2 className="size-4.5" />}
              {item.kind === 'pdf' && <FileText className="size-4.5" />}
              {item.kind === 'audio' && <Music className="size-4.5" />}
              {item.kind === 'video' && <Video className="size-4.5" />}
              {item.kind === 'zip' && <FolderArchive className="size-4.5" />}
              {(item.kind === 'binary' || item.kind === 'office') && <FileText className="size-4.5" />}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold">{item.name}</span>
                {item.encrypted && (
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                    <Lock className="size-2.5" />
                    加密
                  </span>
                )}
              </div>
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[11px]">
                <span className="truncate">{item.path}</span>
                <span>·</span>
                <span>{formatBytes(item.uncompressedSize)}</span>
                {item.lastModDate && (
                  <>
                    <span>·</span>
                    <span>{formatDateTime(item.lastModDate)}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {(item.kind === 'text' || item.kind === 'image') && preview && (
              <Button variant="outline" size="sm" onClick={handleCopyContent}>
                {copied ? <Check className="text-emerald-500" /> : <Copy />}
                <span className="hidden sm:inline">{copied ? '已复制' : '复制'}</span>
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={handleDownload}>
              <Download />
              <span className="hidden sm:inline">提取文件</span>
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onClose} title="关闭 (ESC)">
              <X />
            </Button>
          </div>
        </div>

        {/* 文本模式专属工具栏 */}
        {item.kind === 'text' && !error && (
          <div className="bg-foreground/[0.03] border-border/60 flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">文本编码</span>
              <div className="w-44">
                <Segmented<TextEncodingMode>
                  size="sm"
                  value={textEncoding}
                  onChange={setTextEncoding}
                  options={[
                    { value: 'auto', label: '自动' },
                    { value: 'utf-8', label: 'UTF-8' },
                    { value: 'gb18030', label: 'GBK' },
                  ]}
                />
              </div>
              {preview?.detectedEncoding && (
                <span className="text-muted-foreground hidden font-mono text-[11px] sm:inline">
                  当前：{preview.detectedEncoding}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {(item.ext === 'json' || item.ext === 'jsonc') && (
                <Button
                  variant={prettyJson ? 'primary' : 'outline'}
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setPrettyJson((v) => !v)}
                >
                  <Braces className="size-3.5" />
                  格式化 JSON
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => setWrapLines((v) => !v)}
              >
                {wrapLines ? '自动换行：开' : '自动换行：关'}
              </Button>
            </div>
          </div>
        )}

        {/* 主预览内容区 */}
        <div className="flex-1 overflow-auto p-4 sm:p-5">
          {loading ? (
            <div className="text-muted-foreground flex min-h-[260px] flex-col items-center justify-center gap-2.5 text-sm">
              <Loader2 className="text-primary size-7 animate-spin" />
              <span>正在本地解密与读取内容...</span>
            </div>
          ) : error ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
                <AlertCircle className="size-6" />
              </div>
              <div className="max-w-md space-y-1">
                <div className="text-sm font-semibold">无法预览该文件</div>
                <p className="text-muted-foreground text-xs leading-relaxed">{error}</p>
              </div>
              {item.encrypted && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    onClose()
                    onRequestPassword()
                  }}
                >
                  <Lock />
                  前往输入解压密码
                </Button>
              )}
            </div>
          ) : preview ? (
            <>
              {item.kind === 'image' && preview.blobUrl && (
                <div className="checkerboard flex min-h-[300px] items-center justify-center rounded-xl border p-4">
                  <img
                    src={preview.blobUrl}
                    alt={item.name}
                    className="max-h-[65dvh] max-w-full rounded-lg object-contain shadow-sm"
                  />
                </div>
              )}

              {item.kind === 'text' && preview.text !== undefined && (
                <div className="space-y-2">
                  {preview.truncated && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                      文件超过 2 MB，当前仅预览前 2 MB 内容，点击右上角「提取文件」可下载完整原件。
                    </div>
                  )}
                  <pre
                    className={cn(
                      'bg-foreground/[0.04] border-border/60 rounded-xl border p-4 font-mono text-xs leading-relaxed',
                      wrapLines ? 'break-all whitespace-pre-wrap' : 'overflow-x-auto whitespace-pre',
                    )}
                  >
                    {preview.highlightedHtml ? (
                      <code className="hljs" dangerouslySetInnerHTML={{ __html: preview.highlightedHtml }} />
                    ) : (
                      <code>{preview.text}</code>
                    )}
                  </pre>
                </div>
              )}

              {item.kind === 'pdf' && preview.blobUrl && (
                <div className="space-y-2.5">
                  <div className="flex justify-end">
                    <a
                      href={preview.blobUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
                    >
                      <ExternalLink className="size-3.5" />
                      在新标签页全屏打开 PDF
                    </a>
                  </div>
                  <iframe
                    src={preview.blobUrl}
                    title={item.name}
                    className="h-[68dvh] w-full rounded-xl border bg-white"
                  />
                </div>
              )}

              {item.kind === 'audio' && preview.blobUrl && (
                <div className="bg-foreground/[0.03] flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-xl border p-6">
                  <div className="bg-primary/10 text-primary flex size-16 items-center justify-center rounded-2xl">
                    <Music className="size-8" />
                  </div>
                  <div className="text-sm font-medium">{item.name}</div>
                  <audio src={preview.blobUrl} controls className="w-full max-w-md" />
                </div>
              )}

              {item.kind === 'video' && preview.blobUrl && (
                <div className="flex items-center justify-center rounded-xl bg-black/90 p-2">
                  <video src={preview.blobUrl} controls className="max-h-[65dvh] max-w-full rounded-lg" />
                </div>
              )}

              {item.kind === 'zip' && (
                <div className="flex min-h-[240px] flex-col items-center justify-center gap-4 text-center">
                  <div className="bg-primary/10 text-primary flex size-16 items-center justify-center rounded-2xl">
                    <FolderArchive className="size-8" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-base font-semibold">检测到嵌套 ZIP 压缩包</div>
                    <p className="text-muted-foreground text-xs">
                      你可以直接原地打开并浏览里面的目录文件，或将其提取到本地。
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      onClick={() => {
                        onOpenNestedZip(preview.blob, item.name)
                        onClose()
                      }}
                    >
                      <FolderArchive />
                      直接打开此嵌套压缩包
                    </Button>
                    <Button variant="outline" onClick={handleDownload}>
                      <Download />
                      单独下载
                    </Button>
                  </div>
                </div>
              )}

              {(item.kind === 'binary' || item.kind === 'office') && (
                <div className="space-y-4">
                  <div className="grid gap-2.5 text-xs sm:grid-cols-3">
                    <div className="bg-foreground/[0.03] rounded-xl border p-3">
                      <div className="text-muted-foreground">原始体积 / 压缩后</div>
                      <div className="mt-1 font-mono font-semibold">
                        {formatBytes(item.uncompressedSize)} / {formatBytes(item.compressedSize)}
                      </div>
                    </div>
                    <div className="bg-foreground/[0.03] rounded-xl border p-3">
                      <div className="text-muted-foreground">空间节省率</div>
                      <div className="mt-1 font-mono font-semibold">{item.ratio}%</div>
                    </div>
                    <div className="bg-foreground/[0.03] rounded-xl border p-3">
                      <div className="text-muted-foreground">CRC32 校验码</div>
                      <div className="mt-1 font-mono font-semibold">0x{item.crc32Hex}</div>
                    </div>
                  </div>

                  {preview.hexPreview && (
                    <div className="space-y-1.5">
                      <div className="text-muted-foreground text-xs font-medium">
                        文件头十六进制预览（前 256 字节）
                      </div>
                      <pre className="bg-foreground/[0.04] border-border/60 overflow-x-auto rounded-xl border p-3.5 font-mono text-[11px] leading-relaxed">
                        {preview.hexPreview}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** 辅助：将任意图片 Blob 转为 PNG 以便剪贴板写入 */
async function imageBlobToPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片转换失败'))), 'image/png'),
    )
  } finally {
    bitmap.close()
  }
}
