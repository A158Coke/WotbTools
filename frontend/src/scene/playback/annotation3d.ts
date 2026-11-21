// 3D Playback 标注的纯几何：terrain-conforming pen ribbon 与 eraser ring。
//
// 坐标约定：本模块只认 scene-map XZ（x 右、z 北）。无 surfaceY 的 row 输出
// vertex Y = sampleHeight(x,z) + lift；带 surfaceY 的 row 是选中表面层，用锚点高度 +
// surfaceN 的局部 plane 生成倾斜 cross-section（无 normal 时退化为水平截面），不再向下采
// terrain。semantic(replay) XZ 与 scene 的 x 取负由 playbackScene 的 adapter 负责；annotation
// SSOT 仍以 semantic XZ 为 canonical，surfaceY/surfaceN 只是可选的 session-local 锚点。
//
import * as THREE from 'three'
import type { Object3D, Vector3 } from 'three'
import { ANNOTATION_LIFT, ANNOTATION_RING_SEGMENTS, normalizeNormal, numberOr, sampleOrNull } from './annotationPoints.js'
import type { SemanticPoint, HeightSampler } from './annotationPoints.js'

export {
  ANNOTATION_LIFT, ANNOTATION_MAX_INPUT_POINTS, ANNOTATION_MAX_COMMITTED_POINTS,
  ANNOTATION_MITER_LIMIT, ANNOTATION_RING_SEGMENTS, ANNOTATION_MAX_ERASER_POINTS,
  sanitizePoints, subdividePolyline, smoothPolyline, normalizePenPoints,
} from './annotationPoints.js'
export type { SemanticPoint, PenAnnotation, HeightSampler } from './annotationPoints.js'
export { buildPenRibbon, reprojectRibbonPositions } from './annotationRibbon.js'
export type { PenRibbonStrip, PenRibbonResult } from './annotationRibbon.js'

const _hitWorld = new THREE.Matrix4()
const _hitInstance = new THREE.Matrix4()
const _hitNormalMatrix = new THREE.Matrix3()
const _hitNormal = new THREE.Vector3()

/**
 * 命中面的 world normal（InstancedMesh 先乘 instanceMatrix）。
 * 3D annotation pick 的“朝上表面”判据和 anchored cross-section 的局部 plane normal。
 */
/** 结构化命中面（three Intersection 与 playback/annotationSurface 的替身都兼容）。 */
export interface AnnotationHitLike {
  object?: { matrixWorld?: THREE.Matrix4 | null } | null | undefined
  face?: { normal?: { x: number; y: number; z: number } } | null | undefined
  instanceId?: number | null | undefined
}

export function hitWorldNormal(hit: AnnotationHitLike | null | undefined, target: Vector3 | null = null): Vector3 | null {
  if (!hit || !hit.face || !hit.object) return null
  const object = hit.object as (Object3D & { isInstancedMesh?: boolean; getMatrixAt(index: number, matrix: THREE.Matrix4): void }) | null | undefined
  if (!object || !object.matrixWorld) return null
  if (hit.instanceId != null && object.isInstancedMesh && typeof object.getMatrixAt === 'function') {
    object.getMatrixAt(hit.instanceId, _hitInstance)
    _hitWorld.multiplyMatrices(object.matrixWorld, _hitInstance)
  } else {
    _hitWorld.copy(object.matrixWorld)
  }
  const faceNormal = hit.face?.normal
  if (!faceNormal || !Number.isFinite(faceNormal.x)) return null
  _hitNormalMatrix.getNormalMatrix(_hitWorld)
  _hitNormal.copy(faceNormal).applyMatrix3(_hitNormalMatrix).normalize()
  return target ? target.copy(_hitNormal) : _hitNormal
}

export function hitWorldNormalY(hit: AnnotationHitLike | null | undefined): number {
  const normal = hitWorldNormal(hit)
  return normal ? normal.y : 0
}

/**
 * eraser 预览圆环：只用于 scene 的 LineLoop，不进 annotation state/history。
 * 边缘采样失败（出地形）时回退 center 高度，保证 ring 不会缺段；这是预览 affordance，
 * 不是 durable geometry。
 */
export function buildEraserRing(center: SemanticPoint | null | undefined, radius: number, sampleHeight: HeightSampler, {
  segments = ANNOTATION_RING_SEGMENTS,
  lift = ANNOTATION_LIFT / 2,
}: {
  segments?: number
  lift?: number
} = {}): { positions: Float32Array; segments: number } | null {
  if (!center || !Number.isFinite(Number(center.x)) || !Number.isFinite(Number(center.y))) return null
  const r = Number(radius)
  if (!Number.isFinite(r) || r <= 0 || typeof sampleHeight !== 'function') return null
  const n = Math.max(8, Math.min(128, Math.floor(numberOr(segments, ANNOTATION_RING_SEGMENTS))))
  const cx = Number(center.x)
  const cz = Number(center.y)
  // eraser cursor 落在选中表面时，整个 ring 留在该层；否则沿用 terrain。
  const centerAnchor = Number.isFinite(center.surfaceY) ? Number(center.surfaceY) : null
  const centerY = centerAnchor !== null ? centerAnchor : sampleOrNull(sampleHeight, cx, cz)
  const normal = centerAnchor !== null ? normalizeNormal(center.surfaceN) : undefined
  const liftValue = numberOr(lift, ANNOTATION_LIFT / 2)
  const positions = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2
    const x = cx + Math.cos(angle) * r
    const z = cz + Math.sin(angle) * r
    let y = centerAnchor !== null ? centerAnchor : sampleOrNull(sampleHeight, x, z)
    if (centerAnchor !== null && normal && Math.abs(normal.y) > 1e-6) {
      // semantic eraser 仍是 XZ circle；visual ring 点投到同一 surface plane。
      const dx = x - cx
      const dz = z - cz
      y = centerAnchor - (normal.x * dx + normal.z * dz) / normal.y
    }
    positions[i * 3] = x
    positions[i * 3 + 1] = (y === null ? (centerY === null ? 0 : centerY) : y) + liftValue
    positions[i * 3 + 2] = z
  }
  return { positions, segments: n }
}
