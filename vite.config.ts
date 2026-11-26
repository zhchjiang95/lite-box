import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PWA：预缓存应用外壳，支持离线使用与“安装到桌面 / 添加到主屏幕”
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'favicon.ico',
        'apple-touch-icon.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'pwa-maskable-512x512.png',
        'og-image.png',
        'pwa-screenshot-mobile.png',
        'robots.txt',
      ],
      manifest: {
        id: '/',
        name: '轻匣 · 本地工具箱',
        short_name: '轻匣',
        description: '100% 浏览器本地处理的在线百宝工具箱，文件不上传，快速、安全、可离线。',
        lang: 'zh-CN',
        dir: 'ltr',
        theme_color: '#0b0b12',
        background_color: '#0b0b12',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        scope: '/',
        start_url: '/?source=pwa',
        categories: ['utilities', 'productivity', 'photo'],
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
        screenshots: [
          {
            src: '/og-image.png',
            sizes: '1200x630',
            type: 'image/png',
            form_factor: 'wide',
            label: '轻匣 LiteBox 桌面端百宝工具箱',
          },
          {
            src: '/pwa-screenshot-mobile.png',
            sizes: '750x1334',
            type: 'image/png',
            form_factor: 'narrow',
            label: '轻匣 LiteBox 移动端百宝工具箱',
          },
        ],
        shortcuts: [
          {
            name: '身份证 A4 打印',
            short_name: '身份证打印',
            url: '/tools/id-card-print',
            icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: '图片压缩',
            short_name: '图片压缩',
            url: '/tools/image-compress',
            icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'PDF 合并与拆分',
            short_name: 'PDF 合并拆分',
            url: '/tools/pdf-merge-split',
            icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: '演示黑板',
            short_name: '演示黑板',
            url: '/tools/blackboard',
            icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'],
        // heic-to WASM 解码器体积较大（>3MB），排除首屏预缓存，改用运行时按需缓存
        globIgnores: ['**/heic-to-*.js'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/heic-to-.*\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'heic-decoder-cache',
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\//, /^\/healthz$/],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 开发期统一将局域网信令 WebSocket 与所有 /api/* 业务接口代理到独立的 server/ 后端服务
    proxy: {
      '/ws/lan': {
        target: 'ws://127.0.0.1:3000',
        ws: true,
        changeOrigin: true,
      },
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // 将基础依赖拆为独立 chunk，利于长期缓存
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/[\\/](react|react-dom|scheduler|react-router)[\\/]/.test(id)) return 'react'
          if (/[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return 'motion'
        },
      },
    },
  },
})
