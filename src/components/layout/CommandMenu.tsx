import { Command } from 'cmdk'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Clock3, CornerDownLeft, Search, History, Star, LayoutGrid, Moon, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { categories, getTool, preloadTool, tools, type PlannedTool, type ToolDefinition } from '@/registry'
import { ensurePinyinIndex, searchPlannedTools, searchTools } from '@/lib/search'
import { useSettings, useUI } from '@/stores/settings'
import { useHotkey } from '@/hooks'
import { ToolIcon } from '../ToolIcon'
import { Kbd } from '../ui/kbd'
import { categoryMap } from '@/registry/categories'

/** 全局命令面板：⌘K / Ctrl+K / “/” 唤起，支持拼音搜索 */
export function CommandMenu() {
  const open = useUI((s) => s.commandOpen)
  const setOpen = useUI((s) => s.setCommandOpen)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [pinyinTick, setPinyinTick] = useState(0)
  const recents = useSettings((s) => s.recents)
  const favorites = useSettings((s) => s.favorites)
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)

  useHotkey(
    'k',
    useCallback(
      (e: KeyboardEvent) => {
        e.preventDefault()
        setOpen(!useUI.getState().commandOpen)
      },
      [setOpen],
    ),
  )

  // “/” 键快速唤起（输入框内不触发）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.key === '/' && !open && !/INPUT|TEXTAREA|SELECT/.test(el.tagName) && !el.isContentEditable) {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  // 打开时加载拼音索引、锁定滚动；关闭时清空
  useEffect(() => {
    if (open) {
      ensurePinyinIndex().then(() => setPinyinTick((t) => t + 1))
      document.body.style.overflow = 'hidden'
    } else {
      setQuery('')
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  const results = useMemo(() => {
    void pinyinTick
    return query.trim() ? searchTools(query) : []
  }, [query, pinyinTick])

  const plannedResults = useMemo(() => {
    void pinyinTick
    return query.trim() ? searchPlannedTools(query) : []
  }, [query, pinyinTick])

  const recentTools = recents.map(getTool).filter(Boolean) as ToolDefinition[]
  const favoriteTools = favorites.map(getTool).filter(Boolean) as ToolDefinition[]

  const go = (path: string) => {
    setOpen(false)
    navigate(path, { viewTransition: true })
  }

  const renderTool = (t: ToolDefinition, group: string) => (
    <Command.Item
      key={`${group}-${t.id}`}
      value={`${group}-${t.id}`}
      onSelect={() => go(`/tools/${t.id}`)}
      onPointerEnter={() => preloadTool(t.id)}
      className="group data-[selected=true]:bg-foreground/[0.07] flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors"
    >
      <ToolIcon icon={t.icon} category={t.category} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{t.name}</div>
        <div className="text-muted-foreground truncate text-xs">{t.description}</div>
      </div>
      <span className="text-muted-foreground hidden text-xs sm:inline">{categoryMap[t.category].name}</span>
      <CornerDownLeft className="text-muted-foreground size-4 opacity-0 transition-opacity group-data-[selected=true]:opacity-100" />
    </Command.Item>
  )

  const renderPlanned = (t: PlannedTool) => (
    <Command.Item
      key={`planned-${t.name}`}
      value={`planned-${t.name}`}
      onSelect={() => toast.info(`「${t.name}」正在开发中，即将上线！`)}
      className="group data-[selected=true]:bg-foreground/[0.07] flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors"
    >
      <ToolIcon icon={t.icon} category={t.category} size="sm" muted />
      <div className="min-w-0 flex-1">
        <div className="text-foreground/75 truncate text-sm font-medium">{t.name}</div>
        <div className="text-muted-foreground truncate text-xs">{t.description}</div>
      </div>
      <span className="text-muted-foreground bg-foreground/[0.06] flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
        <Clock3 className="size-3" />
        即将上线
      </span>
    </Command.Item>
  )

  const groupHeading =
    '[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:flex [&_[cmdk-group-heading]]:items-center [&_[cmdk-group-heading]]:gap-1.5 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium'

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-3 pt-[max(12px,env(safe-area-inset-top))] sm:pt-[12vh]">
          <motion.div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm dark:bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="搜索工具"
            initial={{ opacity: 0, scale: 0.96, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="glass shadow-lift relative w-full max-w-2xl overflow-hidden rounded-2xl"
          >
            <Command
              shouldFilter={false}
              loop
              label="搜索工具"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false)
              }}
            >
              <div className="flex items-center gap-3 border-b px-4">
                <Search className="text-muted-foreground size-5 shrink-0" />
                <Command.Input
                  autoFocus
                  value={query}
                  onValueChange={setQuery}
                  placeholder="搜索工具，支持拼音，如 tppj、tupian…"
                  className="placeholder:text-muted-foreground h-14 w-full bg-transparent text-base outline-none"
                />
                <Kbd className="hidden sm:inline-flex">Esc</Kbd>
              </div>
              <Command.List className={`max-h-[min(60vh,480px)] overflow-y-auto overscroll-contain p-2 ${groupHeading}`}>
                <Command.Empty className="text-muted-foreground flex flex-col items-center gap-2 py-12 text-sm">
                  <Search className="size-8 opacity-40" />
                  没有找到“{query}”相关的工具
                </Command.Empty>

                {query.trim() ? (
                  <>
                    {results.length > 0 && (
                      <Command.Group heading="可用工具">{results.map((t) => renderTool(t, 'r'))}</Command.Group>
                    )}
                    {plannedResults.length > 0 && (
                      <Command.Group heading="即将上线">{plannedResults.map(renderPlanned)}</Command.Group>
                    )}
                  </>
                ) : (
                  <>
                    {recentTools.length > 0 && (
                      <Command.Group heading={<><History className="size-3.5" />最近使用</>}>
                        {recentTools.slice(0, 5).map((t) => renderTool(t, 'recent'))}
                      </Command.Group>
                    )}
                    {favoriteTools.length > 0 && (
                      <Command.Group heading={<><Star className="size-3.5" />我的收藏</>}>
                        {favoriteTools.slice(0, 5).map((t) => renderTool(t, 'fav'))}
                      </Command.Group>
                    )}
                    {recentTools.length === 0 && favoriteTools.length === 0 && tools.length > 0 && (
                      <Command.Group heading={<><Sparkles className="size-3.5" />可用工具</>}>
                        {tools.map((t) => renderTool(t, 'all'))}
                      </Command.Group>
                    )}
                    <Command.Group heading={<><LayoutGrid className="size-3.5" />工具分类</>}>
                      {categories.map((c) => (
                        <Command.Item
                          key={c.id}
                          value={`cat-${c.id}`}
                          onSelect={() => go(`/category/${c.id}`)}
                          className="group data-[selected=true]:bg-foreground/[0.07] flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 transition-colors"
                        >
                          <span
                            className="flex size-7 items-center justify-center rounded-lg text-white"
                            style={{ background: `linear-gradient(135deg, ${c.gradient[0]}, ${c.gradient[1]})` }}
                          >
                            <c.icon className="size-3.5" />
                          </span>
                          <span className="flex-1 text-sm">{c.name}</span>
                          <ArrowRight className="text-muted-foreground size-4 opacity-0 transition-opacity group-data-[selected=true]:opacity-100" />
                        </Command.Item>
                      ))}
                    </Command.Group>
                    <Command.Group heading="操作">
                      <Command.Item
                        value="action-theme"
                        onSelect={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                        className="data-[selected=true]:bg-foreground/[0.07] flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors"
                      >
                        <span className="bg-foreground/[0.07] flex size-7 items-center justify-center rounded-lg">
                          <Moon className="size-3.5" />
                        </span>
                        切换{theme === 'dark' ? '亮色' : '暗色'}模式
                      </Command.Item>
                    </Command.Group>
                  </>
                )}
              </Command.List>
              <div className="text-muted-foreground hidden items-center gap-4 border-t px-4 py-2.5 text-xs sm:flex">
                <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd>选择</span>
                <span className="flex items-center gap-1.5"><Kbd>↵</Kbd>打开</span>
                <span className="ml-auto">🔒 所有工具均在本地运行</span>
              </div>
            </Command>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
