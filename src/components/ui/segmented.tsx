import { motion } from 'motion/react'
import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface Option<T extends string> {
  value: T
  label: ReactNode
  icon?: ReactNode
}

interface SegmentedProps<T extends string> {
  value: T
  onChange: (v: T) => void
  options: Option<T>[]
  className?: string
  size?: 'sm' | 'md'
}

/** 分段选择器，选中指示器带弹性滑动动画 */
export function Segmented<T extends string>({ value, onChange, options, className, size = 'md' }: SegmentedProps<T>) {
  const id = useId()
  return (
    <div className={cn('bg-foreground/[0.06] inline-flex w-full rounded-xl p-1', className)} role="radiogroup">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative flex flex-1 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors',
              size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-sm',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              '[&_svg]:size-4',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="bg-card-solid shadow-soft absolute inset-0 rounded-lg"
                transition={{ type: 'spring', stiffness: 500, damping: 36 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              {o.icon}
              {o.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

