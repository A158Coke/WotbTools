import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

const here = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(here, '..', '..')

const AUTH_BOUNDARY_STUBS = new Map([
  [resolve(frontendRoot, 'src/composables/useAuth.ts'), resolve(here, 'use-auth-stub.js')],
  [resolve(frontendRoot, 'src/composables/useBusinessUserBootstrap.ts'), resolve(here, 'use-business-user-bootstrap-stub.js')],
])

for (const from of [...AUTH_BOUNDARY_STUBS.keys()]) {
  if (!existsSync(from)) throw new Error(`Browser fixture stub source does not exist: ${from}`)
}

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
      if (!importer || !source.startsWith('.')) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved) return null
      return normalizedStubs.get(normalizeId(resolved.id.split('?')[0])) || null
    },
  }
}

export async function startFixtureServer({ middleware, allowedHosts, plugins = [], port = 0 } = {}) {
  const server = await createServer({
    configFile: false,
    root: frontendRoot,
    cacheDir: resolve(tmpdir(), 'wotb-browser-fixtures', `${process.pid}-${port}`),
    logLevel: 'error',
    plugins: [...plugins, authBoundaryStubPlugin(), vue(), {
      name: 'wotb-browser-fixture-http-boundary',
      configureServer(instance) {
        if (middleware) instance.middlewares.use(middleware)
        instance.middlewares.use((request, response, next) => {
          const path = request.url?.split('?')[0]
          if (request.method !== 'GET' || !['/api/health', '/api/recommendations/categories'].includes(path)) { next(); return }
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify(path === '/api/health'
            ? { status: 'ok', tanks: 1, capabilities: ['recommendations-v1'] }
            : [{ id: 1, name: 'Creator fixture', type: 'UP' }]))
        })
      },
    }],
    define: { __BUILD_COMMIT__: '"browser-fixture"', __BUILD_TIME__: '"browser-fixture"' },
    publicDir: resolve(frontendRoot, '../common/assets'),
    server: { host: '127.0.0.1', port, strictPort: port !== 0, allowedHosts },
  })
  await server.listen()
  const url = server.resolvedUrls?.local?.[0]
  if (!url) throw new Error('fixture Vite server did not publish a local URL')
  return { server, origin: url.replace(/\/$/, '') }
}
