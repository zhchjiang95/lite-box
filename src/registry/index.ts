import type { ComponentType } from 'react'
import type { ToolDefinition, ToolMeta } from './types'
import { categories } from './categories'

/**
 * 工具注册表
 * - 元数据（meta.ts）同步收集：首页 / 搜索立即可用，体积很小
 * - 组件（index.tsx）异步懒加载：进入工具页才下载对应代码
 * 新增工具只需在 src/tools 下新建目录，包含 meta.ts 和 index.tsx 即可。
 */
const metaModules = import.meta.glob<{ default: ToolMeta }>('../tools/*/meta.ts', { eager: true })
const componentModules = import.meta.glob<{ default: ComponentType }>('../tools/*/index.tsx')

const dirOf = (path: string) => path.split('/').at(-2)!

export const tools: ToolDefinition[] = Object.entries(metaModules)
  .map(([path, mod]) => {
    const dir = dirOf(path)
    const load = componentModules[`../tools/${dir}/index.tsx`]
    if (!load) {
      console.warn(`[registry] 工具 ${dir} 缺少 index.tsx`)
      return null
    }
    if (import.meta.env.DEV && mod.default.id !== dir) {
      console.warn(`[registry] 工具 ID "${mod.default.id}" 与目录名 "${dir}" 不一致`)
    }
    return { ...mod.default, load }
  })
  .filter((t): t is ToolDefinition => t !== null)
  // 按分类顺序 + 名称排序
  .sort((a, b) => {
    const ci = categories.findIndex((c) => c.id === a.category) - categories.findIndex((c) => c.id === b.category)
    return ci !== 0 ? ci : a.name.localeCompare(b.name, 'zh-CN')
  })

export const toolMap = new Map(tools.map((t) => [t.id, t]))

export const getTool = (id: string) => toolMap.get(id)

/** 预加载工具代码（悬停 / 聚焦时调用，让进入几乎瞬开） */
const preloaded = new Set<string>()
export function preloadTool(id: string) {
  if (preloaded.has(id)) return
  preloaded.add(id)
  // 同时预取工具页外壳与工具本体
  import('@/pages/ToolPage').catch(() => {})
  toolMap.get(id)?.load().catch(() => preloaded.delete(id))
}

export { categories, categoryMap } from './categories'
export { plannedTools } from './planned'
export type * from './types'
