import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  Disc3,
  Download,
  FileArchive,
  FileText,
  ImageDown,
  ImagePlus,
  Info,
  Languages,
  Layers,
  Loader2,
  Music2,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  Upload,
} from 'lucide-react'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { downloadBlob, timestampName } from '@/lib/file'
import { IMAGE_ACCEPT } from '@/lib/image'
import { cn, formatBytes } from '@/lib/utils'
import { BatchAlbumModal } from './BatchAlbumModal'
import {
  cloneTags,
  exportBatchSongsZip,
  exportEditedSongBlob,
  formatSongDuration,
  parseAudioFileToTrack,
  prepareCoverImageFromFile,
} from './engine'
import {
  detectTagsMojibake,
  findActiveLrcIndex,
  formatLrcTimestamp,
  parseLrcLyrics,
  repairTagsMojibake,
} from './lrc'
import {
  GENRE_SUGGESTIONS,
  type BatchEditDraft,
  type EditableSongTags,
  type SongTrackItem,
} from './types'

const AUDIO_ACCEPT = 'audio/*,.mp3,.flac,.m4a,.mp4,.aac,.ogg,.oga,.opus,.wav,.aiff,.wma'

type EditorTab = 'tags' | 'lyrics'

const inputCls =
  'border-border/70 bg-background/60 focus:border-primary focus:ring-primary/20 w-full rounded-xl border px-3 py-2 text-sm transition outline-none focus:ring-2 disabled:opacity-55'

export default function AudioTagEditorTool() {
  const [tracks, setTracks] = useState<SongTrackItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [tab, setTab] = useState<EditorTab>('tags')
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number; name: string } | null>(null)
  const [batchModalOpen, setBatchModalOpen] = useState(false)
  const [copiedLyrics, setCopiedLyrics] = useState(false)

  // 音频试听与 LRC 同步状态
  const [currentTime, setCurrentTime] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const activeLyricRef = useRef<HTMLButtonElement>(null)
  const addMoreInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const lrcInputRef = useRef<HTMLInputElement>(null)
  const createdUrlsRef = useRef<Set<string>>(new Set())

  const registerUrl = (url?: string | null) => {
    if (url) createdUrlsRef.current.add(url)
  }

  // 组件卸载释放全部音频与封面 ObjectURL
  useEffect(() => {
    const urls = createdUrlsRef.current
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u))
      urls.clear()
    }
  }, [])

  const activeTrack = useMemo(
    () => tracks.find((t) => t.id === activeId) ?? tracks[0] ?? null,
    [tracks, activeId],
  )

  // 切换曲目时重置播放时间
  useEffect(() => {
    setCurrentTime(0)
  }, [activeTrack?.id])

  /** 解析并加入一组本地音频文件 */
  const handleAudioFiles = async (files: File[]) => {
    if (files.length === 0) return
    setParsing(true)
    const parsed: SongTrackItem[] = []
    let failedCount = 0

    for (const f of files) {
      try {
        const item = await parseAudioFileToTrack(f)
        registerUrl(item.audioUrl)
        registerUrl(item.tags.cover?.previewUrl)
        parsed.push(item)
      } catch (err) {
        failedCount++
        console.warn('[audio-tag-editor] 解析失败:', f.name, err)
      }
    }

    setParsing(false)
    if (parsed.length > 0) {
      setTracks((prev) => [...prev, ...parsed])
      if (!activeId) setActiveId(parsed[0].id)
      const gbkCount = parsed.filter((t) => t.hasMojibake).length
      toast.success(
        `已解析 ${parsed.length} 首歌曲${gbkCount > 0 ? `（检测到 ${gbkCount} 首疑似 GBK 乱码，可一键修复）` : ''}`,
      )
    }
    if (failedCount > 0) {
      toast.error(`${failedCount} 个文件无法解析为音频，请确认格式正确`)
    }
    if (addMoreInputRef.current) addMoreInputRef.current.value = ''
  }

  /** 更新当前歌曲单个标签字段 */
  const updateActiveTag = useCallback(
    <K extends keyof EditableSongTags>(key: K, value: EditableSongTags[K]) => {
      if (!activeTrack) return
      setTracks((prev) =>
        prev.map((t) => {
          if (t.id !== activeTrack.id) return t
          const nextTags = { ...t.tags, [key]: value }
          return {
            ...t,
            tags: nextTags,
            dirty: true,
            hasMojibake: detectTagsMojibake(nextTags),
          }
        }),
      )
    },
    [activeTrack],
  )

  /** 替换当前歌曲专辑封面 */
  const handleReplaceCover = async (file?: File) => {
    if (!file || !activeTrack) return
    if (!activeTrack.writable) {
      toast.warning(`当前格式（${activeTrack.formatKind.toUpperCase()}）仅支持预览，无损写回支持 MP3 / FLAC / M4A`)
      return
    }
    try {
      const prepared = await prepareCoverImageFromFile(file)
      registerUrl(prepared.previewUrl)
      updateActiveTag('cover', prepared)
      toast.success(`已替换专辑封面（${prepared.width}×${prepared.height} · ${formatBytes(prepared.data.length)}）`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '封面处理失败')
    } finally {
      if (coverInputRef.current) coverInputRef.current.value = ''
    }
  }

  /** 导出当前歌曲内嵌封面原图 */
  const handleExportCover = () => {
    if (!activeTrack?.tags.cover) return
    const cov = activeTrack.tags.cover
    const ext = cov.mime.includes('png') ? 'png' : 'jpg'
    const base = (activeTrack.tags.album || activeTrack.tags.title || activeTrack.filename.replace(/\.[^.]+$/, ''))
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 32)
    downloadBlob(new Blob([new Uint8Array(cov.data)], { type: cov.mime }), `${base}-cover.${ext}`)
    toast.success('已导出专辑封面原图')
  }

  /** 导入本地 .lrc / .txt 歌词（自动兼容 UTF-8 / GBK） */
  const handleImportLyricsFile = async (file?: File) => {
    if (!file || !activeTrack) return
    try {
      const buf = new Uint8Array(await file.arrayBuffer())
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
      } catch {
        text = new TextDecoder('gb18030').decode(buf)
      }
      updateActiveTag('lyrics', text.replace(/^\uFEFF/, ''))
      setTab('lyrics')
      toast.success(`已导入歌词「${file.name}」`)
    } catch {
      toast.error('歌词文件读取失败')
    } finally {
      if (lrcInputRef.current) lrcInputRef.current.value = ''
    }
  }

  /** 导出当前歌词为 .lrc 文件 */
  const handleExportLyrics = () => {
    if (!activeTrack || !activeTrack.tags.lyrics.trim()) return
    const base = (activeTrack.tags.title || activeTrack.filename.replace(/\.[^.]+$/, ''))
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 40)
    const blob = new Blob([activeTrack.tags.lyrics], { type: 'text/plain;charset=utf-8' })
    downloadBlob(blob, `${base}.lrc`)
    toast.success(`已导出「${base}.lrc」`)
  }

  /** 一键修复当前歌曲的 GBK 乱码标签 */
  const handleRepairCurrentMojibake = () => {
    if (!activeTrack) return
    const fixed = repairTagsMojibake(activeTrack.tags)
    setTracks((prev) =>
      prev.map((t) =>
        t.id === activeTrack.id ? { ...t, tags: fixed, dirty: true, hasMojibake: detectTagsMojibake(fixed) } : t,
      ),
    )
    toast.success('已按 GB18030 智能转码修复为标准 Unicode 标签')
  }

  /** 撤销当前歌曲的全部修改 */
  const handleResetCurrent = () => {
    if (!activeTrack) return
    setTracks((prev) =>
      prev.map((t) =>
        t.id === activeTrack.id
          ? {
              ...t,
              tags: cloneTags(t.originalTags),
              dirty: false,
              hasMojibake: detectTagsMojibake(t.originalTags),
            }
          : t,
      ),
    )
    toast.info('已还原为原始读取标签')
  }

  /** 无损保存并下载当前歌曲 */
  const handleSaveCurrentSong = async () => {
    if (!activeTrack || !activeTrack.writable) return
    setSaving(true)
    try {
      const blob = await exportEditedSongBlob(activeTrack)
      downloadBlob(blob, activeTrack.filename)
      setTracks((prev) =>
        prev.map((t) =>
          t.id === activeTrack.id ? { ...t, originalTags: cloneTags(t.tags), dirty: false } : t,
        ),
      )
      toast.success(`已零重编码无损保存「${activeTrack.filename}」（${formatBytes(blob.size)}）`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存歌曲失败')
    } finally {
      setSaving(false)
    }
  }

  /** 应用整张专辑批量修改 */
  const handleApplyBatchEdit = (draft: BatchEditDraft) => {
    if (draft.cover?.previewUrl) registerUrl(draft.cover.previewUrl)
    let count = 0
    setTracks((prev) =>
      prev.map((t) => {
        if (!t.writable) return t
        count++
        const next: EditableSongTags = { ...t.tags }
        if (draft.applyArtist) next.artist = draft.artist
        if (draft.applyAlbum) next.album = draft.album
        if (draft.applyAlbumArtist) next.albumArtist = draft.albumArtist
        if (draft.applyYear) next.year = draft.year
        if (draft.applyGenre) next.genre = draft.genre
        if (draft.applyCover) {
          next.cover = draft.clearCover ? null : draft.cover ? { ...draft.cover } : next.cover
        }
        return {
          ...t,
          tags: next,
          dirty: true,
          hasMojibake: detectTagsMojibake(next),
        }
      }),
    )
    toast.success(`已将专辑信息批量应用到 ${count} 首歌曲`)
  }

  /** 批量无损导出全部歌曲 ZIP */
  const handleExportAllZip = async () => {
    if (tracks.length === 0) return
    setBatchProgress({ done: 0, total: tracks.length, name: tracks[0].filename })
    try {
      const zipBlob = await exportBatchSongsZip(tracks, (done, total, name) => {
        setBatchProgress({ done, total, name })
      })
      const albumName = (activeTrack?.tags.album || 'music-album')
        .replace(/[\\/:*?"<>|]/g, '_')
        .slice(0, 24)
      downloadBlob(zipBlob, timestampName(albumName, 'zip'))
      toast.success(`已打包导出 ${tracks.length} 首歌曲（${formatBytes(zipBlob.size)}）`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '批量导出 ZIP 失败')
    } finally {
      setBatchProgress(null)
    }
  }

  // LRC 同步歌词解析与高亮跟随
  const lrcLines = useMemo(
    () => parseLrcLyrics(activeTrack?.tags.lyrics || ''),
    [activeTrack?.tags.lyrics],
  )
  const activeLrcIndex = useMemo(
    () => findActiveLrcIndex(lrcLines, currentTime),
    [lrcLines, currentTime],
  )

  useEffect(() => {
    if (tab === 'lyrics' && activeLrcIndex >= 0) {
      activeLyricRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeLrcIndex, tab])

  const writableCount = useMemo(() => tracks.filter((t) => t.writable).length, [tracks])

  // ============================================================================
  // 空态：上传歌曲或整张专辑
  // ============================================================================
  if (tracks.length === 0) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="glass shadow-soft rounded-3xl p-6 sm:p-8">
          <FileDropzone
            accept={AUDIO_ACCEPT}
            multiple
            onFiles={handleAudioFiles}
            title={parsing ? '正在解析歌曲标签、封面与歌词...' : '拖放或点击选择音频文件（支持一次选整张专辑）'}
            hint="支持解析 MP3 / FLAC / M4A / OGG / WAV 等格式 · 其中 MP3 / FLAC / M4A 支持零重编码无损修改写回"
          />
          <div className="border-border/60 text-muted-foreground mt-4 flex items-center justify-center gap-1.5 border-t pt-4 text-xs">
            <ShieldCheck className="size-4 text-emerald-500" />
            <span>100% 浏览器本地二进制读写，音频数据绝不上传、音质零损耗</span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="glass rounded-2xl p-4 text-xs">
            <div className="mb-1.5 flex items-center gap-2 font-semibold">
              <Disc3 className="text-primary size-4" />
              零重编码无损写回
            </div>
            <p className="text-muted-foreground leading-relaxed">
              精准重写 MP3 ID3v2.3、FLAC Vorbis/Picture 与 M4A Atom 偏移量，音频帧一比特不损。
            </p>
          </div>
          <div className="glass rounded-2xl p-4 text-xs">
            <div className="mb-1.5 flex items-center gap-2 font-semibold">
              <Music2 className="size-4 text-pink-500" />
              封面提取与 LRC 跟唱
            </div>
            <p className="text-muted-foreground leading-relaxed">
              高清专辑封面一键提取或替换；若内嵌 LRC 时间轴歌词，试听时实时高亮滚动、点击歌词直达定位。
            </p>
          </div>
          <div className="glass rounded-2xl p-4 text-xs">
            <div className="mb-1.5 flex items-center gap-2 font-semibold">
              <Languages className="size-4 text-amber-500" />
              老歌乱码修复 &amp; 批量编辑
            </div>
            <p className="text-muted-foreground leading-relaxed">
              自动识别老旧 MP3 的 GBK 乱码并一键转标准 Unicode，支持整张专辑统一改标签并打包 ZIP。
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ============================================================================
  // 主工作台：左侧曲目队列 + 右侧歌曲详情与标签/歌词编辑器
  // ============================================================================
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      {/* 左侧曲目队列与批量操控栏 */}
      <aside className="glass shadow-soft flex max-h-[360px] flex-col overflow-hidden rounded-2xl xl:sticky xl:top-6 xl:max-h-[calc(100dvh-5rem)]">
        <div className="border-border/60 space-y-2.5 border-b p-3.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold">歌曲列表（{tracks.length}）</span>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => addMoreInputRef.current?.click()}>
                <Plus className="size-3.5" />
                加歌
              </Button>
              <input
                ref={addMoreInputRef}
                type="file"
                accept={AUDIO_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => void handleAudioFiles(Array.from(e.target.files ?? []))}
              />
              <button
                type="button"
                title="清空列表"
                onClick={() => {
                  setTracks([])
                  setActiveId(null)
                }}
                className="text-muted-foreground hover:text-red-500 p-1"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>

          {tracks.length > 1 && (
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2 text-xs"
                disabled={writableCount === 0}
                onClick={() => setBatchModalOpen(true)}
              >
                <Layers className="size-3.5" />
                批量改专辑
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="h-8 px-2 text-xs"
                disabled={Boolean(batchProgress)}
                onClick={() => void handleExportAllZip()}
              >
                {batchProgress ? <Loader2 className="size-3.5 animate-spin" /> : <FileArchive className="size-3.5" />}
                打包 ZIP
              </Button>
            </div>
          )}

          {batchProgress && (
            <div className="text-muted-foreground truncate font-mono text-[10px]">
              正在打包 ({batchProgress.done}/{batchProgress.total})：{batchProgress.name}
            </div>
          )}
        </div>

        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {tracks.map((item) => {
            const active = item.id === activeTrack?.id
            return (
              <div
                key={item.id}
                className={cn(
                  'group flex items-center gap-2.5 rounded-xl p-2 text-xs transition-colors',
                  active ? 'bg-primary/14 text-foreground' : 'hover:bg-foreground/[0.05] text-foreground/85',
                )}
              >
                <button
                  type="button"
                  onClick={() => setActiveId(item.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <div className="bg-foreground/[0.07] relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg">
                    {item.tags.cover ? (
                      <img src={item.tags.cover.previewUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <Disc3 className="text-muted-foreground size-4.5" />
                    )}
                    {item.dirty && (
                      <span
                        title="有未保存修改"
                        className="absolute top-1 right-1 size-2 rounded-full bg-amber-400 ring-2 ring-black/40"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={cn('truncate font-medium', active && 'text-primary')}>
                      {item.tags.title || item.filename}
                    </div>
                    <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[10px]">
                      <span className="truncate">{item.tags.artist || '未知歌手'}</span>
                      <span className="bg-foreground/[0.07] shrink-0 rounded px-1 py-0.2 font-mono uppercase">
                        {item.formatKind}
                      </span>
                      {item.hasMojibake && (
                        <span className="shrink-0 text-amber-500" title="疑似 GBK 乱码">
                          乱码
                        </span>
                      )}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  title="移除歌曲"
                  onClick={() => {
                    setTracks((prev) => {
                      const next = prev.filter((t) => t.id !== item.id)
                      if (activeId === item.id) setActiveId(next[0]?.id ?? null)
                      return next
                    })
                  }}
                  className="text-muted-foreground/60 hover:text-red-500 shrink-0 p-1 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      </aside>

      {/* 右侧主编辑器 */}
      {activeTrack && (
        <div className="min-w-0 space-y-4">
          {/* 顶部专辑封面 + 试听播放条 + 核心操作 */}
          <div className="glass shadow-soft space-y-4 rounded-2xl p-4 sm:p-5">
            <div className="flex flex-col gap-5 sm:flex-row">
              {/* 专辑封面展示与替换区 */}
              <div className="flex shrink-0 flex-col items-center gap-2 sm:w-44">
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    const f = e.dataTransfer.files?.[0]
                    if (f) void handleReplaceCover(f)
                  }}
                  className="bg-foreground/[0.06] border-border/70 group relative flex size-44 items-center justify-center overflow-hidden rounded-2xl border shadow-md"
                >
                  {activeTrack.tags.cover ? (
                    <img
                      src={activeTrack.tags.cover.previewUrl}
                      alt="专辑封面"
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="text-muted-foreground flex flex-col items-center gap-1.5 p-4 text-center text-xs">
                      <Disc3 className="size-10 opacity-40" />
                      <span>暂无内嵌封面</span>
                      {activeTrack.writable && <span className="text-[10px] opacity-75">拖入图片即可设置</span>}
                    </div>
                  )}

                  {activeTrack.tags.cover?.width && (
                    <span className="pointer-events-none absolute right-2 bottom-2 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white backdrop-blur-xs">
                      {activeTrack.tags.cover.width}×{activeTrack.tags.cover.height}
                    </span>
                  )}
                </div>

                <div className="flex w-full items-center justify-center gap-1">
                  {activeTrack.writable && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 flex-1 px-2 text-[11px]"
                      onClick={() => coverInputRef.current?.click()}
                    >
                      <ImagePlus className="size-3.5" />
                      换图
                    </Button>
                  )}
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept={IMAGE_ACCEPT}
                    className="hidden"
                    onChange={(e) => void handleReplaceCover(e.target.files?.[0])}
                  />
                  {activeTrack.tags.cover && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      title="下载封面原图"
                      onClick={handleExportCover}
                    >
                      <ImageDown className="size-3.5" />
                    </Button>
                  )}
                  {activeTrack.writable && activeTrack.tags.cover && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-red-500"
                      title="清除内嵌封面"
                      onClick={() => updateActiveTag('cover', null)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              {/* 右侧歌曲标题、音频参数徽章、试听与保存 */}
              <div className="flex min-w-0 flex-1 flex-col justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-bold">
                        {activeTrack.tags.title || activeTrack.filename}
                      </h2>
                      <p className="text-muted-foreground truncate text-xs">
                        {activeTrack.tags.artist || '未知歌手'}
                        {activeTrack.tags.album ? ` · 《${activeTrack.tags.album}》` : ''}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {activeTrack.dirty && (
                        <Button variant="ghost" size="sm" onClick={handleResetCurrent}>
                          <RotateCcw />
                          撤销
                        </Button>
                      )}
                      {activeTrack.writable ? (
                        <Button variant="primary" size="sm" disabled={saving} onClick={() => void handleSaveCurrentSong()}>
                          {saving ? <Loader2 className="animate-spin" /> : <Save />}
                          无损保存下载
                        </Button>
                      ) : (
                        <span className="bg-foreground/[0.07] text-muted-foreground rounded-lg px-2.5 py-1.5 text-xs">
                          只读格式（写回支持 MP3/FLAC/M4A）
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 音质规格徽章 */}
                  <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                    <span className="bg-primary/12 text-primary rounded-md px-2 py-0.5 font-semibold uppercase">
                      {activeTrack.tech.container}
                    </span>
                    {activeTrack.tech.lossless && (
                      <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 font-sans font-semibold text-emerald-600 dark:text-emerald-400">
                        无损 SQ
                      </span>
                    )}
                    {activeTrack.tech.bitrateKbps > 0 && (
                      <span className="bg-foreground/[0.06] rounded-md px-2 py-0.5">
                        {activeTrack.tech.bitrateKbps} kbps
                      </span>
                    )}
                    {activeTrack.tech.sampleRateHz > 0 && (
                      <span className="bg-foreground/[0.06] rounded-md px-2 py-0.5">
                        {(activeTrack.tech.sampleRateHz / 1000).toFixed(1)} kHz
                      </span>
                    )}
                    {activeTrack.tech.bitsPerSample && (
                      <span className="bg-foreground/[0.06] rounded-md px-2 py-0.5">
                        {activeTrack.tech.bitsPerSample}-bit
                      </span>
                    )}
                    <span className="bg-foreground/[0.06] rounded-md px-2 py-0.5">
                      {formatSongDuration(activeTrack.tech.durationSec)}
                    </span>
                    <span className="bg-foreground/[0.06] rounded-md px-2 py-0.5">
                      {formatBytes(activeTrack.size)}
                    </span>
                  </div>
                </div>

                {/* 内置音频播放器（实时驱动 LRC 同步歌词滚动） */}
                <div className="bg-foreground/[0.03] border-border/60 rounded-xl border p-2">
                  <audio
                    key={activeTrack.id}
                    ref={audioRef}
                    src={activeTrack.audioUrl}
                    controls
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                    className="h-9 w-full"
                  />
                </div>
              </div>
            </div>

            {/* 老歌 GBK 乱码一键修复提示条 */}
            {activeTrack.hasMojibake && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-700 dark:text-amber-300">
                <span className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="size-4 shrink-0" />
                  检测到老旧 MP3 疑似 GBK 编码乱码标签，可一键转换为规范中文 Unicode：
                </span>
                <Button variant="primary" size="sm" onClick={handleRepairCurrentMojibake}>
                  <Sparkles />
                  一键修复乱码
                </Button>
              </div>
            )}
          </div>

          {/* 详细编辑面板（标签表单 / 内嵌歌词与 LRC 同步视图） */}
          <div className="glass shadow-soft space-y-4 rounded-2xl p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="w-full sm:w-80">
                <Segmented<EditorTab>
                  size="sm"
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: 'tags', label: '歌曲标签信息', icon: <Tag className="size-3.5" /> },
                    {
                      value: 'lyrics',
                      label: `内嵌歌词${lrcLines.length > 0 ? ` (${lrcLines.length}行LRC)` : activeTrack.tags.lyrics.trim() ? ' (有)' : ''}`,
                      icon: <FileText className="size-3.5" />,
                    },
                  ]}
                />
              </div>

              {!activeTrack.writable && (
                <span className="text-muted-foreground flex items-center gap-1 text-xs">
                  <Info className="size-3.5" />
                  该格式当前仅浏览解析，不支持直接回写
                </span>
              )}
            </div>

            {tab === 'tags' ? (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1.5 text-xs">
                    <span className="text-foreground/80 font-medium">歌曲标题 (Title)</span>
                    <input
                      type="text"
                      disabled={!activeTrack.writable}
                      value={activeTrack.tags.title}
                      onChange={(e) => updateActiveTag('title', e.target.value)}
                      placeholder="输入歌名"
                      className={inputCls}
                    />
                  </label>

                  <label className="space-y-1.5 text-xs">
                    <span className="text-foreground/80 font-medium">歌手 / 演唱者 (Artist)</span>
                    <input
                      type="text"
                      disabled={!activeTrack.writable}
                      value={activeTrack.tags.artist}
                      onChange={(e) => updateActiveTag('artist', e.target.value)}
                      placeholder="多个歌手可用 / 分隔"
                      className={inputCls}
                    />
                  </label>

                  <label className="space-y-1.5 text-xs">
                    <span className="text-foreground/80 font-medium">所属专辑 (Album)</span>
                    <input
                      type="text"
                      disabled={!activeTrack.writable}
                      value={activeTrack.tags.album}
                      onChange={(e) => updateActiveTag('album', e.target.value)}
                      placeholder="输入专辑名称"
                      className={inputCls}
                    />
                  </label>

                  <label className="space-y-1.5 text-xs">
                    <span className="text-foreground/80 font-medium">专辑艺术家 (Album Artist)</span>
                    <input
                      type="text"
                      disabled={!activeTrack.writable}
                      value={activeTrack.tags.albumArtist}
                      onChange={(e) => updateActiveTag('albumArtist', e.target.value)}
                      placeholder="合辑可填 Various Artists"
                      className={inputCls}
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1.5 text-xs">
                      <span className="text-foreground/80 font-medium">发行年份 (Year)</span>
                      <input
                        type="text"
                        disabled={!activeTrack.writable}
                        value={activeTrack.tags.year}
                        onChange={(e) => updateActiveTag('year', e.target.value)}
                        placeholder="如 2026"
                        className={cn(inputCls, 'font-mono')}
                      />
                    </label>
                    <label className="space-y-1.5 text-xs">
                      <span className="text-foreground/80 font-medium">流派 (Genre)</span>
                      <input
                        type="text"
                        list="song-genre-list"
                        disabled={!activeTrack.writable}
                        value={activeTrack.tags.genre}
                        onChange={(e) => updateActiveTag('genre', e.target.value)}
                        placeholder="流行 / 摇滚..."
                        className={inputCls}
                      />
                      <datalist id="song-genre-list">
                        {GENRE_SUGGESTIONS.map((g) => (
                          <option key={g} value={g} />
                        ))}
                      </datalist>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5 text-xs">
                      <span className="text-foreground/80 font-medium">音轨号 / 总数</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          disabled={!activeTrack.writable}
                          value={activeTrack.tags.track}
                          onChange={(e) => updateActiveTag('track', e.target.value)}
                          placeholder="1"
                          className={cn(inputCls, 'font-mono text-center')}
                        />
                        <span className="text-muted-foreground">/</span>
                        <input
                          type="text"
                          disabled={!activeTrack.writable}
                          value={activeTrack.tags.trackTotal}
                          onChange={(e) => updateActiveTag('trackTotal', e.target.value)}
                          placeholder="12"
                          className={cn(inputCls, 'font-mono text-center')}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5 text-xs">
                      <span className="text-foreground/80 font-medium">碟号 / 总碟数</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          disabled={!activeTrack.writable}
                          value={activeTrack.tags.disc}
                          onChange={(e) => updateActiveTag('disc', e.target.value)}
                          placeholder="1"
                          className={cn(inputCls, 'font-mono text-center')}
                        />
                        <span className="text-muted-foreground">/</span>
                        <input
                          type="text"
                          disabled={!activeTrack.writable}
                          value={activeTrack.tags.discTotal}
                          onChange={(e) => updateActiveTag('discTotal', e.target.value)}
                          placeholder="1"
                          className={cn(inputCls, 'font-mono text-center')}
                        />
                      </div>
                    </div>
                  </div>

                  <label className="space-y-1.5 text-xs">
                    <span className="text-foreground/80 font-medium">作曲人 (Composer)</span>
                    <input
                      type="text"
                      disabled={!activeTrack.writable}
                      value={activeTrack.tags.composer}
                      onChange={(e) => updateActiveTag('composer', e.target.value)}
                      placeholder="输入作曲人"
                      className={inputCls}
                    />
                  </label>

                  <label className="space-y-1.5 text-xs">
                    <span className="text-foreground/80 font-medium">备注说明 (Comment)</span>
                    <input
                      type="text"
                      disabled={!activeTrack.writable}
                      value={activeTrack.tags.comment}
                      onChange={(e) => updateActiveTag('comment', e.target.value)}
                      placeholder="录音版本、音源说明等"
                      className={inputCls}
                    />
                  </label>
                </div>

                {/* 底层音频技术信息速览 */}
                <div className="bg-foreground/[0.03] border-border/60 rounded-xl border p-3.5 text-xs">
                  <div className="text-muted-foreground mb-2 font-medium">文件与编码技术参数</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
                    <div>
                      <span className="text-muted-foreground">文件名：</span>
                      <span className="font-mono break-all">{activeTrack.filename}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">音频编码：</span>
                      <span className="font-mono">{activeTrack.tech.codec}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">声道数：</span>
                      <span className="font-mono">
                        {activeTrack.tech.channels === 2
                          ? '立体声 (2ch)'
                          : activeTrack.tech.channels === 1
                            ? '单声道 (1ch)'
                            : `${activeTrack.tech.channels || '-'} ch`}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">原始标签：</span>
                      <span className="font-mono">{activeTrack.tech.tagTypes.join(', ') || '无'}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* 内嵌歌词编辑 + LRC 实时跟唱视图 */
              <div className="grid gap-4 lg:grid-cols-2">
                {/* 左侧：歌词编辑器 */}
                <div className="flex flex-col space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {activeTrack.writable && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2.5 text-xs"
                            onClick={() => lrcInputRef.current?.click()}
                          >
                            <Upload className="size-3.5" />
                            导入 .lrc / .txt
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2.5 text-xs"
                            title="在末尾插入当前播放时间标签"
                            onClick={() => {
                              const stamp = formatLrcTimestamp(currentTime)
                              const cur = activeTrack.tags.lyrics
                              updateActiveTag('lyrics', cur ? `${cur.trimEnd()}\n${stamp}` : stamp)
                            }}
                          >
                            <Clock className="size-3.5" />
                            打时间轴 {formatLrcTimestamp(currentTime)}
                          </Button>
                        </>
                      )}
                      <input
                        ref={lrcInputRef}
                        type="file"
                        accept=".lrc,.txt"
                        className="hidden"
                        onChange={(e) => void handleImportLyricsFile(e.target.files?.[0])}
                      />
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={!activeTrack.tags.lyrics.trim()}
                        onClick={() => {
                          navigator.clipboard.writeText(activeTrack.tags.lyrics).then(() => {
                            setCopiedLyrics(true)
                            toast.success('已复制歌词')
                            setTimeout(() => setCopiedLyrics(false), 1500)
                          })
                        }}
                      >
                        {copiedLyrics ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                        复制
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={!activeTrack.tags.lyrics.trim()}
                        onClick={handleExportLyrics}
                      >
                        <Download className="size-3.5" />
                        导出 .lrc
                      </Button>
                    </div>
                  </div>

                  <textarea
                    rows={14}
                    disabled={!activeTrack.writable}
                    value={activeTrack.tags.lyrics}
                    onChange={(e) => updateActiveTag('lyrics', e.target.value)}
                    placeholder={'支持纯文本歌词或标准 LRC 时间轴歌词，例如：\n[00:12.34]为你弹奏肖邦的夜曲\n[00:16.80]纪念我死去的爱情'}
                    className="border-border/70 bg-background/60 focus:border-primary w-full flex-1 resize-y rounded-xl border p-3 font-mono text-xs leading-relaxed outline-none disabled:opacity-60"
                  />
                </div>

                {/* 右侧：LRC 同步滚动预览 */}
                <div className="bg-foreground/[0.03] border-border/60 flex max-h-[380px] flex-col overflow-hidden rounded-xl border">
                  <div className="border-border/60 flex items-center justify-between border-b px-3.5 py-2 text-xs">
                    <span className="font-medium">
                      {lrcLines.length > 0 ? 'LRC 实时跟唱预览（点击任意句跳转播放）' : '歌词阅读预览'}
                    </span>
                    {lrcLines.length > 0 && (
                      <span className="text-muted-foreground font-mono text-[11px]">{lrcLines.length} 句</span>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto p-4">
                    {lrcLines.length > 0 ? (
                      <div className="space-y-1.5 text-center">
                        {lrcLines.map((line, idx) => {
                          const isCurrent = idx === activeLrcIndex
                          return (
                            <button
                              key={`${line.timeSec}-${idx}`}
                              ref={isCurrent ? activeLyricRef : undefined}
                              type="button"
                              onClick={() => {
                                if (audioRef.current) {
                                  audioRef.current.currentTime = line.timeSec
                                  audioRef.current.play().catch(() => {})
                                }
                              }}
                              className={cn(
                                'block w-full rounded-lg px-3 py-1.5 transition-all',
                                isCurrent
                                  ? 'bg-primary/14 text-primary scale-[1.02] text-sm font-bold'
                                  : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground text-xs',
                              )}
                            >
                              <div>{line.text}</div>
                              {line.translation && (
                                <div className="mt-0.5 text-[11px] opacity-80">{line.translation}</div>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    ) : activeTrack.tags.lyrics.trim() ? (
                      <div className="text-foreground/85 text-center text-xs leading-loose whitespace-pre-wrap">
                        {activeTrack.tags.lyrics}
                      </div>
                    ) : (
                      <div className="text-muted-foreground flex h-full min-h-[220px] flex-col items-center justify-center gap-2 text-xs">
                        <Music2 className="size-7 opacity-35" />
                        <span>该歌曲暂未内嵌歌词，可在左侧粘贴或导入 .lrc 文件</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 整张专辑批量修改弹窗 */}
      <BatchAlbumModal
        open={batchModalOpen}
        writableCount={writableCount}
        onClose={() => setBatchModalOpen(false)}
        onApply={handleApplyBatchEdit}
      />
    </div>
  )
}
