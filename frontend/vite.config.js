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

// dev 时把 /api 代理到选定的后端；生产 bundle 由 nginx 反向代理。
const configDirectory = fileURLToPath(new URL('.', import.meta.url))
const DEV_PROXY_TARGETS = Object.freeze({
  local: 'http://localhost:8087',
  'production-remote': 'https://wotbtools.com',
})
const LOCAL_3D_ASSET_DIR = resolve(configDirectory, '../common/assets/map-3d-local')

/**
 * 本机验收用的**按需**资产代理：`WOTB_ASSET_PROXY=<remote asset origin>` 时把 `/__assets/*`
 * 透传到该 origin（去掉前缀）。
 *
 * 为什么需要它：浏览器 v1 的资产源是远端 origin（`?assets=<url>`），而生产 COS 的 CORS
 * 白名单不含 localhost —— 于是本机打开 3D 回放必然被浏览器拦下（`connect-src`/CORS），
 * 与代码无关。代理让请求从同源 dev server 出去，浏览器不再做跨域判定。
 *
 * **不设该环境变量时不注册任何代理**，默认 `npm run dev` 行为与本改动前完全一致；
 * 代理只存在于 dev server（`apply: 'serve'` 语义，不进 build 产物）。
 */
function assetProxyTarget() {
  const target = (process.env.WOTB_ASSET_PROXY || '').trim()
  return target ? target.replace(/\/+$/, '') : ''
}

/**
 * Agent WASM identity SSOT：`deploy/agent/source.json`（repo 相对路径在 Docker 里
 * 通过 `COPY deploy/agent/source.json /deploy/agent/source.json` 保持同一布局）。
 *
 * build 期把它固化进 bundle（`__AGENT_WASM_COMMIT__` / `__AGENT_WASM_RELEASE__`），
 * 运行期据此拼出 commit-addressed URL `/wasm/<ref>/…`——同一个 frontend build 只能
 * 加载自己 pin 的 Agent。产物缺失时 build 直接失败（fail closed），不静默降级成
 * 「无 pin 的运行时」。
 */
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

/**
 * Client-derived heightfield assets are a local research input only. `publicDir`
 * is shared with local dev, so a generated map-3d-local directory would otherwise
 * be copied into dist during a production build. Fail closed instead of relying
 * on .gitignore, which only controls Git tracking and cannot protect build output.
 */
export function assertLocal3dDistributionBoundary(command, localAssetsExist) {
  if (command === 'build' && localAssetsExist) {
    throw new Error(
      'Production build blocked: common/assets/map-3d-local contains local client-derived map height data. '
      + 'Remove that directory before building; these assets are DEV/local-research only and must not be redistributed.'
    )
  }
}

/** dev middleware 唯一允许读取的目录：Agent WASM 制品根（`publicDir` 下的 `/wasm/<ref>/…`）。 */
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

/** Build identity：生产 bundle 可精确对应 git commit + 构建时间（见 /version.json 与 console 输出）。
 * 优先取 Docker 构建参数 BUILD_COMMIT（CI 传入，Docker 上下文无 .git 无法自行 rev-parse），
 * 本地构建再 fallback 到 git rev-parse；两者皆无时降级 unknown，不阻断构建。 */
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
    buildTime: new Date().toISOString(),
  }
}

/**
 * 生产前端的 native 运行面：直接取自 `src/platform/nativeBridgeContract.js`（FE 侧 bridge
 * 契约声明的 SSOT），因此它不可能与 bundle 里真正运行的常量漂移。
 *
 * Android release 从 immutable APK 内的 bundle manifest 核验相同声明，
 * 不依赖线上 Vue 部署的 commit。Web version.json 保留这份诊断信息。
 */
export function nativeRuntimeIdentity() {
  return {
    supportedBridgeVersions: [...SUPPORTED_NATIVE_BRIDGE_VERSIONS],
    nativeAuthCapability: NATIVE_AUTH_CAPABILITY,
    authChangedGlobal: NATIVE_AUTH_CHANGED_GLOBAL,
    nativeAuthMethods: Object.values(NATIVE_AUTH_METHODS).sort(),
  }
}

/** Hash existing bootstrap scripts; Android has one reviewed network origin. */
export function androidCsp(html) {
  const hashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .filter(match => match[1].trim())
    .map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`)
  return [
    "default-src 'none'", `script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}`,
    "style-src 'self' 'unsafe-inline'", `img-src 'self' data: blob: ${PRODUCTION_API_ORIGIN}`,
    `connect-src 'self' ${PRODUCTION_API_ORIGIN}`, "font-src 'self' data:",
    "worker-src 'self' blob:", "media-src 'self' blob:", "object-src 'none'",
    "base-uri 'self'", "form-action 'none'",
  ].join('; ')
}

const identity = buildIdentity()
const nativeRuntime = nativeRuntimeIdentity()

export default defineConfig(({ command, mode }) => {
  assertLocal3dDistributionBoundary(command, existsSync(LOCAL_3D_ASSET_DIR))
  // Agent identity 在每个 command 下都解析：dev server 也要把 /wasm/<ref>/ 拼对
  // （Vite dev 直接伺服 publicDir，产物由 scripts/fetch-agent-wasm.sh 落位）。
  const agent = agentWasmIdentity()
  // Android local-first runtime target（PR B §6）：**同一份产品源码**，只是输出目录不同，
  // 由 frontend/scripts/build-android-bundle.mjs 复制进 APK assets（产物不进源码树）。
  // 禁止为 Android 建第二套 frontend 源码树。
  const outDir = resolve(configDirectory, mode === 'android' ? 'dist-android' : 'dist')
  return {
    plugins: [
      vue(),
      // Android 2D 地图派生（Phase 10）：canonical 底图（src/assets/maps，Web 构建继续用）
      // 在 build:android 里被 Pillow 派生成更小的同比例副本（dist-android-maps/），
      // 这里把 android 模式下的地图 import 重定向到派生物——不改源码 import，也不维护
      // 第二份人工源。派生物缺失 = 构建失败（fail closed，见 scripts/build-android-map-assets.mjs）。
      ...(mode === 'android' ? [{
        name: 'wotb-android-map-derivatives',
        enforce: 'pre',
        resolveId(source) {
          const match = /(?:^|\/)assets\/maps\/([^/]+\.webp)$/.exec(source)
          if (!match) return null
          const derived = resolve(configDirectory, 'dist-android-maps', match[1])
          if (!existsSync(derived)) {
            throw new Error(
              `android map derivative missing: ${match[1]} —— 先运行 npm run build:android（内部会生成 dist-android-maps/）`,
            )
          }
          return derived
        },
      }] : []),
      ...(mode === 'android' ? [{
        name: 'wotb-android-csp',
        transformIndexHtml: {
          order: 'post',
          handler(html) {
            return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: androidCsp(html) }, injectTo: 'head-prepend' }]
          },
        },
      }] : []),
      // dev-only 修复：把 `/wasm/*.js` 按静态模块伺服，绕开 Vite 对 publicDir 里 .js 的拦截。
      //
      // 缺陷：`publicDir` 指向 root 之外的 `../common/assets`；importAnalysis 会把动态
      // `import()` 包成 `__vite__injectQuery(url, 'import')`（**`@vite-ignore` 不阻止这一步**），
      // dev server 随即把带 `?import` 的请求判定为「源码 import」，对 publicDir 里的 .js 直接抛
      // "should not be imported from source code"。实测（2026-10-03，Vite 6.4.3）：
      //   `/wasm/<ref>/wotb_replay_wasm.js`          → 200 text/javascript
      //   `/wasm/<ref>/wotb_replay_wasm.js?import`   → **500**（修前）
      // 于是 dev 下 3D 回放 / 射击复现拿不到引擎（AgentWasm 懒加载，选中回放文件时才触发）。
      //
      // 修法：在 transform 之前按静态文件伺服，与构建产物行为一致（publicDir 原样拷进 dist、
      // 按静态文件取、query 被忽略）。`apply: 'serve'` ⇒ 只影响 dev server，`npm run build`
      // 产物与 CI 完全不受影响。
      {
        name: 'local-dev-public-wasm-as-module',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use('/wasm', (req, res, next) => {
            const resolved = resolveWasmDevFile(req.url)
            if (!resolved.ok) {
              // 非 .js 不归本中间件管（保持修前的 fall-through 契约）。
              if (resolved.reason === 'not-js') return next()
              // 越界 / 非法编码 / 目录 / 缺失：本中间件直接给状态码，绝不 next()——
              // next() 会把不可信路径交回 Vite 的其它中间件，等于把 containment 责任转手。
              res.statusCode = resolved.status
              res.end(resolved.status === 400 ? 'Bad Request' : resolved.status === 403 ? 'Forbidden' : 'Not Found')
              return
            }
            res.setHeader('Content-Type', 'text/javascript')
            res.setHeader('Cache-Control', 'no-cache')
            const stream = createReadStream(resolved.file)
            // 读盘错误（权限/被删/IO）必须收在响应里：未监听的 stream error 会冒泡成
            // dev server 未捕获异常，把后续请求链一起带崩。
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
      // Agent WASM identity：运行期 URL 由它拼出（见 api/agent-replay-facets.ts）
      __AGENT_WASM_COMMIT__: JSON.stringify(agent.commit),
      __AGENT_WASM_RELEASE__: JSON.stringify(agent.release),
    },
    server: {
      port: 5173,
      // 允许 dev server 读取仓库根的共享 JSON (common/map_names.json 等)。
      fs: { allow: ['..'] },
      watch: {
        // 编辑器 / 工具在 `scripts/` 下写文件时会留下临时文件；watcher 一旦在文件仍被
        // 占用时挂上监听就抛 `EBUSY: resource busy or locked`，而该异常会直接杀掉
        // dev server（实测：一次 `.browser-workspace-interaction.mjs.<pid>.<uuid>.tmpdir/…tmp`
        // 就让本机验收服务器整个挂掉）。这些临时文件从不参与构建，直接排除。
        ignored: ['**/.*.tmpdir/**', '**/*.tmp'],
      },
      proxy: {
        '/api': {
          target: devProxyTarget(mode),
          changeOrigin: true,
          secure: mode === 'production-remote',
        },
        // 仅当 WOTB_ASSET_PROXY 设置时存在（见 assetProxyTarget 说明）
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
    publicDir: '../common/assets',
    build: {
      outDir,
      // 让 CI 将 mapping 期望的 source asset 与实际 emitted dist 文件逐项对照。
      manifest: true,
      // 车型 WebP 必须保持独立生产文件，避免小型 turret 被内联后绕过 HTTP/dist 门禁。
      assetsInlineLimit: 0,
      rollupOptions: {
        input: {
          main: resolve(configDirectory, 'index.html')
        }
      }
    }
  }
})
