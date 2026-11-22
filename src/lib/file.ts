/** 文件相关通用工具函数 */

/** 触发浏览器下载 Blob */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 延迟释放，兼容部分浏览器
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 将 canvas 导出为 Blob */
export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('导出失败：图片可能过大'))), type, quality)
  })
}

/** 复制图片到剪贴板（仅 PNG 兼容性最好） */
export async function copyImageToClipboard(blob: Blob) {
  if (!('ClipboardItem' in window) || !navigator.clipboard?.write) {
    throw new Error('当前浏览器不支持复制图片')
  }
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
}

/** 带时间戳的文件名 */
export function timestampName(prefix: string, ext: string) {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`
}

/** 判断是否为图片文件 */
export const isImageFile = (f: File) => f.type.startsWith('image/')

