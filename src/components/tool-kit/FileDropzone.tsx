import { motion, AnimatePresence } from 'motion/react'
import { ImagePlus, UploadCloud } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface DropzoneProps {
  onFiles: (files: File[]) => void
  accept?: string
  multiple?: boolean
  /** 是否监听全局粘贴（Ctrl/⌘ + V） */
  pasteable?: boolean
  /** 紧凑模式：用于“继续添加” */
  compact?: boolean
  title?: ReactNode
  hint?: ReactNode
  className?: string
}

/** 过滤 accept 规则 */
function matchAccept(file: File, accept?: string) {
  if (!accept) return true
  return accept.split(',').some((rule) => {
    const r = rule.trim()
    if (r.endsWith('/*')) return file.type.startsWith(r.slice(0, -1))
    if (r.startsWith('.')) return file.name.toLowerCase().endsWith(r.toLowerCase())
    return file.type === r
  })
}

/** 通用文件输入：拖放 / 点击选择 / 粘贴 */
export function FileDropzone({
  onFiles,
  accept,
  multiple = true,
  pasteable = true,
  compact,
  title = '拖放文件到这里，或点击选择',
  hint,
  className,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  const emit = (list: FileList | File[] | null | undefined) => {
    if (!list) return
    const files = Array.from(list).filter((f) => matchAccept(f, accept))
    if (files.length) onFiles(multiple ? files : files.slice(0, 1))
  }

  // 全局粘贴
  useEffect(() => {
    if (!pasteable) return
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement
      if (/INPUT|TEXTAREA/.test(el.tagName) || el.isContentEditable) return
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length) {
        e.preventDefault()
        emit(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasteable, onFiles, accept, multiple])

  const handlers = {
    onDragEnter: (e: DragEvent) => {
      e.preventDefault()
      depth.current++
      setOver(true)
    },
    onDragOver: (e: DragEvent) => e.preventDefault(),
    onDragLeave: (e: DragEvent) => {
      e.preventDefault()
      depth.current--
      if (depth.current <= 0) setOver(false)
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      depth.current = 0
      setOver(false)
      emit(e.dataTransfer.files)
    },
  }

  const input = (
    <input
      ref={inputRef}
      type="file"
      hidden
      accept={accept}
      multiple={multiple}
      onChange={(e) => {
        emit(e.target.files)
        e.target.value = ''
      }}
    />
  )

  if (compact) {
    return (
      <button
        type="button"
        {...handlers}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'text-muted-foreground hover:text-primary hover:border-primary/50 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed py-3 text-sm transition-colors',
          over && 'border-primary text-primary bg-primary/5',
          className,
        )}
      >
        <ImagePlus className="size-4" />
        {title}
        {input}
      </button>
    )
  }

  return (
    <motion.button
      type="button"
      {...handlers}
      onClick={() => inputRef.current?.click()}
      animate={over ? { scale: 1.015 } : { scale: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={cn(
        'group bg-card relative flex w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl border-2 border-dashed px-6 py-14 text-center backdrop-blur-xl transition-colors sm:py-20',
        over ? 'border-primary bg-primary/[0.06]' : 'hover:border-primary/50',
        className,
      )}
    >
      {/* 拖入时的呼吸光晕 */}
      <AnimatePresence>
        {over && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.4, 0.8, 0.4] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.6, repeat: Infinity }}
            className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(circle at 50% 50%, color-mix(in oklch, var(--primary) 18%, transparent), transparent 70%)' }}
          />
        )}
      </AnimatePresence>
      <motion.div
        animate={over ? { y: -6, rotate: -6 } : { y: 0, rotate: 0 }}
        className="relative flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] text-white shadow-[0_12px_30px_-10px_var(--primary)] transition-transform group-hover:-translate-y-1"
      >
        <UploadCloud className="size-8" />
      </motion.div>
      <div className="relative space-y-1.5">
        <div className="text-base font-semibold">{over ? '松手即可添加' : title}</div>
        <div className="text-muted-foreground text-sm">{hint ?? '也可以直接 Ctrl / ⌘ + V 粘贴'}</div>
      </div>
      {input}
    </motion.button>
  )
}

