import * as THREE from 'three'
import type { BufferAttribute, BufferGeometry, InterleavedBufferAttribute, Material, Mesh, Object3D, Quaternion } from 'three'

const AXIS_Y = new THREE.Vector3(0, 1, 0)
const AXIS_X = new THREE.Vector3(1, 0, 0)
const AXIS_Z = new THREE.Vector3(0, 0, 1)
const Q_FRAME = new THREE.Quaternion()
  .setFromAxisAngle(AXIS_Y, Math.PI)
  .multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_X, -Math.PI / 2))
const _qYaw = new THREE.Quaternion()
const _qPitch = new THREE.Quaternion()
const _qRoll = new THREE.Quaternion()

export function yprScene(yaw: number | null | undefined, pitch: number | null | undefined, roll: number | null | undefined, out?: Quaternion): Quaternion {
  const q = out || new THREE.Quaternion()
  _qYaw.setFromAxisAngle(AXIS_Y, yaw || 0)
  _qPitch.setFromAxisAngle(AXIS_X, pitch || 0)
  _qRoll.setFromAxisAngle(AXIS_Z, roll || 0)
  return q.copy(_qYaw).multiply(_qPitch).multiply(_qRoll)
}

export function poseLocalBetween(parentW: Quaternion, childW: Quaternion, out?: Quaternion): Quaternion {
  const q = out || new THREE.Quaternion()
  return q.copy(parentW).invert().multiply(childW)
}

export function poseFromYPR(yaw: number | null | undefined, pitch: number | null | undefined, roll: number | null | undefined, out?: Quaternion): Quaternion {
  const q = out || new THREE.Quaternion()
  _qYaw.setFromAxisAngle(AXIS_Y, yaw || 0)
  _qPitch.setFromAxisAngle(AXIS_X, pitch || 0)
  _qRoll.setFromAxisAngle(AXIS_Z, roll || 0)
  return q.copy(_qYaw).multiply(_qPitch).multiply(_qRoll).multiply(Q_FRAME)
}


export const SUSP_TRAVEL_M = 0.25

export const TERRAIN_PROBE_HALF_LEN = 3.3
export const TERRAIN_PROBE_HALF_WID = 1.5

export interface TerrainAttitude {
  pitch: number
  roll: number
}

export function terrainPitchRoll(
  sampleHeight: (x: number, z: number) => number,
  x: number,
  z: number,
  yaw: number,
  out?: TerrainAttitude,
  halfLen: number = TERRAIN_PROBE_HALF_LEN,
  halfWid: number = TERRAIN_PROBE_HALF_WID,
): TerrainAttitude {
  const fx = Math.sin(yaw), fz = Math.cos(yaw)
  const rx = -Math.cos(yaw), rz = Math.sin(yaw)
  const hF = sampleHeight(x + fx * halfLen, z + fz * halfLen)
  const hB = sampleHeight(x - fx * halfLen, z - fz * halfLen)
  const hR = sampleHeight(x + rx * halfWid, z + rz * halfWid)
  const hL = sampleHeight(x - rx * halfWid, z - rz * halfWid)
  const o = out || { pitch: 0, roll: 0 }
  o.pitch = Math.atan2(hB - hF, 2 * halfLen)
  o.roll = Math.atan2(hR - hL, 2 * halfWid)
  return o
}

export interface ClampedHullAttitude {
  pitch: number
  roll: number
  dy: number
}

export function clampHullAttitude(
  recPitch: number,
  recRoll: number,
  recY: number,
  terr: TerrainAttitude,
  terrY: number,
  out?: ClampedHullAttitude,
  halfLen: number = TERRAIN_PROBE_HALF_LEN,
  halfWid: number = TERRAIN_PROBE_HALF_WID,
): ClampedHullAttitude {
  const maxP = Math.atan2(SUSP_TRAVEL_M, halfLen)
  const maxR = Math.atan2(SUSP_TRAVEL_M, halfWid)
  const cl = (v: number, m: number) => Math.max(-m, Math.min(m, v))
  const o = out || { pitch: 0, roll: 0, dy: 0 }
  o.pitch = terr.pitch + cl(recPitch - terr.pitch, maxP)
  o.roll = terr.roll + cl(recRoll - terr.roll, maxR)
  o.dy = cl(recY - terrY, SUSP_TRAVEL_M)
  return o
}

function sameAttributeValues(
  a: BufferAttribute | InterleavedBufferAttribute | null | undefined,
  b: BufferAttribute | InterleavedBufferAttribute | null | undefined,
  epsilon: number,
): boolean {
  if (!a || !b) return a === b
  if (a.itemSize !== b.itemSize || a.count !== b.count) return false
  if (typeof a.getComponent !== 'function' || typeof b.getComponent !== 'function') return false
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < a.itemSize; c++) {
      const d = a.getComponent(i, c) - b.getComponent(i, c)
      if (d > epsilon || d < -epsilon) return false
    }
  }
  return true
}

function sameMeshGeometry(ga: BufferGeometry, gb: BufferGeometry): boolean {
  if (ga === gb) return true
  const namesA = Object.keys(ga.attributes).sort()
  const namesB = Object.keys(gb.attributes).sort()
  if (namesA.length !== namesB.length) return false
  for (let i = 0; i < namesA.length; i++) {
    if (namesA[i] !== namesB[i]) return false
    if (!sameAttributeValues(ga.attributes[namesA[i]], gb.attributes[namesB[i]], 1e-6)) return false
  }
  if (!sameAttributeValues(ga.index, gb.index, 0)) return false
  const ma = Object.keys(ga.morphAttributes || {}).sort()
  const mb = Object.keys(gb.morphAttributes || {}).sort()
  if (ma.length !== mb.length) return false
  for (let i = 0; i < ma.length; i++) if (ma[i] !== mb[i]) return false
  return true
}

/**
 * 丢弃与 `gun_NN_mask` **几何数据完全一致**的 `mask_NN` 重复件。
 *
 * 实测（2026-10-03）：Maus（tank 6929；全 735 台里唯一一个）的视觉模型同时存在
 * `gun_01_mask` 与 `mask_01` 两个节点——两者**共用同一套索引/UV accessor，位置数据逐值
 * 相同**，即同一块炮盾的重复副本。装配 rig 只按名字摆位（`^gun_\d+(_mask)?$`
 * 随炮管、`turret_\d+` 随炮塔），`mask_NN` 不在其中，于是炮塔/炮管转走后这份副本
 * **留在原地**（表现为"原地还剩一块炮盾"），且两份共面几何本就互相 z-fighting。
 *
 * 判据是**几何数据一致**（子树内 mesh 数、逐 mesh 的 position/normal/uv/index 逐值相等，
 * 见 `sameMeshGeometry`）而不只是命名或包围盒：几何不同则原样保留——绝不凭"名字像副本"
 * 就删掉可见部件。
 *
 * dispose 归属：删除前核对**没有保留节点**引用同一 `BufferGeometry`、也没有引用它内部的
 * 任何 attribute / index 对象才释放——实测真实 Maus 资产上两份副本的 TEXCOORD_0 /
 * TEXCOORD_1 / INDEX 就是**共享的 accessor 对象**（只有 POSITION / NORMAL 是各写一份），
 * 释放被删几何会连带把保留部件仍在用的 GPU buffer 一起回收。materials / textures
 * 一律不在此处释放。
 *
 * @returns 丢弃的节点数（0 = 无副本，正常）
 */
export function dropDuplicateGunMasks(root: Object3D | null | undefined): number {
  if (!root) return 0
  const meshesOf = (node: Object3D): Mesh[] => {
    const out: Mesh[] = []
    node.traverse((n) => { const m = n as Mesh; if (m.isMesh && m.geometry) out.push(m) })
    return out
  }
  const sameGeometry = (a: Mesh[], b: Mesh[]): boolean => {
    if (a.length !== b.length || !a.length) return false
    return a.every((ma, i) => sameMeshGeometry(ma.geometry, b[i].geometry))
  }
  const byName = new Map<string, Object3D>()
  root.traverse((n) => { if (n.name) byName.set(n.name, n) })
  let dropped = 0
  for (const [name, node] of byName) {
    const m = name.match(/^mask_(\d+)$/)
    if (!m) continue
    const counterpart = byName.get(`gun_${m[1]}_mask`)
    if (!counterpart || !sameGeometry(meshesOf(node), meshesOf(counterpart))) continue
    const removed = meshesOf(node)
    const removedSet = new Set(removed)
    const stillReferenced = new Set<BufferAttribute | BufferGeometry | InterleavedBufferAttribute>()
    root.traverse((n) => {
      const mesh = n as Mesh
      if (!mesh.isMesh || !mesh.geometry || removedSet.has(mesh)) return
      stillReferenced.add(mesh.geometry)
      for (const key of Object.keys(mesh.geometry.attributes)) stillReferenced.add(mesh.geometry.attributes[key])
      if (mesh.geometry.index) stillReferenced.add(mesh.geometry.index)
    })
    for (const mesh of removed) {
      const geometry = mesh.geometry
      const shared = stillReferenced.has(geometry)
        || (geometry.index && stillReferenced.has(geometry.index))
        || Object.keys(geometry.attributes).some((key) => stillReferenced.has(geometry.attributes[key]))
      if (!shared) geometry.dispose()
    }
    if (node.parent) node.parent.remove(node)
    else root.remove(node)
    dropped++
  }
  return dropped
}

export function neutralizeDefaultMetalness(root: Object3D): void {
  root.traverse((node) => {
    const mesh = node as Mesh
    if (!mesh.isMesh) return
    const material = mesh.material as (Material & { metalnessMap?: Material | null; metalness?: number }) | undefined
    if (material && !material.metalnessMap && material.metalness === 1) material.metalness = 0
  })
}

export interface DetachedTurretParts {
  turretNode: Object3D | null
  gunNodes: Object3D[]
  tP: [number, number, number]
  gP: [number, number, number]
  itr?: { pitch?: number; roll?: number; yaw?: number } | null
}

export function cloneDetachedTurret(model: Object3D, parts: DetachedTurretParts, gunPitch: number): THREE.Group {
  model.updateMatrixWorld(true)
  const toModel = model.matrixWorld.clone().invert()
  const { turretNode, gunNodes, tP, gP, itr } = parts
  const assembly = new THREE.Group()
  const centre = new THREE.Matrix4().makeTranslation(-tP[0], -tP[1], -tP[2])
  if (itr) {
    const fixed = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
      -THREE.MathUtils.degToRad(itr.pitch || 0), -THREE.MathUtils.degToRad(itr.roll || 0),
      -THREE.MathUtils.degToRad(itr.yaw || 0), 'ZYX'))
    centre.premultiply(fixed)
  }
  const gunRotation = new THREE.Matrix4().makeTranslation(...gP)
    .multiply(new THREE.Matrix4().makeRotationX(gunPitch))
    .multiply(new THREE.Matrix4().makeTranslation(-gP[0], -gP[1], -gP[2]))
  const gunMeshes = new Set<Mesh>()
  for (const node of gunNodes) node.traverseVisible(n => { const m = n as Mesh; if (m.isMesh) gunMeshes.add(m) })
  const meshes = new Set<Mesh>()
  const assemblyNodes = turretNode ? [turretNode, ...gunNodes] : gunNodes
  for (const node of assemblyNodes) node.traverseVisible(n => { const m = n as Mesh; if (m.isMesh) meshes.add(m) })
  for (const mesh of meshes) {
    const copy = mesh.clone(false)
    copy.matrixAutoUpdate = false
    copy.matrix.copy(centre)
    if (gunMeshes.has(mesh)) copy.matrix.multiply(gunRotation)
    copy.matrix.multiply(toModel).multiply(mesh.matrixWorld)
    assembly.add(copy)
  }
  assembly.quaternion.copy(Q_FRAME)
  return assembly
}
