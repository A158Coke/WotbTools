// 分区主视觉（section key visual）产物脚本：把 art-source 里的 1672×941 原图放大到 2400 宽，
// 轻度锐化后输出 WebP 到 src/assets/theme/，供 ShowcaseHero 的 section 变体按导航分区取图。
// 原图只读；产物入库并由 Vite 随 import 打包。命名固定为 hero-<section>.webp，与 src/shared/sectionHeroes.ts 一一对应。
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import sharp from 'sharp'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_DIR = path.resolve(SCRIPT_DIR, '..')
const SOURCE_DIR = path.join(FRONTEND_DIR, 'art-source', 'heroes')
const OUTPUT_DIR = path.join(FRONTEND_DIR, 'src', 'assets', 'theme')

const TARGET_WIDTH = 2400
const MAX_BYTES = 250_000
const START_QUALITY = 80
const MIN_QUALITY = 40
const QUALITY_STEP = 2

function formatKb(bytes) {
  return `${(bytes / 1000).toFixed(1)}KB`
}

function render(source, quality) {
  return sharp(source, { failOn: 'error' })
    .rotate()
    .resize({ width: TARGET_WIDTH, kernel: 'lanczos3', withoutEnlargement: false })
    .sharpen({ sigma: 0.6, m1: 0.4, m2: 1.2 })
    .webp({ quality, effort: 5, smartSubsample: true })
    .toBuffer()
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const files = (await readdir(SOURCE_DIR)).filter(file => /^hero-[a-z0-9-]+\.webp$/i.test(file)).sort()
  if (!files.length) throw new Error(`no hero-*.webp found in ${SOURCE_DIR}`)

  for (const file of files) {
    const source = path.join(SOURCE_DIR, file)
    const output = path.join(OUTPUT_DIR, file)
    const input = await stat(source)
    let quality = START_QUALITY
    let buffer = await render(source, quality)
    while (buffer.byteLength > MAX_BYTES && quality > MIN_QUALITY) {
      quality = Math.max(MIN_QUALITY, quality - QUALITY_STEP)
      buffer = await render(source, quality)
    }
    if (buffer.byteLength > MAX_BYTES) {
      throw new Error(`${file} is ${formatKb(buffer.byteLength)} at q${quality}, over the ${formatKb(MAX_BYTES)} budget`)
    }
    // 直接写 buffer：再经 toFile 编码一次会让体积重新变大
    await writeFile(output, buffer)
    const meta = await sharp(buffer).metadata()
    console.log(`${file}  ${formatKb(input.size)} -> ${formatKb(buffer.byteLength)}  ${meta.width}×${meta.height}  q${quality}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
