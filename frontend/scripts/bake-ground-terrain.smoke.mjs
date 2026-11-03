#!/usr/bin/env node
/**
 * ground-terrain 真实浏览器全链路 smoke（#857 修复轮 §2）：real BAKE_HTML → load（分层地面
 * fail-closed 读取）→ render → pixel-upload → renderTerrainOnly（真实 three 渲染 +
 * Uint8ClampedArray ImageData）→ groundTerrain（YX 翻转 + base 合成 + toBlob webp）→
 * /file-upload（tmp+rename）→ 最终 ground-terrain.webp 落盘。fixture 极小（无真实 WoT 地图），
 * webp 层贴图/底图由 Chrome canvas 现场生成后写盘。
 *
 * 必须独立抓住的回归：ImageData 用错 typed array、页面代码回归反引号、/file-upload handler
 * 失败、renameSync 缺失——任一发生本 smoke 都以真实链路失败，而不是被 fake page 绕过。
 *
 * 用法：pnpm run test:browser-bake-terrain（CI browser-medium job；需要 Chrome，无真实资产依赖）
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startBakeServer } from './bake-page-server.mjs'
import { bakeKey } from './bake-overhead-key.mjs'
import { buildGlb } from './scenery-lite/deriveLiteCore.mjs'

const SIZE = 256
const KEY = 'fixture'
const SPACE = 'fixture'

/** 最小合法场景 GLB：单三角网格（GLTFLoader 可解析、无变体 extras ⇒ 不触发 fail-closed）。 */
function fixtureSceneryGlb() {
  const pos = new Float32Array([0, 0, 0, 10, 0, 0, 0, 0, 10])
  const json = {
    asset: { version: '2.0', generator: 'bake-smoke fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Cube', mesh: 0 }],
    meshes: [{ name: 'cube', primitives: [{ attributes: { POSITION: 0 }, material: 0, mode: 4 }] }],
    materials: [{ name: 'plain', pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1] } }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength }],
    buffers: [{ byteLength: pos.byteLength }],
  }
  return buildGlb(json, new Uint8Array(pos.buffer))
}

/** Chrome canvas 现场生成 webp（分层地表 6 层 + 客户端底图），base64 回传后落盘。 */
async function makeWebp(page, r, g, b) {
  const expr = `(async () => {
    const c = document.createElement('canvas')
    c.width = 64; c.height = 64
    const ctx = c.getContext('2d')
    ctx.fillStyle = 'rgb(${r},${g},${b})'
    ctx.fillRect(0, 0, 64, 64)
    const blob = await new Promise((res) => c.toBlob(res, 'image/webp', 0.8))
    const buf = new Uint8Array(await blob.arrayBuffer())
    let s = ''
    for (const byte of buf) s += String.fromCharCode(byte)
    return btoa(s)
  })()`
  return Buffer.from(await page.evaluate(expr), 'base64')
}

const main = async () => {
  const root = mkdtempSync(join(tmpdir(), 'bake-smoke-pack-'))
  const pack = join(root, 'release', 'asset_pack')
  const baseDir = mkdtempSync(join(tmpdir(), 'bake-smoke-base-'))
  const defaultBaseDir = join(root, 'data', 'cache', 'maps')
  const mapDir = join(pack, 'map', KEY)
  mkdirSync(join(mapDir, 'ground'), { recursive: true })

  // fixture 资产：场景 GLB + 配对地形（terrainBinSha256）+ 分层地表 + 逐图光照
  writeFileSync(join(mapDir, 'scenery.glb'), fixtureSceneryGlb())
  const n = 8
  const bin = new Uint16Array(n * n)
  for (let i = 0; i < bin.length; i++) bin[i] = (i % 5) * 2
  const meta = {
    size: n, span: 600, zmin: 0, zmax: 2, terrainLayout: 2,
    terrainBinSha256: createHash('sha256').update(new Uint8Array(bin.buffer)).digest('hex'),
    worldBounds: { min: [-300, -300], max: [300, 300] },
  }
  writeFileSync(join(mapDir, 'terrain.json'), JSON.stringify(meta))
  writeFileSync(join(mapDir, 'terrain.u16.bin'), new Uint8Array(bin.buffer))
  writeFileSync(join(mapDir, 'ground.layers.json'), JSON.stringify({
    tiling: [1, 1],
    tile_scale: [1, 1, 1, 1],
    tile_colors: [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]],
    flat_color: [1, 1, 1],
    lm_adjust: [1, 1, 1],
    tilemask_weight: 1,
    hb_scale: [0, 0, 0, 0],
    hb_offset: [0, 0, 0, 0],
    hb_softness: [1, 1, 1, 1],
  }))
  writeFileSync(join(mapDir, 'lighting.json'), JSON.stringify({}))

  let env = null
  let server = null
  try {
    const chrome = findChrome()
    env = await launchChromeForCdp(chrome, {})
    const { sessionId } = await env.openPage()
    const page = new Page(env.client, sessionId)
    // fixture 贴图：先于断言生成（写盘后由 /pack、/base 伺服）
    const layers = { cm: [90, 90, 90], lm: [40, 40, 40], tile0: [120, 110, 100], tile1: [80, 90, 120], mask0: [128, 128, 128], mask1: [64, 64, 64] }
    for (const [k, [r, g, b]] of Object.entries(layers)) writeFileSync(join(mapDir, 'ground', `${k}.webp`), await makeWebp(page, r, g, b))
    writeFileSync(join(baseDir, `${SPACE}.ground.webp`), await makeWebp(page, 70, 130, 70))
    mkdirSync(defaultBaseDir, { recursive: true })
    writeFileSync(join(defaultBaseDir, `${SPACE}.ground.webp`), await makeWebp(page, 180, 40, 40))

    const started = await startBakeServer({ pack, baseDir, size: SIZE })
    server = started.server
    await page.evaluate(`location.href = ${JSON.stringify(started.origin + '/bake')}`)
    let ready = false
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 100))
      try { ready = await page.evaluate('!!window.__bake') } catch { ready = false }
      if (ready) break
    }
    if (!ready) {
      let errs = '[]'
      try { errs = await page.evaluate('JSON.stringify(window.__bakeErr || [])') } catch {}
      throw new Error(`/bake 页面未就绪；页面错误=${errs}`)
    }
    await page.evaluate('window.__bake.init()')
    // 生产路径全链路：bakeKey（node 生命周期：产物清理 → load → render → pixel-upload →
    // rgba commit → ground-terrain 相）× 真实页面（renderTerrainOnly/ImageData/合成/toBlob/
    // /file-upload/renameSync）
    const outDir = join(pack, 'overhead')
    const result = await bakeKey({
      page, key: KEY, outDir, span: 600, size: SIZE, mapId: 7,
      uploadPath: started.uploadPath, pack, space: SPACE,
    })
    const gt = result.groundTerrain
    if (!gt || !gt.terrainRendered || !(gt.coverPct > 0)) {
      throw new Error('terrain-only 渲染未产出覆盖（ImageData/渲染回归？）: ' + JSON.stringify(result))
    }
    const gtPath = join(mapDir, 'ground-terrain.webp')
    if (!existsSync(gtPath)) throw new Error('ground-terrain.webp 未落盘（/file-upload 链路失败）')
    if (existsSync(`${gtPath}.tmp`)) throw new Error('.tmp 残留（renameSync 未执行）')
    const raw = readFileSync(gtPath)
    const riff = raw[0] === 0x52 && raw[1] === 0x49 && raw[2] === 0x46 && raw[3] === 0x46
    const webp = raw[8] === 0x57 && raw[9] === 0x45 && raw[10] === 0x42 && raw[11] === 0x50
    if (!riff || !webp || raw.length < 200) throw new Error(`产物不是有效 WEBP: magic=${raw.subarray(0, 12).toString('hex')} bytes=${raw.length}`)
    const meta = JSON.parse(readFileSync(join(outDir, `${KEY}.terrain.meta.json`), 'utf8'))
    if (meta.groundTerrain?.base !== SPACE) throw new Error('terrain meta 缺失/不匹配: ' + JSON.stringify(meta))
    console.log('bake ground-terrain smoke: OK', JSON.stringify({
      bake: { coverPct: result.coverPct, ground: true },
      gt: { coverPct: gt.coverPct, bytes: gt.bytes },
      out: { bytes: raw.length },
    }))

    // 子进程经过真实 CLI 和 startBakeServer；仅选中目录有原始底图，验证路径接线。
    const cli = fileURLToPath(new URL('./bake-ground-overhead.mjs', import.meta.url))
    function runCli(label, args) {
      rmSync(gtPath, { force: true })
      const run = spawnSync(process.execPath, [cli, '--pack', pack, '--size', String(SIZE), ...args],
        { encoding: 'utf8', timeout: 120000 })
      if (run.error || run.status !== 0 || !existsSync(gtPath)) {
        throw new Error(`${label} CLI 失败: ${run.error || run.status}\n${run.stdout}\n${run.stderr}`)
      }
      if (run.stderr.includes('ReferenceError')) throw new Error(`${label}: ${run.stderr}`)
      const records = run.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line))
      if (!records.some(record => record.key === KEY && record.groundTerrain?.base === SPACE)) {
        throw new Error(`${label} 未完成 fixture 烘焙: ${run.stdout}`)
      }
    }
    rmSync(join(defaultBaseDir, `${SPACE}.ground.webp`))
    runCli('--map --base-dir', ['--map', KEY, '--base-dir', baseDir])
    runCli('--all --base-dir', ['--all', '--base-dir', baseDir])
    writeFileSync(join(defaultBaseDir, `${SPACE}.ground.webp`), await makeWebp(page, 180, 40, 40))
    rmSync(join(baseDir, `${SPACE}.ground.webp`))
    runCli('--map 默认目录', ['--map', KEY])
    console.log('bake CLI startup: OK (--map explicit, --all explicit, default base-dir)')
  } finally {
    try { await env?.close?.() } catch { /* 尽力关闭 */ }
    await server?.close?.()
    rmSync(root, { recursive: true, force: true })
    rmSync(baseDir, { recursive: true, force: true })
  }
}

await main()
