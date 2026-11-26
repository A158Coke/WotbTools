import * as THREE from 'three'
import { mapImages } from '../../data/mapImages.js'
import { semanticWidthFromSlider } from '../../utils/annotation.js'
import { occlusionCells } from './pure.js'
import { chainVisible } from '../pickDebug.js'
import { hitWorldNormal } from './annotation3d.js'
import type { SemanticPoint } from './annotation3d.js'
import { collectSurfaceCandidates, pickDrawableSurfaceHit } from './annotationSurface.ts'
import type { AnnotationSceneDeps, AnnotationControls } from './annotationScene.js'

export type AnnotationPickerDeps = Pick<
  AnnotationSceneDeps,
  'getCamera' | 'getRaycaster' | 'getControls' | 'mapWorld' | 'annotationSurfaceHeightAt'
> & { container: HTMLElement }

export interface AnnotationSurfacePicker {
  resetRaycaster(): void
  semanticNormal(normal: { x?: unknown; y?: unknown; z?: unknown } | null | undefined): { x: number; y: number; z: number } | undefined
  semanticFromScene(x: number, z: number, surfaceY?: number, surfaceN?: { x: number; y: number; z: number }): SemanticPoint
  semanticPoint(point: SemanticPoint): SemanticPoint
  sceneFromSemantic(point: SemanticPoint): SemanticPoint
  setRaycasterFromClient(clientX: number, clientY: number, rect: DOMRect, rc?: THREE.Raycaster): void
  raycastAnnotationGround(clientX: number, clientY: number, rect: DOMRect): { point: THREE.Vector3; distance: number } | null
  raycastAnnotationScenery(
    clientX: number, clientY: number, rect: DOMRect,
    groundHit: { point: THREE.Vector3; distance: number } | null,
  ): { point: THREE.Vector3; distance: number; surfaceY: number; surfaceN?: { x: number; y: number; z: number } } | null
  debugPickAnnotationSurface(clientX: number, clientY: number): Record<string, unknown>
  annotationSemanticWidth(sliderValue: number): number
}

export function createAnnotationSurfacePicker(deps: AnnotationPickerDeps): AnnotationSurfacePicker {
  const { container } = deps
  let annotationSurfaceRaycaster: THREE.Raycaster | null = null

  function semanticNormal(normal: { x?: unknown; y?: unknown; z?: unknown } | null | undefined) {
    if (!normal || !Number.isFinite(normal.x as number) || !Number.isFinite(normal.y as number) || !Number.isFinite(normal.z as number)) return undefined
    return { x: normal.x, y: normal.y, z: normal.z } as { x: number; y: number; z: number }
  }

  function semanticFromScene(x: number, z: number, surfaceY?: number, surfaceN?: { x: number; y: number; z: number }) {
    const out: SemanticPoint & { surfaceN?: { x: number; y: number; z: number } } = { x: -x, y: z }
    if (Number.isFinite(surfaceY)) out.surfaceY = surfaceY
    const normal = semanticNormal(surfaceN)
    if (normal) out.surfaceN = normal
    return out
  }

  function semanticPoint(point: SemanticPoint) {
    const out: SemanticPoint & { surfaceN?: { x: number; y: number; z: number } } = { x: point.x, y: point.y }
    if (Number.isFinite(point.surfaceY)) out.surfaceY = point.surfaceY
    const normal = semanticNormal(point.surfaceN)
    if (normal) out.surfaceN = normal
    return out
  }

  function sceneFromSemantic(point: SemanticPoint) {
    const out: SemanticPoint & { surfaceN?: { x: number; y: number; z: number } } = { x: -point.x, y: point.y }
    if (Number.isFinite(point.surfaceY)) out.surfaceY = point.surfaceY
    const normal = semanticNormal(point.surfaceN)
    if (normal) out.surfaceN = normal
    return out
  }
  function setRaycasterFromClient(clientX: number, clientY: number, rect: DOMRect, rc: THREE.Raycaster = deps.getRaycaster()) {
    const camera = deps.getCamera()
    const nd = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    if (!Number.isFinite(camera.aspect) || camera.aspect <= 0) {
      camera.aspect = rect.width / rect.height
      camera.updateProjectionMatrix()
    }
    camera.updateMatrixWorld()
    rc.setFromCamera(nd, camera)
  }

  function raycastAnnotationGround(clientX: number, clientY: number, rect: DOMRect) {
    const camera = deps.getCamera()
    const raycaster = deps.getRaycaster()
    const controls = deps.getControls() as AnnotationControls | null
    if (!camera || !raycaster || !controls || !rect || !(rect.width > 0) || !(rect.height > 0)) return null
    setRaycasterFromClient(clientX, clientY, rect)
    const origin = raycaster.ray.origin
    const direction = raycaster.ray.direction
    const maxT = Math.min(4000, Number.isFinite(camera.far) ? camera.far : 4000)
    const distance = camera.position.distanceTo(controls.target)
    const step = Math.max(1.5, Math.min(8, (Number.isFinite(distance) ? distance : 200) / 160))
    const ceiling = (Number.isFinite(Number(deps.mapWorld.heightMeta()?.zmax)) ? Number(deps.mapWorld.heightMeta()!.zmax) : 50) + 100
    let prevT = 0
    for (let t = step; t <= maxT; t += step) {
      const x = origin.x + direction.x * t
      const y = origin.y + direction.y * t
      const z = origin.z + direction.z * t
      const surface = deps.annotationSurfaceHeightAt(x, z)
      if (surface !== null && y <= surface) {
        let lo = prevT
        let hi = t
        for (let i = 0; i < 14; i++) {
          const mid = (lo + hi) / 2
          const mx = origin.x + direction.x * mid
          const my = origin.y + direction.y * mid
          const mz = origin.z + direction.z * mid
          const ms = deps.annotationSurfaceHeightAt(mx, mz)
          if (ms !== null && my <= ms) hi = mid
          else lo = mid
        }
        const hitT = (lo + hi) / 2
        return { point: origin.clone().addScaledVector(direction, hitT), distance: hitT }
      }
      if (direction.y >= 0 && y > ceiling) break
      prevT = t
    }
    return null
  }

  function raycastAnnotationScenery(clientX: number, clientY: number, rect: DOMRect, groundHit: ReturnType<AnnotationSurfacePicker['raycastAnnotationGround']>) {
    const camera = deps.getCamera()
    const annotationSurfaceGrid = deps.mapWorld.annotationSurfaceGrid()
    if (!camera || !annotationSurfaceRaycaster || !annotationSurfaceGrid || !rect) return null
    if (!(rect.width > 0) || !(rect.height > 0)) return null
    const rc = annotationSurfaceRaycaster
    setRaycasterFromClient(clientX, clientY, rect, rc)
    const maxFar = Math.min(4000, Number.isFinite(camera.far) ? camera.far : 4000)
    const near = Number.isFinite(camera.near) ? Math.max(0.01, camera.near) : 0.01
    const far = groundHit ? Math.min(groundHit.distance, maxFar) : maxFar
    if (!(far > near)) return null
    rc.near = near
    rc.far = far
    const target = groundHit
      ? groundHit.point
      : rc.ray.at(far, new THREE.Vector3())
    const cells = occlusionCells(camera.position.x, camera.position.z, target.x, target.z)
    const cands = collectSurfaceCandidates(annotationSurfaceGrid as Map<string, THREE.Object3D[]>, cells)
    if (!cands || !cands.length) return null
    const hit = pickDrawableSurfaceHit(rc, cands, deps.annotationSurfaceHeightAt)
    if (!hit || !hit.point) return null
    const normal = hitWorldNormal(hit)
    return {
      point: hit.point as THREE.Vector3,
      distance: hit.distance,
      surfaceY: hit.point.y,
      surfaceN: normal ? { x: normal.x, y: normal.y, z: normal.z } : undefined,
    } as { point: THREE.Vector3; distance: number; surfaceY: number; surfaceN?: { x: number; y: number; z: number } } | null
  }

  function debugPickAnnotationSurface(clientX: number, clientY: number) {
    const camera = deps.getCamera()
    const rect = container.getBoundingClientRect()
    const groundHit = raycastAnnotationGround(clientX, clientY, rect)
    const diag = {
      groundHit: groundHit ? { distance: groundHit.distance, point: groundHit.point.toArray() } : null,
      gridCells: new Set<string>(),
      gridSize: deps.mapWorld.annotationSurfaceGrid() ? (deps.mapWorld.annotationSurfaceGrid() as Map<string, unknown>).size : 0,
      candidateCount: 0,
      rawHitCount: 0,
      hits: [] as unknown[],
      chosen: null as unknown,
      reason: null as string | null,
    }
    const rc = annotationSurfaceRaycaster
    const annotationSurfaceGrid = deps.mapWorld.annotationSurfaceGrid()
    if (!rc || !annotationSurfaceGrid || !(rect.width > 0) || !(rect.height > 0)) {
      diag.reason = 'no-grid'
      return diag
    }
    setRaycasterFromClient(clientX, clientY, rect, rc)
    const maxFar = Math.min(4000, Number.isFinite(camera.far) ? camera.far : 4000)
    const near = Number.isFinite(camera.near) ? Math.max(0.01, camera.near) : 0.01
    const far = groundHit ? Math.min(groundHit.distance, maxFar) : maxFar
    rc.near = near
    rc.far = far
    const target = groundHit ? groundHit.point : rc.ray.at(far, new THREE.Vector3())
    const cells = occlusionCells(camera.position.x, camera.position.z, target.x, target.z)
    diag.gridCells = cells
    const cands = collectSurfaceCandidates(annotationSurfaceGrid as Map<string, THREE.Object3D[]>, cells)
    if (!cands) {
      diag.reason = 'candidate-budget'
      return diag
    }
    diag.candidateCount = cands.length
    if (!cands.length) {
      diag.reason = 'not-in-grid'
      return diag
    }
    const raw = rc.intersectObjects(cands as THREE.Object3D[], false)
    diag.rawHitCount = raw.length
    const materialOf = (object: THREE.Mesh, faceIndex: number | undefined) => {
      const material = object && object.material
      if (Array.isArray(material)) return (material as unknown[])[faceIndex ?? 0] || null
      return material || null
    }
    for (const hit of raw.slice(0, 32)) {
      const hitObject = hit.object as THREE.Mesh & { isInstancedMesh?: boolean }
      const material = materialOf(hitObject, hit.face?.materialIndex) as { userData?: { annotationSurface?: unknown }; name?: string; type?: string } | null
      const normal = hitWorldNormal(hit)
      const terrainY = hit.point ? deps.annotationSurfaceHeightAt(hit.point.x, hit.point.z) : null
      const clearance = hit.point && terrainY != null && Number.isFinite(terrainY) ? hit.point.y - terrainY : null
      const normalY = normal ? normal.y : null
      let reason = 'drawable'
      if (!chainVisible(hit.object)) reason = 'invisible'
      else if (!hit.face) reason = 'no-face'
      else if (!hitObject.isMesh || !hitObject.geometry) reason = 'no-geometry'
      else if (material && material.userData && material.userData.annotationSurface === false) reason = 'annotationSurface=false'
      else if (clearance !== null && clearance < 0.5) reason = 'clearance<0.5'
      else if (normalY !== null && normalY < 0.4) reason = 'normal.y<0.4'
      diag.hits.push({
        object: hitObject.name || hitObject.type || null,
        material: material ? (material.name || material.type || null) : null,
        isInstancedMesh: !!hitObject.isInstancedMesh,
        instanceId: hit.instanceId != null ? hit.instanceId : null,
        point: hit.point ? hit.point.toArray() : null,
        distance: hit.distance,
        normalY,
        terrainY,
        clearance,
        annotationSurface: material?.userData?.annotationSurface,
        reason,
      })
      if (!diag.reason && reason !== 'drawable') diag.reason = reason
    }
    const chosen = pickDrawableSurfaceHit(rc, cands, deps.annotationSurfaceHeightAt)
    if (chosen) {
      const chosenPoint = chosen.point as THREE.Vector3
      const normal = hitWorldNormal(chosen)
      diag.chosen = {
        point: chosenPoint.toArray(),
        distance: chosen.distance,
        surfaceY: chosenPoint.y,
        surfaceN: normal ? { x: normal.x, y: normal.y, z: normal.z } : null,
      }
    } else if (!diag.reason) {
      diag.reason = 'no-drawable-hit'
    }
    return diag
  }

  function annotationSemanticWidth(sliderValue: number) {
    const image = deps.mapWorld.mapKey() ? mapImages[deps.mapWorld.mapKey() as keyof typeof mapImages] : null
    const bounds = image?.coordinateBounds
    const semanticSpan = bounds
      ? bounds.xMax - bounds.xMin
      : (Number(deps.mapWorld.mapMetaInfo()?.size_m) || Number(deps.mapWorld.heightMeta()?.span) || deps.mapWorld.terrainSpanOf())
    const logicalSpan = Number(image?.width) || semanticSpan
    return semanticWidthFromSlider(sliderValue, { semanticSpan, logicalSpan })
  }

  return {
    resetRaycaster() { annotationSurfaceRaycaster = new THREE.Raycaster() },
    semanticNormal,
    semanticFromScene,
    semanticPoint,
    sceneFromSemantic,
    setRaycasterFromClient,
    raycastAnnotationGround,
    raycastAnnotationScenery,
    debugPickAnnotationSurface,
    annotationSemanticWidth,
  }
}
