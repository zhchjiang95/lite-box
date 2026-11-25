import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'

/** 工具分类 ID */
export type CategoryId =
  | 'image'
  | 'pdf'
  | 'word'
  | 'lan'
  | 'text'
  | 'encode'
  | 'dev'
  | 'generate'
  | 'media'
  | 'calendar'
  | 'life'

/** 分类定义 */
export interface Category {
  id: CategoryId
  name: string
  description: string
  icon: LucideIcon
  /** 分类主题渐变色 [起, 止] */
  gradient: [string, string]
}

/** 工具元数据：首页、搜索、路由只依赖它，保持轻量 */
export interface ToolMeta {
  /** 唯一 ID，同时作为路由 /tools/:id */
  id: string
  name: string
  /** 一句话简介 */
  description: string
  category: CategoryId
  icon: LucideIcon
  /** 额外搜索关键词（同义词、英文等） */
  keywords?: string[]
  /** 角标 */
  badge?: 'new' | 'hot' | 'beta'
  /** 上线日期，用于“最新”排序 */
  createdAt?: string
}

/** 注册后的工具：元数据 + 懒加载组件 */
export interface ToolDefinition extends ToolMeta {
  load: () => Promise<{ default: ComponentType }>
}

/** 规划中（尚未实现）的工具，用于展示“即将上线” */
export interface PlannedTool {
  name: string
  category: CategoryId
  icon: LucideIcon
  description: string
}

