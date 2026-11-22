import { createBrowserRouter } from 'react-router'
import { AppLayout } from '@/components/layout/AppLayout'
import Home from '@/pages/Home'
import NotFound from '@/pages/NotFound'

/** 路由：首页同步加载保证首屏，其余页面按需懒加载 */
export const router = createBrowserRouter([
  {
    path: '/',
    Component: AppLayout,
    children: [
      { index: true, Component: Home },
      { path: 'categories', lazy: async () => ({ Component: (await import('@/pages/Category')).CategoriesPage }) },
      { path: 'category/:id', lazy: async () => ({ Component: (await import('@/pages/Category')).CategoryPage }) },
      { path: 'favorites', lazy: async () => ({ Component: (await import('@/pages/Favorites')).default }) },
      { path: 'tools/:id', lazy: async () => ({ Component: (await import('@/pages/ToolPage')).default }) },
      { path: '*', Component: NotFound },
    ],
  },
])

