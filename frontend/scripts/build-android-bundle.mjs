import { ANDROID_APP_ORIGIN, PRODUCTION_API_ORIGIN, ANDROID_ASSET_BASE } from '../src/platform/runtime.js'
/**
 * Android local-first bundle（PR B §5/§6/§10/§31）。
 *
 * 目标：APK 里带着**完整可离线运行**的产品前端 —— index + JS/CSS + Agent WASM + 必需本地资源，
 * 由本地可信 origin（`https://appassets.androidplatform.net`，WebViewAssetLoader）伺服。
 *
 * 做法刻意是「同一份产品源码 + 不同 runtime target」，而不是第二套 frontend：
 * ```text
 * frontend/（唯一源码树）  --vite build --mode android-->  frontend/dist-android
 *                                                        --copy-->  android/app/src/main/assets/web
 * ```
 *
 * 三道 fail-closed 检查（缺一不可，否则会得到一个「看起来能跑、离线却解析不了」的包）：
 *  1. Agent WASM 产物必须已由 scripts/fetch-agent-wasm.sh 落位到 common/assets/wasm/<ref>/；
 *  2. 复用 frontend/scripts/verify-agent-wasm-dist.mjs（**唯一实现**）校验 dist-android 里的
 *     commit-addressed 产物与 deploy/agent/source.json 逐字段一致；
 *  3. 复制到 assets 后再断言 index.html / wasm / 清单存在，并写出 bundle manifest 供 CI 与
 *     APK 内容断言使用（不含任何 secret，只记录身份与数量）。
 *
 * 用法（frontend/ 下）：node scripts/build-android-bundle.mjs
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { nativeRuntimeIdentity } from '../vite.config.js'

const here = dirname(fileURLToPath(import.meta.url))
const FRONTEND = resolve(here, '..')
const REPO = resolve(FRONTEND, '..')
const DIST = join(FRONTEND, 'dist-android')
const ASSETS_WEB = join(REPO, 'android/app/src/main/assets/web')
const PIN_PATH = join(REPO, 'deploy/agent/source.json')
const VERIFY = join(here, 'verify-agent-wasm-dist.mjs')
const MANIFEST_NAME = 'bundle-manifest.json'

function fail(message) {
  console.error(`android bundle: ${message}`)
  process.exit(1)
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function walk(dir, base = dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, base, acc)
    else acc.push(relative(base, full).split('\\').join('/'))
  }
  return acc
}

/** Verify emitted URLs against the actual root mapping, including lazy chunk edges. */
export function verifyAndroidUrlLayout(root) {
  const origin = ANDROID_APP_ORIGIN
  const check = (reference, owner) => {
    if (/^(?:data:|blob:|#)/.test(reference)) return
    const url = new URL(reference, `${origin}/${owner}`)
    if (url.origin !== origin) throw new Error(`non-local bundle dependency: ${owner} -> ${reference}`)
    const pathname = decodeURIComponent(url.pathname).replace(/^\//, '')
    const resolved = resolve(root, pathname)
    if (!resolved.startsWith(resolve(root) + '/') && !resolved.startsWith(resolve(root) + '\\')) throw new Error('bundle URL escapes root')
    if (!existsSync(resolved) || !statSync(resolved).isFile()) throw new Error(`missing bundle URL: ${owner} -> ${reference}`)
  }
  const files = walk(root)
  const html = readFileSync(join(root, 'index.html'), 'utf8')
  for (const match of html.matchAll(/<(?:script|link)[^>]+(?:src|href)=["']([^"']+)["']/g)) check(match[1], 'index.html')
  const graph = JSON.parse(readFileSync(join(root, '.vite/manifest.json'), 'utf8'))
  for (const record of Object.values(graph)) {
    check(`/${record.file}`, 'index.html')
    for (const file of [...(record.css || []), ...(record.assets || [])]) check(`/${file}`, 'index.html')
    for (const dependency of [...(record.imports || []), ...(record.dynamicImports || [])]) {
      if (!graph[dependency]) throw new Error(`missing bundle graph edge: ${dependency}`)
      check(`/${graph[dependency].file}`, 'index.html')
    }
  }
  for (const file of files.filter(file => /\.(?:js|css)$/.test(file))) {
    const content = readFileSync(join(root, file), 'utf8')
    const refs = file.endsWith('.css') ? content.matchAll(/url\(["']?([^\s"')]+)["']?\)/g)
      : content.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g)
    for (const match of refs) {
      if (file.endsWith('.css') || /^(?:\.\.?\/|\/)/.test(match[1])) check(match[1], file)
    }
  }
}

async function main() {
  const pin = JSON.parse(readFileSync(PIN_PATH, 'utf8'))
  const ref = String(pin?.ref ?? '').trim()
  const release = String(pin?.artifact?.release ?? '').trim()
  if (!/^[0-9a-f]{40}$/.test(ref)) fail(`deploy/agent/source.json has no usable ref: ${ref}`)

  // 1) WASM 产物必须已落位（离线解析是 PR B 的核心，绝不允许 build 出没有 parser 的包）。
  const wasmSource = join(REPO, 'common/assets/wasm', ref)
  if (!existsSync(wasmSource)) {
    fail(`Agent WASM 产物缺失：${relative(REPO, wasmSource)}。先运行 bash scripts/fetch-agent-wasm.sh（禁止从 CDN 取）`)
  }

  // 2) 构建 android target（同一份源码、不同 mode/outDir）。
  // Invalidate the previous APK payload before any build can fail.
  rmSync(ASSETS_WEB, { recursive: true, force: true })
  rmSync(DIST, { recursive: true, force: true })
  await build({ mode: 'android', logLevel: 'info' })
  if (!existsSync(join(DIST, 'index.html'))) fail('vite build 未产出 index.html')
  // Web image build also installs this public static sponsor asset.
  cpSync(join(FRONTEND, 'public/sponsor-bg.webp'), join(DIST, 'sponsor-bg.webp'))

  // 3) 复用唯一实现校验 commit-addressed WASM 产物。
  execFileSync(process.execPath, [VERIFY, '--dist', DIST, '--pin', PIN_PATH], { stdio: 'inherit' })

  verifyAndroidUrlLayout(DIST)
  // Build-only graph has already been checked. Android excludes dot directories from APK assets.
  rmSync(join(DIST, '.vite'), { recursive: true, force: true })

  // 4) 复制进 APK assets（生成物，不进源码树）。
  rmSync(ASSETS_WEB, { recursive: true, force: true })
  mkdirSync(ASSETS_WEB, { recursive: true })
  cpSync(DIST, ASSETS_WEB, { recursive: true })

  const files = walk(ASSETS_WEB)
  const indexRel = 'index.html'
  const wasmJsRel = `wasm/${ref}/wotb_replay_wasm.js`
  const wasmBinRel = `wasm/${ref}/wotb_replay_wasm_bg.wasm`
  for (const required of [indexRel, wasmJsRel, wasmBinRel]) {
    if (!files.includes(required)) fail(`APK bundle 缺少必需文件：${required}`)
  }

  const manifest = {
    schemaVersion: 2,
    buildCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(),
    runtimeOrigin: ANDROID_APP_ORIGIN,
    apiOrigin: PRODUCTION_API_ORIGIN,
    assetOrigin: ANDROID_ASSET_BASE,
    nativeRuntime: nativeRuntimeIdentity(),
    files: files.map(path => ({ path, sha256: sha256(join(ASSETS_WEB, path)), size: statSync(join(ASSETS_WEB, path)).size })),
    target: 'android',
    agentWasm: { commit: ref, release },
    entry: indexRel,
    entrySha256: sha256(join(ASSETS_WEB, indexRel)),
    agentWasmSha256: sha256(join(ASSETS_WEB, wasmBinRel)),
    fileCount: files.length,
    totalBytes: files.reduce((sum, rel) => sum + statSync(join(ASSETS_WEB, rel)).size, 0),
  }
  writeFileSync(join(ASSETS_WEB, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + '\n')

  console.log(
    `android bundle: ${relative(REPO, ASSETS_WEB)} ← ${files.length} files, ` +
    `${(manifest.totalBytes / 1024 / 1024).toFixed(1)} MiB, agent ${release} @ ${ref.slice(0, 12)}`
  )

}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
