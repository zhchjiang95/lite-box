import { History, Star, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import { getTool, type ToolDefinition } from '@/registry'
import { useSettings } from '@/stores/settings'
import { Button, buttonClass } from '@/components/ui/button'
import { EmptyState, PageContainer, SectionTitle, ToolGrid } from '@/components/ToolGrid'

/** 收藏与最近使用 */
export default function Favorites() {
  const favorites = useSettings((s) => s.favorites)
  const recents = useSettings((s) => s.recents)
  const clearRecents = useSettings((s) => s.clearRecents)
  const favTools = favorites.map(getTool).filter(Boolean) as ToolDefinition[]
  const recentTools = recents.map(getTool).filter(Boolean) as ToolDefinition[]

  return (
    <PageContainer className="space-y-10">
      <section>
        <SectionTitle icon={<Star />} title="我的收藏" />
        {favTools.length ? (
          <ToolGrid tools={favTools} />
        ) : (
          <EmptyState
            icon={<Star />}
            title="还没有收藏的工具"
            description="在工具卡片或工具页点击星标即可收藏，常用工具一键直达。"
            action={
              <Link to="/" viewTransition className={buttonClass({ variant: 'primary', size: 'sm' })}>
                去逛逛
              </Link>
            }
          />
        )}
      </section>
      <section>
        <SectionTitle
          icon={<History />}
          title="最近使用"
          action={
            recentTools.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearRecents}>
                <Trash2 />
                清空
              </Button>
            )
          }
        />
        {recentTools.length ? (
          <ToolGrid tools={recentTools} />
        ) : (
          <EmptyState icon={<History />} title="暂无使用记录" description="使用过的工具会自动出现在这里。" />
        )}
      </section>
    </PageContainer>
  )
}
