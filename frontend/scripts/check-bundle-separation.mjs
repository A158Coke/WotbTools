#!/usr/bin/env node
/**
 * Bundle 分离检查（Blocker 3）：Tier X 车型正式 WebP 资产（import.meta.glob 静态打包）
 * 不得进入普通用户初始主 bundle。
 *
 * 背景：隐藏 admin preview（?view=vehicle-models）已删除；车型资产唯一的运行时消费方是
 * 生产 runtime.js（Battle Playback preload 时 await import）——本门禁守护该分离不变。
 *
 * 用法（frontend 目录，build 之后）：
 *   npm run build && node scripts/check-bundle-separation.mjs
 *
 * 检查：
 * 1. 主入口 chunk（index.html 引用的首个 JS）不含 'vehicle-models/assets' 标记
 *   （谁把资产 glob 静态 import 进主入口 → FAIL）；
 * 2. 存在**非主入口** chunk 包含生产 runtime 资产引用（glob 键 './assets/<modelKey>/metadata.json'）
 *   → 资产由动态 import 的 runtime chunk 承载（代码分割成立）；
 * 3. dist/assets 存在独立 .webp 文件 → 资产未被内联进 JS。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const ASSET_MARK = 'vehicle-models/assets'
// vehicle-portraits/runtime.js 的坦克贴图 glob 相对键前缀（构建后键含 "tank-portraits"）
const PORTRAIT_MARK = 'tank-portraits'
// runtime.js 的 import.meta.glob 相对键前缀（构建后保留，如 "./assets/maus/metadata.json"）
const RUNTIME_GLOB_MARK = './assets/'

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
  // 主入口 = 第一个 script（无 type=module 顺序依赖，index.html 先引用 main）
  const entryName = path.basename(entrySrcs[0])
  const entryPath = path.join(DIST, entrySrcs[0].replace(/^\//, ''))
  const entryJs = fs.readFileSync(entryPath, 'utf8')
  let failures = 0

  if (entryJs.includes(ASSET_MARK) || entryJs.includes(PORTRAIT_MARK)) {
    const marks = [ASSET_MARK, PORTRAIT_MARK].filter((m) => entryJs.includes(m)).join(', ')
    console.error(`[FAIL] 主入口 ${entryName} 包含车型/贴图资产标记（${marks}）——资产被静态 import 进主 bundle`)
    failures += 1
  } else {
    console.log(`[PASS] 主入口 ${entryName} 不含车型/坦克贴图资产标记`)
  }

  const assetsDir = path.join(DIST, 'assets')
  const allJs = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'))
  const entryPathAbs = path.join(DIST, entrySrcs[0].replace(/^\//, ''))
  const runtimeChunks = allJs.filter((f) => {
    const abs = path.join(assetsDir, f)
    if (abs === entryPathAbs) return false
    const c = fs.readFileSync(abs, 'utf8')
    return c.includes(RUNTIME_GLOB_MARK) && c.includes('metadata.json')
  })
  if (runtimeChunks.length > 0) {
    console.log(`[PASS] 车型资产引用已分离到独立 chunk（生产 runtime）：${runtimeChunks.join(', ')}`)
  } else {
    console.error(`[FAIL] 未找到包含车型资产引用的独立 chunk（${RUNTIME_GLOB_MARK} + metadata.json）——代码分割失效`)
    failures += 1
  }

  // tank-portraits 运行时 chunk：非主入口 chunk 含坦克贴图 glob 引用 → 生产 runtime 动态分离成立
  const portraitChunks = allJs.filter((f) => {
    const abs = path.join(assetsDir, f)
    if (abs === entryPathAbs) return false
    const c = fs.readFileSync(abs, 'utf8')
    return c.includes(PORTRAIT_MARK)
  })
  if (portraitChunks.length > 0) {
    console.log(`[PASS] 坦克贴图 glob 引用已分离到独立 chunk：${portraitChunks.join(', ')}`)
  } else {
    console.error(`[FAIL] 未找到包含坦克贴图 glob 引用的独立 chunk（${PORTRAIT_MARK}）——贴图 runtime 被静态拉入主加载路径`)
    failures += 1
  }

  const webpCount = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.webp')).length
  if (webpCount > 0) {
    console.log(`[PASS] dist/assets 存在 ${webpCount} 个独立 .webp 资产文件（未内联进 JS）`)
  } else {
    console.error('[FAIL] dist/assets 无独立 .webp 文件——车型资产可能被内联进 JS')
    failures += 1
  }

  if (failures > 0) {
    console.error(`RESULT: ${failures} FAILURE(S)`)
    process.exit(1)
  }
  console.log('RESULT: ALL PASS——普通用户主加载路径与车型资产分离（生产 runtime 动态 import）')
}

main()
