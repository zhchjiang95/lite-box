import type { LucideIcon } from 'lucide-react'
import { categoryMap, type CategoryId } from '@/registry'
import { cn } from '@/lib/utils'
import type { CSSProperties, Ref } from 'react'

const sizeMap = {
  sm: 'size-8 rounded-lg [&_svg]:size-4',
  md: 'size-11 rounded-xl [&_svg]:size-5',
  lg: 'size-14 rounded-2xl [&_svg]:size-7',
}

/** 带分类渐变底色的工具图标 */
export function ToolIcon({
  icon: Icon,
  category,
  size = 'md',
  className,
  style,
  ref,
  muted,
}: {
  icon: LucideIcon
  category: CategoryId
  size?: keyof typeof sizeMap
  className?: string
  style?: CSSProperties
  ref?: Ref<HTMLDivElement>
  muted?: boolean
}) {
  const [from, to] = categoryMap[category].gradient
  return (
    <div
      ref={ref}
      className={cn(
        'relative flex shrink-0 items-center justify-center text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]',
        sizeMap[size],
        muted && 'opacity-60 grayscale-[0.4]',
        className,
      )}
      style={{ background: `linear-gradient(135deg, ${from}, ${to})`, ...style }}
    >
      <Icon strokeWidth={2.1} />
    </div>
  )
}

