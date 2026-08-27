#!/usr/bin/env node
/**
 * Bundle 分离检查：Tier X 车型 / 坦克贴图资产（import.meta.glob 静态打包）不得进入
 * 普通用户**初始主加载路径**。
 *
 * 背景：两类资产的唯一运行时消费方都是生产 runtime.js（Battle Playback / 选手 Drawer
 * 在真正需要时才 await import）——本门禁守护该分离不变。
 *
 * 用法（frontend 目录，build 之后）：
 *   npm run build && node scripts/check-bundle-separation.mjs
 *
 * 检查（基于静态 import 依赖图，不用文件 hash / 固定 chunk 名判断）：
 * 1. 从 index.html 入口开始 BFS 递归解析所有初始静态可达的 .js chunk；
 * 2. 这些初始可达 chunk 都不得包含 'tank-portraits' 或 'vehicle-models/assets' 标记
 *   （谁把资产静默 import 进初始路径 → FAIL）；
 * 3. 存在**初始不可达**的 lazy chunk 分别承载坦克贴图 glob 与车型 runtime glob
 *   → 代码分割成立（portrait/vehicle runtime 仅由动态 import 触达）；
 * 4. dist/assets 存在独立 .webp 文件 → 资产未被内联进 JS。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const ASSET_MARK = 'vehicle-models/assets'
const PORTRAIT_MARK = 'tank-portraits'
// vehicle-models runtime.js 的 import.meta.glob 相对键（构建后保留，如 "./assets/<modelKey>/metadata.json"）
const RUNTIME_GLOB_MARK = './assets/'

/** 解析一个 .js chunk 内所有静态 import / export-from 的模块说明符。 */
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

/** 把相对说明符解析为本地 .js 文件绝对路径；外部/裸说明符返回 null。 */
function resolveLocalJs(spec, fromFile) {
  if (!spec || (!spec.startsWith('./') && !spec.startsWith('../'))) return null
  const abs = path.resolve(path.dirname(fromFile), spec)
  return abs.endsWith('.js') ? abs : null
}

/** 从入口开始 BFS，收集所有初始静态可达的 .js chunk（绝对路径集合）。 */
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

function main() {
  const indexHtml = path.join(DIST, 'index.html')
  if (!fs.existsSync(indexHtml)) {
    console.error('[FAIL] dist/index.html 不存在——请先 npm run build')
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

  // 1) 初始静态可达 chunk 不得包含车型/坦克贴图资产标记
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

  // 2) 存在初始不可达的 lazy chunk 承载坦克贴图 glob
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

  // 2b) 全构建内不得有任何 chunk 静态 import 坦克贴图 runtime（否则它被打进静态可达图）。
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

  // 3) 存在初始不可达的 lazy chunk 承载车型 runtime glob
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

  // 4) dist/assets 存在独立 .webp 文件（未内联进 JS）
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
