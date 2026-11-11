// 一次性：真实 vite.config.js（含 WOTB_ASSET_PROXY 资产代理）+ 仓库已有的 Keycloak 边界替身（仅换鉴权，不动生产源码）
const { createServer } = await import('file:///D:/Program/WotbTools/.claude/worktrees/designer-tool-7fb949/frontend/node_modules/vite/dist/node/index.js')
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../frontend')
const fx = resolve(root, 'scripts/browser-fixtures')
const norm = (id) => id.replaceAll(String.fromCharCode(92), '/').replace(/^\/+/, '').toLowerCase()
const stubs = new Map([
  [norm(resolve(root, 'src/composables/useAuth.ts')), resolve(fx, 'use-auth-stub.js')],
  [norm(resolve(root, 'src/composables/useBusinessUserBootstrap.ts')), resolve(fx, 'use-business-user-bootstrap-stub.js')],
])
const plugin = {
  name: 'perf-auth-stub', enforce: 'pre',
  async resolveId(source, importer, options) {
    if (!importer || !source.startsWith('.')) return null
    const r = await this.resolve(source, importer, { ...options, skipSelf: true })
    return r ? stubs.get(norm(r.id.split('?')[0])) || null : null
  },
}
const port = Number(process.env.PORT || 5190)
const server = await createServer({ root, configFile: resolve(root, 'vite.config.js'), plugins: [plugin], server: { host: '127.0.0.1', port, strictPort: true } })
await server.listen()
console.log('ready', server.resolvedUrls.local)
