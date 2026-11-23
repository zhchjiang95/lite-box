import { Check, Mail } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Tooltip } from './ui/tooltip'

export const AUTHOR_INFO = {
  githubUrl: 'https://github.com/zhchjiang95/lite-box',
  githubRepo: 'zhchjiang95/lite-box',
  wechatOfficial: 'Slothful',
  email: 'i@fiume.cn',
} as const

/** 简洁 GitHub 矢量图标 */
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.76 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.58.23 2.75.11 3.04.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  )
}

/** 简洁微信公众号矢量图标 */
function WeChatIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M9.5 4C5.36 4 2 6.82 2 10.3c0 1.98 1.09 3.74 2.79 4.9l-.7 2.12 2.46-1.23c.91.28 1.9.43 2.95.43.25 0 .5-.01.74-.04a5.4 5.4 0 0 1-.24-1.58c0-3.22 2.98-5.82 6.66-5.82.22 0 .44.01.66.03C16.71 6.18 13.43 4 9.5 4Zm-2.55 4.9a.95.95 0 1 1 0-1.9.95.95 0 0 1 0 1.9Zm5.1 0a.95.95 0 1 1 0-1.9.95.95 0 0 1 0 1.9ZM16.66 10.2c-3.17 0-5.74 2.16-5.74 4.82 0 2.66 2.57 4.82 5.74 4.82.78 0 1.52-.13 2.2-.36l1.94.97-.55-1.67c1.31-.89 2.15-2.24 2.15-3.76 0-2.66-2.57-4.82-5.74-4.82Zm-1.92 3.87a.78.78 0 1 1 0-1.56.78.78 0 0 1 0 1.56Zm3.84 0a.78.78 0 1 1 0-1.56.78.78 0 0 1 0 1.56Z" />
    </svg>
  )
}

function useCopyWeChat() {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(AUTHOR_INFO.wechatOfficial)
      setCopied(true)
      toast.success(`已复制公众号「${AUTHOR_INFO.wechatOfficial}」，打开微信搜索即可关注`)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.info(`微信公众号：${AUTHOR_INFO.wechatOfficial}`)
    }
  }
  return { copied, copy }
}

/** 桌面侧栏底部精简作者入口（展开显示 GitHub + 公众号，收起显示 GitHub 图标） */
export function SidebarAuthorBar({ collapsed }: { collapsed: boolean }) {
  const { copied, copy } = useCopyWeChat()

  if (collapsed) {
    return (
      <Tooltip content="GitHub · zhchjiang95/lite-box" side="right">
        <a
          href={AUTHOR_INFO.githubUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="访问 GitHub 仓库"
          className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] flex h-9 w-full items-center justify-center rounded-lg transition-colors"
        >
          <GitHubIcon className="size-4" />
        </a>
      </Tooltip>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-1.5">
      <a
        href={AUTHOR_INFO.githubUrl}
        target="_blank"
        rel="noreferrer"
        title="查看开源仓库"
        className="text-muted-foreground hover:text-foreground bg-foreground/[0.04] hover:bg-foreground/[0.08] flex h-8 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors"
      >
        <GitHubIcon className="size-3.5 shrink-0" />
        <span>GitHub</span>
      </a>
      <button
        type="button"
        onClick={() => void copy()}
        title="点击复制公众号名称"
        className="text-muted-foreground hover:text-foreground bg-foreground/[0.04] hover:bg-foreground/[0.08] flex h-8 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors"
      >
        {copied ? (
          <Check className="size-3.5 shrink-0 text-emerald-500" />
        ) : (
          <WeChatIcon className="size-3.5 shrink-0 text-emerald-500" />
        )}
        <span className="truncate">{copied ? '已复制' : AUTHOR_INFO.wechatOfficial}</span>
      </button>
    </div>
  )
}

/** 首页底部精致页脚（桌面与移动端均完整展示 GitHub、公众号与联系邮箱） */
export function SiteFooter({ className }: { className?: string }) {
  const { copied, copy } = useCopyWeChat()

  return (
    <footer className={cn('mt-16 border-t pt-8 pb-4', className)}>
      <div className="flex flex-col items-center justify-between gap-4 text-xs sm:flex-row">
        <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-2 gap-y-1 sm:justify-start">
          <span className="text-foreground/85 font-semibold">轻匣 · LiteBox</span>
          <span className="opacity-40">·</span>
          <span>开源免费，数据本地处理</span>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <a
            href={AUTHOR_INFO.githubUrl}
            target="_blank"
            rel="noreferrer"
            className="glass text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-medium transition hover:border-foreground/20"
          >
            <GitHubIcon className="size-3.5" />
            <span>GitHub</span>
          </a>

          <button
            type="button"
            onClick={() => void copy()}
            title="点击复制公众号名称"
            className="glass text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-medium transition hover:border-emerald-500/35"
          >
            {copied ? (
              <Check className="size-3.5 text-emerald-500" />
            ) : (
              <WeChatIcon className="size-3.5 text-emerald-500" />
            )}
            <span>公众号：{AUTHOR_INFO.wechatOfficial}</span>
          </button>

          <a
            href={`mailto:${AUTHOR_INFO.email}`}
            className="glass text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-medium transition hover:border-foreground/20"
          >
            <Mail className="size-3.5" />
            <span>{AUTHOR_INFO.email}</span>
          </a>
        </div>
      </div>
    </footer>
  )
}
