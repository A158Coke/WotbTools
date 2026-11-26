import * as THREE from 'three'
import {
  ANNOTATION_LIFT, buildPenRibbon, reprojectRibbonPositions,
} from './annotation3d.js'
import type { SemanticPoint, PenAnnotation, PenRibbonResult } from './annotation3d.js'
import type { AnnotationInput } from './annotationScene.js'

const debugWindow = (typeof window !== 'undefined' ? window : {}) as Window & { __annotationLayer?: unknown }

export interface AnnotationLayerDeps {
  getScene(): import('three').Scene | null
  invalidate(): void
  debug: boolean
  annotationSurfaceHeightAt(x: number, z: number): number | null
  stats: {
    committedBuilds: number; draftBuilds: number; eraseCallbacks: number; terrainRebuilds: number
    lastBuildMs: number; lastPickMs: number; committedVertices: number; draftVertices: number
  }
  perfEnabled(): boolean
  cancelGesture(): void
  resetPointerState(): void
  debugProbe: () => Record<string, unknown>
}

export interface AnnotationLayerHandle {
  ensure(): boolean
  rebuildCommitted(): void
  rebuildDraft(): void
  setRingPositions(positions: Float32Array | null, outlinePositions?: Float32Array | null): void
  hasRing(): boolean
  setDraft(draft: PenAnnotation | null): void
  rebuildAnnotationProjection(): void
  reprojectAnnotationHeights(): void
  clearSessionProjection(): void
  dispose(): void
  setAnnotations(annotations: unknown): void
  setAnnotationsVisible(visible: boolean): void
  visible(): boolean
  annotationRoot(): THREE.Group | null
}

export function createAnnotationLayer(deps: AnnotationLayerDeps): AnnotationLayerHandle {
  let projectedAnnotations: AnnotationInput[] = []
  let annotationRibbons = new WeakMap<object, PenRibbonResult | null>()
  let annotationsVisible = true
  let annotationGroup: THREE.Group | null = null
  let annotationCommittedMesh: THREE.Mesh | null = null
  let annotationDraftMesh: THREE.Mesh | null = null
  let annotationRing: THREE.LineLoop | null = null
  let annotationRingOutline: THREE.LineLoop | null = null
  let annotationDraft: PenAnnotation | null = null
  let annotationMaterial: THREE.MeshBasicMaterial | null = null
  let annotationRingMaterial: THREE.LineBasicMaterial | null = null
  let annotationRingOutlineMaterial: THREE.LineBasicMaterial | null = null
  const annotationStats = deps.stats

  function emptyAnnotationGeometry() {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3))
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1))
    return geometry
  }

  function replaceAnnotationGeometry(mesh: THREE.Mesh | null, geometry: THREE.BufferGeometry) {
    if (!mesh) return
    const old = mesh.geometry
    mesh.geometry = geometry
    const position = geometry.getAttribute('position')
    mesh.visible = !!position && position.count > 0
    if (old && old !== geometry) old.dispose()
  }

  function ribbonFor(ann: AnnotationInput, sceneAnn: PenAnnotation, refine: boolean) {
    if (refine && annotationRibbons.has(ann)) return annotationRibbons.get(ann)
    const ribbon = buildPenRibbon(sceneAnn, {
      sampleHeight: deps.annotationSurfaceHeightAt,
      lift: ANNOTATION_LIFT,
      refine,
    })
    if (refine) annotationRibbons.set(ann, ribbon)
    return ribbon
  }

  function buildMergedAnnotationGeometry(annotations: AnnotationInput[], { refine = true } = {}) {
    const positions: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    const anchored: number[] = []
    const color = new THREE.Color()
    let vertexOffset = 0
    const list = Array.isArray(annotations) ? annotations : []
    for (const ann of list) {
      if (!ann || ann.type !== 'pen') continue
      const points = Array.isArray(ann.points)
        ? ann.points.filter((point) => point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))
        : []
      const sceneAnn = { ...ann, points: points.map((point) => sceneFromSemantic(point)) } as PenAnnotation
      const ribbon = ribbonFor(ann, sceneAnn, refine)
      if (!ribbon) continue
      const hex = typeof ann.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(ann.color) ? ann.color : '#ffffff'
      color.set(hex)
      for (const strip of ribbon.strips) {
        const count = strip.positions.length / 3
        for (let i = 0; i < count; i++) {
          positions.push(strip.positions[i * 3], strip.positions[i * 3 + 1], strip.positions[i * 3 + 2])
          colors.push(color.r, color.g, color.b)
        }
        for (let row = 0; row < strip.rowCount; row++) {
          const flag = strip.anchored && strip.anchored[row] ? 1 : 0
          for (let col = 0; col < strip.crossCount; col++) anchored.push(flag)
        }
        for (let i = 0; i < strip.indices.length; i++) indices.push(strip.indices[i] + vertexOffset)
        vertexOffset += count
      }
    }
    if (!positions.length) return { geometry: emptyAnnotationGeometry(), vertices: 0 }
    const geometry = new THREE.BufferGeometry()
    const anchoredMask = new Uint8Array(anchored)
    geometry.userData.annotationAnchored = anchoredMask
    const merged = reprojectRibbonPositions(new Float32Array(positions), deps.annotationSurfaceHeightAt, ANNOTATION_LIFT, anchoredMask)
    geometry.setAttribute('position', new THREE.BufferAttribute(merged, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3))
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1))
    geometry.computeBoundingSphere()
    return { geometry, vertices: positions.length / 3 }
  }

  function sceneFromSemantic(point: SemanticPoint) {
    const out: SemanticPoint & { surfaceN?: { x: number; y: number; z: number } } = { x: -point.x, y: point.y }
    if (Number.isFinite(point.surfaceY)) out.surfaceY = point.surfaceY
    const normal = point.surfaceN
    if (normal) out.surfaceN = normal
    return out
  }

  function ensureAnnotationLayer() {
    const scene = deps.getScene()
    if (!scene) return false
    if (annotationGroup) {
      if (annotationGroup.parent !== scene) {
        annotationGroup.parent?.remove(annotationGroup)
        scene.add(annotationGroup)
      }
      return true
    }
    annotationGroup = new THREE.Group()
    annotationGroup.name = 'playback-annotations'
    annotationGroup.visible = annotationsVisible
    annotationMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
    annotationCommittedMesh = new THREE.Mesh(emptyAnnotationGeometry(), annotationMaterial)
    annotationCommittedMesh.name = 'annotation-committed'
    annotationCommittedMesh.renderOrder = 2
    annotationCommittedMesh.frustumCulled = false
    annotationDraftMesh = new THREE.Mesh(emptyAnnotationGeometry(), annotationMaterial)
    annotationDraftMesh.name = 'annotation-draft'
    annotationDraftMesh.renderOrder = 2
    annotationDraftMesh.frustumCulled = false
    annotationRingMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false,
    })
    annotationRing = new THREE.LineLoop(emptyAnnotationGeometry(), annotationRingMaterial)
    annotationRing.name = 'annotation-eraser-ring'
    annotationRing.renderOrder = 12
    annotationRing.frustumCulled = false
    annotationRing.visible = false
    annotationRingOutlineMaterial = new THREE.LineBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.35, depthTest: false, toneMapped: false,
    })
    annotationRingOutline = new THREE.LineLoop(emptyAnnotationGeometry(), annotationRingOutlineMaterial)
    annotationRingOutline.name = 'annotation-eraser-ring-outline'
    annotationRingOutline.renderOrder = 11
    annotationRingOutline.frustumCulled = false
    annotationRingOutline.visible = false
    annotationGroup.add(annotationCommittedMesh, annotationDraftMesh, annotationRing, annotationRingOutline)
    scene.add(annotationGroup)
    if (deps.debug) {
      debugWindow.__annotationLayer = {
        group: annotationGroup,
        committedMesh: annotationCommittedMesh,
        draftMesh: annotationDraftMesh,
        ring: annotationRing,
        ringOutline: annotationRingOutline,
        stats: annotationStats,
        sampler: deps.annotationSurfaceHeightAt,
        ...deps.debugProbe(),
      }
    }
    rebuildCommittedAnnotations()
    rebuildDraftAnnotation()
    return true
  }

  function rebuildCommittedAnnotations() {
    if (!annotationCommittedMesh) return
    const PERF = deps.perfEnabled()
    const t0 = PERF ? performance.now() : 0
    const result = buildMergedAnnotationGeometry(projectedAnnotations)
    replaceAnnotationGeometry(annotationCommittedMesh, result.geometry)
    annotationStats.committedBuilds++
    annotationStats.committedVertices = result.vertices
    if (PERF) annotationStats.lastBuildMs = performance.now() - t0
    if (annotationGroup) annotationGroup.visible = annotationsVisible
    deps.invalidate()
  }

  function rebuildDraftAnnotation() {
    if (!annotationDraftMesh) return
    if (!annotationDraft || !Array.isArray(annotationDraft.points) || annotationDraft.points.length < 2) {
      replaceAnnotationGeometry(annotationDraftMesh, emptyAnnotationGeometry())
      annotationStats.draftVertices = 0
      return
    }
    const result = buildMergedAnnotationGeometry([annotationDraft as AnnotationInput], { refine: false })
    replaceAnnotationGeometry(annotationDraftMesh, result.geometry)
    annotationStats.draftBuilds++
    annotationStats.draftVertices = result.vertices
    if (annotationGroup) annotationGroup.visible = annotationsVisible
    deps.invalidate()
  }

  function applyRingGeometry(mesh: THREE.LineLoop | null, positions: Float32Array | null) {
    if (!mesh) return
    const old = mesh.geometry
    if (!positions || positions.length < 9) {
      mesh.visible = false
      mesh.geometry = new THREE.BufferGeometry()
      if (old) old.dispose()
      return
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    mesh.geometry = geometry
    mesh.visible = annotationsVisible
    if (old) old.dispose()
  }

  function rebuildAnnotationProjection() {
    if (!annotationGroup) return
    annotationStats.terrainRebuilds++
    annotationRibbons = new WeakMap()
    rebuildCommittedAnnotations()
    rebuildDraftAnnotation()
  }

  function reprojectAnnotationHeights() {
    if (!annotationGroup) return
    annotationStats.terrainRebuilds++
    for (const mesh of [annotationCommittedMesh, annotationDraftMesh]) {
      const position = mesh?.geometry.getAttribute('position')
      if (!position?.count) continue
      reprojectRibbonPositions(
        position.array as Float32Array, deps.annotationSurfaceHeightAt, ANNOTATION_LIFT,
        (mesh!.geometry.userData.annotationAnchored as Uint8Array | undefined) || null,
      )
      position.needsUpdate = true
    }
    deps.invalidate()
  }

  function clearAnnotationProjection() {
    deps.cancelGesture()
    deps.resetPointerState()
    projectedAnnotations = []
    annotationDraft = null
    if (annotationCommittedMesh) replaceAnnotationGeometry(annotationCommittedMesh, emptyAnnotationGeometry())
    if (annotationDraftMesh) replaceAnnotationGeometry(annotationDraftMesh, emptyAnnotationGeometry())
    if (annotationRing) { applyRingGeometry(annotationRing, null); applyRingGeometry(annotationRingOutline, null); }
    deps.invalidate()
    annotationStats.committedVertices = 0
    annotationStats.draftVertices = 0
    annotationStats.committedBuilds = 0
    annotationStats.draftBuilds = 0
    annotationStats.terrainRebuilds = 0
    annotationStats.eraseCallbacks = 0
    annotationStats.lastBuildMs = 0
    annotationStats.lastPickMs = 0
  }

  function disposeAnnotationLayer() {
    if (!annotationGroup) return
    annotationGroup.traverse((object) => {
      const geometry = (object as THREE.Mesh).geometry
      if (geometry) geometry.dispose()
    })
    annotationGroup.parent?.remove(annotationGroup)
    annotationMaterial?.dispose()
    annotationRingMaterial?.dispose()
    annotationRingOutlineMaterial?.dispose()
    annotationGroup = null
    annotationCommittedMesh = null
    annotationDraftMesh = null
    annotationRing = null
    annotationRingOutline = null
    annotationDraft = null
    annotationMaterial = null
    annotationRingMaterial = null
    annotationRingOutlineMaterial = null
    projectedAnnotations = []
    if (deps.debug) delete debugWindow.__annotationLayer
  }

  return {
    ensure: ensureAnnotationLayer,
    rebuildCommitted: rebuildCommittedAnnotations,
    rebuildDraft: rebuildDraftAnnotation,
    setRingPositions(positions, outlinePositions = null) {
      if (!annotationRing) return
      applyRingGeometry(annotationRing, positions)
      applyRingGeometry(annotationRingOutline, outlinePositions)
      deps.invalidate()
    },
    hasRing: () => !!annotationRing,
    setDraft(draft) { annotationDraft = draft },
    rebuildAnnotationProjection,
    reprojectAnnotationHeights,
    clearSessionProjection: clearAnnotationProjection,
    dispose: disposeAnnotationLayer,
    setAnnotations(annotations: unknown) {
      const next = Array.isArray(annotations) ? (annotations as AnnotationInput[]) : []
      if (next === projectedAnnotations) return
      projectedAnnotations = next
      if (ensureAnnotationLayer()) rebuildCommittedAnnotations()
      deps.invalidate()
    },
    setAnnotationsVisible(visible: boolean) {
      annotationsVisible = visible !== false
      if (!annotationsVisible) deps.cancelGesture()
      if (annotationGroup) annotationGroup.visible = annotationsVisible
      deps.invalidate()
    },
    visible: () => annotationsVisible,
    annotationRoot: () => annotationGroup,
  }
}
