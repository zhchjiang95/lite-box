# 轻匣（LiteBox）· 工具规划清单（TODO）

> 本清单整理所有**可在浏览器本地（纯前端 / Web Worker / WASM）实现**的工具，无需后端上传，保障隐私与响应速度。
>
> **开发约定**：每完成一个工具，在 `src/tools/<tool-id>/` 下创建 `meta.ts` + `index.tsx`，并在 `src/registry/planned.ts` 中移除对应“即将上线”项，再将下方复选框勾上。

---

## 一、图片处理（`image`）

- [x] **图片拼接（`image-stitch`）**：横向、纵向、宫格拼接，支持拖拽排序、间距、外边距、圆角、背景色、统一宽/高、对齐方式与多格式导出
- [x] **图片压缩（`image-compress`）**：批量压缩 JPG / PNG / WebP / AVIF，支持画质滑块、PNG 智能色彩量化、最大边长限制、前后体积与画质对比（Before/After 滑动条 + 4 倍放大镜）、一键打包 ZIP 下载
  - *技术方案*：Web Worker 并发池 + `OffscreenCanvas` + `upng-js`（PNG 调色板量化）+ `fflate`（零级极速 ZIP 打包）
- [x] **图片格式转换（`image-convert`）**：PNG、JPG、WebP、AVIF、BMP、ICO 批量互转，支持 HEIC/HEIF 与 SVG 直转、多尺寸 ICO 封装、尺寸倍率/最大边限制及一键 ZIP 打包
  - *技术方案*：`createImageBitmap` + `OffscreenCanvas` + 按需懒加载 `heic2any` + 纯前端 24-bit BMP / 多尺寸 ICO 二进制编码器 + `fflate`
- [x] **图片裁剪与缩放（`image-crop`）**：自由比例或预设比例（1:1、4:3、16:9、一寸/二寸/护照证件照标准尺寸）交互式裁剪、圆形头像裁切、90°/±45° 旋转翻转、自定义输出像素，以及多图按百分比/固定宽/高/指定尺寸批量缩放与 ZIP 打包
  - *技术方案*：纯前端交互式 `CropCanvas`（8 方向拖拽 + 锁比例约束）+ 单次 Canvas 2D 变换矩阵渲染 + `fflate`
- [ ] **图片加水印（`image-watermark`）**：支持文字水印与图片 Logo 水印，支持全屏斜向平铺（防盗图证件水印）或九宫格定位，可调透明度、字号、旋转角度、间距
  - *技术方案*：Canvas 2D 平铺矩阵计算与混色
- [ ] **图片取色与调色板（`image-palette`）**：点击放大镜取任意像素色值（HEX / RGB / HSL / OKLCH），自动提取图片主色调与配色方案
  - *技术方案*：`EyeDropper API` + Canvas `getImageData` 颜色量化（MMCQ / K-Means）
- [ ] **九宫格切图（`image-split`）**：将单张图片切分为 3×3 九宫格、2×2 四宫格或自定义行×列，适用于朋友圈/微博发图，一键打包下载
  - *技术方案*：Canvas 分块裁剪 + `fflate`
- [ ] **EXIF 信息查看与抹除（`image-exif`）**：读取照片拍摄设备、快门、光圈、GPS 位置等元数据，并支持一键清除隐私信息后导出
  - *技术方案*：`exifreader` + Canvas 重绘或二进制段剥离
- [ ] **长图切分 / 滚动截图分页（`image-slice`）**：将超长图片按固定高度或指定比例切成多张图（适合小红书/公众号多图发布）
- [ ] **圆角与阴影美化 / 截图套壳（`screenshot-beautify`）**：为截图添加 macOS 窗口标题栏、渐变背景、圆角、多层柔和阴影与内边距，一键复制或导出高清宣传图
- [ ] **SVG 转 PNG/WebP（`svg-to-image`）**：粘贴 SVG 代码或上传 `.svg` 文件，自定义倍数（1x/2x/4x）与尺寸导出位图
- [ ] **Favicon 图标生成（`favicon-generator`）**：上传一张图一键生成全套 `favicon.ico`（多尺寸合并）、`apple-touch-icon.png`、PWA 图标及 HTML 代码

---

## 二、PDF 工具（`pdf`）

- [ ] **PDF 合并与拆分（`pdf-merge-split`）**：多份 PDF 拖拽合并、按页码范围拆分、页面拖拽重排、单页旋转与删除
  - *技术方案*：`pdf-lib`（纯 JS 修改 PDF 结构）+ `pdfjs-dist`（渲染页面缩略图）
- [ ] **图片转 PDF（`image-to-pdf`）**：多张图片合成一份 PDF，支持 A4/自适应纸张大小、方向、页边距设置
  - *技术方案*：`pdf-lib`
- [ ] **PDF 转图片（`pdf-to-image`）**：将 PDF 每一页渲染为高清 PNG / JPG，支持单页下载或整本打包为 ZIP
  - *技术方案*：`pdfjs-dist` + `fflate`
- [ ] **PDF 加水印 / 页码（`pdf-watermark`）**：为 PDF 批量添加文字水印或底部页码
  - *技术方案*：`pdf-lib`

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

