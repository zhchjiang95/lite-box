/**
 * 按需异步注入精选 Google Fonts 艺术字体（仅进入「摄影作品分享框」时加载）
 * 说明：离线或受限网络环境下会自动平滑降级至系统高品质衬线/楷体/等宽字体，绝不阻塞页面渲染。
 */

const FONT_LINK_ID = 'litebox-photo-art-fonts'
const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&family=Cinzel:wght@500;700&family=Courier+Prime:ital,wght@0,400;0,700;1,400&family=Playfair+Display:ital,wght@0,600;0,700;1,500&family=Space+Mono:wght@400;700&display=swap'

let injected = false

export function ensureArtFontsLoaded(onReady?: () => void) {
  if (typeof document === 'undefined') return
  if (!injected && !document.getElementById(FONT_LINK_ID)) {
    injected = true
    const link = document.createElement('link')
    link.id = FONT_LINK_ID
    link.rel = 'stylesheet'
    link.href = GOOGLE_FONTS_URL
    link.onload = () => {
      document.fonts?.ready.then(() => onReady?.()).catch(() => {})
    }
    document.head.appendChild(link)
  } else {
    document.fonts?.ready.then(() => onReady?.()).catch(() => {})
  }
}
