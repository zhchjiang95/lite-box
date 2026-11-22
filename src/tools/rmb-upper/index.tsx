import {
  AlertCircle,
  ArrowLeftRight,
  BookOpen,
  Calculator,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ListChecks,
  Trash2,
  Volume2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { Button } from '@/components/ui/button'
import { Field, Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { downloadBlob, timestampName } from '@/lib/file'
import { cn } from '@/lib/utils'
import {
  CHECK_COLUMNS,
  QUICK_AMOUNTS,
  UPPER_CHAR_TABLE,
  centsToDecimalString,
  defaultRmbOptions,
  numberToRmbUpper,
  rmbUpperToNumber,
  type RmbOptions,
} from './engine'

type WorkMode = 'single' | 'reverse' | 'batch'

const SAMPLE_BATCH = `12800.00
3560.50
980.05
107000.53
420.80`

export default function RmbUpper() {
  const [mode, setMode] = useState<WorkMode>('single')
  const [opts, setOpts] = useState<RmbOptions>(defaultRmbOptions)

  const [amountInput, setAmountInput] = useState('12345.67')
  const [reverseInput, setReverseInput] = useState('人民币壹拾万零柒仟元伍角叁分')
  const [batchInput, setBatchInput] = useState(SAMPLE_BATCH)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const setOpt = <K extends keyof RmbOptions>(k: K, v: RmbOptions[K]) =>
    setOpts((prev) => ({ ...prev, [k]: v }))

  /** 单笔实时转换结果 */
  const singleResult = useMemo(() => numberToRmbUpper(amountInput, opts), [amountInput, opts])

  /** 大写反查数字结果 */
  const reverseResult = useMemo(() => rmbUpperToNumber(reverseInput, opts), [reverseInput, opts])

  /** 批量多行转换 + 精确 BigInt 自动求和 */
  const batchData = useMemo(() => {
    const rawLines = batchInput.split(/\r?\n/)
    const rows = rawLines
      .map((line, i) => ({ line: line.trim(), index: i + 1 }))
      .filter((item) => item.line.length > 0)
      .map((item) => ({
        ...item,
        res: numberToRmbUpper(item.line, opts),
      }))

    let totalCents = 0n
    let validCount = 0
    for (const row of rows) {
      if (row.res.valid) {
        totalCents += row.res.cents
        validCount += 1
      }
    }

    const totalDecimal = centsToDecimalString(totalCents)
    const totalRes = numberToRmbUpper(totalDecimal, opts)
    const plainLines = rows.map((r) => (r.res.valid ? r.res.upper : `【格式有误】${r.line}`)).join('\n')

    return { rows, validCount, totalRes, plainLines }
  }, [batchInput, opts])

  const copyText = async (text: string, key: string) => {
    if (!text) {
      toast.error('当前没有可复制的内容')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      toast.success('已复制到剪贴板')
      setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500)
    } catch {
      toast.error('复制失败，请手动选中复制')
    }
  }

  /** 中文语音朗读核对（防止看错位数） */
  const speakUpper = (text: string) => {
    if (!text) return
    if (!('speechSynthesis' in window)) {
      toast.error('当前浏览器不支持语音朗读')
      return
    }
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'zh-CN'
    utter.rate = 0.92
    window.speechSynthesis.speak(utter)
  }

  /** 导出批量转换 CSV（含 UTF-8 BOM 防 Excel 乱码） */
  const exportBatchCsv = () => {
    if (!batchData.rows.length) {
      toast.error('请先输入至少一行金额')
      return
    }
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
    const lines = [
      '序号,原始输入,标准金额,财务大写金额',
      ...batchData.rows.map((r, i) =>
        `${i + 1},${esc(r.line)},${esc(r.res.valid ? r.res.normalized : '格式有误')},${esc(r.res.valid ? r.res.upper : r.res.error ?? '')}`,
      ),
      `合计,共 ${batchData.validCount} 笔,${esc(batchData.totalRes.normalized)},${esc(batchData.totalRes.upper)}`,
    ]
    downloadBlob(
      new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }),
      timestampName('人民币大写批量转换', 'csv'),
    )
    toast.success('已导出 CSV（Excel 直接打开无乱码）')
  }

  /** 左侧参数设置面板 */
  const panel = (
    <div className="space-y-5">
      <Segmented<WorkMode>
        value={mode}
        onChange={setMode}
        size="sm"
        options={[
          { value: 'single', label: '数字转大写' },
          { value: 'reverse', label: '大写查数字' },
          { value: 'batch', label: '批量求和' },
        ]}
      />

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-medium">添加“人民币”前缀</div>
            <div className="text-muted-foreground text-[11px]">合同/发票/收据标准写法</div>
          </div>
          <Switch checked={opts.prefix} onChange={(v) => setOpt('prefix', v)} label="添加人民币前缀" />
        </div>

        <Field label="货币主单位">
          <Segmented<'元' | '圆'>
            value={opts.yuanChar}
            onChange={(v) => setOpt('yuanChar', v)}
            size="sm"
            options={[
              { value: '元', label: '元（发票通用）' },
              { value: '圆', label: '圆（传统支票）' },
            ]}
          />
        </Field>

        <Field label="结尾“整 / 正”字">
          <Segmented<'整' | '正'>
            value={opts.zhengChar}
            onChange={(v) => setOpt('zhengChar', v)}
            size="sm"
            options={[
              { value: '整', label: '整（推荐）' },
              { value: '正', label: '正' },
            ]}
          />
        </Field>

        <div className="space-y-3 border-t pt-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-medium">“角”后加“{opts.zhengChar}”字</div>
              <div className="text-muted-foreground text-[11px]">如 0.50 → 伍角{opts.zhengChar}</div>
            </div>
            <Switch
              checked={opts.zhengAfterJiao}
              onChange={(v) => setOpt('zhengAfterJiao', v)}
              label="角后加整字"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-medium">防涂改“壹拾”规范</div>
              <div className="text-muted-foreground text-[11px]">10 万写作“壹拾万”防篡改</div>
            </div>
            <Switch
              checked={opts.strictYiShi}
              onChange={(v) => setOpt('strictYiShi', v)}
              label="严格壹拾规范"
            />
          </div>
        </div>

        {/* 填写规范精简提示 */}
        <div className="bg-primary/5 border-primary/15 text-muted-foreground space-y-1.5 rounded-xl border p-3 text-[11px] leading-relaxed">
          <div className="text-foreground flex items-center gap-1.5 font-semibold">
            <BookOpen className="text-primary size-3.5" />
            《支付结算办法》要点
          </div>
          <p>• 到“元”为止须写“整/正”；到“角”可写“整/正”；到“分”不写“整/正”。</p>
          <p>• 金额前应紧接“人民币”三字，不留空隙，以防涂改。</p>
          <p>• 超过 2 位小数时自动按财务四舍五入精确到“分”。</p>
        </div>
      </div>
    </div>
  )

  const mainCopyText =
    mode === 'single'
      ? singleResult.upper
      : mode === 'reverse'
        ? reverseResult.numeric
        : batchData.plainLines

  const actions = (
    <>
      <Button
        variant="primary"
        size="lg"
        disabled={!mainCopyText}
        onClick={() => void copyText(mainCopyText, 'action')}
      >
        {copiedKey === 'action' ? <Check /> : <Copy />}
        {copiedKey === 'action'
          ? '已复制'
          : mode === 'single'
            ? '复制大写金额'
            : mode === 'reverse'
              ? '复制数字金额'
              : '复制全部大写'}
      </Button>
      {mode === 'batch' ? (
        <Button variant="outline" size="lg" disabled={batchData.rows.length === 0} onClick={exportBatchCsv}>
          <Download />
          导出 CSV
        </Button>
      ) : (
        <Button
          variant="outline"
          size="lg"
          disabled={mode === 'single' ? !singleResult.valid : !reverseResult.valid}
          onClick={() => speakUpper(mode === 'single' ? singleResult.upper : reverseResult.canonicalUpper)}
        >
          <Volume2 />
          语音核对
        </Button>
      )}
    </>
  )

  return (
    <ToolShell panel={panel} actions={actions} panelTitle="财务规范设置">
      <div className="space-y-4">
        {mode === 'single' && (
          <>
            {/* 金额输入卡片 */}
            <div className="glass rounded-2xl p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="rmb-input" className="flex items-center gap-2 text-sm font-semibold">
                  <Calculator className="text-primary size-4" />
                  输入阿拉伯数字金额
                </label>
                {amountInput && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive h-7 px-2 text-xs"
                    onClick={() => setAmountInput('')}
                  >
                    <Trash2 className="size-3.5" />
                    清空
                  </Button>
                )}
              </div>

              <div className="bg-background focus-within:border-primary focus-within:ring-primary/20 flex items-center gap-2 rounded-2xl border px-4 py-3 transition focus-within:ring-4">
                <span className="text-muted-foreground font-mono text-2xl font-bold select-none">¥</span>
                <input
                  id="rmb-input"
                  type="text"
                  inputMode="decimal"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder="输入金额，如 12345.67（支持粘贴带逗号或 ¥ 符号）"
                  className="min-w-0 flex-1 bg-transparent font-mono text-2xl font-semibold tracking-tight outline-none sm:text-3xl"
                />
              </div>

              {/* 快捷常用测试金额 */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground mr-1 text-[11px]">快捷示例：</span>
                {QUICK_AMOUNTS.map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setAmountInput(num)}
                    className={cn(
                      'rounded-lg border px-2 py-0.5 font-mono text-[11px] transition',
                      amountInput === num
                        ? 'border-primary bg-primary/10 text-primary font-semibold'
                        : 'border-foreground/10 text-muted-foreground hover:border-foreground/25 hover:text-foreground',
                    )}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            {/* 财务大写结果主展示卡 */}
            <div className="glass relative overflow-hidden rounded-2xl p-5 sm:p-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">财务规范大写金额</span>
                  {singleResult.valid && singleResult.wasRounded && (
                    <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                      已四舍五入至分（{singleResult.normalized}）
                    </span>
                  )}
                </div>
                {singleResult.valid && (
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      onClick={() => speakUpper(singleResult.upper)}
                    >
                      <Volume2 className="size-3.5" />
                      朗读
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      onClick={() => void copyText(singleResult.upper, 'upper')}
                    >
                      {copiedKey === 'upper' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      复制大写
                    </Button>
                  </div>
                )}
              </div>

              {singleResult.valid ? (
                <div className="space-y-4">
                  <div className="bg-primary/[0.04] border-primary/20 rounded-2xl border p-4 sm:p-5">
                    <div className="text-foreground text-xl leading-relaxed font-bold tracking-wider break-all sm:text-2xl">
                      {singleResult.upper}
                    </div>
                    <div className="text-muted-foreground mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5 text-xs">
                      <div className="flex flex-wrap items-center gap-3">
                        <span>
                          小写千分位：
                          <strong className="text-foreground font-mono">{singleResult.formattedNumeric}</strong>
                        </span>
                        <button
                          type="button"
                          onClick={() => void copyText(singleResult.formattedNumeric, 'num')}
                          className="text-primary hover:underline"
                        >
                          {copiedKey === 'num' ? '已复制小写' : '复制小写'}
                        </button>
                      </div>
                      {opts.prefix && (
                        <button
                          type="button"
                          onClick={() => void copyText(singleResult.upperPlain, 'plain')}
                          className="text-muted-foreground hover:text-foreground hover:underline"
                        >
                          {copiedKey === 'plain' ? '已复制无前缀版' : '复制无“人民币”前缀版'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 银行支票 / 报销单数位格实时对照表 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground font-medium">
                        支票 / 报销单数位格对照（照抄填单防错位）
                      </span>
                      {singleResult.normalized.split('.')[0].replace('-', '').length > 12 && (
                        <span className="text-amber-600 dark:text-amber-400">超过千亿，常规 14 格支票栏不适用</span>
                      )}
                    </div>
                    <div className="overflow-x-auto rounded-xl border">
                      <table className="w-full min-w-[420px] border-collapse text-center">
                        <thead>
                          <tr className="bg-muted/50 text-muted-foreground border-b text-[11px]">
                            {CHECK_COLUMNS.map((col, idx) => (
                              <th
                                key={idx}
                                className={cn(
                                  'border-r px-1 py-1.5 font-medium last:border-r-0',
                                  (idx === 3 || idx === 7 || idx === 11) && 'border-r-primary/40 font-semibold text-foreground',
                                )}
                              >
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="bg-background font-mono text-base font-bold">
                            {singleResult.checkCells.map((cell, idx) => (
                              <td
                                key={idx}
                                className={cn(
                                  'h-10 border-r px-1 last:border-r-0',
                                  (idx === 3 || idx === 7 || idx === 11) && 'border-r-primary/40',
                                  cell === '¥' ? 'text-primary' : 'text-foreground',
                                )}
                              >
                                {cell}
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-700 dark:text-amber-300">
                  <AlertCircle className="size-4 shrink-0" />
                  <span>{singleResult.error}</span>
                </div>
              )}
            </div>
          </>
        )}

        {mode === 'reverse' && (
          <div className="glass space-y-4 rounded-2xl p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="text-primary size-4" />
                <span className="text-sm font-semibold">大写金额反查数字 & 规范校验</span>
              </div>
              {reverseInput && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive h-7 px-2 text-xs"
                  onClick={() => setReverseInput('')}
                >
                  <Trash2 className="size-3.5" />
                  清空
                </Button>
              )}
            </div>

            <textarea
              rows={3}
              value={reverseInput}
              onChange={(e) => setReverseInput(e.target.value)}
              placeholder="粘贴合同或发票中的中文大写金额，例如：人民币壹拾万零柒仟元伍角叁分"
              className="bg-background focus:border-primary w-full resize-none rounded-2xl border p-4 text-base font-medium outline-none"
            />

            {reverseResult.valid ? (
              <div className="space-y-3">
                <div className="bg-primary/[0.04] border-primary/20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4">
                  <div>
                    <div className="text-muted-foreground text-xs">解析金额（阿拉伯数字）</div>
                    <div className="mt-1 font-mono text-2xl font-bold tracking-tight sm:text-3xl">
                      {reverseResult.formattedNumeric}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void copyText(reverseResult.numeric, 'rev-raw')}
                    >
                      {copiedKey === 'rev-raw' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      复制纯数字
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => void copyText(reverseResult.formattedNumeric, 'rev-fmt')}
                    >
                      {copiedKey === 'rev-fmt' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      复制千分位
                    </Button>
                  </div>
                </div>

                <div
                  className={cn(
                    'flex items-start gap-2.5 rounded-xl border p-3.5 text-xs',
                    reverseResult.isCanonical
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
                  )}
                >
                  {reverseResult.isCanonical ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  )}
                  <div className="space-y-1">
                    <div className="font-semibold">
                      {reverseResult.isCanonical
                        ? '写法符合当前财务大写规范'
                        : '检测到可进一步规范的写法（例如漏写“壹拾”“整”或使用了简体数字）'}
                    </div>
                    {!reverseResult.isCanonical && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span>推荐标准写法：{reverseResult.canonicalUpper}</span>
                        <button
                          type="button"
                          onClick={() => void copyText(reverseResult.canonicalUpper, 'rev-canon')}
                          className="underline"
                        >
                          {copiedKey === 'rev-canon' ? '已复制' : '复制标准写法'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-700 dark:text-amber-300">
                <AlertCircle className="size-4 shrink-0" />
                <span>{reverseResult.error}</span>
              </div>
            )}
          </div>
        )}

        {mode === 'batch' && (
          <div className="space-y-4">
            <div className="glass rounded-2xl p-4">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ListChecks className="text-primary size-4" />
                  <span className="text-sm font-semibold">批量粘贴金额（每行一条，支持直接从 Excel 复制）</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setBatchInput(SAMPLE_BATCH)}
                  >
                    填入示例
                  </Button>
                  {batchInput && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive h-7 px-2 text-xs"
                      onClick={() => setBatchInput('')}
                    >
                      <Trash2 className="size-3.5" />
                      清空
                    </Button>
                  )}
                </div>
              </div>
              <textarea
                rows={5}
                value={batchInput}
                onChange={(e) => setBatchInput(e.target.value)}
                placeholder="每行输入一个金额，自动过滤 ¥、逗号与空格..."
                className="bg-background focus:border-primary w-full resize-y rounded-xl border p-3 font-mono text-xs leading-relaxed outline-none"
              />
            </div>

            {/* 合计汇总栏 */}
            <div className="glass rounded-2xl p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">转换明细与精准合计</span>
                  <span className="bg-primary/10 text-primary rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold">
                    有效 {batchData.validCount} / {batchData.rows.length} 笔
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={!batchData.plainLines}
                    onClick={() => void copyText(batchData.plainLines, 'batch-all')}
                  >
                    {copiedKey === 'batch-all' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    复制全部大写
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={batchData.rows.length === 0}
                    onClick={exportBatchCsv}
                  >
                    <Download className="size-3.5" />
                    导出 CSV
                  </Button>
                </div>
              </div>

              {batchData.validCount > 0 && (
                <div className="bg-primary/[0.05] border-primary/20 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
                  <div>
                    <div className="text-muted-foreground text-[11px]">自动精确合计（分位无误差累加）</div>
                    <div className="mt-0.5 text-sm font-bold">{batchData.totalRes.upper}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-base font-bold">{batchData.totalRes.formattedNumeric}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => void copyText(batchData.totalRes.upper, 'batch-total')}
                    >
                      {copiedKey === 'batch-total' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    </Button>
                  </div>
                </div>
              )}

              {batchData.rows.length === 0 ? (
                <div className="text-muted-foreground py-8 text-center text-xs">暂无金额数据</div>
              ) : (
                <div className="max-h-[340px] overflow-auto rounded-xl border">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/50 text-muted-foreground sticky top-0 border-b text-[11px]">
                      <tr>
                        <th className="w-10 px-3 py-2">#</th>
                        <th className="w-36 px-3 py-2">金额（小写）</th>
                        <th className="px-3 py-2">财务大写</th>
                        <th className="w-12 px-3 py-2 text-right">复制</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {batchData.rows.map((r, idx) => (
                        <tr key={idx} className="hover:bg-foreground/[0.02]">
                          <td className="text-muted-foreground px-3 py-2 font-mono">{idx + 1}</td>
                          <td className="px-3 py-2 font-mono font-medium">
                            {r.res.valid ? r.res.formattedNumeric : <span className="text-red-500">{r.line}</span>}
                          </td>
                          <td className="px-3 py-2">
                            {r.res.valid ? (
                              <span className="font-medium">{r.res.upper}</span>
                            ) : (
                              <span className="text-red-500">{r.res.error}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {r.res.valid && (
                              <button
                                type="button"
                                onClick={() => void copyText(r.res.upper, `b-${idx}`)}
                                className="text-muted-foreground hover:text-primary inline-flex rounded p-1"
                              >
                                {copiedKey === `b-${idx}` ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 底部手写查字速查表 */}
        <div className="glass rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold">常用财务大写汉字速查表（点击单个字可复制）</span>
            <span className="text-muted-foreground text-[11px]">手写报销单 / 支票防写错</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
            {UPPER_CHAR_TABLE.map((item) => (
              <button
                key={item.num}
                type="button"
                onClick={() => void copyText(item.upper.split(' ')[0], `ch-${item.num}`)}
                className="bg-background/70 hover:border-primary/50 hover:bg-primary/[0.04] flex flex-col items-center rounded-xl border py-2 transition"
              >
                <span className="text-muted-foreground font-mono text-[10px]">{item.num}</span>
                <span className="text-foreground mt-0.5 text-base font-bold">{item.upper}</span>
                <span className="text-muted-foreground text-[10px]">{item.pinyin}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </ToolShell>
  )
}
