/**
 * 通用内存 TTL 缓存模块（带容量上限与定时清理，零第三方依赖）
 */

export class MemoryCache {
  /**
   * @param {object} [options]
   * @param {number} [options.maxEntries=5000] 最大缓存条目数，超出时淘汰最早写入项
   * @param {number} [options.cleanupIntervalMs=600000] 过期巡检间隔（默认 10 分钟）
   */
  constructor({ maxEntries = 5000, cleanupIntervalMs = 10 * 60 * 1000 } = {}) {
    this.maxEntries = maxEntries
    this.store = new Map()
    this.hits = 0
    this.misses = 0

    // 使用 unref() 避免定时器阻止 Node 进程优雅退出
    this.timer = setInterval(() => this.cleanup(), cleanupIntervalMs)
    this.timer.unref?.()
  }

  /**
   * 写入缓存
   * @param {string} key
   * @param {unknown} value
   * @param {number} [ttlSeconds=300]
   */
  set(key, value, ttlSeconds = 300) {
    if (this.store.has(key)) {
      this.store.delete(key)
    }
    while (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value
      if (oldestKey === undefined) break
      this.store.delete(oldestKey)
    }
    this.store.set(key, {
      value,
      expireAt: Date.now() + ttlSeconds * 1000,
    })
  }

  /**
   * 读取缓存（命中且未过期返回数据，否则返回 null）
   * @param {string} key
   */
  get(key) {
    const entry = this.store.get(key)
    if (!entry) {
      this.misses++
      return null
    }
    if (Date.now() > entry.expireAt) {
      this.store.delete(key)
      this.misses++
      return null
    }
    this.hits++
    return entry.value
  }

  /** 删除指定键 */
  delete(key) {
    this.store.delete(key)
  }

  /** 清理全部过期条目 */
  cleanup() {
    const now = Date.now()
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expireAt) {
        this.store.delete(key)
      }
    }
  }

  /** 输出运行时统计信息（供 /healthz 监控） */
  getStats() {
    return {
      entries: this.store.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
    }
  }

  /** 关闭定时器释放资源 */
  close() {
    clearInterval(this.timer)
    this.store.clear()
  }
}

export const sharedCache = new MemoryCache()
