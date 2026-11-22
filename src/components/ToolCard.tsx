import { Link } from 'react-router'
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import { Star, Clock3 } from 'lucide-react'
import { useRef, type MouseEvent } from 'react'
import { preloadTool, type PlannedTool, type ToolDefinition } from '@/registry'
import { useSettings } from '@/stores/settings'
import { useFinePointer } from '@/hooks'
import { cn } from '@/lib/utils'
import { ToolIcon } from './ToolIcon'

const badgeText = { new: '新', hot: '热门', beta: 'Beta' }

/** 共享元素过渡名称：点击时才赋给被点的卡片，避免页面内重名 */
export const VT_ICON = 'tool-icon'
export const VT_TITLE = 'tool-title'

/** 工具卡片：鼠标跟随光斑 + 3D 倾斜 + 共享元素转场 */
export function ToolCard({ tool }: { tool: ToolDefinition }) {
  const fine = useFinePointer()
  const favorite = useSettings((s) => s.favorites.includes(tool.id))
  const toggleFavorite = useSettings((s) => s.toggleFavorite)
  const cardRef = useRef<HTMLAnchorElement>(null)
  const iconRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)

  // 3D 倾斜
  const px = useMotionValue(0.5)
  const py = useMotionValue(0.5)
  const sx = useSpring(px, { stiffness: 260, damping: 22 })
  const sy = useSpring(py, { stiffness: 260, damping: 22 })
  const rotateX = useTransform(sy, [0, 1], [5, -5])
  const rotateY = useTransform(sx, [0, 1], [-6, 6])

  const onMove = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!fine || !cardRef.current) return
    const r = cardRef.current.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    px.set(x)
    py.set(y)
    cardRef.current.style.setProperty('--mx', `${x * 100}%`)
    cardRef.current.style.setProperty('--my', `${y * 100}%`)
  }
  const onLeave = () => {
    px.set(0.5)
    py.set(0.5)
  }

  const onClick = (e: MouseEvent) => {
    // 新标签页打开时不设置过渡名，避免残留导致重名
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    if (iconRef.current) iconRef.current.style.viewTransitionName = VT_ICON
    if (titleRef.current) titleRef.current.style.viewTransitionName = VT_TITLE
  }

  return (
    <motion.div style={fine ? { rotateX, rotateY, transformPerspective: 800 } : undefined} className="h-full">
      <Link
        ref={cardRef}
        to={`/tools/${tool.id}`}
        viewTransition
        onClick={onClick}
        onMouseEnter={() => preloadTool(tool.id)}
        onFocus={() => preloadTool(tool.id)}
        onTouchStart={() => preloadTool(tool.id)}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        className={cn(
          'group bg-card relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl border p-4 backdrop-blur-xl sm:p-5',
          'shadow-soft hover:shadow-lift transition-[box-shadow,border-color] duration-300 hover:border-[color-mix(in_oklch,var(--primary)_35%,transparent)]',
          'focus-visible:ring-ring/60 outline-none focus-visible:ring-2',
        )}
      >
        {/* 鼠标跟随光斑 */}
        <div
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background:
              'radial-gradient(420px circle at var(--mx, 50%) var(--my, 50%), color-mix(in oklch, var(--primary) 16%, transparent), transparent 45%)',
          }}
        />
        <div className="relative flex items-start justify-between">
          <ToolIcon
            ref={iconRef}
            icon={tool.icon}
            category={tool.category}
            className="transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6"
          />
          <div className="flex items-center gap-1">
            {tool.badge && (
              <span className="rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold text-white">
                {badgeText[tool.badge]}
              </span>
            )}
            <button
              type="button"
              aria-label={favorite ? '取消收藏' : '收藏'}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                toggleFavorite(tool.id)
              }}
              className={cn(
                'flex size-8 items-center justify-center rounded-lg transition-all hover:bg-foreground/[0.07] active:scale-90',
                favorite ? 'text-amber-400' : 'text-muted-foreground opacity-100 lg:opacity-0 lg:group-hover:opacity-100',
              )}
            >
              <motion.span key={String(favorite)} initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 15 }}>
                <Star className="size-4" fill={favorite ? 'currentColor' : 'none'} />
              </motion.span>
            </button>
          </div>
        </div>
        <div className="relative space-y-1">
          <h3 ref={titleRef} className="w-fit font-semibold tracking-tight">
            {tool.name}
          </h3>
          <p className="text-muted-foreground line-clamp-2 text-[13px] leading-relaxed">{tool.description}</p>
        </div>
      </Link>
    </motion.div>
  )
}

/** 即将上线的卡片 */
export function PlannedCard({ tool }: { tool: PlannedTool }) {
  return (
    <div className="bg-card/40 relative flex h-full flex-col gap-3 rounded-2xl border border-dashed p-4 sm:p-5">
      <div className="flex items-start justify-between">
        <ToolIcon icon={tool.icon} category={tool.category} muted />
        <span className="text-muted-foreground bg-foreground/[0.06] flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
          <Clock3 className="size-3" />
          即将上线
        </span>
      </div>
      <div className="space-y-1">
        <h3 className="text-foreground/70 font-semibold tracking-tight">{tool.name}</h3>
        <p className="text-muted-foreground/80 line-clamp-2 text-[13px] leading-relaxed">{tool.description}</p>
      </div>
    </div>
  )
}
