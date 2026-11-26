#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const ASSETS = join(ROOT, 'frontend', 'src', 'vehicle-models', 'assets')
const DECODER = join(ROOT, 'frontend', 'scripts', 'decode-webp.py')

function decodeWebp(webpPath) {
  const tmp = join(tmpdir(), 'webp-qa-' + Math.random().toString(36).slice(2) + '.rgba')
  const r = spawnSync('python', [DECODER, webpPath, tmp], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`PIL 解码失败 ${webpPath}（python 退出码 ${r.status}）`)
  const buf = readFileSync(tmp)
  const w = buf.readUInt32LE(0)
  const h = buf.readUInt32LE(4)
  const alpha = new Uint8Array(w * h)
  for (let i = 0; i < alpha.length; i++) alpha[i] = buf[8 + i * 4 + 3]
  rmSync(tmp, { force: true })
  return { w, h, alpha }
}

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
    if (label === 'turret' && p.topRow > 2) failures.push(`${label}: 图片 top 无覆盖（topRow=${p.topRow}）——方向可能错误`)
  }
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
