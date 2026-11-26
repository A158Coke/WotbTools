import * as THREE from 'three'
import type { Box3, BufferGeometry, Camera, Frustum, Group, Mesh, Object3D, PerspectiveCamera } from 'three'
import type { AgentVehicleTrack } from '../../api/agent-replay-facets.js'
import { shellTypeOf, shellAngles } from '../viewer/armorPlateModel.js'
import type { AgentPlaybackShot } from '../../api/agent-replay-facets.js'

export const OCCLUDER_LAYER = 2

export const RT_BUCKET_PX = 64

const VEHICLE_PICK_RADIUS_M = 15

export function bucketedRtSize(px: number, cap: number): number {
  return Math.min(Math.max(Math.ceil(px / RT_BUCKET_PX) * RT_BUCKET_PX, 1), Math.max(1, Math.floor(cap)))
}

export function spacedRectOf(px: number, py: number, pw: number, ph: number, fullW: number, fullH: number, out: THREE.Vector4): THREE.Vector4 {
  return out.set(px / fullW, py / fullH, pw / fullW, ph / fullH)
}

export function spacedBufferUv(scX: number, scY: number, rect: THREE.Vector4, out: THREE.Vector2): THREE.Vector2 {
  return out.set((scX - rect.x) / rect.z, (scY - rect.y) / rect.w)
}
const _aimNdc = new THREE.Vector3()
export function reticleAimDirection(camera: Camera, aimPoint: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 | null {
  _aimNdc.copy(aimPoint).project(camera)
  if (![_aimNdc.x, _aimNdc.y, _aimNdc.z].every((n) => Number.isFinite(n) && Math.abs(n) <= 1)) return null
  out.subVectors(aimPoint, camera.position)
  return out.lengthSq() > 0 ? out.normalize() : null
}

function collectVisibleMeshes(node: Object3D, out: Mesh[]): void {
  if (!node.visible) return
  const mesh = node as Mesh
  if (mesh.isMesh) out.push(mesh)
  for (const child of node.children) collectVisibleMeshes(child, out)
}

export function markPickBoundsStale(geometry: BufferGeometry): void {
  geometry.userData.pickBoundsStale = true
}

const _pickBox = new THREE.Box3()
const _pickCenter = new THREE.Vector3()
function refreshPickBounds(geometry: BufferGeometry): void {
  if (!geometry.userData.pickBoundsStale) return
  const pos = geometry.getAttribute('position')
  if (!pos || 'isInterleavedBufferAttribute' in pos) {
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    geometry.userData.pickBoundsStale = false
    return
  }
  const a = pos.array as ArrayLike<number>
  const count = pos.count
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < count; i++) {
    const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  if (minX > maxX) { minX = maxX = 0; minY = maxY = 0; minZ = maxZ = 0 }
  _pickBox.min.set(minX, minY, minZ)
  _pickBox.max.set(maxX, maxY, maxZ)
  if (geometry.boundingBox) geometry.boundingBox.copy(_pickBox)
  else geometry.boundingBox = _pickBox.clone()
  _pickCenter.addVectors(_pickBox.min, _pickBox.max).multiplyScalar(0.5)
  const half = _pickCenter.distanceTo(_pickBox.max)
  if (geometry.boundingSphere) {
    geometry.boundingSphere.center.copy(_pickCenter)
    geometry.boundingSphere.radius = half
  } else {
    geometry.boundingSphere = new THREE.Sphere(_pickCenter.clone(), half)
  }
  geometry.userData.pickBoundsStale = false
}

const _pickRaycaster = new THREE.Raycaster()
const _pickMeshes: Mesh[] = []
const _pickHits: THREE.Intersection[] = []
const _pickRoot = new THREE.Vector3()
const _pickOffset = new THREE.Vector3()
const _pickSphere = new THREE.Sphere()
const _pickFrustum = new THREE.Frustum()
const _pickViewProjection = new THREE.Matrix4()
const _pickCandidates: Array<{ v: AimedVehicleCandidate | null; lower: number }> = []
const _pickPool: Array<{ v: AimedVehicleCandidate | null; lower: number }> = []
let _pickPoolUsed = 0
export interface AimedVehicleCandidate {
  glb: Group
  def: AgentVehicleTrack | { eid?: number; tank_id?: number | null; equipment?: unknown }
  tankData?: unknown
  group?: Object3D
  glbParts?: { poseT: THREE.Matrix4; poseG: THREE.Matrix4; gunNodes: Object3D[] }
}

export function aimedVehicle(origin: THREE.Vector3, direction: THREE.Vector3, vehicles: AimedVehicleCandidate[], camera: PerspectiveCamera | null = null): AimedVehicleCandidate | null {
  _pickRaycaster.set(origin, direction)
  if (camera) {
    _pickViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    _pickFrustum.setFromProjectionMatrix(_pickViewProjection, camera.coordinateSystem)
  }
  _pickCandidates.length = 0
  _pickPoolUsed = 0
  for (const v of vehicles) {
    _pickRoot.setFromMatrixPosition(v.glb.matrixWorld)
    if (_pickRaycaster.ray.distanceSqToPoint(_pickRoot) > VEHICLE_PICK_RADIUS_M ** 2) continue
    if (camera) {
      _pickSphere.center.copy(_pickRoot)
      _pickSphere.radius = VEHICLE_PICK_RADIUS_M
      if (!_pickFrustum.intersectsSphere(_pickSphere)) continue
    }
    const along = _pickOffset.subVectors(_pickRoot, origin).dot(_pickRaycaster.ray.direction)
    const c = _pickPool[_pickPoolUsed] || (_pickPool[_pickPoolUsed] = { v: null as AimedVehicleCandidate | null, lower: 0 })
    _pickPoolUsed++
    c.v = v
    c.lower = Math.max(0, along - VEHICLE_PICK_RADIUS_M)
    _pickCandidates.push(c)
  }
  _pickCandidates.sort((a, b) => a.lower - b.lower)
  let best: AimedVehicleCandidate | null = null, bestDistance = Infinity
  for (const cand of _pickCandidates) {
    const v = cand.v
    const lower = cand.lower
    if (!v || lower > bestDistance) continue
    _pickMeshes.length = 0
    _pickHits.length = 0
    collectVisibleMeshes(v.glb, _pickMeshes)
    for (const mesh of _pickMeshes) {
      refreshPickBounds(mesh.geometry)
      mesh.raycast(_pickRaycaster, _pickHits)
    }
    for (const hit of _pickHits) {
      if (hit.distance < bestDistance) { best = v; bestDistance = hit.distance }
    }
  }
  return best
}

const _rectCorner = new THREE.Vector3()
export function screenRect(box: Box3, camera: PerspectiveCamera): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < 8; i++) {
    _rectCorner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
    _rectCorner.applyMatrix4(camera.matrixWorldInverse)
    if (_rectCorner.z >= -camera.near) return { x0: -1, y0: -1, x1: 1, y1: 1 }
    _rectCorner.applyMatrix4(camera.projectionMatrix)
    x0 = Math.min(x0, _rectCorner.x); x1 = Math.max(x1, _rectCorner.x)
    y0 = Math.min(y0, _rectCorner.y); y1 = Math.max(y1, _rectCorner.y)
  }
  const rect = { x0: Math.max(x0, -1), y0: Math.max(y0, -1), x1: Math.min(x1, 1), y1: Math.min(y1, 1) }
  return rect.x1 > rect.x0 && rect.y1 > rect.y0 ? rect : null
}

const _cropMatrix = new THREE.Matrix4()
const _viewProjection = new THREE.Matrix4()
export function cropFrustum(camera: PerspectiveCamera, rect: { x0: number; y0: number; x1: number; y1: number }, out: Frustum): Frustum {
  const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0
  _cropMatrix.set(
    2 / w, 0, 0, -(rect.x1 + rect.x0) / w,
    0, 2 / h, 0, -(rect.y1 + rect.y0) / h,
    0, 0, 1, 0,
    0, 0, 0, 1,
  )
  _viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  return out.setFromProjectionMatrix(_cropMatrix.multiply(_viewProjection), camera.coordinateSystem)
}


export function armorPosePart(name: string): 'turret' | 'gun' | 'hull' {
  if (/^turret_\d+/.test(name)) return 'turret'
  if (/^gun_\d+/.test(name)) return 'gun'
  return 'hull'
}

export function armorWorldMatrix(root: THREE.Matrix4, pose: THREE.Matrix4, rest: THREE.Matrix4, out: THREE.Matrix4): THREE.Matrix4 {
  return out.copy(root).multiply(pose).multiply(rest)
}

export function shellUniforms(shell: AgentPlaybackShot | Record<string, unknown>, caliber: number) {
  const type = shellTypeOf(shell as { type?: unknown })
  const isHE = type === 'he'
  const isExplosive = isHE || type === 'heat'
  return { type, isHE, isExplosive, caliber, ...shellAngles(shell as { normalization?: number | null; ricochet?: number | null }, isExplosive) }
}
