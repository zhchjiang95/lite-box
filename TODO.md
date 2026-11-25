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
- [x] **PDF 水印、页码与打码（`pdf-watermark`）**：为 PDF 批量添加中文/英文/Emoji 多行文字或透明 Logo 水印（全屏斜向错行平铺或九宫格定位）、6 方位中英文页码（支持跳过首页封面），并支持在预览画布直接绘制矩形/圆形纯色遮挡打码（含白底涂改液、拖动与四角缩放、Shift 锁正圆/正方形、单页/应用全部页、Ctrl+Z 撤销，及可选“彻底抹除底层文字”防复制高清栅格化烘焙），实时翻页预览与批量 ZIP 打包
  - *技术方案*：`pdf-lib`（全文档复用 3× 超清透明 PNG 印章 + 旋转页精准矢量/物理烘焙双模式打码）+ `pdfjs-dist` + `fflate`
- [x] **身份证 / 证件正反面 A4 排版打印（`id-card-print`）**：支持普通锁定比例裁剪与四点透视拉直（带 3× 精准放大镜），一键 1:1 国标物理尺寸（85.6×54mm，兼容驾驶证/护照/户口本/自定义）排版至 A4 纸（标准上下居中/一页双份/并排/横向），内置扫描增白与黑白复印滤镜、防盗用途签注水印，支持导出 1:1 A4 PDF、直接打印与导出 300 DPI 高清图
  - *技术方案*：Canvas 2D 单应性矩阵（Homography）四点透视矫正 + 双线性插值 + `pdf-lib` 精确毫米定位

---

## 三、Word 工具（`word`）

- [ ] **Markdown 转 Word（`markdown-to-docx`）**：将 AI 对话（ChatGPT / Gemini / DeepSeek）或笔记中的 Markdown（含标题、列表、表格、代码块、引用）一键转换为排版规整的标准 `.docx` Word 文档，告别直接粘贴格式错乱
  - *技术方案*：`marked`（AST 解析）+ `docx`（纯前端生成原生 Word 样式文档）
- [ ] **Word 转 Markdown / HTML（`docx-to-markdown`）**：本地解析 `.docx`，保留标题层级、表格、列表与内嵌图片，一键导出干净的 Markdown / HTML 或附带图片目录的 ZIP，方便迁移至博客、飞书、Notion
  - *技术方案*：`mammoth` + `turndown` + `fflate`
- [x] **Word 原图无损提取（`docx-extract-media`）**：拖入 `.docx`（同时兼容 `.pptx` / `.xlsx`，支持多文档批量提取），零画质损失一键提取文档中所有内嵌高清原图与音视频媒体，支持画廊大图灯箱预览、过滤 `<5KB` 装饰小图标、按格式/体积筛选排序、单张复制/下载与按文档分目录 ZIP 打包
  - *技术方案*：`fflate` 直接解包读取 `word/media/`、`ppt/media/`、`xl/media/` 原始字节（零重编码、100% 无损）
- [ ] **Word 文档瘦身压缩（`docx-compress`）**：解决 Word 文档动辄几十 MB 发不出去的痛点——完全保留文字与排版，自动将内嵌的高清大图压缩后原样回填封装，文档体积通常可减少 60%–90%
  - *技术方案*：`fflate`（OOXML 无损解包/重封装）+ Canvas 图片压缩管线
- [x] **Word 文档内容对比（`docx-diff`）**：拖入两份 `.docx`（如合同修订前后版本，亦兼容 `.txt / .md`），本地结构化提取正文段落、标题、表格行及可选页眉页脚，执行两级 Myers Diff（段落对齐 + 逐字红绿高亮），支持左右双栏/合并行内切换、只看差异、上一处/下一处差异定位跳转、相似度统计与导出独立可打印 HTML 审阅报告
  - *技术方案*：`fflate` + `DOMParser` 结构化解析 `word/document.xml`（自动跳过 `w:del` 历史删除修订）+ `diff`（Myers diff 算法）
- [x] **Word 在线预览与隐私元数据清理（`docx-viewer`）**：无需安装 Office 本地秒开 `.docx` 高还原排版预览（支持缩放、页眉页脚、批注与修订痕迹切换及直接打印），深度体检作者、公司、最后修改人、编辑时长、自定义属性、隐藏批注与修订痕迹，支持勾选脱敏清理并无损重导出（多文件批量打包 ZIP）
  - *技术方案*：`docx-preview`（按需动态加载）+ `fflate` + `DOMParser`/`XMLSerializer`（精准无损清理 `docProps/core.xml`、`app.xml`、`custom.xml`、`word/people.xml` 与可选批注）

---

## 四、局域网互联（`lan`）

> 依托独立部署目录 `server/` 内置的零依赖原生 WebSocket 信令（`/ws/lan`）与 WebRTC 点对点加密通道实现，文件与音视频数据优先在局域网内直传、绝不落盘存储。

- [x] **隔空快传 · 局域网文件共享（`lan-transfer`）**：两台设备打开网页自动进入同局域网无线雷达发现圈，随机分配唯一设备代号（可改名），支持无线声波脉冲与能量流飞行动画、拖拽磁吸发文件、WebRTC P2P 加密直传、极端网络自动切换内存流中转兜底（不落盘）、6 位配对码跨网连接与文字/链接秒传
  - *技术方案*：原生 RFC 6455 WebSocket 信令（`server/signaling.mjs`）+ `RTCPeerConnection` / `RTCDataChannel` 分片背压传输 + WebSocket 二进制流兜底
- [x] **局域网共享剪贴板（`lan-clipboard`）**：手机、Mac、Windows 打开同一页面实时同步文字、链接、代码块与压缩截图，支持一键读取系统剪贴板、全局 `Ctrl+V` 秒传截图、分类筛选与搜索、置顶、6 位配对码跨网同步及一键焚毁清空（纯内存暂存，全部设备离开即自动销毁）
  - *技术方案*：独立频道 `/ws/lan?channel=clipboard` 房间实时广播 + Clipboard API + Canvas 截图轻量化压缩
- [x] **局域网无线投屏（`lan-screen`）**：基于浏览器原生 `getDisplayMedia` 与 WebRTC，免装 App 将电脑屏幕或指定窗口超低延迟投屏到局域网内另一台电脑、iPad 或电视浏览器，支持一投多并发观看、4 档画质帧率与系统音频共享、定向推送观看邀请、全屏影院/画中画/一键截屏与实时分辨率/帧率/码率/RTT 链路监测
  - *技术方案*：`getDisplayMedia` + WebRTC `MediaStream` 局域网直连（`contentHint` 锐利度优化与高码率参数）+ 独立信令频道 `/ws/lan?channel=screen`
- [ ] **局域网多人同步白板（`lan-whiteboard`）**：多人手机/平板/电脑扫码加入同一块画布，实时同步粉笔/箭头/批注，适合团队会议与教学互动
  - *技术方案*：复用 `blackboard` 1920×1080 渲染引擎 + WebSocket 增量操作广播
- [ ] **局域网临时聊天室（`lan-chat`）**：免注册登录，同局域网或 6 位房间码即开即聊，支持文字、代码块与图片直传，关闭即清空不存数据库
- [ ] **局域网语音 / 视频对讲（`lan-call`）**：两台设备打开网页即可点对点高清语音或视频通话，不消耗外网流量

---

## 五、文本处理（`text`）

- [ ] **字数与文本统计（`word-count`）**：实时统计总字数、中文字数、英文词数、标点、行数、段落数、字节大小及预计阅读时长
- [ ] **文本对比 Diff（`text-diff`）**：左右双栏或行内对比两段文本差異，支持逐行 / 逐词 / 逐字符高亮
  - *技术方案*：`diff`（Myers diff 算法）
- [ ] **文本去重与行处理（`text-lines`）**：按行去重、排序（字典序/长度/自然序/随机打乱）、去空行、首尾加前后缀、合并或分割
- [ ] **英文字母大小写与命名风格转换（`case-convert`）**：`camelCase`、`PascalCase`、`snake_case`、`kebab-case`、`CONSTANT_CASE`、首字母大写等一键互转
- [x] **Markdown 实时预览与导出（`markdown-preview`）**：支持 GFM 表格、任务清单、35+ 语言代码语法高亮、KaTeX 行内/块级数学公式、4 套精美排版主题（极简文档/公众号风/学术纸张/极客暗夜）、分屏同步滚动、快捷语法栏，一键导出独立 HTML、2× 高清长图 PNG、富文本复制、打印 PDF 与保存 `.md`
  - *技术方案*：`marked` + `highlight.js/lib/common` + `katex` + `html-to-image` + DOMParser XSS 清洗
- [x] **繁简转换与拼音标注（`chinese-convert`）**：基于 OpenCC 权威词库支持大陆简体、台湾正体（含两岸地域词汇转换）、香港繁体 7 套方案精准互转与变动字符高亮，支持汉字转带声调/数字声调/无声调拼音、语文头顶 Ruby 注音卡片（支持打印与复制 HTML）、首字母提取、姓氏多音字模式及声韵母多音字拆解表
  - *技术方案*：`opencc-js`（按需动态加载 + 转换器缓存）+ `pinyin-pro`
- [x] **正则提取与批量替换（`text-extract`）**：从杂乱文本中一键提取邮箱、手机号、网址、IP 地址、身份证号、日期、色值与数字，支持自定义正则、捕获组模板、去重排序、TXT/CSV/JSON 导出、原文高亮预览，以及多规则串联流水线批量替换与行级 Diff 对比

---

## 六、编码加密（`encode`）

- [x] **Base64 编解码（`base64`）**：支持 UTF-8 中文/Emoji 文本与标准/URL-Safe Base64 双向互转（支持去填充、76 字符换行与逐行批处理），支持拖放/粘贴图片或任意文件一键生成 DataURL / 纯 Base64 / HTML `<img>` / CSS `url()`，以及粘贴无前缀 Base64 通过文件头魔数自动识别 PNG/JPG/WebP/SVG/PDF/音视频/二进制并预览下载还原
- [ ] **URL 编解码与参数解析（`url-codec`）**：`encodeURI` / `encodeURIComponent` 互转，并将 URL Query 参数解析为可编辑表格，改完实时重拼 URL
- [ ] **哈希计算（`hash`）**：支持文本与大文件分片计算 MD5、SHA-1、SHA-256、SHA-384、SHA-512、CRC32，支持 HMAC
  - *技术方案*：原生 `SubtleCrypto` + `hash-wasm`（高速 WASM，支持大文件流式分块计算）
- [ ] **JWT 解析器（`jwt-decoder`）**：本地解码 JWT 的 Header、Payload，自动格式化时间戳（`exp`/`iat`）并显示过期状态，支持 HMAC 签名校验
- [ ] **Unicode / HTML 实体 / 进制编码（`char-codec`）**：`\uXXXX`、HTML 实体（`&#x...;`）、UTF-8 十六进制字节查看
- [ ] **AES / DES 对称加解密（`crypto-cipher`）**：基于浏览器 Web Crypto API 的文本与文件本地加密/解密

---

## 七、开发工具（`dev`）

- [ ] **JSON 格式化与校验（`json-format`）**：格式化、压缩、语法错误精准定位、Key 排序、转义/去转义、树形折叠视图、JSONPath 查询
- [x] **JSON 与 TypeScript / YAML / CSV / TOML 互转（`data-convert`）**：支持 JSON、YAML、TOML、CSV/TSV 5 种源格式自动识别与双向互转，一键生成合并异构数组推断可选字段的 TypeScript 接口与 Zod Schema，支持点号嵌套展平/反展平、Key 排序、语法高亮、可视化表格预览、文件拖放及 Excel 兼容 CSV 导出
  - *技术方案*：`js-yaml` + `smol-toml` + RFC 4180 CSV 状态机 + 自研 AST 级 TS/Zod 推断引擎 + `highlight.js` 按需高亮
- [ ] **时间戳转换（`timestamp`）**：实时 Unix 秒/毫秒时间戳、与本地/UTC/任意时区日期互转、常用相对时间计算
- [ ] **正则表达式测试（`regex-tester`）**：实时匹配高亮、捕获组详情展示、常用正则速查库（邮箱、手机号、身份证、URL、IPv4 等）
- [x] **颜色空间转换与对比度检查（`color-converter`）**：支持 HEX(3/4/6/8)、RGB/RGBA、HSL/HSLA、OKLCH（含正向/逆向矩阵与 sRGB 色域溢出检测）、CMYK、HSV 与 CSS 命名色实时双向互转，内置屏幕吸管取色、OKLCH 11 阶设计色板（一键导出 CSS 变量 / Tailwind v4 `@theme`）、和谐配色推荐、WCAG 2.1 无障碍对比度体检与“保持色相一键修正至 AA/AAA 达标”，以及支持 `in oklch` 插值的现代 CSS 渐变生成器与 1600×900 PNG 导出
- [ ] **Cron 表达式生成与解析（`cron-parser`）**：可视化配置 Cron 表达式，语义化中文解释并列出未来 10 次执行时间
- [ ] **代码压缩与美化（`code-format`）**：HTML / CSS / JS / SQL 格式化与压缩
- [ ] **HTTP 状态码 / MIME 类型 / 键码速查（`dev-cheatsheet`）**：支持快速检索的离线速查表与键盘 `KeyboardEvent` 按键检测器

---

## 八、生成器（`generate`）

- [x] **二维码生成与识别（`qrcode`）**：支持 5 类内容模板（网址/文本、Wi-Fi 连网、电子名片 vCard、邮件、短信/电话）、6 套预设、5 种码点（含液态连接/圆点/菱形）、3 种码眼、线性渐变与透明底、嵌入中心 Logo（自动升 H 容错并安全镂空）、底部文字标注、可读性对比度体检、高清 PNG / 无损矢量 SVG 导出及多行批量打包 ZIP；支持拖放/粘贴图片（含 HEIC）与摄像头离线扫码识别，并可一键回填二次美化
  - *技术方案*：`qrcode` 矩阵 + 自研 Canvas/SVG 双渲染器 + `fflate` 批量打包 + 原生 `BarcodeDetector` / `jsqr` 多尺度反色离线解码
- [x] **条形码生成（`barcode`）**：支持 CODE128 / 128B / 128C、EAN-13、EAN-8、UPC-A、CODE39、ITF-14、ITF、MSI、Codabar、Pharmacode 等 12 种国际条码制式，内置 GS1 Modulo-10 校验码自动补全与一键修正、随机合法示例、条纹/字号/透明底/印刷级 3× PNG 与无损 SVG 导出、连号流水号批量生成 ZIP 及多列 A4 标签直接打印
  - *技术方案*：`jsbarcode` + `fflate` 批量打包 + 原生矢量打印视图
- [ ] **随机密码与密钥生成器（`password-generator`）**：基于密码学安全随机数 `crypto.getRandomValues`，可定制长度、字符集、排除易混淆字符、批量生成与熵值强度评估
- [ ] **UUID / ULID / NanoID 批量生成（`uuid-generator`）**：支持 UUID v4 / v7、ULID、自定义字母表 NanoID 批量生成与复制
- [ ] **占位图生成（`placeholder-image`）**：自定义尺寸、背景色/渐变、文字内容与字号，一键生成开发测试用占位图（PNG / SVG / DataURL）
- [ ] **Lorem Ipsum 假文生成（`lorem-generator`）**：支持中文段落、英文段落、句子、词语随机生成

---

## 九、音视频（`media`）

- [ ] **视频转 GIF 动图（`video-to-gif`）**：本地载入视频，框选时间段、设置帧率与尺寸，在浏览器中生成高画质调色板 GIF
  - *技术方案*：`<video>` + Canvas 抽帧 + `gifenc`（轻量极速纯 JS GIF 编码器）
- [ ] **视频逐帧截图提取（`video-frames`）**：精确到帧预览视频，一键导出当前帧高清图或按间隔批量抽帧打包
- [ ] **音频剪切与格式转换（`audio-cutter`）**：可视化波形图选区裁剪、淡入淡出、导出 WAV / MP3
  - *技术方案*：`Web Audio API` (`OfflineAudioContext`)
- [ ] **屏幕录制与摄像头拍照（`screen-recorder`）**：基于浏览器原生 `getDisplayMedia` 免安装录屏（支持麦克风混音），本地直出 WebM/MP4

---

## 十、生活实用（`life`）

- [ ] **单位换算器（`unit-converter`）**：长度、面积、体积、重量、温度、数据存储（B/KB/MB/KiB/MiB）、速度、压力实时互转
- [ ] **进制转换与位运算计算器（`base-converter`）**：2 / 8 / 10 / 16 及任意 2–36 进制实时互转
- [ ] **亲戚称呼计算器（`relationship-calc`）**：输入关系链（如“爸爸的妈妈的弟弟的儿子”）即时计算互称
- [x] **数字转人民币大写（`rmb-upper`）**：严格按《支付结算办法》将阿拉伯数字金额实时转换为财务规范汉字大写（纯字符串与 BigInt 运算支持 16 位整数零精度误差），提供 14 格支票/报销单数位对照表、语音核对、汉字大写反查数字与规范校验、Excel 多行批量转换自动求和及 CSV 导出
- [x] **随机抽签 / 转盘决策（`random-picker`）**：支持高清 Canvas 幸运大转盘与滚动抽签/点名双模式，支持 `选项 * 权重` 概率、不重复连抽、全屏沉浸大屏模式（原生 Fullscreen + 视口降级 + 空格键快捷键 + 内置记录抽屉）、Web Audio 拨片与胜利音效及礼花彩带庆祝
- [x] **演示黑板 / 手绘白板（`blackboard`）**：打开即用的单页 16:9 应急展示黑板（复古绿黑板 / 暗夜黑板 / 极简白板 / 暖米纸板 + 方格/点阵/横线底纹），支持粉笔/马克笔/荧光笔平滑手绘、箭头与几何图形、任意位置原地输入与双击编辑文字、粘贴截图缩放批注、对象橡皮擦、本地自动防丢与高清 PNG 导出，支持像 PPT 一样全屏沉浸放映（激光笔渐隐拖尾、现场批注、`B`/`W` 休场黑白屏）
- [x] **控制台计算器（`console-calc`）**：仿浏览器 DevTools Console 交互的实时预览计算器，零 `eval` 自研十进制高精度引擎（彻底消除 `0.1 + 0.2` 浮点误差），支持边输边出预览（含未输入完算式容错）、历史记录与 `↑`/`↓` 翻页、`#n`/`ans` 引用、中文变量与单位（`万`/`k`/`亿`）、直观百分比与取模、多进制与位运算、30+ 科学统计函数、千分位/人民币大写/多进制实时洞察、以及 Soulver 风格多行草稿纸联动算账与账单导出
- [x] **设备信息与网速测试（`device-info`）**：纯本地全面体检设备与系统信息（UA-CH 高精度 OS/架构、CPU 逻辑核心、内存与 JS 堆占用、WebGL/WebGPU 显卡型号与纹理上限、屏幕分辨率/DPR/色域/HDR/实时刷新率测算、电池监听、本地存储配额、音视频编解码与媒体外设、18 项现代 Web API 能力与权限矩阵，支持复制 Markdown/导出 JSON 报告），内置公网 Cloudflare 边缘与自建 `/api/speedtest/*` 双引擎实时测速仪（Ping/抖动/流式下载/随机载荷上传、SVG 弧形仪表盘与实时波形图、按需公网 IP 查询与历史对比）
- [x] **竞彩赛果大宽表（`sporttery-results`）**：迁移自 `sporttery` 项目的体彩足球 15 列完赛开奖宽表，配合模块化零依赖后端 `/api/sporttery/results`（受控 6 并发池限流 + 单场 SP 24h 缓存 + 列表 5m 缓存 + 90 天跨度自动保护），前端支持快捷/自定义日期、联赛筛选与不足 10 条自动分页补齐、队名搜索、胜平负/单关过滤、赔率列排序、冻结左侧对阵列、触底无限加载，以及一键导出 Excel 兼容 CSV 与制表符复制
- [ ] **番茄钟与白噪音（`pomodoro`）**：纯 Web Audio API 合成雨声/白噪音/粉红噪音 + 专注倒计时，支持桌面通知
- [ ] **手持弹幕 / 全屏时钟（`fullscreen-clock`）**：适合平板/桌面横屏放置的翻页大字时钟或全屏滚动 LED 弹幕

---

## 十一、日历历法（`calendar`）

> **核心选型**：采用 6tail 开源的新一代原生 TypeScript 日历库 **`tyme4ts`**（`lunar-typescript` 升级版，零依赖、纯本地离线运行，完整覆盖公历、农历、干支、藏历、二十四节气精确时刻、七十二候、数九三伏、月相、星座、法定节假日与调休补班）。
>
> *维护提示*：中国法定节假日调休安排每年底由国务院新公布，后续通过升级 `tyme4ts` 版本（或支持本地 JSON 补丁覆写）即可保持最新年份同步。

- [x] **万年历与传统黄历（`perpetual-calendar`）**：全月视图 + 当日老黄历双栏联动展示，支持 1900–2100 年公历/农历/干支/藏历（1951–2050）/儒略日多历法互转、法定休/班角标、传统与现代节日节气、按常见事项一键择日高亮、SVG 月相图示、每日宜忌、建除/黄黑道/冲煞、六大吉神方位、九星、胎神、彭祖百忌、十二时辰吉凶宜忌，以及农历生日转未来公历对照与 `.ics` 提醒日历导出
  - *技术方案*：`tyme4ts`（`SolarDay` / `LunarDay` / `SixtyCycleDay` / `RabByungDay` / `LegalHoliday` / `Phase`）
- [x] **二十四节气与物候指南（`solar-terms`）**：支持 1900–2100 百年二十四节气精确到秒交节时刻查询、实时秒级交节倒计时、交互式东方黄道星盘与四时全览、每节气三候与全年七十二候可检索总表、三伏天（含 10/20 天中伏识别）/数九寒天（附《九九消寒歌》）/传统梅雨时间轴、传统民俗与应季食养指南，以及一键导出 `.ics` 日历与 Markdown 时刻表
  - *技术方案*：`tyme4ts`（`SolarTerm` / `PhenologyDay` / `NineDay` / `DogDay` / `PlumRainDay`）+ 交互式 SVG 黄道星盘 + `.ics` 导出
- [x] **法定节假日与拼假攻略（`legal-holidays`）**：支持 2002–2027 全年法定节假日与调休补班查询、下一假期与剩余工作日倒计时、智能年假拼假推荐（请 N 休 M 高亮日历条带）、全年 12 月交互式试请年假沙盒、补班速查表、Markdown 攻略复制与一键导出标准 RFC 5545 `.ics` 日历文件
  - *技术方案*：`tyme4ts`（`LegalHoliday` / `SolarDay` / `LunarDay`）+ 智能区间拼假算法 + 纯前端 `.ics` 生成器
- [x] **星座、生肖与干支星宿查询（`zodiac-constellation`）**：支持 1900–2100 公历/农历（自动识别闰月与大小月）双向输入与十二时辰快捷选择，精准查询西方十二星座（含四象元素、守护星与交界日 Cusp 提醒）、十二生肖（立春交节/农历春节双口径实时对照与三合六合六冲图谱）、干支八字四柱排盘（天干十神、地支藏干、纳音五行、十二长生、旬空、命宫/身宫/胎元/胎息与五行分布统计）、SVG 出生月相图示与东方四象二十八星宿全图谱，支持一键复制 Markdown 星历报告
  - *技术方案*：`tyme4ts`（`Constellation` / `EightChar` / `Sound` / `TwentyEightStar` / `Phase`）
- [ ] **日期间隔、工作日与倒数日计算（`date-calc`）**：计算两日期相隔天数/周数/月数，结合法定节假日与补班数据**精准统计真实工作日**；支持按自然日或工作日推算 N 天前后日期、周岁/虚岁计算及生成纪念日倒数卡片
  - *技术方案*：`tyme4ts`（`LegalHoliday` + `SolarDay` 差值与步进）
- [ ] **世界时钟与跨时区会议对比（`world-clock`）**：基于浏览器原生 `Intl.DateTimeFormat` 的多城市实时时钟与 24 小时横向时间轴拖动对齐，一键找出跨国团队最佳重叠会议时段
  - *技术方案*：原生 `Intl.DateTimeFormat`（零额外依赖）

