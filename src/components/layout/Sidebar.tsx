import { NavLink, useLocation } from 'react-router'
import { motion } from 'motion/react'
import { Home, Star, Search, PanelLeftClose, PanelLeftOpen, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { categories, tools } from '@/registry'
import { useSettings, useUI } from '@/stores/settings'
import { cn, isMac } from '@/lib/utils'
import { Logo } from '../Brand'
import { ThemeToggle } from '../ThemeToggle'
import { Kbd } from '../ui/kbd'
import { Tooltip } from '../ui/tooltip'

/** 统计每个分类的工具数 */
const counts = tools.reduce<Record<string, number>>((acc, t) => {
  acc[t.category] = (acc[t.category] ?? 0) + 1
  return acc
}, {})

function NavItem({
  to,
  icon,
  label,
  collapsed,
  extra,
  active,
}: {
  to: string
  icon: ReactNode
  label: string
  collapsed: boolean
  extra?: ReactNode
  active: boolean
}) {
  const link = (
    <NavLink
      to={to}
      viewTransition
      onClick={(e) => {
        // 已在当前页时避免重复触发路由转场动画
        if (active) e.preventDefault()
      }}
      className={cn(
        'relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]',
        collapsed && 'justify-center px-0',
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          className="bg-card-solid shadow-soft absolute inset-0 rounded-xl border"
          transition={{ type: 'spring', stiffness: 500, damping: 38 }}
        />
      )}
      <span className="relative z-10 flex shrink-0 items-center">{icon}</span>
      {!collapsed && <span className="relative z-10 flex-1 truncate">{label}</span>}
      {!collapsed && extra && <span className="relative z-10">{extra}</span>}
    </NavLink>
  )
  return collapsed ? (
    <Tooltip content={label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  )
}

/** 桌面端侧栏 */
export function Sidebar() {
  const collapsed = useSettings((s) => s.sidebarCollapsed)
  const toggle = useSettings((s) => s.toggleSidebar)
  const setCommandOpen = useUI((s) => s.setCommandOpen)
  const { pathname } = useLocation()

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 76 : 264 }}
      transition={{ type: 'spring', stiffness: 380, damping: 38 }}
      className="glass sticky top-0 z-30 hidden h-dvh shrink-0 flex-col border-y-0 border-l-0 lg:flex"
    >
      <div className={cn('flex h-16 items-center px-5', collapsed && 'justify-center px-0')}>
        <NavLink to="/" viewTransition>
          <Logo showText={!collapsed} />
        </NavLink>
      </div>

      <div className={cn('px-3 pb-2', collapsed && 'px-4')}>
        {(() => {
          const searchBtn = (
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              className={cn(
                'bg-foreground/[0.05] text-muted-foreground hover:bg-foreground/[0.08] flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-sm transition-colors',
                collapsed && 'justify-center px-0',
              )}
              aria-label="搜索工具"
            >
              <Search className="size-4 shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">搜索工具…</span>
                  <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
                  <Kbd>K</Kbd>
                </>
              )}
            </button>
          )
          return collapsed ? (
            <Tooltip content={`搜索工具 (${isMac ? '⌘K' : 'Ctrl+K'})`} side="right">
              {searchBtn}
            </Tooltip>
          ) : (
            searchBtn
          )
        })()}
      </div>

      <nav className={cn('no-scrollbar flex-1 space-y-1 overflow-y-auto px-3 py-2', collapsed && 'px-4')}>
        <NavItem to="/" icon={<Home className="size-[18px]" />} label="首页" collapsed={collapsed} active={pathname === '/'} />
        <NavItem
          to="/favorites"
          icon={<Star className="size-[18px]" />}
          label="收藏与最近"
          collapsed={collapsed}
          active={pathname === '/favorites'}
        />
        <div className={cn('text-muted-foreground px-3 pt-5 pb-2 text-xs font-medium', collapsed && 'px-0 text-center')}>
          {collapsed ? '·' : '工具分类'}
        </div>
        {categories.map((c) => (
          <NavItem
            key={c.id}
            to={`/category/${c.id}`}
            collapsed={collapsed}
            label={c.name}
            active={pathname === `/category/${c.id}`}
            icon={
              <span
                className="flex size-6 items-center justify-center rounded-md text-white"
                style={{ background: `linear-gradient(135deg, ${c.gradient[0]}, ${c.gradient[1]})` }}
              >
                <c.icon className="size-3.5" />
              </span>
            }
            extra={<span className="text-muted-foreground text-xs tabular-nums">{counts[c.id] ?? 0}</span>}
          />
        ))}
      </nav>

      <div className={cn('space-y-2 border-t p-3', collapsed && 'flex flex-col items-center px-3')}>
        {!collapsed && (
          <div className="flex items-start gap-2 rounded-xl bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            <span className="leading-relaxed">所有处理均在浏览器本地完成，文件不会上传到任何服务器。</span>
          </div>
        )}
        {/* 亮/暗/系统主题切换：展开时为三态分段条，收起时为单图标循环按钮 */}
        <ThemeToggle
          variant={collapsed ? 'icon' : 'segmented'}
          tooltipSide="right"
          className={collapsed ? 'h-9 w-full rounded-lg' : undefined}
        />
        {(() => {
          const toggleBtn = (
            <button
              type="button"
              onClick={toggle}
              className={cn(
                'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] flex h-9 w-full items-center gap-2 rounded-lg px-3 text-xs transition-colors',
                collapsed && 'justify-center px-0',
              )}
              aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
            >
              {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
              {!collapsed && '收起侧栏'}
            </button>
          )
          return collapsed ? (
            <Tooltip content="展开侧栏" side="right">
              {toggleBtn}
            </Tooltip>
          ) : (
            toggleBtn
          )
        })()}
      </div>
    </motion.aside>
  )
}

