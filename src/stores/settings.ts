import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'

interface SettingsState {
  theme: Theme
  /** 桌面端侧栏是否折叠 */
  sidebarCollapsed: boolean
  /** 收藏的工具 ID */
  favorites: string[]
  /** 最近使用（最新在前） */
  recents: string[]
  setTheme: (t: Theme) => void
  toggleSidebar: () => void
  toggleFavorite: (id: string) => void
  addRecent: (id: string) => void
  clearRecents: () => void
}

const MAX_RECENTS = 12

/** 全局设置（持久化到 localStorage） */
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      sidebarCollapsed: false,
      favorites: [],
      recents: [],
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleFavorite: (id) =>
        set((s) => ({
          favorites: s.favorites.includes(id) ? s.favorites.filter((f) => f !== id) : [id, ...s.favorites],
        })),
      addRecent: (id) =>
        set((s) => ({ recents: [id, ...s.recents.filter((r) => r !== id)].slice(0, MAX_RECENTS) })),
      clearRecents: () => set({ recents: [] }),
    }),
    { name: 'litebox-settings', version: 1 },
  ),
)

/** 命令面板（搜索）的开关状态，不持久化 */
interface UIState {
  commandOpen: boolean
  setCommandOpen: (open: boolean) => void
}

export const useUI = create<UIState>()((set) => ({
  commandOpen: false,
  setCommandOpen: (commandOpen) => set({ commandOpen }),
}))

