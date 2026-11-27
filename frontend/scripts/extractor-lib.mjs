import { toSvg } from './extractor-planar.mjs'
export { bounds2D, toSvg, projectTriangles, unionTriangles, simplifyRing, silhouetteToSvgPaths } from './extractor-planar.mjs'
export { projectTopFacingPolygons, mergeVisualSurfaces, extractTopSurfaces, filterOccludedSurfaces, rasterVisibility, visibilityPixel, filterDegeneratePolys } from './extractor-surfaces.mjs'
export { buildFeatureAudit, extractMajorEdges, clusterEdges, classifyDetail, surfacesToSvgPaths, edgesToSvgPath } from './extractor-details.mjs'


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

export function projectTopDown(v) {
  return { x: v.x, y: v.y }
}

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

import * as THREE from 'three'

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

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import protobuf from 'protobufjs'

export const BLITZKIT_MODELS_PROTO = readFileSync(new URL('./protos/models.proto', import.meta.url), 'utf8')

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

function mapGet(map, key) {
  if (map == null) return undefined
  return map[key] ?? map[String(key)]
}

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
  const trackModelDef = trackDef != null && modelDef.tracks ? modelDef.tracks[String(trackDef.id)] : null
  return {
    turretId: turretDef.id,
    gunId: gunDef.id,
    trackId: trackDef?.id,
    turretModelId,
    gunModelId,
    trackOrigin: trackModelDef?.origin || null,
    turretOrigin: modelDef.turretOrigin || null,
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
