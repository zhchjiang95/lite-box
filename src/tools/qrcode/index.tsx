import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Camera,
  CameraOff,
  Check,
  CheckCircle2,
  Code2,
  Contact,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  Image as ImageIcon,
  Layers,
  Link2,
  Mail,
  MessageSquare,
  QrCode,
  RefreshCw,
  ScanLine,
  Sparkles,
  Trash2,
  Upload,
  Wifi,
} from 'lucide-react'
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { Button } from '@/components/ui/button'
import { ColorPicker, Field, Switch } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { Slider } from '@/components/ui/slider'
import { copyImageToClipboard, downloadBlob, timestampName } from '@/lib/file'
import { IMAGE_ACCEPT } from '@/lib/image'
import { cn } from '@/lib/utils'
import {
  buildQrSvgString,
  createQrMatrix,
  decodeQrFromImageFile,
  decodeQrFromVideoFrame,
  exportBatchQrZip,
  exportQrPngBlob,
  exportQrSvgBlob,
  loadLogoAsset,
  parseBatchLines,
  renderQrToCanvas,
  type QrDecodeResult,
} from './engine'
import {
  BG_PRESETS,
  buildEmailPayload,
  buildSmsPayload,
  buildVCardPayload,
  buildWifiPayload,
  DEFAULT_QR_STYLE,
  DOT_STYLE_OPTIONS,
  EC_LEVEL_OPTIONS,
  evaluateReadability,
  EYE_STYLE_OPTIONS,
  FG_PRESETS,
  parseQrContent,
  QR_STYLE_PRESETS,
  type EmailPayload,
  type ErrorCorrectionLevel,
  type GenerateSubMode,
  type GradientAngle,
  type LogoAsset,
  type PayloadType,
  type QrMode,
  type QrStyleConfig,
  type SmsPayload,
  type VCardPayload,
  type WifiPayload,
} from './types'

const SAMPLE_TEXT = 'https://github.com/zhchjiang95/lite-box'
const SAMPLE_BATCH = [
  '轻匣主页 | https://github.com/zhchjiang95/lite-box',
  '访客WiFi | WIFI:T:WPA;S:LiteBox-Guest;P:20268888;;',
  '会议签到 | https://example.com/checkin?room=A301',
  '售后反馈 | mailto:i@fiume.cn?subject=LiteBox反馈',
].join('\n')

const PAYLOAD_TABS: { id: PayloadType; label: string; icon: typeof Link2 }[] = [
  { id: 'text', label: '网址 / 文本', icon: Link2 },
  { id: 'wifi', label: 'Wi-Fi 连网', icon: Wifi },
  { id: 'vcard', label: '电子名片', icon: Contact },
  { id: 'email', label: '电子邮件', icon: Mail },
  { id: 'sms', label: '短信 / 电话', icon: MessageSquare },
]

const EXPORT_SIZES = [
  { value: '512', label: '512px' },
  { value: '1024', label: '1024px' },
  { value: '2048', label: '2048px' },
]

const GRADIENT_ANGLES: { value: string; label: string }[] = [
  { value: '135', label: '↘ 135°' },
  { value: '45', label: '↗ 45°' },
  { value: '0', label: '→ 水平' },
  { value: '90', label: '↓ 垂直' },
]

interface DecodeHistoryItem {
  id: string
  text: string
  engine: 'BarcodeDetector' | 'jsQR'
  time: string
  sourceName: string
}

const inputCls =
  'border-border/70 bg-background/60 focus:border-primary focus:ring-primary/20 w-full rounded-xl border px-3 py-2 text-sm transition outline-none focus:ring-2'

export default function QrCodeTool() {
  const [mode, setMode] = useState<QrMode>('generate')
  const [subMode, setSubMode] = useState<GenerateSubMode>('single')

  // ===== 内容状态 =====
  const [payloadType, setPayloadType] = useState<PayloadType>('text')
  const [rawText, setRawText] = useState(SAMPLE_TEXT)
  const [wifi, setWifi] = useState<WifiPayload>({ ssid: '', password: '', encryption: 'WPA', hidden: false })
  const [vcard, setVcard] = useState<VCardPayload>({
    name: '',
    phone: '',
    email: '',
    org: '',
    title: '',
    url: '',
    note: '',
  })
  const [email, setEmail] = useState<EmailPayload>({ to: '', subject: '', body: '' })
  const [sms, setSms] = useState<SmsPayload>({ phone: '', message: '' })

  // 批量模式状态
  const [batchInput, setBatchInput] = useState(SAMPLE_BATCH)
  const [batchFormat, setBatchFormat] = useState<'png' | 'svg'>('png')
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)

  // ===== 样式与 Logo 状态 =====
  const [style, setStyle] = useState<QrStyleConfig>(DEFAULT_QR_STYLE)
  const [logo, setLogo] = useState<LogoAsset | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  // ===== 解码模式状态 =====
  const [decodeResult, setDecodeResult] = useState<QrDecodeResult | null>(null)
  const [decodeSourceName, setDecodeSourceName] = useState<string>('')
  const [decoding, setDecoding] = useState(false)
  const [decodeError, setDecodeError] = useState<string | null>(null)
  const [history, setHistory] = useState<DecodeHistoryItem[]>([])

  // 摄像头扫码状态
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const cameraOverlayRef = useRef<HTMLCanvasElement>(null)
  const cameraScratchRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)

  const patchStyle = useCallback((patch: Partial<QrStyleConfig>) => {
    setStyle((prev) => ({ ...prev, ...patch }))
  }, [])

  // 计算当前单码内容串
  const activePayload = useMemo(() => {
    switch (payloadType) {
      case 'wifi':
        return buildWifiPayload(wifi)
      case 'vcard':
        return buildVCardPayload(vcard)
      case 'email':
        return buildEmailPayload(email)
      case 'sms':
        return buildSmsPayload(sms)
      case 'text':
      default:
        return rawText.trim()
    }
  }, [payloadType, rawText, wifi, vcard, email, sms])

  const batchItems = useMemo(() => parseBatchLines(batchInput), [batchInput])

  // 当前用于预览展示的内容（批量模式取第一条作为实时样式样板）
  const previewContent = useMemo(() => {
    if (subMode === 'batch') {
      return batchItems[0]?.content || SAMPLE_TEXT
    }
    return activePayload
  }, [subMode, batchItems, activePayload])

  // 同步生成二维码矩阵（超长文本捕获异常给清晰提示）
  const matrixState = useMemo(() => {
    if (!previewContent) return { matrix: null, error: null }
    try {
      const matrix = createQrMatrix(previewContent, style.ecLevel)
      return { matrix, error: null }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '内容超出二维码最大容量'
      return {
        matrix: null,
        error: msg.includes('too big') ? '内容超出当前容错等级的最大容量，请精简文本或降低容错等级（如切到 L/M）' : msg,
      }
    }
  }, [previewContent, style.ecLevel])

  // 实时绘制预览 Canvas
  useEffect(() => {
    const canvas = previewCanvasRef.current
    if (!canvas || !matrixState.matrix) return
    renderQrToCanvas(canvas, matrixState.matrix, style, logo, 720)
  }, [matrixState.matrix, style, logo])

  // 扫码可读性评估
  const readability = useMemo(() => evaluateReadability(style, Boolean(logo)), [style, logo])

  // 上传中心 Logo
  const handleLogoFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const asset = await loadLogoAsset(file)
      setLogo(asset)
      // 嵌入 Logo 时自动确保容错率达到 H，保障 100% 易扫
      setStyle((prev) => {
        if (prev.ecLevel === 'L' || prev.ecLevel === 'M') {
          toast.success('已嵌入 Logo，并自动将容错等级提升至 H（30%）以保证扫码成功率')
          return { ...prev, ecLevel: 'H' }
        }
        toast.success('Logo 已嵌入中心区域')
        return prev
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Logo 加载失败')
    }
  }

  // 导出单张 PNG
  const handleDownloadPng = async () => {
    if (!matrixState.matrix) {
      toast.error('请先输入二维码内容')
      return
    }
    setBusyAction('png')
    try {
      const blob = await exportQrPngBlob(matrixState.matrix, style, logo)
      downloadBlob(blob, timestampName('qrcode', 'png'))
      toast.success(`已导出 ${style.exportSize}px 高清 PNG`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出 PNG 失败')
    } finally {
      setBusyAction(null)
    }
  }

  // 导出单张 SVG
  const handleDownloadSvg = () => {
    if (!matrixState.matrix) {
      toast.error('请先输入二维码内容')
      return
    }
    const blob = exportQrSvgBlob(matrixState.matrix, style, logo)
    downloadBlob(blob, timestampName('qrcode', 'svg'))
    toast.success('已导出无损矢量 SVG')
  }

  // 复制 PNG 到剪贴板
  const handleCopyPng = async () => {
    if (!matrixState.matrix) {
      toast.error('请先输入二维码内容')
      return
    }
    setBusyAction('copy')
    try {
      const blob = await exportQrPngBlob(matrixState.matrix, style, logo)
      await copyImageToClipboard(blob)
      toast.success('已复制二维码图片到剪贴板')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制失败，请尝试下载 PNG')
    } finally {
      setBusyAction(null)
    }
  }

  // 复制 SVG 代码
  const handleCopySvgCode = async () => {
    if (!matrixState.matrix) return
    try {
      const svg = buildQrSvgString(matrixState.matrix, style, logo, style.exportSize)
      await navigator.clipboard.writeText(svg)
      toast.success('已复制矢量 SVG 代码')
    } catch {
      toast.error('复制 SVG 代码失败')
    }
  }

  // 批量打包下载 ZIP
  const handleBatchExport = async () => {
    if (!batchItems.length) {
      toast.error('请至少输入一行内容')
      return
    }
    setBusyAction('batch')
    setBatchProgress({ done: 0, total: batchItems.length })
    try {
      const zipBlob = await exportBatchQrZip(batchItems, style, logo, batchFormat, (done, total) => {
        setBatchProgress({ done, total })
      })
      downloadBlob(zipBlob, timestampName(`qrcodes-${batchItems.length}`, 'zip'))
      toast.success(`已打包导出 ${batchItems.length} 张 ${batchFormat.toUpperCase()} 二维码`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '批量导出失败，请检查是否存在超长内容')
    } finally {
      setBusyAction(null)
      setBatchProgress(null)
    }
  }

  // ===== 离线解码逻辑 =====
  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setCameraActive(false)
  }, [])

  // 切换模式或卸载时确保释放摄像头与预览 URL
  useEffect(() => {
    if (mode !== 'decode') stopCamera()
  }, [mode, stopCamera])

  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [stopCamera])

  const prevPreviewUrlRef = useRef<string | null>(null)
  useEffect(() => {
    const oldUrl = prevPreviewUrlRef.current
    if (oldUrl && oldUrl !== decodeResult?.previewUrl) {
      URL.revokeObjectURL(oldUrl)
    }
    prevPreviewUrlRef.current = decodeResult?.previewUrl ?? null
  }, [decodeResult])

  useEffect(() => {
    return () => {
      if (prevPreviewUrlRef.current) {
        URL.revokeObjectURL(prevPreviewUrlRef.current)
      }
    }
  }, [])

  const pushHistory = useCallback((text: string, engine: 'BarcodeDetector' | 'jsQR', sourceName: string) => {
    const now = new Date()
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    setHistory((prev) => {
      const next = [{ id: `${Date.now()}-${Math.random()}`, text, engine, time, sourceName }, ...prev.filter((i) => i.text !== text)]
      return next.slice(0, 12)
    })
  }, [])

  const handleDecodeFiles = useCallback(
    async (files: File[]) => {
      const file = files[0]
      if (!file) return
      stopCamera()
      setDecoding(true)
      setDecodeError(null)
      setDecodeSourceName(file.name || '剪贴板图片')
      try {
        const res = await decodeQrFromImageFile(file)
        setDecodeResult(res)
        pushHistory(res.text, res.engine, file.name || '剪贴板图片')
        toast.success('二维码识别成功')
      } catch (err) {
        setDecodeResult(null)
        const msg = err instanceof Error ? err.message : '识别失败'
        setDecodeError(msg)
        toast.error(msg)
      } finally {
        setDecoding(false)
      }
    },
    [pushHistory, stopCamera],
  )

  const startCamera = async () => {
    setCameraError(null)
    setDecodeError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('当前浏览器不支持摄像头访问（需在 HTTPS 或 localhost 环境下打开）')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      setCameraActive(true)

      // 等待 video 元素挂载并播放
      requestAnimationFrame(async () => {
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        if (!cameraScratchRef.current) {
          cameraScratchRef.current = document.createElement('canvas')
        }

        const scanTick = () => {
          if (!streamRef.current || !videoRef.current) return
          const v = videoRef.current
          if (v.readyState >= 2 && cameraScratchRef.current) {
            const hit = decodeQrFromVideoFrame(v, cameraScratchRef.current)
            const overlay = cameraOverlayRef.current
            if (overlay) {
              overlay.width = v.videoWidth || 640
              overlay.height = v.videoHeight || 480
              const octx = overlay.getContext('2d')!
              octx.clearRect(0, 0, overlay.width, overlay.height)
              if (hit) {
                const scaleX = overlay.width / hit.width
                const scaleY = overlay.height / hit.height
                octx.strokeStyle = '#10b981'
                octx.lineWidth = Math.max(4, overlay.width * 0.007)
                octx.fillStyle = 'rgba(16, 185, 129, 0.18)'
                octx.beginPath()
                hit.location.forEach((p, idx) => {
                  if (idx === 0) octx.moveTo(p.x * scaleX, p.y * scaleY)
                  else octx.lineTo(p.x * scaleX, p.y * scaleY)
                })
                octx.closePath()
                octx.fill()
                octx.stroke()

                // 抓拍当前帧为结果预览图，停止摄像头并展示结果
                const snapCanvas = document.createElement('canvas')
                snapCanvas.width = v.videoWidth
                snapCanvas.height = v.videoHeight
                snapCanvas.getContext('2d')!.drawImage(v, 0, 0)
                snapCanvas.toBlob((blob) => {
                  if (blob) {
                    const previewUrl = URL.createObjectURL(blob)
                    setDecodeResult({
                      text: hit.text,
                      location: [
                        { x: hit.location[0].x * scaleX, y: hit.location[0].y * scaleY },
                        { x: hit.location[1].x * scaleX, y: hit.location[1].y * scaleY },
                        { x: hit.location[2].x * scaleX, y: hit.location[2].y * scaleY },
                        { x: hit.location[3].x * scaleX, y: hit.location[3].y * scaleY },
                      ],
                      width: v.videoWidth,
                      height: v.videoHeight,
                      previewUrl,
                      engine: 'jsQR',
                    })
                    setDecodeSourceName('摄像头扫码')
                    pushHistory(hit.text, 'jsQR', '摄像头扫码')
                    toast.success('摄像头扫码成功')
                  }
                  snapCanvas.width = 0
                  snapCanvas.height = 0
                }, 'image/jpeg', 0.9)

                stopCamera()
                return
              }
            }
          }
          rafRef.current = requestAnimationFrame(scanTick)
        }
        rafRef.current = requestAnimationFrame(scanTick)
      })
    } catch (err) {
      stopCamera()
      const msg = err instanceof Error ? err.message : '无法开启摄像头'
      setCameraError(`无法开启摄像头：${msg}（请检查浏览器相机权限）`)
    }
  }

  const copyText = async (text: string, label = '内容') => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`已复制${label}`)
    } catch {
      toast.error('复制失败，请手动选中复制')
    }
  }

  const sendToGenerator = (text: string) => {
    setPayloadType('text')
    setRawText(text)
    setSubMode('single')
    setMode('generate')
    toast.success('已回填到生成模式，可立即自定义美化')
  }

  const parsedDecode = useMemo(() => (decodeResult ? parseQrContent(decodeResult.text) : null), [decodeResult])

  // ===== 左侧参数面板（生成模式） =====
  const generatePanel = (
    <>
      {/* 1. 一键风格预设 */}
      <Field label="风格预设">
        <div className="grid grid-cols-2 gap-2">
          {QR_STYLE_PRESETS.map((preset) => {
            const active =
              style.dotStyle === preset.patch.dotStyle &&
              style.fgColor === preset.patch.fgColor &&
              style.bgColor === preset.patch.bgColor &&
              Boolean(style.useGradient) === Boolean(preset.patch.useGradient)
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => patchStyle(preset.patch)}
                className={cn(
                  'border-border/70 hover:border-primary/50 flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-xs font-medium transition',
                  active && 'border-primary bg-primary/8 text-primary ring-primary/20 ring-1',
                )}
              >
                <span
                  className="size-5 shrink-0 rounded-md border border-black/10 shadow-xs"
                  style={{
                    background: `linear-gradient(135deg, ${preset.previewColors[0]}, ${preset.previewColors[1]})`,
                  }}
                />
                <span className="truncate">{preset.name}</span>
              </button>
            )
          })}
        </div>
      </Field>

      {/* 2. 码点与码眼形状 */}
      <Field label="码点样式">
        <div className="grid grid-cols-3 gap-1.5">
          {DOT_STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => patchStyle({ dotStyle: opt.value })}
              className={cn(
                'border-border/70 hover:border-primary/50 rounded-lg border px-2 py-1.5 text-xs font-medium transition',
                style.dotStyle === opt.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="码眼（定位角）形状">
        <Segmented
          size="sm"
          value={style.eyeStyle}
          onChange={(v) => patchStyle({ eyeStyle: v })}
          options={EYE_STYLE_OPTIONS}
        />
      </Field>

      {/* 3. 前景色与渐变 */}
      <Field label="前景色" value={style.fgColor.toUpperCase()}>
        <ColorPicker value={style.fgColor} onChange={(v) => patchStyle({ fgColor: v })} presets={FG_PRESETS} />
      </Field>

      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-foreground/80 font-medium">前景线性渐变</span>
          <Switch checked={style.useGradient} onChange={(v) => patchStyle({ useGradient: v })} label="开启前景渐变" />
        </div>
        {style.useGradient && (
          <div className="border-border/60 bg-foreground/[0.02] space-y-3 rounded-xl border p-3">
            <Field label="渐变终点色" value={style.fgColorEnd.toUpperCase()}>
              <ColorPicker
                value={style.fgColorEnd}
                onChange={(v) => patchStyle({ fgColorEnd: v })}
                presets={FG_PRESETS}
              />
            </Field>
            <Field label="渐变方向">
              <Segmented
                size="sm"
                value={String(style.gradientAngle)}
                onChange={(v) => patchStyle({ gradientAngle: Number(v) as GradientAngle })}
                options={GRADIENT_ANGLES}
              />
            </Field>
          </div>
        )}
      </div>

      {/* 独立码眼色 */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-foreground/80 font-medium">独立码眼颜色</span>
          <Switch
            checked={style.customEyeColor}
            onChange={(v) => patchStyle({ customEyeColor: v })}
            label="独立码眼颜色"
          />
        </div>
        {style.customEyeColor && (
          <ColorPicker value={style.eyeColor} onChange={(v) => patchStyle({ eyeColor: v })} presets={FG_PRESETS} />
        )}
      </div>

      {/* 背景色 */}
      <Field label="背景色" value={style.bgColor === 'transparent' ? '透明' : style.bgColor.toUpperCase()}>
        <ColorPicker value={style.bgColor} onChange={(v) => patchStyle({ bgColor: v })} presets={BG_PRESETS} />
      </Field>

      {/* 4. 中心 Logo */}
      <Field label="中心 Logo">
        <input
          ref={logoInputRef}
          type="file"
          hidden
          accept={IMAGE_ACCEPT}
          onChange={(e) => {
            handleLogoFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        {!logo ? (
          <button
            type="button"
            onClick={() => logoInputRef.current?.click()}
            className="border-border/80 text-muted-foreground hover:border-primary/50 hover:text-primary flex w-full items-center justify-center gap-2 rounded-xl border border-dashed py-3 text-xs font-medium transition"
          >
            <Upload className="size-4" />
            上传中心 Logo（PNG / SVG / JPG）
          </button>
        ) : (
          <div className="border-border/70 bg-foreground/[0.02] space-y-3 rounded-xl border p-3">
            <div className="flex items-center gap-2.5">
              <img
                src={logo.dataUrl}
                alt="Logo 预览"
                className="checkerboard size-10 shrink-0 rounded-lg border object-contain p-0.5"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{logo.name}</div>
                <div className="text-muted-foreground text-[11px]">自动镂空安全区防遮挡</div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => logoInputRef.current?.click()} title="更换 Logo">
                <RefreshCw className="size-3.5" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => setLogo(null)} title="移除 Logo">
                <Trash2 className="size-3.5 text-rose-500" />
              </Button>
            </div>

            <Field label="Logo 占比" value={`${Math.round(style.logoScale * 100)}%`}>
              <Slider
                value={Math.round(style.logoScale * 100)}
                min={14}
                max={26}
                step={1}
                onChange={(v) => patchStyle({ logoScale: v / 100 })}
              />
            </Field>

            <Field label="Logo 外观">
              <Segmented
                size="sm"
                value={style.logoShape}
                onChange={(v) => patchStyle({ logoShape: v })}
                options={[
                  { value: 'rounded', label: '圆角矩形' },
                  { value: 'circle', label: '圆形徽标' },
                ]}
              />
            </Field>
          </div>
        )}
      </Field>

      {/* 5. 底部标注文字 */}
      <Field label="底部文字标注（可选）">
        <input
          type="text"
          value={style.caption}
          maxLength={32}
          placeholder="如：微信扫一扫 / 访客 Wi-Fi"
          onChange={(e) => patchStyle({ caption: e.target.value })}
          className={inputCls}
        />
      </Field>

      {/* 6. 专业技术参数 */}
      <Field label="容错等级" value={EC_LEVEL_OPTIONS.find((o) => o.value === style.ecLevel)?.desc}>
        <Segmented
          size="sm"
          value={style.ecLevel}
          onChange={(v) => patchStyle({ ecLevel: v as ErrorCorrectionLevel })}
          options={EC_LEVEL_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
      </Field>

      <Field label="四周留白（静区）" value={`${style.margin} 格`}>
        <Slider value={style.margin} min={0} max={6} step={1} onChange={(v) => patchStyle({ margin: v })} />
      </Field>

      <Field label="导出分辨率">
        <Segmented
          size="sm"
          value={String(style.exportSize)}
          onChange={(v) => patchStyle({ exportSize: Number(v) })}
          options={EXPORT_SIZES}
        />
      </Field>
    </>
  )

  const generateActions =
    subMode === 'single' ? (
      <>
        <Button
          variant="primary"
          size="lg"
          disabled={!matrixState.matrix || busyAction !== null}
          onClick={handleDownloadPng}
        >
          <Download />
          {busyAction === 'png' ? '导出中…' : '导出 PNG'}
        </Button>
        <Button variant="outline" size="lg" disabled={!matrixState.matrix} onClick={handleDownloadSvg}>
          <Code2 />
          SVG
        </Button>
      </>
    ) : (
      <Button
        variant="primary"
        size="lg"
        disabled={!batchItems.length || busyAction !== null}
        onClick={handleBatchExport}
      >
        <FileArchive />
        {batchProgress
          ? `打包中 (${batchProgress.done}/${batchProgress.total})`
          : `导出 ${batchItems.length} 张 ZIP`}
      </Button>
    )

  return (
    <div className="space-y-5">
      {/* 顶部模式切换条 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={mode}
          onChange={setMode}
          className="max-w-md"
          options={[
            { value: 'generate', label: '生成美化二维码', icon: <QrCode /> },
            { value: 'decode', label: '离线识别解码', icon: <ScanLine /> },
          ]}
        />

        {mode === 'generate' && (
          <Segmented
            size="sm"
            value={subMode}
            onChange={setSubMode}
            className="w-auto min-w-[200px]"
            options={[
              { value: 'single', label: '单码精调', icon: <Sparkles className="!size-3.5" /> },
              { value: 'batch', label: '批量生成 ZIP', icon: <Layers className="!size-3.5" /> },
            ]}
          />
        )}
      </div>

      {/* ================= 生成模式 ================= */}
      {mode === 'generate' ? (
        <ToolShell panel={generatePanel} actions={generateActions} panelTitle="外观与导出参数">
          <div className="space-y-5">
            {/* 内容输入卡 */}
            <section className="glass shadow-soft rounded-2xl p-4 sm:p-5">
              {subMode === 'single' ? (
                <div className="space-y-4">
                  {/* 内容模板切换 */}
                  <div className="flex flex-wrap gap-1.5">
                    {PAYLOAD_TABS.map((tab) => {
                      const Icon = tab.icon
                      const active = payloadType === tab.id
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setPayloadType(tab.id)}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition',
                            active
                              ? 'bg-primary text-primary-foreground shadow-sm'
                              : 'bg-foreground/[0.05] text-muted-foreground hover:text-foreground',
                          )}
                        >
                          <Icon className="size-3.5" />
                          {tab.label}
                        </button>
                      )
                    })}
                  </div>

                  {/* 模板对应表单 */}
                  {payloadType === 'text' && (
                    <div className="space-y-2">
                      <textarea
                        rows={3}
                        value={rawText}
                        onChange={(e) => setRawText(e.target.value)}
                        placeholder="输入任意网址、文本、微信号或 JSON 字符串，右侧将实时生成二维码…"
                        className={cn(inputCls, 'resize-y leading-relaxed')}
                      />
                      <div className="text-muted-foreground flex items-center justify-between text-xs">
                        <span>支持中文、Emoji、网址及多行文本（UTF-8 编码）</span>
                        <span className="font-mono tabular-nums">{new Blob([rawText]).size} 字节</span>
                      </div>
                    </div>
                  )}

                  {payloadType === 'wifi' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-muted-foreground text-xs font-medium">Wi-Fi 名称（SSID）*</label>
                        <input
                          type="text"
                          value={wifi.ssid}
                          onChange={(e) => setWifi((p) => ({ ...p, ssid: e.target.value }))}
                          placeholder="例如：Office-5G"
                          className={inputCls}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-muted-foreground text-xs font-medium">加密方式</label>
                        <Segmented
                          size="sm"
                          value={wifi.encryption}
                          onChange={(v) => setWifi((p) => ({ ...p, encryption: v }))}
                          options={[
                            { value: 'WPA', label: 'WPA/WPA2' },
                            { value: 'WEP', label: 'WEP' },
                            { value: 'nopass', label: '无密码' },
                          ]}
                        />
                      </div>
                      {wifi.encryption !== 'nopass' && (
                        <div className="space-y-1.5">
                          <label className="text-muted-foreground text-xs font-medium">连接密码</label>
                          <input
                            type="text"
                            value={wifi.password}
                            onChange={(e) => setWifi((p) => ({ ...p, password: e.target.value }))}
                            placeholder="输入 Wi-Fi 密码"
                            className={inputCls}
                          />
                        </div>
                      )}
                      <div className="flex items-center justify-between rounded-xl border px-3 py-2 sm:self-end">
                        <span className="text-xs font-medium">隐藏网络（不广播 SSID）</span>
                        <Switch
                          checked={wifi.hidden}
                          onChange={(v) => setWifi((p) => ({ ...p, hidden: v }))}
                          label="隐藏网络"
                        />
                      </div>
                    </div>
                  )}

                  {payloadType === 'vcard' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        type="text"
                        placeholder="姓名 *"
                        value={vcard.name}
                        onChange={(e) => setVcard((p) => ({ ...p, name: e.target.value }))}
                        className={inputCls}
                      />
                      <input
                        type="tel"
                        placeholder="手机号码"
                        value={vcard.phone}
                        onChange={(e) => setVcard((p) => ({ ...p, phone: e.target.value }))}
                        className={inputCls}
                      />
                      <input
                        type="email"
                        placeholder="电子邮箱"
                        value={vcard.email}
                        onChange={(e) => setVcard((p) => ({ ...p, email: e.target.value }))}
                        className={inputCls}
                      />
                      <input
                        type="text"
                        placeholder="公司 / 组织"
                        value={vcard.org}
                        onChange={(e) => setVcard((p) => ({ ...p, org: e.target.value }))}
                        className={inputCls}
                      />
                      <input
                        type="text"
                        placeholder="职位头衔"
                        value={vcard.title}
                        onChange={(e) => setVcard((p) => ({ ...p, title: e.target.value }))}
                        className={inputCls}
                      />
                      <input
                        type="url"
                        placeholder="个人主页（https://...）"
                        value={vcard.url}
                        onChange={(e) => setVcard((p) => ({ ...p, url: e.target.value }))}
                        className={inputCls}
                      />
                      <input
                        type="text"
                        placeholder="备注说明（可选）"
                        value={vcard.note}
                        onChange={(e) => setVcard((p) => ({ ...p, note: e.target.value }))}
                        className={cn(inputCls, 'sm:col-span-2')}
                      />
                    </div>
                  )}

                  {payloadType === 'email' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        type="email"
                        placeholder="收件人邮箱 *"
                        value={email.to}
                        onChange={(e) => setEmail((p) => ({ ...p, to: e.target.value }))}
                        className={inputCls}
                      />
                      <input
                        type="text"
                        placeholder="邮件主题"
                        value={email.subject}
                        onChange={(e) => setEmail((p) => ({ ...p, subject: e.target.value }))}
                        className={inputCls}
                      />
                      <textarea
                        rows={2}
                        placeholder="预设正文内容（可选）"
                        value={email.body}
                        onChange={(e) => setEmail((p) => ({ ...p, body: e.target.value }))}
                        className={cn(inputCls, 'sm:col-span-2')}
                      />
                    </div>
                  )}

                  {payloadType === 'sms' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        type="tel"
                        placeholder="电话 / 手机号码 *"
                        value={sms.phone}
                        onChange={(e) => setSms((p) => ({ ...p, phone: e.target.value }))}
                        className={inputCls}
                      />
                      <input
                        type="text"
                        placeholder="短信预设正文（留空则为直接拨号）"
                        value={sms.message}
                        onChange={(e) => setSms((p) => ({ ...p, message: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                  )}
                </div>
              ) : (
                /* 批量模式输入 */
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold">批量多行生成（套用左侧外观与 Logo）</div>
                    <div className="flex items-center gap-2">
                      <Segmented
                        size="sm"
                        value={batchFormat}
                        onChange={setBatchFormat}
                        className="w-32"
                        options={[
                          { value: 'png', label: 'PNG' },
                          { value: 'svg', label: 'SVG' },
                        ]}
                      />
                      <Button size="sm" variant="ghost" onClick={() => setBatchInput(SAMPLE_BATCH)}>
                        填入示例
                      </Button>
                    </div>
                  </div>
                  <textarea
                    rows={5}
                    value={batchInput}
                    onChange={(e) => setBatchInput(e.target.value)}
                    placeholder={'每行一条内容，支持使用「文件名 | 二维码内容」自定义文件名\n例如：\n官网首页 | https://example.com'}
                    className={cn(inputCls, 'font-mono text-xs leading-relaxed')}
                  />
                  <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span>支持 `名称 | 内容` 格式自定义压缩包内的文件名，下方预览展示首条样式效果</span>
                    <span className="text-foreground font-medium">共识别 {batchItems.length} 条</span>
                  </div>
                </div>
              )}
            </section>

            {/* 实时预览舞台 */}
            <section className="glass shadow-soft flex flex-col items-center gap-5 rounded-2xl p-6 sm:p-8">
              {/* 顶部信息栏 */}
              <div className="flex w-full flex-wrap items-center justify-between gap-2 text-xs">
                <div className="text-muted-foreground flex items-center gap-2">
                  <span className="bg-foreground/[0.06] text-foreground rounded-md px-2 py-0.5 font-medium">
                    {subMode === 'batch' ? '首条样式预览' : '实时预览'}
                  </span>
                  {matrixState.matrix && (
                    <span className="font-mono tabular-nums">
                      {matrixState.matrix.size} × {matrixState.matrix.size} 模块 · 容错 {style.ecLevel}
                    </span>
                  )}
                </div>
                {subMode === 'single' && matrixState.matrix && (
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="outline" disabled={busyAction !== null} onClick={handleCopyPng}>
                      <Copy className="!size-3.5" />
                      {busyAction === 'copy' ? '复制中…' : '复制图片'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={handleCopySvgCode}>
                      <Code2 className="!size-3.5" />
                      复制 SVG
                    </Button>
                  </div>
                )}
              </div>

              {/* 二维码画布展示框 */}
              {matrixState.error ? (
                <div className="flex max-w-md flex-col items-center gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/5 px-6 py-10 text-center">
                  <AlertTriangle className="size-8 text-rose-500" />
                  <div className="text-sm font-semibold text-rose-600 dark:text-rose-400">无法生成二维码</div>
                  <p className="text-muted-foreground text-xs leading-relaxed">{matrixState.error}</p>
                </div>
              ) : !matrixState.matrix ? (
                <div className="border-border/70 text-muted-foreground flex size-64 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-center text-sm">
                  <QrCode className="size-10 opacity-30" />
                  <span>在上方填写内容即可实时生成</span>
                </div>
              ) : (
                <div
                  className={cn(
                    'relative overflow-hidden rounded-2xl border border-black/10 p-3 shadow-xl transition-all dark:border-white/10',
                    style.bgColor === 'transparent' ? 'checkerboard' : 'bg-white/70 dark:bg-black/20',
                  )}
                >
                  <canvas
                    ref={previewCanvasRef}
                    className="block h-auto w-[260px] max-w-full rounded-xl sm:w-[320px]"
                  />
                </div>
              )}

              {/* 扫码可读性体检条 */}
              {matrixState.matrix && (
                <div className="w-full max-w-lg space-y-2">
                  {readability.warnings.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3.5 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="size-4 shrink-0" />
                      <span>
                        扫码可读性良好
                        {readability.contrast !== null && `（对比度 ${readability.contrast.toFixed(1)}:1）`}
                        ，支持手机相机与微信秒扫
                      </span>
                    </div>
                  ) : (
                    readability.warnings.map((w, i) => (
                      <div
                        key={i}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-3.5 py-2 text-xs text-amber-800 dark:text-amber-300"
                      >
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="size-4 shrink-0" />
                          <span>{w}</span>
                        </div>
                        {w.includes('H（30%）') && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-xs"
                            onClick={() => patchStyle({ ecLevel: 'H' })}
                          >
                            一键切至 H
                          </Button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </section>
          </div>
        </ToolShell>
      ) : (
        /* ================= 离线识别解码模式 ================= */
        <div className="space-y-5">
          {/* 顶部输入区：拖放/粘贴 + 摄像头开关 */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <FileDropzone
              accept={IMAGE_ACCEPT}
              multiple={false}
              onFiles={handleDecodeFiles}
              title="拖放二维码图片到这里，或点击选择"
              hint="支持 PNG / JPG / WebP / SVG / iPhone HEIC，直接 Ctrl / ⌘ + V 粘贴截图秒解"
              className="py-10 sm:py-12"
            />

            {/* 摄像头实时扫码卡片 */}
            <div className="glass shadow-soft flex flex-col items-center justify-center gap-3 rounded-3xl p-6 text-center">
              <div
                className={cn(
                  'flex size-14 items-center justify-center rounded-2xl transition',
                  cameraActive
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-foreground/[0.06] text-foreground/70',
                )}
              >
                {cameraActive ? <CameraOff className="size-7" /> : <Camera className="size-7" />}
              </div>
              <div className="space-y-1">
                <div className="text-sm font-semibold">摄像头实时扫码</div>
                <p className="text-muted-foreground text-xs">完全本地识别，画面不上传服务器</p>
              </div>
              <Button
                variant={cameraActive ? 'outline' : 'primary'}
                className="w-full"
                onClick={cameraActive ? stopCamera : startCamera}
              >
                {cameraActive ? (
                  <>
                    <CameraOff />
                    停止扫描
                  </>
                ) : (
                  <>
                    <Camera />
                    开启摄像头扫码
                  </>
                )}
              </Button>
              {cameraError && <p className="text-xs text-rose-500">{cameraError}</p>}
            </div>
          </div>

          {/* 摄像头实时取景框 */}
          {cameraActive && (
            <section className="glass shadow-soft overflow-hidden rounded-2xl p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="inline-block size-2 animate-pulse rounded-full bg-emerald-500" />
                  请将二维码对准镜头，识别后自动定格结果…
                </div>
                <Button size="sm" variant="ghost" onClick={stopCamera}>
                  关闭镜头
                </Button>
              </div>
              <div className="relative mx-auto max-w-xl overflow-hidden rounded-xl bg-black">
                <video ref={videoRef} playsInline muted className="block max-h-[420px] w-full object-contain" />
                <canvas
                  ref={cameraOverlayRef}
                  className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                />
              </div>
            </section>
          )}

          {/* 解码中 / 错误提示 */}
          {decoding && (
            <div className="glass flex items-center justify-center gap-2.5 rounded-2xl p-8 text-sm">
              <RefreshCw className="text-primary size-4 animate-spin" />
              <span>正在离线解码二维码…</span>
            </div>
          )}

          {decodeError && !decoding && (
            <div className="flex items-center gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/[0.06] px-5 py-4 text-sm text-rose-600 dark:text-rose-400">
              <AlertTriangle className="size-5 shrink-0" />
              <div>
                <div className="font-semibold">识别未命中</div>
                <div className="text-xs opacity-90">{decodeError}</div>
              </div>
            </div>
          )}

          {/* 解码成功详情卡 */}
          {decodeResult && parsedDecode && !decoding && (
            <section className="glass shadow-soft grid gap-6 rounded-2xl p-5 lg:grid-cols-[320px_minmax(0,1fr)]">
              {/* 左：原图 + SVG 精准四点识别框 */}
              <div className="space-y-2.5">
                <div className="text-muted-foreground flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 truncate">
                    <ImageIcon className="size-3.5 shrink-0" />
                    <span className="truncate">{decodeSourceName}</span>
                  </span>
                  <span className="shrink-0 font-mono">
                    {decodeResult.width}×{decodeResult.height}
                  </span>
                </div>
                <div className="checkerboard relative overflow-hidden rounded-xl border border-black/10 dark:border-white/10">
                  <img
                    src={decodeResult.previewUrl}
                    alt="已解码二维码原图"
                    className="block max-h-[340px] w-full object-contain"
                  />
                  {decodeResult.location && (
                    <svg
                      viewBox={`0 0 ${decodeResult.width} ${decodeResult.height}`}
                      className="pointer-events-none absolute inset-0 h-full w-full"
                      preserveAspectRatio="xMidYMid meet"
                    >
                      <polygon
                        points={decodeResult.location.map((p) => `${p.x},${p.y}`).join(' ')}
                        fill="rgba(16, 185, 129, 0.16)"
                        stroke="#10b981"
                        strokeWidth={Math.max(4, Math.max(decodeResult.width, decodeResult.height) * 0.008)}
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
              </div>

              {/* 右：语义解析结果与操作 */}
              <div className="flex min-w-0 flex-col justify-between gap-4">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        <Check className="size-3.5" />
                        解码成功
                      </span>
                      <span className="bg-foreground/[0.06] text-muted-foreground rounded-full px-2.5 py-0.5 font-mono text-[11px]">
                        引擎: {decodeResult.engine}
                      </span>
                    </div>
                    <span className="text-muted-foreground font-mono text-xs">{decodeResult.text.length} 字符</span>
                  </div>

                  {/* 结构化语义卡 */}
                  {parsedDecode.kind === 'wifi' && (
                    <div className="border-primary/25 bg-primary/[0.05] grid gap-2 rounded-xl border p-3.5 text-sm sm:grid-cols-2">
                      <div>
                        <div className="text-muted-foreground text-xs">Wi-Fi 名称（SSID）</div>
                        <div className="font-semibold">{parsedDecode.ssid}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">加密方式</div>
                        <div className="font-medium">
                          {parsedDecode.encryption}
                          {parsedDecode.hidden ? '（隐藏网络）' : ''}
                        </div>
                      </div>
                      {parsedDecode.password && (
                        <div className="flex items-center justify-between gap-2 sm:col-span-2">
                          <div>
                            <div className="text-muted-foreground text-xs">密码</div>
                            <div className="font-mono font-semibold">{parsedDecode.password}</div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => copyText(parsedDecode.password, 'Wi-Fi 密码')}
                          >
                            <Copy className="!size-3.5" />
                            复制密码
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {parsedDecode.kind === 'vcard' && (
                    <div className="border-primary/25 bg-primary/[0.05] grid gap-2 rounded-xl border p-3.5 text-xs sm:grid-cols-2">
                      {parsedDecode.name && (
                        <div>
                          <span className="text-muted-foreground">姓名：</span>
                          <span className="font-semibold">{parsedDecode.name}</span>
                        </div>
                      )}
                      {parsedDecode.phone && (
                        <div>
                          <span className="text-muted-foreground">电话：</span>
                          <span className="font-mono">{parsedDecode.phone}</span>
                        </div>
                      )}
                      {parsedDecode.org && (
                        <div>
                          <span className="text-muted-foreground">公司：</span>
                          <span>{parsedDecode.org}</span>
                        </div>
                      )}
                      {parsedDecode.title && (
                        <div>
                          <span className="text-muted-foreground">职位：</span>
                          <span>{parsedDecode.title}</span>
                        </div>
                      )}
                      {parsedDecode.email && (
                        <div className="sm:col-span-2">
                          <span className="text-muted-foreground">邮箱：</span>
                          <span className="font-mono">{parsedDecode.email}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {parsedDecode.kind === 'url' && (
                    <div className="border-primary/25 bg-primary/[0.05] flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-xs">
                      <span className="truncate font-medium">检测到网页链接</span>
                      <a
                        href={parsedDecode.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary inline-flex items-center gap-1 font-semibold hover:underline"
                      >
                        在新标签页打开
                        <ExternalLink className="size-3.5" />
                      </a>
                    </div>
                  )}

                  {/* 原始文本完整展示 */}
                  <div className="space-y-1.5">
                    <div className="text-muted-foreground text-xs font-medium">原始解码内容</div>
                    <pre className="border-border/70 bg-background/60 max-h-48 overflow-auto rounded-xl border p-3.5 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap select-all">
                      {decodeResult.text}
                    </pre>
                  </div>
                </div>

                {/* 底部快捷动作 */}
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => copyText(decodeResult.text)}>
                    <Copy />
                    复制解码内容
                  </Button>
                  <Button variant="outline" onClick={() => sendToGenerator(decodeResult.text)}>
                    <Sparkles />
                    用此内容重新美化生成
                  </Button>
                </div>
              </div>
            </section>
          )}

          {/* 本次识别历史记录 */}
          {history.length > 0 && (
            <section className="glass shadow-soft space-y-3 rounded-2xl p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">最近识别记录（{history.length}）</div>
                <Button size="sm" variant="ghost" onClick={() => setHistory([])}>
                  清空记录
                </Button>
              </div>
              <div className="divide-border/50 divide-y">
                {history.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-xs">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="truncate font-mono text-sm">{item.text}</div>
                      <div className="text-muted-foreground flex items-center gap-2 text-[11px]">
                        <span>{item.time}</span>
                        <span>·</span>
                        <span>{item.sourceName}</span>
                        <span>·</span>
                        <span>{item.engine}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => copyText(item.text)}>
                        <Copy className="!size-3.5" />
                        复制
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => sendToGenerator(item.text)}>
                        <Sparkles className="!size-3.5" />
                        美化重做
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
