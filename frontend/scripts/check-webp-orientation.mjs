#!/usr/bin/env node
/**
 * 正式 WebP 资产方向校验（developer-only，依赖 python + PIL——与 bake 相同环境）。
 *
 * RASTER_Y_AXIS_CONTRACT 的真实图片级验证（vitest 只读 bake-report 指纹）：
 * 1) 用 PIL 解码 hull.webp / turret.webp 的 alpha（WebP 的 alpha 通道无损，等于 bake rgba）；
 * 2) 计算与 bake 时相同的覆盖 profile（topRow/bottomRow/topWidthMean/bottomWidthMean）；
 * 3) 与 bake-report.rasterOrientation 指纹逐项比对（WebP 与 bake 输出必须一致——
 *    任何人工翻转/重编码都会导致 mismatch）；
 * 4) turreted：额外断言 raster 内 pivot 像素被覆盖（座圈像素真实落在炮塔覆盖内）。
 *
 * 用法（frontend 目录）：
 *   node scripts/check-webp-orientation.mjs                # 全部 78 资产
 *   node scripts/check-webp-orientation.mjs grille-15 maus # 指定 modelKey
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const ASSETS = join(ROOT, 'frontend', 'src', 'vehicle-models', 'assets')
const DECODER = join(ROOT, 'frontend', 'scripts', 'decode-webp.py')

/** 解码 WebP → { w, h, alpha }（PIL；alpha 为 w*h 行主序字节）。
 * 临时文件写入系统 temp（禁止写进资产目录——validator 拒绝未契约文件）。 */
function decodeWebp(webpPath) {
  const tmp = join(tmpdir(), 'webp-qa-' + Math.random().toString(36).slice(2) + '.rgba')
  // stdio:'inherit'——沙箱/后台环境禁止捕获子进程 pipe 输出（EPERM）；结果走磁盘文件，仅需退出码
  const r = spawnSync('python', [DECODER, webpPath, tmp], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`PIL 解码失败 ${webpPath}（python 退出码 ${r.status}）`)
  const buf = readFileSync(tmp)
  const w = buf.readUInt32LE(0)
  const h = buf.readUInt32LE(4)
  // decode-webp.py 输出：8 字节头 + RGBA（行主序）——取 A 通道
  const alpha = new Uint8Array(w * h)
  for (let i = 0; i < alpha.length; i++) alpha[i] = buf[8 + i * 4 + 3]
  return { w, h, alpha }
}

/** 与 bake 时 rasterFingerprint 相同的 profile（阈值 alpha > 40）。 */
function profile(webpPath) {
  const { w, h, alpha } = decodeWebp(webpPath)
  const rowWidth = new Array(h).fill(0)
  let topRow = -1, bottomRow = -1
  for (let y = 0; y < h; y++) {
    let cnt = 0
    for (let x = 0; x < w; x++) if (alpha[y * w + x] > 40) cnt++
    rowWidth[y] = cnt
    if (cnt > 0) { if (topRow < 0) topRow = y; bottomRow = y }
  }
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)
  const band = Math.max(1, Math.floor(h * 0.1))
  return {
    w, h, topRow, bottomRow,
    topWidthMean: +mean(rowWidth.slice(0, band)).toFixed(2),
    bottomWidthMean: +mean(rowWidth.slice(h - band)).toFixed(2),
  }
}

const approx = (a, b, tol = 1.5) => Math.abs(a - b) <= tol

function checkAsset(modelKey) {
  const dir = join(ASSETS, modelKey)
  if (!existsSync(join(dir, 'metadata.json'))) return { ok: true, skipped: 'no metadata' }
  const report = JSON.parse(readFileSync(join(dir, 'bake-report.json'), 'utf8'))
  const failures = []
  for (const label of ['hull', 'turret']) {
    const webpPath = join(dir, `${label}.webp`)
    const ori = report.rasterOrientation?.[label]
    if (!existsSync(webpPath)) { if (label === 'turret' && report.kind !== 'turreted') continue; continue }
    if (!ori) { failures.push(`${label}: bake-report 缺 rasterOrientation`); continue }
    const p = profile(webpPath)
    if (!approx(p.topRow, ori.topRowCovered, 0)) failures.push(`${label}: WebP topRow=${p.topRow} ≠ 指纹 ${ori.topRowCovered}`)
    if (!approx(p.bottomRow, ori.bottomRowCovered, 0)) failures.push(`${label}: WebP bottomRow=${p.bottomRow} ≠ 指纹 ${ori.bottomRowCovered}`)
    if (!approx(p.topWidthMean, ori.topWidthMean)) failures.push(`${label}: WebP topWidthMean=${p.topWidthMean} ≠ 指纹 ${ori.topWidthMean}`)
    if (!approx(p.bottomWidthMean, ori.bottomWidthMean)) failures.push(`${label}: WebP bottomWidthMean=${p.bottomWidthMean} ≠ 指纹 ${ori.bottomWidthMean}`)
    // 方向契约：turret（bounds = 精确几何范围）top 覆盖行必须贴 0（= forward 端）；
    // hull 在画布内有 padding（车辆不贴画布顶），由指纹逐项比对保证方向。
    if (label === 'turret' && p.topRow > 2) failures.push(`${label}: 图片 top 无覆盖（topRow=${p.topRow}）——方向可能错误`)
  }
  // turreted：raster 内 pivot 像素必须真实落在炮塔覆盖内（不是 metadata 自洽）
  if (report.kind === 'turreted' && existsSync(join(dir, 'turret.webp'))) {
    const meta = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'))
    const raster = meta.turretRaster
    const { w, alpha } = decodeWebp(join(dir, 'turret.webp'))
    const px = Math.round(raster.pivotX * 2)
    const py = Math.round(raster.pivotY * 2)
    const a = alpha[py * w + px]
    if (typeof a !== 'number' || a <= 40) {
      failures.push(`turret: pivot 像素 (${px},${py}) alpha=${a}——未落在炮塔覆盖内（pivot 不指向真实座圈）`)
    }
  }
  return { ok: failures.length === 0, failures }
}

function main() {
  const keys = process.argv.slice(2)
  const all = readdirSync(ASSETS).filter((n) => existsSync(join(ASSETS, n, 'metadata.json'))).sort()
  const targets = keys.length ? keys : all
  let failed = 0
  for (const key of targets) {
    const r = checkAsset(key)
    if (r.skipped) { console.log(`  SKIP ${key}（${r.skipped}）`); continue }
    if (r.ok) { console.log(`  PASS ${key}`) } else {
      console.error(`  [FAIL] ${key}`)
      for (const e of r.failures) console.error(`    - ${e}`)
      failed += 1
    }
  }
  console.log(failed === 0 ? `\nRESULT: ALL PASS（${targets.length} assets WebP orientation 与 bake 指纹一致）` : `\nRESULT: ${failed} FAILURE(S)`)
  if (failed > 0) process.exit(1)
}

main()
