import { Outlet, ScrollRestoration } from 'react-router'
import { Toaster } from 'sonner'
import { useThemeEffect } from '@/hooks'
import { useSettings } from '@/stores/settings'
import { AuroraBackground } from '../Brand'
import { TooltipProvider } from '../ui/tooltip'
import { Sidebar } from './Sidebar'
import { MobileNav } from './Navigation'
import { CommandMenu } from './CommandMenu'

/** 应用整体布局（左右分栏，无顶栏） */
export function AppLayout() {
  useThemeEffect()
  const theme = useSettings((s) => s.theme)
  return (
    <TooltipProvider delayDuration={300}>
      <AuroraBackground />
      <div className="flex min-h-dvh">
        <Sidebar />
        <main className="min-w-0 flex-1 pt-[env(safe-area-inset-top)] pb-24 lg:pb-10">
          <Outlet />
        </main>
      </div>
      <MobileNav />
      <CommandMenu />
      <Toaster
        position="top-center"
        richColors
        theme={theme}
        toastOptions={{ className: '!rounded-xl' }}
        offset={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}
      />
      <ScrollRestoration />
    </TooltipProvider>
  )
}

