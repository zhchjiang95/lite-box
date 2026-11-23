import { AnimatePresence, motion } from 'motion/react'
import { History, Search, ShieldCheck, Star, WifiOff, Zap, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { categories, getTool, plannedTools, tools, type CategoryId, type ToolDefinition } from '@/registry'
import { useSettings, useUI } from '@/stores/settings'
import { cn, isMac } from '@/lib/utils'
import { Kbd } from '@/components/ui/kbd'
import { SiteFooter } from '@/components/AuthorLinks'
import { PageContainer, SectionTitle, ToolGrid } from '@/components/ToolGrid'

const examples = ['图片拼接', 'tppj', '压缩图片', 'JSON', '二维码', '时间戳']

/** 首页 */
export default function Home() {
  const [active, setActive] = useState<CategoryId | 'all'>('all')
  const setCommandOpen = useUI((s) => s.setCommandOpen)
  const recents = useSettings((s) => s.recents)
  const favorites = useSettings((s) => s.favorites)

  // 搜索框占位文字轮播
  const [exIdx, setExIdx] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setExIdx((i) => (i + 1) % examples.length), 2600)
    return () => clearInterval(t)
  }, [])

  const quick = useMemo(() => {
    const ids = [...new Set([...favorites, ...recents])]
    return ids.map(getTool).filter(Boolean).slice(0, 6) as ToolDefinition[]
  }, [favorites, recents])

  const shownTools = active === 'all' ? tools : tools.filter((t) => t.category === active)
  const shownPlanned = active === 'all' ? plannedTools : plannedTools.filter((t) => t.category === active)

  return (
    <PageContainer>
      {/* Hero */}
      <section className="relative flex flex-col items-center px-2 pt-6 pb-10 text-center sm:pt-12 sm:pb-14 lg:pt-16">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass mb-5 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
        >
          <Sparkles className="text-primary size-3.5" />
          文件不上传 · 打开即用 · 可离线
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06 }}
          className="text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl"
        >
          浏览器里的<span className="text-gradient">百宝工具匣</span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className="text-muted-foreground mt-4 max-w-xl text-sm text-pretty sm:text-base"
        >
          图片、PDF、文本、编码、开发……所有处理都在你的设备上完成，快速、安全、无需安装。
        </motion.p>

        {/* 大搜索框 */}
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.99 }}
          onClick={() => setCommandOpen(true)}
          className="glass shadow-lift group mt-8 flex h-14 w-full max-w-xl items-center gap-3 rounded-2xl px-5 text-left transition-shadow sm:h-16"
        >
          <Search className="text-primary size-5 shrink-0 transition-transform group-hover:scale-110" />
          <span className="text-muted-foreground relative h-6 flex-1 overflow-hidden">
            <span className="mr-1">搜索</span>
            <AnimatePresence mode="wait">
              <motion.span
                key={exIdx}
                initial={{ y: 18, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -18, opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="text-foreground/70 inline-block"
              >
                “{examples[exIdx]}”
              </motion.span>
            </AnimatePresence>
          </span>
          <span className="hidden items-center gap-1 sm:flex">
            <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </motion.button>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-muted-foreground mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs sm:text-sm"
        >
          <span className="flex items-center gap-1.5"><Zap className="size-4 text-amber-500" />{tools.length + plannedTools.length}+ 款工具</span>
          <span className="flex items-center gap-1.5"><ShieldCheck className="size-4 text-emerald-500" />100% 本地处理</span>
          <span className="flex items-center gap-1.5"><WifiOff className="size-4 text-sky-500" />支持离线使用</span>
        </motion.div>
      </section>

      {/* 收藏 / 最近 */}
      {quick.length > 0 && (
        <section className="mb-10">
          <SectionTitle icon={favorites.length ? <Star /> : <History />} title="快捷访问" />
          <ToolGrid tools={quick} />
        </section>
      )}

      {/* 分类过滤 */}
      <section>
        <div className="bg-background/60 sticky top-0 z-10 -mx-4 mb-5 px-4 py-2.5 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            {[{ id: 'all' as const, name: '全部' }, ...categories].map((c) => {
              const on = active === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActive(c.id)}
                  className={cn(
                    'relative h-9 shrink-0 rounded-full px-4 text-sm font-medium transition-colors',
                    on ? 'text-primary-foreground' : 'glass text-muted-foreground hover:text-foreground',
                  )}
                >
                  {on && (
                    <motion.span
                      layoutId="home-cat"
                      className="bg-primary absolute inset-0 rounded-full shadow-[0_6px_20px_-6px_var(--primary)]"
                      transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                    />
                  )}
                  <span className="relative">{c.name}</span>
                </button>
              )
            })}
          </div>
        </div>
        <ToolGrid tools={shownTools} planned={shownPlanned} />
      </section>

      <SiteFooter />
    </PageContainer>
  )
}
