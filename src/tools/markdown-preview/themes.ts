/** Markdown 实时预览与导出：4 套排版主题 CSS 与综合示例文档 */

export type MdThemeId = 'github' | 'wechat' | 'academic' | 'dark'

export interface MdThemeMeta {
  id: MdThemeId
  label: string
  bg: string
  swatch: string
}

export const MD_THEMES: MdThemeMeta[] = [
  { id: 'github', label: '极简文档', bg: '#ffffff', swatch: '#2563eb' },
  { id: 'wechat', label: '公众号风', bg: '#ffffff', swatch: '#10b981' },
  { id: 'academic', label: '学术纸张', bg: '#fcfaf5', swatch: '#b45309' },
  { id: 'dark', label: '极客暗夜', bg: '#0f172a', swatch: '#8b5cf6' },
]

/** 通用基础排版 + 代码高亮 + 4 套主题作用域样式（预览与导出 HTML / 长图 100% 共享） */
export const MARKDOWN_PROSE_CSS = `
.md-prose {
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Inter, sans-serif;
  font-size: 15px;
  line-height: 1.8;
  color: #1e293b;
  background: #ffffff;
  word-break: break-word;
}
.md-prose > *:first-child { margin-top: 0 !important; }
.md-prose > *:last-child { margin-bottom: 0 !important; }

.md-prose h1, .md-prose h2, .md-prose h3, .md-prose h4 {
  font-weight: 700;
  line-height: 1.35;
  margin-top: 1.6em;
  margin-bottom: 0.65em;
  color: #0f172a;
}
.md-prose h1 { font-size: 1.9em; padding-bottom: 0.35em; border-bottom: 1px solid #e2e8f0; }
.md-prose h2 { font-size: 1.45em; padding-bottom: 0.25em; border-bottom: 1px solid #f1f5f9; }
.md-prose h3 { font-size: 1.18em; }
.md-prose h4 { font-size: 1.02em; }

.md-prose p { margin: 0.9em 0; }
.md-prose a { color: #2563eb; text-decoration: underline; text-underline-offset: 3px; }
.md-prose strong { font-weight: 700; color: #0f172a; }
.md-prose del { opacity: 0.65; }
.md-prose hr { border: 0; border-top: 1px solid #e2e8f0; margin: 1.8em 0; }

.md-prose ul, .md-prose ol { margin: 0.9em 0; padding-left: 1.6em; }
.md-prose ul { list-style-type: disc; }
.md-prose ol { list-style-type: decimal; }
.md-prose li { margin: 0.35em 0; }
.md-prose li input[type="checkbox"] {
  margin-right: 0.5em;
  accent-color: #2563eb;
  transform: translateY(1px);
}

.md-prose blockquote {
  margin: 1.1em 0;
  padding: 0.7em 1.1em;
  border-left: 4px solid #3b82f6;
  background: #f8fafc;
  color: #475569;
  border-radius: 0 10px 10px 0;
}
.md-prose blockquote > p { margin: 0.3em 0; }

.md-prose :not(pre) > code {
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.88em;
  padding: 0.16em 0.42em;
  border-radius: 6px;
  background: #f1f5f9;
  color: #be123c;
}

.md-prose .md-code-block {
  margin: 1.2em 0;
  border-radius: 12px;
  overflow: hidden;
  background: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.2);
}
.md-prose .md-code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 14px;
  background: rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 11px;
  color: #94a3b8;
  font-family: "JetBrains Mono", ui-monospace, monospace;
}
.md-prose .md-code-dots {
  display: inline-flex;
  gap: 5px;
}
.md-prose .md-code-dots i {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
}
.md-prose pre {
  margin: 0;
  padding: 14px 16px;
  overflow-x: auto;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 13px;
  line-height: 1.65;
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}
.md-prose pre code { background: transparent; padding: 0; color: inherit; font-size: inherit; }

.md-prose table {
  width: 100%;
  border-collapse: collapse;
  margin: 1.2em 0;
  font-size: 0.92em;
  overflow: hidden;
  border-radius: 8px;
}
.md-prose th, .md-prose td {
  border: 1px solid #e2e8f0;
  padding: 8px 12px;
}
.md-prose th {
  background: #f8fafc;
  font-weight: 600;
  color: #0f172a;
}
.md-prose tr:nth-child(even) td { background: #fafbfd; }

.md-prose img {
  max-width: 100%;
  border-radius: 10px;
  margin: 1em 0;
}

.md-prose .md-math-block {
  margin: 1.2em 0;
  padding: 0.8em 1em;
  overflow-x: auto;
  text-align: center;
}

/* Highlight.js 暗色语法高亮配色（Atom One Dark 风格） */
.md-prose .hljs-comment, .md-prose .hljs-quote { color: #64748b; font-style: italic; }
.md-prose .hljs-keyword, .md-prose .hljs-selector-tag, .md-prose .hljs-subst { color: #c084fc; }
.md-prose .hljs-string, .md-prose .hljs-doctag, .md-prose .hljs-regexp { color: #86efac; }
.md-prose .hljs-number, .md-prose .hljs-literal, .md-prose .hljs-variable, .md-prose .hljs-template-variable { color: #fdba74; }
.md-prose .hljs-title, .md-prose .hljs-section, .md-prose .hljs-function .hljs-title { color: #38bdf8; }
.md-prose .hljs-type, .md-prose .hljs-class .hljs-title, .md-prose .hljs-built_in { color: #fde047; }
.md-prose .hljs-attr, .md-prose .hljs-attribute, .md-prose .hljs-property { color: #7dd3fc; }
.md-prose .hljs-meta, .md-prose .hljs-symbol { color: #f472b6; }
.md-prose .hljs-addition { color: #86efac; background: rgba(34, 197, 94, 0.16); }
.md-prose .hljs-deletion { color: #fda4af; background: rgba(244, 63, 94, 0.16); }

/* 主题 2：公众号翡翠青精致排版 */
.md-prose[data-theme="wechat"] {
  line-height: 1.9;
  letter-spacing: 0.02em;
  color: #2c3e50;
}
.md-prose[data-theme="wechat"] h1 {
  text-align: center;
  border-bottom: none;
  font-size: 1.65em;
  color: #065f46;
  margin-bottom: 1em;
}
.md-prose[data-theme="wechat"] h2 {
  border-bottom: none;
  border-left: 4px solid #10b981;
  padding: 2px 0 2px 12px;
  font-size: 1.3em;
  color: #065f46;
  background: linear-gradient(90deg, rgba(16, 185, 129, 0.09), transparent 70%);
}
.md-prose[data-theme="wechat"] h3 { color: #047857; }
.md-prose[data-theme="wechat"] a { color: #059669; }
.md-prose[data-theme="wechat"] blockquote {
  border-left-color: #10b981;
  background: #ecfdf5;
  color: #065f46;
}
.md-prose[data-theme="wechat"] :not(pre) > code {
  background: #ecfdf5;
  color: #047857;
}
.md-prose[data-theme="wechat"] th { background: #ecfdf5; color: #065f46; }

/* 主题 3：学术纸张衬线风 */
.md-prose[data-theme="academic"] {
  background: #fcfaf5;
  color: #292524;
  font-family: "Songti SC", "STSong", "Noto Serif SC", Georgia, serif;
  line-height: 1.92;
}
.md-prose[data-theme="academic"] h1,
.md-prose[data-theme="academic"] h2,
.md-prose[data-theme="academic"] h3 {
  color: #1c1917;
  border-color: #e7e5e4;
}
.md-prose[data-theme="academic"] h1 { text-align: center; border-bottom: 2px double #d6d3d1; }
.md-prose[data-theme="academic"] a { color: #b45309; }
.md-prose[data-theme="academic"] blockquote {
  border-left-color: #d97706;
  background: #fef3c7;
  color: #78350f;
}
.md-prose[data-theme="academic"] :not(pre) > code {
  background: #f5f5f4;
  color: #9a3412;
}
.md-prose[data-theme="academic"] th { background: #f5f5f4; color: #1c1917; }
.md-prose[data-theme="academic"] td, .md-prose[data-theme="academic"] th { border-color: #d6d3d1; }

/* 主题 4：极客暗夜 */
.md-prose[data-theme="dark"] {
  background: #0f172a;
  color: #e2e8f0;
}
.md-prose[data-theme="dark"] h1,
.md-prose[data-theme="dark"] h2,
.md-prose[data-theme="dark"] h3,
.md-prose[data-theme="dark"] h4,
.md-prose[data-theme="dark"] strong {
  color: #f8fafc;
}
.md-prose[data-theme="dark"] h1,
.md-prose[data-theme="dark"] h2,
.md-prose[data-theme="dark"] hr {
  border-color: rgba(148, 163, 184, 0.22);
}
.md-prose[data-theme="dark"] a { color: #38bdf8; }
.md-prose[data-theme="dark"] blockquote {
  border-left-color: #8b5cf6;
  background: rgba(139, 92, 246, 0.12);
  color: #cbd5e1;
}
.md-prose[data-theme="dark"] :not(pre) > code {
  background: rgba(148, 163, 184, 0.16);
  color: #f472b6;
}
.md-prose[data-theme="dark"] .md-code-block {
  background: #020617;
  border-color: rgba(148, 163, 184, 0.22);
}
.md-prose[data-theme="dark"] pre { background: #020617; }
.md-prose[data-theme="dark"] th {
  background: rgba(255, 255, 255, 0.06);
  color: #f8fafc;
  border-color: rgba(148, 163, 184, 0.22);
}
.md-prose[data-theme="dark"] td {
  border-color: rgba(148, 163, 184, 0.2);
}
.md-prose[data-theme="dark"] tr:nth-child(even) td {
  background: rgba(255, 255, 255, 0.025);
}
`

/** 内置演示文档：完整展示 GFM 表格、任务清单、代码高亮与 KaTeX 数学公式 */
export const SAMPLE_MARKDOWN = `# 轻匣 Markdown 实时预览与导出

> **纯浏览器本地渲染** —— 支持 GFM 表格、任务清单、多语言代码语法高亮与 KaTeX 数学公式，写完即可一键导出 **独立 HTML** 或 **2× 高清长图**。

## 一、核心特性清单

- [x] **GFM 扩展语法**：表格对齐、删除线（~~旧方案~~）、任务列表与自动链接
- [x] **代码语法高亮**：内置 35+ 常用编程语言着色（TypeScript / Python / Bash / SQL 等）
- [x] **KaTeX 数学公式**：完美支持行内公式与独立块级公式
- [x] **4 套精致排版主题**：极简文档 / 公众号风 / 学术纸张 / 极客暗夜一键切换

## 二、GFM 对齐表格

| 导出格式 | 适用场景 | 离线可用 |
| :--- | :---: | ---: |
| **2× 高清长图 PNG** | 微信朋友圈、小红书、钉钉长图分享 | ✅ 支持 |
| **独立 HTML 文件** | 邮件附件、内网文档归档、博客迁移 | ✅ 支持 |
| **富文本复制** | 直接粘贴到微信公众号、飞书、Notion | ✅ 支持 |
| **打印 / 存为 PDF** | 正式报告归档与纸质打印 | ✅ 支持 |

## 三、代码语法高亮示例

\`\`\`typescript
/** 计算两点间欧氏距离 */
export function distance(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return Math.hypot(dx, dy)
}
\`\`\`

## 四、数学公式（KaTeX）

行内公式示例：质能方程 $E = mc^2$，等差数列前 $n$ 项和为 $\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$。

块级公式示例（正态分布概率密度函数）：

$$
f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} \\exp\\left(-\\frac{(x - \\mu)^2}{2\\sigma^2}\\right)
$$
`
