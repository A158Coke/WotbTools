import { PRODUCTION_API_ORIGIN } from './src/platform/runtime.js'
import { createHash } from 'node:crypto'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { execSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NATIVE_AUTH_CAPABILITY,
  NATIVE_AUTH_CHANGED_GLOBAL,
  NATIVE_AUTH_METHODS,
  SUPPORTED_NATIVE_BRIDGE_VERSIONS,
} from './src/platform/nativeBridgeContract.js'

const configDirectory = fileURLToPath(new URL('.', import.meta.url))
const DEV_PROXY_TARGETS = Object.freeze({
  local: 'http://localhost:8087',
  'production-remote': 'https://wotbtools.com',
})
const LOCAL_3D_ASSET_DIR = resolve(configDirectory, '../common/assets/map-3d-local')

function assetProxyTarget() {
  const target = (process.env.WOTB_ASSET_PROXY || '').trim()
  return target ? target.replace(/\/+$/, '') : ''
}

export function agentWasmIdentity() {
  const path = resolve(configDirectory, '../deploy/agent/source.json')
  if (!existsSync(path)) {
    throw new Error(`Agent WASM identity is missing: ${path} (deploy/agent/source.json is the SSOT)`)
  }
  const pin = JSON.parse(readFileSync(path, 'utf8'))
  const commit = typeof pin?.ref === 'string' ? pin.ref.trim() : ''
  const release = typeof pin?.artifact?.release === 'string' ? pin.artifact.release.trim() : ''
  if (!commit || !release) {
    throw new Error('deploy/agent/source.json must declare both ref and artifact.release')
  }
  return { commit, release }
}

export function devProxyTarget(mode) {
  return DEV_PROXY_TARGETS[mode] || DEV_PROXY_TARGETS.local
}

export function assertLocal3dDistributionBoundary(command, localAssetsExist) {
  if (command === 'build' && localAssetsExist) {
    throw new Error(
      'Production build blocked: common/assets/map-3d-local contains local client-derived map height data. '
      + 'Remove that directory before building; these assets are DEV/local-research only and must not be redistributed.'
    )
  }
}

export const WASM_DEV_ROOT = resolve(configDirectory, '../common/assets/wasm')

/**
 * 解算 `/wasm/*` dev 请求到制品根内的真实文件。
 *
 * 安全性（dev server 可能被 `vite --host` / Remote Link / 容器端口 / LAN 暴露，`req.url`
 * 是不可信输入）：
 * <ul>
 *   <li>malformed percent-encoding 一律 400 fail closed，不让 URIError 打断 Vite 请求链；</li>
 *   <li>containment 用 `relative()` + `isAbsolute()` 判定，不做字符串前缀比较——前缀比较在
 *       `..` 与 Win32 大小写/分隔符差异下会被绕过；</li>
 *   <li>拒绝目录（`isFile()`）——目录会被 `createReadStream` 报 EISDIR，且不应有任何列举行为；</li>
 *   <li>symlink：`statSync` 会跟随链接，因此再取 `realpathSync` 对**解析后**的路径做一次
 *       包含判定；制品根内不需要 symlink，指向根外的链接一律拒绝。</li>
 * </ul>
 *
 * 只有 `.js` 归本中间件管（其余交给 Vite 常规处理）；返回 `{ ok: false, reason: 'not-js' }`
 * 时调用方应 `next()`，其余拒绝项由本中间件直接给出状态码。
 *
 * @returns {{ ok: true, file: string } | { ok: false, status: number, reason: string }}
 */
export function resolveWasmDevFile(requestUrl, wasmRoot = WASM_DEV_ROOT) {
  const rawPath = (requestUrl || '').split('?')[0]
  let rel
  try {
    rel = decodeURIComponent(rawPath).replace(/^\/+/, '')
  } catch {
    return { ok: false, status: 400, reason: 'malformed-uri' }
  }
  if (!rel.endsWith('.js')) {
    return { ok: false, status: 404, reason: 'not-js' }
  }
  const file = resolve(wasmRoot, rel)
  const relPath = relative(wasmRoot, file)
  if (relPath === '' || relPath === '..' || relPath.startsWith(`..${sep}`) || isAbsolute(relPath)) {
    return { ok: false, status: 403, reason: 'escape' }
  }
  let realFile
  let realRoot
  try {
    if (!statSync(file).isFile()) {
      return { ok: false, status: 404, reason: 'not-a-file' }
    }
    realFile = realpathSync(file)
    realRoot = realpathSync(wasmRoot)
  } catch {
    return { ok: false, status: 404, reason: 'missing' }
  }
  const relReal = relative(realRoot, realFile)
  if (relReal === '' || relReal === '..' || relReal.startsWith(`..${sep}`) || isAbsolute(relReal)) {
    return { ok: false, status: 403, reason: 'symlink-escape' }
  }
  return { ok: true, file: realFile }
}

function resolveBuildTime() {
  const epoch = Number(process.env.SOURCE_DATE_EPOCH)
  if (Number.isFinite(epoch) && epoch > 0) return new Date(epoch * 1000).toISOString()
  try {
    const commitTime = execSync('git log -1 --format=%cI', { encoding: 'utf-8' }).trim()
    if (commitTime && Number.isFinite(Date.parse(commitTime))) return new Date(commitTime).toISOString()
  } catch {
    // 无 git 上下文：只能回落 wall-clock（见上方说明）。
  }
  return new Date().toISOString()
}

export function buildIdentity() {
  const fromEnv = process.env.BUILD_COMMIT
  let commit = fromEnv?.trim() || ''
  if (!commit) {
    try {
      commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
    } catch {
      // 无 git 上下文（如发布 tarball）时保持 unknown。
    }
  }
  return {
    buildCommit: commit || 'unknown',
    buildTime: resolveBuildTime(),
  }
}

export function nativeRuntimeIdentity() {
  return {
    supportedBridgeVersions: [...SUPPORTED_NATIVE_BRIDGE_VERSIONS],
    nativeAuthCapability: NATIVE_AUTH_CAPABILITY,
    authChangedGlobal: NATIVE_AUTH_CHANGED_GLOBAL,
    nativeAuthMethods: Object.values(NATIVE_AUTH_METHODS).sort(),
  }
}

export function androidCsp(html) {
  const hashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script(?:[ \t\n\r\f/][^>]*)?>/gi)]
    .filter(match => match[1].trim())
    .map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`)
  return [
    "default-src 'none'", `script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}`,
    "style-src 'self' 'unsafe-inline'", `img-src 'self' data: blob: ${PRODUCTION_API_ORIGIN}`,
    `connect-src 'self' blob: ${PRODUCTION_API_ORIGIN}`, "font-src 'self' data:",
    "worker-src 'self' blob:", "media-src 'self' blob:", "object-src 'none'",
    "base-uri 'self'", "form-action 'none'",
  ].join('; ')
}

const identity = buildIdentity()
const nativeRuntime = nativeRuntimeIdentity()

export default defineConfig(({ command, mode }) => {
  assertLocal3dDistributionBoundary(command, existsSync(LOCAL_3D_ASSET_DIR))
  const agent = agentWasmIdentity()
  const outDir = resolve(configDirectory, mode === 'android' ? 'dist-android' : 'dist')
  return {
    test: { testTimeout: 10000, hookTimeout: 20000 },
    plugins: [
      vue(),
      ...(mode === 'android' ? [{
        name: 'wotb-android-csp',
        transformIndexHtml: {
          order: 'post',
          handler(html) {
            return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: androidCsp(html) }, injectTo: 'head-prepend' }]
          },
        },
      }] : []),
      // `import()` 包成 `__vite__injectQuery(url, 'import')`（**`@vite-ignore` 不阻止这一步**），
      {
        name: 'local-dev-public-wasm-as-module',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use('/wasm', (req, res, next) => {
            const resolved = resolveWasmDevFile(req.url)
            if (!resolved.ok) {
              if (resolved.reason === 'not-js') return next()
              res.statusCode = resolved.status
              res.end(resolved.status === 400 ? 'Bad Request' : resolved.status === 403 ? 'Forbidden' : 'Not Found')
              return
            }
            res.setHeader('Content-Type', 'text/javascript')
            res.setHeader('Cache-Control', 'no-cache')
            const stream = createReadStream(resolved.file)
            stream.on('error', () => {
              if (!res.headersSent) res.statusCode = 500
              res.end()
            })
            stream.pipe(res)
          })
        },
      },
      {
        name: 'wotb-build-identity',
        apply: 'build',
        closeBundle() {
          mkdirSync(outDir, { recursive: true })
          writeFileSync(resolve(outDir, 'version.json'),
            JSON.stringify({
              buildCommit: identity.buildCommit,
              buildTime: identity.buildTime,
              nativeRuntime,
            }, null, 2) + '\n')
        },
      },
    ],
    define: {
      __BUILD_COMMIT__: JSON.stringify(identity.buildCommit),
      __BUILD_TIME__: JSON.stringify(identity.buildTime),
      __AGENT_WASM_COMMIT__: JSON.stringify(agent.commit),
      __AGENT_WASM_RELEASE__: JSON.stringify(agent.release),
    },
    server: {
      port: 5173,
      fs: { allow: ['..'] },
      watch: {
        ignored: ['**/.*.tmpdir/**', '**/*.tmp'],
      },
      proxy: {
        '/api': {
          target: devProxyTarget(mode),
          changeOrigin: true,
          secure: mode === 'production-remote',
        },
        ...(mode === 'production-remote' ? Object.fromEntries(['/sponsor-config.json', '/sponsor-assets'].map(path => [path, {
          target: devProxyTarget(mode),
          changeOrigin: true,
          secure: true,
        }])) : {}),
        ...(assetProxyTarget() ? {
          '/__assets': {
            target: assetProxyTarget(),
            changeOrigin: true,
            secure: true,
            rewrite: (path) => path.replace(/^\/__assets/, ''),
          },
        } : {}),
      }
    },
    worker: { format: 'es' },
    publicDir: '../common/assets',
    build: {
      outDir,
      manifest: true,
      assetsInlineLimit: 0,
      rollupOptions: {
        input: {
          main: resolve(configDirectory, 'index.html')
        }
      }
    }
  }
})
