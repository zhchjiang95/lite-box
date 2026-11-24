import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeftRight,
  Binary,
  Check,
  Code2,
  Copy,
  Download,
  FileCode2,
  FileText,
  FileUp,
  Image as ImageIcon,
  Info,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { copyImageToClipboard, downloadBlob, timestampName } from '@/lib/file'
import { formatBytes } from '@/lib/utils'
import {
  base64ToBytes,
  bytesToBase64,
  decodeTextBase64,
  DEFAULT_TEXT_BASE64_OPTS,
  detectFileTypeFromBytes,
  encodeTextBase64,
  formatHexPreview,
  type DetectedFileType,
  type TextBase64Options,
} from './engine'

type ToolTab = 'text' | 'file-to-b64' | 'b64-to-file'
type TextDirection = 'encode' | 'decode'
type FileOutputSnippet = 'dataurl' | 'raw' | 'html' | 'css'

const SAMPLE_TEXT = '轻匣 LiteBox · 纯本地 Base64 编解码\n支持 UTF-8 中文、Emoji 🚀 与 URL-Safe 标准！'
const SAMPLE_SVG_B64 =
  'data:image/svg+xml;base64,' +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#4f46e5"/><stop offset="100%" stop-color="#06b6d4"/></linearGradient></defs>' +
      '<rect width="240" height="120" rx="20" fill="url(#g)"/>' +
      '<text x="120" y="68" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="24" font-weight="700">LiteBox</text>' +
      '</svg>',
  )

/** 大文本预览截断阈值（避免渲染百万字符卡死页面，复制与下载始终完整） */
const PREVIEW_CHAR_LIMIT = 120_000

interface EncodedFileState {
  name: string
  mime: string
  size: number
  isImage: boolean
  previewUrl: string
  rawBase64: string
  dataUrl: string
}

interface DecodedFileState {
  bytes: Uint8Array<ArrayBuffer>
  blob: Blob
  objectUrl: string
  detected: DetectedFileType
  textPreview?: string
  hexPreview: string
}

export default function Base64Tool() {
  const [tab, setTab] = useState<ToolTab>('text')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // ===== Tab 1：文本编解码 =====
  const [direction, setDirection] = useState<TextDirection>('encode')
  const [textInput, setTextInput] = useState(SAMPLE_TEXT)
  const [textOpts, setTextOpts] = useState<TextBase64Options>(DEFAULT_TEXT_BASE64_OPTS)

  // ===== Tab 2：文件转 Base64 =====
  const [encodedFile, setEncodedFile] = useState<EncodedFileState | null>(null)
  const [fileEncoding, setFileEncoding] = useState(false)
  const [snippetKind, setSnippetKind] = useState<FileOutputSnippet>('dataurl')

  // ===== Tab 3：Base64 还原文件 =====
  const [restoreInput, setRestoreInput] = useState('')
  const [restoreFilename, setRestoreFilename] = useState('restored')
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null)

  const copyText = async (text: string, key: string, label = '内容') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      toast.success(`已复制${label}（${formatBytes(new Blob([text]).size)}）`)
      setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500)
    } catch {
      toast.error('复制失败，文本可能过大，请改用「下载」')
    }
  }

  // ===== Tab 1 实时编解码计算 =====
  const textResult = useMemo(() => {
    if (!textInput) return { ok: true as const, output: '', inputBytes: 0, outputBytes: 0, nonUtf8Warning: false }
    try {
      if (direction === 'encode') {
        const res = encodeTextBase64(textInput, textOpts)
        return { ok: true as const, ...res, nonUtf8Warning: false }
      }
      const res = decodeTextBase64(textInput, { lineByLine: textOpts.lineByLine })
      return { ok: true as const, ...res }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : 'Base64 处理失败',
      }
    }
  }, [textInput, direction, textOpts])

  const handleSwapText = () => {
    if (!textResult.ok || !textResult.output) return
    setTextInput(textResult.output)
    setDirection((d) => (d === 'encode' ? 'decode' : 'encode'))
  }

  // ===== Tab 2 文件编码（并清理旧 previewUrl） =====
  const prevFileUrlRef = useRef<string | null>(null)
  useEffect(() => {
    const old = prevFileUrlRef.current
    if (old && old !== encodedFile?.previewUrl) URL.revokeObjectURL(old)
    prevFileUrlRef.current = encodedFile?.previewUrl ?? null
  }, [encodedFile])

  useEffect(() => {
    return () => {
      if (prevFileUrlRef.current) URL.revokeObjectURL(prevFileUrlRef.current)
    }
  }, [])

  const handleEncodeFiles = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    if (file.size > 30 * 1024 * 1024) {
      toast.error('文件超过 30MB，不建议直接转为 Base64（体积会膨胀约 33%）')
      return
    }
    setFileEncoding(true)
    try {
      const buf = await file.arrayBuffer()
      const bytes = new Uint8Array(buf)
      const mime = file.type || 'application/octet-stream'
      const rawBase64 = bytesToBase64(bytes)
      const dataUrl = `data:${mime};base64,${rawBase64}`
      const isImage = mime.startsWith('image/')
      const previewUrl = URL.createObjectURL(file)
      setEncodedFile({
        name: file.name || '剪贴板图片.png',
        mime,
        size: file.size,
        isImage,
        previewUrl,
        rawBase64,
        dataUrl,
      })
      toast.success(`编码完成：${file.name || '文件'}`)
    } catch {
      toast.error('读取文件失败')
    } finally {
      setFileEncoding(false)
    }
  }, [])

  const activeFileOutput = useMemo(() => {
    if (!encodedFile) return ''
    switch (snippetKind) {
      case 'raw':
        return encodedFile.rawBase64
      case 'html':
        return encodedFile.isImage
          ? `<img src="${encodedFile.dataUrl}" alt="${encodedFile.name.replace(/"/g, '&quot;')}" />`
          : `<a href="${encodedFile.dataUrl}" download="${encodedFile.name.replace(/"/g, '&quot;')}">下载 ${encodedFile.name}</a>`
      case 'css':
        return `background-image: url("${encodedFile.dataUrl}");`
      case 'dataurl':
      default:
        return encodedFile.dataUrl
    }
  }, [encodedFile, snippetKind])

  const isFileOutputTruncated = activeFileOutput.length > PREVIEW_CHAR_LIMIT
  const displayFileOutput = isFileOutputTruncated
    ? activeFileOutput.slice(0, PREVIEW_CHAR_LIMIT) + `\n\n…（为保证流畅仅展示前 ${PREVIEW_CHAR_LIMIT.toLocaleString()} 字符，点击「复制」或「下载」可获取完整内容）`
    : activeFileOutput

  // ===== Tab 3 Base64 还原为文件并管理 Blob URL 生命周期 =====
  const restored = useMemo<{ ok: true; data: DecodedFileState } | { ok: false; error: string; empty?: boolean }>(() => {
    if (!restoreInput.trim()) return { ok: false, error: '', empty: true }
    try {
      const { bytes, declaredMime } = base64ToBytes(restoreInput)
      if (bytes.byteLength === 0) return { ok: false, error: '', empty: true }
      const detected = detectFileTypeFromBytes(bytes, declaredMime)
      const blob = new Blob([bytes], { type: detected.mime })
      const objectUrl = URL.createObjectURL(blob)
      let textPreview: string | undefined
      if (detected.category === 'text') {
        textPreview = new TextDecoder('utf-8', { fatal: false }).decode(
          bytes.subarray(0, Math.min(bytes.length, 64_000)),
        )
      }
      return {
        ok: true,
        data: {
          bytes,
          blob,
          objectUrl,
          detected,
          textPreview,
          hexPreview: formatHexPreview(bytes, 128),
        },
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Base64 解码失败',
      }
    }
  }, [restoreInput])

  // 释放旧的还原 ObjectURL
  useEffect(() => {
    setImgDims(null)
    if (!restored.ok) return
    const url = restored.data.objectUrl
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [restored])

  const handleCopyRestoredImage = async () => {
    if (!restored.ok || restored.data.detected.category !== 'image') return
    try {
      if (restored.data.detected.mime === 'image/png') {
        await copyImageToClipboard(restored.data.blob)
      } else {
        // 非 PNG 图片先经 Canvas 转为 PNG 再写入剪贴板以获得最佳浏览器兼容性
        const bmp = await createImageBitmap(restored.data.blob)
        const canvas = document.createElement('canvas')
        canvas.width = bmp.width
        canvas.height = bmp.height
        canvas.getContext('2d')!.drawImage(bmp, 0, 0)
        bmp.close()
        const pngBlob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('转换失败'))), 'image/png'),
        )
        canvas.width = 0
        canvas.height = 0
        await copyImageToClipboard(pngBlob)
      }
      toast.success('已复制解码后的图片到剪贴板')
    } catch {
      toast.error('当前图片格式暂不支持直接复制，请点击下载')
    }
  }

  return (
    <div className="space-y-5">
      {/* 顶部三模式切换 */}
      <Segmented<ToolTab>
        value={tab}
        onChange={setTab}
        className="max-w-xl"
        options={[
          { value: 'text', label: '文本编解码', icon: <FileText /> },
          { value: 'file-to-b64', label: '图片 / 文件转 Base64', icon: <FileUp /> },
          { value: 'b64-to-file', label: 'Base64 还原文件', icon: <ImageIcon /> },
        ]}
      />

      {/* ================= 模式一：UTF-8 文本编解码 ================= */}
      {tab === 'text' && (
        <div className="space-y-4">
          {/* 顶部方向与选项条 */}
          <section className="glass shadow-soft flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented<TextDirection>
                size="sm"
                value={direction}
                onChange={setDirection}
                className="w-48"
                options={[
                  { value: 'encode', label: '编码 → Base64' },
                  { value: 'decode', label: '解码 → 原文' },
                ]}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!textResult.ok || !textResult.output}
                onClick={handleSwapText}
                title="把右侧输出放回左侧并切换编/解码方向"
              >
                <ArrowLeftRight className="!size-3.5" />
                互换方向
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
              {direction === 'encode' && (
                <>
                  <label className="flex items-center gap-1.5" title="RFC 4648 §5：+ 换 -、/ 换 _，适用于 URL 与 JWT">
                    <span className="text-muted-foreground">URL-Safe</span>
                    <Switch
                      checked={textOpts.urlSafe}
                      onChange={(v) => setTextOpts((p) => ({ ...p, urlSafe: v }))}
                      label="URL-Safe 编码"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">省略末尾 =</span>
                    <Switch
                      checked={textOpts.omitPadding}
                      onChange={(v) => setTextOpts((p) => ({ ...p, omitPadding: v }))}
                      label="省略填充等号"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">76 字符换行</span>
                    <Switch
                      checked={textOpts.wrap76}
                      onChange={(v) => setTextOpts((p) => ({ ...p, wrap76: v }))}
                      label="76字符折行"
                    />
                  </label>
                </>
              )}
              <label className="flex items-center gap-1.5">
                <span className="text-muted-foreground">逐行独立处理</span>
                <Switch
                  checked={textOpts.lineByLine}
                  onChange={(v) => setTextOpts((p) => ({ ...p, lineByLine: v }))}
                  label="逐行独立处理"
                />
              </label>
            </div>
          </section>

          {/* 双栏文本编辑器 */}
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="glass shadow-soft flex min-h-[380px] flex-col overflow-hidden rounded-2xl border">
              <div className="border-border/60 bg-foreground/[0.025] flex items-center justify-between border-b px-4 py-2.5 text-xs">
                <span className="font-semibold">
                  {direction === 'encode' ? '原始文本（UTF-8）' : 'Base64 编码字符串（兼容标准 / URL-Safe / DataURL）'}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setDirection('encode')
                      setTextInput(SAMPLE_TEXT)
                    }}
                  >
                    <Sparkles className="!size-3.5" />
                    示例
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 text-muted-foreground hover:text-rose-500"
                    onClick={() => setTextInput('')}
                    title="清空"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                spellCheck={false}
                placeholder={direction === 'encode' ? '输入任意中文、英文、JSON 或多行文本…' : '粘贴需要解码的 Base64 字符串…'}
                className="placeholder:text-muted-foreground/50 flex-1 resize-none bg-transparent p-4 font-mono text-sm leading-relaxed outline-none"
              />
              <div className="border-border/60 bg-foreground/[0.02] text-muted-foreground flex items-center justify-between border-t px-4 py-2 font-mono text-[11px]">
                <span>{textInput.length} 字符</span>
                <span>{formatBytes(textResult.ok ? textResult.inputBytes : new Blob([textInput]).size)}</span>
              </div>
            </section>

            <section className="glass shadow-soft flex min-h-[380px] flex-col overflow-hidden rounded-2xl border">
              <div className="border-border/60 bg-foreground/[0.025] flex items-center justify-between border-b px-4 py-2.5 text-xs">
                <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                  {direction === 'encode' ? 'Base64 编码结果' : 'UTF-8 解码结果'}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-xs"
                    disabled={!textResult.ok || !textResult.output}
                    onClick={() => textResult.ok && copyText(textResult.output, 'text-out', '结果')}
                  >
                    {copiedKey === 'text-out' ? <Check className="!size-3.5 text-emerald-500" /> : <Copy className="!size-3.5" />}
                    复制
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    disabled={!textResult.ok || !textResult.output}
                    onClick={() => {
                      if (!textResult.ok) return
                      downloadBlob(
                        new Blob([textResult.output], { type: 'text/plain;charset=utf-8' }),
                        timestampName(direction === 'encode' ? 'base64-encoded' : 'base64-decoded', 'txt'),
                      )
                    }}
                  >
                    <Download className="!size-3.5" />
                  </Button>
                </div>
              </div>

              {textResult.ok && textResult.nonUtf8Warning && (
                <div className="border-border/50 flex items-center justify-between gap-2 border-b bg-amber-500/[0.08] px-4 py-2 text-[11px] text-amber-800 dark:text-amber-300">
                  <span className="flex items-center gap-1.5">
                    <Info className="size-3.5 shrink-0" />
                    该 Base64 包含非 UTF-8 二进制数据，可能是一张图片或文件
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setRestoreInput(textInput)
                      setTab('b64-to-file')
                    }}
                    className="font-semibold underline"
                  >
                    切至「还原文件」预览 →
                  </button>
                </div>
              )}

              <div className="flex-1 overflow-auto p-4">
                {!textResult.ok ? (
                  <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/[0.06] p-3.5 text-xs text-rose-600 dark:text-rose-400">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>{textResult.error}</span>
                  </div>
                ) : !textResult.output ? (
                  <div className="text-muted-foreground/60 flex h-full min-h-[260px] items-center justify-center text-xs">
                    转换结果将在此实时显示
                  </div>
                ) : (
                  <pre className="font-mono text-sm leading-relaxed break-all whitespace-pre-wrap select-all">
                    {textResult.output}
                  </pre>
                )}
              </div>

              <div className="border-border/60 bg-foreground/[0.02] text-muted-foreground flex items-center justify-between border-t px-4 py-2 font-mono text-[11px]">
                <span>{textResult.ok ? `${textResult.output.length} 字符` : '解码异常'}</span>
                <span>
                  {textResult.ok && textResult.outputBytes > 0
                    ? `${formatBytes(textResult.outputBytes)}${
                        direction === 'encode' && textResult.inputBytes > 0
                          ? ` (+${Math.round(((textResult.outputBytes - textResult.inputBytes) / textResult.inputBytes) * 100)}%)`
                          : ''
                      }`
                    : '0 B'}
                </span>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* ================= 模式二：图片 / 任意文件转 Base64 ================= */}
      {tab === 'file-to-b64' && (
        <div className="space-y-4">
          <FileDropzone
            multiple={false}
            onFiles={handleEncodeFiles}
            title={fileEncoding ? '正在高速读取并编码…' : '拖放图片或任意文件到这里，或点击选择'}
            hint="支持直接 Ctrl / ⌘ + V 粘贴截图，本地生成 DataURL / 纯 Base64 / HTML <img> / CSS url()（单文件上限 30MB）"
            className="py-10 sm:py-12"
          />

          {encodedFile && (
            <section className="glass shadow-soft space-y-4 rounded-2xl p-5">
              {/* 文件概览卡 */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  {encodedFile.isImage ? (
                    <img
                      src={encodedFile.previewUrl}
                      alt={encodedFile.name}
                      className="checkerboard size-14 shrink-0 rounded-xl border object-contain p-1"
                    />
                  ) : (
                    <div className="bg-primary/10 text-primary flex size-14 shrink-0 items-center justify-center rounded-xl">
                      <Binary className="size-6" />
                    </div>
                  )}
                  <div className="min-w-0 space-y-0.5">
                    <div className="truncate text-sm font-semibold">{encodedFile.name}</div>
                    <div className="text-muted-foreground flex flex-wrap gap-2 font-mono text-xs">
                      <span>{encodedFile.mime}</span>
                      <span>·</span>
                      <span>原体积 {formatBytes(encodedFile.size)}</span>
                      <span>→</span>
                      <span className="text-foreground">Base64 {formatBytes(encodedFile.rawBase64.length)}</span>
                    </div>
                  </div>
                </div>

                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-rose-500"
                  onClick={() => setEncodedFile(null)}
                >
                  <Trash2 className="!size-3.5" />
                  移除
                </Button>
              </div>

              {/* 4 种输出代码片段切换 */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <Segmented<FileOutputSnippet>
                  size="sm"
                  value={snippetKind}
                  onChange={setSnippetKind}
                  className="max-w-md"
                  options={[
                    { value: 'dataurl', label: 'DataURL' },
                    { value: 'raw', label: '纯 Base64' },
                    { value: 'html', label: 'HTML 标签' },
                    { value: 'css', label: 'CSS url()' },
                  ]}
                />

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => copyText(activeFileOutput, 'file-b64', '完整编码')}
                  >
                    {copiedKey === 'file-b64' ? <Check className="!size-3.5" /> : <Copy className="!size-3.5" />}
                    复制完整内容
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      downloadBlob(
                        new Blob([activeFileOutput], { type: 'text/plain;charset=utf-8' }),
                        `${encodedFile.name}.base64.txt`,
                      )
                    }
                  >
                    <Download className="!size-3.5" />
                    下载 .txt
                  </Button>
                </div>
              </div>

              <pre className="border-border/70 bg-background/60 max-h-64 overflow-auto rounded-xl border p-3.5 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap select-all">
                {displayFileOutput}
              </pre>
            </section>
          )}
        </div>
      )}

      {/* ================= 模式三：Base64 还原为图片 / 文件 ================= */}
      {tab === 'b64-to-file' && (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* 左：输入 Base64 区域 */}
          <section className="glass shadow-soft flex min-h-[420px] flex-col overflow-hidden rounded-2xl border">
            <div className="border-border/60 bg-foreground/[0.025] flex items-center justify-between border-b px-4 py-2.5 text-xs">
              <span className="font-semibold">粘贴 DataURL 或纯 Base64（自动识别真实文件类型）</span>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => setRestoreInput(SAMPLE_SVG_B64)}
                >
                  <Sparkles className="!size-3.5" />
                  图片示例
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-rose-500"
                  onClick={() => setRestoreInput('')}
                  title="清空"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
            <textarea
              value={restoreInput}
              onChange={(e) => setRestoreInput(e.target.value)}
              spellCheck={false}
              placeholder="粘贴 data:image/png;base64,iVBORw0KGgo... 或不带前缀的纯 Base64，系统会通过文件头魔数自动识别 PNG / JPG / WebP / SVG / PDF / ZIP / MP3 等格式…"
              className="placeholder:text-muted-foreground/50 flex-1 resize-none bg-transparent p-4 font-mono text-xs leading-relaxed outline-none"
            />
          </section>

          {/* 右：魔数侦测结果、可视化预览与下载 */}
          <section className="glass shadow-soft flex min-h-[420px] flex-col justify-between gap-4 rounded-2xl border p-5">
            {!restored.ok ? (
              restored.empty ? (
                <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-center text-xs">
                  <FileCode2 className="size-10 opacity-25" />
                  <span>在左侧粘贴任意 Base64，自动预览图片/文档并支持一键下载还原</span>
                </div>
              ) : (
                <div className="flex items-start gap-2.5 rounded-2xl border border-rose-500/30 bg-rose-500/[0.06] p-4 text-xs text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <div className="font-semibold">无法解析 Base64</div>
                    <div className="mt-0.5">{restored.error}</div>
                  </div>
                </div>
              )
            ) : (
              <>
                <div className="space-y-4">
                  {/* 侦测元信息徽章 */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="bg-primary/12 text-primary rounded-full px-2.5 py-0.5 font-semibold">
                        {restored.data.detected.label}
                      </span>
                      <span className="bg-foreground/[0.06] text-muted-foreground rounded-full px-2.5 py-0.5 font-mono text-[11px]">
                        {restored.data.detected.mime}
                      </span>
                    </div>
                    <span className="text-muted-foreground font-mono">
                      {formatBytes(restored.data.bytes.byteLength)}
                      {imgDims ? ` · ${imgDims.w}×${imgDims.h}` : ''}
                    </span>
                  </div>

                  {/* 按文件类别展示原生预览 */}
                  {restored.data.detected.category === 'image' && (
                    <div className="checkerboard flex max-h-[280px] items-center justify-center overflow-hidden rounded-2xl border border-black/10 p-4 dark:border-white/10">
                      <img
                        src={restored.data.objectUrl}
                        alt="解码图片预览"
                        onLoad={(e) =>
                          setImgDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                        }
                        className="max-h-[248px] max-w-full rounded-lg object-contain shadow-sm"
                      />
                    </div>
                  )}

                  {restored.data.detected.category === 'pdf' && (
                    <iframe
                      src={restored.data.objectUrl}
                      title="PDF 预览"
                      className="h-[280px] w-full rounded-xl border bg-white"
                    />
                  )}

                  {restored.data.detected.category === 'audio' && (
                    <div className="bg-foreground/[0.03] flex items-center justify-center rounded-2xl border p-6">
                      <audio controls src={restored.data.objectUrl} className="w-full" />
                    </div>
                  )}

                  {restored.data.detected.category === 'video' && (
                    <video controls src={restored.data.objectUrl} className="max-h-[260px] w-full rounded-xl bg-black" />
                  )}

                  {restored.data.detected.category === 'text' && restored.data.textPreview !== undefined && (
                    <pre className="border-border/70 bg-background/60 max-h-[260px] overflow-auto rounded-xl border p-3.5 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
                      {restored.data.textPreview}
                    </pre>
                  )}

                  {restored.data.detected.category === 'binary' && (
                    <div className="space-y-1.5">
                      <div className="text-muted-foreground flex items-center gap-1 text-xs">
                        <Code2 className="size-3.5" />
                        <span>二进制文件头预览（前 128 字节 Hex Dump）</span>
                      </div>
                      <pre className="border-border/70 bg-background/60 max-h-[220px] overflow-auto rounded-xl border p-3 font-mono text-[11px] leading-relaxed">
                        {restored.data.hexPreview}
                      </pre>
                    </div>
                  )}
                </div>

                {/* 下载与快捷动作 */}
                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <div className="border-border/70 bg-background/60 flex min-w-[160px] flex-1 items-center rounded-xl border px-3 py-1.5 text-xs">
                    <input
                      type="text"
                      value={restoreFilename}
                      onChange={(e) => setRestoreFilename(e.target.value)}
                      className="min-w-0 flex-1 bg-transparent font-mono outline-none"
                      aria-label="下载文件名"
                    />
                    <span className="text-muted-foreground font-mono">.{restored.data.detected.ext}</span>
                  </div>

                  {restored.data.detected.category === 'image' && (
                    <Button size="sm" variant="outline" onClick={handleCopyRestoredImage}>
                      <Copy className="!size-3.5" />
                      复制图片
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      const clean = restoreFilename.trim() || 'restored'
                      downloadBlob(restored.data.blob, `${clean}.${restored.data.detected.ext}`)
                      toast.success(`已下载 ${clean}.${restored.data.detected.ext}`)
                    }}
                  >
                    <Download className="!size-3.5" />
                    下载还原文件
                  </Button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
