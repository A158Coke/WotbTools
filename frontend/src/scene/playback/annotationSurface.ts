import { chainVisible } from '../pickDebug.js'
import type { Matrix4, Object3D } from 'three'
import { hitWorldNormalY } from './annotation3d.js'
import { occlusionFootprintCells } from './pure.js'

export const ANNOTATION_SURFACE_CELL = 16
export const ANNOTATION_SURFACE_MIN_UP = 0.4
export const ANNOTATION_SURFACE_MIN_CLEARANCE = 0.5
export const ANNOTATION_MAX_SURFACE_CANDIDATES = 400

export interface AnnotationSurfaceMaterial {
  userData?: Record<string, unknown> | null
}

export type AnnotationSurfaceObject = {
  userData?: Record<string, unknown> | null
  material?: AnnotationSurfaceMaterial | AnnotationSurfaceMaterial[] | null
  isMesh?: boolean
  geometry?: unknown
  matrixWorld?: Matrix4 | null
}

export interface AnnotationSurfaceHit {
  object: AnnotationSurfaceObject
  face?: { materialIndex?: number; normal: { x: number; y: number; z: number } } | null
  point?: { x: number; y: number; z: number } | null
  distance: number
  instanceId?: number | null
}

export interface AnnotationSurfaceRaycaster {
  intersectObjects(objects: AnnotationSurfaceObject[], recursive?: boolean): AnnotationSurfaceHit[]
}

export interface AnnotationSurfaceBatch {
  mesh: AnnotationSurfaceObject
  geometry?: {
    boundingSphere?: {
      radius?: number
      center?: { x: number; y: number; z: number } | null
    } | null
    computeBoundingSphere?: () => void
  } | null
  material?: AnnotationSurfaceMaterial | AnnotationSurfaceMaterial[] | null
  items: Array<{
    x: number
    y: number
    hidden?: boolean
    matrix?: { elements: ArrayLike<number> } | null
  }>
}

export type AnnotationSurfaceGrid = Map<string, AnnotationSurfaceObject[]>

export interface AnnotationHitLike {
  point: { x: number; y: number; z: number }
  distance: number
}

function hitMaterial(hit: AnnotationSurfaceHit): AnnotationSurfaceMaterial | null {
  const material = hit.object.material
  if (Array.isArray(material)) return material[hit.face?.materialIndex ?? 0] || null
  return material || null
}

export function isDrawableSurfaceHit(
  hit: AnnotationSurfaceHit,
  terrainY: number | null = null,
): boolean {
  if (!hit || !hit.object || !hit.face) return false
  const object = hit.object
  if (!object.isMesh || !object.geometry) return false
  if (object.userData && object.userData.isSky) return false
  const point = hit.point
  if (!point || !Number.isFinite(point.y)) return false
  const material = hitMaterial(hit)
  if (material && material.userData && material.userData.annotationSurface === false) return false
  if (terrainY !== null && Number.isFinite(terrainY)
      && point.y - terrainY < ANNOTATION_SURFACE_MIN_CLEARANCE) return false
  return hitWorldNormalY(hit) >= ANNOTATION_SURFACE_MIN_UP
}

export function pickDrawableSurfaceHit(
  raycaster: AnnotationSurfaceRaycaster,
  objects: AnnotationSurfaceObject[],
  terrainYAt: ((x: number, z: number) => number | null) | null = null,
): AnnotationSurfaceHit | null {
  if (!raycaster || !Array.isArray(objects) || objects.length === 0) return null
  const hits = raycaster.intersectObjects(objects, false)
  for (const hit of hits) {
    if (!chainVisible(hit.object as Object3D)) continue
    const point = hit.point
    const terrainY = terrainYAt && point ? terrainYAt(point.x, point.z) : null
    if (!isDrawableSurfaceHit(hit, terrainY)) continue
    return hit
  }
  return null
}

export function chooseAnnotationHit(
  groundHit: AnnotationHitLike | null,
  surfaceHit: AnnotationHitLike | null,
): AnnotationHitLike | null {
  if (!surfaceHit) return groundHit || null
  if (!groundHit) return surfaceHit
  return surfaceHit.distance < groundHit.distance ? surfaceHit : groundHit
}

export function buildAnnotationSurfaceGrid(
  batches: AnnotationSurfaceBatch[],
  {
    cell = ANNOTATION_SURFACE_CELL,
    project = null,
  }: {
    cell?: number
    project?: ((item: { x: number; y: number; z: number }) => { x: number; z: number }) | null
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
    const geometry = batch.geometry
    if (geometry && !geometry.boundingSphere && typeof geometry.computeBoundingSphere === 'function') {
      geometry.computeBoundingSphere()
    }
    const sphere = geometry?.boundingSphere
    const localRadius = Number(sphere?.radius) || 0
    const sphereCenter = sphere?.center || null
    for (const item of batch.items) {
      if (!item || item.hidden) continue
      if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) continue
      let localX = item.x
      let localY = item.y
      let localZ = 0
      let scale = 1
      const m = item.matrix?.elements
      if (m && m.length >= 16) {
        const cx = Number(sphereCenter?.x) || 0
        const cy = Number(sphereCenter?.y) || 0
        const cz = Number(sphereCenter?.z) || 0
        localX = m[0] * cx + m[4] * cy + m[8] * cz + m[12]
        localY = m[1] * cx + m[5] * cy + m[9] * cz + m[13]
        localZ = m[2] * cx + m[6] * cy + m[10] * cz + m[14]
        scale = Math.max(
          Math.hypot(m[0], m[1], m[2]),
          Math.hypot(m[4], m[5], m[6]),
          Math.hypot(m[8], m[9], m[10]),
        )
      } else if (sphereCenter) {
        localX += Number(sphereCenter.x) || 0
        localY += Number(sphereCenter.y) || 0
        localZ += Number(sphereCenter.z) || 0
      }
      const center = project ? project({ x: localX, y: localY, z: localZ }) : { x: localX, z: localY }
      if (!Number.isFinite(center.x) || !Number.isFinite(center.z)) continue
      const radius = localRadius * scale
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
