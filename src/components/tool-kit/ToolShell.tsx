import { Drawer } from 'vaul'
import { SlidersHorizontal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useIsDesktop } from '@/hooks'
import { cn } from '@/lib/utils'
import { Button } from '../ui/button'

interface ToolShellProps {
  /** 参数面板（桌面端左侧，移动端底部抽屉） */
  panel?: ReactNode
  /** 主工作区（预览） */
  children: ReactNode
  /** 主要操作按钮（桌面端在面板底部，移动端固定在底部操作栏） */
  actions?: ReactNode
  /** 面板标题 */
  panelTitle?: string
  className?: string
}

/**
 * 工具通用布局
 * - 桌面（≥1024px）：左侧参数面板（吸顶）+ 右侧预览
 * - 移动端：预览全宽，参数放入可拖拽底部抽屉，操作按钮固定在底部
 */
export function ToolShell({ panel, children, actions, panelTitle = '参数设置', className }: ToolShellProps) {
  const desktop = useIsDesktop()
  const [open, setOpen] = useState(false)

  if (desktop) {
    return (
      <div className={cn('grid items-start gap-6', panel && 'grid-cols-[340px_minmax(0,1fr)] 2xl:grid-cols-[380px_minmax(0,1fr)]', className)}>
        {panel && (
          <aside className="glass shadow-soft sticky top-6 flex max-h-[calc(100dvh-3rem)] flex-col overflow-hidden rounded-2xl">
            <div className="text-muted-foreground border-b px-5 py-3.5 text-xs font-medium tracking-wide">{panelTitle}</div>
            <div className="flex-1 space-y-6 overflow-y-auto p-5">{panel}</div>
            {actions && <div className="flex gap-2 border-t p-4 [&>*]:flex-1">{actions}</div>}
          </aside>
        )}
        <div className="min-w-0">{children}</div>
      </div>
    )
  }

  return (
    <div className={className}>
      {children}
      {(panel || actions) && (
        <>
          {/* 占位，避免内容被底部操作栏遮挡 */}
          <div className="h-24" />
          <div className="glass pb-safe fixed inset-x-0 bottom-0 z-30 border-x-0 border-b-0">
            <div className="flex gap-2 p-3 [&>*]:flex-1">
              {panel && (
                <Button variant="outline" size="lg" className="!flex-none px-4" onClick={() => setOpen(true)}>
                  <SlidersHorizontal />
                  参数
                </Button>
              )}
              {actions}
            </div>
          </div>
          {panel && (
            <Drawer.Root open={open} onOpenChange={setOpen}>
              <Drawer.Portal>
                <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
                <Drawer.Content className="bg-card-solid fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-3xl border-t outline-none">
                  <Drawer.Handle className="!mt-3 !mb-1 !h-1.5 !w-10 !bg-foreground/20" />
                  <Drawer.Title className="px-5 pt-2 pb-3 text-base font-semibold">{panelTitle}</Drawer.Title>
                  <Drawer.Description className="sr-only">调整工具参数，预览会实时更新</Drawer.Description>
                  <div className="pb-safe flex-1 space-y-6 overflow-y-auto px-5 pb-8">{panel}</div>
                </Drawer.Content>
              </Drawer.Portal>
            </Drawer.Root>
          )}
        </>
      )}
    </div>
  )
}

