import { lazy, Suspense, useEffect, type ComponentType, type LazyExoticComponent } from 'react'
import { Link, useParams } from 'react-router'
import { motion } from 'motion/react'
import { ChevronRight, ShieldCheck, Star } from 'lucide-react'
import { categoryMap, getTool, type ToolDefinition } from '@/registry'
import { useSettings } from '@/stores/settings'
import { ToolIcon } from '@/components/ToolIcon'
import { VT_ICON, VT_TITLE } from '@/components/ToolCard'
import { PageContainer } from '@/components/ToolGrid'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import NotFound from './NotFound'

/** 缓存每个工具的 lazy 组件，避免重复创建 */
const lazyCache = new Map<string, LazyExoticComponent<ComponentType>>()
function getLazy(tool: ToolDefinition) {
  let C = lazyCache.get(tool.id)
  if (!C) {
    C = lazy(tool.load)
    lazyCache.set(tool.id, C)
  }
  return C
}

/** 工具加载骨架屏 */
function ToolSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      <div className="bg-card hidden h-[480px] rounded-2xl border lg:block" />
      <div
        className="h-[360px] rounded-3xl border lg:h-[480px]"
        style={{
          background:
            'linear-gradient(90deg, transparent, color-mix(in oklch, var(--foreground) 5%, transparent), transparent) 0 0 / 200% 100%',
          animation: 'shimmer 1.6s linear infinite',
        }}
      />
    </div>
  )
}

/** 工具详情页 */
export default function ToolPage() {
  const { id = '' } = useParams()
  const tool = getTool(id)
  const addRecent = useSettings((s) => s.addRecent)
  const favorite = useSettings((s) => s.favorites.includes(id))
  const toggleFavorite = useSettings((s) => s.toggleFavorite)

  useEffect(() => {
    if (tool) {
      addRecent(tool.id)
      document.title = `${tool.name} · 轻匣`
    }
    return () => {
      document.title = '轻匣 · 本地工具箱'
    }
  }, [tool, addRecent])

  if (!tool) return <NotFound />
  const Comp = getLazy(tool)
  const cat = categoryMap[tool.category]

  return (
    <PageContainer className="py-5 lg:py-6">
      {/* 面包屑 */}
      <nav className="text-muted-foreground mb-4 flex items-center gap-1 text-xs">
        <Link to="/" viewTransition className="hover:text-foreground transition-colors">首页</Link>
        <ChevronRight className="size-3.5" />
        <Link to={`/category/${cat.id}`} viewTransition className="hover:text-foreground transition-colors">{cat.name}</Link>
        <ChevronRight className="size-3.5" />
        <span className="text-foreground/80">{tool.name}</span>
      </nav>

      {/* 头部 */}
      <header className="mb-6 flex items-center gap-4">
        <ToolIcon icon={tool.icon} category={tool.category} size="lg" style={{ viewTransitionName: VT_ICON }} />
        <div className="min-w-0 flex-1">
          <h1 className="w-fit text-xl font-bold tracking-tight sm:text-2xl" style={{ viewTransitionName: VT_TITLE }}>
            {tool.name}
          </h1>
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="text-muted-foreground mt-1 truncate text-sm"
          >
            {tool.description}
          </motion.p>
        </div>
        <span className="hidden items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-600 md:flex dark:text-emerald-400">
          <ShieldCheck className="size-3.5" />
          本地处理，文件不上传
        </span>
        <Button
          variant="outline"
          size="icon"
          onClick={() => toggleFavorite(tool.id)}
          aria-label={favorite ? '取消收藏' : '收藏'}
          className={cn(favorite && 'text-amber-400')}
        >
          <motion.span key={String(favorite)} initial={{ scale: 0.3, rotate: -60 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 14 }}>
            <Star className="size-[18px]" fill={favorite ? 'currentColor' : 'none'} />
          </motion.span>
        </Button>
      </header>

      {/* 注意：此处只做透明度动画，transform 会导致内部 fixed 元素定位异常 */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.08, duration: 0.3 }}>
        <Suspense fallback={<ToolSkeleton />}>
          <Comp />
        </Suspense>
      </motion.div>
    </PageContainer>
  )
}
