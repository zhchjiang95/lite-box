import {
  ArrowLeftRight,
  BookOpen,
  Check,
  Copy,
  Download,
  FileCode2,
  Languages,
  Loader2,
  Printer,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { Button } from '@/components/ui/button'
import { Field, Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { downloadBlob, timestampName } from '@/lib/file'
import { cn } from '@/lib/utils'
import {
  OPENCC_PRESETS,
  SAMPLE_TEXTS,
  buildChangedSegments,
  buildCharDetailList,
  buildRubyHtmlSnippet,
  buildRubyTokens,
  convertToPinyinText,
  defaultPinyinOptions,
  runOpenCcConvert,
  type ConvertMode,
  type LetterCase,
  type OpenCcPresetId,
  type PinyinOptions,
  type PinyinSubMode,
  type SeparatorKind,
  type ToneStyle,
} from './engine'

const TONE_LABELS = ['轻声', '一声（阴平）', '二声（阳平）', '三声（上声）', '四声（去声）']

export default function ChineseConvert() {
  const [mode, setMode] = useState<ConvertMode>('opencc')
  const [sourceText, setSourceText] = useState(SAMPLE_TEXTS[0].text)

  // 简繁转换状态
  const [presetId, setPresetId] = useState<OpenCcPresetId>('cn-to-twp')
  const [highlightDiff, setHighlightDiff] = useState(true)
  const [openccOutput, setOpenccOutput] = useState('')
  const [converting, setConverting] = useState(false)

  // 拼音标注状态
  const [pyOpts, setPyOpts] = useState<PinyinOptions>(defaultPinyinOptions)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const setPy = <K extends keyof PinyinOptions>(k: K, v: PinyinOptions[K]) =>
    setPyOpts((prev) => ({ ...prev, [k]: v }))

  // 按需运行 OpenCC 转换
  useEffect(() => {
    if (mode !== 'opencc') return
    let cancelled = false
    setConverting(true)
    void runOpenCcConvert(sourceText, presetId)
      .then((res) => {
        if (!cancelled) setOpenccOutput(res)
      })
      .catch(() => {
        if (!cancelled) toast.error('繁简转换词库加载失败')
      })
      .finally(() => {
        if (!cancelled) setConverting(false)
      })
    return () => {
      cancelled = true
    }
  }, [mode, sourceText, presetId])

  const openccDiff = useMemo(
    () => (mode === 'opencc' ? buildChangedSegments(sourceText, openccOutput) : { changedCount: 0, segments: [] }),
    [mode, sourceText, openccOutput],
  )

  const pinyinOutput = useMemo(() => {
    if (mode !== 'pinyin' || (pyOpts.subMode !== 'full' && pyOpts.subMode !== 'initials')) return ''
    return convertToPinyinText(sourceText, pyOpts)
  }, [mode, sourceText, pyOpts])

  const rubyTokens = useMemo(() => {
    if (mode !== 'pinyin' || pyOpts.subMode !== 'ruby') return []
    return buildRubyTokens(sourceText, pyOpts)
  }, [mode, sourceText, pyOpts])

  const charDetails = useMemo(() => {
    if (mode !== 'pinyin' || pyOpts.subMode !== 'detail') return []
    return buildCharDetailList(sourceText, pyOpts.surnameMode)
  }, [mode, sourceText, pyOpts.subMode, pyOpts.surnameMode])

  const copyText = async (text: string, key: string, msg = '已复制到剪贴板') => {
    if (!text) {
      toast.error('当前没有可复制的内容')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      toast.success(msg)
      window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500)
    } catch {
      toast.error('复制失败，请手动复制')
    }
  }

  /** 导出转换结果为 .txt 或注音 HTML */
  const handleDownload = () => {
    if (mode === 'opencc') {
      if (!openccOutput) return
      downloadBlob(new Blob([openccOutput], { type: 'text/plain;charset=utf-8' }), timestampName('繁简转换', 'txt'))
      toast.success('已导出 .txt 文件')
      return
    }
    if (pyOpts.subMode === 'ruby') {
      if (!rubyTokens.length) return
      const bodyHtml = buildRubyHtmlSnippet(rubyTokens)
      const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><title>汉字注音卡片</title><style>body{font-family:"Kaiti SC","STKaiti","PingFang SC",serif;max-width:800px;margin:40px auto;padding:0 24px;font-size:28px;line-height:2.7;color:#111827}ruby{ruby-position:over;margin:0 3px}rt{font-family:system-ui,sans-serif;font-size:13px;color:#2563eb;font-weight:500}</style></head><body>${bodyHtml}</body></html>`
      downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), timestampName('汉字注音卡片', 'html'))
      toast.success('已导出语文注音 HTML 卡片')
      return
    }
    if (!pinyinOutput) return
    downloadBlob(new Blob([pinyinOutput], { type: 'text/plain;charset=utf-8' }), timestampName('汉字拼音', 'txt'))
    toast.success('已导出拼音 .txt 文件')
  }

  /** 打印语文注音卡片 */
  const handlePrintRuby = () => {
    if (!rubyTokens.length) return
    const bodyHtml = buildRubyHtmlSnippet(rubyTokens)
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    document.body.appendChild(iframe)
    const cleanup = () => iframe.remove()
    const doc = iframe.contentDocument
    if (!doc || !iframe.contentWindow) {
      cleanup()
      return
    }
    doc.open()
    doc.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><title>注音卡片打印</title><style>body{font-family:"Kaiti SC","STKaiti","PingFang SC",serif;padding:24mm 18mm;font-size:26px;line-height:2.8;color:#111}ruby{ruby-position:over;margin:0 3px}rt{font-family:system-ui,sans-serif;font-size:13px;color:#1d4ed8}</style></head><body>${bodyHtml}</body></html>`)
    doc.close()
    const win = iframe.contentWindow
    win.addEventListener('afterprint', cleanup, { once: true })
    window.setTimeout(cleanup, 60_000)
    window.setTimeout(() => {
      win.focus()
      win.print()
    }, 150)
  }

  /** 语音朗读原文本（配合注音卡片学习发音） */
  const speakSource = () => {
    if (!sourceText.trim()) return
    if (!('speechSynthesis' in window)) {
      toast.error('当前浏览器不支持语音朗读')
      return
    }
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(sourceText.slice(0, 500))
    utter.lang = 'zh-CN'
    utter.rate = 0.88
    window.speechSynthesis.speak(utter)
  }

  const handleImportFile = async (file: File) => {
    try {
      const content = await file.text()
      setSourceText(content)
      toast.success(`已导入「${file.name}」`)
    } catch {
      toast.error('读取文件失败')
    }
  }

  /** 左侧参数面板 */
  const panel = (
    <div className="space-y-5">
      <Segmented<ConvertMode>
        value={mode}
        onChange={setMode}
        options={[
          { value: 'opencc', label: '简繁互转', icon: <ArrowLeftRight className="size-3.5" /> },
          { value: 'pinyin', label: '拼音标注', icon: <BookOpen className="size-3.5" /> },
        ]}
      />

      {mode === 'opencc' ? (
        <div className="space-y-4">
          <Field label="OpenCC 转换方案">
            <div className="space-y-1.5">
              {OPENCC_PRESETS.map((p) => {
                const active = presetId === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPresetId(p.id)}
                    className={cn(
                      'w-full rounded-xl border px-3 py-2 text-left transition',
                      active
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-foreground/10 text-muted-foreground hover:border-foreground/25 hover:text-foreground',
                    )}
                  >
                    <div className="text-xs font-semibold">{p.label}</div>
                    <div className="mt-0.5 text-[10px] opacity-75">{p.desc}</div>
                  </button>
                )
              })}
            </div>
          </Field>

          <div className="flex items-center justify-between border-t pt-3">
            <div>
              <div className="text-xs font-medium">高亮已转换字符</div>
              <div className="text-muted-foreground text-[11px]">直观对比哪些字词发生了变动</div>
            </div>
            <Switch checked={highlightDiff} onChange={setHighlightDiff} label="高亮变动字符" />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="拼音功能模式">
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: 'full' as PinyinSubMode, label: '完整拼音' },
                { id: 'ruby' as PinyinSubMode, label: '头顶注音卡' },
                { id: 'initials' as PinyinSubMode, label: '首字母提取' },
                { id: 'detail' as PinyinSubMode, label: '多音字拆解' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPy('subMode', m.id)}
                  className={cn(
                    'rounded-xl border py-2 text-xs font-semibold transition',
                    pyOpts.subMode === m.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-foreground/10 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </Field>

          {(pyOpts.subMode === 'full' || pyOpts.subMode === 'ruby') && (
            <Field label="声调样式">
              <Segmented<ToneStyle>
                value={pyOpts.toneType}
                onChange={(v) => setPy('toneType', v)}
                size="sm"
                options={[
                  { value: 'symbol', label: 'zhōng' },
                  { value: 'num', label: 'zhong1' },
                  { value: 'none', label: 'zhong' },
                ]}
              />
            </Field>
          )}

          {pyOpts.subMode !== 'detail' && (
            <Field label="大小写格式">
              <Segmented<LetterCase>
                value={pyOpts.letterCase}
                onChange={(v) => setPy('letterCase', v)}
                size="sm"
                options={[
                  { value: 'lower', label: '全小写' },
                  { value: 'capitalize', label: '首字母大写' },
                  { value: 'upper', label: '全大写' },
                ]}
              />
            </Field>
          )}

          {(pyOpts.subMode === 'full' || pyOpts.subMode === 'initials') && (
            <Field label="分隔符">
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { id: 'space' as SeparatorKind, label: '空格' },
                  { id: 'dash' as SeparatorKind, label: '短横 -' },
                  { id: 'underscore' as SeparatorKind, label: '下划 _' },
                  { id: 'none' as SeparatorKind, label: '无分隔' },
                ].map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setPy('separator', s.id)}
                    className={cn(
                      'rounded-lg border py-1.5 text-[11px] font-medium transition',
                      pyOpts.separator === s.id
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-foreground/10 text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </Field>
          )}

          <div className="space-y-3 border-t pt-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-medium">姓氏多音字优先</div>
                <div className="text-muted-foreground text-[11px]">如 单(shàn)、解(xiè)、区(ōu)</div>
              </div>
              <Switch checked={pyOpts.surnameMode} onChange={(v) => setPy('surnameMode', v)} label="姓氏模式" />
            </div>

            {pyOpts.subMode !== 'detail' && (
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium">用 v 替代 ü</div>
                  <div className="text-muted-foreground text-[11px]">如 lǜ → lv，适合文件名/ID</div>
                </div>
                <Switch checked={pyOpts.vForU} onChange={(v) => setPy('vForU', v)} label="v 替代 ü" />
              </div>
            )}

            {(pyOpts.subMode === 'full' || pyOpts.subMode === 'initials') && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">保留英文、数字与标点</span>
                <Switch checked={pyOpts.keepNonChinese} onChange={(v) => setPy('keepNonChinese', v)} label="保留非汉字" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )

  const mainCopyPayload =
    mode === 'opencc'
      ? openccOutput
      : pyOpts.subMode === 'ruby'
        ? buildRubyHtmlSnippet(rubyTokens)
        : pyOpts.subMode === 'detail'
          ? charDetails.map((d) => `${d.char}\t${d.pinyin}\t声母:${d.initial}\t韵母:${d.final}`).join('\n')
          : pinyinOutput

  const actions = (
    <>
      <Button
        variant="primary"
        size="lg"
        disabled={!mainCopyPayload}
        onClick={() =>
          void copyText(
            mainCopyPayload,
            'main',
            mode === 'pinyin' && pyOpts.subMode === 'ruby' ? '已复制 HTML <ruby> 注音代码' : '已复制转换结果',
          )
        }
      >
        {copiedKey === 'main' ? <Check /> : <Copy />}
        {copiedKey === 'main'
          ? '已复制'
          : mode === 'pinyin' && pyOpts.subMode === 'ruby'
            ? '复制 Ruby 代码'
            : '复制结果'}
      </Button>
      {mode === 'pinyin' && pyOpts.subMode === 'ruby' ? (
        <Button variant="outline" size="lg" disabled={!rubyTokens.length} onClick={handlePrintRuby}>
          <Printer />
          打印注音卡
        </Button>
      ) : (
        <Button variant="outline" size="lg" disabled={!mainCopyPayload} onClick={handleDownload}>
          <Download />
          导出文件
        </Button>
      )}
    </>
  )

  return (
    <ToolShell panel={panel} actions={actions} panelTitle={mode === 'opencc' ? '繁简转换设置' : '拼音与注音设置'}>
      <div className="space-y-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.srt,.ass,.json,text/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void handleImportFile(f)
          }}
        />

        {/* 原文输入卡 */}
        <div className="glass overflow-hidden rounded-2xl">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 text-xs">
            <div className="flex items-center gap-2">
              <Languages className="text-primary size-4" />
              <span className="text-sm font-semibold">输入中文文本</span>
              <span className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 font-mono text-[11px]">
                {sourceText.length} 字
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {SAMPLE_TEXTS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setSourceText(s.text)}
                  className="border-foreground/10 hover:border-primary/50 hover:text-primary rounded-lg border px-2 py-1 text-[11px] font-medium transition"
                >
                  {s.label}
                </button>
              ))}
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={speakSource} title="朗读原文">
                <Volume2 className="size-3.5" />
              </Button>
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => fileInputRef.current?.click()}>
                <Upload className="size-3.5" />
                导入
              </Button>
              {sourceText && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive h-7 px-2 text-xs"
                  onClick={() => setSourceText('')}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          </div>

          <textarea
            rows={5}
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="在此输入或粘贴需要繁简转换、拼音标注、首字母提取的中文文本（支持导入 .txt / .srt 字幕文件）..."
            className="w-full resize-y bg-transparent p-4 text-sm leading-relaxed outline-none"
          />
        </div>

        {/* 转换结果展示卡 */}
        <div className="glass overflow-hidden rounded-2xl">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">
                {mode === 'opencc'
                  ? OPENCC_PRESETS.find((p) => p.id === presetId)?.label
                  : pyOpts.subMode === 'full'
                    ? '汉字转拼音结果'
                    : pyOpts.subMode === 'ruby'
                      ? '语文头顶注音卡片'
                      : pyOpts.subMode === 'initials'
                        ? '拼音首字母提取结果'
                        : '单字声韵母与多音字拆解'}
              </span>

              {mode === 'opencc' && (
                converting ? (
                  <span className="text-primary inline-flex items-center gap-1 text-[11px]">
                    <Loader2 className="size-3 animate-spin" />
                    加载 OpenCC 词库…
                  </span>
                ) : (
                  <span className="bg-primary/10 text-primary rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold">
                    共转换 {openccDiff.changedCount} 处字词
                  </span>
                )
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {mode === 'opencc' && openccOutput && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setSourceText(openccOutput)
                    toast.success('已将结果写回输入框')
                  }}
                >
                  <RotateCcw className="size-3.5" />
                  写回原文
                </Button>
              )}
              {mode === 'pinyin' && pyOpts.subMode === 'ruby' && rubyTokens.length > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => void copyText(buildRubyHtmlSnippet(rubyTokens), 'ruby', '已复制 HTML <ruby> 代码')}
                  >
                    <FileCode2 className="size-3.5" />
                    复制 HTML
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={handlePrintRuby}>
                    <Printer className="size-3.5" />
                    打印注音
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={!mainCopyPayload}
                onClick={() => void copyText(mainCopyPayload, 'bar')}
              >
                {copiedKey === 'bar' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                复制
              </Button>
            </div>
          </div>

          {/* 结果主体 */}
          {mode === 'opencc' ? (
            highlightDiff && openccOutput ? (
              <div className="min-h-[200px] p-4 text-sm leading-loose break-words whitespace-pre-wrap">
                {openccDiff.segments.map((seg, idx) =>
                  seg.changed ? (
                    <mark
                      key={idx}
                      className="rounded bg-sky-500/20 px-0.5 font-semibold text-sky-800 dark:text-sky-200"
                    >
                      {seg.text}
                    </mark>
                  ) : (
                    <span key={idx}>{seg.text}</span>
                  ),
                )}
              </div>
            ) : (
              <textarea
                readOnly
                rows={7}
                value={openccOutput}
                placeholder="繁简转换结果将实时显示在此处..."
                className="w-full resize-y bg-transparent p-4 text-sm leading-relaxed outline-none"
              />
            )
          ) : pyOpts.subMode === 'ruby' ? (
            <div className="min-h-[220px] p-6">
              {rubyTokens.length === 0 ? (
                <div className="text-muted-foreground py-12 text-center text-xs">请输入中文文本生成头顶注音卡片</div>
              ) : (
                <div
                  className="text-2xl leading-[2.8] tracking-wide sm:text-3xl"
                  style={{ fontFamily: '"Kaiti SC", "STKaiti", "PingFang SC", serif' }}
                >
                  {rubyTokens.map((t, idx) =>
                    t.isNewline ? (
                      <br key={idx} />
                    ) : t.isHanzi ? (
                      <ruby key={idx} className="mx-0.5 inline-flex flex-col-reverse items-center align-bottom">
                        <span>{t.origin}</span>
                        <rt className="text-primary font-sans text-xs font-medium tracking-normal sm:text-sm">
                          {t.pinyin}
                        </rt>
                      </ruby>
                    ) : (
                      <span key={idx} className="mx-0.5">
                        {t.origin}
                      </span>
                    ),
                  )}
                </div>
              )}
            </div>
          ) : pyOpts.subMode === 'detail' ? (
            charDetails.length === 0 ? (
              <div className="text-muted-foreground py-12 text-center text-xs">请输入汉字查看声母、韵母、声调与多音字</div>
            ) : (
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50 text-muted-foreground sticky top-0 border-b text-[11px]">
                    <tr>
                      <th className="w-16 px-4 py-2.5">汉字</th>
                      <th className="w-28 px-3 py-2.5">语境读音</th>
                      <th className="w-24 px-3 py-2.5">声母</th>
                      <th className="w-24 px-3 py-2.5">韵母</th>
                      <th className="w-28 px-3 py-2.5">声调</th>
                      <th className="px-3 py-2.5">全部读音（多音字标注）</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {charDetails.map((d, idx) => {
                      const isPoly = d.polyphones.length > 1
                      return (
                        <tr key={`${d.char}-${idx}`} className="hover:bg-foreground/[0.02]">
                          <td className="px-4 py-2.5 text-lg font-bold">{d.char}</td>
                          <td className="text-primary px-3 py-2.5 font-mono text-sm font-semibold">{d.pinyin}</td>
                          <td className="px-3 py-2.5 font-mono">{d.initial}</td>
                          <td className="px-3 py-2.5 font-mono">{d.final}</td>
                          <td className="text-muted-foreground px-3 py-2.5">{TONE_LABELS[d.toneNum] ?? '—'}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {d.polyphones.map((rd) => (
                                <span
                                  key={rd}
                                  className={cn(
                                    'rounded-md px-2 py-0.5 font-mono text-[11px]',
                                    rd === d.pinyin
                                      ? 'bg-primary/15 text-primary font-semibold'
                                      : 'bg-muted text-muted-foreground',
                                  )}
                                >
                                  {rd}
                                </span>
                              ))}
                              {isPoly && (
                                <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                                  <Sparkles className="size-2.5" />
                                  多音字
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <textarea
              readOnly
              rows={7}
              value={pinyinOutput}
              placeholder="拼音或首字母结果将实时显示在此处..."
              className="w-full resize-y bg-transparent p-4 font-mono text-sm leading-relaxed outline-none"
            />
          )}
        </div>
      </div>
    </ToolShell>
  )
}
