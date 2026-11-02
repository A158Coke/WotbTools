// scenery-lite 派生核心（#857 Step 3；纯函数，无 DOM/Chrome 依赖——vitest 直接驱动）。
//
// 定位：**pack 后处理**——从上游 asset build 产出的 full `scenery.glb`（场景几何唯一 SSOT）
// 确定性派生 `scenery-lite.glb`。不是第二套地图几何来源：结构网格逐字节保留（V1 不做
// decimation），只剥离昂贵 visual payload。
//
// 剔除分类 = **语义判据**（exporter 自有标记，禁止名字 heuristic——`ST|` 前缀与
// `_CORNER` 属性是导出器写入的语义标记，不是猜测）：
//   · SpeedTree 植被：节点/材质名 `ST|` 前缀（exporter 对树/灌木/枝干的统一标记）；
//   · billboard 卡片：mesh 带 `_CORNER` 属性（远景交叉面片）；
//   · 天空穹：材质 extras.sky（Skyobject 模板标记）；
//   · 效果卡片：材质 extras.blendLayer（烟雾/瀑布/浪等动画掩码层）与 extras.alphaBlend
//     （视角淡出等软混合片）。
// 保留：桥/岩体/建筑/废墟/高台/坡道等全部结构网格（含 decal 结构件）、水面、可破坏物
// 各状态节点、变体组（mdVariant / variantByMapId / variantMappingIncomplete 原样保留——
// 变体裁剪是运行时行为，lite 必须与 full 同构）。
//
// 重写：剥离全部内嵌纹理（image/texture/sampler 与材质贴图引用），材质退化为
// baseColorFactor 平色（有贴图的材质由调用方注入均值色——贴图均值即 exporter 无贴图时
// 的兜底口径）；texture-index 类 extras（maskTexture/lightmap/decalTexture/envMask/
// envCube/detail/water.normal|cube）同步摘除防悬垂下标，语义布尔 extras 全保留。
// buffer 重建：按保留 bufferView 复制字节（访问器原 byteOffset 不变），geometry 字节恒等。
//
// verifyLite：full ↔ lite 结构差分（计划 §16）——retained 节点的 name/变换/extras 逐值
// 相等 + 几何访问器字节恒等 + 语义材质 extras 相等 + 场景级变体 extras 相等 + lite 无
// 禁止载荷（images/textures/samplers/texture-index extras）。V1 不 decimate ⇒ 可证明
// exact geometry equality。
import { createHash } from 'node:crypto'

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

export function parseGlb(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  if (dv.getUint32(0, true) !== GLB_MAGIC || dv.getUint32(4, true) !== 2) {
    throw new Error('not a glTF 2.0 GLB')
  }
  const jsonLen = dv.getUint32(12, true)
  const jsonType = dv.getUint32(16, true)
  if (jsonType !== CHUNK_JSON) throw new Error('GLB: 首块不是 JSON')
  const json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + jsonLen)))
  let bin = null
  let off = 20 + jsonLen
  if (off < u8.byteLength) {
    const binLen = dv.getUint32(off, true)
    const binType = dv.getUint32(off + 4, true)
    if (binType !== CHUNK_BIN) throw new Error('GLB: 第二块不是 BIN')
    bin = u8.subarray(off + 8, off + 8 + binLen)
  }
  return { json, bin }
}

export function buildGlb(json, bin) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json))
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4
  const binPad = (4 - (bin.length % 4)) % 4
  const total = 12 + 8 + jsonBytes.length + jsonPad + (bin.length ? 8 + bin.length + binPad : 0)
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, GLB_MAGIC, true)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, total, true)
  dv.setUint32(12, jsonBytes.length + jsonPad, true)
  dv.setUint32(16, CHUNK_JSON, true)
  out.set(jsonBytes, 20)
  for (let i = 0; i < jsonPad; i++) out[20 + jsonBytes.length + i] = 0x20
  if (bin.length) {
    const bOff = 20 + jsonBytes.length + jsonPad
    dv.setUint32(bOff, bin.length + binPad, true)
    dv.setUint32(bOff + 4, CHUNK_BIN, true)
    out.set(bin, bOff + 8)
  }
  return out
}

/** 语义剔除判据（导出器自有标记；`ST|` 前缀与 `_CORNER` 是 exporter 语义标记，非名字启发式）。 */
export function isLiteDropMaterial(mat) {
  const ex = (mat && mat.extras) || {}
  return ex.sky === true || ex.blendLayer === true || ex.alphaBlend === true
    || (mat && mat.name || '').startsWith('ST|')
}

export function meshHasCards(mesh) {
  return !!mesh && (mesh.primitives || []).some((p) => p.attributes && p.attributes._CORNER !== undefined)
}

export function isLiteDropNode(node, json) {
  if (!node || node.mesh === undefined || (node.children && node.children.length)) return false
  const mesh = json.meshes && json.meshes[node.mesh]
  if (!mesh) return false
  if ((node.name || '').startsWith('ST|')) return true
  if (meshHasCards(mesh)) return true
  return mesh.primitives.some((p) => {
    const m = json.materials && json.materials[p.material]
    return m ? isLiteDropMaterial(m) : false
  })
}

/** 场景图可达节点下标集合（lite 与 full 共用：nodes 数组保持原下标稳定——场景图只摘
 *  引用、不重排数组 ⇒ 验证按原始下标对齐，sibling 下标漂移不产生假阳性）。 */
function sceneReachable(jsonDoc) {
  const seen = new Set()
  const walk = (idx) => {
    if (seen.has(idx)) return
    seen.add(idx)
    for (const c of jsonDoc.nodes[idx].children || []) walk(c)
  }
  for (const r of jsonDoc.scenes[jsonDoc.scene || 0].nodes) walk(r)
  return seen
}

/** full 场景树里 retained（lite 保留）的 mesh 节点下标集合。 */
function retainedMeshNodeIndices(jsonDoc, dropPred) {
  const kept = new Set()
  const walk = (idx) => {
    if (!dropPred(jsonDoc.nodes[idx], jsonDoc) && jsonDoc.nodes[idx].mesh !== undefined) kept.add(idx)
    for (const c of jsonDoc.nodes[idx].children || []) walk(c)
  }
  for (const r of jsonDoc.scenes[jsonDoc.scene || 0].nodes) walk(r)
  return kept
}

function meshTriangles(jsonDoc, mesh) {
  let t = 0
  for (const p of mesh.primitives) {
    const acc = p.indices !== undefined ? jsonDoc.accessors[p.indices] : jsonDoc.accessors[p.attributes.POSITION]
    t += acc.count / 3
  }
  return t
}

/** 语义 extras（验证时比较的键集）：剔除 texture-index 键后应逐值相等。 */
const TEXTURE_INDEX_EXTRA_KEYS = ['maskTexture', 'lightmap', 'decalTexture', 'envMask', 'envCube', 'detail']
export function semanticExtras(extras) {
  if (!extras || typeof extras !== 'object') return extras
  const out = { ...extras }
  for (const k of TEXTURE_INDEX_EXTRA_KEYS) delete out[k]
  // water: 对象形态携带 normal/cube 贴图下标 ⇒ lite 退化为布尔语义
  if (out.water && typeof out.water === 'object') out.water = true
  return out
}

const MATERIAL_TEXTURE_KEYS = ['baseColorTexture', 'metallicRoughnessTexture']
const MATERIAL_NESTED_TEXTURE_KEYS = ['normalTexture', 'occlusionTexture', 'emissiveTexture']

/** 派生主流程。colorOf(matJson, imageBytes, mime) → Promise<[r,g,b,(a)] | null>：
 *  有贴图材质的均值色由调用方注入（CLI 走 Chrome 解码；测试注入桩）。 */
export async function deriveSceneryLite(fullJson, fullBin, { colorOf = null, key = '' } = {}) {
  if (fullJson.skins?.length || fullJson.animations?.length || fullJson.cameras?.length) {
    throw new Error('scenery-lite V1 不支持 skins/animations/cameras（场景 GLB 应为纯静态）')
  }
  if (fullJson.extensionsRequired?.length) {
    throw new Error(`scenery-lite V1 不支持 extensionsRequired: ${fullJson.extensionsRequired.join(',')}`)
  }
  const dropNode = (node, doc) => isLiteDropNode(node, doc)

  // ① 节点树：剔除语义弃子（只摘 leaf mesh 节点的**引用**，变换父链与 nodes 数组下标
  // 原样保留——下标稳定是 verifyLite 节点身份对齐的基础；孤儿数组项不进场景图，无载荷）
  const nodes = JSON.parse(JSON.stringify(fullJson.nodes))
  const pruneChildren = (idx) => {
    const node = nodes[idx]
    if (node.children) {
      node.children = node.children.filter((c) => !dropNode(nodes[c], { ...fullJson, nodes }))
      for (const c of node.children) pruneChildren(c)
    }
  }
  const out = { ...fullJson, nodes }
  out.scenes = fullJson.scenes.map((s) => ({ ...s, nodes: s.nodes.filter((r) => !dropNode(nodes[r], fullJson)) }))
  for (const r of [...out.scenes[0].nodes]) pruneChildren(r)

  // ② mesh/material 可达性收编（场景图可达的 retained mesh 节点）
  const reachable = sceneReachable(out)
  const usedMeshes = new Set()
  const usedMaterials = new Set()
  for (const idx of reachable) {
    const node = nodes[idx]
    if (node.mesh === undefined || dropNode(node, { ...fullJson, nodes })) continue
    const mesh = fullJson.meshes[node.mesh]
    usedMeshes.add(node.mesh)
    for (const p of mesh.primitives) if (p.material !== undefined) usedMaterials.add(p.material)
  }
  const meshRemap = new Map()
  // 深拷贝：out.meshes 的 primitive 随后要做 material/accessor remap，不得污染 fullJson
  //（fullJson 在派生后还要作为 verifyLite 的对照基准）
  out.meshes = [...usedMeshes].sort((a, b) => a - b).map((mi, ni) => { meshRemap.set(mi, ni); return JSON.parse(JSON.stringify(fullJson.meshes[mi])) })
  for (const idx of reachable) {
    const node = nodes[idx]
    if (node.mesh !== undefined && !dropNode(node, { ...fullJson, nodes })) {
      nodes[idx] = { ...node, mesh: meshRemap.get(node.mesh) }
    }
  }
  const matRemap = new Map()
  out.materials = []
  for (const mi of [...usedMaterials].sort((a, b) => a - b)) {
    const m = JSON.parse(JSON.stringify(fullJson.materials[mi]))
    // ③ 材质重写：剥贴图引用 + texture-index extras，平色退化
    const pbr = m.pbrMetallicRoughness || {}
    const hadBaseColor = !!pbr.baseColorTexture
    if (pbr.baseColorTexture) delete pbr.baseColorTexture
    if (pbr.metallicRoughnessTexture) delete pbr.metallicRoughnessTexture
    for (const k of MATERIAL_NESTED_TEXTURE_KEYS) delete m[k]
    delete m.extensions
    if (m.extras) {
      m.extras = semanticExtras(m.extras)
      if (!Object.keys(m.extras).length) delete m.extras
    }
    if (hadBaseColor && colorOf) {
      const img = baseColorImage(fullJson, fullBin, fullJson.materials[mi])
      const mean = img ? await colorOf(fullJson.materials[mi], img.bytes, img.mimeType) : null
      if (mean) pbr.baseColorFactor = [mean[0], mean[1], mean[2], mean[3] !== undefined ? mean[3] : 1]
    }
    m.pbrMetallicRoughness = pbr
    out.materials.push(m)
    matRemap.set(mi, out.materials.length - 1)
  }
  for (const mesh of out.meshes) {
    mesh.primitives = mesh.primitives.map((p) => ({
      ...p,
      material: p.material !== undefined ? matRemap.get(p.material) : undefined,
    }))
  }

  // ④ 访问器/bufferView GC + buffer 重建（bufferView 粒度整段复制 ⇒ 几何字节恒等；
  // accessor/bufferView 均 remap，primitive 引用同步重写）
  const usedAccessors = new Set()
  for (const mesh of out.meshes) {
    for (const p of mesh.primitives) {
      for (const a of Object.values(p.attributes)) usedAccessors.add(a)
      if (p.indices !== undefined) usedAccessors.add(p.indices)
    }
  }
  const viewRemap = new Map()
  const accessorRemap = new Map()
  const newBinParts = []
  let cursor = 0
  const outAccessors = []
  for (const ai of [...usedAccessors].sort((a, b) => a - b)) {
    const a = fullJson.accessors[ai]
    const viewIdx = a.bufferView
    if (!viewRemap.has(viewIdx)) {
      const v = fullJson.bufferViews[viewIdx]
      const src = fullBin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength)
      const aligned = (cursor + 3) & ~3
      if (aligned > cursor) { newBinParts.push(new Uint8Array(aligned - cursor)); cursor = aligned }
      newBinParts.push(src)
      viewRemap.set(viewIdx, { index: viewRemap.size, byteOffset: cursor, byteLength: v.byteLength, byteStride: v.byteStride })
      cursor += v.byteLength
    }
    const nv = viewRemap.get(viewIdx)
    accessorRemap.set(ai, outAccessors.length)
    outAccessors.push({ ...a, bufferView: nv.index })
  }
  out.accessors = outAccessors
  out.bufferViews = [...viewRemap.values()].sort((x, y) => x.index - y.index)
    .map((v) => ({ buffer: 0, byteOffset: v.byteOffset, byteLength: v.byteLength, ...(v.byteStride ? { byteStride: v.byteStride } : {}) }))
  for (const mesh of out.meshes) {
    mesh.primitives = mesh.primitives.map((p) => ({
      ...p,
      attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, ai]) => [k, accessorRemap.get(ai)])),
      ...(p.indices !== undefined ? { indices: accessorRemap.get(p.indices) } : {}),
    }))
  }
  const bin = new Uint8Array(cursor)
  let off = 0
  for (const part of newBinParts) { bin.set(part, off); off += part.length }
  out.buffers = [{ byteLength: bin.length }]

  // ⑤ 禁止载荷：textures/images/samplers 整体移除
  delete out.images
  delete out.textures
  delete out.samplers
  out.asset = { ...fullJson.asset, generator: `${fullJson.asset?.generator || ''} + wotbtools scenery-lite (deriveLiteCore)` }

  const fullTriangles = fullJson.meshes.reduce((s, m) => s + meshTriangles(fullJson, m), 0)
  const liteTriangles = out.meshes.reduce((s, m) => s + meshTriangles(out, m), 0)
  const report = {
    key,
    sourceBytes: fullBin.length,
    liteBytes: bin.length,
    fullMeshes: fullJson.meshes.length,
    liteMeshes: out.meshes.length,
    fullTriangles: Math.round(fullTriangles),
    liteTriangles: Math.round(liteTriangles),
    fullMaterials: (fullJson.materials || []).length,
    liteMaterials: out.materials.length,
    droppedNodes: countDropped(fullJson),
  }
  return { json: out, bin, report }
}

function countDropped(fullJson) {
  let n = 0
  const walk = (idx) => {
    if (isLiteDropNode(fullJson.nodes[idx], fullJson)) n++
    for (const c of fullJson.nodes[idx].children || []) walk(c)
  }
  for (const r of fullJson.scenes[fullJson.scene || 0].nodes) walk(r)
  return n
}

function baseColorImage(jsonDoc, bin, mat) {
  const texIdx = mat?.pbrMetallicRoughness?.baseColorTexture?.index
  if (texIdx === undefined || !jsonDoc.textures?.[texIdx]) return null
  const img = jsonDoc.images?.[jsonDoc.textures[texIdx].source]
  if (!img || img.bufferView === undefined) return null
  const v = jsonDoc.bufferViews[img.bufferView]
  return { bytes: bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength), mimeType: img.mimeType }
}

/** full ↔ lite 结构差分验证（§16）。返回 { ok, problems, report }。
 *  节点身份 = 原始 nodes 数组下标（派生不重排数组，场景图只摘引用）。 */
export function verifyLite(fullJson, fullBin, liteJson, liteBin) {
  const problems = []
  const dropPred = (node, doc) => isLiteDropNode(node, doc)
  const fullKept = retainedMeshNodeIndices(fullJson, dropPred)
  const liteReachable = sceneReachable(liteJson)
  for (const idx of fullKept) {
    if (!liteReachable.has(idx)) { problems.push(`节点缺失: #${idx} (${fullJson.nodes[idx].name || 'unnamed'})`); continue }
    const fn = fullJson.nodes[idx], ln = liteJson.nodes[idx]
    for (const k of ['name', 'translation', 'rotation', 'scale', 'matrix']) {
      if (JSON.stringify(fn[k]) !== JSON.stringify(ln[k])) problems.push(`变换漂移 @#${idx}: ${k}`)
    }
    if (JSON.stringify(fn.extras || null) !== JSON.stringify(ln.extras || null)) {
      problems.push(`节点 extras 漂移 @#${idx}`)
    }
    const fm = fullJson.meshes[fn.mesh], lm = liteJson.meshes[ln.mesh]
    if ((fm.name || '') !== (lm.name || '')) problems.push(`mesh name 漂移 @#${idx}`)
    if (fm.primitives.length !== lm.primitives.length) { problems.push(`primitives 数漂移 @#${idx}`); continue }
    for (let pi = 0; pi < fm.primitives.length; pi++) {
      const fp = fm.primitives[pi], lp = lm.primitives[pi]
      if (JSON.stringify(Object.keys(fp.attributes)) !== JSON.stringify(Object.keys(lp.attributes))) {
        problems.push(`attributes 漂移 @#${idx}[${pi}]`)
        continue
      }
      for (const [attr, faIdx] of Object.entries(fp.attributes)) {
        const la = liteJson.accessors[lp.attributes[attr]]
        if (!accessorBytesEqual(fullJson, fullBin, fullJson.accessors[faIdx], liteJson, liteBin, la)) problems.push(`几何字节漂移 @#${idx}[${pi}].${attr}`)
      }
      if (fp.indices !== undefined) {
        if (!accessorBytesEqual(fullJson, fullBin, fullJson.accessors[fp.indices],
          liteJson, liteBin, liteJson.accessors[lp.indices])) {
          problems.push(`索引字节漂移 @#${idx}[${pi}]`)
        }
      }
      if ((fp.material !== undefined) !== (lp.material !== undefined)) { problems.push(`material 缺失 @#${idx}[${pi}]`); continue }
      if (fp.material !== undefined) {
        const fmat = fullJson.materials[fp.material], lmat = liteJson.materials[lp.material]
        if ((fmat.name || '') !== (lmat.name || '')) problems.push(`material name 漂移 @#${idx}[${pi}]`)
        if (JSON.stringify(semanticExtras(fmat.extras || null)) !== JSON.stringify(semanticExtras(lmat.extras || null))) {
          problems.push(`material 语义 extras 漂移 @#${idx}[${pi}]`)
        }
        if ((fmat.alphaMode || 'OPAQUE') !== (lmat.alphaMode || 'OPAQUE')) problems.push(`alphaMode 漂移 @#${idx}[${pi}]`)
      }
    }
  }
  // lite 场景图不得出现 full 判定剔除的 mesh 节点（变换父节点合法）
  for (const idx of liteReachable) {
    const ln = liteJson.nodes[idx]
    if (ln.mesh !== undefined && isLiteDropNode(ln, liteJson)) problems.push(`lite 保留了应剔除的节点: #${idx}`)
  }
  for (const k of ['variantByMapId', 'variantMappingIncomplete']) {
    const se = liteJson.scenes?.[0]?.extras || {}
    const fe = fullJson.scenes?.[0]?.extras || {}
    if (JSON.stringify(fe[k] ?? null) !== JSON.stringify(se[k] ?? null)) problems.push(`场景级 extras 漂移: ${k}`)
  }
  if (liteJson.images?.length || liteJson.textures?.length || liteJson.samplers?.length) {
    problems.push('lite 仍含 images/textures/samplers（禁止载荷）')
  }
  for (const m of liteJson.materials || []) {
    const pbr = m.pbrMetallicRoughness || {}
    if (MATERIAL_TEXTURE_KEYS.some((k) => pbr[k]) || MATERIAL_NESTED_TEXTURE_KEYS.some((k) => m[k])) {
      problems.push(`材质仍含贴图引用: ${m.name || '?'}`)
    }
    if (m.extras && TEXTURE_INDEX_EXTRA_KEYS.some((k) => m.extras[k] !== undefined)) {
      problems.push(`材质 extras 仍含 texture-index: ${m.name || '?'}`)
    }
  }
  const fullTriangles = Math.round(fullJson.meshes.reduce((s, m) => s + meshTriangles(fullJson, m), 0))
  const liteTriangles = Math.round(liteJson.meshes.reduce((s, m) => s + meshTriangles(liteJson, m), 0))
  const report = {
    structuralNodes: fullKept.size,
    geometryHash: geometryDigest(liteJson, liteBin),
    fullTriangles, liteTriangles,
    sceneExtras: liteJson.scenes?.[0]?.extras || null,
  }
  return { ok: problems.length === 0, problems, report }
}

function accessorBytesEqual(fj, fbin, fa, lj, lbin, la) {
  if (!fa || !la) return false
  if (fa.count !== la.count || fa.componentType !== la.componentType || fa.type !== la.type) return false
  const fb = viewBytes(fj, fbin, fa), lb = viewBytes(lj, lbin, la)
  if (fb.length !== lb.length) return false
  for (let i = 0; i < fb.length; i++) if (fb[i] !== lb[i]) return false
  return true
}

function viewBytes(jsonDoc, bin, accessor) {
  const v = jsonDoc.bufferViews[accessor.bufferView]
  const start = (v.byteOffset || 0) + (accessor.byteOffset || 0)
  const comp = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType]
  const ncomp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type]
  return bin.subarray(start, start + accessor.count * comp * ncomp)
}

function geometryDigest(jsonDoc, bin) {
  const h = createHash('sha256')
  for (const m of jsonDoc.meshes) {
    for (const p of m.primitives) {
      for (const a of Object.values(p.attributes)) h.update(viewBytes(jsonDoc, bin, jsonDoc.accessors[a]))
      if (p.indices !== undefined) h.update(viewBytes(jsonDoc, bin, jsonDoc.accessors[p.indices]))
    }
  }
  return h.digest('hex')
}
