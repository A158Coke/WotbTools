// 3D annotation 的“可绘制静态表面”policy：候选格、拾取过滤、最近命中选择。
//
// 职责边界：
// - 只回答“这个 scenery 命中是否是一个可选中的 3D 表面”，不拥有 annotation 状态；
// - 不碰车辆 / 地图资产装配 / renderer；候选由装配期建立的 annotationSurfaceGrid 提供；
// - 不引入 BVH / 全场景 intersectObject(mapScenery, true)：16m 足印候选格的量级
//   与标签遮挡同一套（见 playbackScene.sceneryBlocksAim 的成本注释）。
//
// 本模块保持无 three import（three 尚未随包提供 d.ts，scene 侧 TS 无法直接引用）；
// world normal 的矩阵运算在既有 JS 几何模块 annotation3d.js（hitWorldNormalY）。
import { chainVisible } from '../pickDebug.js'
import { hitWorldNormalY } from './annotation3d.js'
import { occlusionFootprintCells } from './pure.js'

/** 候选格边长（米），与标签遮挡的 OCCL_CELL 同口径。 */
export const ANNOTATION_SURFACE_CELL = 16
/** 可绘制表面的 world normal.y 下限（约 26°）。水平投影的 ribbon 在更陡表面上会明显偏离。 */
export const ANNOTATION_SURFACE_MIN_UP = 0.9
/** 单次 pick 的候选 batch 上限；超限 fail-open 到 terrain，避免密集场景尖峰。 */
export const ANNOTATION_MAX_SURFACE_CANDIDATES = 400

export interface AnnotationSurfaceMaterial {
  userData?: Record<string, unknown> | null
}

export interface AnnotationSurfaceObject {
  userData?: Record<string, unknown> | null
  material?: AnnotationSurfaceMaterial | AnnotationSurfaceMaterial[] | null
  isMesh?: boolean
  geometry?: unknown
}

/** THREE.Intersection 的结构子集；不直接 import three 的类型。 */
export interface AnnotationSurfaceHit {
  object: AnnotationSurfaceObject
  face?: { materialIndex?: number } | null
  point?: { y?: number } | null
  distance: number
  instanceId?: number | null
  [key: string]: unknown
}

export interface AnnotationSurfaceRaycaster {
  intersectObjects(objects: AnnotationSurfaceObject[], recursive?: boolean): AnnotationSurfaceHit[]
}

/** 场景装配产出的 batch（与 sceneryInstancing.groupInstanceBatches 的结构对齐）。 */
export interface AnnotationSurfaceBatch {
  mesh: AnnotationSurfaceObject
  geometry?: {
    boundingSphere?: { radius?: number } | null
    computeBoundingSphere?: () => void
  } | null
  material?: AnnotationSurfaceMaterial | AnnotationSurfaceMaterial[] | null
  items: Array<{
    x: number
    y: number
    hidden?: boolean
    node?: { userData?: Record<string, unknown> | null } | null
  }>
}

export type AnnotationSurfaceGrid = Map<string, AnnotationSurfaceObject[]>

export interface AnnotationHitLike {
  point: { y: number }
  distance: number
}

function hitMaterial(hit: AnnotationSurfaceHit): AnnotationSurfaceMaterial | null {
  const material = hit.object.material
  if (Array.isArray(material)) return material[hit.face?.materialIndex ?? 0] || null
  return material || null
}

/**
 * 可绘制表面判定：
 * - 必须是 Mesh 且有 face / 有限命中点；
 * - 装配期标记为 annotationSurface=false 的材质（水/天/植被/贴花/混合层/水下/地表薄板）跳过；
 * - 只接受朝上的表面（world normal.y ≥ 0.9），墙面/陡坡回落到地形。
 */
export function isDrawableSurfaceHit(hit: AnnotationSurfaceHit): boolean {
  if (!hit || !hit.object || !hit.face) return false
  const object = hit.object
  if (!object.isMesh || !object.geometry) return false
  if (object.userData && object.userData.isSky) return false
  if (!Number.isFinite(hit.point?.y)) return false
  const material = hitMaterial(hit)
  if (material && material.userData && material.userData.annotationSurface === false) return false
  return hitWorldNormalY(hit) >= ANNOTATION_SURFACE_MIN_UP
}

/** 在候选 batch 中取最近的、可见且可绘制的命中。 */
export function pickDrawableSurfaceHit(
  raycaster: AnnotationSurfaceRaycaster,
  objects: AnnotationSurfaceObject[],
): AnnotationSurfaceHit | null {
  if (!raycaster || !Array.isArray(objects) || objects.length === 0) return null
  const hits = raycaster.intersectObjects(objects, false)
  for (const hit of hits) {
    if (!chainVisible(hit.object)) continue
    if (!isDrawableSurfaceHit(hit)) continue
    return hit
  }
  return null
}

/** terrain 与 scenery 两个候选取更近者；任一侧缺失时返回另一侧。 */
export function chooseAnnotationHit(
  groundHit: AnnotationHitLike | null,
  surfaceHit: AnnotationHitLike | null,
): AnnotationHitLike | null {
  if (!surfaceHit) return groundHit || null
  if (!groundHit) return surfaceHit
  return surfaceHit.distance < groundHit.distance ? surfaceHit : groundHit
}

/**
 * 从装配期 batch 构建 annotation 候选格：
 * - 跳过材质/节点已标记 annotationSurface=false 的 batch；
 * - 跳过 hidden 实例（D_ 槽位在 y=-1e6）；
 * - 用实例足印（几何包围球半径）登记全部覆盖格，与 occlGrid 同粒度但**不要求节点名**。
 */
export function buildAnnotationSurfaceGrid(
  batches: AnnotationSurfaceBatch[],
  {
    cell = ANNOTATION_SURFACE_CELL,
    project = null,
  }: {
    cell?: number
    /** 批次 item 是 gltf 局部系；运行时按装配根（gltf.scene）的 matrixWorld 投到世界 XZ。 */
    project?: ((item: { x: number; y: number }) => { x: number; z: number }) | null
  } = {},
): AnnotationSurfaceGrid {
  const grid: AnnotationSurfaceGrid = new Map()
  if (!Array.isArray(batches)) return grid
  for (const batch of batches) {
    if (!batch || !batch.mesh || !Array.isArray(batch.items) || batch.items.length === 0) continue
    if (batch.material) {
      const materials = Array.isArray(batch.material) ? batch.material : [batch.material]
      if (materials.some((m) => m && m.userData && m.userData.annotationSurface === false)) continue
    }
    if (batch.items.some((item) => item && item.node && item.node.userData
      && item.node.userData.annotationSurface === false)) continue
    const geometry = batch.geometry
    if (geometry && !geometry.boundingSphere && typeof geometry.computeBoundingSphere === 'function') {
      geometry.computeBoundingSphere()
    }
    const radius = geometry?.boundingSphere?.radius || 0
    for (const item of batch.items) {
      if (!item || item.hidden) continue
      if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) continue
      const center = project ? project(item) : { x: item.x, z: item.y }
      if (!Number.isFinite(center.x) || !Number.isFinite(center.z)) continue
      const keys = occlusionFootprintCells(
        center.x - radius, center.z - radius, center.x + radius, center.z + radius, cell,
      )
      for (const key of keys) {
        const list = grid.get(key)
        if (!list) grid.set(key, [batch.mesh])
        else if (!list.includes(batch.mesh)) list.push(batch.mesh)
      }
    }
  }
  return grid
}

/** 候选格 → 去重后的 batch 列表；超过上限返回 null（调用方回落到 terrain）。 */
export function collectSurfaceCandidates(
  grid: AnnotationSurfaceGrid | null | undefined,
  cells: Iterable<string>,
  max = ANNOTATION_MAX_SURFACE_CANDIDATES,
): AnnotationSurfaceObject[] | null {
  if (!grid || !cells) return null
  const out: AnnotationSurfaceObject[] = []
  const seen = new Set<AnnotationSurfaceObject>()
  for (const key of cells) {
    const list = grid.get(key)
    if (!list) continue
    for (const object of list) {
      if (seen.has(object)) continue
      seen.add(object)
      out.push(object)
    }
    if (out.length > max) return null
  }
  return out
}
