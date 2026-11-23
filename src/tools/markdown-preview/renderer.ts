/**
 * Markdown 渲染与多格式导出引擎
 * - marked（GFM 表格 / 任务列表 / 换行）+ highlight.js/lib/common（语法高亮）+ KaTeX（行内/块级数学公式）
 * - DOMParser 后置 XSS 清洗，安全渲染任意粘贴的 Markdown
 * - 支持独立 HTML 导出、html-to-image 2× 高清长图 PNG、富文本复制与隐藏 iframe 打印
 */

import hljs from 'highlight.js/lib/common'
import { toBlob } from 'html-to-image'
import katex from 'katex'
import { Marked, type TokenizerAndRendererExtension } from 'marked'
import { MARKDOWN_PROSE_CSS, MD_THEMES, type MdThemeId } from './themes'

const escapeHtml = (str: string) =>
  str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** 块级数学公式扩展：$$ ... $$ */
const blockMathExtension: TokenizerAndRendererExtension = {
  name: 'blockMath',
  level: 'block',
  start(src) {
    return src.match(/\$\$/)?.index
  },
  tokenizer(src) {
    const match = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src)
    if (!match) return undefined
    return {
      type: 'blockMath',
      raw: match[0],
      text: match[1].trim(),
    }
  },
  renderer(token) {
    const html = katex.renderToString(String(token.text ?? ''), {
      displayMode: true,
      throwOnError: false,
      strict: false,
    })
    return `<div class="md-math-block">${html}</div>\n`
  },
}

/** 行内数学公式扩展：$ ... $（避开货币金额如 $100 与空白起止） */
const inlineMathExtension: TokenizerAndRendererExtension = {
  name: 'inlineMath',
  level: 'inline',
  start(src) {
    return src.match(/(?<!\\)\$(?!\$)/)?.index
  },
  tokenizer(src) {
    const match = /^\$(?!\s|\$)([^$\n]+?)(?<!\s|\\)\$(?!\d)/.exec(src)
    if (!match) return undefined
    return {
      type: 'inlineMath',
      raw: match[0],
      text: match[1].trim(),
    }
  },
  renderer(token) {
    return katex.renderToString(String(token.text ?? ''), {
      displayMode: false,
      throwOnError: false,
      strict: false,
    })
  },
}

const mdEngine = new Marked({
  gfm: true,
  breaks: true,
})

mdEngine.use({
  extensions: [blockMathExtension, inlineMathExtension],
  renderer: {
    code({ text, lang }) {
      const cleanLang = (lang || '').trim().split(/\s+/)[0].toLowerCase()
      const hasLang = Boolean(cleanLang && hljs.getLanguage(cleanLang))
      const highlighted = hasLang
        ? hljs.highlight(text, { language: cleanLang, ignoreIllegals: true }).value
        : escapeHtml(text)
      const badge = cleanLang || 'text'
      return `<div class="md-code-block"><div class="md-code-head"><span class="md-code-dots"><i style="background:#ef4444"></i><i style="background:#f59e0b"></i><i style="background:#22c55e"></i></span><span>${escapeHtml(badge)}</span></div><pre><code class="hljs${hasLang ? ` language-${escapeHtml(cleanLang)}` : ''}">${highlighted}</code></pre></div>\n`
    },
  },
})

/** 轻量 XSS 清洗：移除危险标签与内联事件处理器，保留 KaTeX / 语法高亮 / GFM 安全标签 */
function sanitizeHtml(dirty: string): string {
  const doc = new DOMParser().parseFromString(dirty, 'text/html')
  const blocked = doc.body.querySelectorAll('script, iframe, object, embed, form, meta, base')
  blocked.forEach((el) => el.remove())

  const all = doc.body.querySelectorAll('*')
  all.forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      const val = attr.value.trim().toLowerCase()
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name)
      } else if ((name === 'href' || name === 'src') && val.startsWith('javascript:')) {
        el.removeAttribute(attr.name)
      }
    }
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank')
      el.setAttribute('rel', 'noreferrer noopener')
    }
  })

  return doc.body.innerHTML
}

/** 渲染 Markdown 为安全的富文本 HTML */
export function renderMarkdownHtml(markdown: string): string {
  if (!markdown.trim()) return ''
  const rawHtml = mdEngine.parse(markdown) as string
  return sanitizeHtml(rawHtml)
}

/** 提取文档字数与预计阅读时间统计 */
export function computeMarkdownStats(markdown: string) {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`~\-\[\]()]/g, ' ')
    .trim()
  const cjk = (plain.match(/[\u4e00-\u9fa5]/g) ?? []).length
  const words = (plain.replace(/[\u4e00-\u9fa5]/g, ' ').match(/[A-Za-z0-9_]+/g) ?? []).length
  const totalWords = cjk + words
  const readMin = Math.max(1, Math.ceil(totalWords / 320))
  return {
    chars: markdown.length,
    lines: markdown ? markdown.split('\n').length : 0,
    totalWords,
    readMin,
  }
}

/** 提取首个一级标题作为导出默认文件名 */
export function extractDocTitle(markdown: string): string {
  const m = /^#\s+(.+)$/m.exec(markdown)
  return m ? m[1].replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40) || 'markdown-doc' : 'markdown-doc'
}

/** 构造独立可离线浏览的完整 HTML 文件 */
export function buildStandaloneHtml(renderedHtml: string, themeId: MdThemeId, title: string): string {
  const theme = MD_THEMES.find((t) => t.id === themeId) ?? MD_THEMES[0]
  const pageBg = themeId === 'dark' ? '#020617' : '#f1f5f9'
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css" />
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px 16px; background: ${pageBg}; }
    .page-sheet {
      max-width: 820px;
      margin: 0 auto;
      padding: 44px 48px;
      border-radius: 16px;
      background: ${theme.bg};
      box-shadow: 0 12px 40px rgba(15, 23, 42, 0.12);
    }
    @media (max-width: 640px) {
      body { padding: 12px 8px; }
      .page-sheet { padding: 24px 20px; border-radius: 12px; }
    }
    @media print {
      body { background: #fff; padding: 0; }
      .page-sheet { box-shadow: none; padding: 0; max-width: none; }
    }
    ${MARKDOWN_PROSE_CSS}
  </style>
</head>
<body>
  <article class="page-sheet md-prose" data-theme="${themeId}">
    ${renderedHtml}
  </article>
</body>
</html>`
}

/** 将预览 DOM 节点导出为 2× 高清长图 PNG */
export async function exportMarkdownLongPng(node: HTMLElement, themeId: MdThemeId): Promise<Blob> {
  const theme = MD_THEMES.find((t) => t.id === themeId) ?? MD_THEMES[0]
  const blob = await toBlob(node, {
    pixelRatio: 2,
    backgroundColor: theme.bg,
    cacheBust: true,
    style: {
      margin: '0',
    },
  })
  if (!blob) throw new Error('长图渲染失败，请尝试缩短文档长度或刷新后重试')
  return blob
}

/** 调用隐藏 iframe 打印当前排版（可直接存为 PDF） */
export function printMarkdownDoc(renderedHtml: string, themeId: MdThemeId, title: string) {
  const html = buildStandaloneHtml(renderedHtml, themeId, title)
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.appendChild(iframe)

  const cleanup = () => iframe.remove()
  const doc = iframe.contentDocument
  if (!doc || !iframe.contentWindow) {
    cleanup()
    throw new Error('无法唤起打印窗口')
  }
  doc.open()
  doc.write(html)
  doc.close()

  const win = iframe.contentWindow
  win.addEventListener('afterprint', cleanup, { once: true })
  window.setTimeout(cleanup, 60_000)
  window.setTimeout(() => {
    win.focus()
    win.print()
  }, 180)
}
