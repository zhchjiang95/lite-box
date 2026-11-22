import { useEffect, useState } from 'react'
import { useSettings } from '@/stores/settings'

/** 监听媒体查询 */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && matchMedia(query).matches)
  useEffect(() => {
    const mql = matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** 是否为桌面宽度（≥ lg） */
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)')

/** 是否支持精确指针（鼠标），用于决定是否启用悬停类动效 */
export const useFinePointer = () => useMediaQuery('(hover: hover) and (pointer: fine)')

/** 同步主题到 html.dark */
export function useThemeEffect() {
  const theme = useSettings((s) => s.theme)
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  useEffect(() => {
    const dark = theme === 'dark' || (theme === 'system' && systemDark)
    document.documentElement.classList.toggle('dark', dark)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0b12' : '#f7f7fb')
  }, [theme, systemDark])
}

/** 全局快捷键 */
export function useHotkey(key: string, handler: (e: KeyboardEvent) => void, withMod = true) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== key.toLowerCase()) return
      if (withMod && !(e.metaKey || e.ctrlKey)) return
      handler(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [key, handler, withMod])
}

