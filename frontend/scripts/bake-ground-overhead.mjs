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
 */
import { createServer } from 'vite'
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, createReadStream } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'

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

const BAKE_HTML = `<!doctype html><html><body><script>
window.__bakeErr=[];
addEventListener('error',(e)=>window.__bakeErr.push('error: '+(e.message||e.type||'?')+' @'+String(e.filename||'').split('/').pop()+':'+(e.lineno||0)));
addEventListener('unhandledrejection',(e)=>window.__bakeErr.push('reject: '+String(e.reason)));
</script><script type="module">
import * as THREE from '/node_modules/three/build/three.module.js'
import { GLTFLoader } from '/node_modules/three/examples/jsm/loaders/GLTFLoader.js'
// 材质 SSOT：与 3D 运行时（playbackScene）同一份实现——俯视烘焙的观感基准
import { cachedSceneryMat, isWaterName, makeBillboardMaterial, makeSpeedtreeStaticMaterial, SCENERY_LAMBERT_EXPOSURE, disposeSceneGroup } from '/src/scene/sceneryMaterials.js'
import { pruneForeignVariants } from '/src/scene/variantFilter.js'

const SIZE = ${SIZE}
let renderer, scene, camera, group

// 光照与 playbackScene.initScene 同参（半球 2.4 + 平行光 3.0 + ACES 1.15）：
// 俯视图的观感基准是 3D 档的实际画面。
async function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setSize(SIZE, SIZE)
  renderer.setPixelRatio(1)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  renderer.setClearColor(0x000000, 0)          // 透明清屏：alpha 即覆盖掩膜
  scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.4))
  const sun = new THREE.DirectionalLight(0xffffff, 3.0)
  sun.position.set(0, 1, 0)
  scene.add(sun)
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000)
  camera.position.set(0, 1000, 0)
  camera.up.set(0, 0, -1)
  camera.lookAt(0, 0, 0)
  renderer.domElement.style.display = 'none'
  document.body.appendChild(renderer.domElement)
  const gl = renderer.getContext()
  return { size: SIZE, webgl2: renderer.capabilities.isWebGL2, gpu: gl.getParameter(gl.RENDERER) }
}

async function load(key, span = 600, mapId = null) {
  if (group) {                       // --all 批处理：上一张必须卸载，否则场景逐张
    scene.remove(group)              // 累积——后续每张都叠着此前全部地图的几何
    disposeSceneGroup(group)         // （实测第 2 张起 coverPct 恒 100 的根因）。
    group = null                     // disposeSceneGroup 同时清 uniforms 纹理与
  }                                  // 材质缓存——共享 SpeedTree 贴图不回收会随图数累积显存（评审 P2）
  const url = location.origin + '/pack/map/' + encodeURIComponent(key) + '/scenery.glb'
  const bytes = await (await fetch(url)).arrayBuffer()
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(bytes, '', res, rej))   // arrayBuffer() 已是 ArrayBuffer，别再取 .buffer
  // 变体裁剪：与 3D 运行时同一实现（mapId 对应激活的 LabelComponent 变体组）
  pruneForeignVariants(gltf.scene, mapId)
  // 排除规则与 python 管线一致：损毁态变体（D_/State N）、隐形墙、天空球、水面
  //（地形图已含水系配色）、跨变体标记节点（extras.mdVariant——变体图共享底图，
  // 只烘无标记节点，否则重新引入跨变体幻影物体的 bug）
  const drop = []
  gltf.scene.traverse((o) => {
    const nm = o.name || ''
    if (/^D_|State ?[1-9]|invisible|sky|dome|loonar|spacedome|stars|surroundings|^plane|water|sea|river|lake/i.test(nm) || (o.userData && o.userData.mdVariant)) drop.push(o)
  })
  for (const o of drop) o.removeFromParent()
  // 全幅环境壳剔除（名字黑名单兜底）：包围盒覆盖 ≥90% 图幅的顶层子树——天空穹顶/
  // 远景板/隐形罩在真实场景里是环境壳（游戏内不可见或半透明），不是物体。
  // moon 的穹顶就是「父节点 spacedome 有名、mesh 无名」结构，名字规则打不中。
  const fullSpan = new THREE.Box3()
  for (const child of [...gltf.scene.children]) {
    const box = new THREE.Box3().setFromObject(child)
    const w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z)
    if (w >= span * 0.9) {
      fullSpan.union(box)
      child.removeFromParent()
      drop.push(child)
    }
  }
  void fullSpan
  // qFrame：与 playbackScene 同一帧变换（GLB 游戏系 z 上 → 回放场景系）
  group = new THREE.Group()
  group.rotation.order = 'YXZ'
  group.rotation.set(-Math.PI / 2, Math.PI, 0)
  // 退化几何剔除（与 3D 运行时同式：撕裂批次不渲染）
  const degenerate = []
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return
    const g0 = o.geometry
    const vc = g0.attributes.position ? g0.attributes.position.count : 0
    const ic = g0.index ? g0.index.count : vc
    if (vc > 0 && (ic / 3) / vc > 15) degenerate.push(o)
  })
  for (const o of degenerate) o.removeFromParent()
  // 材质转换：与 3D 运行时同一实现（SSOT 场景材质模块）。键组成必须与
  // playbackScene 的 convMat 逐字一致——同 key 同材质、跨端观感一致（守卫锁定）。
  const convMat = (m, isCard) => cachedSceneryMat(
    [isCard ? 'C' : 'M', m.name || '', m.map ? m.map.uuid : '',
     m.color ? [m.color.r, m.color.g, m.color.b].map((v) => v.toFixed(4)).join(',') : '',
     m.alphaMode || '', m.alphaTest ?? 0, !!m.transparent, m.opacity ?? 1,
     !!m.vertexColors,
     (m.userData && m.userData.occMean) || ''].join('|'),
    () => (isCard ? makeBillboardMaterial(m) : (() => {
      const opaqueEnough = (m.opacity ?? 1) >= 0.99;
      if ((m.name || '').startsWith('ST|')) { return makeSpeedtreeStaticMaterial(m, opaqueEnough); }
      const pseudoOpaque = !!m.transparent && (m.opacity ?? 1) >= 0.99;
      const nm = new THREE.MeshLambertMaterial({
        map: m.map || null,
        color: (m.color ? m.color.clone() : new THREE.Color(0xffffff)).multiplyScalar(SCENERY_LAMBERT_EXPOSURE),
        transparent: !!m.transparent && !pseudoOpaque,
        opacity: m.opacity ?? 1,
        side: THREE.DoubleSide,
      });
      if (m.alphaTest > 0) nm.alphaTest = m.alphaTest;
      if (pseudoOpaque) nm.alphaTest = Math.max(nm.alphaTest || 0, 0.33);
      if (nm.transparent) nm.depthWrite = false;
      nm.flatShading = true;
      return nm;
    })()))
  gltf.scene.traverse((o) => {
    if (!o.isMesh || !o.material) return
    const isCard = !!o.geometry.attributes._corner
    o.material = Array.isArray(o.material) ? o.material.map((m) => convMat(m, isCard))
                                           : convMat(o.material, isCard)
    if (isWaterName(o.name)) {
      const ms = Array.isArray(o.material) ? o.material : [o.material]
      for (const mm of ms) {
        if (!mm || !mm.transparent) continue
        mm.depthWrite = true
        mm.side = THREE.DoubleSide
        mm.depthTest = true
        mm.needsUpdate = true
      }
    }
  })
  group.add(gltf.scene)
  scene.add(group)
  return { ok: true, degenerate: degenerate.length }
}

// 调试：对象 ID 拾取——每个 mesh 临时换唯一编码色渲染，读像素反查覆盖者
let __meshes = [], __idbuf = null, __names = []
function renderIdPass(span) {
  if (!__idbuf) {
    group.traverse((o) => { if (o.isMesh) __meshes.push(o) })
    __names = __meshes.map((m, i) => m.name || (m.parent && m.parent.name) || ('mesh#' + i))
    __idbuf = new Uint8Array(SIZE * SIZE * 4)
  }
  const orig = __meshes.map((m) => m.material)
  __meshes.forEach((m, i) => {
    const c = new THREE.Color(((i + 1) >> 16 & 255) / 255, ((i + 1) >> 8 & 255) / 255, ((i + 1) & 255) / 255)
    m.material = new THREE.MeshBasicMaterial({ color: c })
  })
  camera.updateProjectionMatrix()
  renderer.render(scene, camera)
  __meshes.forEach((m, i) => { m.material = orig[i] })
  const gl = renderer.getContext()
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, __idbuf)
  const row = SIZE * 4
  const flipped = new Uint8Array(__idbuf.length)
  for (let y = 0; y < SIZE; y++) flipped.set(__idbuf.subarray(y * row, (y + 1) * row), (SIZE - 1 - y) * row)
  __idbuf = flipped
  return __meshes.length
}
function idAt(x, y) {
  const i = (y * SIZE + x) * 4
  const idx = (__idbuf[i] << 16) | (__idbuf[i + 1] << 8) | __idbuf[i + 2]
  return idx > 0 ? (__names[idx - 1] + '#' + idx) : '(empty)'
}

function render(span) {
  camera.left = -span / 2; camera.right = span / 2
  camera.top = span / 2; camera.bottom = -span / 2
  camera.updateProjectionMatrix()
  renderer.render(scene, camera)
  const gl = renderer.getContext()
  const buf = new Uint8Array(SIZE * SIZE * 4)
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, buf)
  // readPixels 行序自下而上：翻成图像行序（上到下），python 侧免翻转
  const row = SIZE * 4
  const flipped = new Uint8Array(buf.length)
  for (let y = 0; y < SIZE; y++) flipped.set(buf.subarray(y * row, (y + 1) * row), (SIZE - 1 - y) * row)
  window.__buf = flipped
  let covered = 0
  for (let i = 3; i < flipped.length; i += 4) if (flipped[i] > 8) covered++
  return { covered, coverPct: +(100 * covered / (SIZE * SIZE)).toFixed(2) }
}

window.__bake = { init, load, render, renderIdPass, idAt }
</script></body></html>`

/** 极简 vite：只为 /bake 页面（import three）与 /pack/*（场景 GLB）服务。 */
async function startServer() {
  const server = await createServer({
    configFile: false,
    root: frontendRoot,
    logLevel: 'error',
    plugins: [{
      name: 'bake-pack-server',
      configureServer(server) {
        server.middlewares.use('/pack', (req, res) => {
          const rel = decodeURIComponent(req.url.replace(/^\//, '')).split('?')[0]
          const file = join(PACK, rel)
          if (!file.startsWith(PACK) || !existsSync(file)) { res.statusCode = 404; return res.end('nf') }
          res.setHeader('access-control-allow-origin', '*')
          res.setHeader('content-type', rel.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream')
          createReadStream(file).pipe(res)
        })
        server.middlewares.use('/bake', (_req, res) => {
          res.setHeader('content-type', 'text/html')
          res.end(BAKE_HTML)
        })
        server.middlewares.use('/pixel-upload', (req, res) => {
          mkdirSync(join(PACK, 'overhead'), { recursive: true })
          if (req.method !== 'POST') { res.statusCode = 405; return res.end() }
          const chunks = []
          let total = 0
          req.on('data', (c) => { chunks.push(c); total += c.length })
          req.on('end', () => {
            const body = Buffer.concat(chunks, total)
            writeFileSync(join(PACK, 'overhead', 'upload.rgba'), body)
            res.end('ok:' + body.length)
          })
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

async function bakeKey(page, key, outDir, span) {
  const t0 = Date.now()
  await page.evaluate(`window.__bake.load(${JSON.stringify(key)}, ${span}, ${primaryMapIdOf(key)})`)
  const stats = await page.evaluate(`window.__bake.render(${span})`)
  const total = SIZE * SIZE * 4
  await page.evaluate(`fetch('/pixel-upload', { method: 'POST', body: window.__buf }).then(r => r.text())`)
  const upload = join(PACK, 'overhead', 'upload.rgba')
  if (!existsSync(upload)) throw new Error('pixel upload missing')
  const raw = readFileSync(upload)
  if (raw.length !== total) throw new Error(`pixel upload ${raw.length}B != expected ${total}B`)
  writeFileSync(join(outDir, `${key}.rgba`), raw)
  writeFileSync(join(outDir, `${key}.meta.json`), JSON.stringify({ key, span, size: SIZE, ...stats }))
  return { key, coverPct: stats.coverPct, mb: +(raw.length / 1048576).toFixed(1), ms: Date.now() - t0 }
}

const main = async () => {
  const outDir = join(PACK, 'overhead')
  mkdirSync(outDir, { recursive: true })
  const { server, origin } = await startServer()
  const chrome = findChrome()
  // gpu 模式显式指定 Windows ANGLE D3D11 后端——headless 默认会回落 SwiftShader
  const env = await launchChromeForCdp(chrome, has('gpu')
    ? { gpu: true, extraArgs: ['--use-gl=angle', '--use-angle=d3d11'] }
    : {})   // --gpu：真 GPU（RTX）+ D3D11 ANGLE；缺省 SwiftShader 软渲染
  try {
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
    console.error('bake origin:', origin, '| maps:', keys.length)
    for (const key of keys) {
      try {
        console.log(JSON.stringify(await bakeKey(page, key, outDir, spans[key])))
        if (process.env.PICK) {
          const n = await page.evaluate(`window.__bake.renderIdPass(${spans[key]})`)
          const pts = [[60, 60], [SIZE >> 1, 60], [SIZE - 60, 60], [60, SIZE >> 1], [SIZE >> 1, SIZE >> 1], [SIZE - 60, SIZE >> 1], [60, SIZE - 60], [SIZE >> 1, SIZE - 60], [SIZE - 60, SIZE - 60]]
          const picks = []
          for (const [x, y] of pts) picks.push(await page.evaluate(`window.__bake.idAt(${x}, ${y})`))
          console.log(JSON.stringify({ key, pick: Object.assign(...pts.map(([x, y], i) => ({ [x + ',' + y]: picks[i] }))) }))
        }
      } catch (e) {
        console.log(JSON.stringify({ key, error: String(e).slice(0, 300) }))
      }
    }
  } finally {
    await env.close()
    await server.close()
  }
}
await main()
