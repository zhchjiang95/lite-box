# 轻匣（LiteBox）· 工具规划清单（TODO）

> 本清单整理所有**可在浏览器本地（纯前端 / Web Worker / WASM）实现**的工具，无需后端上传，保障隐私与响应速度。
>
> **开发约定**：每完成一个工具，在 `src/tools/<tool-id>/` 下创建 `meta.ts` + `index.tsx`，并在 `src/registry/planned.ts` 中移除对应“即将上线”项，再将下方复选框勾上。

---

## 一、图片处理（`image`）

- [x] **图片拼接（`image-stitch`）**：横向、纵向、宫格拼接，支持拖拽排序、间距、外边距、圆角、背景色、统一宽/高、对齐方式与多格式导出
- [x] **图片压缩（`image-compress`）**：批量压缩 JPG / PNG / WebP / AVIF，支持画质滑块、PNG 智能色彩量化、最大边长限制、前后体积与画质对比（Before/After 滑动条 + 4 倍放大镜）、一键打包 ZIP 下载
  - *技术方案*：Web Worker 并发池 + `OffscreenCanvas` + `upng-js`（PNG 调色板量化）+ `fflate`（零级极速 ZIP 打包）
- [x] **图片格式转换（`image-convert`）**：PNG、JPG、WebP、AVIF、BMP、ICO 批量互转，支持 iPhone 15/16 HEIC/HEIF 与 SVG 直转、多尺寸 ICO 封装、尺寸倍率/最大边限制及一键 ZIP 打包
  - *技术方案*：`createImageBitmap` + `OffscreenCanvas` + 全站统一按需懒加载 `heic-to`（新版 `libheif` WASM）+ 纯前端 24-bit BMP / 多尺寸 ICO 二进制编码器 + `fflate`
- [x] **图片裁剪与缩放（`image-crop`）**：自由比例或预设比例（1:1、4:3、16:9、一寸/二寸/护照证件照标准尺寸）交互式裁剪、圆形头像裁切、90°/±45° 旋转翻转、自定义输出像素，以及多图按百分比/固定宽/高/指定尺寸批量缩放与 ZIP 打包
  - *技术方案*：纯前端交互式 `CropCanvas`（8 方向拖拽 + 锁比例约束）+ 单次 Canvas 2D 变换矩阵渲染 + `fflate`
- [x] **图片加水印（`image-watermark`）**：支持多行文字水印与透明图片 Logo 水印，全屏错行斜向平铺（证件防盗水印）或九宫格 + 画布拖拽定位，可调透明度、自适应字号、旋转角度、间距、混合模式，支持多图批量加水印与 ZIP 打包
  - *技术方案*：Canvas 2D 对角线覆盖平铺矩阵与混合模式渲染 + `fflate`
- [x] **图片取色与调色板（`image-palette`）**：11×11 像素级放大镜与原生 EyeDropper 屏幕吸管取色（HEX / RGB / HSL / OKLCH / CMYK + WCAG 对比度），K-Means++ 自动提取主色调与占比、生成衍生配色，支持导出 CSS/JSON 及高清色卡海报 PNG
  - *技术方案*：`EyeDropper API` + `Canvas getImageData` 像素放大镜 + 确定性 K-Means++ 颜色量化
- [x] **九宫格切图（`image-split`）**：将单张图片切分为 3×3 九宫格、2×2 四宫格、横/竖三连或任意 1–8 行×列，支持朋友圈 1:1 正方形拖拽取景 / 自动补边、缝隙补偿、圆角、发图效果模拟与一键打包 ZIP 下载
  - *技术方案*：Canvas 分块裁剪 + `fflate`
- [x] **EXIF 信息查看与抹除（`image-exif`）**：解析相机/镜头/光圈快门/ISO/GPS 位置与完整 EXIF/XMP/IPTC/ICC 元数据，提供隐私体检与 JSON 导出，支持 JPEG/PNG 二进制无损段剥离及批量抹除 ZIP 打包
  - *技术方案*：`exifreader` + 纯前端 JPEG/PNG 二进制段无损剥离器 + Canvas 重绘校正方向 + `fflate`
- [x] **长图切分 / 滚动截图分页（`image-slice`）**：将超长图片按小红书 3:4 等社媒比例、固定高度、等分页数或手动切线切分为多张图，支持拖拽切线、一键智能吸附空白缝隙避开文字、末页同色补边/合并与 ZIP 打包
  - *技术方案*：Canvas 2D 行像素梯度方差扫描（智能避字）+ 交互式水平切线编辑 + `fflate`
- [x] **圆角与阴影美化 / 截图套壳（`screenshot-beautify`）**：为截图添加 macOS 亮/暗窗口栏、浏览器地址栏、磨砂玻璃外框、12 套弥散渐变与颗粒噪点、圆角、三层柔和阴影、内衬留白及 2× 高清导出，支持一键复制与粘贴秒换图
  - *技术方案*：Canvas 2D 多层阴影与图案噪点渲染 + `createImageBitmap`
- [x] **SVG 转 PNG/WebP（`svg-to-image`）**：粘贴/实时编辑 SVG 代码或批量上传 `.svg` 文件，支持自动补全 `xmlns`/`viewBox`、`currentColor` 快捷换色、1×–8× 无锯齿倍率或自定义像素、留白背景、DataURL 复制与批量 ZIP 导出
  - *技术方案*：`DOMParser` 矢量属性注入 + Canvas 2D 高倍光栅化 + `fflate`
- [x] **Favicon 图标生成（`favicon-generator`）**：上传图片（支持 PNG/SVG/JPG/HEIC）或直接输入文字/Emoji，一键生成多尺寸合并 `favicon.ico`（16/32/48）、`apple-touch-icon.png`、PWA 192/512 图标、`site.webmanifest` 及 HTML `<head>` 引入代码，提供亮/暗浏览器标签与手机桌面实时预览
  - *技术方案*：Canvas 2D 多尺寸渲染 + 多帧 PNG-in-ICO 二进制编码器 + `fflate`
- [x] **摄影作品分享框（`photo-frame`）**：自动读取照片 EXIF（相机/镜头/焦距/光圈/快门/ISO/时间），支持上/下/左/右四向画框排版、6 套艺术字体（画廊衬线/手写签名/机械等宽/电影宽字等）、6 种画框主题（徕卡白/暗夜黑/拍立得/弥散毛玻璃/35mm 胶片/无框悬浮）、矢量品牌徽标与照片主色调色点
  - *技术方案*：`exifreader` + 确定性 K-Means++ 色点提取 + Canvas 2D 四向坐标旋转渲染 + 按需异步艺术字体加载

---

## 二、PDF 工具（`pdf`）

- [x] **PDF 合并与拆分（`pdf-merge-split`）**：多份 PDF 拖拽合并、可视化页面拖拽重排、单页旋转/复制/批量删除、高清放大预览、按页码范围（`1-3, 5, 8-10`）或每 N 页拆分并打包 ZIP
  - *技术方案*：`pdf-lib`（无损结构合并拆分）+ `pdfjs-dist`（本地离线 Worker + `IntersectionObserver` 懒渲染缩略图）+ `fflate`
- [x] **图片转 PDF（`image-to-pdf`）**：多张图片（含 JPG/PNG/WebP/SVG/HEIC）一键合成 PDF，支持 A4/A3/A5/Letter/16:9 与自适应原图纸张、自动匹配横竖方向、页边距与背景色、页码、拖拽排页、单页旋转及可选压缩减小体积
  - *技术方案*：`pdf-lib` + 全站统一图片解码器（`src/lib/image.ts`）
- [x] **PDF 转图片（`pdf-to-image`）**：将 PDF 逐页渲染为 1×–3× 超清 PNG / JPG / WebP，支持单页复制/下载、按页码范围勾选打包 ZIP，或一键拼接为纵向长图
  - *技术方案*：`pdfjs-dist`（本地离线 Worker + 懒渲染缩略图）+ Canvas 长图合成 + `fflate`
- [x] **PDF 加水印 / 页码（`pdf-watermark`）**：为 PDF 批量添加中文/英文/Emoji 多行文字或透明 Logo 水印（全屏斜向错行平铺或九宫格定位）及 6 方位中英文页码（支持跳过首页封面），实时翻页预览与批量 ZIP 打包
  - *技术方案*：`pdf-lib`（全文档复用单份 3× 超清透明 PNG 印章无损写入，完美支持中文且原矢量文字不失真）+ `pdfjs-dist` + `fflate`

---

## 三、文本处理（`text`）

- [ ] **字数与文本统计（`word-count`）**：实时统计总字数、中文字数、英文词数、标点、行数、段落数、字节大小及预计阅读时长
- [ ] **文本对比 Diff（`text-diff`）**：左右双栏或行内对比两段文本差異，支持逐行 / 逐词 / 逐字符高亮
  - *技术方案*：`diff`（Myers diff 算法）
- [ ] **文本去重与行处理（`text-lines`）**：按行去重、排序（字典序/长度/自然序/随机打乱）、去空行、首尾加前后缀、合并或分割
- [ ] **英文字母大小写与命名风格转换（`case-convert`）**：`camelCase`、`PascalCase`、`snake_case`、`kebab-case`、`CONSTANT_CASE`、首字母大写等一键互转
- [ ] **Markdown 实时预览与导出（`markdown-preview`）**：支持 GFM 表格、代码高亮、数学公式、导出 HTML 或长图
- [ ] **繁简转换与拼音标注（`chinese-convert`）**：简繁互转、汉字转带声调/不带声调拼音、首字母提取
  - *技术方案*：`pinyin-pro` / `opencc-js`
- [ ] **正则提取与批量替换（`text-extract`）**：从杂乱文本中一键提取所有邮箱、手机号、网址、IP 地址、数字，或使用正则批量替换

---

## 四、编码加密（`encode`）

- [ ] **Base64 编解码（`base64`）**：支持 UTF-8 文本与图片 / 任意文件转 DataURL Base64，支持预览解码后的图片或下载文件
- [ ] **URL 编解码与参数解析（`url-codec`）**：`encodeURI` / `encodeURIComponent` 互转，并将 URL Query 参数解析为可编辑表格，改完实时重拼 URL
- [ ] **哈希计算（`hash`）**：支持文本与大文件分片计算 MD5、SHA-1、SHA-256、SHA-384、SHA-512、CRC32，支持 HMAC
  - *技术方案*：原生 `SubtleCrypto` + `hash-wasm`（高速 WASM，支持大文件流式分块计算）
- [ ] **JWT 解析器（`jwt-decoder`）**：本地解码 JWT 的 Header、Payload，自动格式化时间戳（`exp`/`iat`）并显示过期状态，支持 HMAC 签名校验
- [ ] **Unicode / HTML 实体 / 进制编码（`char-codec`）**：`\uXXXX`、HTML 实体（`&#x...;`）、UTF-8 十六进制字节查看
- [ ] **AES / DES 对称加解密（`crypto-cipher`）**：基于浏览器 Web Crypto API 的文本与文件本地加密/解密

---

## 五、开发工具（`dev`）

- [ ] **JSON 格式化与校验（`json-format`）**：格式化、压缩、语法错误精准定位、Key 排序、转义/去转义、树形折叠视图、JSONPath 查询
- [ ] **JSON 与 TypeScript / YAML / CSV / TOML 互转（`data-convert`）**：JSON 一键生成 TypeScript 类型接口、或与 YAML/CSV 表格互转
- [ ] **时间戳转换（`timestamp`）**：实时 Unix 秒/毫秒时间戳、与本地/UTC/任意时区日期互转、常用相对时间计算
- [ ] **正则表达式测试（`regex-tester`）**：实时匹配高亮、捕获组详情展示、常用正则速查库（邮箱、手机号、身份证、URL、IPv4 等）
- [ ] **颜色空间转换与对比度检查（`color-converter`）**：HEX、RGB、HSL、OKLCH、CMYK 实时互转，搭配 WCAG 文字背景对比度无障碍检测与渐变生成
- [ ] **Cron 表达式生成与解析（`cron-parser`）**：可视化配置 Cron 表达式，语义化中文解释并列出未来 10 次执行时间
- [ ] **代码压缩与美化（`code-format`）**：HTML / CSS / JS / SQL 格式化与压缩
- [ ] **HTTP 状态码 / MIME 类型 / 键码速查（`dev-cheatsheet`）**：支持快速检索的离线速查表与键盘 `KeyboardEvent` 按键检测器

---

## 六、生成器（`generate`）

- [ ] **二维码生成与识别（`qrcode`）**：支持自定义前景/背景色、圆点样式、嵌入中心 Logo 生成高清 PNG/SVG 二维码；支持拖入或粘贴二维码图片离线解码
  - *技术方案*：`qrcode` / `qr-code-styling` + `jsqr`（或原生 `BarcodeDetector`）
- [ ] **条形码生成（`barcode`）**：支持 CODE128、EAN-13、UPC 等常见条形码生成与导出
  - *技术方案*：`jsbarcode`
- [ ] **随机密码与密钥生成器（`password-generator`）**：基于密码学安全随机数 `crypto.getRandomValues`，可定制长度、字符集、排除易混淆字符、批量生成与熵值强度评估
- [ ] **UUID / ULID / NanoID 批量生成（`uuid-generator`）**：支持 UUID v4 / v7、ULID、自定义字母表 NanoID 批量生成与复制
- [ ] **占位图生成（`placeholder-image`）**：自定义尺寸、背景色/渐变、文字内容与字号，一键生成开发测试用占位图（PNG / SVG / DataURL）
- [ ] **Lorem Ipsum 假文生成（`lorem-generator`）**：支持中文段落、英文段落、句子、词语随机生成

---

## 七、音视频（`media`）

- [ ] **视频转 GIF 动图（`video-to-gif`）**：本地载入视频，框选时间段、设置帧率与尺寸，在浏览器中生成高画质调色板 GIF
  - *技术方案*：`<video>` + Canvas 抽帧 + `gifenc`（轻量极速纯 JS GIF 编码器）
- [ ] **视频逐帧截图提取（`video-frames`）**：精确到帧预览视频，一键导出当前帧高清图或按间隔批量抽帧打包
- [ ] **音频剪切与格式转换（`audio-cutter`）**：可视化波形图选区裁剪、淡入淡出、导出 WAV / MP3
  - *技术方案*：`Web Audio API` (`OfflineAudioContext`)
- [ ] **屏幕录制与摄像头拍照（`screen-recorder`）**：基于浏览器原生 `getDisplayMedia` 免安装录屏（支持麦克风混音），本地直出 WebM/MP4

---

## 八、生活实用（`life`）

- [ ] **单位换算器（`unit-converter`）**：长度、面积、体积、重量、温度、数据存储（B/KB/MB/KiB/MiB）、速度、压力实时互转
- [ ] **进制转换与位运算计算器（`base-converter`）**：2 / 8 / 10 / 16 及任意 2–36 进制实时互转
- [ ] **日期间隔与倒数日计算（`date-calc`）**：计算两个日期相隔天数/周数/工作日，或推算 N 天前后的日期
- [ ] **亲戚称呼计算器（`relationship-calc`）**：输入关系链（如“爸爸的妈妈的弟弟的儿子”）即时计算互称
- [ ] **数字转人民币大写（`rmb-upper`）**：阿拉伯数字金额实时转换为财务规范汉字大写金额
- [ ] **随机抽签 / 转盘决策（`random-picker`）**：自定义选项列表或名单，带流畅动效的转盘与不重复抽签
- [ ] **番茄钟与白噪音（`pomodoro`）**：纯 Web Audio API 合成雨声/白噪音/粉红噪音 + 专注倒计时，支持桌面通知
- [ ] **手持弹幕 / 全屏时钟（`fullscreen-clock`）**：适合平板/桌面横屏放置的翻页大字时钟或全屏滚动 LED 弹幕

