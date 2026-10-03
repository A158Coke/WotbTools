import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
 * 发布 Android 2.0 manifest 之前必须能证明**线上前端**支持 Bridge v2 + `native-auth`；
 * `nativeRuntimeIdentity()` 就是这条证明的机器可读来源
 * （见 `.github/workflows/android-release.yml` 的 publish 阶段与 `docs/android/release-process.md`）。
 */
export function nativeRuntimeIdentity() {
  return {
    supportedBridgeVersions: [...SUPPORTED_NATIVE_BRIDGE_VERSIONS],
    nativeAuthCapability: NATIVE_AUTH_CAPABILITY,
    authChangedGlobal: NATIVE_AUTH_CHANGED_GLOBAL,
    nativeAuthMethods: Object.values(NATIVE_AUTH_METHODS).sort(),
  }
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
      proxy: {
        '/api': {
          target: devProxyTarget(mode),
          changeOrigin: true,
          secure: mode === 'production-remote',
        },
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
