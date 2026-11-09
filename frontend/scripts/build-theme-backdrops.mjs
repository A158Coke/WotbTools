#!/usr/bin/env node
/**
 * 四季全站背景构建：art-source / 原图 → src/assets/theme/backdrop-*.webp
 *
 * 原图规格（frontend/art-source/backdrops/README.md）：
 * - wide 1672×941，车队在中部到右侧，左侧干净；
 * - portrait 941×1672，车队在中上部，下半部干净。
 *
 * 输出按「横版铺满宽屏 / 竖版铺满手机」各放大一档。放大用 Lanczos，
 * 随后轻度锐化，WebP quality 以 80 起步；如果单张仍超过 300KB，
 * 逐档降低 quality 直到预算内（并打印实际值），保证背景不会拖垮首屏。
 */
import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_DIR = path.resolve(SCRIPT_DIR, '..')
const SOURCE_DIR = path.join(FRONTEND_DIR, 'art-source', 'backdrops')
const OUTPUT_DIR = path.join(FRONTEND_DIR, 'src', 'assets', 'theme')

const SEASONS = ['spring', 'summer', 'autumn', 'winter']
const VARIANTS = [
  { suffix: 'wide', width: 2560 },
  { suffix: 'portrait', width: 1080 },
]

const MAX_BYTES = 300 * 1024
const START_QUALITY = 80
const MIN_QUALITY = 24
const QUALITY_STEP = 2

async function render(source, width, quality) {
  const pipeline = sharp(source, { failOn: 'error' })
    .rotate()
    .resize({ width, kernel: sharp.kernel.lanczos3, withoutEnlargement: false })
    .sharpen({ sigma: 0.6, m1: 0.4, m2: 1.2 })
    .webp({ quality, effort: 5, smartSubsample: true })
  return pipeline.toBuffer()
}

async function buildOne(season, variant) {
  const input = path.join(SOURCE_DIR, 'backdrop-' + season + '-' + variant.suffix + '.webp')
  const output = path.join(OUTPUT_DIR, 'backdrop-' + season + '-' + variant.suffix + '.webp')

  const meta = await sharp(input).metadata()
  let quality = START_QUALITY
  let buffer = await render(input, variant.width, quality)
  while (buffer.byteLength > MAX_BYTES && quality > MIN_QUALITY) {
    // 按体积比例估算下一档 quality（WebP 体积近似随 quality 超线性增长），
    // 再用 QUALITY_STEP 兜底，避免从 80 每 2 点一档跑满二十多次。
    const estimate = Math.floor(quality * Math.sqrt(MAX_BYTES / buffer.byteLength) * 0.97)
    const next = Math.max(MIN_QUALITY, Math.min(quality - QUALITY_STEP, estimate))
    quality = next
    buffer = await render(input, variant.width, quality)
  }
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error('backdrop-' + season + '-' + variant.suffix + '.webp 超过 300KB 预算：' + buffer.byteLength + ' bytes')
  }

  const outMeta = await sharp(buffer).metadata()
  // 直接写编码后的 buffer：再次交给 sharp().toFile() 会以默认 quality 重新编码，
  // 体积回到 400KB+，预算检查就失去意义。
  await writeFile(output, buffer)
  const { size } = await stat(output)
  console.log(
    '  ' + path.basename(output).padEnd(32) +
    (meta.width + 'x' + meta.height).padEnd(12) + '→ ' +
    (outMeta.width + 'x' + outMeta.height).padEnd(12) +
    String(Math.round(size / 1024)).padStart(4) + 'KB  q=' + quality,
  )
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })
  console.log('Backdrops → ' + path.relative(FRONTEND_DIR, OUTPUT_DIR))
  for (const season of SEASONS) {
    for (const variant of VARIANTS) await buildOne(season, variant)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
