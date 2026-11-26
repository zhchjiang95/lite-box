import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileAudio,
  FileText,
  FileVideo,
  FolderArchive,
  HardDrive,
  History,
  KeyRound,
  Loader2,
  Lock,
  Magnet,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Square,
  Subtitles,
  Trash2,
  Upload,
  Users,
  WifiOff,
  XCircle,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { cn } from '@/lib/utils'
import {
  buildExternalPlayerLinks,
  buildStreamUrl,
  buildSubtitleUrl,
  clearMagnetCache,
  convertLocalSubtitleToVttUrl,
  createMagnetTask,
  deleteMagnetTask,
  DEMO_OPENSOURCE_MAGNET,
  fetchMagnetStatus,
  fetchMagnetTasks,
  formatBytes,
  formatIdleTime,
  formatPlaybackTime,
  formatSpeed,
  loadHistory,
  loadSavedToken,
  loadSessionSnapshot,
  saveHistory,
  saveSessionSnapshot,
  saveToken,
  stopMagnetTaskDownload,
  upsertHistoryItem,
  verifyMagnetToken,
  type DiskStats,
  type MagnetFileItem,
  type MagnetHistoryItem,
  type MagnetServiceStatus,
  type MagnetTaskItem,
  type PlayMode,
} from './api'

/** 将文件读取为 Base64（用于上传 .torrent 种子文件） */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(new Error('种子文件读取失败'))
    reader.readAsDataURL(file)
  })
}

export default function MagnetPlayerTool() {
  // 鉴权口令与服务状态
  const [token, setToken] = useState<string>(() => loadSavedToken())
  const [tokenInput, setTokenInput] = useState<string>(() => loadSavedToken())
  const [status, setStatus] = useState<MagnetServiceStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [loadingStatus, setLoadingStatus] = useState<boolean>(true)
  const [verifyingAuth, setVerifyingAuth] = useState<boolean>(false)

  // 任务与磁盘状态
  const [tasks, setTasks] = useState<MagnetTaskItem[]>([])
  const [disk, setDisk] = useState<DiskStats>({
    cacheBytes: 0,
    diskFreeBytes: null,
    diskTotalBytes: null,
  })
  const [pollPaused, setPollPaused] = useState<boolean>(false)

  // 输入与上传状态
  const [magnetInput, setMagnetInput] = useState<string>('')
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [clearingCache, setClearingCache] = useState<boolean>(false)
  const [onlyShowVideos, setOnlyShowVideos] = useState<boolean>(true)
  const [isDraggingTorrent, setIsDraggingTorrent] = useState<boolean>(false)

  // 播放器状态与历史记录
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [selectedFileIndex, setSelectedFileIndex] = useState<number | null>(null)
  const [playMode, setPlayMode] = useState<PlayMode>('native')
  const [shouldAutoPlay, setShouldAutoPlay] = useState<boolean>(false)
  const [videoError, setVideoError] = useState<string | null>(null)
  const [selectedSubtitleIndex, setSelectedSubtitleIndex] = useState<number | 'none' | 'local'>('none')
  const [localSubUrl, setLocalSubUrl] = useState<string | null>(null)
  const [localSubName, setLocalSubName] = useState<string>('')
  const [history, setHistory] = useState<MagnetHistoryItem[]>(() => loadHistory())
  const [rightTab, setRightTab] = useState<'tasks' | 'history'>('tasks')
  const [restoredNotice, setRestoredNotice] = useState<string | null>(null)

  const torrentFileInputRef = useRef<HTMLInputElement | null>(null)
  const localSubInputRef = useRef<HTMLInputElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const restoredSessionRef = useRef<boolean>(false)
  const pendingSeekRef = useRef<{ infoHash: string; fileIndex: number; time: number } | null>(null)
  const lastProgressSaveRef = useRef<number>(0)

  // 检测是否处于外网非本机访问
  const isRemoteHost = useMemo(() => {
    const h = window.location.hostname
    return h !== 'localhost' && h !== '127.0.0.1' && h !== '::1'
  }, [])

  // 清理本地字幕 Blob URL
  useEffect(() => {
    return () => {
      if (localSubUrl) URL.revokeObjectURL(localSubUrl)
    }
  }, [localSubUrl])

  // 加载后端服务状态（只发一次，绝不无限重试）
  const refreshStatusAndTasks = useCallback(async (activeToken: string) => {
    setLoadingStatus(true)
    setStatusError(null)
    try {
      const st = await fetchMagnetStatus(activeToken)
      setStatus(st)
      setDisk({
        cacheBytes: st.cacheBytes,
        diskFreeBytes: st.diskFreeBytes,
        diskTotalBytes: st.diskTotalBytes,
      })
      if (st.available && st.authorized) {
        const res = await fetchMagnetTasks(activeToken)
        setTasks(res.tasks)
        setDisk(res.disk)
        setPollPaused(false)

        // 首次加载（例如刷新页面后）：若后端仍保留上次播放的任务与缓存，自动恢复选片与断点位置（不自动出声）
        if (!restoredSessionRef.current && res.tasks.length > 0) {
          restoredSessionRef.current = true
          const savedSnap = loadSessionSnapshot()
          const histList = loadHistory()

          let targetTask: MagnetTaskItem | undefined
          let targetIndex: number | null = null
          let targetMode: PlayMode = 'native'

          if (savedSnap) {
            const matched = res.tasks.find((t) => t.infoHash === savedSnap.infoHash && t.ready)
            if (matched && matched.files.some((f) => f.index === savedSnap.fileIndex)) {
              targetTask = matched
              targetIndex = savedSnap.fileIndex
              targetMode = savedSnap.playMode
            }
          }
          if (!targetTask) {
            const backendActive = res.tasks.find((t) => t.ready && t.activeFileIndex !== null)
            if (backendActive && backendActive.activeFileIndex !== null) {
              targetTask = backendActive
              targetIndex = backendActive.activeFileIndex
              const matchedFile = backendActive.files.find((f) => f.index === targetIndex)
              targetMode =
                matchedFile && !matchedFile.browserNativePlayable && st.ffmpegAvailable
                  ? 'remux'
                  : 'native'
            }
          }

          if (targetTask && targetIndex !== null) {
            setSelectedHash(targetTask.infoHash)
            setSelectedFileIndex(targetIndex)
            setPlayMode(targetMode !== 'native' && !st.ffmpegAvailable ? 'native' : targetMode)
            setShouldAutoPlay(false)
            const histItem = histList.find(
              (h) => h.infoHash === targetTask.infoHash && h.fileIndex === targetIndex,
            )
            if (histItem && histItem.currentTime > 3) {
              pendingSeekRef.current = {
                infoHash: targetTask.infoHash,
                fileIndex: targetIndex,
                time: histItem.currentTime,
              }
              setRestoredNotice(
                `已自动恢复上次观看进度 ${formatPlaybackTime(histItem.currentTime)}（直接复用已缓冲缓存，不会重复下载）`,
              )
            } else {
              setRestoredNotice('已自动恢复上次选中的视频（直接复用已缓冲缓存，不会重复下载）')
            }
          }
        }
      }
    } catch (err) {
      setStatus(null)
      setStatusError(err instanceof Error ? err.message : '后端连接失败')
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  useEffect(() => {
    refreshStatusAndTasks(token)
  }, [refreshStatusAndTasks, token])

  // 仅在服务就绪、已鉴权且存在活跃任务时温和轮询进度（出错立即暂停，杜绝死循环）
  useEffect(() => {
    if (!status?.available || !status.authorized || tasks.length === 0 || pollPaused) {
      return
    }
    let cancelled = false
    const timer = window.setInterval(async () => {
      try {
        const res = await fetchMagnetTasks(token)
        if (!cancelled) {
          setTasks(res.tasks)
          setDisk(res.disk)
        }
      } catch {
        if (!cancelled) {
          setPollPaused(true)
          toast.error('后端进度同步中断，已暂停自动刷新')
        }
      }
    }, 2500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [status?.available, status?.authorized, tasks.length, pollPaused, token])

  // 当前选中的任务与文件
  const activeTask = useMemo(
    () => tasks.find((t) => t.infoHash === selectedHash) ?? tasks[0] ?? null,
    [tasks, selectedHash],
  )

  const activeFile = useMemo<MagnetFileItem | null>(() => {
    if (!activeTask || !activeTask.ready) return null
    if (selectedFileIndex !== null) {
      const matched = activeTask.files.find((f) => f.index === selectedFileIndex)
      if (matched) return matched
    }
    return null
  }, [activeTask, selectedFileIndex])

  // 当前任务内的字幕文件列表
  const taskSubtitles = useMemo(() => {
    if (!activeTask) return []
    return activeTask.files.filter((f) => f.kind === 'subtitle' && f.browserNativePlayable)
  }, [activeTask])

  // 默认解析完毕后不自动选中或自动播放，严格等待用户在右侧主动点选文件再按需拉流

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = tokenInput.trim()
    if (!trimmed) {
      toast.error('请输入访问口令')
      return
    }
    setVerifyingAuth(true)
    try {
      await verifyMagnetToken(trimmed)
      saveToken(trimmed)
      setToken(trimmed)
      toast.success('访问口令验证通过')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '口令验证失败')
    } finally {
      setVerifyingAuth(false)
    }
  }

  const handleLockOut = () => {
    saveToken('')
    setToken('')
    setTokenInput('')
    setTasks([])
    setSelectedHash(null)
    setSelectedFileIndex(null)
    toast.info('已清除本地保存的访问口令')
  }

  const handleAddMagnet = async (customMagnet?: string) => {
    const target = (customMagnet ?? magnetInput).trim()
    if (!target) {
      toast.error('请先粘贴 magnet:? 磁力链接')
      return
    }
    setSubmitting(true)
    setVideoError(null)
    try {
      const res = await createMagnetTask(token, { magnet: target })
      setDisk(res.disk)
      setTasks((prev) => {
        const rest = prev.filter((t) => t.infoHash !== res.task.infoHash)
        return [res.task, ...rest]
      })
      setSelectedHash(res.task.infoHash)
      setSelectedFileIndex(null)
      setShouldAutoPlay(false)
      setRestoredNotice(null)
      setRightTab('tasks')
      saveSessionSnapshot(null)
      setHistory((prev) =>
        upsertHistoryItem(prev, {
          infoHash: res.task.infoHash,
          name: res.task.name,
          magnetURI: res.task.magnetURI || target,
        }),
      )
      setPollPaused(false)
      if (!customMagnet) setMagnetInput('')
      toast.success(
        res.task.ready
          ? `种子解析成功：共 ${res.task.files.length} 个文件，请在右侧点击选择要播放的视频`
          : '磁力任务已加入，正在通过 DHT/Tracker 拉取元数据（随时可取消）…',
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '解析磁力链接失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleTorrentFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.torrent')) {
      toast.error('请选择 .torrent 格式的种子文件')
      return
    }
    setSubmitting(true)
    setVideoError(null)
    try {
      const base64 = await fileToBase64(file)
      const res = await createMagnetTask(token, { torrentBase64: base64, fileName: file.name })
      setDisk(res.disk)
      setTasks((prev) => {
        const rest = prev.filter((t) => t.infoHash !== res.task.infoHash)
        return [res.task, ...rest]
      })
      setSelectedHash(res.task.infoHash)
      setSelectedFileIndex(null)
      setShouldAutoPlay(false)
      setRestoredNotice(null)
      setRightTab('tasks')
      saveSessionSnapshot(null)
      setHistory((prev) =>
        upsertHistoryItem(prev, {
          infoHash: res.task.infoHash,
          name: res.task.name,
          magnetURI: res.task.magnetURI || `magnet:?xt=urn:btih:${res.task.infoHash}`,
        }),
      )
      setPollPaused(false)
      toast.success(`已解析种子「${res.task.name}」`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '种子解析失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSelectFile = (
    task: MagnetTaskItem,
    file: MagnetFileItem,
    opts?: { autoPlay?: boolean; resumeTime?: number; overrideMode?: PlayMode },
  ) => {
    const nextMode: PlayMode =
      opts?.overrideMode ??
      (!file.browserNativePlayable && status?.ffmpegAvailable ? 'remux' : 'native')
    const safeMode = nextMode !== 'native' && !status?.ffmpegAvailable ? 'native' : nextMode

    setSelectedHash(task.infoHash)
    setSelectedFileIndex(file.index)
    setPlayMode(safeMode)
    setShouldAutoPlay(opts?.autoPlay ?? true)
    setVideoError(null)
    saveSessionSnapshot({ infoHash: task.infoHash, fileIndex: file.index, playMode: safeMode })

    // 查找历史断点进度
    const existingHist = history.find(
      (h) => h.infoHash === task.infoHash && h.fileIndex === file.index,
    )
    const seekTime = opts?.resumeTime ?? (existingHist && existingHist.currentTime > 5 ? existingHist.currentTime : 0)
    if (seekTime > 3) {
      pendingSeekRef.current = { infoHash: task.infoHash, fileIndex: file.index, time: seekTime }
      setRestoredNotice(`已定位至上次观看进度 ${formatPlaybackTime(seekTime)}`)
    } else {
      pendingSeekRef.current = null
      setRestoredNotice(null)
    }

    setHistory((prev) =>
      upsertHistoryItem(prev, {
        infoHash: task.infoHash,
        name: task.name,
        magnetURI: task.magnetURI || `magnet:?xt=urn:btih:${task.infoHash}`,
        fileIndex: file.index,
        fileName: file.name,
        playMode: safeMode,
        currentTime: existingHist?.fileIndex === file.index ? existingHist.currentTime : 0,
        duration: existingHist?.fileIndex === file.index ? existingHist.duration : 0,
      }),
    )

    // 选择新文件时自动挂载同任务首个可用字幕（若之前未挂载本地字幕）
    if (selectedSubtitleIndex !== 'local') {
      const firstSub = task.files.find((f) => f.kind === 'subtitle' && f.browserNativePlayable)
      setSelectedSubtitleIndex(firstSub ? firstSub.index : 'none')
    }
  }

  /** 停止当前正在进行的下载/播放流，保留任务与文件列表以便重新选片 */
  const handleStopDownload = async (infoHash: string) => {
    if (selectedHash === infoHash) {
      try {
        videoRef.current?.pause()
      } catch {
        // 忽略
      }
      setSelectedFileIndex(null)
      setShouldAutoPlay(false)
      setVideoError(null)
      setRestoredNotice(null)
      saveSessionSnapshot(null)
    }
    try {
      const res = await stopMagnetTaskDownload(token, infoHash)
      setDisk(res.disk)
      setTasks((prev) => prev.map((t) => (t.infoHash === infoHash ? res.task : t)))
      toast.success('已停止播放并取消当前下载（文件列表与已缓冲分片已保留）')
    } catch (err) {
      const msg = err instanceof Error ? err.message : '停止下载失败'
      if (msg.includes('接口不存在') || msg.includes('404')) {
        toast.error('后端进程尚未重启，请先重启 server/index.mjs 以加载最新停止下载接口')
      } else {
        toast.error(msg)
      }
    }
  }

  /** 从播放历史一键恢复或重新加载磁力 */
  const handleResumeHistory = async (item: MagnetHistoryItem) => {
    const existingTask = tasks.find((t) => t.infoHash === item.infoHash)
    if (existingTask) {
      setRightTab('tasks')
      if (existingTask.ready && item.fileIndex !== null) {
        const matched = existingTask.files.find((f) => f.index === item.fileIndex)
        if (matched) {
          handleSelectFile(existingTask, matched, {
            autoPlay: true,
            resumeTime: item.currentTime,
            overrideMode: item.playMode,
          })
          return
        }
      }
      setSelectedHash(existingTask.infoHash)
      toast.info('已切回该任务，请在文件列表中选择要播放的集数')
      return
    }

    // 后端缓存已过期或已清除，自动按记录的 magnetURI 重新提交解析
    setRightTab('tasks')
    await handleAddMagnet(item.magnetURI)
  }

  const handleDeleteHistoryItem = (infoHash: string) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h.infoHash !== infoHash)
      saveHistory(next)
      return next
    })
  }

  const handleClearHistory = () => {
    setHistory([])
    saveHistory([])
    toast.success('已清空本地观看历史记录')
  }

  const handleDeleteTask = async (infoHash: string) => {
    try {
      const res = await deleteMagnetTask(token, infoHash)
      setDisk(res.disk)
      setTasks((prev) => prev.filter((t) => t.infoHash !== infoHash))
      if (selectedHash === infoHash) {
        setSelectedHash(null)
        setSelectedFileIndex(null)
        setShouldAutoPlay(false)
        setVideoError(null)
        setRestoredNotice(null)
        saveSessionSnapshot(null)
      }
      toast.success('已停止任务并彻底删除临时缓存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除任务失败')
    }
  }

  const handleClearAllCache = async () => {
    setClearingCache(true)
    try {
      const res = await clearMagnetCache(token)
      setTasks([])
      setDisk(res.disk)
      setSelectedHash(null)
      setSelectedFileIndex(null)
      setShouldAutoPlay(false)
      setVideoError(null)
      setRestoredNotice(null)
      saveSessionSnapshot(null)
      toast.success(`已清理 ${res.clearedTasks} 个任务并释放全部磁盘缓存`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清理缓存失败')
    } finally {
      setClearingCache(false)
    }
  }

  const handleLocalSubtitleUpload = async (file: File) => {
    try {
      const text = await file.text()
      if (localSubUrl) URL.revokeObjectURL(localSubUrl)
      const url = convertLocalSubtitleToVttUrl(text)
      setLocalSubUrl(url)
      setLocalSubName(file.name)
      setSelectedSubtitleIndex('local')
      toast.success(`已挂载本地字幕：${file.name}`)
    } catch {
      toast.error('本地字幕读取失败')
    }
  }

  // 当前播放器直链与字幕 URL
  const videoSrc = useMemo(() => {
    if (!activeTask || !activeFile) return ''
    return buildStreamUrl(activeTask.infoHash, activeFile.index, playMode, token, false)
  }, [activeTask, activeFile, playMode, token])

  const nativeAbsoluteUrl = useMemo(() => {
    if (!activeTask || !activeFile) return ''
    return buildStreamUrl(activeTask.infoHash, activeFile.index, 'native', token, true)
  }, [activeTask, activeFile, token])

  const externalLinks = useMemo(
    () => (nativeAbsoluteUrl ? buildExternalPlayerLinks(nativeAbsoluteUrl) : null),
    [nativeAbsoluteUrl],
  )

  const activeSubtitleUrl = useMemo(() => {
    if (selectedSubtitleIndex === 'none') return null
    if (selectedSubtitleIndex === 'local') return localSubUrl
    if (!activeTask) return null
    return buildSubtitleUrl(activeTask.infoHash, selectedSubtitleIndex, token)
  }, [selectedSubtitleIndex, localSubUrl, activeTask, token])

  const isLowDiskSpace = disk.diskFreeBytes !== null && disk.diskFreeBytes < 5 * 1024 * 1024 * 1024

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 pb-10">
      {/* 外网未设口令安全警告横幅 */}
      {status?.available && isRemoteHost && !status.requiresAuth && (
        <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-amber-500/45 bg-amber-500/12 p-4 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <div className="font-bold">外网访问安全提醒：当前服务端尚未设置访问口令</div>
            <p className="mt-0.5 opacity-90">
              检测到您正在通过非本机地址访问。若电脑已做公网端口转发，强烈建议在{' '}
              <code className="rounded bg-black/10 px-1 py-0.5 font-mono dark:bg-white/10">
                server/config.json
              </code>{' '}
              中设置 <code className="rounded bg-black/10 px-1 py-0.5 font-mono dark:bg-white/10">magnet.token</code>（或环境变量{' '}
              <code className="rounded bg-black/10 px-1 py-0.5 font-mono dark:bg-white/10">MAGNET_TOKEN</code>），防止他人扫描端口盗刷宽带与磁盘空间。
            </p>
          </div>
        </div>
      )}

      {/* 服务连接异常 / 未安装 webtorrent / 需口令解锁 */}
      {loadingStatus ? (
        <div className="flex items-center justify-center gap-2.5 rounded-2xl border border-border/70 bg-card/80 p-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span>正在探测后端磁力流媒体引擎与 ffmpeg 环境…</span>
        </div>
      ) : statusError || !status ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-rose-500/35 bg-card/85 p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
            <div>
              <h2 className="text-base font-bold text-foreground">未连接到轻匣后端服务</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {statusError || '磁力链接解析依赖后端 BT 节点网络（TCP / UDP / DHT），请先在您的电脑上启动 server 服务。'}
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/40 p-3.5 font-mono text-xs text-foreground/90">
            <div># 1. 进入 server 目录并安装可选依赖</div>
            <div className="mt-1 text-primary">cd server &amp;&amp; pnpm install</div>
            <div className="mt-2"># 2. 复制配置模板并修改口令（magnet.token）与缓存盘符（magnet.cacheDir）</div>
            <div className="mt-1">copy config.example.json config.json   # macOS/Linux 用 cp</div>
            <div className="mt-2"># 3. 启动服务（自动读取 server/config.json）</div>
            <div className="mt-1 text-primary">node index.mjs</div>
          </div>
          <div>
            <Button size="sm" onClick={() => refreshStatusAndTasks(token)}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              重新检测服务
            </Button>
          </div>
        </div>
      ) : !status.enabled || !status.available ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-amber-500/35 bg-card/85 p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div>
              <h2 className="text-base font-bold text-foreground">
                {!status.enabled ? '后端已关闭磁力流媒体模块' : '后端尚未安装 webtorrent 可选依赖'}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {!status.enabled
                  ? '请移除 ENABLE_MAGNET=false 环境变量后重启服务。'
                  : status.loadError || '为了保持默认静态服务零依赖，请在 server 目录下安装可选依赖后重启服务。'}
              </p>
            </div>
          </div>
          {status.enabled && (
            <div className="rounded-xl border border-border/70 bg-muted/40 p-3 font-mono text-xs">
              {status.installHint}
            </div>
          )}
          <div>
            <Button size="sm" onClick={() => refreshStatusAndTasks(token)}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              重新检测
            </Button>
          </div>
        </div>
      ) : status.requiresAuth && !status.authorized ? (
        /* 访问口令解锁卡片 */
        <form
          onSubmit={handleUnlock}
          className="mx-auto flex w-full max-w-md flex-col gap-4 rounded-2xl border border-border/75 bg-card/90 p-6 shadow-sm"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">磁力流媒体已启用口令保护</h2>
              <p className="text-xs text-muted-foreground">
                请输入 server/config.json 中配置的 magnet.token（或 MAGNET_TOKEN）解锁
              </p>
            </div>
          </div>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="输入访问口令…"
            autoFocus
            className="h-10 rounded-xl border border-border/80 bg-background px-3.5 text-sm outline-none focus:border-primary"
          />
          <Button type="submit" disabled={verifyingAuth}>
            {verifyingAuth ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="mr-1.5 h-4 w-4" />
            )}
            验证并解锁
          </Button>
        </form>
      ) : (
        /* ==================== 引擎已就绪主界面 ==================== */
        <>
          {/* 顶部引擎与省磁盘状态栏 */}
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/75 bg-card/85 px-4 py-3 text-xs shadow-sm backdrop-blur-md">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                BT 引擎在线
              </span>
              <span
                className={cn(
                  'flex items-center gap-1.5 font-medium',
                  status.ffmpegAvailable
                    ? 'text-sky-600 dark:text-sky-400'
                    : 'text-muted-foreground',
                )}
                title={status.ffmpegVersion || '未在宿主机 PATH 检测到 ffmpeg'}
              >
                <Zap className="h-3.5 w-3.5" />
                {status.ffmpegAvailable ? 'FFmpeg 兼容转码可用' : '未装 FFmpeg（仅直出+外置播放器）'}
              </span>
              <span
                className={cn(
                  'flex items-center gap-1.5',
                  isLowDiskSpace ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
                )}
                title={status.cacheDir ? `缓存路径：${status.cacheDir}` : undefined}
              >
                <HardDrive className="h-3.5 w-3.5" />
                已用缓存 <strong className="font-mono text-foreground">{formatBytes(disk.cacheBytes)}</strong>
                {disk.diskFreeBytes !== null && (
                  <span>（所在盘剩余 {formatBytes(disk.diskFreeBytes)}）</span>
                )}
              </span>
              <span className="hidden text-muted-foreground lg:inline">
                按需省盘 · 最多 {status.maxTasks} 任务 · 空闲 {status.idleMinutes} 分钟自动删盘
                {status.uploadLimitBytes > 0 ? ` · 上行限速 ${formatSpeed(status.uploadLimitBytes)}` : ''}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {status.requiresAuth && (
                <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="h-3 w-3" />
                  口令已保护
                </span>
              )}
              {pollPaused && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => refreshStatusAndTasks(token)}
                  className="h-7 text-xs"
                >
                  <RefreshCw className="mr-1 h-3 w-3" />
                  恢复同步
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearAllCache}
                disabled={clearingCache}
                className="h-7 text-xs text-rose-600 hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
              >
                {clearingCache ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="mr-1 h-3 w-3" />
                )}
                清空全部缓存
              </Button>
              {status.requiresAuth && (
                <Button variant="ghost" size="sm" onClick={handleLockOut} className="h-7 text-xs">
                  <Lock className="mr-1 h-3 w-3" />
                  锁定
                </Button>
              )}
            </div>
          </section>

          {/* 磁力链 / .torrent 种子输入栏（支持拖放） */}
          <section
            onDragOver={(e) => {
              e.preventDefault()
              setIsDraggingTorrent(true)
            }}
            onDragLeave={() => setIsDraggingTorrent(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDraggingTorrent(false)
              const f = e.dataTransfer.files?.[0]
              if (f) handleTorrentFile(f)
            }}
            className={cn(
              'rounded-2xl border bg-card/85 p-4 shadow-sm transition-colors sm:p-5',
              isDraggingTorrent
                ? 'border-primary bg-primary/8 ring-2 ring-primary/25'
                : 'border-border/75',
            )}
          >
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Magnet className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={magnetInput}
                  onChange={(e) => setMagnetInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddMagnet()
                  }}
                  placeholder="粘贴 magnet:?xt=urn:btih:... 磁力链接，或将 .torrent 种子文件拖放到此处"
                  className="h-11 w-full rounded-xl border border-border/80 bg-background/90 pr-3 pl-10 font-mono text-xs outline-none focus:border-primary sm:text-sm"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => handleAddMagnet()} disabled={submitting} className="h-11 px-5">
                  {submitting ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-1.5 h-4 w-4" />
                  )}
                  解析磁力
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => torrentFileInputRef.current?.click()}
                  disabled={submitting}
                  className="h-11 px-3.5"
                >
                  <Upload className="mr-1.5 h-4 w-4" />
                  选 .torrent
                </Button>
                <input
                  ref={torrentFileInputRef}
                  type="file"
                  accept=".torrent"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleTorrentFile(f)
                    e.target.value = ''
                  }}
                />
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>
                省盘可控：解析种子后<strong>默认不自动下载也不自动播放</strong>，请从右侧选定文件后再播；播放中随时可点「停止下载」中断拉流。
              </span>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleAddMagnet(DEMO_OPENSOURCE_MAGNET)}
                className="font-medium text-primary hover:underline"
              >
                试用开源测试短片（Sintel · 公有领域）
              </button>
            </div>
          </section>

          {/* 主舞台：左侧影院播放器 + 右侧任务与选集清单（minmax(0, ...) 严格防长文件名撑破布局） */}
          <div className="grid w-full min-w-0 grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
            {/* 左侧：影院播放器区 */}
            <section className="flex min-w-0 max-w-full flex-col gap-3.5 overflow-hidden rounded-2xl border border-border/75 bg-card/85 p-4 shadow-sm">
              {/* 16:9 视频容器 */}
              <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black/95">
                {videoSrc && activeFile && activeTask ? (
                  <video
                    key={`${videoSrc}-${activeSubtitleUrl || 'nosub'}`}
                    ref={videoRef}
                    src={videoSrc}
                    controls
                    autoPlay={shouldAutoPlay}
                    playsInline
                    crossOrigin="anonymous"
                    onLoadedMetadata={(e) => {
                      const el = e.currentTarget
                      const pending = pendingSeekRef.current
                      if (
                        pending &&
                        pending.infoHash === activeTask.infoHash &&
                        pending.fileIndex === activeFile.index &&
                        playMode === 'native' &&
                        Number.isFinite(el.duration) &&
                        el.duration > pending.time + 2
                      ) {
                        try {
                          el.currentTime = pending.time
                        } catch {
                          // 忽略浏览器尚未缓冲到该位置的异常
                        }
                        pendingSeekRef.current = null
                      }
                    }}
                    onTimeUpdate={(e) => {
                      const now = Date.now()
                      if (now - lastProgressSaveRef.current < 3000) return
                      const el = e.currentTarget
                      if (!Number.isFinite(el.currentTime) || el.currentTime < 1) return
                      lastProgressSaveRef.current = now
                      setHistory((prev) =>
                        upsertHistoryItem(prev, {
                          infoHash: activeTask.infoHash,
                          name: activeTask.name,
                          magnetURI: activeTask.magnetURI || `magnet:?xt=urn:btih:${activeTask.infoHash}`,
                          fileIndex: activeFile.index,
                          fileName: activeFile.name,
                          playMode,
                          currentTime: el.currentTime,
                          duration: Number.isFinite(el.duration) ? el.duration : 0,
                        }),
                      )
                    }}
                    onError={() => {
                      setVideoError(
                        playMode === 'native'
                          ? '浏览器无法原生解码当前视频格式（常见于 MKV / H.265 / AC3 音频），建议切换「轻转封装 / 全兼容转码」或用 PotPlayer / VLC 播放。'
                          : '流式转码播放中断，可能是源分片仍在缓冲或编码异常，可稍等几秒重试或改用外置播放器直链。',
                      )
                    }}
                    onCanPlay={() => setVideoError(null)}
                    className="h-full w-full object-contain"
                  >
                    {activeSubtitleUrl && (
                      <track kind="subtitles" src={activeSubtitleUrl} srcLang="zh" label="字幕" default />
                    )}
                  </video>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-slate-400">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/6">
                      {activeTask && !activeTask.ready ? (
                        <Loader2 className="h-7 w-7 animate-spin text-primary" />
                      ) : (
                        <FileVideo className="h-7 w-7 opacity-70" />
                      )}
                    </div>
                    <div className="max-w-full px-2 text-sm font-semibold text-slate-200">
                      {activeTask && !activeTask.ready
                        ? `正在从 DHT / Tracker 拉取元数据（已连 ${activeTask.numPeers} 个节点）…`
                        : activeTask && activeTask.ready
                          ? `种子已就绪（共 ${activeTask.files.filter((f) => f.kind === 'video' || f.kind === 'audio').length} 个音视频），请在右侧点击选择播放`
                          : '粘贴磁力链接或上传 .torrent 种子后，从右侧选片播放'}
                    </div>
                    <div className="max-w-md text-xs text-slate-400">
                      {activeTask && !activeTask.ready
                        ? '冷门磁力初次寻源可能需要 10–30 秒；若不想等待可随时取消本次加载'
                        : '当前未发起任何文件下载（0 占带宽与磁盘），点击右侧目标视频才按需拉流'}
                    </div>
                    {activeTask && !activeTask.ready && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleDeleteTask(activeTask.infoHash)}
                        className="mt-1 h-8 text-xs"
                      >
                        <XCircle className="mr-1.5 h-3.5 w-3.5" />
                        取消本次加载
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* 断点续播 / 刷新恢复提示条 */}
              {restoredNotice && activeFile && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-sky-500/30 bg-sky-500/8 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">
                  <span className="truncate">{restoredNotice}</span>
                  <button
                    type="button"
                    onClick={() => setRestoredNotice(null)}
                    className="shrink-0 text-[11px] opacity-75 hover:opacity-100"
                  >
                    知道了
                  </button>
                </div>
              )}

              {/* 解码失败时的智能引导条 */}
              {videoError && activeFile && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{videoError}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {status.ffmpegAvailable && playMode === 'native' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setVideoError(null)
                          setPlayMode('remux')
                        }}
                        className="h-7 text-xs"
                      >
                        切至轻转封装
                      </Button>
                    )}
                    {status.ffmpegAvailable && playMode !== 'compat' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setVideoError(null)
                          setPlayMode('compat')
                        }}
                        className="h-7 text-xs"
                      >
                        切至 H.264 全兼容
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* 播放模式、字幕与外置播放器控制条 */}
              {activeTask && activeFile && (
                <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/65 bg-muted/25 p-3.5">
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-2.5">
                    <div className="min-w-0 flex-1">
                      <div
                        className="break-all text-sm leading-snug font-bold text-foreground line-clamp-2"
                        title={activeFile.path}
                      >
                        {activeFile.name}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                        <span>体积 {formatBytes(activeFile.length)}</span>
                        <span>
                          已缓冲 {formatBytes(activeFile.downloaded)}（{(activeFile.progress * 100).toFixed(1)}%）
                        </span>
                        <span className="text-emerald-600 dark:text-emerald-400">
                          ↓ {formatSpeed(activeTask.downloadSpeed)}
                        </span>
                        <span>↑ {formatSpeed(activeTask.uploadSpeed)}</span>
                        <span className="inline-flex items-center gap-0.5">
                          <Users className="h-3 w-3" /> {activeTask.numPeers}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleStopDownload(activeTask.infoHash)}
                        className="h-8 border border-amber-500/35 bg-amber-500/10 text-xs text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
                      >
                        <Square className="mr-1.5 h-3 w-3 fill-current" />
                        停止并取消下载
                      </Button>

                      <Segmented
                        size="sm"
                        value={playMode}
                        onChange={(v) => {
                          const m = v as PlayMode
                          if (m !== 'native' && !status.ffmpegAvailable) {
                            toast.error('本机未检测到 ffmpeg，请安装后重启服务，或使用外置播放器直链')
                            return
                          }
                          setVideoError(null)
                          setShouldAutoPlay(true)
                          setPlayMode(m)
                          saveSessionSnapshot({
                            infoHash: activeTask.infoHash,
                            fileIndex: activeFile.index,
                            playMode: m,
                          })
                        }}
                        options={[
                          { value: 'native', label: '原生直出' },
                          { value: 'remux', label: '轻转封装' },
                          { value: 'compat', label: 'H.264 兼容' },
                        ]}
                      />
                    </div>
                  </div>

                  {/* 字幕选择 + 外置播放器直链 */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Subtitles className="h-3.5 w-3.5" />
                        字幕：
                      </span>
                      <select
                        aria-label="选择字幕"
                        value={String(selectedSubtitleIndex)}
                        onChange={(e) => {
                          const v = e.target.value
                          if (v === 'none' || v === 'local') setSelectedSubtitleIndex(v)
                          else setSelectedSubtitleIndex(Number(v))
                        }}
                        className="h-7 max-w-[180px] rounded-lg border border-border/75 bg-background px-2 text-xs outline-none focus:border-primary"
                      >
                        <option value="none">关闭字幕</option>
                        {taskSubtitles.map((sub) => (
                          <option key={sub.index} value={String(sub.index)}>
                            种子内：{sub.name}
                          </option>
                        ))}
                        {localSubUrl && <option value="local">本地：{localSubName}</option>}
                      </select>
                      <button
                        type="button"
                        onClick={() => localSubInputRef.current?.click()}
                        className="text-[11px] font-medium text-primary hover:underline"
                      >
                        加载本地 .srt/.vtt
                      </button>
                      <input
                        ref={localSubInputRef}
                        type="file"
                        accept=".srt,.vtt"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) handleLocalSubtitleUpload(f)
                          e.target.value = ''
                        }}
                      />
                    </div>

                    {externalLinks && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground">外置播放器（零转码）：</span>
                        <a
                          href={externalLinks.potplayer}
                          className="inline-flex items-center gap-1 rounded-lg border border-border/75 bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:border-primary hover:text-primary"
                        >
                          <ExternalLink className="h-3 w-3" />
                          PotPlayer
                        </a>
                        <a
                          href={externalLinks.vlc}
                          className="inline-flex items-center gap-1 rounded-lg border border-border/75 bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:border-primary hover:text-primary"
                        >
                          VLC
                        </a>
                        <a
                          href={externalLinks.iina}
                          className="inline-flex items-center gap-1 rounded-lg border border-border/75 bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:border-primary hover:text-primary"
                        >
                          IINA
                        </a>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(nativeAbsoluteUrl)
                              toast.success('已复制 HTTP 播放直链，可在 PotPlayer / VLC 中 Ctrl+U 粘贴播放')
                            } catch {
                              toast.error('复制失败')
                            }
                          }}
                          className="h-7 px-2 text-[11px]"
                        >
                          <Copy className="mr-1 h-3 w-3" />
                          复制直链
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* 右侧：活跃任务与剧集文件清单 + 播放历史记录 */}
            <aside className="flex min-w-0 max-w-full flex-col gap-3 overflow-hidden rounded-2xl border border-border/75 bg-card/85 p-4 shadow-sm">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
                <div className="flex items-center gap-1 rounded-xl bg-muted/50 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setRightTab('tasks')}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-colors',
                      rightTab === 'tasks'
                        ? 'bg-background text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <FolderArchive className="h-3.5 w-3.5 text-primary" />
                    活跃任务（{tasks.length}/{status.maxTasks}）
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightTab('history')}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-colors',
                      rightTab === 'history'
                        ? 'bg-background text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <History className="h-3.5 w-3.5 text-primary" />
                    观看记录（{history.length}）
                  </button>
                </div>

                {rightTab === 'tasks' ? (
                  <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={onlyShowVideos}
                      onChange={(e) => setOnlyShowVideos(e.target.checked)}
                      className="accent-primary"
                    />
                    仅看音视频
                  </label>
                ) : (
                  history.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearHistory}
                      className="shrink-0 text-[11px] text-muted-foreground hover:text-rose-600"
                    >
                      清空记录
                    </button>
                  )
                )}
              </div>

              {rightTab === 'history' ? (
                history.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-xs text-muted-foreground">
                    <History className="h-8 w-8 opacity-30" />
                    <div>暂无观看与磁力解析记录</div>
                    <div className="opacity-80">播放视频时会自动保存进度，刷新页面可无缝续播</div>
                  </div>
                ) : (
                  <div className="max-h-[560px] min-w-0 space-y-2.5 overflow-x-hidden overflow-y-auto pr-1">
                    {history.map((item) => {
                      const inCache = tasks.some((t) => t.infoHash === item.infoHash)
                      const pct =
                        item.duration > 0
                          ? Math.min(100, Math.round((item.currentTime / item.duration) * 100))
                          : 0
                      return (
                        <div
                          key={item.infoHash}
                          className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-background/65 p-3"
                        >
                          <div className="flex min-w-0 items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-bold text-foreground" title={item.name}>
                                {item.name}
                              </div>
                              {item.fileName && (
                                <div
                                  className="mt-0.5 truncate text-[11px] text-muted-foreground"
                                  title={item.fileName}
                                >
                                  上次看到：{item.fileName}
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteHistoryItem(item.infoHash)}
                              title="移除此记录"
                              className="shrink-0 text-muted-foreground hover:text-rose-500"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          {item.currentTime > 0 && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                                <span>
                                  进度 {formatPlaybackTime(item.currentTime)}
                                  {item.duration > 0 ? ` / ${formatPlaybackTime(item.duration)}` : ''}
                                </span>
                                {pct > 0 && <span>{pct}%</span>}
                              </div>
                              {pct > 0 && (
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                  <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                                </div>
                              )}
                            </div>
                          )}

                          <div className="flex items-center justify-between gap-2 pt-0.5">
                            <span
                              className={cn(
                                'rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                                inCache
                                  ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
                                  : 'bg-muted text-muted-foreground',
                              )}
                            >
                              {inCache ? '仍在缓存 · 秒续播' : '已清盘 · 可一键重载'}
                            </span>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={submitting}
                              onClick={() => handleResumeHistory(item)}
                              className="h-7 px-2.5 text-[11px]"
                            >
                              <Play className="mr-1 h-3 w-3" />
                              {inCache ? '继续播放' : '重新加载'}
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              ) : tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-xs text-muted-foreground">
                  <Magnet className="h-8 w-8 opacity-30" />
                  <div>当前暂无活跃磁力任务</div>
                  <div className="opacity-80">缓存目录干净，0 字节额外磁盘占用</div>
                </div>
              ) : (
                <div className="max-h-[600px] min-w-0 space-y-3 overflow-x-hidden overflow-y-auto pr-0.5">
                  {tasks.map((task) => {
                    const visibleFiles = onlyShowVideos
                      ? task.files.filter((f) => f.kind === 'video' || f.kind === 'audio')
                      : task.files
                    const isCurrentTask = activeTask?.infoHash === task.infoHash
                    // 仅当存在选中播放文件、活跃拉流/转码或未暂停且在下载时，才判定为下载中（兼容旧后端未重启状态）
                    const isDownloading =
                      task.ready &&
                      (task.activeFileIndex !== null ||
                        (task.activeStreams ?? 0) > 0 ||
                        task.activeTranscodes > 0 ||
                        (task.downloadSpeed > 0 && task.paused !== true))
                    return (
                      <div
                        key={task.infoHash}
                        className={cn(
                          'flex min-w-0 max-w-full flex-col gap-2 overflow-hidden rounded-xl border p-3 transition-colors',
                          isCurrentTask
                            ? 'border-primary/45 bg-primary/4'
                            : 'border-border/70 bg-background/60',
                        )}
                      >
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div
                              className="truncate text-xs font-bold text-foreground"
                              title={task.name}
                            >
                              {task.name}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
                              {task.ready && !isDownloading ? (
                                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  待选片 · 未下载
                                </span>
                              ) : (
                                <span className="text-emerald-600 dark:text-emerald-400">
                                  ↓ {formatSpeed(task.downloadSpeed)}
                                </span>
                              )}
                              <span>节点 {task.numPeers}</span>
                              <span>已下 {formatBytes(task.downloaded)}</span>
                              <span>空闲清理 {formatIdleTime(task.idleRemainingSec)}</span>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            {!task.ready ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteTask(task.infoHash)}
                                title="取消正在寻源的磁力加载任务"
                                className="h-7 px-2 text-[11px] text-amber-600 hover:bg-amber-500/10 hover:text-amber-600 dark:text-amber-400"
                              >
                                <XCircle className="mr-1 h-3 w-3" />
                                取消加载
                              </Button>
                            ) : (
                              <>
                                {isDownloading && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleStopDownload(task.infoHash)}
                                    title="立即停止当前下载与播放，保留文件列表"
                                    className="h-7 px-2 text-[11px] text-amber-600 hover:bg-amber-500/10 hover:text-amber-600 dark:text-amber-400"
                                  >
                                    <Square className="mr-1 h-2.5 w-2.5 fill-current" />
                                    停止
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteTask(task.infoHash)}
                                  title="彻底移除任务并立即删除临时文件释放磁盘"
                                  className="h-7 px-2 text-[11px] text-rose-600 hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400"
                                >
                                  <Trash2 className="mr-1 h-3 w-3" />
                                  删缓存
                                </Button>
                              </>
                            )}
                          </div>
                        </div>

                        {!task.ready ? (
                          <div className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                            <span className="truncate">正在寻源拉取种子文件清单…</span>
                          </div>
                        ) : visibleFiles.length === 0 ? (
                          <div className="rounded-lg bg-muted/35 px-2.5 py-2 text-[11px] text-muted-foreground">
                            当前筛选下无音视频文件（可取消勾选“仅看音视频”查看全部 {task.files.length} 个文件）
                          </div>
                        ) : (
                          /* 采用 block space-y 布局 + shrink-0 彻底避免 Flexbox 在溢出滚动时压缩按钮高度 */
                          <div className="max-h-80 min-w-0 space-y-1.5 overflow-x-hidden overflow-y-auto pr-1">
                            {visibleFiles.map((f) => {
                              const isPlaying =
                                activeTask?.infoHash === task.infoHash && activeFile?.index === f.index
                              const canPlay = f.kind === 'video' || f.kind === 'audio'
                              return (
                                <button
                                  key={f.index}
                                  type="button"
                                  disabled={!canPlay}
                                  onClick={() => canPlay && handleSelectFile(task, f)}
                                  className={cn(
                                    'flex min-h-[38px] w-full min-w-0 max-w-full shrink-0 items-center justify-between gap-2 overflow-hidden rounded-lg border px-2.5 py-2 text-left text-xs transition-all',
                                    isPlaying
                                      ? 'border-primary bg-primary/14 font-semibold text-primary'
                                      : canPlay
                                        ? 'border-border/55 bg-background/75 text-foreground hover:border-border hover:bg-muted/40'
                                        : 'cursor-default border-transparent bg-muted/25 text-muted-foreground opacity-75',
                                  )}
                                >
                                  <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                                    {f.kind === 'video' ? (
                                      <FileVideo className="h-3.5 w-3.5 shrink-0" />
                                    ) : f.kind === 'audio' ? (
                                      <FileAudio className="h-3.5 w-3.5 shrink-0" />
                                    ) : (
                                      <FileText className="h-3.5 w-3.5 shrink-0" />
                                    )}
                                    <span className="block min-w-0 flex-1 truncate leading-snug" title={f.path}>
                                      {f.name}
                                    </span>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] opacity-85">
                                    {f.downloaded > 0 && (
                                      <span
                                        className="rounded bg-emerald-500/15 px-1 text-[9px] text-emerald-700 dark:text-emerald-400"
                                        title={`本地已缓存 ${formatBytes(f.downloaded)}`}
                                      >
                                        {Math.min(100, Math.round(f.progress * 100))}%
                                      </span>
                                    )}
                                    {f.kind === 'video' && !f.browserNativePlayable && (
                                      <span className="rounded bg-amber-500/15 px-1 text-[9px] text-amber-700 dark:text-amber-300">
                                        {f.ext.replace('.', '').toUpperCase()}
                                      </span>
                                    )}
                                    <span>{formatBytes(f.length)}</span>
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  )
}
