import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

// dev 时把 /api 代理到本地后端；生产由 nginx 反向代理。
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    // 允许 dev server 读取仓库根的共享 JSON (common/map_names.json 等)。
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: 'http://localhost:8087', changeOrigin: true }
    }
  },
  publicDir: '../common/assets',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      }
    }
  }
})
