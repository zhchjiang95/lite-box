import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** 键盘按键样式 */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'border-border bg-card-solid/70 text-muted-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-md border px-1 font-mono text-[11px] font-medium',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

