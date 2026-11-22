/** 图片转 PDF：纸张尺寸、排版配置与图片条目类型 */

export type PageSizeId = 'a4' | 'fit' | 'a3' | 'a5' | 'letter' | 'slide169'
export type PageOrientation = 'auto' | 'portrait' | 'landscape'
export type ImageFitMode = 'contain' | 'cover'

export interface PageSizeSpec {
  id: PageSizeId
  label: string
  hint: string
  /** 纵向尺寸（PDF 点，1 inch = 72 pt）；fit 为 null */
  widthPt: number | null
  heightPt: number | null
}

export const PAGE_SIZES: PageSizeSpec[] = [
  { id: 'a4', label: 'A4', hint: '210×297mm', widthPt: 595.28, heightPt: 841.89 },
  { id: 'fit', label: '自适应原图', hint: '无白边电子册', widthPt: null, heightPt: null },
  { id: 'a3', label: 'A3', hint: '297×420mm', widthPt: 841.89, heightPt: 1190.55 },
  { id: 'a5', label: 'A5', hint: '148×210mm', widthPt: 419.53, heightPt: 595.28 },
  { id: 'letter', label: 'Letter', hint: '北美信纸', widthPt: 612, heightPt: 792 },
  { id: 'slide169', label: '16:9 演示', hint: '横屏幻灯片', widthPt: 540, heightPt: 960 },
]

export interface ImageToPdfOptions {
  pageSize: PageSizeId
  orientation: PageOrientation
  /** 页边距（pt，0 - 80） */
  marginPt: number
  /** 图片在内容区的适配方式 */
  fitMode: ImageFitMode
  /** 页面背景色 */
  background: string
  /** 是否在底部居中显示页码 */
  showPageNumbers: boolean
  /** 是否启用 JPG 压缩减小 PDF 文件体积 */
  compressJpeg: boolean
  /** 压缩质量 50 - 96 */
  jpegQuality: number
  /** 输出文件名（不含扩展名） */
  filename: string
}

export const defaultImageToPdfOptions: ImageToPdfOptions = {
  pageSize: 'a4',
  orientation: 'auto',
  marginPt: 24,
  fitMode: 'contain',
  background: '#ffffff',
  showPageNumbers: false,
  compressJpeg: false,
  jpegQuality: 85,
  filename: '图片合成',
}

export interface PdfImageItem {
  id: string
  file: File
  name: string
  size: number
  previewUrl: string
  bitmap: ImageBitmap
  width: number
  height: number
  /** 顺时针旋转角度（0 / 90 / 180 / 270） */
  rotation: number
}
