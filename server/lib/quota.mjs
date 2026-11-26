/**
 * 轻量级零数据库按自然天 + IP 配额管理器
 *
 * - 内存 Map 毫秒级读取与递增
 * - 每次扣减原子刷盘至 <dir>/quota-YYYY-MM-DD.json，重启自动续接不丢失
 * - 跨自然日（00:00）自动切换新日期清零，并自动清扫超过 retentionDays 的过期配额文件
 */

import fs from 'node:fs'
import path from 'node:path'
import { formatLocalDate, formatLocalDateTime } from './logger.mjs'

/** 创建按自然天持久化配额存储 */
export function createDailyQuotaStore({ dir, retentionDays = 14 }) {
  let currentDate = formatLocalDate()
  /** @type {{ date: string; updatedAt: string; usage: Record<string, Record<string, number>> }} */
  let state = { date: currentDate, updatedAt: formatLocalDateTime(), usage: {} }

  function getFilePath(dateStr) {
    return path.join(dir, `quota-${dateStr}.json`)
  }

  function cleanupExpiredSync() {
    const cutoffMs = Date.now() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000
    try {
      if (!fs.existsSync(dir)) return
      for (const name of fs.readdirSync(dir)) {
        const m = name.match(/^quota-(\d{4}-\d{2}-\d{2})\.json$/)
        if (!m) continue
        const fileMs = Date.parse(`${m[1]}T00:00:00`)
        if (Number.isFinite(fileMs) && fileMs < cutoffMs) {
          fs.rmSync(path.join(dir, name), { force: true })
        }
      }
    } catch {
      // 忽略清理异常
    }
  }

  function loadTodaySync() {
    try {
      fs.mkdirSync(dir, { recursive: true })
      const file = getFilePath(currentDate)
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (parsed && parsed.date === currentDate && parsed.usage && typeof parsed.usage === 'object') {
          state = parsed
        }
      }
      cleanupExpiredSync()
    } catch (err) {
      console.warn('[DailyQuota] 加载当日配额文件失败:', err.message)
    }
  }

  function persistSync() {
    state.updatedAt = formatLocalDateTime()
    const target = getFilePath(currentDate)
    const tmp = `${target}.tmp`
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
      fs.renameSync(tmp, target)
    } catch {
      try {
        fs.writeFileSync(target, JSON.stringify(state, null, 2), 'utf8')
      } catch {
        // 忽略极少数写入异常
      }
    }
  }

  function rotateIfNeeded() {
    const today = formatLocalDate()
    if (today !== currentDate) {
      currentDate = today
      state = { date: currentDate, updatedAt: formatLocalDateTime(), usage: {} }
      cleanupExpiredSync()
    }
  }

  loadTodaySync()

  return {
    /** 查询某功能某 IP 当日已用次数 */
    getUsed(scope, ip) {
      rotateIfNeeded()
      return Number(state.usage?.[scope]?.[ip] || 0)
    },

    /** 扣减（累加）某功能某 IP 当日使用次数并立即落盘 */
    consume(scope, ip, delta = 1) {
      rotateIfNeeded()
      if (!state.usage[scope]) state.usage[scope] = {}
      const next = Number(state.usage[scope][ip] || 0) + delta
      state.usage[scope][ip] = next
      persistSync()
      return next
    },

    /** 查询当日状态快照 */
    getDate() {
      rotateIfNeeded()
      return currentDate
    },
  }
}
