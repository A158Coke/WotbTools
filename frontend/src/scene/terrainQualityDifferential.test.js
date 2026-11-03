// 跨画质档地形差分基线（Issue #857 Step 0；#857 修复轮重做 §10-14）。
//
// 三层事实（修复轮契约）：
//   A. Height-field truth —— 四档共用同一 field/n/span（exact equality；quality preset
//      不是地形几何的输入，这条永久阻止把 fidelity 参数接进 world-surface truth）。
//   B. Full vs lite scenery-derived refine mask —— full 装配集 vs lite 装配集各自过
//      buildCorridorRefineMask，比较 candidate 数 / texel 数 / 逐 texel 差异（对称差）。
//      lite 档剔除植被/效果/天空（semantic 剔除类别）——candidate 语义策略要求这些类别
//      在两侧都不作走廊候选（isLiteDroppedMeshObject），掩码逐 texel 一致。
//   C. Rendered terrain surface delta —— full-mask vs lite-mask 地形表面高度差
//      （terrainSurfaceHeightAt 采样 corpus：corridor / 廊外 / 山脊 / 河谷 / 地图边界），
//      输出 p50/p95/max，实测记录不预设为 0；并以 no-mask 为对照证明测量仪器有效。
//
// 旧版「low/mid 无场景 GLB ⇒ refineMask=null」的 premise 已失效（#857 起 low/mid 加载
// scenery-lite）：掩码差异不再按档位划分，只按 full/lite 装配集划分。
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildCorridorRefineMask, buildGroundGeometry, terrainBuildArgs } from './groundPass.js'
import { QUALITY_PRESETS } from './playback/quality.js'
import {
  buildRefineMask, sampleTerrainField, terrainSurfaceHeightAt,
} from './terrainMesh.js'
import { isLiteDroppedMeshObject } from './sceneryAssemblyRules.js'

// 平缓特征场 + 远机位：base（无掩码）大部分区域保持粗 LOD，走廊掩码强制局部最细 ⇒
// refined.quads > base.quads 严格成立（修复轮 §13：旧 64² fixture 全细分导致断言空泛）。
const N = 96
const SPAN = 600
function featureField(n) {
  const field = new Float32Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = (j / n - 0.5) * SPAN, z = (i / n - 0.5) * SPAN
      const hills = 1.6 * Math.sin((2 * Math.PI * x) / 300) * Math.cos((2 * Math.PI * z) / 300)
      const bowl = -1.2 * ((x * x + z * z) / (SPAN * SPAN / 4))
      field[i * n + j] = hills + bowl
    }
  }
  return field
}

const FIELD = featureField(N)
const CAMERA = { position: new THREE.Vector3(0, 2000, 0), fov: 55, aspect: 16 / 9 }

// 走廊：沿 x 轴穿过地图中心的贴地薄构件走廊（语义 = 铁轨基板类结构）。
function corridorMask() {
  const pts = []
  for (let s = 0; s <= 60; s++) pts.push(-SPAN / 2 + (SPAN * s) / 60, 0)
  return buildRefineMask(pts, N, SPAN, 2)
}

function geometryDigest(g) {
  const digest = (arr) => createSha(arr)
  return { positions: digest(g.attributes.position.array), indices: digest(g.index.array) }
}
import { createHash } from 'node:crypto'
function createSha(arr) {
  return createHash('sha256')
    .update(String(arr.constructor.name))
    .update(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength))
    .digest('hex')
}

function argsForPreset(key, refineMask) {
  return terrainBuildArgs({
    field: FIELD, n: N, span: SPAN, camera: CAMERA,
    quality: QUALITY_PRESETS[key], refineMask,
  })
}
function buildForPreset(key, refineMask) {
  return buildGroundGeometry(argsForPreset(key, refineMask))
}

// ---- 装配集 fixture（层 B）：薄板结构 + 语义剔除类别（ST| 灌木 / _corner 草卡）----
function plateMesh() {
  const geo = new THREE.BoxGeometry(SPAN * 0.9, 0.2, 2)
  const y = sampleTerrainField(FIELD, N, SPAN, 0, 0)
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ name: 'RailBaseplate' }))
  mesh.name = 'RailBaseplate'
  mesh.position.set(0, y - 0.05, 0)
  mesh.updateMatrixWorld(true)
  return mesh
}
function stCardMesh() {
  const geo = new THREE.BoxGeometry(1.5, 1, 0.3)
  const y = sampleTerrainField(FIELD, N, SPAN, 40, 0)
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ name: 'bark' }))
  mesh.name = 'ST|bush_3'
  mesh.position.set(40, y + 0.4, 0)
  mesh.updateMatrixWorld(true)
  return mesh
}
function grassCardMesh() {
  const geo = new THREE.PlaneGeometry(3, 2)
  geo.setAttribute('_corner', new THREE.BufferAttribute(new Float32Array(16), 4))
  const y = sampleTerrainField(FIELD, N, SPAN, -40, 0)
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ name: 'grass_low' }))
  mesh.name = 'GrassCard'
  mesh.position.set(-40, y + 1, 0)
  mesh.updateMatrixWorld(true)
  return mesh
}

/** 装配集入口形状与 mapAssets/bake 收集点一致：{ o, water, liteDropped }（收集点在材质
 *  转换前打标；此处直接构造，标签按同一规则语义给出）。 */
function assemblyEntry(mesh) {
  return { o: mesh, water: false, liteDropped: isLiteDroppedMeshObject(mesh) }
}
const FULL_SET = () => [plateMesh(), stCardMesh(), grassCardMesh()].map(assemblyEntry)
const LITE_SET = () => [plateMesh()].map(assemblyEntry)   // lite 档已剔除 ST| / _corner 卡片

function surfaceErrorStats(geometry) {
  const errs = []
  for (const [x, z] of sampleCorpus()) {
    const y = terrainSurfaceHeightAt(geometry.userData.terrainBuild, x, z)
    if (y === null) continue
    errs.push(Math.abs(y - sampleTerrainField(FIELD, N, SPAN, x, z)))
  }
  errs.sort((a, b) => a - b)
  const at = (p) => errs[Math.min(errs.length - 1, Math.floor(p * (errs.length - 1)))]
  return { count: errs.length, p50: at(0.5), p95: at(0.95), max: errs[errs.length - 1] }
}

// 采样 corpus（计划 §3 Step 0A）：texel 全量 + 走廊线 + 山脊/河谷线 + 地图边界。
function sampleCorpus() {
  const pts = []
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) pts.push([(j / N - 0.5) * SPAN, (i / N - 0.5) * SPAN])
  for (let s = 0; s <= 60; s++) {
    const t = -SPAN / 2 + (SPAN * s) / 60
    pts.push([t, 0], [t, 60], [40, t], [t, -SPAN / 2 + 2], [t, SPAN / 2 - 2])
  }
  return pts
}

function diffMasks(a, b) {
  let fullOnly = 0, liteOnly = 0
  for (let k = 0; k < a.length; k++) {
    if (a[k] && !b[k]) fullOnly++
    if (!a[k] && b[k]) liteOnly++
  }
  return { fullOnly, liteOnly, symmetric: fullOnly + liteOnly }
}

describe('跨画质档地形差分基线（#857 Step 0，修复轮三层契约）', () => {
  const PRESET_KEYS = ['low', 'mid', 'high', 'ultra']

  it('层 A — height-field truth：四档共用同一 field/n/span，几何（含掩码）逐字节一致', () => {
    const mask = corridorMask()
    const digests = PRESET_KEYS.map(key => geometryDigest(buildForPreset(key, mask)))
    for (const d of digests) expect(d).toEqual(digests[0])
    const noMask = PRESET_KEYS.map(key => geometryDigest(buildForPreset(key, null)))
    for (const d of noMask) expect(d).toEqual(noMask[0])
    const args = PRESET_KEYS.map(key => argsForPreset(key, mask))
    for (const arg of args) expect(arg).toEqual(args[0])
    expect(Object.keys(args[0]).sort()).toEqual(['aspect', 'cam', 'cx', 'cz', 'field', 'fovY', 'hFovDeg', 'n', 'refineMask', 'span'])
    // truth oracle = terrainMesh.sampleTerrainField（production SSOT，与 playbackScene.sampleHeight 同源）
    expect(sampleTerrainField(FIELD, N, SPAN, 0, 0)).toBeCloseTo(FIELD[(N / 2) * N + N / 2], 6)
  })

  it('层 B — full vs lite refine mask：语义剔除类别在两侧都不作走廊候选，掩码逐 texel 一致', () => {
    // 语义策略先行自证：ST| 灌木与 _corner 草卡被 isLiteDroppedMeshObject 判为剔除类别
    const [plate, st, grass] = FULL_SET()
    expect(isLiteDroppedMeshObject(st.o)).toBe(true)
    expect(isLiteDroppedMeshObject(grass.o)).toBe(true)
    expect(isLiteDroppedMeshObject(plate.o)).toBe(false)

    const full = buildCorridorRefineMask({ meshes: FULL_SET(), field: FIELD, n: N, span: SPAN })
    const lite = buildCorridorRefineMask({ meshes: LITE_SET(), field: FIELD, n: N, span: SPAN })
    expect(full).not.toBeNull()
    expect(lite).not.toBeNull()
    // candidate 语义策略：full 集里的剔除类别不算候选 ⇒ 两侧 candidate 一致（都只剩薄板）
    expect(full.candidates).toBe(lite.candidates)
    expect(full.candidates).toBe(1)
    // 掩码逐 texel 一致：对称差 = 0（§14 正式 gate 的 fixture 级证明）
    const delta = diffMasks(full.mask, lite.mask)
    expect(delta).toEqual({ fullOnly: 0, liteOnly: 0, symmetric: 0 })
    expect(full.texels).toBe(lite.texels)
  })

  it('层 C — rendered surface delta：full-mask vs lite-mask 跨装配集一致；掩码细分对粗层表面有实测差异', () => {
    const full = buildCorridorRefineMask({ meshes: FULL_SET(), field: FIELD, n: N, span: SPAN })
    const lite = buildCorridorRefineMask({ meshes: LITE_SET(), field: FIELD, n: N, span: SPAN })
    const fullGeo = buildForPreset('high', full.mask)
    const liteGeo = buildForPreset('low', lite.mask)
    // 掩码逐 texel 相等 ⇒ 渲染几何逐字节相等（表面 delta 恒为 0——记录而非预设）
    expect(geometryDigest(fullGeo)).toEqual(geometryDigest(liteGeo))
    const statsFull = surfaceErrorStats(fullGeo)
    const statsLite = surfaceErrorStats(liteGeo)
    expect(statsLite).toEqual(statsFull)
    expect(statsFull.count).toBeGreaterThan(0)

    // 仪器有效性：掩码强制局部细化相对无掩码粗层确有表面差异（max > 0，实测记录）
    const statsBase = surfaceErrorStats(buildForPreset('low', null))
    const base = geometryDigest(buildForPreset('low', null))
    const refined = geometryDigest(fullGeo)
    expect(base).not.toEqual(refined)
    const build = buildForPreset('low', null).userData.terrainBuild
    expect(buildForPreset('low', corridorMask()).userData.terrainBuild.quads).toBeGreaterThan(build.quads)
    expect(statsFull.max).toBeGreaterThan(0)
    expect(statsBase.max).toBeGreaterThan(0)
  })
})
