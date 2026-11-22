import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger'
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const variants: Record<Variant, string> = {
  primary:
    'bg-primary text-primary-foreground shadow-[0_6px_20px_-6px_var(--primary)] hover:brightness-110 active:brightness-95',
  secondary: 'bg-muted text-foreground hover:bg-foreground/10',
  ghost: 'text-foreground/80 hover:bg-foreground/[0.06] hover:text-foreground',
  outline: 'border border-border bg-card-solid/60 hover:bg-foreground/[0.05]',
  danger: 'bg-red-500/10 text-red-500 hover:bg-red-500/20',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-base gap-2 rounded-2xl',
  icon: 'size-10 rounded-xl',
  'icon-sm': 'size-8 rounded-lg',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

/** 生成按钮类名（可用于 Link 等非 button 元素） */
export function buttonClass({ variant = 'secondary', size = 'md', className }: { variant?: Variant; size?: Size; className?: string } = {}) {
  return cn(
    'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-all duration-200 select-none',
    'focus-visible:ring-ring/60 outline-none focus-visible:ring-2 active:scale-[0.97]',
    'disabled:pointer-events-none disabled:opacity-45',
    '[&_svg]:size-4 [&_svg]:shrink-0',
    variants[variant],
    sizes[size],
    className,
  )
}

/** 基础按钮 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'secondary', size = 'md', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={buttonClass({ variant, size, className })}
      {...props}
    />
  ),
)
Button.displayName = 'Button'
