import * as THREE from 'three'
import type { AnnotationHitLike } from './annotationSurface.ts'
import { chooseAnnotationHit } from './annotationSurface.ts'
import { createAnnotationLayer } from './annotationLayer.ts'
import type { AnnotationLayerHandle } from './annotationLayer.ts'
import { createAnnotationSurfacePicker } from './annotationSurfacePicker.ts'
import type { AnnotationSurfacePicker } from './annotationSurfacePicker.ts'
import { createAnnotationGesture } from './annotationGesture.ts'
import type { AnnotationGestureHandle } from './annotationGesture.ts'
import type { AnnotationGestureDeps } from './annotationGesture.ts'

export interface AnnotationInput {
  type?: unknown
  color?: unknown
  points?: unknown
}

export interface AnnotationInteractionConfig {
  enabled?: boolean
  tool?: 'pen' | 'eraser' | null
  color?: string
  width?: number
  eraserWidth?: number
}

export interface AnnotationControls {
  touches?: { ONE: string | null } | null
  target: { x: number; y: number; z: number }
}

export interface AnnotationSceneDeps {
  container: HTMLElement
  debug: boolean
  perfEnabled(): boolean
  invalidate(): void
  getScene(): THREE.Scene | null
  getCamera(): THREE.PerspectiveCamera
  getRaycaster(): THREE.Raycaster
  getControls(): AnnotationControls | null
  mapWorld: {
    annotationSurfaceGrid(): unknown
    setAnnotationSurfaceGrid(grid: unknown): void
    heightMeta(): { zmax?: unknown; span?: unknown } | null | undefined
    mapKey(): string | null | undefined
    mapMetaInfo(): { size_m?: unknown } | null | undefined
    terrainSpanOf(): number
  }
  annotationSurfaceHeightAt(x: number, z: number): number | null
  onAnnotationCommit?: ((payload: unknown) => void) | null
  onAnnotationErase?: ((payload: unknown) => void) | null
}

export interface AnnotationSceneHandle {
  attachListeners(): void
  detach(): void
  annotationToolActive(): boolean
  hasGesture: () => boolean
  cancelAnnotationGesture(): void
  rebuildAnnotationProjection(): void
  reprojectAnnotationHeights(): void
  clearSessionProjection(): void
  dispose(): void
  restoreTouches(): void
  setRaycasterFromClient(clientX: number, clientY: number, rect: DOMRect, rc?: THREE.Raycaster): void
  raycastAnnotationGround(clientX: number, clientY: number, rect: DOMRect): { point: THREE.Vector3; distance: number } | null
  setAnnotations(annotations: unknown): void
  annotationRoot(): THREE.Group | null
  setAnnotationsVisible(visible: boolean): void
  setAnnotationInteraction(config?: AnnotationInteractionConfig): void
  stats(): unknown
}

interface AnnotationStats {
  committedBuilds: number
  draftBuilds: number
  eraseCallbacks: number
  terrainRebuilds: number
  lastBuildMs: number
  lastPickMs: number
  committedVertices: number
  draftVertices: number
}

export function createAnnotationScene(deps: AnnotationSceneDeps): AnnotationSceneHandle {
  const { container } = deps
  const annotationStats: AnnotationStats = {
    committedBuilds: 0, draftBuilds: 0, eraseCallbacks: 0, terrainRebuilds: 0,
    lastBuildMs: 0, lastPickMs: 0, committedVertices: 0, draftVertices: 0,
  }
  let annotationInteraction: Required<AnnotationInteractionConfig> & { tool: 'pen' | 'eraser' | null } = {
    enabled: false, tool: null, color: '#ff4d4f', width: 3, eraserWidth: 16,
  }

  const picker: AnnotationSurfacePicker = createAnnotationSurfacePicker({
    container,
    getCamera: () => deps.getCamera(),
    getRaycaster: () => deps.getRaycaster(),
    getControls: () => deps.getControls() as never,
    mapWorld: deps.mapWorld,
    annotationSurfaceHeightAt: (x, z) => deps.annotationSurfaceHeightAt(x, z),
  })

  const layer: AnnotationLayerHandle = createAnnotationLayer({
    getScene: () => deps.getScene(),
    invalidate: () => deps.invalidate(),
    debug: deps.debug,
    perfEnabled: () => deps.perfEnabled(),
    annotationSurfaceHeightAt: (x, z) => deps.annotationSurfaceHeightAt(x, z),
    stats: annotationStats,
    cancelGesture: () => gesture.cancelAnnotationGesture(),
    resetPointerState: () => gesture.resetPointerState(),
    debugProbe: () => ({
      pick: (x: number, y: number) => pickAnnotationSurface(x, y),
      pickDebug: (x: number, y: number) => picker.debugPickAnnotationSurface(x, y),
      setSurfaceGrid: (grid: unknown) => deps.mapWorld.setAnnotationSurfaceGrid(grid),
      gesture: () => gesture.gesture(),
      rebuild: () => { layer.rebuildAnnotationProjection(); return annotationStats.terrainRebuilds },
      reproject: () => { layer.reprojectAnnotationHeights(); return annotationStats.terrainRebuilds },
    }),
  })

  const gesture: AnnotationGestureHandle = createAnnotationGesture({
    container,
    invalidate: () => deps.invalidate(),
    interaction: () => annotationInteraction,
    toolActive: () => annotationToolActive(),
    pick: (clientX, clientY) => pickAnnotationSurface(clientX, clientY),
    visible: () => layer.visible(),
    getControls: () => deps.getControls() as never,
    annotationSurfaceHeightAt: (x, z) => deps.annotationSurfaceHeightAt(x, z),
    layer,
    picker,
    stats: annotationStats,
    onAnnotationCommit: deps.onAnnotationCommit as AnnotationGestureDeps['onAnnotationCommit'],
    onAnnotationErase: deps.onAnnotationErase as AnnotationGestureDeps['onAnnotationErase'],
  })

  function annotationToolActive() {
    return annotationInteraction.enabled && !!annotationInteraction.tool
  }

  function pickAnnotationSurface(clientX: number, clientY: number) {
    if (!annotationToolActive() || !layer.visible()) return null
    const PERF = deps.perfEnabled()
    const startedAt = PERF ? performance.now() : 0
    const rect = container.getBoundingClientRect()
    const groundHit = picker.raycastAnnotationGround(clientX, clientY, rect)
    const surfaceHit = picker.raycastAnnotationScenery(clientX, clientY, rect, groundHit)
    const surfaceHitView = surfaceHit as (AnnotationHitLike & { surfaceN?: { x: number; y: number; z: number } }) | null
    const hit = chooseAnnotationHit(groundHit, surfaceHit)
    if (!hit || !hit.point) return null
    if (PERF) annotationStats.lastPickMs = performance.now() - startedAt
    const fromSurface = hit === surfaceHit
    return {
      semantic: picker.semanticFromScene(
        hit.point.x, hit.point.z,
        fromSurface ? hit.point.y : undefined,
        fromSurface ? surfaceHitView?.surfaceN : undefined,
      ),
    }
  }

  return {
    attachListeners() {
      picker.resetRaycaster()
      gesture.attachListeners()
    },
    detach: () => gesture.detach(),
    annotationToolActive,
    hasGesture: () => gesture.hasGesture(),
    cancelAnnotationGesture: () => gesture.cancelAnnotationGesture(),
    rebuildAnnotationProjection: () => layer.rebuildAnnotationProjection(),
    reprojectAnnotationHeights: () => layer.reprojectAnnotationHeights(),
    clearSessionProjection: () => layer.clearSessionProjection(),
    dispose: () => layer.dispose(),
    restoreTouches: () => gesture.restoreTouches(),
    setRaycasterFromClient: (clientX, clientY, rect, rc) => picker.setRaycasterFromClient(clientX, clientY, rect, rc),
    raycastAnnotationGround: (clientX, clientY, rect) => picker.raycastAnnotationGround(clientX, clientY, rect),
    setAnnotations: (annotations) => layer.setAnnotations(annotations),
    setAnnotationInteraction(config: AnnotationInteractionConfig = {}) {
      const tool = config.enabled === true && config.tool === 'pen' ? 'pen' as const
        : config.enabled === true && config.tool === 'eraser' ? 'eraser' as const : null
      const next = {
        enabled: config.enabled === true,
        tool,
        color: typeof config.color === 'string' ? config.color : annotationInteraction.color,
        width: Number.isFinite(config.width) ? config.width as number : annotationInteraction.width,
        eraserWidth: Number.isFinite(config.eraserWidth) ? config.eraserWidth as number : annotationInteraction.eraserWidth,
      }
      const changed = next.enabled !== annotationInteraction.enabled || next.tool !== annotationInteraction.tool
      annotationInteraction = next
      if (changed) gesture.cancelAnnotationGesture()
      gesture.applyAnnotationTouchMode()
      deps.invalidate()
    },
    annotationRoot: () => layer.annotationRoot(),
    setAnnotationsVisible: (visible) => layer.setAnnotationsVisible(visible),
    stats: () => annotationStats,
  };
}
