import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** 参数表单项：标签 + 右侧值 + 控件 */
export function Field({
  label,
  value,
  children,
  className,
}: {
  label: ReactNode
  value?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-2.5', className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-foreground/80 font-medium">{label}</span>
        {value !== undefined && <span className="text-muted-foreground font-mono text-xs tabular-nums">{value}</span>}
      </div>
      {children}
    </div>
  )
}

/** 开关 */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-300',
        checked ? 'bg-primary' : 'bg-foreground/15',
      )}
    >
      <span
        className={cn(
          'inline-block size-5 rounded-full bg-white shadow transition-transform duration-300 ease-[cubic-bezier(.3,1.5,.6,1)]',
          checked ? 'translate-x-5.5' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

/** 颜色选择：预设色块 + 原生取色器 */
export function ColorPicker({
  value,
  onChange,
  presets = ['transparent', '#ffffff', '#000000', '#f5f5f4', '#1e1e2e', '#fde68a', '#bfdbfe', '#fbcfe8'],
}: {
  value: string
  onChange: (v: string) => void
  presets?: string[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((c) => (
        <button
          key={c}
          type="button"
          title={c === 'transparent' ? '透明' : c}
          onClick={() => onChange(c)}
          className={cn(
            'size-7 rounded-lg border border-black/10 transition-transform hover:scale-110 dark:border-white/15',
            c === 'transparent' && 'checkerboard',
            value === c && 'ring-primary ring-offset-background ring-2 ring-offset-2',
          )}
          style={c === 'transparent' ? undefined : { background: c }}
        />
      ))}
      <label
        className="relative size-7 cursor-pointer overflow-hidden rounded-lg border border-black/10 bg-[conic-gradient(red,yellow,lime,aqua,blue,magenta,red)] transition-transform hover:scale-110 dark:border-white/15"
        title="自定义颜色"
      >
        <input
          type="color"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={value.startsWith('#') ? value : '#ffffff'}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  )
}

