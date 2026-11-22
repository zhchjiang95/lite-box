import { zip } from 'fflate'
import * as UPNGMod from 'upng-js'
import {
  outputFileName,
  qualityToPngColors,
  resolveTargetMime,
  type CompressItem,
  type CompressOptions,
  type CompressResult,
  type ConcreteMime,
} from './types'
import type { WorkerErrorResponse, WorkerRequest, WorkerResponse } from './worker'

const UPNG = ((UPNGMod as unknown as { default?: typeof UPNGMod }).default ?? UPNGMod) as typeof UPNGMod

/** 探测当前浏览器是否支持 AVIF 编码（结果缓存） */
let avifSupportPromise: Promise<boolean> | null = null
export function detectAvifSupport(): Promise<boolean> {
  if (avifSupportPromise) return avifSupportPromise
  avifSupportPromise = (async () => {
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        const c = new OffscreenCanvas(2, 2)
        const ctx = c.getContext('2d')
        ctx?.fillRect(0, 0, 2, 2)
        const b = await c.convertToBlob({ type: 'image/avif', quality: 0.8 })
        return b.type === 'image/avif'
      }
      const c = document.createElement('canvas')
      c.width = 2
      c.height = 2
      return await new Promise<boolean>((resolve) => {
        c.toBlob((b) => resolve(b?.type === 'image/avif'), 'image/avif', 0.8)
      })
    } catch {
      return false
    }
  })()
  return avifSupportPromise
}

/** 读取图片原始分辨率 */
export async function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  const dims = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return dims
}

/** 降级方案：当运行环境不支持 Worker + OffscreenCanvas 时在主线程执行压缩 */
async function compressOnMainThread(
  file: File,
  options: CompressOptions,
  avifSupported: boolean,
): Promise<CompressResult> {
  const start = performance.now()
  const bitmap = await createImageBitmap(file)
  const originalWidth = bitmap.width
  const originalHeight = bitmap.height
  try {
    const longest = Math.max(originalWidth, originalHeight)
    const resized = options.limitSize && options.maxDimension > 0 && longest > options.maxDimension
    const scale = resized ? options.maxDimension / longest : 1
    const width = Math.max(1, Math.round(originalWidth * scale))
    const height = Math.max(1, Math.round(originalHeight * scale))
    const targetMime: ConcreteMime = resolveTargetMime(file.type, options.format, avifSupported)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: targetMime === 'image/png' })!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    if (targetMime === 'image/jpeg') {
      ctx.fillStyle = options.jpegBg === 'transparent' ? '#ffffff' : options.jpegBg
      ctx.fillRect(0, 0, width, height)
    }
    ctx.drawImage(bitmap, 0, 0, width, height)

    let blob: Blob
    if (targetMime === 'image/png') {
      const cnum = qualityToPngColors(options.quality)
      if (cnum === 0) {
        blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 导出失败'))), 'image/png'),
        )
      } else {
        const imageData = ctx.getImageData(0, 0, width, height)
        const rgbaBuf = imageData.data.buffer.slice(
          imageData.data.byteOffset,
          imageData.data.byteOffset + imageData.data.byteLength,
        )
        const encoded = UPNG.encode([rgbaBuf], width, height, cnum)
        blob = new Blob([encoded], { type: 'image/png' })
      }
    } else {
      blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('图片编码失败'))),
          targetMime,
          Math.max(0.05, Math.min(1, options.quality / 100)),
        ),
      )
    }
    canvas.width = 0
    canvas.height = 0

    const sameFormat =
      file.type === targetMime || (file.type === 'image/jpg' && targetMime === 'image/jpeg')
    const keptOriginal = options.keepSmaller && sameFormat && !resized && blob.size >= file.size
    return {
      blob: keptOriginal ? file : blob,
      mime: targetMime,
      width,
      height,
      originalWidth,
      originalHeight,
      keptOriginal,
      durationMs: Math.max(1, Math.round(performance.now() - start)),
    }
  } finally {
    bitmap.close()
  }
}

interface PendingJob {
  resolve: (res: CompressResult) => void
  reject: (err: Error) => void
}

interface QueuedTask {
  file: File
  options: CompressOptions
  avifSupported: boolean
  resolve: (res: CompressResult) => void
  reject: (err: Error) => void
}

interface WorkerSlot {
  worker: Worker
  busy: boolean
}

/** 轻量级 Web Worker 并发池，用于批量无阻塞压缩 */
class CompressPool {
  private slots: WorkerSlot[] = []
  private pending = new Map<number, PendingJob>()
  private queue: QueuedTask[] = []
  private seq = 1
  private readonly maxWorkers =
    typeof navigator !== 'undefined' ? Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency || 2) / 2) || 2)) : 2

  private readonly supported = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'

  private createSlot(): WorkerSlot {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    const slot: WorkerSlot = { worker, busy: false }
    worker.addEventListener('message', (e: MessageEvent<WorkerResponse | WorkerErrorResponse>) => {
      const data = e.data
      const job = this.pending.get(data.id)
      this.pending.delete(data.id)
      slot.busy = false
      if (job) {
        if (data.ok) job.resolve(data.result)
        else job.reject(new Error(data.error))
      }
      this.pump()
    })
    worker.addEventListener('error', (err) => {
      slot.busy = false
      // 剔除异常 Worker，后续任务会按需重建
      this.slots = this.slots.filter((s) => s !== slot)
      worker.terminate()
      console.error('[image-compress worker]', err)
      this.pump()
    })
    this.slots.push(slot)
    return slot
  }

  private pump() {
    while (this.queue.length > 0) {
      let slot = this.slots.find((s) => !s.busy)
      if (!slot && this.slots.length < this.maxWorkers) {
        slot = this.createSlot()
      }
      if (!slot) return
      const task = this.queue.shift()!
      slot.busy = true
      const id = this.seq++
      this.pending.set(id, { resolve: task.resolve, reject: task.reject })
      const req: WorkerRequest = {
        id,
        file: task.file,
        options: task.options,
        avifSupported: task.avifSupported,
      }
      slot.worker.postMessage(req)
    }
  }

  compress(file: File, options: CompressOptions, avifSupported: boolean): Promise<CompressResult> {
    if (!this.supported) {
      return compressOnMainThread(file, options, avifSupported)
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ file, options, avifSupported, resolve, reject })
      this.pump()
    })
  }

  dispose() {
    this.slots.forEach((s) => s.worker.terminate())
    this.slots = []
    this.queue.forEach((q) => q.reject(new Error('任务已取消')))
    this.queue = []
    this.pending.clear()
  }
}

export const compressPool = new CompressPool()

/** 将批量压缩完成的图片打包为 ZIP（图片本身已压缩，使用 level 0 极速存储） */
export async function packCompressedZip(items: CompressItem[]): Promise<Blob> {
  const ready = items.filter((it) => it.status === 'done' && it.result)
  if (!ready.length) throw new Error('没有可打包的已完成图片')

  const entries: Record<string, Uint8Array> = {}
  const usedNames = new Map<string, number>()

  for (const item of ready) {
    const res = item.result!
    let name = outputFileName(item.file.name, res.mime)
    // 处理重名冲突，自动追加序号
    const count = usedNames.get(name) ?? 0
    if (count > 0) {
      const dot = name.lastIndexOf('.')
      name = dot > 0 ? `${name.slice(0, dot)}-${count + 1}${name.slice(dot)}` : `${name}-${count + 1}`
    }
    usedNames.set(outputFileName(item.file.name, res.mime), count + 1)

    const buf = await res.blob.arrayBuffer()
    entries[name] = new Uint8Array(buf)
  }

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 0 }, (err, data) => {
      if (err) reject(err)
      else resolve(data)
    })
  })
  const zipBuffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
  return new Blob([zipBuffer], { type: 'application/zip' })
}
