/** 纯前端二进制图像编码器：标准 24-bit BMP 与多尺寸 PNG-in-ICO */

/**
 * 将 RGBA ImageData 编码为标准 24-bit BGR BMP（无压缩、自底向上扫描行、4 字节行对齐）
 * 说明：几乎所有操作系统、浏览器与设计软件均 100% 兼容 24-bit BMP；透明像素应在绘制到 Canvas 前先填充底色。
 */
export function encodeBmp24(imageData: ImageData): Blob {
  const { width, height, data } = imageData
  const rowStride = Math.ceil((width * 3) / 4) * 4
  const pixelDataSize = rowStride * height
  const headerSize = 54
  const fileSize = headerSize + pixelDataSize

  const buffer = new ArrayBuffer(fileSize)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  // BITMAPFILEHEADER（14 字节）
  bytes[0] = 0x42 // 'B'
  bytes[1] = 0x4d // 'M'
  view.setUint32(2, fileSize, true)
  view.setUint32(6, 0, true)
  view.setUint32(10, headerSize, true)

  // BITMAPINFOHEADER（40 字节）
  view.setUint32(14, 40, true)
  view.setInt32(18, width, true)
  view.setInt32(22, height, true) // 正值：自底向上
  view.setUint16(26, 1, true) // 色彩平面数
  view.setUint16(28, 24, true) // 24-bit RGB
  view.setUint32(30, 0, true) // BI_RGB 无压缩
  view.setUint32(34, pixelDataSize, true)
  view.setInt32(38, 2835, true) // 72 DPI
  view.setInt32(42, 2835, true)
  view.setUint32(46, 0, true)
  view.setUint32(50, 0, true)

  // 写入 BGR 像素数据（行尾补零字节已由 ArrayBuffer 默认初始化为 0）
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 4
    let dst = headerSize + y * rowStride
    for (let x = 0; x < width; x++) {
      const src = srcRow + x * 4
      bytes[dst++] = data[src + 2] // B
      bytes[dst++] = data[src + 1] // G
      bytes[dst++] = data[src] // R
    }
  }

  return new Blob([buffer], { type: 'image/bmp' })
}

export interface IcoFrame {
  size: number
  pngBytes: Uint8Array
}

/**
 * 将一个或多个正方形 PNG 帧封装为标准 Windows / Favicon 多尺寸 ICO 容器
 */
export function encodeIco(frames: IcoFrame[]): Blob {
  if (!frames.length) throw new Error('至少需要选择一个 ICO 图标尺寸')

  const count = frames.length
  const headerSize = 6
  const dirSize = count * 16
  const totalBytes = frames.reduce((sum, f) => sum + f.pngBytes.byteLength, headerSize + dirSize)

  const buffer = new ArrayBuffer(totalBytes)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  // ICONDIR（6 字节）
  view.setUint16(0, 0, true) // 保留
  view.setUint16(2, 1, true) // 类型 1 = ICO
  view.setUint16(4, count, true)

  // ICONDIRENTRY（每帧 16 字节）+ 顺序拷贝 PNG 数据
  let dataOffset = headerSize + dirSize
  frames.forEach((frame, index) => {
    const entryOffset = headerSize + index * 16
    const dim = frame.size >= 256 ? 0 : frame.size // 规范约定 256px 写入 0
    bytes[entryOffset] = dim
    bytes[entryOffset + 1] = dim
    bytes[entryOffset + 2] = 0 // 非调色板
    bytes[entryOffset + 3] = 0
    view.setUint16(entryOffset + 4, 1, true) // planes
    view.setUint16(entryOffset + 6, 32, true) // 32-bit RGBA
    view.setUint32(entryOffset + 8, frame.pngBytes.byteLength, true)
    view.setUint32(entryOffset + 12, dataOffset, true)

    bytes.set(frame.pngBytes, dataOffset)
    dataOffset += frame.pngBytes.byteLength
  })

  return new Blob([buffer], { type: 'image/x-icon' })
}
