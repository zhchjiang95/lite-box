import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Clock,
  FileText,
  Globe,
  ListVideo,
  Loader2,
  Play,
  Plus,
  Radio,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { cn } from '@/lib/utils'
import { buildStreamProxyUrl } from './engine'
import {
  parsePlaylistText,
  SAMPLE_STREAMS,
  type ChannelItem,
  type PlayHistoryItem,
} from './playlist'

type SidebarTab = 'channels' | 'favorites' | 'history'

interface ChannelSidebarProps {
  currentUrl: string
  channels: ChannelItem[]
  favorites: ChannelItem[]
  history: PlayHistoryItem[]
  useProxy: boolean
  proxyToken: string
  onPlayChannel: (ch: ChannelItem) => void
  onPlayHistory: (item: PlayHistoryItem) => void
  onImportChannels: (items: ChannelItem[], mode: 'replace' | 'append') => void
  onClearChannels: () => void
  onToggleFavorite: (ch: ChannelItem) => void
  onClearHistory: () => void
}

export function ChannelSidebar({
  currentUrl,
  channels,
  favorites,
  history,
  useProxy,
  proxyToken,
  onPlayChannel,
  onPlayHistory,
  onImportChannels,
  onClearChannels,
  onToggleFavorite,
  onClearHistory,
}: ChannelSidebarProps) {
  const [tab, setTab] = useState<SidebarTab>('channels')
  const [search, setSearch] = useState('')
  const [activeGroup, setActiveGroup] = useState<string>('全部')
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [remoteM3uUrl, setRemoteM3uUrl] = useState('')
  const [fetchingRemote, setFetchingRemote] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 合并内置测试源与用户导入频道
  const allChannels = useMemo(() => {
    return channels.length > 0 ? [...channels, ...SAMPLE_STREAMS] : SAMPLE_STREAMS
  }, [channels])

  const groups = useMemo(() => {
    const set = new Set<string>(['全部'])
    allChannels.forEach((c) => set.add(c.group || '未分组'))
    return Array.from(set)
  }, [allChannels])

  const favUrlSet = useMemo(() => new Set(favorites.map((f) => f.url)), [favorites])

  const filteredChannels = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allChannels.filter((c) => {
      if (activeGroup !== '全部' && (c.group || '未分组') !== activeGroup) return false
      if (!q) return true
      return (
        c.name.toLowerCase().includes(q) ||
        c.group.toLowerCase().includes(q) ||
        c.url.toLowerCase().includes(q)
      )
    })
  }, [allChannels, activeGroup, search])

  const handleParsePaste = (mode: 'replace' | 'append') => {
    const parsed = parsePlaylistText(importText)
    if (parsed.length === 0) {
      toast.error('未解析出有效直播/视频地址，请检查格式（支持 .m3u / 频道名,地址 / 每行一个 URL）')
      return
    }
    onImportChannels(parsed, mode)
    setImportText('')
    setImportOpen(false)
    setActiveGroup('全部')
    setTab('channels')
    toast.success(`已${mode === 'replace' ? '导入' : '追加'} ${parsed.length} 个频道`)
  }

  const handleLocalPlaylistFile = async (file?: File) => {
    if (!file) return
    try {
      const text = await file.text()
      const parsed = parsePlaylistText(text, file.name.replace(/\.[^.]+$/, ''))
      if (parsed.length === 0) {
        toast.error('文件中未找到有效播放地址')
        return
      }
      onImportChannels(parsed, 'replace')
      setImportOpen(false)
      setActiveGroup('全部')
      setTab('channels')
      toast.success(`已从「${file.name}」导入 ${parsed.length} 个频道`)
    } catch {
      toast.error('读取列表文件失败')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleFetchRemoteM3u = async () => {
    const u = remoteM3uUrl.trim()
    if (!/^https?:\/\//i.test(u)) {
      toast.error('请输入以 http:// 或 https:// 开头的 M3U / TXT 订阅地址')
      return
    }
    setFetchingRemote(true)
    try {
      const fetchUrl = useProxy ? buildStreamProxyUrl(u, { token: proxyToken }) : u
      const res = await fetch(fetchUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      const parsed = parsePlaylistText(text, '在线订阅')
      if (parsed.length === 0) {
        throw new Error('订阅内容未包含可解析的频道地址')
      }
      onImportChannels(parsed, 'replace')
      setRemoteM3uUrl('')
      setImportOpen(false)
      setActiveGroup('全部')
      setTab('channels')
      toast.success(`已拉取在线列表，共 ${parsed.length} 个频道`)
    } catch (err) {
      toast.error(
        `拉取失败：${err instanceof Error ? err.message : '可能受跨域限制，可尝试先开启后端跨域代理'}`,
      )
    } finally {
      setFetchingRemote(false)
    }
  }

  return (
    <aside className="glass shadow-soft flex max-h-[680px] min-w-0 flex-col overflow-hidden rounded-2xl xl:max-h-[calc(100dvh-9rem)]">
      {/* 顶部 Tab 切换 */}
      <div className="border-border/60 space-y-2.5 border-b p-3.5">
        <Segmented<SidebarTab>
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'channels', label: `频道 (${allChannels.length})`, icon: <ListVideo className="size-3.5" /> },
            { value: 'favorites', label: `收藏 (${favorites.length})`, icon: <Star className="size-3.5" /> },
            { value: 'history', label: `历史 (${history.length})`, icon: <Clock className="size-3.5" /> },
          ]}
        />

        {tab === 'channels' && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <div className="relative min-w-0 flex-1">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索频道名或分组..."
                  className="border-border/70 bg-background/60 focus:border-primary w-full rounded-lg border py-1.5 pr-7 pl-8 text-xs outline-none"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
              <Button
                variant={importOpen ? 'primary' : 'outline'}
                size="sm"
                className="h-8 px-2.5 text-xs"
                onClick={() => setImportOpen((v) => !v)}
              >
                <Plus className="size-3.5" />
                导入
              </Button>
            </div>

            {/* 导入 IPTV 列表折叠面板 */}
            {importOpen && (
              <div className="bg-foreground/[0.03] border-border/70 space-y-2.5 rounded-xl border p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">导入 IPTV / M3U / TXT 列表</span>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-primary inline-flex items-center gap-1 font-medium hover:underline"
                  >
                    <Upload className="size-3" />
                    选本地文件
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".m3u,.m3u8,.txt"
                    className="hidden"
                    onChange={(e) => handleLocalPlaylistFile(e.target.files?.[0])}
                  />
                </div>

                {/* 在线订阅链接 */}
                <div className="flex gap-1.5">
                  <input
                    type="url"
                    value={remoteM3uUrl}
                    onChange={(e) => setRemoteM3uUrl(e.target.value)}
                    placeholder="在线 .m3u / .txt 订阅链接"
                    className="border-border/70 bg-background/70 min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-auto px-2.5 text-xs"
                    disabled={fetchingRemote}
                    onClick={handleFetchRemoteM3u}
                  >
                    {fetchingRemote ? <Loader2 className="size-3.5 animate-spin" /> : <Globe className="size-3.5" />}
                    拉取
                  </Button>
                </div>

                {/* 粘贴文本 */}
                <textarea
                  rows={4}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={'粘贴 #EXTM3U 列表，或「频道名,http://...」每行一条'}
                  className="border-border/70 bg-background/70 w-full resize-none rounded-lg border p-2 font-mono text-[11px] outline-none"
                />

                <div className="flex items-center justify-between gap-2">
                  {channels.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        onClearChannels()
                        toast.success('已清空导入频道')
                      }}
                      className="text-red-500 hover:underline"
                    >
                      清空已导入 ({channels.length})
                    </button>
                  ) : (
                    <span className="text-muted-foreground text-[10px]">仅保存在本机浏览器</span>
                  )}
                  <div className="flex gap-1.5">
                    {channels.length > 0 && (
                      <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => handleParsePaste('append')}>
                        追加
                      </Button>
                    )}
                    <Button variant="primary" size="sm" className="h-7 px-2.5 text-xs" onClick={() => handleParsePaste('replace')}>
                      解析导入
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* 分组标签筛选 */}
            {groups.length > 2 && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {groups.slice(0, 12).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setActiveGroup(g)}
                    className={cn(
                      'max-w-[120px] truncate rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
                      activeGroup === g
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-foreground/[0.06] text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {g}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 列表主区 */}
      <div className="flex-1 overflow-y-auto p-2">
        {tab === 'channels' && (
          <div className="space-y-1">
            {filteredChannels.length === 0 ? (
              <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-12 text-center text-xs">
                <FileText className="size-7 opacity-40" />
                <span>没有匹配的频道</span>
              </div>
            ) : (
              filteredChannels.map((ch) => {
                const active = currentUrl === ch.url
                const isFav = favUrlSet.has(ch.url)
                return (
                  <div
                    key={ch.id}
                    className={cn(
                      'group flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs transition-colors',
                      active
                        ? 'bg-primary/14 text-foreground'
                        : 'hover:bg-foreground/[0.05] text-foreground/85',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onPlayChannel(ch)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <span
                        className={cn(
                          'flex size-7 shrink-0 items-center justify-center rounded-lg text-[10px]',
                          active ? 'bg-primary text-primary-foreground' : 'bg-foreground/[0.06] text-muted-foreground',
                        )}
                      >
                        {active ? <Radio className="size-3.5 animate-pulse" /> : <Play className="size-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate font-medium', active && 'text-primary')}>
                          {ch.name}
                        </span>
                        <span className="text-muted-foreground block truncate text-[10px]">
                          {ch.group}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(ch)}
                      title={isFav ? '取消收藏' : '加入收藏'}
                      className={cn(
                        'shrink-0 rounded-md p-1 transition-colors',
                        isFav
                          ? 'text-amber-500'
                          : 'text-muted-foreground/50 opacity-0 group-hover:opacity-100 hover:text-amber-500',
                      )}
                    >
                      <Star className={cn('size-3.5', isFav && 'fill-amber-500')} />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        )}

        {tab === 'favorites' && (
          <div className="space-y-1">
            {favorites.length === 0 ? (
              <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-12 text-center text-xs">
                <Star className="size-7 opacity-35" />
                <span>暂无收藏，点击频道或工具栏星标即可收藏</span>
              </div>
            ) : (
              favorites.map((ch) => {
                const active = currentUrl === ch.url
                return (
                  <div
                    key={ch.url}
                    className={cn(
                      'group flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs transition-colors',
                      active ? 'bg-primary/14' : 'hover:bg-foreground/[0.05]',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onPlayChannel(ch)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <Play className={cn('size-3.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate font-medium', active && 'text-primary')}>{ch.name}</span>
                        <span className="text-muted-foreground block truncate font-mono text-[10px]">{ch.url}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(ch)}
                      title="取消收藏"
                      className="text-amber-500 shrink-0 p-1 hover:opacity-75"
                    >
                      <Star className="size-3.5 fill-amber-500" />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        )}

        {tab === 'history' && (
          <div className="space-y-1">
            {history.length === 0 ? (
              <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-12 text-center text-xs">
                <Clock className="size-7 opacity-35" />
                <span>暂无播放历史</span>
              </div>
            ) : (
              <>
                <div className="flex justify-end px-2 pb-1">
                  <button
                    type="button"
                    onClick={onClearHistory}
                    className="text-muted-foreground hover:text-red-500 inline-flex items-center gap-1 text-[11px]"
                  >
                    <Trash2 className="size-3" />
                    清空历史
                  </button>
                </div>
                {history.map((h) => {
                  const active = currentUrl === h.url
                  return (
                    <button
                      key={`${h.url}-${h.playedAt}`}
                      type="button"
                      onClick={() => onPlayHistory(h)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs transition-colors',
                        active ? 'bg-primary/14' : 'hover:bg-foreground/[0.05]',
                      )}
                    >
                      <Play className={cn('size-3.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate font-medium', active && 'text-primary')}>{h.name}</span>
                        <span className="text-muted-foreground flex items-center gap-1.5 text-[10px]">
                          <span className="truncate font-mono">{h.url}</span>
                          {h.useProxy && <span className="text-primary shrink-0">· 代理</span>}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
