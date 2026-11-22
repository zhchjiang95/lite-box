import { AnimatePresence, motion } from 'motion/react'
import {
  AlertTriangle,
  Aperture,
  Archive,
  Calendar,
  Camera,
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileSearch,
  Gauge,
  Info,
  Loader2,
  MapPin,
  Search,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/field'
import { downloadBlob, timestampName } from '@/lib/file'
import { decodeImageFile, isHeicLike } from '@/lib/image'
import { cn, formatBytes, uid } from '@/lib/utils'
import { parseImageMetadata, type ParsedImageMeta, type TagGroupId } from './parser'
import { stripBatchToZip, stripImageMetadata, type StripOptions } from './stripper'

interface ExifEntry {
  id: string
  file: File
  url: string
  loading: boolean
  meta: ParsedImageMeta | null
}

const GROUP_TABS: { value: 'all' | TagGroupId; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'exif', label: 'EXIF' },
  { value: 'gps', label: 'GPS' },
  { value: 'file', label: '图像' },
  { value: 'extra', label: 'XMP/ICC' },
]

const FLAG_LABELS = {
  gps: 'GPS 精确位置',
  device: '拍摄设备 / 镜头',
  time: '原始拍摄时间',
  software: '编辑软件 / 作者',
}

export default function ImageExif() {
  const [entries, setEntries] = useState<ExifEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [groupTab, setGroupTab] = useState<'all' | TagGroupId>('all')
  const [keyword, setKeyword] = useState('')
  const [stripOpts, setStripOpts] = useState<StripOptions>({ lossless: true, keepIcc: true })
  const [stripping, setStripping] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const entriesRef = useRef(entries)
  entriesRef.current = entries

  useEffect(
    () => () => {
      entriesRef.current.forEach((e) => URL.revokeObjectURL(e.url))
    },
    [],
  )

  const addFiles = useCallback(async (files: File[]) => {
    const valid = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|heic|heif|tiff?)$/i.test(f.name))
    if (!valid.length) {
      toast.error('请选择有效的图片文件')
      return
    }
    const created: ExifEntry[] = valid.map((file) => ({
      id: uid(),
      file,
      // HEIC 文件在 Chrome/Firefox 无法直接用原始 Blob URL 渲染，解码后再填充可预览图
      url: isHeicLike(file) ? '' : URL.createObjectURL(file),
      loading: true,
      meta: null,
    }))
    setEntries((prev) => [...prev, ...created])
    setSelectedId((prev) => prev ?? created[0].id)

    for (const item of created) {
      const meta = await parseImageMetadata(item.file)
      let previewUrl = item.url
      if (isHeicLike(item.file)) {
        try {
          const decoded = await decodeImageFile(item.file)
          decoded.bitmap.close()
          previewUrl = decoded.previewUrl
          // 若 EXIF 未记录分辨率，补充解码后的真实分辨率
          if (!meta.width) meta.width = decoded.width
          if (!meta.height) meta.height = decoded.height
        } catch {
          // 预览解码失败不影响已解析出的 EXIF 元数据展示
        }
      }
      setEntries((prev) =>
        prev.map((e) => (e.id === item.id ? { ...e, url: previewUrl || e.url, loading: false, meta } : e)),
      )
    }
  }, [])

  const removeEntry = (id: string) => {
    setEntries((prev) => {
      const target = prev.find((e) => e.id === id)
      if (target) URL.revokeObjectURL(target.url)
      const rest = prev.filter((e) => e.id !== id)
      setSelectedId((cur) => (cur === id ? (rest[0]?.id ?? null) : cur))
      return rest
    })
  }

  const clearAll = () => {
    entries.forEach((e) => URL.revokeObjectURL(e.url))
    setEntries([])
    setSelectedId(null)
  }

  const selected = useMemo(
    () => entries.find((e) => e.id === selectedId) ?? entries[0] ?? null,
    [entries, selectedId],
  )

  const filteredTags = useMemo(() => {
    const tags = selected?.meta?.tags ?? []
    const q = keyword.trim().toLowerCase()
    return tags.filter((t) => {
      if (groupTab !== 'all' && t.group !== groupTab) return false
      if (!q) return true
      return (
        t.label.toLowerCase().includes(q) ||
        t.key.toLowerCase().includes(q) ||
        t.value.toLowerCase().includes(q)
      )
    })
  }, [selected, groupTab, keyword])

  const copyValue = async (text: string, key: string, msg?: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      toast.success(msg ?? `已复制 ${text}`)
      setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1400)
    } catch {
      toast.error('复制失败')
    }
  }

  /** 导出当前图片完整元数据 JSON */
  const exportMetaJson = () => {
    if (!selected?.meta) return
    const payload = {
      fileName: selected.file.name,
      fileSize: selected.file.size,
      dimensions: `${selected.meta.width}x${selected.meta.height}`,
      gps: selected.meta.gps,
      camera: selected.meta.camera,
      tags: selected.meta.rawExport,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const base = selected.file.name.replace(/\.[^.]+$/, '') || 'exif'
    downloadBlob(blob, `${base}-exif.json`)
    toast.success('已导出元数据 JSON')
  }

  /** 清除单张图片隐私并下载 */
  const onStripOne = async (entry: ExifEntry) => {
    setStripping(true)
    try {
      const res = await stripImageMetadata(entry.file, stripOpts)
      downloadBlob(res.blob, res.filename)
      const modeText =
        res.method === 'lossless-jpeg' || res.method === 'lossless-png' ? '二进制无损剥离' : 'Canvas 重绘清除'
      toast.success(
        `${modeText}完成${res.removedBytes > 0 ? `，剔除 ${formatBytes(res.removedBytes)} 元数据` : ''}`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '隐私清除失败')
    } finally {
      setStripping(false)
    }
  }

  /** 批量抹除隐私并打包 ZIP */
  const onStripAll = async () => {
    if (!entries.length) return
    if (entries.length === 1) {
      await onStripOne(entries[0])
      return
    }
    setStripping(true)
    setBatchProgress({ done: 0, total: entries.length })
    try {
      const { blob, totalRemoved } = await stripBatchToZip(
        entries.map((e) => e.file),
        stripOpts,
        (done, total) => setBatchProgress({ done, total }),
      )
      downloadBlob(blob, timestampName('轻匣-无隐私照片', 'zip'))
      toast.success(
        `已清除 ${entries.length} 张图片隐私${totalRemoved > 0 ? `，共剔除 ${formatBytes(totalRemoved)} 元数据` : ''}`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '批量清除失败')
    } finally {
      setStripping(false)
      setBatchProgress(null)
    }
  }

  // 空状态
  if (!entries.length) {
    return (
      <div className="space-y-6">
        <FileDropzone
          accept="image/*,.heic,.heif,.tif,.tiff"
          multiple
          onFiles={addFiles}
          title="拖放原图照片到这里，查看 EXIF 信息或一键清除隐私"
          hint="支持 JPG / PNG / WebP / AVIF / HEIC / TIFF；纯浏览器本地解析，照片绝不上传"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: <Camera />, t: '摄影参数一目了然', d: '自动提取相机机身、镜头、光圈、快门、ISO 与拍摄时间' },
            { icon: <MapPin />, t: 'GPS 定位隐私体检', d: '高亮暴露的精确经纬度与海拔，防止发图泄露住址' },
            { icon: <ShieldCheck />, t: '无损二进制抹除', d: 'JPEG / PNG 直接剔除隐私段，0 画质损失且支持批量 ZIP' },
          ].map((f, i) => (
            <motion.div
              key={f.t}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 + i * 0.06 }}
              className="bg-card flex items-start gap-3 rounded-2xl border p-4 backdrop-blur-xl"
            >
              <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-4">
                {f.icon}
              </span>
              <span>
                <span className="block text-sm font-medium">{f.t}</span>
                <span className="text-muted-foreground text-xs">{f.d}</span>
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    )
  }

  const meta = selected?.meta
  const hasRisk = Boolean(meta && meta.privacyFlags.length > 0)
  const hasGps = Boolean(meta?.gps)
  const hasOrientation = Boolean(meta && meta.orientation > 1)

  const panel = (
    <>
      {/* 隐私体检卡 */}
      {selected && (
        <div
          className={cn(
            'rounded-2xl border p-4',
            selected.loading
              ? 'bg-card-solid/50'
              : hasGps
                ? 'border-red-500/30 bg-red-500/10'
                : hasRisk
                  ? 'border-amber-500/30 bg-amber-500/10'
                  : 'border-emerald-500/30 bg-emerald-500/10',
          )}
        >
          <div className="flex items-start gap-2.5">
            {selected.loading ? (
              <Loader2 className="text-primary mt-0.5 size-5 shrink-0 animate-spin" />
            ) : hasGps ? (
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-red-500" />
            ) : hasRisk ? (
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-500" />
            ) : (
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-500" />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-sm font-semibold">
                {selected.loading
                  ? '正在解析元数据…'
                  : hasGps
                    ? '高风险：包含 GPS 地理位置'
                    : hasRisk
                      ? '检测到拍摄设备 / 时间信息'
                      : '安全：未检测到敏感隐私'}
              </div>
              {!selected.loading && meta && (
                <div className="text-muted-foreground text-xs leading-relaxed">
                  {hasRisk ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {meta.privacyFlags.map((flag) => (
                        <span
                          key={flag}
                          className={cn(
                            'rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                            flag === 'gps'
                              ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                              : 'bg-foreground/[0.08] text-foreground/80',
                          )}
                        >
                          {FLAG_LABELS[flag]}
                        </span>
                      ))}
                    </div>
                  ) : (
                    `共检出 ${meta.tags.length} 项基础图像字段，可直接放心分享。`
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 隐私清除选项 */}
      <div className="space-y-4 border-t pt-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-foreground/80 text-sm font-medium">无损二进制剥离</div>
            <div className="text-muted-foreground text-xs">JPEG / PNG 不重编码，0 画质损失</div>
          </div>
          <Switch
            checked={stripOpts.lossless}
            onChange={(v) => setStripOpts((p) => ({ ...p, lossless: v }))}
            label="无损二进制剥离"
          />
        </div>

        {stripOpts.lossless && (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-foreground/80 text-sm font-medium">保留 ICC 色彩配置</div>
              <div className="text-muted-foreground text-xs">防止广色域（P3）照片导出偏灰</div>
            </div>
            <Switch
              checked={stripOpts.keepIcc}
              onChange={(v) => setStripOpts((p) => ({ ...p, keepIcc: v }))}
              label="保留 ICC 色彩配置"
            />
          </div>
        )}

        {/* EXIF Orientation 方向提示 */}
        {stripOpts.lossless && hasOrientation && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            <div className="font-semibold">提示：此图带有方向标签（Orientation={meta?.orientation}）</div>
            <p className="mt-1 opacity-90">
              直接二进制剥离 EXIF 可能导致竖拍照片显示方向旋转，建议关闭“无损二进制剥离”改用重绘自动校正方向。
            </p>
            <button
              type="button"
              onClick={() => setStripOpts((p) => ({ ...p, lossless: false }))}
              className="mt-1.5 font-semibold underline"
            >
              一键切为重绘并校正方向
            </button>
          </div>
        )}
      </div>

      {/* 基础文件信息 */}
      {selected && (
        <div className="space-y-2 border-t pt-4 text-xs">
          <div className="text-foreground/80 text-sm font-medium">文件概览</div>
          <div className="bg-card-solid/50 divide-y rounded-xl border">
            {[
              { k: '格式', v: meta?.fileType ?? '…' },
              { k: '体积', v: formatBytes(selected.file.size) },
              {
                k: '分辨率',
                v: meta && meta.width ? `${meta.width} × ${meta.height} (${((meta.width * meta.height) / 1e6).toFixed(1)} MP)` : '…',
              },
              { k: '元数据总数', v: meta ? `${meta.tags.length} 项` : '…' },
            ].map((row) => (
              <div key={row.k} className="flex items-center justify-between px-3 py-2">
                <span className="text-muted-foreground">{row.k}</span>
                <span className="font-mono font-medium">{row.v}</span>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={exportMetaJson} disabled={!meta}>
            <Code2 />
            导出全部元数据（JSON）
          </Button>
        </div>
      )}
    </>
  )

  const actions =
    entries.length === 1 ? (
      <Button
        variant="primary"
        size="lg"
        onClick={() => selected && onStripOne(selected)}
        disabled={stripping || !selected}
      >
        {stripping ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
        {stripping ? '正在清除…' : '清除隐私并导出'}
      </Button>
    ) : (
      <Button variant="primary" size="lg" onClick={onStripAll} disabled={stripping}>
        {stripping ? <Loader2 className="animate-spin" /> : <Archive />}
        {batchProgress
          ? `清除中 ${batchProgress.done}/${batchProgress.total}…`
          : `批量清除并打包 ZIP（${entries.length} 张）`}
      </Button>
    )

  const cameraChips = meta
    ? [
        { icon: <Camera />, label: '相机', value: meta.camera.camera },
        { icon: <FileSearch />, label: '镜头', value: meta.camera.lens },
        { icon: <Aperture />, label: '光圈 / 焦距', value: [meta.camera.aperture, meta.camera.focalLength].filter(Boolean).join(' · ') || undefined },
        { icon: <Timer />, label: '快门', value: meta.camera.shutter },
        { icon: <Gauge />, label: 'ISO', value: meta.camera.iso },
        { icon: <Calendar />, label: '拍摄时间', value: meta.camera.dateTime },
      ].filter((c) => Boolean(c.value))
    : []

  return (
    <ToolShell panel={panel} actions={actions} panelTitle="隐私体检与抹除">
      <div className="space-y-5">
        {/* 图片缩略预览 + 摄影参数速览 */}
        {selected && (
          <div className="glass shadow-soft grid gap-4 rounded-3xl p-4 sm:grid-cols-[200px_minmax(0,1fr)] sm:p-5">
            <div className="checkerboard relative flex h-44 items-center justify-center overflow-hidden rounded-2xl border sm:h-48">
              {selected.url ? (
                <img
                  src={selected.url}
                  alt={selected.file.name}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <div className="text-muted-foreground flex flex-col items-center gap-1.5 text-xs">
                  <Loader2 className="text-primary size-5 animate-spin" />
                  <span>正在解码预览…</span>
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-col justify-between gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-bold">{selected.file.name}</h2>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {formatBytes(selected.file.size)}
                    {meta && meta.width ? ` · ${meta.width} × ${meta.height}` : ''}
                    {meta?.camera.software ? ` · ${meta.camera.software}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {entries.length > 1 && (
                    <Button variant="secondary" size="sm" onClick={() => onStripOne(selected)} disabled={stripping}>
                      <Download />
                      导出此无隐私图
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={clearAll} className="text-muted-foreground hover:text-red-500">
                    <Trash2 />
                    清空
                  </Button>
                </div>
              </div>

              {cameraChips.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                  {cameraChips.map((c) => (
                    <div key={c.label} className="bg-card-solid/60 rounded-xl border px-3 py-2">
                      <div className="text-muted-foreground flex items-center gap-1 text-[11px] [&_svg]:size-3">
                        {c.icon}
                        {c.label}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-xs font-semibold" title={c.value}>
                        {c.value}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-muted-foreground bg-foreground/[0.04] flex items-center gap-2 rounded-xl px-3.5 py-3 text-xs">
                  <Info className="size-4 shrink-0" />
                  此图片不含相机拍摄参数（截图、微信压缩图或网页下载图通常会丢失 EXIF）。
                </div>
              )}
            </div>
          </div>
        )}

        {/* GPS 坐标隐私警示卡片 */}
        <AnimatePresence>
          {meta?.gps && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-wrap items-center gap-4 rounded-2xl border border-red-500/30 bg-red-500/8 px-4 py-3.5 sm:px-5"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-500">
                <MapPin className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-red-600 dark:text-red-400">
                  检测到拍摄 GPS 位置坐标
                </div>
                <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-xs">
                  <span>
                    {meta.gps.lat}, {meta.gps.lng}
                  </span>
                  <span>
                    ({meta.gps.dmsLat}, {meta.gps.dmsLng})
                  </span>
                  {meta.gps.altitude && <span>海拔 {meta.gps.altitude}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyValue(`${meta.gps!.lat}, ${meta.gps!.lng}`, 'gps-coord', 'GPS 经纬度')}
                >
                  <Copy />
                  复制坐标
                </Button>
                <a
                  href={`https://www.openstreetmap.org/?mlat=${meta.gps.lat}&mlon=${meta.gps.lng}#map=16/${meta.gps.lat}/${meta.gps.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-card-solid/70 hover:bg-foreground/[0.06] inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors"
                >
                  <ExternalLink className="size-3.5" />
                  在地图查看
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 完整元数据检索表格 */}
        {meta && (
          <div className="glass shadow-soft overflow-hidden rounded-2xl">
            <div className="flex flex-wrap items-center gap-3 border-b p-3 sm:px-4">
              <div className="w-full sm:w-80">
                <Segmented size="sm" value={groupTab} onChange={setGroupTab} options={GROUP_TABS} />
              </div>
              <div className="relative min-w-[180px] flex-1">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜索字段名或值，如 ISO、Lens、Date…"
                  className="bg-foreground/[0.05] focus:ring-ring/50 h-8 w-full rounded-lg pr-3 pl-8 text-xs outline-none focus:ring-2"
                />
              </div>
            </div>

            {filteredTags.length === 0 ? (
              <div className="text-muted-foreground py-10 text-center text-xs">
                {meta.tags.length === 0 ? '该图片未包含可解析的元数据字段' : '没有匹配的元数据字段'}
              </div>
            ) : (
              <div className="max-h-[420px] divide-y overflow-y-auto">
                {filteredTags.map((tag, idx) => {
                  const rowKey = `${tag.group}-${tag.key}-${idx}`
                  return (
                    <button
                      key={rowKey}
                      type="button"
                      onClick={() => copyValue(tag.value, rowKey)}
                      className="hover:bg-foreground/[0.04] group flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs transition-colors"
                    >
                      <div className="w-40 shrink-0 sm:w-52">
                        <div className="flex items-center gap-1.5 font-medium">
                          <span className="truncate">{tag.label}</span>
                          {tag.sensitive && (
                            <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-semibold text-amber-600 dark:text-amber-400">
                              隐私
                            </span>
                          )}
                        </div>
                        {tag.label !== tag.key && (
                          <div className="text-muted-foreground truncate font-mono text-[10px]">{tag.key}</div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 break-all font-mono text-xs text-foreground/90">{tag.value}</div>
                      {copiedKey === rowKey ? (
                        <Check className="size-3.5 shrink-0 text-emerald-500" />
                      ) : (
                        <Copy className="text-muted-foreground size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* 多图批量队列 + 继续添加 */}
        <div className="space-y-2.5">
          {entries.length > 1 && (
            <div className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-1">
              {entries.map((e) => {
                const active = selected?.id === e.id
                const itemGps = Boolean(e.meta?.gps)
                return (
                  <div
                    key={e.id}
                    onClick={() => setSelectedId(e.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault()
                        setSelectedId(e.id)
                      }
                    }}
                    className={cn(
                      'bg-card relative flex w-48 shrink-0 cursor-pointer items-center gap-2 rounded-xl border p-1.5 pr-7 transition-all',
                      active ? 'border-primary ring-primary/20 ring-2' : 'hover:border-foreground/20',
                    )}
                  >
                    {e.url ? (
                      <img src={e.url} alt="" className="size-10 shrink-0 rounded-lg object-cover" draggable={false} />
                    ) : (
                      <div className="bg-foreground/[0.06] flex size-10 shrink-0 items-center justify-center rounded-lg">
                        <Loader2 className="text-muted-foreground size-4 animate-spin" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{e.file.name}</div>
                      <div className="mt-0.5 flex items-center gap-1 text-[10px]">
                        {e.loading ? (
                          <span className="text-muted-foreground">解析中…</span>
                        ) : itemGps ? (
                          <span className="font-semibold text-red-500">含 GPS 定位</span>
                        ) : (
                          <span className="text-muted-foreground">{e.meta?.tags.length ?? 0} 项元数据</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation()
                        removeEntry(e.id)
                      }}
                      aria-label="移除"
                      className="text-muted-foreground absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-md hover:bg-red-500/15 hover:text-red-500"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          <FileDropzone
            compact
            accept="image/*,.heic,.heif,.tif,.tiff"
            onFiles={addFiles}
            title="继续添加照片（支持批量检视与一键清除隐私）"
          />
        </div>
      </div>
    </ToolShell>
  )
}
