#!/usr/bin/env node
/**
 * scenery-lite 派生 CLI（#857 Step 3）：对 asset pack 逐图从 full `scenery.glb`（唯一 SSOT）
 * 派生 `scenery-lite.glb`。分类/重写/重建/验证逻辑全部在 scripts/scenery-lite/deriveLiteCore.mjs
 * （纯函数，vitest 直测）；本文件只做 I/O 接线：
 *   · pack 遍历（--map / --all）与 fail-closed 写盘（verify 全绿才写，tmp+rename）；
 *   · 均值色注入：headless Chrome（复用门禁 browser-chrome CDP 驱动）解码内嵌 JPEG/PNG，
 *     alpha 加权均值 → 材质 baseColorFactor（与 exporter 无贴图兜底同口径）；
 *   · 派生报告逐图落盘 <pack>/overhead/scenery-lite/<key>.report.json（§15 字段：source
 *     identity / full-lite bytes / mesh / triangles / dropped categories），汇总写 summary.json。
 *
 * 用法：
 *   node scripts/derive-scenery-lite.mjs --pack "D:/.../release/asset_pack" --all
 *   node scripts/derive-scenery-lite.mjs --pack "..." --map rockfield
 * 产物：<pack>/map/<key>/scenery-lite.glb（verify 失败的图不写；任一图未过 verify ⇒ 退出码 2，
 * 发布 gate 不通过——运行时对缺失图按 #857 §14 显式降级）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveSceneryLite, parseGlb, buildGlb, verifyLite } from './scenery-lite/deriveLiteCore.mjs'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const argOf = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const has = (name) => args.includes(`--${name}`)
const PACK = resolve(argOf('pack', 'D:/Class/Rust/Project/release/asset_pack'))
const REPORT_DIR = join(PACK, 'overhead', 'scenery-lite')

// 均值色解码页：Canvas 2D alpha 加权均值（Chrome 原生 JPEG/PNG 解码；sRGB 像素直接平均，
// 与 exporter 的 PIL 无贴图兜底同口径）
const MEAN_HTML = `<!doctype html><html><body><script type="module">
// 一次扫描产出：alpha 加权均值色 + 32-bin alpha 直方图（#857 修复轮 §13-14——
// coverageAboveCutoff 由 derive core 按 per-material cutoff 从直方图估算，不保存像素数组）
window.__mean = async (b64, mime) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const bmp = await createImageBitmap(new Blob([bytes], { type: mime || 'image/png' }))
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bmp, 0, 0)
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
  let r = 0, g = 0, b = 0, a = 0, n = 0
  const hist = new Array(32).fill(0)
  for (let i = 0; i < d.length; i += 4) {
    const w = d[i + 3] / 255
    r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; a += d[i + 3]; n++
    hist[Math.min(31, Math.floor((d[i + 3] / 255) * 32))] += 1
  }
  if (!n) return null
  return {
    color: [+(r / (n * 255)).toFixed(4), +(g / (n * 255)).toFixed(4), +(b / (n * 255)).toFixed(4), +(a / (n * 255)).toFixed(4)],
    alphaHistogram: hist.map((v) => +(v / n).toFixed(5)),
  }
}
</script></body></html>`

async function startMeanColor() {
  const { createServer } = await import('vite')
  const frontendRoot = resolve(here, '..')
  const server = await createServer({
    configFile: false,
    root: frontendRoot,
    logLevel: 'error',
    plugins: [{
      name: 'mean-color-page',
      configureServer(s) {
        s.middlewares.use('/mean', (_req, res) => {
          res.setHeader('content-type', 'text/html')
          s.transformIndexHtml('/mean', MEAN_HTML).then((html) => res.end(html))
        })
      },
    }],
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  const origin = server.resolvedUrls?.local?.[0]?.replace(/\/$/, '')
  if (!origin) throw new Error('vite did not publish a local URL')
  return { server, origin }
}

// 单图失败时撤销旧产物，避免本轮失败后继续消费上一轮 lite。
export async function deriveMap({ mapDir, reportDir, key, colorOf }) {
  const scenePath = join(mapDir, key, 'scenery.glb')
  const outPath = join(mapDir, key, 'scenery-lite.glb')
  const liteTmp = `${outPath}.tmp`
  const reportPath = join(reportDir, `${key}.report.json`)
  let report
  try {
    rmSync(outPath, { force: true })
    rmSync(liteTmp, { force: true })
    const buf = readFileSync(scenePath)
    const { json, bin } = parseGlb(buf)
    const derived = await deriveSceneryLite(json, bin, { colorOf, key })
    const v = verifyLite(json, bin, derived.json, derived.bin)
    report = {
      key,
      sourceSha256: createHash('sha256').update(buf).digest('hex'),
      ...derived.report,
      sourceBytes: buf.length,
      verify: {
        ok: v.ok, problems: v.problems,
        structuralNodes: v.report.structuralNodes, geometryHash: v.report.geometryHash,
      },
    }
    if (!v.ok) {
      report.written = false
    } else {
      writeFileSync(liteTmp, buildGlb(derived.json, derived.bin))
      renameSync(liteTmp, outPath)
      report.written = true
      report.outBytes = statSync(outPath).size
    }
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
  } catch (e) {
    rmSync(outPath, { force: true })
    rmSync(liteTmp, { force: true })
    report = { key, written: false, error: String(e && e.message || e).slice(0, 300) }
  }
  console.log(JSON.stringify(report))
  return report
}

async function main() {
  const mapDir = join(PACK, 'map')
  if (!existsSync(mapDir)) throw new Error(`pack map 目录不存在: ${mapDir}`)
  const keys = has('all')
    ? readdirSync(mapDir).filter((d) => existsSync(join(mapDir, d, 'scenery.glb')))
    : [argOf('map')]
  if (!keys.length) throw new Error('没有可派生的地图（缺 scenery.glb）')
  mkdirSync(REPORT_DIR, { recursive: true })

  const { server, origin } = await startMeanColor()
  let env = null
  try {
    const chrome = findChrome()
    env = await launchChromeForCdp(chrome, {})
    const { targetId, sessionId } = await env.openPage()
    const page = new Page(env.client, sessionId)
    await page.evaluate(`location.href = ${JSON.stringify(origin + '/mean')}`)
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 100))
      if (await page.evaluate('!!window.__mean').catch(() => false)) break
    }
    if (!(await page.evaluate('!!window.__mean'))) throw new Error('/mean 页面未就绪（均值色解码不可用）')

    /** 材质均值色：内嵌贴图 → Chrome 解码 → alpha 加权均值。解码失败返回 null（保留原因子）。 */
    const colorOf = async (_mat, bytes, mimeType) => {
      const b64 = Buffer.from(bytes).toString('base64')
      return page.evaluate(`window.__mean(${JSON.stringify(b64)}, ${JSON.stringify(mimeType || null)})`)
    }

    const results = []
    for (const key of keys) {
      results.push(await deriveMap({ mapDir, reportDir: REPORT_DIR, key, colorOf }))
    }
    writeFileSync(join(REPORT_DIR, 'summary.json'),
      JSON.stringify({ pack: PACK, generatedAt: new Date().toISOString(), maps: results }, null, 2))
    const ok = results.filter((r) => r.written).length
    console.error(`scenery-lite: ${ok}/${results.length} maps written (verify-gated)`)
    if (ok !== results.length) process.exitCode = 2   // 有图未过 verify：发布 gate 不通过
  } finally {
    // Chrome/CDP/临时 profile 必须显式释放（success / verify failure / page readiness
    // failure / per-map exception / summary write failure 全路径），不依赖 process exit
    try {
      await env?.close?.()
    } finally {
      await server.close()
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
