#!/usr/bin/env node
/**
 * Bundle 分离检查（Blocker 3）：隐藏 admin preview（含全部车型 QA 资产）
 * 不得进入普通用户初始主 bundle。
 *
 * 用法（frontend 目录，build 之后）：
 *   npm run build && node scripts/check-bundle-separation.mjs
 *
 * 检查：
 * 1. 主入口 chunk（index.html 引用的首个 JS）不含 'vehicle-models/assets' 标记；
 * 2. 存在独立的 preview chunk 包含该标记（异步组件 + import.meta.glob 资产）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const ASSET_MARK = 'vehicle-models/assets'

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

  if (entryJs.includes(ASSET_MARK)) {
    console.error(`[FAIL] 主入口 ${entryName} 包含车型资产标记（${ASSET_MARK}）——preview 未与主 bundle 分离`)
    failures += 1
  } else {
    console.log(`[PASS] 主入口 ${entryName} 不含车型资产标记`)
  }

  const allJs = fs.readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js'))
  const previewChunks = allJs.filter((f) => {
    const c = fs.readFileSync(path.join(DIST, 'assets', f), 'utf8')
    return c.includes(ASSET_MARK)
  })
  if (previewChunks.length > 0) {
    console.log(`[PASS] 车型 QA 资产已分离到独立 chunk：${previewChunks.join(', ')}`)
  } else {
    console.error(`[FAIL] 未找到包含车型资产标记的独立 chunk（${ASSET_MARK}）`)
    failures += 1
  }

  if (failures > 0) {
    console.error(`RESULT: ${failures} FAILURE(S)`)
    process.exit(1)
  }
  console.log('RESULT: ALL PASS——普通用户主加载路径与车型 QA 资产分离')
}

main()
