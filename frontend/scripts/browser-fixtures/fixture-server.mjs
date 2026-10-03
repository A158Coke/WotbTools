/**
 * 浏览器门禁共用的 Vite「应用夹具」服务器（browser-workspace-interaction / browser-armor-mobile 共用）。
 *
 * 起一个 in-process Vite dev server 伺服**真实前端应用**（router / AppShell / 全部 CSS），
 * 只把 Keycloak 网络边界替换掉（见 browser-fixtures/*-stub.js），让门禁可以在无后端、
 * 无网络、无资产包的环境里驱动真实页面。
 *
 * 本文件从 browser-workspace-interaction.mjs 原样搬出（单一来源，避免第二份分叉）。
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

const here = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(here, '..', '..')

/**
 * 只替换 Keycloak 网络边界。用 resolveId 插件而不是 `resolve.alias` 正则：
 * rollup alias 的 RegExp 分支只替换「匹配到的那一段」，先把已解析的真实文件定位出来
 * 再整体换掉，才不会拼出假路径。
 */
const AUTH_BOUNDARY_STUBS = new Map([
  [resolve(frontendRoot, 'src/composables/useAuth.js'), resolve(here, 'use-auth-stub.js')],
  [resolve(frontendRoot, 'src/composables/useBusinessUserBootstrap.js'), resolve(here, 'use-business-user-bootstrap-stub.js')],
])

/** Vite 的 module id 在 Windows 上是正斜杠、可能带盘符前导斜杠，且大小写不敏感；比较前统一规整。 */
function normalizeId(id) {
  const forward = id.replace(/\\/g, '/').replace(/^\/+/, '')
  return process.platform === 'win32' ? forward.toLowerCase() : forward
}

function authBoundaryStubPlugin() {
  const normalizedStubs = new Map([...AUTH_BOUNDARY_STUBS].map(([from, to]) => [normalizeId(from), to]))
  return {
    name: 'wotb-browser-fixture-auth-boundary',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      // 只接管「应用内部的相对 import」，不碰裸模块名（vue / vue-router / keycloak-js 等）。
      if (!importer || !source.startsWith('.')) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved) return null
      return normalizedStubs.get(normalizeId(resolved.id.split('?')[0])) || null
    },
  }
}

export async function startFixtureServer() {
  const server = await createServer({
    configFile: false,
    root: frontendRoot,
    logLevel: 'error',
    plugins: [authBoundaryStubPlugin(), vue()],
    // vite.config.js 的 define 只在读取项目配置时注入；本实例不读 configFile，需显式提供。
    define: { __BUILD_COMMIT__: '"browser-fixture"', __BUILD_TIME__: '"browser-fixture"' },
    // 与 vite.config.js 一致：logo / icon / silent-check-sso 等 public 资源来自 common/assets。
    publicDir: resolve(frontendRoot, '../common/assets'),
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  })
  await server.listen()
  const url = server.resolvedUrls?.local?.[0]
  if (!url) throw new Error('fixture Vite server did not publish a local URL')
  return { server, origin: url.replace(/\/$/, '') }
}
