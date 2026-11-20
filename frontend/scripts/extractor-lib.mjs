import { toSvg } from './extractor-planar.mjs'
export { bounds2D, toSvg, projectTriangles, unionTriangles, simplifyRing, silhouetteToSvgPaths } from './extractor-planar.mjs'
export { projectTopFacingPolygons, mergeVisualSurfaces, extractTopSurfaces, filterOccludedSurfaces, rasterVisibility, visibilityPixel, filterDegeneratePolys } from './extractor-surfaces.mjs'
export { buildFeatureAudit, extractMajorEdges, clusterEdges, classifyDetail, surfacesToSvgPaths, edgesToSvgPath } from './extractor-details.mjs'

/**
 * BlitzKit vehicle model extractor — 纯函数库（vitest 与 CLI 共用）。
 *
 * 坐标语义（经 BlitzKit 源码 + Maus 实测确认，docs/assets/tier-x-models/README.md）：
 * - GLB 顶点（模型坐标）：x=宽、y=长（forward=+y）、z=高；
 * - models.pb origin（引擎坐标）：x=宽、y=高、z=长（forward=-z）；
 * - correctZYTuple 把引擎坐标转为模型坐标：R_x(+90°)(x, y, -z) = (x, z, y)；
 * - 俯视投影 = 模型坐标 (x, y) 平面（丢弃 z 高）；SVG 0° 要求车头朝 12 点
 *   → SVG y = -模型 y。
 */

/** 引擎坐标 → 模型坐标（BlitzKit correctZYTuple 的代数等价）。 */
export function correctZYTuple(v) {
  return { x: v.x, y: v.z, z: v.y }
}

/**
 * 炮塔 yaw 旋转中心（BlitzKit useTankTransform.ts 契约）：
 *   hullOrigin   = correctZYTuple(trackModelDefinition.origin)     // 模型坐标
 *   turretOrigin = correctZYTuple(tankModelDefinition.turret_origin)
 *   modelPivot   = hullOrigin + turretOrigin（模型坐标向量和）
 * 运行时的 turretPosition = R_init(R_yaw(-modelPivot)) + modelPivot——旋转中心即 modelPivot；
 * initial_turret_rotation 只附加初始朝向角（turretRotation.x/y/z += initial）与绕世界原点
 * 的小幅位置修正（|Δ| ≤ |θ|·|modelPivot|，对 minotauro pitch=3° ≈ 0.13m），不影响顶视 pivot。
 * @param {{x?:number,y?:number,z?:number}} hullOrigin   引擎坐标（track origin；可能缺失→零）
 * @param {{x?:number,y?:number,z?:number}} turretOrigin 引擎坐标（turret_origin）
 * @returns {{x:number,y:number,z:number}} 模型坐标 pivot
 */
export function computeTurretModelPivot(hullOrigin, turretOrigin) {
  const h = correctZYTuple(hullOrigin || { x: 0, y: 0, z: 0 })
  const t = correctZYTuple(turretOrigin || { x: 0, y: 0, z: 0 })
  return { x: h.x + t.x, y: h.y + t.y, z: h.z + t.z }
}

/** 模型坐标 → 2D 俯视投影（x=宽、y=长）。 */
export function projectTopDown(v) {
  return { x: v.x, y: v.y }
}

/**
 * Andrew monotone chain 凸包（2D 点数组 → 逆时针凸包顶点）。
 * 用于 silhouette 提取（hull 近矩形；gun/turret 分组独立凸包）。
 */
export function convexHull2D(points) {
  const pts = points
    .map((p) => ({ x: p.x, y: p.y }))
    .sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y))
  if (pts.length < 3) return pts
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/**
 * 统一 fit 变换：几何 bounds → viewBox 内（保持长宽比、居中）。
 * paddingRatio：留边比例（默认 0.88——hull/turret 主体落画布内，长炮管允许 overflow）。
 * fit 只由几何 bounds 决定，禁止人工 scale。
 */
export function computeFit(b, viewBox, paddingRatio = 0.88) {
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  if (!(w > 0) || !(h > 0)) throw new Error('fit bounds 无效（零面积）')
  const scale = (Math.min(viewBox.width, viewBox.height) * paddingRatio) / Math.max(w, h)
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  const tx = viewBox.width / 2 - cx * scale
  const ty = viewBox.height / 2 - cy * scale
  return { scale, tx, ty }
}

/** 凸包 → SVG path d（模型坐标，含 fit + y flip）。 */
export function hullToPath(hull, fit) {
  if (hull.length < 3) return null
  const d = hull
    .map((p, i) => {
      const s = toSvg(p, fit)
      return `${i === 0 ? 'M' : 'L'}${s.x.toFixed(2)} ${s.y.toFixed(2)}`
    })
    .join(' ')
  return d + ' Z'
}

/** SVG 文档（viewBox 0 0 W H）。
 * 支持 detail-level grouping（高保真资产为未来 runtime LOD 准备结构）：
 *   svgDocument({ groups: [{ group: 'vehicle-primary', paths: [...] }, ...] }, viewBox)
 * 输出：
 *   <g class="vehicle-primary">...</g>
 * 也兼容平铺 paths（旧调用）。
 */
export function svgDocument(input, viewBox) {
  const emitPath = (p) => {
    const attrs = [`d="${p.d}"`]
    if (p.fill) attrs.push(`fill="${p.fill}"`)
    if (p.stroke) attrs.push(`stroke="${p.stroke}"`)
    if (p.strokeWidth) attrs.push(`stroke-width="${p.strokeWidth}"`)
    if (p.fillRule) attrs.push(`fill-rule="${p.fillRule}"`)
    return `  <path ${attrs.join(' ')}/>`
  }
  const groups = Array.isArray(input) ? [{ group: null, paths: input }] : input.groups
  const body = groups
    .map(({ group, paths }) => {
      const inner = paths.map(emitPath).join('\n')
      if (!group) return inner
      return `  <g class="${group}">\n${inner}\n  </g>`
    })
    .join('\n')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBox.width} ${viewBox.height}">`,
    body,
    '</svg>',
    '',
  ].join('\n')
}

/**
 * metadata.json（geometry-source schema，任务 12）。
 * source 字段证明几何来自 BlitzKit 真实模型；generation 记录生成方法与参数。
 */
export function buildMetadata({
  modelKey,
  kind,
  tankId,
  modelGlbUrl,
  modelsPbUrl,
  turretPivot,
  hullBounds,
  turretBounds,
  gunBounds,
  viewBox,
  generationNotes = '',
}) {
  return {
    modelKey,
    kind,
    source: {
      provider: 'blitzkit',
      tankId,
      modelGlb: modelGlbUrl,
      modelDefinitions: modelsPbUrl,
    },
    turretPivot: { x: +turretPivot.x.toFixed(2), y: +turretPivot.y.toFixed(2) },
    generation: {
      method: 'blitzkit-model-topdown-extraction',
      viewBox: `0 0 ${viewBox.width} ${viewBox.height}`,
      hullBounds,
      turretBounds,
      gunBounds,
      notes: generationNotes,
    },
  }
}

/**
 * Blocker 1 — 真实 silhouette 提取（projected triangle polygon union）。
 *
 * 技术取舍（2026-08-17）：
 * - convex hull：会把所有凹轮廓/结构抹成外包矩形（Maus hull.svg 退化成大矩形）→ 禁止用于正式资产；
 * - polygon union（本方案）：每个 3D triangle 投影到 top-down 2D 后精确 union，
 *   保留全部凹轮廓与洞；使用 polygon-clipping（成熟纯 JS 布尔库）；
 * - 备选（未采用）：raster mask + contour trace（锯齿/分辨率权衡）、alpha shape（参数不稳）。
 */
import * as THREE from 'three'

/**
 * 从 POSITION + INDEX 数组构建三角形列表（3D 顶点引用）。
 * positions: [x0,y0,z0, x1,y1,z1, ...]；indices: [i0,i1,i2, ...]（无索引时按连续 3 顶点）。
 */
export function trianglesFromGeometry({ positions, indices }) {
  const tris = []
  const count = indices ? indices.length / 3 : positions.length / 9
  for (let t = 0; t < count; t++) {
    const i0 = indices ? indices[t * 3] : t * 3
    const i1 = indices ? indices[t * 3 + 1] : t * 3 + 1
    const i2 = indices ? indices[t * 3 + 2] : t * 3 + 2
    tris.push([
      [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]],
      [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]],
      [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]],
    ])
  }
  return tris
}

/**
 * 收集节点子树所有 mesh 的三角形（POSITION + INDEX，应用节点/世界矩阵）。
 *
 * 复刻 BlitzKit TankModel.tsx：匹配顶层节点后 jsxTree(node) 渲染整个子树——
 * *_hide_elements* 子树属于真实视觉模型的一部分（audit 2026-08-19 源码确认），
 * 不在此过滤（A1：不再无条件跳过）；最终是否可见由 rasterVisibility
 * （真实 z-buffer）决定。无关节点（如 mask_01）由 groupRenderNodes 的
 * 顶层名匹配天然排除，不设名字黑名单。
 */
export function collectNodeTriangles(node, out, matrix) {
  const m = matrix.clone()
  const t = node.getTranslation()
  const r = node.getRotation()
  const s = node.getScale()
  if (t || r || s) {
    const e = new THREE.Matrix4().compose(
      new THREE.Vector3(t ? t[0] : 0, t ? t[1] : 0, t ? t[2] : 0),
      new THREE.Quaternion(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0, r ? r[3] : 1),
      new THREE.Vector3(s ? s[0] : 1, s ? s[1] : 1, s ? s[2] : 1),
    )
    m.multiply(e)
  }
  const mesh = node.getMesh()
  if (mesh) {
    for (const prim of mesh.listPrimitives()) {
      const posAcc = prim.getAttribute('POSITION')
      if (!posAcc) continue
      const idxAcc = prim.getIndices()
      const positions = posAcc.getArray()
      const v = new THREE.Vector3()
      const transformed = new Float32Array(positions.length)
      for (let i = 0; i < positions.length; i += 3) {
        v.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(m)
        transformed[i] = v.x
        transformed[i + 1] = v.y
        transformed[i + 2] = v.z
      }
      out.push({
        positions: transformed,
        indices: idxAcc ? Array.from(idxAcc.getArray()) : null,
      })
    }
  }
  for (const c of node.listChildren()) {
    collectNodeTriangles(c, out, m)
  }
}

/**
 * 收集节点子树所有 mesh 顶点（POSITION，应用节点/世界矩阵）——与 collectNodeTriangles
 * **同一 hierarchy 语义**（PR92 Review B1 第三轮：verify-pivot-independent.mjs 曾各自
 * 实现一套 traversal，且漏乘 node 自身 TRS；必须单源复用，避免两套语义漂移）：
 *   worldMatrix = parentMatrix · nodeLocalMatrix
 *   1. node 自身 TRS 乘入 worldMatrix 后作用于**自己的 mesh**；
 *   2. children 递归传 worldMatrix（已含自身）。
 * @param {object} node  @gltf-transform Node（或同接口 mock）
 * @param {number[][]} out 输出 [[x,y,z], ...]（模型坐标）
 * @param {THREE.Matrix4} matrix 父链 world matrix（入口传 identity）
 */
export function collectNodeVerts(node, out, matrix) {
  const m = matrix.clone()
  const t = node.getTranslation()
  const r = node.getRotation()
  const s = node.getScale()
  if (t || r || s) {
    const e = new THREE.Matrix4().compose(
      new THREE.Vector3(t ? t[0] : 0, t ? t[1] : 0, t ? t[2] : 0),
      new THREE.Quaternion(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0, r ? r[3] : 1),
      new THREE.Vector3(s ? s[0] : 1, s ? s[1] : 1, s ? s[2] : 1),
    )
    m.multiply(e)
  }
  const mesh = node.getMesh()
  if (mesh) {
    for (const prim of mesh.listPrimitives()) {
      const posAcc = prim.getAttribute('POSITION')
      if (!posAcc) continue
      const positions = posAcc.getArray()
      const v = new THREE.Vector3()
      for (let i = 0; i < positions.length; i += 3) {
        v.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(m)
        out.push([v.x, v.y, v.z])
      }
    }
  }
  for (const c of node.listChildren()) {
    collectNodeVerts(c, out, m)
  }
}

/**
 * 节点分组（复刻 TankModel.tsx 渲染层 + A1 修正）：
 * - hullBody：hull 节点本体（含 *_hide_elements* 子树——BlitzKit 实际渲染）；
 * - tracks：chassis_track_{L,R}（可见性由 z-buffer 决定，顶视完全遮挡时视觉层不画）；
 * - turret：turret_{id:02d}（含其 hide_elements 子树）；
 * - mantlet：gun_{id:02d}_mask（炮盾，视觉层仅画顶视可见面）；
 * - gun：gun_{id:02d}（炮管）。
 * 仅按顶层节点名匹配（复刻 TankModel.tsx 的 isVisible 判定）——mask_01 等无关
 * 顶层节点不在任何 layer，不会被采集（无需名字黑名单）。
 */
export function groupRenderNodes(rootNodes, { turretId, gunId, withWheels }) {
  const turretName = `turret_${String(turretId).padStart(2, '0')}`
  const gunName = `gun_${String(gunId).padStart(2, '0')}`
  const groups = { hullBody: [], tracks: [], turret: [], mantlet: [], gun: [] }
  const identity = new THREE.Matrix4()
  for (const node of rootNodes) {
    const name = node.getName()
    if (name === 'hull') {
      collectNodeTriangles(node, groups.hullBody, identity)
    } else if (name.startsWith('chassis_track_') || (withWheels && name.startsWith('chassis_wheel_'))) {
      collectNodeTriangles(node, groups.tracks, identity)
    } else if (name === turretName) {
      collectNodeTriangles(node, groups.turret, identity)
    } else if (name === gunName) {
      collectNodeTriangles(node, groups.gun, identity)
    } else if (name === `${gunName}_mask`) {
      collectNodeTriangles(node, groups.mantlet, identity)
    }
  }
  return groups
}

// —— BlitzKit definitions 解析共享（extractor CLI 与 bake CLI 共用）——
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import protobuf from 'protobufjs'

/** models.pb schema（BlitzKit 官方 protoc 字段号，勿改——见 protos/models.proto）。 */
export const BLITZKIT_MODELS_PROTO = readFileSync(new URL('./protos/models.proto', import.meta.url), 'utf8')

/** tanks.pb 最小 schema（只提取默认配置选择需要的字段）。 */
export const BLITZKIT_TANKS_MIN_PROTO = [
  'syntax = "proto2";',
  'package blitzkit;',
  'message TankDefinitions { map<uint32, TankDefinition> tanks = 1; }',
  'message TankDefinition {',
  '  optional uint32 id = 1;',
  '  repeated TurretDefinition turrets = 20;',
  '  repeated TrackDefinition tracks = 22;',
  '}',
  'message TurretDefinition {',
  '  optional uint32 id = 1;',
  '  repeated GunDefinition guns = 9;',
  '}',
  'message GunDefinition { optional uint32 id = 4; }',
  'message TrackDefinition { optional uint32 id = 1; }',
  '',
].join('\n')

/** protobufjs toObject 的 map 键可能是 number 或 string，统一容错取数。 */
function mapGet(map, key) {
  if (map == null) return undefined
  return map[key] ?? map[String(key)]
}

/** protobuf 解码（toObject：longs→Number、defaults、keepCase）。 */
export function decodeBlitzkitPb(buffer, typeName, protoText) {
  const root = protobuf.parse(protoText).root
  const Type = root.lookupType(typeName)
  const message = Type.decode(new Uint8Array(buffer))
  return Type.toObject(message, { longs: Number, defaults: true, keepCase: true })
}

/**
 * 默认配置模块选择（复刻 BlitzKit tankToDuelMember 语义：turrets/tracks/guns 数组最后）。
 * 数据驱动（tanks.pb + models.pb），不依赖 display name、不假设 turret_01/gun_01。
 *
 * @param {object} tankDefs  TankDefinitions.toObject（tanks.pb）
 * @param {object} modelDefs ModelDefinitions.toObject（models.pb）
 * @param {number} tankId
 * @returns {{ turretId, gunId, trackId, turretModelId, gunModelId, trackOrigin, turretOrigin }}
 *   trackOrigin / turretOrigin 为 models.pb 引擎坐标（可能 null/缺失）
 */
export function selectDefaultModules(tankDefs, modelDefs, tankId) {
  const tankDef = tankDefs.tanks[String(tankId)]
  if (!tankDef) throw new Error('tanks.pb 无 tankId ' + tankId)
  const modelDef = modelDefs.models[String(tankId)]
  if (!modelDef) throw new Error('models.pb 无 tankId ' + tankId)
  if (!tankDef.turrets || tankDef.turrets.length === 0) {
    throw new Error('tanks.pb 无 turrets 配置（tankId ' + tankId + '）')
  }
  const turretDef = tankDef.turrets[tankDef.turrets.length - 1]
  const gunDef = turretDef.guns[turretDef.guns.length - 1]
  const trackDef = tankDef.tracks?.[tankDef.tracks.length - 1]
  const turretModelId = mapGet(modelDef.turrets, turretDef.id)?.modelId
  const gunModelId = mapGet(mapGet(modelDef.turrets, turretDef.id)?.guns, gunDef.id)?.modelId
  if (turretModelId === undefined || gunModelId === undefined) {
    throw new Error('models.pb 缺 turret/gun model_id（turret=' + turretDef.id + ' gun=' + gunDef.id + '）')
  }
  // hullOrigin（BlitzKit useTankTransform：trackModelDefinition.origin）——选中 track 的 origin
  const trackModelDef = trackDef != null && modelDef.tracks ? modelDef.tracks[String(trackDef.id)] : null
  return {
    turretId: turretDef.id,
    gunId: gunDef.id,
    trackId: trackDef?.id,
    turretModelId,
    gunModelId,
    trackOrigin: trackModelDef?.origin || null,
    turretOrigin: modelDef.turretOrigin || null,
    // 审计用：initial_turret_rotation 只影响初始朝向角，不影响顶视 pivot（computeTurretModelPivot 不消费）
    initialTurretRotation: modelDef.initialTurretRotation || null,
  }
}

/**
 * bake 场景分组（turreted / turretless contract）：
 * - turreted：hull 场景 = hull + tracks（+wheels）；turret 场景 = selected turret + mantlet + gun；
 * - turretless：不生成独立 turret 层——gun/mantlet（casemate）全部 bake 进 hull 场景。
 * 仅按节点名匹配（TankModel.tsx 同款）；alternate turret/gun 节点天然排除。
 *
 * @param {string[]} nodeNames GLB 全部节点名（可含重复——内部去重）
 * @param {object} opts { turretModelId, gunModelId, kind }
 * @returns {{ hullNames: string[], turretNames: string[] }}
 */
export function resolveBakeScenes(nodeNames, { turretModelId, gunModelId, kind }) {
  const turretName = 'turret_' + String(turretModelId).padStart(2, '0')
  const gunName = 'gun_' + String(gunModelId).padStart(2, '0')
  const hullNames = []
  const turretNames = []
  for (const name of new Set(nodeNames)) {
    if (name === 'hull' || name.startsWith('chassis_track_') || name.startsWith('chassis_wheel_')) {
      hullNames.push(name)
    } else if (name === turretName || name === gunName + '_mask' || name === gunName) {
      if (kind === 'turreted') turretNames.push(name)
      else hullNames.push(name)
    }
  }
  return { hullNames, turretNames }
}
