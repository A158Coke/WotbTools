import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// dev 时把 /api 代理到本地后端; 生产由 nginx 代理(在线)或同源(离线)。
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8087', changeOrigin: true }
    }
  },
  build: { outDir: 'dist' }
})
