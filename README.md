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

# 预览生产构建产物
pnpm preview
```

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
│  ├─ search.ts               # Fuse.js + 拼音按需索引
│  └─ utils.ts                # 类名合并、字节格式化等
├─ pages/                     # 首页、分类页、收藏与最近、工具详情容器页、404
├─ registry/
│  ├─ categories.ts           # 8 大工具分类定义与渐变色配置
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
   └─ image-compress/         # 图片压缩
      ├─ meta.ts              # 工具元数据
      ├─ types.ts             # 配置与格式映射工具函数
      ├─ worker.ts            # Web Worker（OffscreenCanvas + UPNG 智能量化）
      ├─ engine.ts            # Worker 并发池、AVIF 能力探测与 fflate ZIP 打包
      ├─ CompareView.tsx      # Before / After 滑动条与 1x/2x/4x 放大对比视口
      └─ index.tsx            # 主界面与批量队列
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

