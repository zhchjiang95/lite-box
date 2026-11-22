import ExifReader from 'exifreader'

export type TagGroupId = 'exif' | 'gps' | 'file' | 'extra'

export interface ParsedTag {
  key: string
  /** 中文友好名（若无映射则保留英文键名） */
  label: string
  value: string
  group: TagGroupId
  /** 是否属于高敏隐私字段 */
  sensitive?: boolean
}

export interface GpsInfo {
  lat: number
  lng: number
  altitude?: string
  dmsLat: string
  dmsLng: string
}

export interface CameraSummary {
  camera?: string
  lens?: string
  focalLength?: string
  aperture?: string
  shutter?: string
  iso?: string
  dateTime?: string
  software?: string
  colorSpace?: string
  exposureBias?: string
  whiteBalance?: string
  flash?: string
  metering?: string
}

export interface ParsedImageMeta {
  width: number
  height: number
  fileType: string
  /** EXIF Orientation 原始数值（1 为正常，2-8 表示带有旋转/翻转指令） */
  orientation: number
  gps: GpsInfo | null
  camera: CameraSummary
  /** 隐私风险项列表 */
  privacyFlags: ('gps' | 'device' | 'time' | 'software')[]
  tags: ParsedTag[]
  /** 全部可导出的原始键值 JSON */
  rawExport: Record<string, Record<string, string>>
}

/** 常见 EXIF / GPS / 图像字段中文映射 */
const LABEL_ZH: Record<string, string> = {
  Make: '相机制造商',
  Model: '相机型号',
  LensMake: '镜头厂商',
  LensModel: '镜头型号',
  FocalLength: '焦距',
  FocalLengthIn35mmFilm: '等效 35mm 焦距',
  FNumber: '光圈值',
  ApertureValue: '光圈',
  ExposureTime: '快门速度',
  ShutterSpeedValue: '快门',
  ISOSpeedRatings: 'ISO 感光度',
  PhotographicSensitivity: 'ISO 感光度',
  ExposureBiasValue: '曝光补偿',
  ExposureProgram: '曝光程序',
  ExposureMode: '曝光模式',
  MeteringMode: '测光模式',
  Flash: '闪光灯',
  WhiteBalance: '白平衡',
  ColorSpace: '色彩空间',
  DateTimeOriginal: '原始拍摄时间',
  DateTimeDigitized: '数字化时间',
  DateTime: '文件修改时间',
  OffsetTimeOriginal: '拍摄时区',
  Software: '处理软件 / 系统',
  Artist: '作者',
  Copyright: '版权声明',
  Orientation: '方向旋转标签',
  XResolution: '水平分辨率',
  YResolution: '垂直分辨率',
  ResolutionUnit: '分辨率单位',
  BodySerialNumber: '机身序列号',
  LensSerialNumber: '镜头序列号',
  GPSLatitude: 'GPS 纬度',
  GPSLongitude: 'GPS 经度',
  GPSAltitude: 'GPS 海拔',
  GPSLatitudeRef: '南北纬',
  GPSLongitudeRef: '东西经',
  GPSTimeStamp: 'GPS 时间',
  GPSDateStamp: 'GPS 日期',
  FileType: '文件格式',
  'Image Width': '图像宽度',
  'Image Height': '图像高度',
  'Bits Per Sample': '位深度',
  'Color Components': '色彩通道数',
  Subsampling: '色度抽样',
  'ICC Description': 'ICC 色彩描述',
  'Profile Description': 'ICC 配置文件',
}

const SENSITIVE_KEYS = new Set([
  'Make',
  'Model',
  'LensModel',
  'BodySerialNumber',
  'LensSerialNumber',
  'DateTimeOriginal',
  'DateTimeDigitized',
  'Software',
  'Artist',
  'HostComputer',
  'GPSLatitude',
  'GPSLongitude',
  'GPSAltitude',
  'GPSDateStamp',
  'GPSTimeStamp',
])

/** 十进制经纬度转为度分秒（DMS）可读字符串 */
function formatDms(deg: number, posRef: string, negRef: string): string {
  const ref = deg >= 0 ? posRef : negRef
  const abs = Math.abs(deg)
  const d = Math.floor(abs)
  const minFloat = (abs - d) * 60
  const m = Math.floor(minFloat)
  const s = ((minFloat - m) * 60).toFixed(1)
  return `${d}°${m}'${s}" ${ref}`
}

/** 从 ExifReader 标签对象中安全提取可读文本 */
function readTagText(tag: unknown): string {
  if (!tag || typeof tag !== 'object') return ''
  const t = tag as { description?: unknown; value?: unknown }
  if (typeof t.description === 'string' && t.description.trim()) return t.description.trim()
  if (typeof t.description === 'number') return String(t.description)
  if (typeof t.value === 'string' && t.value.trim()) return t.value.trim()
  if (typeof t.value === 'number') return String(t.value)
  if (Array.isArray(t.value) && t.value.length <= 6) return t.value.join(', ')
  return ''
}

/** 格式化对象字典内的所有标签 */
function collectGroup(
  dict: Record<string, unknown> | undefined,
  group: TagGroupId,
  out: ParsedTag[],
  exportBucket: Record<string, string>,
) {
  if (!dict || typeof dict !== 'object') return
  for (const [key, raw] of Object.entries(dict)) {
    // 跳过庞大的缩略图/二进制原始数组字段
    if (key === 'Thumbnail' || key === 'MakerNote' || key === 'UserComment' || key === 'Images') continue
    const val = readTagText(raw)
    if (!val || val.length > 300) continue
    out.push({
      key,
      label: LABEL_ZH[key] ?? key,
      value: val,
      group,
      sensitive: group === 'gps' || SENSITIVE_KEYS.has(key),
    })
    exportBucket[key] = val
  }
}

/** 读取图片分辨率（无法解码如特殊 TIFF 时回退到 EXIF 宽高） */
async function readDimensions(file: File): Promise<{ width: number; height: number }> {
  try {
    const bmp = await createImageBitmap(file)
    const d = { width: bmp.width, height: bmp.height }
    bmp.close()
    return d
  } catch {
    return { width: 0, height: 0 }
  }
}

/** 解析单张图片完整元数据（EXIF / GPS / XMP / IPTC / ICC / 文件信息） */
export async function parseImageMetadata(file: File): Promise<ParsedImageMeta> {
  const [dims, expanded] = await Promise.all([
    readDimensions(file),
    ExifReader.load(file, { expanded: true }).catch(() => ({}) as Record<string, unknown>),
  ])

  const exp = expanded as Record<string, Record<string, unknown> | undefined>
  const exif = exp.exif
  const gpsRaw = exp.gps as { Latitude?: number; Longitude?: number; Altitude?: number } | undefined
  const fileGroup = exp.file
  const pngGroup = exp.png
  const riffGroup = exp.riff

  const tags: ParsedTag[] = []
  const rawExport: Record<string, Record<string, string>> = {
    exif: {},
    gps: {},
    file: {},
    extra: {},
  }

  collectGroup(exif, 'exif', tags, rawExport.exif)
  // GPS 详细字段来自 exif 中的 GPS* 或 gps 分组
  if (exif) {
    // 把 exif 中以 GPS 开头的归类到 gps 组以便筛选
    for (const tag of tags) {
      if (tag.key.startsWith('GPS')) {
        tag.group = 'gps'
        tag.sensitive = true
        rawExport.gps[tag.key] = tag.value
        delete rawExport.exif[tag.key]
      }
    }
  }
  collectGroup(fileGroup, 'file', tags, rawExport.file)
  collectGroup(pngGroup, 'file', tags, rawExport.file)
  collectGroup(riffGroup, 'file', tags, rawExport.file)
  collectGroup(exp.xmp, 'extra', tags, rawExport.extra)
  collectGroup(exp.iptc, 'extra', tags, rawExport.extra)
  collectGroup(exp.icc, 'extra', tags, rawExport.extra)
  collectGroup(exp.jfif, 'file', tags, rawExport.file)

  // 提取 GPS 坐标
  let gps: GpsInfo | null = null
  if (
    gpsRaw &&
    typeof gpsRaw.Latitude === 'number' &&
    typeof gpsRaw.Longitude === 'number' &&
    Number.isFinite(gpsRaw.Latitude) &&
    Number.isFinite(gpsRaw.Longitude)
  ) {
    gps = {
      lat: Number(gpsRaw.Latitude.toFixed(6)),
      lng: Number(gpsRaw.Longitude.toFixed(6)),
      altitude:
        typeof gpsRaw.Altitude === 'number' && Number.isFinite(gpsRaw.Altitude)
          ? `${gpsRaw.Altitude.toFixed(1)} m`
          : undefined,
      dmsLat: formatDms(gpsRaw.Latitude, 'N', 'S'),
      dmsLng: formatDms(gpsRaw.Longitude, 'E', 'W'),
    }
  }

  // 提取摄影参数速览
  const getExif = (k: string) => readTagText(exif?.[k])
  const make = getExif('Make')
  const model = getExif('Model')
  const cameraName =
    model && make && !model.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${model}` : model || make || undefined

  const fNum = getExif('FNumber')
  const focal = getExif('FocalLength')
  const focal35 = getExif('FocalLengthIn35mmFilm')
  const iso = getExif('ISOSpeedRatings') || getExif('PhotographicSensitivity')
  const shutter = getExif('ExposureTime')

  const camera: CameraSummary = {
    camera: cameraName,
    lens: getExif('LensModel') || undefined,
    focalLength: focal ? (focal35 ? `${focal}（等效 ${focal35}）` : focal) : undefined,
    aperture: fNum ? (fNum.startsWith('f/') ? fNum : `f/${fNum}`) : undefined,
    shutter: shutter ? (shutter.endsWith('s') ? shutter : `${shutter} s`) : undefined,
    iso: iso ? `ISO ${iso}` : undefined,
    dateTime: getExif('DateTimeOriginal') || getExif('DateTime') || undefined,
    software: getExif('Software') || undefined,
    colorSpace: getExif('ColorSpace') || readTagText(exp.icc?.['Profile Description']) || undefined,
    exposureBias: getExif('ExposureBiasValue') || undefined,
    whiteBalance: getExif('WhiteBalance') || undefined,
    flash: getExif('Flash') || undefined,
    metering: getExif('MeteringMode') || undefined,
  }

  // 提取 Orientation 原始值（1 表示正常，>1 表示需要旋转校正）
  const rawOri = (exif?.Orientation as { value?: unknown } | undefined)?.value
  const orientation = typeof rawOri === 'number' ? rawOri : 1

  // 隐私风险体检
  const privacyFlags: ParsedImageMeta['privacyFlags'] = []
  if (gps) privacyFlags.push('gps')
  if (camera.camera || camera.lens || getExif('BodySerialNumber')) privacyFlags.push('device')
  if (camera.dateTime) privacyFlags.push('time')
  if (camera.software || getExif('Artist')) privacyFlags.push('software')

  const width = dims.width || Number(readTagText(fileGroup?.['Image Width']).replace(/\D/g, '')) || 0
  const height = dims.height || Number(readTagText(fileGroup?.['Image Height']).replace(/\D/g, '')) || 0
  const fileType = readTagText(fileGroup?.FileType) || file.type.replace('image/', '').toUpperCase() || 'IMAGE'

  return {
    width,
    height,
    fileType,
    orientation,
    gps,
    camera,
    privacyFlags,
    tags,
    rawExport,
  }
}
