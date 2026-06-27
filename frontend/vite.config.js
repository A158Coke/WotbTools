import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

function extendedAlias() {
  return {
    name: 'extended-alias',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/extended') req.url = '/extended.html'
        next()
      })
    }
  }
}

// dev 时把 /api 代理到本地后端; 生产由 nginx 代理(在线)或同源(离线)。
export default defineConfig({
  plugins: [vue(), extendedAlias()],
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
        main: resolve(__dirname, 'index.html'),
        extended: resolve(__dirname, 'extended.html')
      }
    }
  }
})