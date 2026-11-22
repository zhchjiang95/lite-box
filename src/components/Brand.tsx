import { cn } from '@/lib/utils'

/** 极光流动背景（纯 CSS 动画，GPU 合成，开销极低） */
export function AuroraBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="animate-aurora absolute -top-[30%] -left-[10%] h-[70vh] w-[70vw] rounded-full blur-[100px]"
        style={{ background: 'var(--aurora-1)' }}
      />
      <div
        className="animate-aurora absolute top-[10%] -right-[15%] h-[60vh] w-[55vw] rounded-full blur-[110px] [animation-delay:-7s]"
        style={{ background: 'var(--aurora-2)' }}
      />
      <div
        className="animate-aurora absolute -bottom-[25%] left-[20%] h-[55vh] w-[60vw] rounded-full blur-[120px] [animation-delay:-14s]"
        style={{ background: 'var(--aurora-3)' }}
      />
      {/* 细网格纹理 */}
      <div
        className="absolute inset-0 opacity-[0.35] dark:opacity-[0.18]"
        style={{
          backgroundImage:
            'linear-gradient(to right, color-mix(in oklch, var(--foreground) 6%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklch, var(--foreground) 6%, transparent) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 75%)',
        }}
      />
    </div>
  )
}

/** 品牌 Logo */
export function Logo({ className, showText = true }: { className?: string; showText?: boolean }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <img src="/favicon.svg" alt="" className="size-8 shrink-0 drop-shadow-[0_4px_12px_rgb(139_92_246/0.45)]" />
      {showText && (
        <span className="flex flex-col leading-none">
          <span className="text-[17px] font-bold tracking-tight">轻匣</span>
          <span className="text-muted-foreground mt-0.5 text-[10px] tracking-wider">LiteBox</span>
        </span>
      )}
    </span>
  )
}

