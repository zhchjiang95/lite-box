import { NavLink, useLocation } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { Home, LayoutGrid, Search, Star } from 'lucide-react'
import { useSettings, useUI } from '@/stores/settings'
import { cn } from '@/lib/utils'
import { applyThemeWithTransition, getNextTheme, themeMeta } from '../ThemeToggle'

const tabs = [
  { to: '/', label: '首页', icon: Home },
  { to: '/categories', label: '分类', icon: LayoutGrid },
  { to: '__search', label: '搜索', icon: Search },
  { to: '/favorites', label: '收藏', icon: Star },
]

/** 移动端底部导航（包含主题切换入口） */
export function MobileNav() {
  const { pathname } = useLocation()
  const setCommandOpen = useUI((s) => s.setCommandOpen)
  const theme = useSettings((s) => s.theme)
  const nextTheme = getNextTheme(theme)
  const ThemeIcon = themeMeta[theme].icon

  const isActive = (to: string) =>
    to === '/' ? pathname === '/' : to === '/categories' ? pathname.startsWith('/categor') : pathname === to

  // 工具页使用自己的底部操作栏，隐藏全局导航以腾出空间
  if (pathname.startsWith('/tools/')) return null

  return (
    <nav className="glass pb-safe fixed inset-x-0 bottom-0 z-30 border-x-0 border-b-0 lg:hidden">
      <div className="mx-auto grid h-16 max-w-lg grid-cols-5">
        {tabs.map((t) => {
          const active = isActive(t.to)
          const inner = (
            <>
              {active && (
                <motion.span
                  layoutId="mobile-tab"
                  className="bg-primary/12 absolute top-1.5 h-8 w-12 rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <t.icon className={cn('relative size-5 transition-transform', active && 'scale-110')} strokeWidth={active ? 2.4 : 2} />
              <span className="relative text-[11px] font-medium">{t.label}</span>
            </>
          )
          const cls = cn(
            'relative flex flex-col items-center justify-center gap-1 pt-1 transition-colors active:scale-95',
            active ? 'text-primary' : 'text-muted-foreground',
          )
          return t.to === '__search' ? (
            <button key={t.to} type="button" className={cls} onClick={() => setCommandOpen(true)}>
              {inner}
            </button>
          ) : (
            <NavLink key={t.to} to={t.to} viewTransition className={cls}>
              {inner}
            </NavLink>
          )
        })}

        {/* 移动端主题循环切换 */}
        <button
          type="button"
          onClick={(e) => applyThemeWithTransition(nextTheme, e)}
          aria-label={`当前${themeMeta[theme].label}主题，点击切换为${themeMeta[nextTheme].label}`}
          className="text-muted-foreground relative flex flex-col items-center justify-center gap-1 pt-1 transition-colors active:scale-95"
        >
          <span className="relative flex size-5 items-center justify-center overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={theme}
                initial={{ y: 12, opacity: 0, rotate: -60 }}
                animate={{ y: 0, opacity: 1, rotate: 0 }}
                exit={{ y: -12, opacity: 0, rotate: 60 }}
                transition={{ duration: 0.2 }}
              >
                <ThemeIcon className="size-5" strokeWidth={2} />
              </motion.span>
            </AnimatePresence>
          </span>
          <span className="relative text-[11px] font-medium">{themeMeta[theme].shortLabel}</span>
        </button>
      </div>
    </nav>
  )
}
