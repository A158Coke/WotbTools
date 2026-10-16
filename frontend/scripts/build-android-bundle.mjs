import { ANDROID_APP_ORIGIN, PRODUCTION_API_ORIGIN, ANDROID_ASSET_BASE } from '../src/platform/runtime.js'
/**
 * Android local-first bundle（PR B §5/§6/§10/§31）。
 *
 * 目标：APK 里带着**完整可离线运行**的产品前端 —— index + JS/CSS + Agent WASM + 必需本地资源，
 * 由本地可信 origin（`http://127.0.0.1:21653`，Native LocalRuntimeServer）伺服。
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
const EMBEDDED_MAP2D_NAME = 'map2d-embedded.json'
const MAP2D_SOURCE_NAME = 'map2d-source.json'

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

/**
 * 2D 底图"包内兜底"清单（运行时 OTA 决策的输入之一）：registry code → {file, asset, sha256}。
 * 与 `src/data/mapImages.js` 注册表逐条对齐（解析为空 / 漏图即 fail），sha256 取自**随包派生物**
 * 的真实字节。只对 android 构建产出；web 构建没有该文件 ⇒ 运行时按"无兜底清单 = 关闭通道"处理。
 */
function buildMap2dEmbedded(files) {
  const text = readFileSync(join(FRONTEND, 'src/data/mapImages.js'), 'utf8')
  const imports = new Map([...text.matchAll(/import\s+(\w+)\s+from\s+'\.\.\/assets\/maps\/([^']+)'/g)]
    .map((match) => [match[1], match[2]]))
  const entries = [...text.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*):\s*\{\s*src:\s*(\w+),/gm)]
  if (!entries.length) fail('map2d-embedded: mapImages.js 注册表解析为空')
  const maps = {}
  for (const [, code, variable] of entries) {
    const file = imports.get(variable)
    if (!file) fail(`map2d-embedded: ${code} 引用了未 import 的变量 ${variable}`)
    const base = file.replace(/\.webp$/i, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const asset = files.find((path) => new RegExp(`(^|/)assets/${base}-[A-Za-z0-9_-]+\.webp$`).test(path))
    if (!asset) fail(`map2d-embedded: 找不到 ${code}（${file}）的随包资源`)
    maps[code] = { file, asset, sha256: sha256(join(ASSETS_WEB, asset)) }
  }
  // 内容时间戳来自**底图内容自身**（Agent 仓导出的 map2d-source.json，与 COS 索引 `generated` 同源）。
  // 绝不能用 `new Date()`：它既不代表底图的新鲜度（会让 stage 晚于 COS 发布时构建的包把真正更新的
  // 底图判成更旧、永久拒绝升级），也会让同一 commit 重跑构建产出不同字节的 bundle（破坏 stage
  // 可重跑性与 APK 不可变性——本函数所在产物同时进 bundle manifest 与 APK 资产）。
  const sourcePath = join(FRONTEND, 'src/assets/maps', MAP2D_SOURCE_NAME)
  if (!existsSync(sourcePath)) {
    fail(`map2d-embedded: 缺 ${MAP2D_SOURCE_NAME}——底图交接集不完整（应与 29 张 webp 同批，见 docs/reference/maps.md §2026-10-16）`)
  }
  const source = JSON.parse(readFileSync(sourcePath, 'utf8'))
  const contentGeneratedAt = String(source?.contentGeneratedAt ?? '')
  if (source?.schemaVersion !== 2 || !Number.isFinite(Date.parse(contentGeneratedAt))) {
    fail(`map2d-embedded: ${MAP2D_SOURCE_NAME} 非法（需要 schemaVersion 2 + 可解析的 contentGeneratedAt）`)
  }
  // **字节绑定**：交接件必须描述的正是**正在随包的那 29 张**——缺图 / 多图 / 文件名不符 /
  // sha256 不符一律 fail closed。只在本地与随包字节比对，**不查 COS**（COS 允许独立前进）：
  // 这里要证的不变量是「交接件 == 随包 canonical 图集」。缺了这条，"换图但忘了重跑 Agent 仓
  // 导出并同步交接件"会让旧 `contentGeneratedAt` 配上新图，运行时据 COS 索引判断时可能把
  // 包内更新的图 OTA 降级（违反 never-downgrade）。
  const bound = source?.maps && typeof source.maps === 'object' ? source.maps : {}
  const codes = Object.keys(maps).sort()
  const boundCodes = Object.keys(bound).sort()
  if (codes.length !== boundCodes.length || codes.some((code, index) => code !== boundCodes[index])) {
    fail(`map2d-embedded: ${MAP2D_SOURCE_NAME} 的图集与注册表不一致（注册表 ${codes.length} 张 / 交接件 ${boundCodes.length} 张）`)
  }
  for (const code of codes) {
    const entry = bound[code]
    if (!entry || entry.file !== maps[code].file) {
      fail(`map2d-embedded: ${code} 交接件文件名 ${entry?.file ?? '(缺失)'} ≠ 注册表 ${maps[code].file}`)
    }
    if (entry.sha256 !== maps[code].sha256) {
      fail(`map2d-embedded: ${code} 交接件 sha256 与随包字节不符——换图后必须重跑 Agent 仓 tools/export_2d_basemaps.py 并同步 ${MAP2D_SOURCE_NAME}`)
    }
  }
  if (source.mapsDigest !== mapsDigest(bound)) {
    fail(`map2d-embedded: ${MAP2D_SOURCE_NAME} mapsDigest 与 maps 条目不符（文件损坏？）`)
  }
  return { schemaVersion: 3, contentGeneratedAt, mapsDigest: source.mapsDigest, maps }
}

/** 与 Agent 仓 `tools/export_2d_basemaps.py::maps_digest` 同式：排序后的 `code<TAB>sha256` 行做 sha256。 */
function mapsDigest(maps) {
  const lines = Object.keys(maps).sort().map((code) => `${code}\t${maps[code].sha256}`).join('\n')
  return createHash('sha256').update(lines, 'utf8').digest('hex')
}

/** `maps` 段（bundle manifest）：随包 2D 底图的真实字节统计（与 Web 同字节的 canonical）。 */
function map2dSegment(embeddedMaps) {
  const entries = Object.values(embeddedMaps.maps)
    .map((entry) => ({ file: entry.file, bytes: statSync(join(ASSETS_WEB, entry.asset)).size }))
  const largest = entries.reduce((a, b) => (b.bytes > a.bytes ? b : a), { file: null, bytes: 0 })
  return {
    source: 'canonical-1254',
    files: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    largest: largest.file,
  }
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

  // 4b) 2D 底图：**与 Web 同字节**（canonical 1254²，Android 不再派生缩小副本）。
  //     buildMap2dEmbedded 逐条 fail closed（注册表里每张地图都必须有随包资源），
  //     并产出运行时 OTA 决策用的兜底清单（code → 随包 sha256）。先写再 walk，
  //     使清单自身也进 bundle manifest 的 files[]。
  const embeddedMaps = buildMap2dEmbedded(walk(ASSETS_WEB))
  writeFileSync(join(ASSETS_WEB, EMBEDDED_MAP2D_NAME),
    JSON.stringify(embeddedMaps, null, 2) + '\n')

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
    maps: map2dSegment(embeddedMaps),
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
