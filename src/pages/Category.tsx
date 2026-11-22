import { Link, useParams } from 'react-router'
import { motion } from 'motion/react'
import { ChevronRight, PackageOpen } from 'lucide-react'
import { categories, categoryMap, plannedTools, tools, type CategoryId } from '@/registry'
import { EmptyState, PageContainer, ToolGrid } from '@/components/ToolGrid'
import NotFound from './NotFound'

/** 分类详情页 */
export function CategoryPage() {
  const { id } = useParams()
  const cat = categoryMap[id as CategoryId]
  if (!cat) return <NotFound />
  const list = tools.filter((t) => t.category === cat.id)
  const planned = plannedTools.filter((t) => t.category === cat.id)
  const [from, to] = cat.gradient

  return (
    <PageContainer key={cat.id}>
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative mb-8 overflow-hidden rounded-3xl border p-6 sm:p-8"
        style={{ background: `linear-gradient(135deg, ${from}22, ${to}14)` }}
      >
        <div
          className="absolute -top-16 -right-10 size-56 rounded-full opacity-40 blur-3xl"
          style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
        />
        <div className="relative flex items-center gap-4">
          <div
            className="flex size-14 items-center justify-center rounded-2xl text-white shadow-lg sm:size-16"
            style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
          >
            <cat.icon className="size-7 sm:size-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{cat.name}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {cat.description} · {list.length} 款可用{planned.length > 0 && `，${planned.length} 款即将上线`}
            </p>
          </div>
        </div>
      </motion.header>
      {list.length + planned.length === 0 ? (
        <EmptyState icon={<PackageOpen />} title="该分类的工具正在开发中" description="敬请期待，我们会持续上新。" />
      ) : (
        <ToolGrid tools={list} planned={planned} />
      )}
    </PageContainer>
  )
}

/** 分类总览页（移动端“分类”Tab） */
export function CategoriesPage() {
  return (
    <PageContainer>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">全部分类</h1>
      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {categories.map((c, i) => {
          const n = tools.filter((t) => t.category === c.id).length
          const p = plannedTools.filter((t) => t.category === c.id).length
          return (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, type: 'spring', stiffness: 380, damping: 30 }}
            >
              <Link
                to={`/category/${c.id}`}
                viewTransition
                className="group bg-card shadow-soft hover:shadow-lift flex items-center gap-4 rounded-2xl border p-4 backdrop-blur-xl transition-all active:scale-[0.98]"
              >
                <span
                  className="flex size-12 items-center justify-center rounded-xl text-white transition-transform group-hover:scale-110 group-hover:-rotate-6"
                  style={{ background: `linear-gradient(135deg, ${c.gradient[0]}, ${c.gradient[1]})` }}
                >
                  <c.icon className="size-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{c.name}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {c.description} · {n + p} 款
                  </span>
                </span>
                <ChevronRight className="text-muted-foreground size-5 transition-transform group-hover:translate-x-1" />
              </Link>
            </motion.div>
          )
        })}
      </div>
    </PageContainer>
  )
}

