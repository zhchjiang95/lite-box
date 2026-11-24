import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  Copy,
  Download,
  Filter,
  Loader2,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  Sparkles,
  Trophy,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { downloadBlob, timestampName } from '@/lib/file'
import { cn } from '@/lib/utils'
import {
  buildResultsCsv,
  buildResultsTsv,
  extractLeagues,
  fetchMatchResults,
  formatYYYYMMDD,
  parseOddsNumber,
  type MatchResultRow,
} from './api'

type DatePreset = 'today' | '3days' | '7days' | '30days' | '90days' | 'custom'
type HadFilter = 'all' | '胜' | '平' | '负'
type SortKey = 'default' | 'scoreOdds' | 'hadOdds' | 'hhadOdds' | 'ttgOdds' | 'hafuOdds'
type SortDir = 'desc' | 'asc'

/** 当用户筛选指定联赛时，保证表格至少呈现的目标条数 */
const MIN_LEAGUE_DISPLAY_COUNT = 10
/** 单次自动补齐最大连续追加页数上限，防止极冷门联赛无休止拉取 */
const MAX_AUTO_PULL_PAGES = 8
/** 单页容量 */
const PAGE_SIZE = 40

const DATE_PRESETS: { id: Exclude<DatePreset, 'custom'>; label: string; days: number }[] = [
  { id: 'today', label: '今日', days: 0 },
  { id: '3days', label: '近3天', days: 2 },
  { id: '7days', label: '近7天', days: 6 },
  { id: '30days', label: '近30天', days: 29 },
  { id: '90days', label: '近90天', days: 89 },
]

/** 根据官方 6 位十六进制色值生成安全徽章样式 */
function normalizeHexColor(raw: string): string {
  const clean = (raw || '').replace(/^#/, '').trim()
  return /^[0-9a-fA-F]{6}$/.test(clean) ? `#${clean}` : '#3b82f6'
}

export default function SportteryResultsTool() {
  const todayStr = useMemo(() => formatYYYYMMDD(new Date()), [])
  const defaultStartStr = useMemo(() => formatYYYYMMDD(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)), [])

  // 日期筛选状态
  const [activeRange, setActiveRange] = useState<DatePreset>('3days')
  const [startDate, setStartDate] = useState(defaultStartStr)
  const [endDate, setEndDate] = useState(todayStr)

  // 数据与分页状态
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [autoPulling, setAutoPulling] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [resultsList, setResultsList] = useState<MatchResultRow[]>([])
  const [total, setTotal] = useState(0)
  const [pageNo, setPageNo] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [lastUpdateTime, setLastUpdateTime] = useState('')

  // 本地过滤、排序与展示选项
  const [selectedLeague, setSelectedLeague] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [hadFilter, setHadFilter] = useState<HadFilter>('all')
  const [onlySingle, setOnlySingle] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('default')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [freezeLeftCols, setFreezeLeftCols] = useState(true)

  // 竞态控制序列号与最新状态引用
  const querySeqRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef({
    resultsList,
    total,
    pageNo,
    hasMore,
    selectedLeague,
    startDate,
    endDate,
    loading,
    loadingMore,
  })
  stateRef.current = {
    resultsList,
    total,
    pageNo,
    hasMore,
    selectedLeague,
    startDate,
    endDate,
    loading,
    loadingMore,
  }

  /** 按联赛过滤的基数（用于判断是否需要自动补齐分页） */
  const countLeagueMatches = (list: MatchResultRow[], league: string) =>
    league ? list.filter((r) => r.league === league).length : list.length

  /**
   * 后台连续拉取后续分页，确保选定联赛至少展示 MIN_LEAGUE_DISPLAY_COUNT 条（带防竞态与熔断保护）
   */
  const ensureLeagueResults = useCallback(
    async (
      seq: number,
      targetLeague: string,
      currentList: MatchResultRow[],
      currentPage: number,
      currentTotal: number,
      currentHasMore: boolean,
      qStart: string,
      qEnd: string,
    ) => {
      if (!targetLeague || !currentHasMore) return
      let merged = currentList
      let page = currentPage
      let tot = currentTotal
      let more: boolean = currentHasMore
      let step = 0

      setAutoPulling(true)
      setLoadingMore(true)

      try {
        while (
          countLeagueMatches(merged, targetLeague) < MIN_LEAGUE_DISPLAY_COUNT &&
          more &&
          step < MAX_AUTO_PULL_PAGES
        ) {
          if (seq !== querySeqRef.current) return
          page += 1
          step += 1
          const data = await fetchMatchResults({
            startDate: qStart,
            endDate: qEnd,
            pageNo: page,
            pageSize: PAGE_SIZE,
            signal: abortRef.current?.signal,
          })
          if (seq !== querySeqRef.current) return

          const appended = data.results || []
          tot = data.total || tot
          // 按 matchId 去重合并，防止跨页临界重复
          const seen = new Set(merged.map((m) => String(m.matchId)))
          const deduped = appended.filter((m) => !seen.has(String(m.matchId)))
          merged = [...merged, ...deduped]
          more = merged.length < tot && appended.length >= PAGE_SIZE

          setResultsList(merged)
          setTotal(tot)
          setPageNo(page)
          setHasMore(more)
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          console.warn('[sporttery] 自动补齐联赛分页异常:', err)
        }
      } finally {
        if (seq === querySeqRef.current) {
          setAutoPulling(false)
          setLoadingMore(false)
        }
      }
    },
    [],
  )

  /**
   * 加载首屏或翻页赛果数据
   */
  const loadResults = useCallback(
    async (opts?: {
      start?: string
      end?: string
      append?: boolean
      forceRefresh?: boolean
      targetLeague?: string
    }) => {
      const qStart = opts?.start ?? stateRef.current.startDate
      const qEnd = opts?.end ?? stateRef.current.endDate
      const isAppend = Boolean(opts?.append)
      const leagueToKeep = opts?.targetLeague ?? stateRef.current.selectedLeague

      let seq = querySeqRef.current
      let nextPage = 1

      if (!isAppend) {
        abortRef.current?.abort()
        abortRef.current = new AbortController()
        seq = ++querySeqRef.current
        setLoading(true)
        setLoadingMore(false)
        setAutoPulling(false)
        setErrorMsg(null)
        setPageNo(1)
        setHasMore(true)
      } else {
        if (stateRef.current.loading || stateRef.current.loadingMore || !stateRef.current.hasMore) return
        nextPage = stateRef.current.pageNo + 1
        setLoadingMore(true)
      }

      try {
        const data = await fetchMatchResults({
          startDate: qStart,
          endDate: qEnd,
          pageNo: nextPage,
          pageSize: PAGE_SIZE,
          refresh: Boolean(opts?.forceRefresh),
          signal: abortRef.current?.signal,
        })

        if (seq !== querySeqRef.current) return

        const incoming = data.results || []
        const tot = data.total || incoming.length
        let merged: MatchResultRow[]
        if (isAppend) {
          const seen = new Set(stateRef.current.resultsList.map((m) => String(m.matchId)))
          merged = [...stateRef.current.resultsList, ...incoming.filter((m) => !seen.has(String(m.matchId)))]
        } else {
          merged = incoming
        }

        const more = merged.length < tot && incoming.length >= PAGE_SIZE

        setResultsList(merged)
        setTotal(tot)
        setPageNo(nextPage)
        setHasMore(more)
        setLastUpdateTime(data.lastUpdateTime || '最新')
        setLoading(false)
        setLoadingMore(false)

        // 若选定了特定联赛且当前条数不足 10 条且服务端还有数据，自动连续补齐
        if (leagueToKeep && countLeagueMatches(merged, leagueToKeep) < MIN_LEAGUE_DISPLAY_COUNT && more) {
          await ensureLeagueResults(seq, leagueToKeep, merged, nextPage, tot, more, qStart, qEnd)
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        if (seq !== querySeqRef.current) return
        const msg = err instanceof Error ? err.message : '加载赛果数据失败'
        setErrorMsg(msg)
        // 请求失败时立即暂停后续触底翻页，防止在空列表或服务未启动时无限重试
        setHasMore(false)
        toast.error(msg)
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [ensureLeagueResults],
  )

  // 首次挂载自动拉取
  useEffect(() => {
    loadResults({ start: defaultStartStr, end: todayStr })
    return () => {
      abortRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 底部哨兵自动触发无限加载（仅在已有首屏数据、无报错且仍有下一页时激活，杜绝空表或断网死循环）
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore || loading || loadingMore || errorMsg || resultsList.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadResults({ append: true })
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loading, loadingMore, errorMsg, resultsList.length, loadResults])

  // 快捷日期范围切换
  const handlePresetDate = (preset: Exclude<DatePreset, 'custom'>) => {
    const meta = DATE_PRESETS.find((p) => p.id === preset)!
    const now = new Date()
    const start = new Date(now.getTime() - meta.days * 24 * 60 * 60 * 1000)
    const sStr = formatYYYYMMDD(start)
    const eStr = formatYYYYMMDD(now)
    setActiveRange(preset)
    setStartDate(sStr)
    setEndDate(eStr)
    loadResults({ start: sStr, end: eStr })
  }

  // 自定义开始日期（含 90 天最大跨度自动保护）
  const handleStartDateChange = (newStart: string) => {
    if (!newStart) return
    let nextEnd = endDate
    const sTs = new Date(`${newStart}T00:00:00`).getTime()
    const eTs = new Date(`${nextEnd}T00:00:00`).getTime()
    if (sTs > eTs) {
      nextEnd = newStart
    } else if (eTs - sTs > 89 * 24 * 60 * 60 * 1000) {
      nextEnd = formatYYYYMMDD(new Date(sTs + 89 * 24 * 60 * 60 * 1000))
      toast.info('体彩官方单次查询最大跨度为 90 天，已自动调整结束日期')
    }
    setActiveRange('custom')
    setStartDate(newStart)
    setEndDate(nextEnd)
    loadResults({ start: newStart, end: nextEnd })
  }

  // 自定义结束日期（含 90 天最大跨度自动保护）
  const handleEndDateChange = (newEnd: string) => {
    if (!newEnd) return
    let nextStart = startDate
    const sTs = new Date(`${nextStart}T00:00:00`).getTime()
    const eTs = new Date(`${newEnd}T00:00:00`).getTime()
    if (sTs > eTs) {
      nextStart = newEnd
    } else if (eTs - sTs > 89 * 24 * 60 * 60 * 1000) {
      nextStart = formatYYYYMMDD(new Date(eTs - 89 * 24 * 60 * 60 * 1000))
      toast.info('体彩官方单次查询最大跨度为 90 天，已自动调整开始日期')
    }
    setActiveRange('custom')
    setStartDate(nextStart)
    setEndDate(newEnd)
    loadResults({ start: nextStart, end: newEnd })
  }

  // 选择联赛（不足 10 条且服务端还有更多数据时自动补齐）
  const handleSelectLeague = (leagueName: string) => {
    setSelectedLeague(leagueName)
    if (
      leagueName &&
      countLeagueMatches(resultsList, leagueName) < MIN_LEAGUE_DISPLAY_COUNT &&
      hasMore &&
      !loading &&
      !loadingMore
    ) {
      ensureLeagueResults(querySeqRef.current, leagueName, resultsList, pageNo, total, hasMore, startDate, endDate)
    }
  }

  // 点击可排序表头
  const toggleSort = (key: Exclude<SortKey, 'default'>) => {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir('desc')
    } else if (sortDir === 'desc') {
      setSortDir('asc')
    } else {
      setSortKey('default')
    }
  }

  // 联赛列表提取
  const leagueList = useMemo(() => extractLeagues(resultsList), [resultsList])

  // 综合筛选与排序后的最终列表
  const displayedRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const filtered = resultsList.filter((item) => {
      if (selectedLeague && item.league !== selectedLeague) return false
      if (hadFilter !== 'all' && item.hadResult !== hadFilter) return false
      if (onlySingle && item.isSingle !== '是') return false
      if (q) {
        const hay = `${item.homeTeam} ${item.awayTeam} ${item.league} ${item.matchNumStr} ${item.matchDate} ${item.score}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    if (sortKey === 'default') return filtered

    return [...filtered].sort((a, b) => {
      const va = parseOddsNumber(a[sortKey])
      const vb = parseOddsNumber(b[sortKey])
      if (va === -1 && vb === -1) return 0
      if (va === -1) return 1
      if (vb === -1) return -1
      return sortDir === 'desc' ? vb - va : va - vb
    })
  }, [resultsList, selectedLeague, hadFilter, onlySingle, searchQuery, sortKey, sortDir])

  // 统计概览（胜/平/负分布、单关场次、最高比分赔率冷门）
  const stats = useMemo(() => {
    let win = 0
    let draw = 0
    let lose = 0
    let single = 0
    let maxScoreRow: MatchResultRow | null = null
    let maxScoreVal = -1

    for (const r of displayedRows) {
      if (r.hadResult === '胜') win++
      else if (r.hadResult === '平') draw++
      else if (r.hadResult === '负') lose++
      if (r.isSingle === '是') single++

      const sp = parseOddsNumber(r.scoreOdds)
      if (sp > maxScoreVal) {
        maxScoreVal = sp
        maxScoreRow = r
      }
    }
    return { win, draw, lose, single, maxScoreRow, maxScoreVal }
  }, [displayedRows])

  // 导出 Excel 兼容 CSV
  const handleExportCsv = () => {
    if (displayedRows.length === 0) {
      toast.error('当前没有可导出的赛果数据')
      return
    }
    const csv = buildResultsCsv(displayedRows)
    const tag = selectedLeague ? `sporttery-${selectedLeague}` : 'sporttery-results'
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), timestampName(tag, 'csv'))
    toast.success(`已导出 ${displayedRows.length} 场赛果（Excel 兼容 UTF-8 CSV）`)
  }

  // 复制表格（制表符分隔，可直接粘贴进 Excel / 飞书 / WPS）
  const handleCopyTable = async () => {
    if (displayedRows.length === 0) {
      toast.error('当前没有可复制的赛果数据')
      return
    }
    try {
      await navigator.clipboard.writeText(buildResultsTsv(displayedRows))
      toast.success(`已复制 ${displayedRows.length} 场数据，可直接粘贴到 Excel 自动分列`)
    } catch {
      toast.error('复制失败，请尝试导出 CSV')
    }
  }

  const renderSortIcon = (key: Exclude<SortKey, 'default'>) => {
    if (sortKey !== key) return <ArrowUpDown className="size-3 opacity-40" />
    return sortDir === 'desc' ? <ArrowDown className="text-primary size-3" /> : <ArrowUp className="text-primary size-3" />
  }

  return (
    <div className="space-y-4">
      {/* ================= 顶部综合筛选与导出面板 ================= */}
      <section className="glass shadow-soft space-y-3.5 rounded-2xl p-4">
        {/* 第一行：日期范围 + 刷新/导出 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handlePresetDate(p.id)}
                className={cn(
                  'rounded-xl px-3 py-1.5 text-xs font-medium transition',
                  activeRange === p.id
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'bg-foreground/[0.05] text-muted-foreground hover:text-foreground',
                )}
              >
                {p.label}
              </button>
            ))}

            {/* 自定义日期选择 */}
            <div className="border-border/70 bg-background/60 ml-0.5 flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs">
              <Calendar className="text-muted-foreground size-3.5 shrink-0" />
              <input
                type="date"
                value={startDate}
                max={todayStr}
                onChange={(e) => handleStartDateChange(e.target.value)}
                className="bg-transparent font-mono text-xs outline-none"
                aria-label="开始日期"
              />
              <span className="text-muted-foreground">至</span>
              <input
                type="date"
                value={endDate}
                max={todayStr}
                onChange={(e) => handleEndDateChange(e.target.value)}
                className="bg-transparent font-mono text-xs outline-none"
                aria-label="结束日期"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={loading}
              onClick={() => loadResults({ forceRefresh: true })}
              title="绕过后端 5 分钟缓存，强制同步体彩最新开奖"
            >
              <RefreshCw className={cn('!size-3.5', loading && 'animate-spin')} />
              刷新
            </Button>
            <Button
              size="sm"
              variant={freezeLeftCols ? 'secondary' : 'ghost'}
              onClick={() => setFreezeLeftCols((v) => !v)}
              title={freezeLeftCols ? '已冻结左侧对阵列，横滑赔率不迷路' : '开启冻结左侧对阵列'}
            >
              {freezeLeftCols ? <Pin className="!size-3.5" /> : <PinOff className="!size-3.5" />}
              <span className="hidden sm:inline">冻结对阵</span>
            </Button>
            <Button size="sm" variant="outline" disabled={displayedRows.length === 0} onClick={handleCopyTable}>
              <Copy className="!size-3.5" />
              复制表格
            </Button>
            <Button size="sm" variant="primary" disabled={displayedRows.length === 0} onClick={handleExportCsv}>
              <Download className="!size-3.5" />
              导出 Excel
            </Button>
          </div>
        </div>

        {/* 第二行：队名搜索 + 胜平负/单关筛选 */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="relative min-w-[210px] flex-1 max-w-sm">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜队名 / 联赛 / 场次编号 / 比分…"
              className="border-border/70 bg-background/60 focus:border-primary focus:ring-primary/20 w-full rounded-xl border py-1.5 pr-8 pl-8 text-xs outline-none transition focus:ring-2"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="bg-foreground/[0.05] inline-flex items-center rounded-xl p-0.5">
              {(['all', '胜', '平', '负'] as const).map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setHadFilter(val)}
                  className={cn(
                    'rounded-lg px-2.5 py-1 font-medium transition',
                    hadFilter === val
                      ? val === '胜'
                        ? 'bg-rose-500 text-white shadow-xs'
                        : val === '平'
                          ? 'bg-sky-500 text-white shadow-xs'
                          : val === '负'
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'bg-card-solid text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {val === 'all' ? '全部赛果' : `主${val}`}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setOnlySingle((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 font-medium transition',
                onlySingle
                  ? 'border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  : 'border-border/70 text-muted-foreground hover:text-foreground',
              )}
            >
              <Sparkles className="size-3.5" />
              仅看单关
            </button>

            {sortKey !== 'default' && (
              <button
                type="button"
                onClick={() => setSortKey('default')}
                className="text-primary hover:underline text-xs font-medium"
              >
                重置排序
              </button>
            )}
          </div>
        </div>

        {/* 第三行：联赛快捷过滤胶囊 */}
        {leagueList.length > 0 && (
          <div className="flex items-center gap-2">
            <Filter className="text-muted-foreground size-3.5 shrink-0" />
            <div className="flex flex-1 items-center gap-1.5 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => handleSelectLeague('')}
                className={cn(
                  'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition',
                  selectedLeague === ''
                    ? 'bg-foreground text-background'
                    : 'bg-foreground/[0.06] text-muted-foreground hover:text-foreground',
                )}
              >
                全部联赛 ({resultsList.length})
              </button>
              {leagueList.map((lg) => (
                <button
                  key={lg.leagueId}
                  type="button"
                  onClick={() => handleSelectLeague(lg.leagueId)}
                  className={cn(
                    'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition',
                    selectedLeague === lg.leagueId
                      ? 'bg-primary text-primary-foreground shadow-xs'
                      : 'bg-foreground/[0.06] text-muted-foreground hover:text-foreground',
                  )}
                >
                  {lg.leagueAbbName}
                  <span className="ml-1 opacity-70">{lg.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ================= 赛果洞察概览条 ================= */}
      {!loading && resultsList.length > 0 && (
        <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-semibold">
              当前展示 <span className="text-primary font-mono text-sm">{displayedRows.length}</span> 场
              <span className="text-muted-foreground ml-1 font-normal">
                （已载入 {resultsList.length} / 总计 {total} 场）
              </span>
            </span>

            <div className="flex items-center gap-2 font-mono">
              <span className="text-rose-600 dark:text-rose-400">胜 {stats.win}</span>
              <span className="text-sky-600 dark:text-sky-400">平 {stats.draw}</span>
              <span className="text-emerald-600 dark:text-emerald-400">负 {stats.lose}</span>
              <span className="text-amber-600 dark:text-amber-400">单关 {stats.single}</span>
            </div>
          </div>

          {stats.maxScoreRow && stats.maxScoreVal > 0 && (
            <div className="text-muted-foreground flex items-center gap-1.5">
              <Trophy className="size-3.5 text-amber-500" />
              <span>
                最高比分 SP：
                <strong className="text-foreground">
                  {stats.maxScoreRow.homeTeam} {stats.maxScoreRow.score} {stats.maxScoreRow.awayTeam}
                </strong>{' '}
                <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                  {stats.maxScoreRow.scoreOdds}
                </span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* ================= 错误提示条 ================= */}
      {errorMsg && !loading && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/[0.06] px-4 py-3 text-xs text-rose-600 dark:text-rose-400">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <Button size="sm" variant="outline" onClick={() => loadResults({ forceRefresh: true })}>
            重试加载
          </Button>
        </div>
      )}

      {/* ================= 核心 15 列大宽表 ================= */}
      <section className="glass shadow-soft overflow-hidden rounded-2xl border">
        <div className="max-h-[calc(100dvh-280px)] min-h-[360px] overflow-auto">
          <table className="w-full min-w-[1220px] border-collapse text-xs">
            <thead className="bg-card-solid/95 sticky top-0 z-20 backdrop-blur-md">
              <tr className="border-border/70 text-muted-foreground border-b">
                <th
                  className={cn(
                    'bg-card-solid/95 w-[108px] px-3 py-3 text-left font-semibold',
                    freezeLeftCols && 'sticky left-0 z-30',
                  )}
                >
                  赛季 / 场次
                </th>
                <th
                  className={cn(
                    'bg-card-solid/95 w-[86px] px-2.5 py-3 text-center font-semibold',
                    freezeLeftCols && 'sticky left-[108px] z-30',
                  )}
                >
                  联赛
                </th>
                <th
                  className={cn(
                    'bg-card-solid/95 w-[124px] px-2.5 py-3 text-right font-semibold',
                    freezeLeftCols && 'sticky left-[194px] z-30',
                  )}
                >
                  主队
                </th>
                <th
                  className={cn(
                    'bg-card-solid/95 w-[124px] px-2.5 py-3 text-left font-semibold',
                    freezeLeftCols && 'border-border/60 sticky left-[318px] z-30 border-r shadow-[4px_0_10px_-6px_rgba(0,0,0,0.2)]',
                  )}
                >
                  客队
                </th>
                <th className="w-[82px] px-2.5 py-3 text-center font-semibold">比分</th>
                <th className="w-[78px] px-2 py-3 text-center font-semibold">
                  <button
                    type="button"
                    onClick={() => toggleSort('scoreOdds')}
                    className="hover:text-foreground inline-flex items-center gap-1"
                  >
                    比分赔率
                    {renderSortIcon('scoreOdds')}
                  </button>
                </th>
                <th className="w-[76px] px-2 py-3 text-center font-semibold">胜/平/负</th>
                <th className="w-[74px] px-2 py-3 text-center font-semibold">
                  <button
                    type="button"
                    onClick={() => toggleSort('hadOdds')}
                    className="hover:text-foreground inline-flex items-center gap-1"
                  >
                    赔率
                    {renderSortIcon('hadOdds')}
                  </button>
                </th>
                <th className="w-[96px] px-2 py-3 text-center font-semibold">让球胜/平/负</th>
                <th className="w-[74px] px-2 py-3 text-center font-semibold">
                  <button
                    type="button"
                    onClick={() => toggleSort('hhadOdds')}
                    className="hover:text-foreground inline-flex items-center gap-1"
                  >
                    赔率
                    {renderSortIcon('hhadOdds')}
                  </button>
                </th>
                <th className="w-[74px] px-2 py-3 text-center font-semibold">总进球</th>
                <th className="w-[74px] px-2 py-3 text-center font-semibold">
                  <button
                    type="button"
                    onClick={() => toggleSort('ttgOdds')}
                    className="hover:text-foreground inline-flex items-center gap-1"
                  >
                    赔率
                    {renderSortIcon('ttgOdds')}
                  </button>
                </th>
                <th className="w-[76px] px-2 py-3 text-center font-semibold">半全场</th>
                <th className="w-[74px] px-2 py-3 text-center font-semibold">
                  <button
                    type="button"
                    onClick={() => toggleSort('hafuOdds')}
                    className="hover:text-foreground inline-flex items-center gap-1"
                  >
                    赔率
                    {renderSortIcon('hafuOdds')}
                  </button>
                </th>
                <th className="w-[76px] px-2 py-3 text-center font-semibold">是否单关</th>
              </tr>
            </thead>

            <tbody className="divide-border/45 divide-y">
              {loading ? (
                Array.from({ length: 8 }).map((_, idx) => (
                  <tr key={idx} className="animate-pulse">
                    {Array.from({ length: 15 }).map((__, cIdx) => (
                      <td key={cIdx} className="px-3 py-3.5">
                        <div className="bg-foreground/10 mx-auto h-4 w-14 rounded-md" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : displayedRows.length === 0 ? (
                <tr>
                  <td colSpan={15} className="py-16 text-center">
                    <div className="text-muted-foreground flex flex-col items-center gap-2.5">
                      <Trophy className="size-9 opacity-30" />
                      <div className="text-sm font-medium">
                        {selectedLeague
                          ? `当前日期范围内暂无【${selectedLeague}】匹配赛果`
                          : '当前筛选条件下暂无已完赛开奖记录'}
                      </div>
                      {(selectedLeague || searchQuery || hadFilter !== 'all' || onlySingle) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedLeague('')
                            setSearchQuery('')
                            setHadFilter('all')
                            setOnlySingle(false)
                          }}
                        >
                          重置所有筛选条件（全部 {resultsList.length} 场）
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                displayedRows.map((row, idx) => {
                  const stripeBg = idx % 2 === 1 ? 'bg-foreground/[0.02]' : 'bg-card-solid/70'
                  return (
                    <tr key={`${row.matchId}-${idx}`} className={cn('hover:bg-primary/[0.05] group transition', stripeBg)}>
                      {/* 1. 赛季 / 日期场次 */}
                      <td
                        className={cn(
                          'px-3 py-2.5',
                          freezeLeftCols && 'bg-card-solid group-hover:bg-card-solid sticky left-0 z-10',
                        )}
                      >
                        <div className="font-mono font-semibold tabular-nums">{row.matchNumStr || row.season}</div>
                        <div className="text-muted-foreground font-mono text-[11px] tabular-nums">{row.matchDate}</div>
                      </td>

                      {/* 2. 联赛 */}
                      <td
                        className={cn(
                          'px-2 py-2.5 text-center',
                          freezeLeftCols && 'bg-card-solid group-hover:bg-card-solid sticky left-[108px] z-10',
                        )}
                      >
                        <span
                          className="inline-block max-w-[76px] truncate rounded-md px-2 py-0.5 text-[11px] font-semibold text-white shadow-2xs"
                          style={{ backgroundColor: normalizeHexColor(row.leagueColor) }}
                          title={row.league}
                        >
                          {row.league || '--'}
                        </span>
                      </td>

                      {/* 3. 主队 */}
                      <td
                        className={cn(
                          'px-2.5 py-2.5 text-right font-semibold',
                          freezeLeftCols && 'bg-card-solid group-hover:bg-card-solid sticky left-[194px] z-10',
                        )}
                      >
                        <span className="line-clamp-1" title={row.homeTeam}>
                          {row.homeTeam}
                        </span>
                      </td>

                      {/* 4. 客队 */}
                      <td
                        className={cn(
                          'px-2.5 py-2.5 text-left font-semibold',
                          freezeLeftCols &&
                            'border-border/60 bg-card-solid group-hover:bg-card-solid sticky left-[318px] z-10 border-r shadow-[4px_0_10px_-6px_rgba(0,0,0,0.18)]',
                        )}
                      >
                        <span className="line-clamp-1" title={row.awayTeam}>
                          {row.awayTeam}
                        </span>
                      </td>

                      {/* 5. 比分 & 半场 */}
                      <td className="px-2 py-2.5 text-center">
                        <div className="font-mono text-sm font-bold text-emerald-600 tabular-nums dark:text-emerald-400">
                          {row.score}
                        </div>
                        {row.halfScore && row.halfScore !== '--' && (
                          <div className="text-muted-foreground font-mono text-[10px] tabular-nums">
                            半 {row.halfScore}
                          </div>
                        )}
                      </td>

                      {/* 6. 比分赔率 */}
                      <td className="px-2 py-2.5 text-center font-mono font-semibold text-amber-600 tabular-nums dark:text-amber-400">
                        {row.scoreOdds}
                      </td>

                      {/* 7. 胜/平/负 */}
                      <td className="px-2 py-2.5 text-center">
                        <span
                          className={cn(
                            'inline-flex min-w-[30px] items-center justify-center rounded-md px-2 py-0.5 text-[11px] font-bold',
                            row.hadResult === '胜'
                              ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                              : row.hadResult === '平'
                                ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                                : row.hadResult === '负'
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                  : 'bg-foreground/[0.06] text-muted-foreground',
                          )}
                        >
                          {row.hadResult}
                        </span>
                      </td>

                      {/* 8. 胜平负赔率 */}
                      <td className="px-2 py-2.5 text-center font-mono font-semibold text-amber-600 tabular-nums dark:text-amber-400">
                        {row.hadOdds}
                      </td>

                      {/* 9. 让球胜/平/负 */}
                      <td className="px-2 py-2.5 text-center">
                        <span className="bg-foreground/[0.06] inline-block rounded-md px-2 py-0.5 font-mono text-[11px] font-medium">
                          {row.hhadResult}
                        </span>
                      </td>

                      {/* 10. 让球赔率 */}
                      <td className="px-2 py-2.5 text-center font-mono font-semibold text-amber-600 tabular-nums dark:text-amber-400">
                        {row.hhadOdds}
                      </td>

                      {/* 11. 总进球 */}
                      <td className="px-2 py-2.5 text-center font-medium">{row.ttgResult}</td>

                      {/* 12. 总进球赔率 */}
                      <td className="px-2 py-2.5 text-center font-mono font-semibold text-amber-600 tabular-nums dark:text-amber-400">
                        {row.ttgOdds}
                      </td>

                      {/* 13. 半全场 */}
                      <td className="px-2 py-2.5 text-center font-medium">{row.hafuResult}</td>

                      {/* 14. 半全场赔率 */}
                      <td className="px-2 py-2.5 text-center font-mono font-semibold text-amber-600 tabular-nums dark:text-amber-400">
                        {row.hafuOdds}
                      </td>

                      {/* 15. 是否单关 */}
                      <td className="px-2 py-2.5 text-center">
                        {row.isSingle === '是' ? (
                          <span className="inline-flex items-center rounded-md bg-gradient-to-r from-amber-500 to-orange-500 px-2 py-0.5 text-[11px] font-bold text-white shadow-2xs">
                            单关
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">否</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>

          {/* 触底自动加载哨兵与底部状态条 */}
          <div ref={sentinelRef} className="border-border/50 flex flex-col items-center justify-center gap-2 border-t px-4 py-3.5 text-xs">
            {loadingMore ? (
              <div className="text-primary flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                <span>
                  {autoPulling && selectedLeague
                    ? `正在自动检索【${selectedLeague}】更多赛果（已找到 ${displayedRows.length} 场）…`
                    : '正在加载下一页完赛赛果…'}
                </span>
              </div>
            ) : hasMore && resultsList.length > 0 ? (
              <Button size="sm" variant="outline" onClick={() => loadResults({ append: true })}>
                加载更多赛果（已加载 {resultsList.length} / {total} 场）
              </Button>
            ) : resultsList.length > 0 ? (
              <span className="text-muted-foreground">
                ✓ 已加载当前日期范围内全部 {total} 场完赛记录
              </span>
            ) : null}

            <div className="text-muted-foreground/75 text-center text-[11px]">
              数据同步自中国体育彩票官方竞彩网{lastUpdateTime ? ` · ${lastUpdateTime}` : ''} ｜ 仅供体育赛事分析与统计研究，未满 18 周岁禁止购彩
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
