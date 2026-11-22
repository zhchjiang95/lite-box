import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import type { PlannedTool, ToolDefinition } from '@/registry'
import { cn } from '@/lib/utils'
import { PlannedCard, ToolCard } from './ToolCard'

export const gridCls =
  'grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6'

/** 工具网格：进场错落浮入、过滤时布局平滑重排 */
export function ToolGrid({
  tools,
  planned = [],
  className,
}: {
  tools: ToolDefinition[]
  planned?: PlannedTool[]
  className?: string
}) {
  return (
    <motion.div layout className={cn(gridCls, className)}>
      <AnimatePresence mode="popLayout" initial>
        {tools.map((t, i) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30, delay: Math.min(i * 0.035, 0.4) }}
          >
            <ToolCard tool={t} />
          </motion.div>
        ))}
        {planned.map((t, i) => (
          <motion.div
            key={`planned-${t.name}`}
            layout
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30, delay: Math.min((tools.length + i) * 0.03, 0.5) }}
          >
            <PlannedCard tool={t} />
          </motion.div>
        ))}
      </AnimatePresence>
    </motion.div>
  )
}

/** 区块标题 */
export function SectionTitle({ icon, title, action }: { icon?: ReactNode; title: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  )
}

/** 页面内容容器：大屏限制最大宽度 */
export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8', className)}>{children}</div>
}

/** 空状态 */
export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card/50 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center"
    >
      <div className="bg-foreground/[0.05] text-muted-foreground flex size-14 items-center justify-center rounded-2xl [&_svg]:size-6">
        {icon}
      </div>
      <div className="font-medium">{title}</div>
      {description && <p className="text-muted-foreground max-w-sm text-sm">{description}</p>}
      {action}
    </motion.div>
  )
}

