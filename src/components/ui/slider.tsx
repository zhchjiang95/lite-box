import * as SliderPrimitive from '@radix-ui/react-slider'
import { cn } from '@/lib/utils'

interface SliderProps {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  className?: string
}

/** 单值滑块 */
export function Slider({ value, onChange, min = 0, max = 100, step = 1, className }: SliderProps) {
  return (
    <SliderPrimitive.Root
      className={cn('relative flex h-5 w-full touch-none items-center select-none', className)}
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={(v) => onChange(v[0])}
    >
      <SliderPrimitive.Track className="bg-foreground/10 relative h-1.5 grow overflow-hidden rounded-full">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--accent)]" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className="border-primary focus-visible:ring-ring/40 block size-4.5 rounded-full border-2 bg-white shadow-md transition-transform outline-none hover:scale-110 focus-visible:ring-4 active:scale-95"
        aria-label="滑块"
      />
    </SliderPrimitive.Root>
  )
}

