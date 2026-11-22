import { AnimatePresence, motion } from 'motion/react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { flushSync } from 'react-dom'
import type { MouseEvent } from 'react'
import { useSettings, type Theme } from '@/stores/settings'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Tooltip } from './ui/tooltip'

export const themeOrder: Theme[] = ['light', 'dark', 'system']

export const themeMeta: Record<Theme, { icon: typeof Sun; label: string; shortLabel: string }> = {
  light: { icon: Sun, label: '亮色', shortLabel: '亮色' },
  dark: { icon: Moon, label: '暗色', shortLabel: '暗色' },
  system: { icon: Monitor, label: '跟随系统', shortLabel: '系统' },
}

/** 带圆形扩散 View Transitions 动效的主题切换 */
export function applyThemeWithTransition(next: Theme, e?: MouseEvent<HTMLElement>) {
  const { theme, setTheme } = useSettings.getState()
  if (theme === next) return

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!document.startViewTransition || reduce) {
    setTheme(next)
    return
  }

  const x = e ? e.clientX : innerWidth / 2
  const y = e ? e.clientY : innerHeight / 2
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  const root = document.documentElement
  root.classList.add('theme-vt')

  const vt = document.startViewTransition(() => {
    flushSync(() => setTheme(next))
    // 同步应用 class，确保快照正确
    const dark = next === 'dark' || (next === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    root.classList.toggle('dark', dark)
  })
  vt.finished.finally(() => root.classList.remove('theme-vt'))
  vt.ready.then(() => {
    root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 520, easing: 'cubic-bezier(.3,.8,.2,1)', pseudoElement: '::view-transition-new(root)' },
    )
  })
}

/** 获取下一个循环主题 */
export function getNextTheme(current: Theme): Theme {
  return themeOrder[(themeOrder.indexOf(current) + 1) % themeOrder.length]
}

interface ThemeToggleProps {
  /** segmented：三态分段切换器（侧栏展开态）；icon：单图标循环按钮（侧栏收起态） */
  variant?: 'segmented' | 'icon'
  /** Tooltip 弹出方向 */
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
}

/** 主题切换器：亮色 / 暗色 / 跟随系统，切换时从点击处圆形扩散 */
export function ThemeToggle({ variant = 'icon', tooltipSide = 'right', className }: ThemeToggleProps) {
  const theme = useSettings((s) => s.theme)
  const next = getNextTheme(theme)
  const Icon = themeMeta[theme].icon

  if (variant === 'segmented') {
    return (
      <div
        role="radiogroup"
        aria-label="外观主题"
        className={cn('bg-foreground/[0.05] grid grid-cols-3 rounded-xl p-1', className)}
      >
        {themeOrder.map((t) => {
          const active = theme === t
          const ItemIcon = themeMeta[t].icon
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={(e) => applyThemeWithTransition(t, e)}
              className={cn(
                'relative flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors',
                active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-theme-active"
                  className="bg-card-solid shadow-soft absolute inset-0 rounded-lg border"
                  transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                />
              )}
              <ItemIcon className="relative z-10 size-3.5 shrink-0" />
              <span className="relative z-10">{themeMeta[t].shortLabel}</span>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <Tooltip content={`主题：${themeMeta[theme].label}（点击切换为${themeMeta[next].label}）`} side={tooltipSide}>
      <Button
        variant="ghost"
        size="icon"
        onClick={(e) => applyThemeWithTransition(next, e)}
        aria-label="切换主题"
        className={cn('overflow-hidden', className)}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={theme}
            initial={{ y: 14, opacity: 0, rotate: -90 }}
            animate={{ y: 0, opacity: 1, rotate: 0 }}
            exit={{ y: -14, opacity: 0, rotate: 90 }}
            transition={{ duration: 0.22 }}
          >
            <Icon className="size-[18px]" />
          </motion.span>
        </AnimatePresence>
      </Button>
    </Tooltip>
  )
}
