#!/usr/bin/env node
/**
 * GPU 版场景正交俯视烘焙：用**真实 three.js 运行时**把场景 GLB 渲染成俯视图，
 * 取代 tools/bake_ground_roofs.py 的 Python 软光栅（逐三角形跑在解释器里，
 * 单图 2~4 分钟，且材质重实现已两次偏离真实观感）。
 *
 * 原理：headless Chrome（复用门禁的 browser-chrome CDP 驱动，SwiftShader 软件
 * WebGL 即可）里用 three.js 正交相机从地图上空渲染一帧——材质/叶卡 alpha/顶点
 * 色/光照全部走 GPU 与真实 shader，4096² 一帧秒级。像素回传后由
 * tools/composite_overhead.py 做朝向配准（与 ground.webp 自身相关，信号锐利）
 * 并合成写盘。
 *
 * 用法：
 *   node scripts/bake-ground-overhead.mjs --pack "D:/.../release/asset_pack" --map medvedkovo
 *   node scripts/bake-ground-overhead.mjs --pack "..." --all
 * 产物：<pack>/overhead/<key>.rgba + .meta.json，
 * 随后 python tools/composite_overhead.py 逐图合成（见该文件）。
 * 地形（terrain.json / terrain.u16.bin 缺一或不配对）或分层地表（ground.layers.json /
 * ground/<layer>.webp）不完整的图 fail-closed：该图输出 {key,error}，且该图上一轮的
 * <key>.rgba / .meta.json 在本图开烘前即删除（失败 = 无产物，合成器不会读到旧成品）。
 * meta.ground=true 只表示 .rgba 含完整分层地面 pass；json+bin 均缺的图 ground=false。
 */
import { createServer } from 'vite'
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync, mkdirSync, createReadStream } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { startBakeServer } from './bake-page-server.mjs'
import { Page } from './browser-page.mjs'
import { bakeKey } from './bake-overhead-key.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(here, '..')

const args = process.argv.slice(2)
const argOf = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const has = (name) => args.includes(`--${name}`)
const PACK = resolve(argOf('pack', 'D:/Class/Rust/Project/release/asset_pack'))
const SIZE = Number(argOf('size', 4096))
// 客户端原始底图与已合成的 ground.webp 不同，不能以成品代替。
function baseDirOf() {
  return resolve(argOf('base-dir', join(PACK, '..', '..', 'data', 'cache', 'maps')))
}

function primaryMapIdOf(key) {
  const mapIndex = argOf('map-index', 'D:/Class/Rust/Project/map_index.json')
  try {
    const idx = JSON.parse(readFileSync(mapIndex, 'utf8'))
    const arr = Array.isArray(idx) ? idx : idx.maps || Object.values(idx)
    const hit = arr.find((x) => x.key === key)
    return hit ? hit.map_id : null
  } catch {
    return null
  }
}

function spanOf(key) {
  // key → space 用 Agent 仓注册表（包内 index 不带 space）；缺注册表/缺 sidecar
  // 时回退 600（worldBounds ±300 的通用值，与 python 管线同一缺省）
  const mapIndex = argOf('map-index', 'D:/Class/Rust/Project/map_index.json')
  let space = key
  try {
    const idx = JSON.parse(readFileSync(mapIndex, 'utf8'))
    const arr = Array.isArray(idx) ? idx : idx.maps || Object.values(idx)
    const hit = arr.find((x) => x.key === key)
    if (hit?.space) space = hit.space
  } catch { /* 回退默认 */ }
  try {
    const side = JSON.parse(readFileSync(resolve(PACK, '..', '..', 'data', 'cache', 'maps', `${space}.json`), 'utf8'))
    const b = side.worldBounds
    return Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1])
  } catch {
    return 600
  }
}

function spaceOf(key) {
  // key → space（ground-terrain 合成的客户端原始底图名 = {space}.ground.webp）；
  // 缺注册表回退 key 本身（与 composite_overhead.py space_of 同式）
  const mapIndex = argOf('map-index', 'D:/Class/Rust/Project/map_index.json')
  try {
    const idx = JSON.parse(readFileSync(mapIndex, 'utf8'))
    const arr = Array.isArray(idx) ? idx : idx.maps || Object.values(idx)
    const hit = arr.find((x) => x.key === key)
    return hit?.space || key
  } catch {
    return key
  }
}

const main = async () => {
  const baseDir = baseDirOf()
  if (!existsSync(baseDir)) throw new Error(`客户端原始底图目录不存在: ${baseDir}（请通过 --base-dir 指定）`)
  const outDir = join(PACK, 'overhead')
  mkdirSync(outDir, { recursive: true })
  const { server, origin, uploadPath: UPLOAD } = await startBakeServer({ pack: PACK, baseDir, size: SIZE })
  let env = null
  try {
    const chrome = findChrome()
    // gpu 模式显式指定 Windows ANGLE D3D11 后端——headless 默认会回落 SwiftShader
    env = await launchChromeForCdp(chrome, has('gpu')
      ? { gpu: true, extraArgs: ['--use-gl=angle', '--use-angle=d3d11'] }
      : {})
    const { targetId, sessionId } = await env.openPage()
    const page = new Page(env.client, sessionId)
    await page.evaluate(`location.href = ${JSON.stringify(origin + '/bake')}`)
    // 轮询直到 __bake 就绪（替掉原先固定 1s 的等待——冷启动/慢机器会假失败）；
    // 超时则把页面的 error / unhandledrejection 带出来，不再只报"未定义"。
    let bakeReady = false
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 100))
      try { bakeReady = await page.evaluate('!!window.__bake') } catch { bakeReady = false }
      if (bakeReady) break
    }
    if (!bakeReady) {
      let errs = '[]'
      try { errs = await page.evaluate('JSON.stringify(window.__bakeErr || [])') } catch {}
      throw new Error(`/bake 页面 12s 未就绪（window.__bake 未定义）；页面错误=${errs}`)
    }
    console.error('page ready:', JSON.stringify(await page.evaluate('window.__bake.init()')))
    const keys = has('all')
      ? readdirSync(join(PACK, 'map')).filter((d) => existsSync(join(PACK, 'map', d, 'scenery.glb')))
      : [argOf('map')]
    const spans = Object.fromEntries(keys.map((k) => [k, spanOf(k)]))   // 先算齐：fail-fast 不泄漏服务器
    const spaces = Object.fromEntries(keys.map((k) => [k, spaceOf(k)]))
    console.error('bake origin:', origin, '| maps:', keys.length)
    let failed = 0
    for (const key of keys) {
      try {
        console.log(JSON.stringify(await bakeKey({ page, key, outDir, span: spans[key], size: SIZE,
                                                   mapId: primaryMapIdOf(key), uploadPath: UPLOAD,
                                                   pack: PACK, space: spaces[key] })))
        if (process.env.PICK) {
          const n = await page.evaluate(`window.__bake.renderIdPass(${spans[key]})`)
          const pts = [[60, 60], [SIZE >> 1, 60], [SIZE - 60, 60], [60, SIZE >> 1], [SIZE >> 1, SIZE >> 1], [SIZE - 60, SIZE >> 1], [60, SIZE - 60], [SIZE >> 1, SIZE - 60], [SIZE - 60, SIZE - 60]]
          const picks = []
          for (const [x, y] of pts) picks.push(await page.evaluate(`window.__bake.idAt(${x}, ${y})`))
          console.log(JSON.stringify({ key, pick: Object.assign(...pts.map(([x, y], i) => ({ [x + ',' + y]: picks[i] }))) }))
        }
      } catch (e) {
        failed++
        console.log(JSON.stringify({ key, error: String(e).slice(0, 300) }))
      }
    }
    if (failed) process.exitCode = 2
  } finally {
    try { await env?.close() } finally { await server.close() }
  }
}
await main()
