/** PDF 合并与拆分：类型定义 */

export type ExportMode = 'merge' | 'range' | 'fixed'
export type RangeOutputMode = 'separate' | 'combined'

/** 已载入的源 PDF 文件元数据 */
export interface SourcePdfFile {
  id: string
  name: string
  size: number
  pageCount: number
  /** 为不同源 PDF 分配区分色，合并多份文档时一目了然 */
  color: string
}

/** 画布上的单个页面卡片 */
export interface PdfPageCard {
  /** 全局唯一页面实例 ID（支持复制同一页） */
  uid: string
  /** 来源文件 ID */
  fileId: string
  /** 来源文件名 */
  fileName: string
  /** 来源文件区分色 */
  color: string
  /** 原 PDF 中的 0-based 页码索引 */
  sourcePageIndex: number
  /** 附加顺时针旋转角度（0 / 90 / 180 / 270） */
  rotation: number
  /** 原页面尺寸（pt，用于计算缩略图占位比例防抖动） */
  widthPt: number
  heightPt: number
}

/** 源 PDF 区分色板 */
export const SOURCE_COLORS = [
  '#8b5cf6',
  '#0ea5e9',
  '#f97316',
  '#10b981',
  '#ec4899',
  '#eab308',
  '#6366f1',
  '#14b8a6',
]
