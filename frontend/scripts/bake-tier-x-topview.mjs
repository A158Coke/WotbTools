#!/usr/bin/env node
/**
 * Texture-Baked Top-View prototype（Phase B，Maus-only developer 路线）。
 *
 * BlitzKit GLB → 真实 geometry + UV + material + textures
 * → 确定性正交俯视 bake（z-buffer + barycentric UV + alpha test + 中性化）
 * → 独立 hull / turret 高保真资产（RGBA WebP，640×640 physical / 320×320 logical）
 * → bake-report.json（全部字段见 information-loss-audit.md / 任务说明 B15）。
 *
 * 网络边界与 extractor CLI 相同：本脚本是 developer 工具，唯一允许访问
 * BlitzKit 网络的位置；production / Battle Playback / CI 不访问。
 *
 * 用法（frontend 目录）：
 *   node scripts/bake-tier-x-topview.mjs --model-key maus [--out-dir <dir>]
 * 依赖：python + PIL（仅 developer 环境，用于 WEBP 解码/编码）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { NodeIO } from '@gltf-transform/core'
import * as THREE from 'three'
import { correctZYTuple, projectTopDown } from './extractor-lib.mjs'
import { bakeTopView, encodePng } from './texture-bake-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const CACHE_DIR = join(ROOT, 'frontend', 'scripts', '.vehicle-model-refs')
const API = 'https://api.blitzkit.app'
const VIEWBOX = { width: 320, height: 320 }
const PHYSICAL = 640
const SUPERSAMPLE = 2 // 1280 内部渲染 → 640 输出（4x AA）

const args = process.argv.slice(2)
function argValue(argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const modelKey = argValue(args, '--model-key')
const tankId = Number(argValue(args, '--tank-id') ?? '')
const outDirArg = argValue(args, '--out-dir')
if (!modelKey && !tankId) {
  console.error('必须提供 --model-key 或 --tank-id')
  process.exit(2)
}

async function download(url, dest) {
  if (existsSync(dest)) return dest
  mkdirSync(dirname(dest), { recursive: true })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载失败 ${url}: HTTP ${res.status}`)
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
  return dest
}

const io = new NodeIO()
const doc = await io.read(await download(`${API}/tanks/${tankId}/model.glb`, join(CACHE_DIR, 'models', `${tankId}.glb`)))
const root = doc.getRoot()

// —— 材质 / 纹理解析 ——
const materials = root.listMaterials()
const texDefs = [] // { name, bytes }
const texIndex = new Map()
for (const mat of materials) {
  for (const slot of ['baseColor', 'occlusion', 'normal']) {
    const tex = mat.getBaseColorTexture && slot === 'baseColor' ? mat.getBaseColorTexture()
      : slot === 'occlusion' ? mat.getOcclusionTexture()
      : mat.getNormalTexture()
    if (tex && !texIndex.has(tex)) {
      texIndex.set(tex, texDefs.length)
      texDefs.push({ name: tex.getName() ?? `tex${texDefs.length}`, bytes: tex.getImage() ?? null })
    }
  }
}
if (texDefs.some((t) => !t.bytes)) throw new Error('GLB 纹理缺失（无内嵌 image）——texture missing 需显式报错（B16 #17）')
const tmpDir = join(CACHE_DIR, 'debug', 'bake-tmp')
mkdirSync(tmpDir, { recursive: true })
const textures = []
for (let i = 0; i < texDefs.length; i++) {
  const ext = 'webp'
  const webpPath = join(tmpDir, `tex-${i}.${ext}`)
  const rgbaPath = join(tmpDir, `tex-${i}.rgba`)
  writeFileSync(webpPath, Buffer.from(texDefs[i].bytes))
  const py = spawnSync('python', [join(ROOT, 'frontend', 'scripts', 'decode-webp.py'), webpPath, rgbaPath])
  if (py.status !== 0) throw new Error(`WEBP 解码失败 tex${i}: ${py.stderr?.toString().slice(0, 300)}`)
  const buf = readFileSync(rgbaPath)
  const w = buf.readUInt32LE(0)
  const h = buf.readUInt32LE(4)
  const data = new Float32Array(buf.length - 8)
  for (let j = 0; j < data.length; j++) data[j] = buf[j + 8]
  textures.push({ data, width: w, height: h })
  console.log(`  texture[${i}] ${texDefs[i].name}: ${w}x${h}`)
}

// —— 分组三角形（含 hide_elements 子树；mask_01 等无关节点排除）——
const nodeMatrix = (node) => {
  const m = new THREE.Matrix4()
  m.compose(
    new THREE.Vector3(...(node.getTranslation() || [0, 0, 0])),
    new THREE.Quaternion(...(node.getRotation() || [0, 0, 0, 1])),
    new THREE.Vector3(...(node.getScale() || [1, 1, 1])),
  )
  return m
}
const collectScene = (node, m, out) => {
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
        const ab = new THREE.Vector3().subVectors(b, a)
        const ac = new THREE.Vector3().subVectors(c, a)
        const n = new THREE.Vector3().crossVectors(ab, ac).normalize()
        if (n.z <= 0.35) continue // 顶视可见只含 top-facing
        out.push({
          p: [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z],
          uv: uv0 ? [uv0[t[i] * 2], uv0[t[i] * 2 + 1], uv0[t[i + 1] * 2], uv0[t[i + 1] * 2 + 1], uv0[t[i + 2] * 2], uv0[t[i + 2] * 2 + 1]] : null,
          material: matIdx,
        })
      }
    }
  }
  for (const c of node.listChildren()) collectScene(c, m.clone().multiply(nodeMatrix(node)), out)
}
const rootNode = root.listNodes().find((n) => n.getName() === 'Maus')
const byName = {}
for (const c of rootNode.listChildren()) byName[c.getName()] = c
// 默认配置（与 extractor 相同：turret/gun/track 数组最后）
const modelDefs = null // models.pb 不在此解析——tankId 场景固定用节点名；prototype 阶段按 tankId 的节点契约
// 简化：hull = 'hull' 子树；turret = 'turret_01'（或 turret_{id:02d}，Maus = 01）+ mantlet + gun
const turretNames = rootNode.listChildren().map((n) => n.getName()).filter((n) => n.startsWith('turret_'))
const gunNames = rootNode.listChildren().map((n) => n.getName()).filter((n) => /^gun_\d+$/.test(n))
const hullScene = []
const turretScene = []
const turretMainScene = [] // fit 用（与 extractor 一致：hull + turret 主体，不含 gun）
collectScene(byName['hull'], new THREE.Matrix4(), hullScene)
for (const c of rootNode.listChildren()) {
  const nm = c.getName()
  if (nm.startsWith('chassis_track_')) collectScene(c, new THREE.Matrix4(), hullScene) // tracks 参与 hull 场景遮挡
  if (turretNames.includes(nm)) {
    collectScene(c, new THREE.Matrix4(), turretScene)
    collectScene(c, new THREE.Matrix4(), turretMainScene)
  }
  if (gunNames.includes(nm) || gunNames.some((g) => nm === `${g}_mask`)) collectScene(c, new THREE.Matrix4(), turretScene)
}
console.log(`  scenes: hull tris=${hullScene.length} turret tris=${turretScene.length} (main ${turretMainScene.length}) materials=${materials.length} textures=${textures.length}`)

// —— fit（与 extractor 相同的逻辑空间：hull+turret bounds → 320 画布）——
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
// fit bounds 与 extractor 严格一致：优先复用已生成 metadata 的 hull/turret 2D-union bounds
// （否则用 top-facing 三角形 bounds——prototype 阶段 Maus 必有 metadata）。
const metaPath = join(ROOT, 'frontend', 'src', 'vehicle-models', 'assets', 'maus', 'metadata.json')
const existingMeta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : null
const hullB = boundsOf(hullScene)
const turretB = boundsOf(turretMainScene) // 主体（不含 gun——gun 允许 overflow，与 extractor fit 一致）
const fitB = existingMeta
  ? {
      minX: Math.min(existingMeta.generation.hullBounds.min[0], existingMeta.generation.turretBounds.min[0]),
      minY: Math.min(existingMeta.generation.hullBounds.min[1], existingMeta.generation.turretBounds.min[1]),
      maxX: Math.max(existingMeta.generation.hullBounds.max[0], existingMeta.generation.turretBounds.max[0]),
      maxY: Math.max(existingMeta.generation.hullBounds.max[1], existingMeta.generation.turretBounds.max[1]),
    }
  : {
      minX: Math.min(hullB.minX, turretB.minX),
      minY: Math.min(hullB.minY, turretB.minY),
      maxX: Math.max(hullB.maxX, turretB.maxX),
      maxY: Math.max(hullB.maxY, turretB.maxY),
    }
const w = fitB.maxX - fitB.minX
const h = fitB.maxY - fitB.minY
const scale = (Math.min(VIEWBOX.width, VIEWBOX.height) * 0.88) / Math.max(w, h)
const cx = (fitB.minX + fitB.maxX) / 2
const cy = (fitB.minY + fitB.maxY) / 2
const tx = VIEWBOX.width / 2 - cx * scale
const ty = VIEWBOX.height / 2 - cy * scale
console.log(`  fit: scale=${scale.toFixed(4)} tx=${tx.toFixed(2)} ty=${ty.toFixed(2)}`)
// 画布世界范围（320 逻辑画布对应世界坐标）
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

// —— bake 主流程 ——
const bake = (scene, label) => {
  const res = SUPERSAMPLE * PHYSICAL
  const out = bakeTopView({
    triangles: scene,
    textures,
    materials: materialsDef,
    bounds: canvasBounds,
    resolution: res,
    desaturate: 0.75,
  })
  // 4x box downsample → PHYSICAL
  const W = PHYSICAL
  const rgba = new Uint8Array(W * W * 4)
  const S = SUPERSAMPLE
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let dy = 0; dy < S; dy++) {
        for (let dx = 0; dx < S; dx++) {
          const i = ((y * S + dy) * res + (x * S + dx)) * 4
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
  return { rgba, width: W, height: W, covered: out.covered }
}

const hullBaked = bake(hullScene, 'hull')
const turretBaked = bake(turretScene, 'turret')
console.log(`  bake: hull covered=${hullBaked.covered}px turret covered=${turretBaked.covered}px`)

// —— 输出 ——
const outDir = outDirArg ? join(ROOT, outDirArg) : join(ROOT, 'frontend', 'src', 'vehicle-models', 'prototypes', 'maus')
mkdirSync(outDir, { recursive: true })
const debugDir = join(CACHE_DIR, 'debug', 'maus-texture-bake')
mkdirSync(debugDir, { recursive: true })
const pngToWebp = (pngPath, webpPath, quality = 90) => {
  const code = `from PIL import Image; Image.open(r'${pngPath}').save(r'${webpPath}', 'WEBP', quality=${quality}, method=6)`
  const r2 = spawnSync('python', ['-c', code])
  if (r2.status !== 0) throw new Error(`WEBP 编码失败: ${r2.stderr?.toString().slice(0, 300)}`)
}
const writeAssets = (label, baked) => {
  const png = encodePng(baked.rgba, baked.width, baked.height)
  const pngPath = join(debugDir, `${label}-baked.png`)
  writeFileSync(pngPath, png)
  const webpPath = join(outDir, `${label}-high-fidelity.webp`)
  pngToWebp(pngPath, webpPath)
  console.log(`  ${label}: ${baked.width}x${baked.height} png=${png.length}B webp=${readFileSync(webpPath).length}B`)
  return webpPath
}
const hullWebp = writeAssets('hull', hullBaked)
const turretWebp = writeAssets('turret', turretBaked)

// debug 通道图（baseColor / normal / occlusion 单独 bake）
const debugChannel = (name, scene, slot) => {
  const mats = materialsDef.map((m) => ({ ...m, baseColor: m[slot], occlusion: slot === 'occlusion' ? m.occlusion : -1, normal: slot === 'normal' ? m.normal : -1 }))
  const res = SUPERSAMPLE * PHYSICAL
  const out = bakeTopView({ triangles: scene, textures, materials: mats, bounds: canvasBounds, resolution: res, desaturate: 0 })
  // downsample
  const W = PHYSICAL
  const rgba = new Uint8Array(W * W * 4)
  const S = SUPERSAMPLE
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let dy = 0; dy < S; dy++) {
        for (let dx = 0; dx < S; dx++) {
          const i = ((y * S + dy) * res + (x * S + dx)) * 4
          r += out.rgba[i]; g += out.rgba[i + 1]; b += out.rgba[i + 2]; a += out.rgba[i + 3]
        }
      }
      const n = S * S
      const o = (y * W + x) * 4
      rgba[o] = r / n; rgba[o + 1] = g / n; rgba[o + 2] = b / n; rgba[o + 3] = a / n
    }
  }
  writeFileSync(join(debugDir, `${name}.png`), encodePng(rgba, W, W))
}
debugChannel('hull-source-color', hullScene, 'baseColor')
debugChannel('hull-normal', hullScene, 'normal')
debugChannel('hull-ao', hullScene, 'occlusion')
debugChannel('turret-source-color', turretScene, 'baseColor')
debugChannel('turret-normal', turretScene, 'normal')
debugChannel('turret-ao', turretScene, 'occlusion')

// turretPivot 与 extractor 同一公式（metadata 已有值；bake 与 SVG 共用同一 fit → pivot 一致）
const report = {
  tankId,
  modelKey,
  sourceModel: {
    glbPath: join(CACHE_DIR, 'models', `${tankId}.glb`),
    bytes: readFileSync(join(CACHE_DIR, 'models', `${tankId}.glb`)).length,
  },
  output: {
    physicalPixelSize: [PHYSICAL, PHYSICAL],
    logicalViewBox: '0 0 320 320',
    supersample: SUPERSAMPLE,
  },
  materials: materials.map((m) => m.getName()),
  texturesUsed: texDefs.map((t) => t.name),
  uvSetsUsed: ['TEXCOORD_0'],
  visibleTriangleCounts: { hull: hullScene.length, turret: turretScene.length },
  alphaTested: materialsDef.filter((m) => m.alphaMode === 'MASK').length,
  hullBounds: { min: [hullB.minX, hullB.minY], max: [hullB.maxX, hullB.maxY] },
  turretBounds: { min: [turretB.minX, turretB.minY], max: [turretB.maxX, turretB.maxY] },
  turretPivot: existingMeta?.turretPivot ?? null,
  fit: { scale, tx, ty },
  assets: {
    hullWebp: readFileSync(hullWebp).length,
    turretWebp: readFileSync(turretWebp).length,
  },
  generation: {
    method: 'texture-baked-topdown-prototype',
    desaturate: 0.75,
    shading: 'baseColor x occlusion x normal-z relief (restrained)',
    determinism: 'pure arithmetic; same input -> same output',
  },
  geometrySvgRecall: null, // Phase A 后由 audit 脚本回填（见 _phaseA-recall.py）
  textureBakeRecall: null,
}
writeFileSync(join(outDir, 'bake-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`输出: ${outDir}/hull-high-fidelity.webp / turret-high-fidelity.webp / bake-report.json`)
console.log('RESULT: BAKE OK')
