#!/usr/bin/env node
/**
 * Texture-Baked Top-View baker（production-grade，泛化自 Maus prototype）。
 *
 * BlitzKit GLB + tanks.pb + models.pb → 真实 geometry/UV/material/textures
 * → 确定性正交俯视 bake（z-buffer + barycentric UV + alpha test + 中性化）
 * → 正式资产：hull.webp（固定 640×640）/ turret.webp（turreted，尺寸可变）/ metadata.json
 *   （320 logical；turret 尺寸/原点/枢轴以顶层 turretRaster 为准）。
 *
 * 数据驱动（不依赖 display name、不假设 turret_01/gun_01 永远最终模块）：
 * - tankId / baseModelKey / kind：frontend/src/vehicle-models/mapping.js（已审核 inventory）；
 * - selected turret/gun/track：tanks.pb + models.pb（turrets/tracks/guns 数组最后，
 *   BlitzKit tankToDuelMember 语义）→ model_id → GLB 节点名；
 * - turretPivot：models.pb turretOrigin（引擎坐标 → 模型坐标 → 投影）。
 *
 * Contract：
 * - turreted：hull 场景 = hull + tracks；turret 场景 = selected turret + mantlet + gun
 *   （独立 z-buffer/bake——旋转 turret 不会暴露 hull 空洞）；
 * - turretless：不生成独立 turret 层——gun/mantlet/casemate 全部 bake 进 hull asset；
 * - metallic/roughness：顶视中性 bake 无 specular——检查后报告，不加入（§5）；
 * - 输出适度去色（desaturate=0.25 → 75% 原色 + 25% luma）保留纹理结构
 *   （grille/panel/vent/AO/relief）（§6；Blocker 3 语义反向修复，视觉不变）。
 *
 * 网络边界与 extractor CLI 相同：本脚本是唯一允许访问 BlitzKit 网络的 developer 工具；
 * production / Battle Playback / CI 不访问。依赖 python + PIL（仅 developer 环境）。
 *
 * 用法（frontend 目录）：
 *   node scripts/bake-tier-x-topview.mjs --model-key maus
 *   node scripts/bake-tier-x-topview.mjs --tank-id 6929
 *   node scripts/bake-tier-x-topview.mjs --model-key maus --out-dir ../tmp/x
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { NodeIO } from '@gltf-transform/core'
import * as THREE from 'three'
import { MODEL_DEFINITIONS, TANK_ID_TO_MODEL } from '../src/vehicle-models/mapping.js'
import { bakeTopView, encodePng } from './texture-bake-lib.mjs'
import {
  BLITZKIT_MODELS_PROTO,
  BLITZKIT_TANKS_MIN_PROTO,
  correctZYTuple,
  decodeBlitzkitPb,
  projectTopDown,
  resolveBakeScenes,
  selectDefaultModules,
} from './extractor-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const CACHE_DIR = join(ROOT, 'frontend', 'scripts', '.vehicle-model-refs')
const API = 'https://api.blitzkit.app'
const VIEWBOX = { width: 320, height: 320 }
const PHYSICAL = 640
const SUPERSAMPLE = 2 // 1280 内部渲染 → 640 输出（4x AA）
// desaturate 语义（Blocker 3 修复）：neutralize amount = 去色强度（0=原色，1=纯灰）。
// 0.25 = 保留 75% 原色 + 25% luma ——与旧 0.75（反向语义）视觉数学等价，像素不变。
const DESATURATE = 0.25

const args = process.argv.slice(2)
function argValue(argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const modelKeyArg = argValue(args, '--model-key')
const tankIdArg = Number(argValue(args, '--tank-id') ?? '')
const outDirArg = argValue(args, '--out-dir')

let modelKey
let tankId
if (modelKeyArg) {
  const def = MODEL_DEFINITIONS[modelKeyArg]
  if (!def) throw new Error(`modelKey ${modelKeyArg} 不在 MODEL_DEFINITIONS 中`)
  modelKey = modelKeyArg
  tankId = def.tankIds[0]
} else if (tankIdArg) {
  tankId = tankIdArg
  modelKey = TANK_ID_TO_MODEL[String(tankId)]
  if (!modelKey) throw new Error(`tankId ${tankId} 不在 Tier X mapping 中`)
} else {
  console.error('必须提供 --model-key 或 --tank-id')
  process.exit(2)
}
const kind = MODEL_DEFINITIONS[modelKey].kind
console.log(`== ${modelKey} (${tankId}) kind=${kind} ==`)

async function download(url, dest) {
  if (existsSync(dest)) return dest
  mkdirSync(dirname(dest), { recursive: true })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载失败 ${url}: HTTP ${res.status}`)
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
  return dest
}

// —— 数据驱动：tanks.pb + models.pb → selected modules ——
const glbPath = await download(`${API}/tanks/${tankId}/model.glb`, join(CACHE_DIR, 'models', `${tankId}.glb`))
const modelsPbPath = await download(`${API}/definitions/models.pb`, join(CACHE_DIR, 'definitions', 'models.pb'))
const tanksPbPath = await download(`${API}/definitions/tanks.pb`, join(CACHE_DIR, 'definitions', 'tanks.pb'))
const tankDefs = decodeBlitzkitPb(readFileSync(tanksPbPath), 'blitzkit.TankDefinitions', BLITZKIT_TANKS_MIN_PROTO)
const modelDefs = decodeBlitzkitPb(readFileSync(modelsPbPath), 'blitzkit.ModelDefinitions', BLITZKIT_MODELS_PROTO)
const modules = selectDefaultModules(tankDefs, modelDefs, tankId)
console.log(`  selected: turret=${modules.turretId} model_id=${modules.turretModelId} gun=${modules.gunId} model_id=${modules.gunModelId} track=${modules.trackId ?? 'n/a'}`)

const io = new NodeIO()
const doc = await io.read(glbPath)
const root = doc.getRoot()

// —— 材质 / 纹理解析（baseColor / occlusion / normal；MR 检查后报告不加入）——
const materials = root.listMaterials()
const texDefs = []
const texIndex = new Map()
const mrPresent = []
for (const mat of materials) {
  for (const slot of ['baseColor', 'occlusion', 'normal']) {
    const tex = slot === 'baseColor' ? mat.getBaseColorTexture()
      : slot === 'occlusion' ? mat.getOcclusionTexture()
      : mat.getNormalTexture()
    if (tex && !texIndex.has(tex)) {
      texIndex.set(tex, texDefs.length)
      texDefs.push({ name: tex.getName() ?? `tex${texDefs.length}`, bytes: tex.getImage() ?? null })
    }
  }
  if (mat.getMetallicRoughnessTexture()) mrPresent.push(mat.getName())
}
if (texDefs.some((t) => !t.bytes)) throw new Error('GLB 纹理缺失（无内嵌 image）——texture missing 需显式报错')
const tmpDir = join(CACHE_DIR, 'debug', 'bake-tmp')
mkdirSync(tmpDir, { recursive: true })
const textures = []
for (let i = 0; i < texDefs.length; i++) {
  const webpPath = join(tmpDir, `tex-${i}.webp`)
  const rgbaPath = join(tmpDir, `tex-${i}.rgba`)
  writeFileSync(webpPath, Buffer.from(texDefs[i].bytes))
  // stdio:'inherit'——沙箱/后台环境禁止捕获子进程 pipe 输出（EPERM）；结果走磁盘文件，仅需退出码
  const py = spawnSync('python', [join(ROOT, 'frontend', 'scripts', 'decode-webp.py'), webpPath, rgbaPath], { stdio: 'inherit' })
  if (py.status !== 0) throw new Error(`WEBP 解码失败 tex${i}（python 退出码 ${py.status}，详见上方输出）`)
  const buf = readFileSync(rgbaPath)
  const w = buf.readUInt32LE(0)
  const h = buf.readUInt32LE(4)
  const data = new Float32Array(buf.length - 8)
  for (let j = 0; j < data.length; j++) data[j] = buf[j + 8]
  textures.push({ data, width: w, height: h })
}
console.log(`  textures: ${texDefs.map((t, i) => `${t.name} ${textures[i].width}x${textures[i].height}`).join(' | ')}`)
console.log(`  metallicRoughness textures present: ${mrPresent.length ? mrPresent.join(', ') : 'none'}——顶视中性 bake 无 specular，不加入（§5）`)

// —— 场景组装（resolveBakeScenes 按真实模块 id → 节点名）——
const allNodes = root.listNodes()
const nodeNames = allNodes.map((n) => n.getName())
const { hullNames, turretNames } = resolveBakeScenes(nodeNames, {
  turretModelId: modules.turretModelId,
  gunModelId: modules.gunModelId,
  kind,
})
console.log(`  scenes: hull=[${hullNames.join(', ')}] turret=[${turretNames.join(', ')}]`)

const nodeMatrix = (node) => {
  const m = new THREE.Matrix4()
  m.compose(
    new THREE.Vector3(...(node.getTranslation() || [0, 0, 0])),
    new THREE.Quaternion(...(node.getRotation() || [0, 0, 0, 1])),
    new THREE.Vector3(...(node.getScale() || [1, 1, 1])),
  )
  return m
}
const collectScene = (node, m, out, source) => {
  const mesh = node.getMesh()
  if (mesh) {
    for (const prim of mesh.listPrimitives()) {
      const posAcc = prim.getAttribute('POSITION')
      if (!posAcc) continue
      const pos = posAcc.getArray()
      const uv0 = prim.getAttribute('TEXCOORD_0')?.getArray() ?? null
      const idxArr = prim.getIndices()?.getArray() ?? null
      const matIdx = materials.indexOf(prim.getMaterial())
      const v = new THREE.Vector3()
      const verts = []
      for (let i = 0; i < pos.length; i += 3) {
        v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(m)
        verts.push(v.x, v.y, v.z)
      }
      const t = idxArr ? idxArr : Array.from({ length: pos.length / 3 }, (_, k) => k)
      const pa = new THREE.Vector3()
      const pb = new THREE.Vector3()
      const pc = new THREE.Vector3()
      for (let i = 0; i < t.length; i += 3) {
        const a = pa.set(verts[t[i] * 3], verts[t[i] * 3 + 1], verts[t[i] * 3 + 2])
        const b = pb.set(verts[t[i + 1] * 3], verts[t[i + 1] * 3 + 1], verts[t[i + 1] * 3 + 2])
        const c = pc.set(verts[t[i + 2] * 3], verts[t[i + 2] * 3 + 1], verts[t[i + 2] * 3 + 2])
        out.push({
          p: [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z],
          uv: uv0 ? [uv0[t[i] * 2], uv0[t[i] * 2 + 1], uv0[t[i + 1] * 2], uv0[t[i + 1] * 2 + 1], uv0[t[i + 2] * 2], uv0[t[i + 2] * 2 + 1]] : null,
          material: matIdx,
          source,
        })
      }
    }
  }
  for (const c of node.listChildren()) collectScene(c, m.clone().multiply(nodeMatrix(node)), out, source)
}
const identity = new THREE.Matrix4()
const hullScene = []
const turretScene = []
const gunScene = []
const gunName = 'gun_' + String(modules.gunModelId).padStart(2, '0')
for (const name of hullNames) {
  const node = allNodes.find((n) => n.getName() === name)
  if (node) collectScene(node, identity, hullScene, name)
}
for (const name of turretNames) {
  const node = allNodes.find((n) => n.getName() === name)
  if (!node) continue
  collectScene(node, identity, turretScene, name)
  if (name === gunName) collectScene(node, identity, gunScene, name)
}
if (hullScene.length === 0) throw new Error('hull 场景为空——节点名匹配失败（GLB 结构异常）')
if (kind === 'turreted' && turretScene.length === 0) throw new Error(`turreted 但 turret 场景为空（turret_${String(modules.turretModelId).padStart(2, '0')} 未找到）`)
console.log(`  tris: hull=${hullScene.length} turret=${turretScene.length} gun=${gunScene.length}`)

// —— fit（与 extractor 相同的逻辑空间；turreted = hull + turret 主体，gun 允许 overflow）——
const boundsOf = (tris) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const t of tris) {
    for (let i = 0; i < 9; i += 3) {
      if (t.p[i] < minX) minX = t.p[i]
      if (t.p[i] > maxX) maxX = t.p[i]
      if (t.p[i + 1] < minY) minY = t.p[i + 1]
      if (t.p[i + 1] > maxY) maxY = t.p[i + 1]
    }
  }
  return { minX, minY, maxX, maxY }
}
const turretName = 'turret_' + String(modules.turretModelId).padStart(2, '0')
const hullB = boundsOf(hullScene)
const turretMainB = kind === 'turreted' ? boundsOf(turretScene.filter((t) => t.source === turretName)) : null
const gunB = kind === 'turreted' ? boundsOf(gunScene) : null
const fitB = kind === 'turreted'
  ? {
      minX: Math.min(hullB.minX, turretMainB.minX),
      minY: Math.min(hullB.minY, turretMainB.minY),
      maxX: Math.max(hullB.maxX, turretMainB.maxX),
      maxY: Math.max(hullB.maxY, turretMainB.maxY),
    }
  : hullB // turretless：gun/casemate 全部进 hull，fit 含全部
const w = fitB.maxX - fitB.minX
const h = fitB.maxY - fitB.minY
if (!(w > 0) || !(h > 0)) throw new Error('fit bounds 无效')
const scale = (Math.min(VIEWBOX.width, VIEWBOX.height) * 0.88) / Math.max(w, h)
const cx = (fitB.minX + fitB.maxX) / 2
const cy = (fitB.minY + fitB.maxY) / 2
const tx = VIEWBOX.width / 2 - cx * scale
const ty = VIEWBOX.height / 2 - cy * scale
console.log(`  fit: scale=${scale.toFixed(4)} bounds=(${fitB.minX.toFixed(2)},${fitB.minY.toFixed(2)})..(${fitB.maxX.toFixed(2)},${fitB.maxY.toFixed(2)})`)
const canvasBounds = {
  minX: -tx / scale,
  maxX: (VIEWBOX.width - tx) / scale,
  minY: -ty / scale,
  maxY: (VIEWBOX.height - ty) / scale,
}

const materialsDef = materials.map((mat) => {
  const texOf = (t) => (t ? texIndex.get(t) ?? -1 : -1)
  return {
    baseColor: texOf(mat.getBaseColorTexture()),
    occlusion: texOf(mat.getOcclusionTexture()),
    normal: texOf(mat.getNormalTexture()),
    alphaMode: mat.getAlphaMode() ?? 'OPAQUE',
    alphaCutoff: mat.getAlphaCutoff?.() ?? 0.05,
  }
})

// —— bake（raster overflow contract）——
// hull：固定 320 logical 画布（640×640，outputSize 固定）；turret：画布扩展为
// turret+mantlet+完整 gun 的 logical bounds（保持同一 fit.scale——车辆主体不缩放，
// 透明 canvas 向 320 画布外扩展，避免炮管裁切）。
const pxPerM = scale * 2 // 输出像素/米（640/320）
const bakeScene = (scene, boundsWorld, outputSize = null) => {
  const w = boundsWorld.maxX - boundsWorld.minX
  const h = boundsWorld.maxY - boundsWorld.minY
  if (!(w > 0) || !(h > 0)) throw new Error('scene bounds 无效')
  const resW = Math.max(2, Math.ceil(w * pxPerM * SUPERSAMPLE / 2) * 2) // 偶数（可整除 supersample）
  const resH = Math.max(2, Math.ceil(h * pxPerM * SUPERSAMPLE / 2) * 2)
  const out = bakeTopView({ triangles: scene, textures, materials: materialsDef, bounds: boundsWorld, resolution: Math.max(resW, resH), desaturate: DESATURATE })
  const W = outputSize ? outputSize.w : Math.floor(out.width / SUPERSAMPLE)
  const H = outputSize ? outputSize.h : Math.floor(out.height / SUPERSAMPLE)
  const rgba = new Uint8Array(W * H * 4)
  const S = SUPERSAMPLE
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let dy = 0; dy < S; dy++) {
        for (let dx = 0; dx < S; dx++) {
          const i = ((y * S + dy) * out.width + (x * S + dx)) * 4
          r += out.rgba[i]
          g += out.rgba[i + 1]
          b += out.rgba[i + 2]
          a += out.rgba[i + 3]
        }
      }
      const n = S * S
      const o = (y * W + x) * 4
      rgba[o] = r / n
      rgba[o + 1] = g / n
      rgba[o + 2] = b / n
      rgba[o + 3] = a / n
    }
  }
  return { rgba, width: W, height: H, covered: out.covered }
}
const hullBaked = bakeScene(hullScene, canvasBounds, { w: PHYSICAL, h: PHYSICAL })
// turret 完整 bounds（含 mantlet + complete gun——raster overflow contract）
const turretFullB = kind === 'turreted' ? boundsOf(turretScene) : null
const turretBaked = kind === 'turreted' ? bakeScene(turretScene, turretFullB) : null
console.log(`  bake: hull ${hullBaked.width}x${hullBaked.height} covered=${hullBaked.covered}px${turretBaked ? ` turret ${turretBaked.width}x${turretBaked.height} covered=${turretBaked.covered}px` : ''}`)

// —— rasterOrientation fingerprint（RASTER_Y_AXIS_CONTRACT 证据）：从实际 baked rgba 计算 ——
// 记录图片 top/bottom 对应的 model Y、上下 10% 行的覆盖宽度均值与首/末覆盖行。
// 方向契约：model +Y（forward）必须位于图片 top——即 topModelY 是场景 bounds 的最大 Y，
// 且 topWidthMean 显著小于 bottomWidthMean（炮管/车首窄于车尾/炮塔体）。
// vitest（orientation 回归）与开发者 QA 都以此字段断言真实 raster 方向，非 metadata 自洽。
const rasterFingerprint = (baked, boundsWorld) => {
  const { rgba, width: W, height: H } = baked
  const rowWidth = new Array(H).fill(0)
  let topRow = -1, bottomRow = -1
  for (let y = 0; y < H; y++) {
    let cnt = 0
    // alpha > 40：边缘半透明像素不算覆盖（与 check-webp-orientation 同阈值）
    for (let x = 0; x < W; x++) if (rgba[(y * W + x) * 4 + 3] > 40) cnt++
    rowWidth[y] = cnt
    if (cnt > 0) { if (topRow < 0) topRow = y; bottomRow = y }
  }
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)
  const band = Math.max(1, Math.floor(H * 0.1))
  // 行 r ↔ modelY = maxY - r*(maxY-minY)/(H-1)（raster 行 = 屏幕 y，上小下大）
  const span = boundsWorld.maxY - boundsWorld.minY
  const yAtRow = (r) => (r < 0 ? null : boundsWorld.maxY - (r * span) / Math.max(1, H - 1))
  return {
    axisContract: 'model +Y = screen up（raster top = bounds.maxY）',
    topModelY: +boundsWorld.maxY.toFixed(4),
    bottomModelY: +boundsWorld.minY.toFixed(4),
    topRowCovered: topRow,
    bottomRowCovered: bottomRow,
    topCoveredModelY: topRow < 0 ? null : +yAtRow(topRow).toFixed(4),
    bottomCoveredModelY: bottomRow < 0 ? null : +yAtRow(bottomRow).toFixed(4),
    topWidthMean: +mean(rowWidth.slice(0, band)).toFixed(2),
    bottomWidthMean: +mean(rowWidth.slice(H - band)).toFixed(2),
  }
}
const hullOrientation = rasterFingerprint(hullBaked, canvasBounds)
const turretOrientation = kind === 'turreted' ? rasterFingerprint(turretBaked, turretFullB) : null
console.log(`  orientation: hull topModelY=${hullOrientation.topModelY} topW=${hullOrientation.topWidthMean} botW=${hullOrientation.bottomWidthMean}${turretOrientation ? ` turret topModelY=${turretOrientation.topModelY} topW=${turretOrientation.topWidthMean} botW=${turretOrientation.bottomWidthMean}` : ''}`)

// —— 输出（正式资产：webp + metadata；debug：PNG + 通道图 + report）——
const outDir = outDirArg ? join(ROOT, outDirArg) : join(ROOT, 'frontend', 'src', 'vehicle-models', 'assets', modelKey)
mkdirSync(outDir, { recursive: true })
const debugDir = join(CACHE_DIR, 'debug', modelKey)
mkdirSync(debugDir, { recursive: true })
const pngToWebp = (pngPath, webpPath, quality = 90) => {
  const code = `from PIL import Image; Image.open(r'${pngPath}').save(r'${webpPath}', 'WEBP', quality=${quality}, method=6)`
  const r2 = spawnSync('python', ['-c', code], { stdio: 'inherit' })
  if (r2.status !== 0) throw new Error(`WEBP 编码失败（python 退出码 ${r2.status}，详见上方输出）`)
}
const writeAsset = (label, baked, isOfficial) => {
  const png = encodePng(baked.rgba, baked.width, baked.height)
  const pngPath = join(debugDir, `${label}-baked.png`)
  writeFileSync(pngPath, png)
  const webpPath = join(outDir, `${label}.webp`)
  pngToWebp(pngPath, webpPath)
  console.log(`  ${label}: ${baked.width}x${baked.height} webp=${readFileSync(webpPath).length}B`)
  return { webpPath, bytes: readFileSync(webpPath).length }
}
const hullAsset = writeAsset('hull', hullBaked, true)
const turretAsset = kind === 'turreted' ? writeAsset('turret', turretBaked, true) : null

// debug 通道图（source-color / normal / ao；与正式 bake 同一 bounds/scale）
const debugChannel = (name, scene, boundsWorld, slot) => {
  const mats = materialsDef.map((m) => ({ ...m, baseColor: m[slot], occlusion: slot === 'occlusion' ? m.occlusion : -1, normal: slot === 'normal' ? m.normal : -1 }))
  const out = bakeSceneWith(scene, boundsWorld, mats, 0)
  writeFileSync(join(debugDir, `${name}.png`), encodePng(out.rgba, out.width, out.height))
}
const bakeSceneWith = (scene, boundsWorld, matsOverride, desaturate) => {
  const prevMats = materialsDef
  // 复用 bakeScene 逻辑但允许材质/去色覆盖——bakeScene 引用模块级 materialsDef/desaturate
  const w = boundsWorld.maxX - boundsWorld.minX
  const h = boundsWorld.maxY - boundsWorld.minY
  const resW = Math.max(2, Math.ceil(w * pxPerM * SUPERSAMPLE / 2) * 2)
  const resH = Math.max(2, Math.ceil(h * pxPerM * SUPERSAMPLE / 2) * 2)
  const out = bakeTopView({ triangles: scene, textures, materials: matsOverride, bounds: boundsWorld, resolution: Math.max(resW, resH), desaturate })
  const W = Math.floor(out.width / SUPERSAMPLE)
  const H = Math.floor(out.height / SUPERSAMPLE)
  const rgba = new Uint8Array(W * H * 4)
  const S = SUPERSAMPLE
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let dy = 0; dy < S; dy++) {
        for (let dx = 0; dx < S; dx++) {
          const i = ((y * S + dy) * out.width + (x * S + dx)) * 4
          r += out.rgba[i]; g += out.rgba[i + 1]; b += out.rgba[i + 2]; a += out.rgba[i + 3]
        }
      }
      const n = S * S
      const o = (y * W + x) * 4
      rgba[o] = r / n; rgba[o + 1] = g / n; rgba[o + 2] = b / n; rgba[o + 3] = a / n
    }
  }
  return { rgba, width: W, height: H, covered: out.covered }
}
debugChannel('hull-source-color', hullScene, canvasBounds, 'baseColor')
debugChannel('hull-normal', hullScene, canvasBounds, 'normal')
debugChannel('hull-ao', hullScene, canvasBounds, 'occlusion')
if (kind === 'turreted') {
  debugChannel('turret-source-color', turretScene, turretFullB, 'baseColor')
  debugChannel('turret-normal', turretScene, turretFullB, 'normal')
  debugChannel('turret-ao', turretScene, turretFullB, 'occlusion')
}

// turretPivot（turreted：models.pb turretOrigin → 模型坐标 → 投影，与 extractor 同一公式）
let turretPivot = null
if (kind === 'turreted') {
  const origin = modules.turretOrigin || { x: 0, y: 0, z: 0 }
  const modelPivot = correctZYTuple({ x: origin.x, y: origin.y, z: origin.z })
  const pivot2d = projectTopDown(modelPivot)
  turretPivot = { x: +(pivot2d.x * scale + tx).toFixed(2), y: +(-pivot2d.y * scale + ty).toFixed(2) }
  console.log(`  turretPivot=${JSON.stringify(turretPivot)}`)
}

const report = {
  tankId,
  modelKey,
  kind,
  sourceModel: { glbBytes: readFileSync(glbPath).length },
  selectedModules: { turretId: modules.turretId, gunId: modules.gunId, trackId: modules.trackId ?? null, turretModelId: modules.turretModelId, gunModelId: modules.gunModelId },
  // hullPhysicalPixelSize：仅指 hull.webp 固定画布；turret.webp 尺寸可变（见 turretRaster）——不得误导 PR2
  output: { hullPhysicalPixelSize: [PHYSICAL, PHYSICAL], logicalViewBox: '0 0 320 320', supersample: SUPERSAMPLE },
  materials: materials.map((m) => m.getName()),
  texturesUsed: texDefs.map((t) => t.name),
  uvSetsUsed: ['TEXCOORD_0'],
  metallicRoughness: { present: mrPresent.length > 0, used: false, reason: '顶视中性 bake 无 specular——MR 对当前视觉无收益（§5）' },
  visibleTriangleCounts: { hull: hullScene.length, turret: kind === 'turreted' ? turretScene.length : null },
  alphaTested: materialsDef.filter((m) => m.alphaMode === 'MASK').length,
  hullBounds: { min: [hullB.minX, hullB.minY], max: [hullB.maxX, hullB.maxY] },
  turretBounds: kind === 'turreted' ? { min: [turretMainB.minX, turretMainB.minY], max: [turretMainB.maxX, turretMainB.maxY] } : null,
  gunBounds: gunB ? { min: [gunB.minX, gunB.minY], max: [gunB.maxX, gunB.maxY] } : null,
  turretPivot,
  rasterOrientation: { hull: hullOrientation, ...(turretOrientation ? { turret: turretOrientation } : {}) },
  // raster overflow contract：turret.webp 画布 = turret+mantlet+完整 gun 的 logical bounds
  // （保持同一 fit.scale，主体不缩放；透明 canvas 向 320 逻辑画布外扩展，避免炮管裁切）
  turretRaster: kind === 'turreted'
    ? (() => {
        const lMinX = turretFullB.minX * scale + tx
        const lMaxX = turretFullB.maxX * scale + tx
        const lMinY = -turretFullB.maxY * scale + ty
        const lMaxY = -turretFullB.minY * scale + ty
        return {
          logicalMinX: +lMinX.toFixed(2),
          logicalMinY: +lMinY.toFixed(2),
          logicalMaxX: +lMaxX.toFixed(2),
          logicalMaxY: +lMaxY.toFixed(2),
          pixelWidth: turretBaked.width,
          pixelHeight: turretBaked.height,
          pivotX: +(turretPivot.x - lMinX).toFixed(2),
          pivotY: +(turretPivot.y - lMinY).toFixed(2),
        }
      })()
    : null,
  fit: { scale, tx, ty },
  assets: {
    hullWebp: hullAsset.bytes,
    turretWebp: turretAsset?.bytes ?? null,
  },
  generation: {
    method: 'blitzkit-model-topdown-texture-bake',
    desaturate: DESATURATE,
    shading: 'baseColor x occlusion x normal-z relief (restrained)',
    determinism: 'pure arithmetic; same input -> same output',
  },
}
writeFileSync(join(outDir, 'metadata.json'), JSON.stringify({
  modelKey,
  kind,
  source: {
    provider: 'blitzkit',
    tankId,
    modelGlb: `${API}/tanks/${tankId}/model.glb`,
    modelDefinitions: `${API}/definitions/models.pb`,
  },
  ...(turretPivot ? { turretPivot } : {}),
  ...(report.turretRaster ? { turretRaster: report.turretRaster } : {}),
  generation: {
    method: 'blitzkit-model-topdown-texture-bake',
    viewBox: `0 0 ${VIEWBOX.width} ${VIEWBOX.height}`,
    hullPhysicalPixelSize: [PHYSICAL, PHYSICAL], // hull.webp 固定 640×640；turret 尺寸以 turretRaster 为准
    hullBounds: report.hullBounds,
    turretBounds: report.turretBounds,
    gunBounds: report.gunBounds,
    selectedModules: report.selectedModules,
    texturesUsed: report.texturesUsed,
    desaturate: DESATURATE,
    fidelity: 'high',
    geometryScale: 'faithful',
    visibleDetailRetentionTarget: 0.9,
    notes: 'Source-faithful PBR top-view asset：真实 LOD0 geometry + 内嵌纹理确定性 bake；几何上限 = BlitzKit/WoTB LOD0 source；无 AI/manual 细节；runtime 可读性由 PR2 LOD/outline/label 解决',
  },
}, null, 2) + '\n')
writeFileSync(join(outDir, 'bake-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`输出: ${outDir}/hull.webp${turretAsset ? ' / turret.webp' : ''} / metadata.json / bake-report.json`)
console.log('RESULT: BAKE OK')
