import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { execSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// dev 时把 /api 代理到选定的后端；生产 bundle 由 nginx 反向代理。
const configDirectory = fileURLToPath(new URL('.', import.meta.url))
const DEV_PROXY_TARGETS = Object.freeze({
  local: 'http://localhost:8087',
  'production-remote': 'https://wotbtools.com',
})
const LOCAL_3D_ASSET_DIR = resolve(configDirectory, '../common/assets/map-3d-local')

export function devProxyTarget(mode) {
  return DEV_PROXY_TARGETS[mode] || DEV_PROXY_TARGETS.local
}

/**
 * Client-derived 3D map assets are a local research input only. `publicDir` is
 * shared with local dev, so a generated map-3d-local directory would otherwise
 * be copied into dist during a production build. Fail closed instead of relying
 * on .gitignore, which only controls Git tracking and cannot protect build output.
 */
export function assertLocal3dDistributionBoundary(command, localAssetsExist) {
  if (command === 'build' && localAssetsExist) {
    throw new Error(
      'Production build blocked: common/assets/map-3d-local contains local client-derived 3D map assets. '
      + 'Remove that directory before building; these assets are DEV/local-research only and must not be redistributed.'
    )
  }
}

/** Build identity：生产 bundle 可精确对应 git commit + 构建时间（见 /version.json 与 console 输出）。
 * 优先取 Docker 构建参数 BUILD_COMMIT（CI 传入，Docker 上下文无 .git 无法自行 rev-parse），
 * 本地构建再 fallback 到 git rev-parse；两者皆无时降级 unknown，不阻断构建。 */
function buildIdentity() {
  const fromEnv = process.env.BUILD_COMMIT
  let commit = (fromEnv && fromEnv.trim()) || 'unknown'
  if (commit === 'unknown') {
    try {
      commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
    } catch {
      // 无 git 上下文（如发布 tarball）时保持 unknown。
    }
  }
  return {
    commit,
    buildTime: new Date().toISOString(),
  }
}

const identity = buildIdentity()

export default defineConfig(({ command, mode }) => {
  assertLocal3dDistributionBoundary(command, existsSync(LOCAL_3D_ASSET_DIR))
  return {
    plugins: [
      vue(),
      {
        name: 'wotb-build-identity',
        apply: 'build',
        closeBundle() {
          const outDir = resolve(configDirectory, 'dist')
          writeFileSync(resolve(outDir, 'version.json'),
            JSON.stringify({ commit: identity.commit, buildTime: identity.buildTime }, null, 2) + '\n')
        },
      },
    ],
    define: {
      __BUILD_COMMIT__: JSON.stringify(identity.commit),
      __BUILD_TIME__: JSON.stringify(identity.buildTime),
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
      outDir: 'dist',
      rollupOptions: {
        input: {
          main: resolve(configDirectory, 'index.html')
        }
      }
    }
  }
})
