import Fuse, { type IFuseOptions } from 'fuse.js'
import { plannedTools, tools, type PlannedTool, type ToolDefinition } from '@/registry'
import { categoryMap } from '@/registry/categories'

/**
 * 工具搜索
 * - 支持：名称、简介、关键词、分类名、拼音全拼、拼音首字母（如 tppj → 图片拼接）
 * - pinyin-pro 体积较大，首次搜索时才异步加载，加载完成前退化为普通模糊搜索
 */
interface SearchDoc {
  id: string
  name: string
  description: string
  keywords: string
  category: string
  pinyin: string
  initials: string
}

const fuseOptions: IFuseOptions<SearchDoc> = {
  includeScore: true,
  threshold: 0.36,
  ignoreLocation: true,
  keys: [
    { name: 'name', weight: 3 },
    { name: 'initials', weight: 2.5 },
    { name: 'pinyin', weight: 2 },
    { name: 'keywords', weight: 1.5 },
    { name: 'category', weight: 1 },
    { name: 'description', weight: 0.6 },
  ],
}

const baseDoc = (t: ToolDefinition): SearchDoc => ({
  id: t.id,
  name: t.name,
  description: t.description,
  keywords: (t.keywords ?? []).join(' '),
  category: categoryMap[t.category]?.name ?? '',
  pinyin: '',
  initials: '',
})

const basePlannedDoc = (t: PlannedTool): SearchDoc => ({
  id: t.name,
  name: t.name,
  description: t.description,
  keywords: '',
  category: categoryMap[t.category]?.name ?? '',
  pinyin: '',
  initials: '',
})

let fuse = new Fuse(tools.map(baseDoc), fuseOptions)
let plannedFuse = new Fuse(plannedTools.map(basePlannedDoc), fuseOptions)
let pinyinReady: Promise<void> | null = null

/** 加载拼音能力并重建索引（幂等） */
export function ensurePinyinIndex() {
  if (!pinyinReady) {
    pinyinReady = import('pinyin-pro').then(({ pinyin }) => {
      const withPinyin = (doc: SearchDoc) => {
        doc.pinyin = pinyin(doc.name, { toneType: 'none', type: 'array' }).join('')
        doc.initials = pinyin(doc.name, { pattern: 'first', toneType: 'none', type: 'array' }).join('')
        return doc
      }
      fuse = new Fuse(tools.map((t) => withPinyin(baseDoc(t))), fuseOptions)
      plannedFuse = new Fuse(plannedTools.map((t) => withPinyin(basePlannedDoc(t))), fuseOptions)
    })
  }
  return pinyinReady
}

/** 搜索已实现的工具，返回按相关度排序的工具列表 */
export function searchTools(query: string, limit = 20): ToolDefinition[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!q) return tools
  return fuse
    .search(q, { limit })
    .map((r) => tools.find((t) => t.id === r.item.id)!)
    .filter(Boolean)
}

/** 搜索规划中的工具（即将上线） */
export function searchPlannedTools(query: string, limit = 8): PlannedTool[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!q) return []
  return plannedFuse
    .search(q, { limit })
    .map((r) => plannedTools.find((t) => t.name === r.item.id)!)
    .filter(Boolean)
}
