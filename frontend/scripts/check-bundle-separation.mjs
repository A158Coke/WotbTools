#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODEL_DEFINITIONS } from '../src/vehicle-models/mapping.js'

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const ASSET_MARK = 'vehicle-models/assets'
const PORTRAIT_MARK = 'tank-portraits'
const RUNTIME_GLOB_MARK = './assets/'

function staticImportSpecifiers(filePath) {
  const src = fs.readFileSync(filePath, 'utf8')
  const specs = new Set()
  const importRe = /\bimport\s*(?:\{[^}]*\}|\*\s*as\s*[\w$]+|[\w$]+)?\s*from\s*["']([^"']+)["']/g
  let m
  while ((m = importRe.exec(src)) !== null) specs.add(m[1])
  const sideRe = /\bimport\s*["']([^"']+)["']/g
  while ((m = sideRe.exec(src)) !== null) specs.add(m[1])
  const exportRe = /\bexport\s*\{[^}]*\}\s*from\s*["']([^"']+)["']/g
  while ((m = exportRe.exec(src)) !== null) specs.add(m[1])
  return [...specs]
}

function resolveLocalJs(spec, fromFile) {
  if (!spec || (!spec.startsWith('./') && !spec.startsWith('../'))) return null
  const abs = path.resolve(path.dirname(fromFile), spec)
  return abs.endsWith('.js') ? abs : null
}

function collectReachable(entryAbs) {
  const seen = new Set()
  const queue = [entryAbs]
  while (queue.length) {
    const f = queue.shift()
    if (seen.has(f)) continue
    seen.add(f)
    for (const spec of staticImportSpecifiers(f)) {
      const r = resolveLocalJs(spec, f)
      if (r && fs.existsSync(r) && !seen.has(r)) queue.push(r)
    }
  }
  return seen
}

function checkMappedVehicleAssets() {
  const manifestPath = path.join(DIST, '.vite', 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    console.error('[FAIL] dist/.vite/manifest.json 不存在——无法证明 Tier X source asset 已 emitted')
    return 1
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const entries = Object.entries(manifest)
  const failures = []
  for (const [modelKey, def] of Object.entries(MODEL_DEFINITIONS)) {
    for (const filename of def.kind === 'turreted' ? ['hull.webp', 'turret.webp'] : ['hull.webp']) {
      const suffix = `src/vehicle-models/assets/${modelKey}/${filename}`
      const entry = entries.find(([source]) => source.endsWith(suffix))?.[1]
      const emitted = entry?.file ? path.join(DIST, entry.file) : null
      if (!emitted || !fs.existsSync(emitted)) {
        failures.push(`${modelKey}/${filename}`)
      }
    }
  }
  if (failures.length > 0) {
    console.error(`[FAIL] ${failures.length} 个 Tier X source asset 未在 production dist emitted：${failures.join(', ')}`)
    return 1
  }
  console.log(`[PASS] ${Object.keys(MODEL_DEFINITIONS).length} 个 Tier X modelKey 的 source asset 全部 emitted 且可解析`)
  return 0
}

function main() {
  const indexHtml = path.join(DIST, 'index.html')
  if (!fs.existsSync(indexHtml)) {
    console.error('[FAIL] dist/index.html 不存在——请先 pnpm run build')
    process.exit(1)
  }
  const html = fs.readFileSync(indexHtml, 'utf8')
  const entrySrcs = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1])
  if (entrySrcs.length === 0) {
    console.error('[FAIL] index.html 未找到入口 JS')
    process.exit(1)
  }
  const assetsDir = path.join(DIST, 'assets')
  const allJs = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'))
  const entryName = path.basename(entrySrcs[0])
  const entryAbs = path.join(DIST, entrySrcs[0].replace(/^\//, ''))
  if (!fs.existsSync(entryAbs)) {
    console.error(`[FAIL] 入口 chunk 不存在：${entryAbs}`)
    process.exit(1)
  }

  const reachable = collectReachable(entryAbs)
  let failures = 0
  failures += checkMappedVehicleAssets()

  const badReach = [...reachable].filter((f) => {
    const c = fs.readFileSync(f, 'utf8')
    return c.includes(PORTRAIT_MARK) || c.includes(ASSET_MARK)
  })
  if (badReach.length > 0) {
    console.error(`[FAIL] 初始静态可达 chunk 含资产标记：${badReach.map((f) => path.basename(f)).join(', ')}——资产被静态拉入主加载路径`)
    failures += 1
  } else {
    console.log(`[PASS] 初始静态可达 ${reachable.size} 个 .js chunk 均不含车型/坦克贴图资产标记`)
  }

  const lazyPortrait = allJs.filter((f) => {
    const abs = path.join(assetsDir, f)
    if (reachable.has(abs)) return false
    return fs.readFileSync(abs, 'utf8').includes(PORTRAIT_MARK)
  })
  if (lazyPortrait.length > 0) {
    console.log(`[PASS] 坦克贴图 glob 仅存在于初始不可达 lazy chunk：${lazyPortrait.join(', ')}`)
  } else {
    console.error(`[FAIL] 未找到初始不可达、含坦克贴图 glob 的 lazy chunk——贴图 runtime 被静态拉入主加载路径`)
    failures += 1
  }

  const portraitChunkAbs = new Set(lazyPortrait.map((f) => path.join(assetsDir, f)))
  const portraitStaticImporters = []
  for (const fc of allJs) {
    const abs = path.join(assetsDir, fc)
    for (const spec of staticImportSpecifiers(abs)) {
      const r = resolveLocalJs(spec, abs)
      if (r && portraitChunkAbs.has(r)) { portraitStaticImporters.push(fc); break }
    }
  }
  if (portraitStaticImporters.length > 0) {
    console.error(`[FAIL] 以下 chunk 静态 import 了坦克贴图 runtime：${portraitStaticImporters.join(', ')}——贴图 runtime 被静态拉入主加载路径`)
    failures += 1
  } else {
    console.log('[PASS] 坦克贴图 runtime 仅由动态 import 触达（无 chunk 静态 import 它）')
  }

  const lazyVehicle = allJs.filter((f) => {
    const abs = path.join(assetsDir, f)
    if (reachable.has(abs)) return false
    const c = fs.readFileSync(abs, 'utf8')
    return c.includes(RUNTIME_GLOB_MARK) && c.includes('metadata.json')
  })
  if (lazyVehicle.length > 0) {
    console.log(`[PASS] 车型 runtime glob 仅存在于初始不可达 lazy chunk：${lazyVehicle.join(', ')}`)
  } else {
    console.error(`[FAIL] 未找到初始不可达、含车型 runtime 引用的 lazy chunk——车型 runtime 被静态拉入主加载路径`)
    failures += 1
  }

  const webpCount = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.webp')).length
  if (webpCount > 0) {
    console.log(`[PASS] dist/assets 存在 ${webpCount} 个独立 .webp 资产文件（未内联进 JS）`)
  } else {
    console.error('[FAIL] dist/assets 无独立 .webp 文件——车型/贴图资产可能被内联进 JS')
    failures += 1
  }

  if (failures > 0) {
    console.error(`RESULT: ${failures} FAILURE(S)`)
    process.exit(1)
  }
  console.log('RESULT: ALL PASS——普通用户主加载路径与车型/贴图资产分离（生产 runtime 动态 import）')
}

main()
