import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Copy,
  Download,
  FileText,
  Headphones,
  KeyRound,
  Loader2,
  Lock,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Square,
  Subtitles,
  Users,
  Volume2,
  WifiOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { downloadBlob } from '@/lib/file'
import { cn } from '@/lib/utils'
import {
  base64ToBlob,
  buildPreviewUrl,
  DEMO_DIALOGUE_NEWS,
  DEMO_DIALOGUE_STORY,
  DEMO_SINGLE_TEXT,
  fetchTtsStatus,
  fetchTtsVoices,
  formatBytes,
  formatCueTime,
  formatDurationMs,
  loadTtsToken,
  parseDialogueScript,
  saveTtsToken,
  splitBrowserSentences,
  synthesizeSpeech,
  verifyTtsToken,
  type EdgeVoiceItem,
  type ScriptMode,
  type SubtitleCue,
  type TtsEngine,
  type TtsServiceStatus,
  type VoiceGroup,
} from './engine'

const QUICK_ROLE_TAGS = ['晓晓', '云希', '云扬', '晓伊', '云健', '小北', '晓曼']

export default function TextToSpeechTool() {
  // 引擎与模式
  const [engine, setEngine] = useState<TtsEngine>('edge')
  const [scriptMode, setScriptMode] = useState<ScriptMode>('single')
  const [text, setText] = useState<string>(DEMO_SINGLE_TEXT)

  // 后端状态与鉴权
  const [token, setToken] = useState<string>(() => loadTtsToken())
  const [tokenInput, setTokenInput] = useState<string>(() => loadTtsToken())
  const [showUnlockBox, setShowUnlockBox] = useState<boolean>(false)
  const [verifyingToken, setVerifyingToken] = useState<boolean>(false)
  const [status, setStatus] = useState<TtsServiceStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [loadingStatus, setLoadingStatus] = useState<boolean>(true)

  // Edge 主播与参数
  const [voices, setVoices] = useState<EdgeVoiceItem[]>([])
  const [voiceGroup, setVoiceGroup] = useState<VoiceGroup>('zh-cn')
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('zh-CN-XiaoxiaoNeural')
  const [ratePct, setRatePct] = useState<number>(0)
  const [pitchHz, setPitchHz] = useState<number>(0)
  const [volumePct, setVolumePct] = useState<number>(0)
  const [includeSpeakerInSrt, setIncludeSpeakerInSrt] = useState<boolean>(true)
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null)

  // 合成结果与同步字幕播放
  const [synthesizing, setSynthesizing] = useState<boolean>(false)
  const [resultAudioUrl, setResultAudioUrl] = useState<string | null>(null)
  const [resultAudioBlob, setResultAudioBlob] = useState<Blob | null>(null)
  const [resultMeta, setResultMeta] = useState<{
    durationMs: number
    byteLength: number
    chunkCount: number
    cues: SubtitleCue[]
    srt: string
  } | null>(null)
  const [audioCurrentMs, setAudioCurrentMs] = useState<number>(0)

  // 浏览器原生朗读状态
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([])
  const [selectedBrowserVoice, setSelectedBrowserVoice] = useState<string>('')
  const [browserRate, setBrowserRate] = useState<number>(1)
  const [browserPitch, setBrowserPitch] = useState<number>(1)
  const [browserVolume, setBrowserVolume] = useState<number>(1)
  const [browserSpeaking, setBrowserSpeaking] = useState<boolean>(false)
  const [browserPaused, setBrowserPaused] = useState<boolean>(false)
  const [activeSentenceIdx, setActiveSentenceIdx] = useState<number>(-1)

  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const resultAudioRef = useRef<HTMLAudioElement | null>(null)
  const browserStopFlagRef = useRef<boolean>(false)

  // 释放 Blob URL 与停止原生朗读
  useEffect(() => {
    return () => {
      if (resultAudioUrl) URL.revokeObjectURL(resultAudioUrl)
    }
  }, [resultAudioUrl])

  useEffect(() => {
    return () => {
      previewAudioRef.current?.pause()
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  // 加载后端 TTS 状态与音色目录（仅主动发一次，绝不死循环）
  const loadBackend = useCallback(async (activeToken: string) => {
    setLoadingStatus(true)
    setStatusError(null)
    try {
      const [st, voiceRes] = await Promise.all([
        fetchTtsStatus(activeToken),
        fetchTtsVoices(activeToken),
      ])
      setStatus(st)
      setVoices(voiceRes.voices)
    } catch (err) {
      setStatus(null)
      setStatusError(err instanceof Error ? err.message : '后端未启动')
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  useEffect(() => {
    loadBackend(token)
  }, [loadBackend, token])

  // 加载浏览器原生语音包（中文优先排序）
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const loadVoices = () => {
      const list = window.speechSynthesis.getVoices()
      const sorted = [...list].sort((a, b) => {
        const aZh = a.lang.toLowerCase().startsWith('zh') ? 0 : 1
        const bZh = b.lang.toLowerCase().startsWith('zh') ? 0 : 1
        if (aZh !== bZh) return aZh - bZh
        return a.name.localeCompare(b.name)
      })
      setBrowserVoices(sorted)
      if (!selectedBrowserVoice && sorted.length > 0) {
        setSelectedBrowserVoice(sorted[0].voiceURI)
      }
    }
    loadVoices()
    window.speechSynthesis.onvoiceschanged = loadVoices
    return () => {
      window.speechSynthesis.onvoiceschanged = null
    }
  }, [selectedBrowserVoice])

  // 按分组过滤 Edge 音色
  const filteredVoices = useMemo(
    () => voices.filter((v) => v.group === voiceGroup),
    [voices, voiceGroup],
  )

  const selectedVoiceMeta = useMemo(
    () => voices.find((v) => v.id === selectedVoiceId) ?? voices[0] ?? null,
    [voices, selectedVoiceId],
  )

  // 多角色剧本实时解析预览
  const parsedDialogue = useMemo(() => {
    if (scriptMode !== 'dialogue') return []
    return parseDialogueScript(text, voices, selectedVoiceId)
  }, [scriptMode, text, voices, selectedVoiceId])

  const browserSentences = useMemo(() => splitBrowserSentences(text), [text])

  // 试听单个主播样音（所有人免费试听，不扣每日次数）
  const handlePreviewVoice = async (voiceId: string) => {
    if (!status?.available) {
      toast.error('后端 Edge 神经语音引擎未就绪')
      return
    }
    if (previewingVoiceId === voiceId) {
      previewAudioRef.current?.pause()
      setPreviewingVoiceId(null)
      return
    }
    try {
      previewAudioRef.current?.pause()
      const audio = new Audio(buildPreviewUrl(voiceId, token))
      previewAudioRef.current = audio
      setPreviewingVoiceId(voiceId)
      audio.onended = () => setPreviewingVoiceId(null)
      audio.onerror = () => {
        setPreviewingVoiceId(null)
        toast.error('样音加载失败，请检查网络连接或后端状态')
      }
      await audio.play()
    } catch {
      setPreviewingVoiceId(null)
      toast.error('无法播放样音')
    }
  }

  // Edge 神经语音合成 MP3 + SRT
  const handleSynthesize = async () => {
    const trimmed = text.trim()
    if (!trimmed) {
      toast.error('请先输入要转换为语音的文字')
      return
    }
    const effectiveLimit = status?.effectiveMaxChars ?? status?.maxChars ?? 1000
    if (trimmed.length > effectiveLimit) {
      toast.error(
        status?.unlocked
          ? `当前字数 ${trimmed.length} 超过单次上限 ${effectiveLimit} 字`
          : `免费体验单次上限为 ${effectiveLimit} 字（当前 ${trimmed.length} 字），可缩减文本或输入口令解锁 ${status?.maxChars ?? 15000} 字`,
      )
      return
    }

    setSynthesizing(true)
    try {
      const payload =
        scriptMode === 'dialogue'
          ? {
              includeSpeakerInSrt,
              segments: parsedDialogue.map((seg) => ({
                text: seg.text,
                voice: seg.voiceId,
                rate: ratePct,
                pitch: pitchHz,
                volume: volumePct,
                speakerLabel: seg.speakerLabel,
              })),
            }
          : {
              text: trimmed,
              voice: selectedVoiceId,
              rate: ratePct,
              pitch: pitchHz,
              volume: volumePct,
              includeSpeakerInSrt: false,
            }

      const res = await synthesizeSpeech(token, payload)
      if (res.quota) {
        setStatus((prev) => (prev ? { ...prev, ...res.quota } : prev))
      }
      const blob = base64ToBlob(res.audioBase64, res.mime)
      const nextUrl = URL.createObjectURL(blob)

      setResultAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return nextUrl
      })
      setResultAudioBlob(blob)
      setResultMeta({
        durationMs: res.durationMs,
        byteLength: res.byteLength,
        chunkCount: res.chunkCount,
        cues: res.cues,
        srt: res.srt,
      })
      setAudioCurrentMs(0)
      toast.success(
        `合成完成（${formatDurationMs(res.durationMs)} · ${formatBytes(res.byteLength)} · ${res.cues.length} 条同步字幕）`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '语音合成失败')
      // 若额度变化（如 429）同步一次最新状态
      loadBackend(token).catch(() => {})
    } finally {
      setSynthesizing(false)
    }
  }

  // 浏览器原生逐句高亮跟读
  const stopBrowserSpeech = useCallback(() => {
    browserStopFlagRef.current = true
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setBrowserSpeaking(false)
    setBrowserPaused(false)
    setActiveSentenceIdx(-1)
  }, [])

  const startBrowserSpeech = (startFromIndex = 0) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      toast.error('当前浏览器不支持原生 Web Speech API 朗读')
      return
    }
    if (browserSentences.length === 0) {
      toast.error('请先输入文字内容')
      return
    }

    window.speechSynthesis.cancel()
    browserStopFlagRef.current = false
    setBrowserSpeaking(true)
    setBrowserPaused(false)

    const voiceObj = browserVoices.find((v) => v.voiceURI === selectedBrowserVoice) ?? null

    const speakIndex = (idx: number) => {
      if (browserStopFlagRef.current || idx >= browserSentences.length) {
        setBrowserSpeaking(false)
        setBrowserPaused(false)
        setActiveSentenceIdx(-1)
        return
      }
      setActiveSentenceIdx(idx)
      const utter = new SpeechSynthesisUtterance(browserSentences[idx])
      if (voiceObj) utter.voice = voiceObj
      utter.rate = browserRate
      utter.pitch = browserPitch
      utter.volume = browserVolume
      utter.onend = () => {
        if (!browserStopFlagRef.current) speakIndex(idx + 1)
      }
      utter.onerror = () => {
        if (!browserStopFlagRef.current) {
          setBrowserSpeaking(false)
          setActiveSentenceIdx(-1)
        }
      }
      window.speechSynthesis.speak(utter)
    }

    speakIndex(startFromIndex)
  }

  const toggleBrowserPause = () => {
    if (!('speechSynthesis' in window)) return
    if (browserPaused) {
      window.speechSynthesis.resume()
      setBrowserPaused(false)
    } else {
      window.speechSynthesis.pause()
      setBrowserPaused(true)
    }
  }

  const insertRoleTag = (role: string) => {
    setText((prev) => {
      const prefix = prev.trim().length > 0 && !prev.endsWith('\n') ? '\n' : ''
      return `${prev}${prefix}[${role}] `
    })
  }

  const handleSaveToken = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = tokenInput.trim()
    if (!trimmed) {
      toast.error('请输入解锁口令')
      return
    }
    setVerifyingToken(true)
    try {
      const res = await verifyTtsToken(trimmed)
      saveTtsToken(trimmed)
      setToken(trimmed)
      setStatus((prev) => (prev ? { ...prev, ...res.quota } : prev))
      setShowUnlockBox(false)
      toast.success('口令验证通过，已解锁无限次合成与长文额度！')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '口令验证失败')
    } finally {
      setVerifyingToken(false)
    }
  }

  const handleLockToken = () => {
    saveTtsToken('')
    setToken('')
    setTokenInput('')
    setShowUnlockBox(false)
    toast.info('已退出站主口令模式，恢复为每日免费额度')
  }

  const activeCueIndex = useMemo(() => {
    if (!resultMeta) return -1
    return resultMeta.cues.findIndex(
      (c) => audioCurrentMs >= c.startMs && audioCurrentMs <= c.endMs + 80,
    )
  }, [resultMeta, audioCurrentMs])

  const quotaExhausted = Boolean(
    status?.available && !status.unlimited && (status.remainingToday ?? 0) <= 0,
  )
  const canSynthesizeNow = Boolean(status?.available && !quotaExhausted)
  const effectiveMaxChars = status?.effectiveMaxChars ?? status?.maxChars ?? 1000

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 pb-12">
      {/* 顶部引擎切换与状态栏 */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/75 bg-card/85 px-4 py-3 shadow-sm backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            size="sm"
            value={engine}
            onChange={(v) => {
              stopBrowserSpeech()
              setEngine(v as TtsEngine)
            }}
            options={[
              { value: 'edge', label: 'Edge 神经语音（导出 MP3 + SRT）' },
              { value: 'browser', label: '浏览器原生朗读（纯离线）' },
            ]}
          />
          {engine === 'edge' && (
            <Segmented
              size="sm"
              value={scriptMode}
              onChange={(v) => {
                const next = v as ScriptMode
                setScriptMode(next)
                if (next === 'dialogue' && text === DEMO_SINGLE_TEXT) {
                  setText(DEMO_DIALOGUE_NEWS)
                } else if (next === 'single' && (text === DEMO_DIALOGUE_NEWS || text === DEMO_DIALOGUE_STORY)) {
                  setText(DEMO_SINGLE_TEXT)
                }
              }}
              options={[
                { value: 'single', label: '单人配音' },
                { value: 'dialogue', label: '多角色对话' },
              ]}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {engine === 'edge' ? (
            loadingStatus ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                检测语音引擎…
              </span>
            ) : status?.available ? (
              <>
                {status.unlocked ? (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    口令已解锁 · 无限次（上限 {status.maxChars.toLocaleString()} 字）
                  </span>
                ) : status.unlimited ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Edge 神经语音就绪 · 上限 {status.maxChars.toLocaleString()} 字
                  </span>
                ) : (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-medium',
                      quotaExhausted
                        ? 'border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                        : 'border-border/75 bg-muted/40 text-foreground',
                    )}
                  >
                    今日免费剩余{' '}
                    <strong className="font-mono">
                      {status.remainingToday ?? 0} / {status.dailyFreeLimit}
                    </strong>{' '}
                    次（≤ {status.freeMaxChars.toLocaleString()} 字/次）
                  </span>
                )}

                {status.hasUnlockToken &&
                  (status.unlocked ? (
                    <Button variant="ghost" size="sm" onClick={handleLockToken} className="h-7 px-2 text-xs">
                      <Lock className="mr-1 h-3 w-3" />
                      锁定
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowUnlockBox((v) => !v)}
                      className="h-7 px-2.5 text-xs"
                    >
                      <KeyRound className="mr-1 h-3 w-3" />
                      口令解锁无限
                    </Button>
                  ))}
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <WifiOff className="h-3.5 w-3.5" />
                后端神经语音未就绪
              </span>
            )
          ) : (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Headphones className="h-3.5 w-3.5 text-primary" />
              已检测到 {browserVoices.length} 个本机/浏览器语音包
            </span>
          )}
        </div>
      </section>

      {/* Edge 引擎未启动 / 额度耗尽 / 口令解锁条 */}
      {engine === 'edge' && !loadingStatus && (!status?.available || quotaExhausted || showUnlockBox) && (
        <section className="flex flex-col gap-3 rounded-2xl border border-amber-500/35 bg-card/90 p-4 shadow-sm sm:p-5">
          {!status?.available ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-bold text-foreground">
                  {statusError
                    ? '未连接到轻匣后端服务（Edge 神经语音导出需配合 server 运行）'
                    : status?.loadError || '后端尚未安装 msedge-tts 可选依赖'}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => loadBackend(token)} className="h-8 text-xs">
                    <RefreshCw className="mr-1 h-3.5 w-3.5" />
                    重新检测
                  </Button>
                  <Button size="sm" onClick={() => setEngine('browser')} className="h-8 text-xs">
                    先用浏览器离线朗读 →
                  </Button>
                </div>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/40 p-3 font-mono text-xs text-foreground/90">
                cd server &amp;&amp; pnpm install &amp;&amp; node index.mjs
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-3">
              {quotaExhausted && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-bold text-foreground">
                    {status.dailyFreeLimit === 0
                      ? '当前站点已将神经语音设为口令专享模式'
                      : `今日 ${status.dailyFreeLimit} 次免费神经语音额度已用完（明日 00:00 自动重置）`}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setEngine('browser')} className="h-7 text-xs">
                    切到浏览器离线朗读 →
                  </Button>
                </div>
              )}

              {status.hasUnlockToken && !status.unlocked && (
                <form onSubmit={handleSaveToken} className="flex flex-wrap items-center gap-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <KeyRound className="h-3.5 w-3.5 text-primary" />
                    <span>站主输入口令立即解除每日次数与字数限制：</span>
                  </div>
                  <input
                    type="password"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="输入 adminToken 或 tts.token…"
                    className="h-9 w-56 rounded-xl border border-border/80 bg-background px-3 text-xs outline-none focus:border-primary"
                  />
                  <Button type="submit" size="sm" disabled={verifyingToken} className="h-9">
                    {verifyingToken ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    验证并解锁无限
                  </Button>
                </form>
              )}
            </div>
          )}
        </section>
      )}

      {/* ==================== 主双栏工作台 ==================== */}
      <div className="grid w-full min-w-0 grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        {/* 左栏：文本/剧本编辑 + 合成结果与实时字幕跟读 */}
        <section className="flex min-w-0 flex-col gap-4">
          {/* 文本输入卡片 */}
          <div className="flex flex-col gap-3 rounded-2xl border border-border/75 bg-card/85 p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                {scriptMode === 'dialogue' && engine === 'edge' ? (
                  <Users className="h-4 w-4 text-primary" />
                ) : (
                  <FileText className="h-4 w-4 text-primary" />
                )}
                <span>
                  {engine === 'edge' && scriptMode === 'dialogue'
                    ? '多角色对话剧本（支持 [晓晓] / 【云希】 / 云扬：语法）'
                    : '朗读与配音文本'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {engine === 'edge' && scriptMode === 'dialogue' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setText(DEMO_DIALOGUE_NEWS)}
                      className="rounded-lg border border-border/70 px-2 py-1 text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
                    >
                      示例：双人播报
                    </button>
                    <button
                      type="button"
                      onClick={() => setText(DEMO_DIALOGUE_STORY)}
                      className="rounded-lg border border-border/70 px-2 py-1 text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
                    >
                      示例：故事对话
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setText(DEMO_SINGLE_TEXT)}
                    className="rounded-lg border border-border/70 px-2 py-1 text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
                  >
                    填入示例文案
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setText('')}
                  className="rounded-lg border border-border/70 px-2 py-1 text-[11px] text-muted-foreground hover:text-rose-500"
                >
                  清空
                </button>
              </div>
            </div>

            {/* 多角色快捷标签插入条 */}
            {engine === 'edge' && scriptMode === 'dialogue' && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border/60 bg-muted/25 px-3 py-2 text-[11px]">
                <span className="text-muted-foreground">快速插入角色：</span>
                {QUICK_ROLE_TAGS.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => insertRoleTag(role)}
                    className="rounded-md border border-border/70 bg-background px-2 py-0.5 font-medium text-foreground hover:border-primary hover:text-primary"
                  >
                    [{role}]
                  </button>
                ))}
              </div>
            )}

            <textarea
              rows={9}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                engine === 'edge' && scriptMode === 'dialogue'
                  ? '输入多角色剧本，例如：\n[晓晓] 大家好，欢迎收听今天的节目！\n[云希] 没错，今天的话题非常精彩。'
                  : '在此输入或粘贴需要转为语音的文章、解说词、播客稿或英语学习材料…'
              }
              className="w-full resize-y rounded-xl border border-border/80 bg-background/85 p-3.5 text-sm leading-relaxed text-foreground outline-none focus:border-primary"
            />

            {/* 底部统计与主触发按钮 */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-muted-foreground">
                <span>
                  总字数{' '}
                  <strong
                    className={cn(
                      engine === 'edge' && text.trim().length > effectiveMaxChars
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-foreground',
                    )}
                  >
                    {text.trim().length}
                  </strong>
                  {engine === 'edge' && status?.available ? ` / ${effectiveMaxChars}` : ''}
                </span>
                {engine === 'edge' && scriptMode === 'dialogue' && (
                  <span>已识别 {parsedDialogue.length} 段角色对话</span>
                )}
                {engine === 'browser' && <span>共 {browserSentences.length} 句可跟读</span>}
              </div>

              {engine === 'edge' ? (
                <Button
                  onClick={handleSynthesize}
                  disabled={synthesizing || !canSynthesizeNow || text.trim().length === 0}
                  className="h-10 px-6"
                >
                  {synthesizing ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      正在合成高清语音与字幕…
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-1.5 h-4 w-4" />
                      立即合成 MP3 + SRT
                    </>
                  )}
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  {browserSpeaking ? (
                    <>
                      <Button variant="secondary" onClick={toggleBrowserPause} className="h-10">
                        {browserPaused ? (
                          <>
                            <Play className="mr-1.5 h-4 w-4" />
                            继续朗读
                          </>
                        ) : (
                          <>
                            <Pause className="mr-1.5 h-4 w-4" />
                            暂停
                          </>
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={stopBrowserSpeech}
                        className="h-10 text-rose-600 hover:bg-rose-500/10"
                      >
                        <Square className="mr-1.5 h-3.5 w-3.5 fill-current" />
                        停止
                      </Button>
                    </>
                  ) : (
                    <Button
                      onClick={() => startBrowserSpeech(0)}
                      disabled={browserSentences.length === 0}
                      className="h-10 px-5"
                    >
                      <Play className="mr-1.5 h-4 w-4" />
                      开始即时朗读
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 多角色剧本解析预览条 */}
          {engine === 'edge' && scriptMode === 'dialogue' && parsedDialogue.length > 0 && (
            <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm">
              <div className="mb-2.5 flex items-center justify-between text-xs font-semibold text-foreground">
                <span>角色分配预览（将按顺序无缝拼接为单条 MP3）</span>
                <span className="font-mono text-muted-foreground">{parsedDialogue.length} 段</span>
              </div>
              <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1 text-xs">
                {parsedDialogue.map((seg, i) => (
                  <div
                    key={`${i}-${seg.voiceId}`}
                    className="flex items-start gap-2 rounded-lg border border-border/55 bg-background/70 px-2.5 py-1.5"
                  >
                    <span className="shrink-0 rounded bg-primary/12 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                      {seg.speakerLabel} · {seg.voiceName}
                    </span>
                    <span className="line-clamp-1 flex-1 text-muted-foreground">{seg.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Edge 合成结果播放器与实时同步字幕舞台 */}
          {engine === 'edge' && resultAudioUrl && resultMeta && resultAudioBlob && (
            <div className="flex flex-col gap-4 rounded-2xl border border-primary/35 bg-card/90 p-4 shadow-sm sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <Volume2 className="h-4 w-4 text-primary" />
                  <span>合成成品与同步字幕</span>
                  <span className="rounded-full bg-primary/12 px-2 py-0.5 font-mono text-[11px] text-primary">
                    {formatDurationMs(resultMeta.durationMs)} · {formatBytes(resultMeta.byteLength)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      downloadBlob(
                        resultAudioBlob,
                        `litebox-tts-${Date.now()}.mp3`,
                      )
                    }
                    className="h-8 text-xs"
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    下载 MP3
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const srtBlob = new Blob([resultMeta.srt], { type: 'text/plain;charset=utf-8' })
                      downloadBlob(srtBlob, `litebox-tts-${Date.now()}.srt`)
                    }}
                    className="h-8 text-xs"
                  >
                    <Subtitles className="mr-1.5 h-3.5 w-3.5" />
                    下载 .srt 字幕
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(resultMeta.srt)
                        toast.success('已复制标准 SRT 字幕')
                      } catch {
                        toast.error('复制失败')
                      }
                    }}
                    className="h-8 text-xs"
                  >
                    <Copy className="mr-1 h-3.5 w-3.5" />
                    复制 SRT
                  </Button>
                </div>
              </div>

              <audio
                ref={resultAudioRef}
                src={resultAudioUrl}
                controls
                onTimeUpdate={(e) => setAudioCurrentMs(e.currentTarget.currentTime * 1000)}
                className="w-full"
              />

              {/* 逐句同步高亮字幕列表（点击任意一句精准跳播） */}
              {resultMeta.cues.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>同步字幕时间轴（点击任意一句跳转复听，导出 .srt 可直接导入剪映）</span>
                    <span className="font-mono">{resultMeta.cues.length} 条</span>
                  </div>
                  <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                    {resultMeta.cues.map((cue, idx) => {
                      const isActive = idx === activeCueIndex
                      return (
                        <button
                          key={cue.index}
                          type="button"
                          onClick={() => {
                            const el = resultAudioRef.current
                            if (!el) return
                            el.currentTime = cue.startMs / 1000
                            el.play().catch(() => {})
                          }}
                          className={cn(
                            'flex w-full items-start gap-2.5 rounded-xl border px-3 py-2 text-left text-xs transition-all',
                            isActive
                              ? 'border-primary bg-primary/12 font-semibold text-foreground shadow-xs'
                              : 'border-border/55 bg-background/70 text-muted-foreground hover:border-border hover:text-foreground',
                          )}
                        >
                          <span className="shrink-0 font-mono text-[10px] text-primary">
                            {formatCueTime(cue.startMs)}
                          </span>
                          {cue.speaker && (
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.2 text-[10px] font-medium text-foreground">
                              {cue.speaker}
                            </span>
                          )}
                          <span className="flex-1 leading-relaxed">{cue.text}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 浏览器原生模式：逐句跟读高亮卡 */}
          {engine === 'browser' && browserSentences.length > 0 && (
            <div className="rounded-2xl border border-border/75 bg-card/85 p-4 shadow-sm">
              <div className="mb-2.5 text-xs font-semibold text-muted-foreground">
                逐句高亮跟读（点击任意一句从该句开始朗读）
              </div>
              <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1 text-sm">
                {browserSentences.map((sent, idx) => {
                  const active = idx === activeSentenceIdx
                  return (
                    <button
                      key={`${idx}-${sent.slice(0, 12)}`}
                      type="button"
                      onClick={() => startBrowserSpeech(idx)}
                      className={cn(
                        'block w-full rounded-xl border px-3 py-2 text-left leading-relaxed transition-all',
                        active
                          ? 'border-primary bg-primary/12 font-semibold text-foreground'
                          : 'border-transparent bg-muted/25 text-muted-foreground hover:border-border hover:text-foreground',
                      )}
                    >
                      {sent}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        {/* 右栏：主播音色库与语音参数精调 */}
        <aside className="flex min-w-0 flex-col gap-4">
          {engine === 'edge' ? (
            <>
              {/* Edge 神经主播音色选择 */}
              <div className="flex flex-col gap-3 rounded-2xl border border-border/75 bg-card/85 p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                    <Mic className="h-4 w-4 text-primary" />
                    <span>
                      {scriptMode === 'dialogue' ? '默认旁白主播 & 音色试听' : '选择高拟真主播音色'}
                    </span>
                  </div>
                  {selectedVoiceMeta && (
                    <span className="rounded-md bg-primary/12 px-2 py-0.5 text-[11px] font-semibold text-primary">
                      当前：{selectedVoiceMeta.name}
                    </span>
                  )}
                </div>

                <Segmented
                  size="sm"
                  value={voiceGroup}
                  onChange={(v) => setVoiceGroup(v as VoiceGroup)}
                  options={[
                    { value: 'zh-cn', label: '中文普通话' },
                    { value: 'zh-dialect', label: '方言与港台' },
                    { value: 'intl', label: '英日韩外语' },
                  ]}
                />

                <div className="max-h-[340px] space-y-1.5 overflow-y-auto pr-1">
                  {filteredVoices.map((v) => {
                    const isSelected = v.id === selectedVoiceId
                    const isPreviewing = previewingVoiceId === v.id
                    return (
                      <div
                        key={v.id}
                        onClick={() => setSelectedVoiceId(v.id)}
                        className={cn(
                          'flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2.5 transition-all',
                          isSelected
                            ? 'border-primary bg-primary/10 ring-1 ring-primary/25'
                            : 'border-border/65 bg-background/70 hover:border-border hover:bg-muted/35',
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-bold text-foreground">{v.name}</span>
                            <span
                              className={cn(
                                'rounded px-1.5 py-0.2 text-[10px]',
                                v.gender === 'female'
                                  ? 'bg-rose-500/12 text-rose-600 dark:text-rose-400'
                                  : 'bg-sky-500/12 text-sky-600 dark:text-sky-400',
                              )}
                            >
                              {v.gender === 'female' ? '女声' : '男声'}
                            </span>
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {v.styleTag}
                          </div>
                        </div>

                        <button
                          type="button"
                          title="试听主播样音"
                          onClick={(e) => {
                            e.stopPropagation()
                            handlePreviewVoice(v.id)
                          }}
                          className={cn(
                            'inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border px-2 text-[11px] font-medium transition-colors',
                            isPreviewing
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border/75 bg-background text-muted-foreground hover:border-primary hover:text-primary',
                          )}
                        >
                          {isPreviewing ? (
                            <>
                              <Square className="h-2.5 w-2.5 fill-current" />
                              停播
                            </>
                          ) : (
                            <>
                              <Volume2 className="h-3 w-3" />
                              试听
                            </>
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 语速 / 音调 / 音量 / 音质精调 */}
              <div className="flex flex-col gap-3.5 rounded-2xl border border-border/75 bg-card/85 p-4 shadow-sm">
                <div className="flex items-center justify-between text-sm font-bold text-foreground">
                  <span>声学参数与导出规格</span>
                  <button
                    type="button"
                    onClick={() => {
                      setRatePct(0)
                      setPitchHz(0)
                      setVolumePct(0)
                    }}
                    className="text-xs font-normal text-muted-foreground hover:text-primary"
                  >
                    恢复默认
                  </button>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">语速调节</span>
                    <span className="font-mono font-semibold text-foreground">
                      {ratePct >= 0 ? `+${ratePct}%` : `${ratePct}%`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-50}
                    max={100}
                    step={5}
                    value={ratePct}
                    onChange={(e) => setRatePct(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">音调高低</span>
                    <span className="font-mono font-semibold text-foreground">
                      {pitchHz >= 0 ? `+${pitchHz} Hz` : `${pitchHz} Hz`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-40}
                    max={40}
                    step={2}
                    value={pitchHz}
                    onChange={(e) => setPitchHz(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">输出音量</span>
                    <span className="font-mono font-semibold text-foreground">
                      {volumePct >= 0 ? `+${volumePct}%` : `${volumePct}%`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-40}
                    max={40}
                    step={5}
                    value={volumePct}
                    onChange={(e) => setVolumePct(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </div>

                <div className="rounded-xl border border-border/60 bg-muted/25 px-3 py-2 text-[11px] text-muted-foreground">
                  输出规格：24 kHz 48 kbps 清晰人声 MP3 + 逐帧毫秒对齐 SRT 字幕（纯内存合成，不占用电脑磁盘）
                </div>

                {scriptMode === 'dialogue' && (
                  <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/25 px-3 py-2 text-xs">
                    <span className="text-foreground">SRT 字幕行首附带 [角色名]</span>
                    <Switch
                      checked={includeSpeakerInSrt}
                      onChange={setIncludeSpeakerInSrt}
                      label="SRT 附带角色名"
                    />
                  </div>
                )}
              </div>
            </>
          ) : (
            /* 浏览器原生语音参数卡 */
            <div className="flex flex-col gap-4 rounded-2xl border border-border/75 bg-card/85 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <Headphones className="h-4 w-4 text-primary" />
                <span>浏览器原生语音包（离线可用）</span>
              </div>

              <div className="space-y-1.5 text-xs">
                <label className="text-muted-foreground">选择系统/浏览器语音</label>
                <select
                  value={selectedBrowserVoice}
                  onChange={(e) => setSelectedBrowserVoice(e.target.value)}
                  className="h-10 w-full rounded-xl border border-border/80 bg-background px-2.5 text-xs outline-none focus:border-primary"
                >
                  {browserVoices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">朗读倍速</span>
                  <span className="font-mono font-semibold">{browserRate.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={browserRate}
                  onChange={(e) => setBrowserRate(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">音调</span>
                  <span className="font-mono font-semibold">{browserPitch.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={browserPitch}
                  onChange={(e) => setBrowserPitch(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">音量</span>
                  <span className="font-mono font-semibold">{Math.round(browserVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={browserVolume}
                  onChange={(e) => setBrowserVolume(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>

              <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
                浏览器原生 <code>Web Speech API</code> 无需后端即可离线朗读与逐句高亮跟读；若需导出高清 MP3 与同步 SRT 字幕，请切换顶部「Edge 神经语音」引擎。
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
