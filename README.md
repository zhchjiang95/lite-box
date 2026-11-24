# 轻匣（LiteBox）· 纯本地网页工具箱

> **100% 浏览器本地处理**的现代网页工具箱 —— 文件不上传服务器、打开即用、支持离线（PWA）、支持拼音极速搜索与全端自适应。

---

## 一、快速开始

项目使用 **pnpm** 管理依赖（Node.js ≥ 20）：

```bash
# 启动本地开发服务
pnpm dev

# 类型检查
pnpm typecheck

# 生产环境构建（含 PWA Service Worker）
pnpm build

# 预览生产构建产物（Vite 临时预览）
pnpm preview
```

### 生产部署（独立 Node.js 服务）

仓库根目录提供了与前端工程解耦的独立部署目录 [server/](./server/README.md)（零第三方依赖，内置 Brotli/Gzip 压缩与 SPA/PWA 缓存）：

```bash
# 1. 构建前端产物
pnpm build

# 2. 进入独立的 server/ 目录启动服务（默认监听 0.0.0.0:3000，自动读取 ../dist 或 ./public）
cd server && node index.mjs
```

> 支持 `PORT`、`HOST`、`DIST_DIR`、`ENABLE_COMPRESSION` 环境变量，详细说明见 [server/README.md](./server/README.md)。

---

## 二、技术栈

| 模块 | 选型 | 说明 |
|---|---|---|
| 构建与框架 | **Vite 6 + React 19 + TypeScript** | 按需分包、`import.meta.glob` 自动发现工具 |
| 路由 | **React Router v7** | 路由级懒加载 + 原生 View Transitions API 转场 |
| 样式与主题 | **Tailwind CSS v4** + OKLCH CSS 变量 | 玻璃拟态、极光动态背景、亮/暗/跟随系统三态切换 |
| 动效 | **Motion 12** + **View Transitions API** | 列表重排、共享元素飞入、3D 悬停倾斜、圆形扩散切主题 |
| 搜索面板 | **cmdk** + **Fuse.js** + **pinyin-pro** | `⌘K` / `Ctrl+K` / `/` 唤起，支持中文、拼音全拼、拼音首字母（如 `tppj` → 图片拼接） |
| 移动端交互 | **Vaul** + 响应式 `ToolShell` | 移动端参数面板自动转为可拖拽底部抽屉 |
| 状态持久化 | **Zustand** (`persist`) | 收藏夹、最近使用、主题与侧栏折叠状态持久化于 `localStorage` |
| 离线能力 | **vite-plugin-pwa** | 自动预缓存静态资源，支持安装到桌面 / 手机主屏离线使用 |

---

## 三、目录结构

```text
src/
├─ app/
│  └─ router.tsx              # 路由配置（页面级按需懒加载）
├─ components/
│  ├─ layout/                 # 全局外壳：AppLayout（左右分栏）、Sidebar（含主题切换）、Navigation（移动端底栏）、CommandMenu(⌘K)
│  ├─ tool-kit/               # 工具通用底座：ToolShell（响应式参数抽屉）、FileDropzone（拖放/粘贴）
│  ├─ ui/                     # 基础 UI 组件：Button、Slider、Segmented、Field、Switch、ColorPicker 等
│  ├─ Brand.tsx               # 极光背景与品牌 Logo
│  ├─ ThemeToggle.tsx         # 圆形扩散过渡主题切换器
│  ├─ ToolCard.tsx            # 3D 光斑工具卡片 + View Transitions 共享元素标记
│  ├─ ToolGrid.tsx            # 错落进场与平滑重排网格
│  └─ ToolIcon.tsx            # 分类渐变图标容器
├─ hooks/                     # 媒体查询、主题同步、快捷键等通用 Hook
├─ lib/
│  ├─ file.ts                 # Blob 下载、Canvas 导出、剪贴板复制等文件工具
│  ├─ image.ts                # 统一图片解码器（原生位图 / SVG / 按需懒加载 heic-to 支持 iPhone 15/16 HEIC）
│  ├─ pdf.ts                  # PDF.js 本地 Worker 初始化、页面缩略图渲染与页码范围解析器
│  ├─ search.ts               # Fuse.js + 拼音按需索引
│  └─ utils.ts                # 类名合并、字节格式化等
├─ pages/                     # 首页、分类页、收藏与最近、工具详情容器页、404
├─ registry/
│  ├─ categories.ts           # 10 大工具分类定义与渐变色配置（含 Word 工具、局域网互联）
│  ├─ index.ts                # 核心：自动扫描 src/tools/*/meta.ts 生成工具注册表
│  ├─ planned.ts              # “即将上线”工具预览列表
│  └─ types.ts                # 工具与分类类型定义
├─ stores/
│  └─ settings.ts             # 收藏、最近使用、主题、命令面板开关状态
└─ tools/                     # 所有具体工具实现（每个工具一个独立文件夹）
   ├─ image-stitch/           # 图片拼接
   │  ├─ meta.ts              # 工具元数据（同步加载，轻量）
   │  ├─ index.tsx            # 工具界面与交互（路由懒加载）
   │  └─ stitch.ts            # 纯函数布局计算与 Canvas 渲染引擎
   ├─ image-compress/         # 图片压缩
   │  ├─ meta.ts              # 工具元数据
   │  ├─ types.ts             # 配置与格式映射工具函数
   │  ├─ worker.ts            # Web Worker（OffscreenCanvas + UPNG 智能量化）
   │  ├─ engine.ts            # Worker 并发池、AVIF 能力探测与 fflate ZIP 打包
   │  ├─ CompareView.tsx      # Before / After 滑动条与 1x/2x/4x 放大对比视口
   │  └─ index.tsx            # 主界面与批量队列
   ├─ image-convert/          # 图片格式转换
   │  ├─ meta.ts              # 工具元数据
   │  ├─ types.ts             # 目标格式定义与 HEIC/SVG 识别
   │  ├─ encoders.ts          # 零依赖 24-bit BMP 与多尺寸 PNG-in-ICO 二进制编码器
   │  ├─ engine.ts            # 解码缓存（HEIC 按需懒加载 heic2any）、格式转换与 ZIP 打包
   │  └─ index.tsx            # 6 格式卡片选择、预览与批量转换队列
   ├─ image-crop/             # 图片裁剪缩放
   │  ├─ meta.ts              # 工具元数据
   │  ├─ types.ts             # 常用比例、证件照尺寸与批量缩放配置类型
   │  ├─ engine.ts            # 旋转外接盒计算、单次矩阵裁剪导出与批量缩放 ZIP 打包
   │  ├─ CropCanvas.tsx       # 交互式裁剪画布（8 方向拖拽、锁比例、三分线、圆形参考线）
   │  └─ index.tsx            # 精细裁剪与批量缩放双模式界面
   ├─ image-watermark/        # 图片加水印
   │  ├─ meta.ts              # 工具元数据
   │  ├─ types.ts             # 水印配置、常用防盗/版权模板与九宫格锚点定义
   │  ├─ engine.ts            # 对角线无缺角平铺矩阵、单点定位、混合模式与批量 ZIP 打包
   │  └─ index.tsx            # 实时预览（支持画布拖拽微调）与批量水印工作台
   ├─ image-palette/          # 图片取色与调色板
   │  ├─ meta.ts              # 工具元数据
   │  ├─ color.ts             # HEX/RGB/HSL/OKLCH/CMYK 转换、WCAG 对比度、K-Means++ 主色提取与色卡绘制
   │  ├─ LoupeCanvas.tsx      # 11×11 像素放大镜与坐标采样画布
   │  └─ index.tsx            # 取色工作台、衍生配色方案与 CSS/JSON/海报导出
   ├─ image-split/            # 九宫格切图
   │  ├─ meta.ts              # 工具元数据
   │  ├─ types.ts             # 网格预设、构图模式与切片配置类型
   │  ├─ engine.ts            # 统一切分几何计算、单格/批量渲染与 ZIP 打包
   │  └─ index.tsx            # 原图切线拖拽构图 + 朋友圈发图效果双视图界面
   ├─ image-exif/             # EXIF 信息查看与抹除
   │  ├─ meta.ts              # 工具元数据
   │  ├─ parser.ts            # 基于 exifreader 的摄影速览、GPS 与隐私体检解析器
   │  ├─ stripper.ts          # JPEG/PNG 二进制无损元数据剥离器、Canvas 重绘与批量 ZIP 打包
   │  └─ index.tsx            # 隐私体检、摄影卡片、可搜索元数据表与批量抹除工作台
   ├─ image-slice/            # 长图切分 / 滚动截图分页
   │  ├─ meta.ts              # 工具元数据
   │  ├─ types.ts             # 社媒比例预设、切分模式与末页处理配置
   │  ├─ engine.ts            # 自动切线计算、行方差智能避字吸附算法与分页 ZIP 打包
   │  └─ index.tsx            # 长图可拖拽切线编辑画布与分页卡片预览工作台
   ├─ screenshot-beautify/    # 截图美化套壳
   │  ├─ meta.ts              # 工具元数据
   │  ├─ types.ts             # 12 套渐变预设、窗口风格与画幅配置
   │  ├─ engine.ts            # 多层阴影、macOS/浏览器标题栏、玻璃外框与噪点 Canvas 渲染器
   │  └─ index.tsx            # 实时美化工作台（含内置示例图与剪贴板秒换图）
   ├─ svg-to-image/           # SVG 转图片
   │  ├─ meta.ts              # 工具元数据
   │  ├─ engine.ts            # SVG 解析补全、矢量高倍无锯齿光栅化、DataURL 与批量 ZIP 打包
   │  └─ index.tsx            # 实时预览、SVG 代码编辑与多文件批量队列工作台
   ├─ favicon-generator/      # Favicon 图标生成
   │  ├─ meta.ts              # 工具元数据
   │  ├─ types.ts             # 全平台输出规格、渐变预设与配置类型
   │  ├─ engine.ts            # 多尺寸 PNG/ICO 生成、site.webmanifest/HTML 构建与 ZIP 打包
   │  └─ index.tsx            # 亮/暗浏览器标签模拟、主屏预览与一键下载工作台
   ├─ photo-frame/            # 摄影作品分享框
   │  ├─ meta.ts              # 工具元数据
   │  ├─ types.ts             # 6 套画框主题、6 套艺术字体、品牌徽标与四向布局配置
   │  ├─ fonts.ts             # 按需异步加载精选艺术字体（离线自动优雅降级）
   │  ├─ engine.ts            # 四向画框渲染、矢量品牌徽标、弥散毛玻璃/胶片齿孔与示例图生成
   │  └─ index.tsx            # 自动解析 EXIF + 实时画框定制工作台
   ├─ pdf-merge-split/        # PDF 合并与拆分
   │  ├─ meta.ts              # 工具元数据
   │  ├─ types.ts             # 源文件与页面卡片类型定义
   │  ├─ engine.ts            # 基于 pdf-lib 的无损合并、按范围拆分与固定页数 ZIP 拆分
   │  ├─ PageThumbnail.tsx    # IntersectionObserver 懒渲染页面卡片与拖拽重排组件
   │  └─ index.tsx            # 统一页面级合并/拆分/旋转/高清预览工作台
   ├─ image-to-pdf/           # 图片转 PDF
   │  ├─ meta.ts              # 工具元数据
   │  ├─ types.ts             # 纸张规格、方向、页边距与压缩配置类型
   │  ├─ engine.ts            # 基于 pdf-lib 的智能直通/转换嵌入、裁切与页码生成引擎
   │  └─ index.tsx            # 所见即所得纸张模拟预览与拖拽排页工作台
   ├─ pdf-to-image/           # PDF 转图片
   │  ├─ meta.ts              # 工具元数据
   │  ├─ engine.ts            # 高倍渲染单页、批量打包 ZIP 与纵向超清长图合成引擎
   │  ├─ PageCard.tsx         # IntersectionObserver 懒渲染页面卡片（勾选/复制/下载/放大）
   │  └─ index.tsx            # PDF 转图工作台与高清预览弹窗
   ├─ pdf-watermark/          # PDF 加水印与页码
   │  ├─ meta.ts              # 工具元数据
   │  ├─ types.ts             # 水印模板、九宫格锚点与中英文页码配置类型
   │  ├─ engine.ts            # 3× 超清中文/Logo 透明印章嵌入、无损平铺/页码写入与批量 ZIP
   │  └─ index.tsx            # 实时翻页叠加预览与多文档批量工作台
   ├─ id-card-print/          # 身份证 / 证件正反面 A4 排版打印
   │  ├─ meta.ts              # 工具元数据
   │  ├─ types.ts             # 国标证件尺寸预设、A4 排版模式与防盗水印配置类型
   │  ├─ engine.ts            # 单应性四点透视拉直、扫描增白/黑白滤镜、1:1 A4 PDF 导出与直接打印
   │  ├─ CropEditorModal.tsx  # 交互式比例裁剪 & 四点透视拉直弹窗（带 3× 十字放大镜）
   │  └─ index.tsx            # 双面证件上传、1:1 A4 实时预览与一键打印工作台
   ├─ text-extract/           # 正则提取与批量替换
   │  ├─ meta.ts              # 工具元数据
   │  ├─ types.ts             # 10 套常用提取预设、7 套脱敏/清洗替换预设与示例文本
   │  ├─ engine.ts            # 安全正则提取、捕获组模板、去重排序、多规则流水线替换与行级 Diff
   │  └─ index.tsx            # 原文高亮预览、命中明细表与批量替换对比工作台
   ├─ rmb-upper/              # 数字转人民币大写
   │  ├─ meta.ts              # 工具元数据
   │  ├─ engine.ts            # 纯字符串/BigInt 财务规范大小写互转、支票数位格与精确求和引擎
   │  └─ index.tsx            # 单笔转换、支票数位对照、大写反查校验、批量求和与手写速查表
   ├─ random-picker/          # 随机抽签与转盘决策
   │  ├─ meta.ts              # 工具元数据
   │  ├─ types.ts             # 场景预设、权重解析与密码学安全随机抽样算法
   │  ├─ sound.ts             # Web Audio 拨片/胜利音效合成与舞台内置礼花彩带粒子引擎
   │  ├─ WheelCanvas.tsx      # 高清 Canvas 幸运大转盘（跑马灯珠、弹性拨片、权重扇区）
   │  └─ index.tsx            # 大转盘/滚动点名双模式与全屏沉浸舞台工作台
   ├─ blackboard/             # 演示黑板 / 手绘白板
   │  ├─ meta.ts              # 工具元数据
   │  ├─ types.ts             # 4 套板面主题、辅助底纹与 1920×1080 逻辑元素模型
   │  ├─ renderer.ts          # 贝塞尔手绘、矢量图形、多行文字、激光笔拖尾与高清 PNG 导出引擎
   │  └─ index.tsx            # 单页全宽画板工作台与 PPT 式全屏沉浸放映模式
   ├─ lan-transfer/           # 隔空快传 · 局域网文件共享
   │  ├─ meta.ts              # 工具元数据
   │  ├─ types.ts             # 设备识别、传输状态类型与无线晶体音效
   │  ├─ engine.ts            # WebSocket 信令 + WebRTC P2P 直传 + 极端网络内存流中转兜底引擎
   │  ├─ RadarStage.tsx       # 极光雷达脉冲、星轨设备节点、拖拽磁吸与贝塞尔能量光束舞台
   │  └─ index.tsx            # 隔空接收弹窗、6 位配对码跨网连接与无线收件箱工作台
   ├─ lan-screen/             # 局域网无线投屏
   │  ├─ meta.ts              # 工具元数据
   │  ├─ types.ts             # 4 档画质/帧率预设与实时链路遥测类型定义
   │  ├─ engine.ts            # WebRTC 一投多并发推流、定向邀请与实时分辨率/帧率/RTT 遥测引擎
   │  └─ index.tsx            # 推流控制台、附近直播发现与全屏/画中画/截屏影院观看台
   ├─ lan-clipboard/          # 局域网共享剪贴板
   │  ├─ meta.ts              # 工具元数据
   │  ├─ types.ts             # 内容类型自动识别（链接/代码/文本）与截图轻量化压缩/复制工具
   │  └─ index.tsx            # 多端实时同步剪贴板流、一键读剪贴板、置顶筛选与一键焚毁工作台
   ├─ docx-viewer/            # Word 在线预览与隐私元数据清理
   │  ├─ meta.ts              # 工具元数据
   │  ├─ inspector.ts         # OOXML 元数据/隐藏批注/修订痕迹深度解析与无损脱敏清理引擎
   │  └─ index.tsx            # 免装 Office 本地排版预览、直接打印与批量脱敏导出工作台
   ├─ docx-extract-media/     # Word / PPT 原图无损提取
   │  ├─ meta.ts              # 工具元数据
   │  ├─ extractor.ts         # 基于 fflate 的 .docx/.pptx/.xlsx 原始媒体流无损解包与 ZIP 封装引擎
   │  └─ index.tsx            # 多文档画廊预览、小图过滤、大图灯箱、剪贴板复制与批量打包工作台
   ├─ docx-diff/              # Word 文档内容对比
   │  ├─ meta.ts              # 工具元数据
   │  ├─ engine.ts            # OOXML 段落/表格/页眉页脚提取、两级 Myers Diff 与 HTML 报告生成引擎
   │  └─ index.tsx            # 双栏/行内红绿高亮比对、逐处跳转与一键合同示例工作台
   ├─ markdown-preview/       # Markdown 实时预览与导出
   │  ├─ meta.ts              # 工具元数据
   │  ├─ themes.ts            # 4 套排版主题 CSS、暗色语法高亮样式与综合语法示例
   │  ├─ renderer.ts          # marked + highlight.js + KaTeX 渲染、XSS 清洗、HTML/长图/PDF 导出引擎
   │  └─ index.tsx            # 分屏同步滚动、快捷写作语法栏与多格式导出工作台
   ├─ chinese-convert/        # 繁简转换与拼音标注
   │  ├─ meta.ts              # 工具元数据
   │  ├─ engine.ts            # OpenCC 7 套简繁词库转换、Ruby 注音流与多音字声韵母拆解引擎
   │  └─ index.tsx            # 简繁变动高亮、头顶注音打印卡、首字母提取与多音字查询工作台
   ├─ qrcode/                 # 二维码生成与识别
   │  ├─ meta.ts              # 工具元数据
   │  ├─ types.ts             # Wi-Fi/vCard/邮件/短信构造器、6 套美学预设、语义解析与对比度体检
   │  ├─ engine.ts            # 自研 Canvas/无损矢量 SVG 双渲染器、批量 ZIP 打包与 BarcodeDetector/jsQR 离线解码引擎
   │  └─ index.tsx            # 美化生成、批量打包与图片/剪贴板/摄像头离线扫码工作台
   ├─ console-calc/           # 控制台计算器
   │  ├─ meta.ts              # 工具元数据
   │  ├─ engine.ts            # 零 eval 高精度十进制表达式解析器（支持中文变量/单位、百分比/取模、多进制、30+ 科学函数与草稿纸联动）
   │  └─ index.tsx            # DevTools 风格实时预览 REPL 控制台与多行草稿纸双模式工作台
   ├─ device-info/            # 设备信息与网速测试
   │  ├─ meta.ts              # 工具元数据
   │  ├─ collector.ts         # UA-CH/硬件/WebGL 显卡/刷新率/电池/存储/编解码与能力权限本地采集引擎
   │  ├─ speedtest.ts         # 公网 Cloudflare 与自建 /api/speedtest/* 双引擎实时测速（Ping/抖动/上下行）与按需 IP 查询
   │  └─ index.tsx            # 系统硬件全览、SVG 实时测速仪表盘与浏览器能力矩阵工作台
   └─ sporttery-results/      # 竞彩赛果大宽表
      ├─ meta.ts              # 工具元数据
      ├─ api.ts               # /api/sporttery/results 请求封装、联赛提取与 Excel CSV/TSV 导出引擎
      └─ index.tsx            # 15 列冻结对阵大宽表、联赛自动补齐分页、搜索排序与统计概览工作台
```

---

## 四、如何新增一个工具（插件化注册）

得益于 `src/registry/index.ts` 的 `import.meta.glob` 自动注册机制，**新增工具无需修改路由、菜单或搜索逻辑**，只需在 `src/tools/` 下新建一个目录：

### 1. 创建 `src/tools/<tool-id>/meta.ts`
> 注意：目录名 `<tool-id>` 必须与 `meta.ts` 中的 `id` 保持一致。

```ts
import { Minimize2 } from 'lucide-react'
import type { ToolMeta } from '@/registry/types'

export default {
  id: 'image-compress',
  name: '图片压缩',
  description: '批量压缩 JPG/PNG/WebP，画质可调，前后体积对比',
  category: 'image',
  icon: Minimize2,
  keywords: ['compress', '瘦身', '减小体积', 'tinypng'],
  badge: 'new',
  createdAt: '2026-11-12',
} satisfies ToolMeta
```

### 2. 创建 `src/tools/<tool-id>/index.tsx`
推荐使用 `src/components/tool-kit/` 提供的通用组件快速搭建，自动获得桌面端双栏 + 移动端底部抽屉与操作栏的全平台适配体验：

```tsx
import { ToolShell } from '@/components/tool-kit/ToolShell'
import { FileDropzone } from '@/components/tool-kit/FileDropzone'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'

export default function ImageCompress() {
  return (
    <ToolShell
      panel={<Field label="压缩质量">...</Field>}
      actions={<Button variant="primary" size="lg">导出图片</Button>}
    >
      <FileDropzone accept="image/*" onFiles={(files) => console.log(files)} />
    </ToolShell>
  )
}
```

### 3. 更新规划清单
如果该工具此前在 `src/registry/planned.ts` 的“即将上线”列表中，将其从 `planned.ts` 移除，并在 [TODO.md](./TODO.md) 中勾选对应条目即可。

---

## 五、特殊设计说明

1. **首屏与按需加载分离**：
   - `meta.ts` 仅包含名称、分类、图标与关键词，首屏同步加载以支撑分类展示与搜索。
   - 每个工具的 `index.tsx` 及重型依赖、加上拼音库 `pinyin-pro` 均拆分为独立异步 chunk；鼠标悬停或触控按下工具卡片时会自动触发 `preloadTool(id)` 预加载，实现点击即开。
2. **大图内存、Worker 并发与画布上限保护**：
   - 在 `image-stitch` 中，预览画布限制在 600 万像素预算内并使用 `requestAnimationFrame` 合帧渲染，拖动滑块丝滑不卡顿；导出时才按目标尺寸渲染，且自动兼容桌面端与 iOS Safari 的 Canvas 最大面积限制，组件卸载或移除图片时主动调用 `ImageBitmap.close()` 与 `URL.revokeObjectURL()` 释放显存。
   - 在 `image-compress` 中，批量压缩运行在按需创建的 Web Worker 并发池（`OffscreenCanvas` + `upng-js` 调色板量化）中，主线程交互保持 60fps；PNG 压缩在 `<100%` 画质时自动进行色彩量化避免原生 PNG 越压越大，同时支持“防反向增大”自动保留更小原图，批量打包采用 `fflate` 零级存储秒级生成 ZIP。
3. **无障碍与动效降级**：
   - 全局配置了 `<MotionConfig reducedMotion="user">` 与 CSS `@media (prefers-reduced-motion: reduce)`，当用户系统开启“减弱动态效果”时自动关闭复杂位移与过渡动画。
4. **SEO、社交分享与桌面/手机 PWA 应用安装**：
   - 已内置多端图标资源（`favicon.svg`、`favicon.ico`、`apple-touch-icon.png`、`pwa-192x192.png`、`pwa-512x512.png`、`pwa-maskable-512x512.png`）与 1200×630 Open Graph 分享图（`og-image.png`），并在 `index.html`、`vite.config.ts` 中完善了 SEO Meta、JSON-LD `WebApplication`、双主题 `theme-color` 及 PWA 快捷方式（`shortcuts`）。
   - **正式域名上线时建议检查**：确保站点通过 **HTTPS** 访问（PWA 安装的硬性前提），并在 `index.html` 中取消注释 `<link rel="canonical">`、将 `og:image`/`twitter:image` 改为完整 `https://你的域名/og-image.png`，按需补充 `public/robots.txt` 中的 `Sitemap` 地址。

