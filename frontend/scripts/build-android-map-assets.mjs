/**
 * Android 地图派生物的构建期编排（2.1.0 Phase 10）。
 *
 *   canonical（src/assets/maps/*.webp，Web 构建继续用）
 *      --Pillow 派生（同比例缩小、重编码）-->  dist-android-maps/  --Vite 别名-->  APK assets
 *
 * 纪律：
 * - **不维护第二份人工源**：派生物是构建产物（gitignored），参数与预算在
 *   `lib/mapAssetInvariants.mjs` 一处声明；
 * - **fail closed**：源缺失 / Pillow 不可用 / 派生不满足不变量（文件集合、等比、不放大、
 *   单张与总量预算）任一条不成立都直接失败，绝不"生成了就当成功"；
 * - 幂等：输出目录先清空再生成，重复构建结果一致（python 侧另有 determinism 复核）。
 *
 * 用法（frontend/ 下）：
 *   node scripts/build-android-map-assets.mjs            # 生成（build:android 会调用）
 *   node scripts/build-android-map-assets.mjs --verify   # 只校验已生成的派生物
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAP_DERIVATIVE_BUDGETS, checkDerivativeInvariants, webpDimensions } from './lib/mapAssetInvariants.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const FRONTEND = resolve(here, '..')
const SOURCE_DIR = join(FRONTEND, 'src/assets/maps')
const OUT_DIR = join(FRONTEND, 'dist-android-maps')
const PY = join(here, 'optimize-android-maps.py')

function fail(message) {
  console.error(`android map assets: ${message}`)
  process.exit(1)
}

function listWebp(dir) {
  return readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.webp')).sort()
}

function describe(dir, names) {
  return names.map((name) => {
    const path = join(dir, name)
    return { name, bytes: statSync(path).size, dimensions: webpDimensions(readFileSync(path)) }
  })
}

function verify() {
  if (!existsSync(OUT_DIR)) fail(`派生物目录不存在：${OUT_DIR}（先运行不带 --verify 的构建）`)
  const sources = describe(SOURCE_DIR, listWebp(SOURCE_DIR))
  const derivatives = describe(OUT_DIR, listWebp(OUT_DIR))
  const { errors, summary } = checkDerivativeInvariants({ sources, derivatives })
  if (errors.length) fail(`不变量校验失败：\n  - ${errors.join('\n  - ')}`)
  return { ...summary, names: derivatives.map((entry) => entry.name.replace(/\.webp$/i, '')) }
}

function generate() {
  if (!existsSync(SOURCE_DIR)) fail(`canonical 地图目录不存在：${SOURCE_DIR}`)
  const sources = listWebp(SOURCE_DIR)
  if (!sources.length) fail(`canonical 地图目录为空：${SOURCE_DIR}`)

  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
  const manifest = join(OUT_DIR, 'map-assets-manifest.json')
  try {
    execFileSync('python3', [
      PY,
      '--src', SOURCE_DIR,
      '--out', OUT_DIR,
      '--max-dimension', String(MAP_DERIVATIVE_BUDGETS.maxDimension),
      '--manifest', manifest,
      '--check-determinism',
    ], { stdio: 'inherit' })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      fail('python3 不可用：地图派生需要 Python + Pillow（CI 里由 workflow 安装固定版本）')
    }
    fail('地图派生失败（见上方 python 输出）')
  }
  // manifest 不是图片，校验集合时排除（否则会被当成"多出的文件"）
  rmSync(manifest, { force: true })
  const summary = verify()
  console.log(`android map assets: verified ${summary.files} maps, ${summary.totalMiB} MiB (largest ${summary.largest})`)
  return summary
}

const verifyOnly = process.argv.includes('--verify')
const summary = verifyOnly ? verify() : generate()
if (verifyOnly) console.log(`android map assets: verified ${summary.files} maps, ${summary.totalMiB} MiB (largest ${summary.largest})`)

export { OUT_DIR, SOURCE_DIR, verify, generate }
