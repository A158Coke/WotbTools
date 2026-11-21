// 3D annotation 场景层 owner（#820 结构拆分，2026-11-06 自 initPlayback 闭包出仓；
// 2026-11-21 #LOC 结构拆分为宿主接线 façade + 三个 owner 模块，代码与拆分前逐字一致）：
// - GPU 图层（committed/draft mesh + 橡皮 ring + 派生投影缓存）→ ./annotationLayer.ts；
// - 地表拾取（独立 raycaster + semantic 坐标换算 + 诊断拾取）→ ./annotationSurfacePicker.ts；
// - pointer 手势状态机（begin/append/finish/cancel + 监听收口）→ ./annotationGesture.ts。
// 闭包读数改经 deps 注入（getter 快照）：相机/共享 raycaster/OrbitControls 来自宿主渲染器
// 核心，地表采样与候选格 owner = mapWorld（经 handle 消费）。committed annotation 的权威
// owner 是 Replay3DPane；本模块只保存最后一次 projection 引用作为 terrain rebuild 的派生
// 缓存。draft/GPU 资源归 annotationLayer，绝不回写 history。
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
  /** CSS px 视觉宽度（工具条滑条值；换算 owner = surfacePicker.annotationSemanticWidth）。 */
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
  setAnnotationInteraction(config: AnnotationInteractionConfig): void
  annotationRoot(): THREE.Group | null
  setAnnotationsVisible(visible: boolean): void
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

  // 地表拾取 owner（独立 raycaster 生命周期 = attachListeners 每次渲染器装配重建）。
  const picker: AnnotationSurfacePicker = createAnnotationSurfacePicker({
    container,
    getCamera: () => deps.getCamera(),
    getRaycaster: () => deps.getRaycaster(),
    getControls: () => deps.getControls() as never,
    mapWorld: deps.mapWorld,
    annotationSurfaceHeightAt: (x, z) => deps.annotationSurfaceHeightAt(x, z),
  })

  // GPU 图层 owner（committed/draft/ring + 派生投影缓存 + 会话清空/释放）。
  const layer: AnnotationLayerHandle = createAnnotationLayer({
    getScene: () => deps.getScene(),
    invalidate: () => deps.invalidate(),
    debug: deps.debug,
    perfEnabled: () => deps.perfEnabled(),
    annotationSurfaceHeightAt: (x, z) => deps.annotationSurfaceHeightAt(x, z),
    stats: annotationStats,
    cancelGesture: () => { gesture.cancelAnnotationGesture(); gesture.resetPointerState(); },
    debugProbe: () => ({
      pick: (x: number, y: number) => pickAnnotationSurface(x, y),
      pickDebug: (x: number, y: number) => picker.debugPickAnnotationSurface(x, y),
      setSurfaceGrid: (grid: unknown) => deps.mapWorld.setAnnotationSurfaceGrid(grid),
      gesture: () => gesture.gesture(),
      rebuild: () => { layer.rebuildAnnotationProjection(); return annotationStats.terrainRebuilds },
      reproject: () => { layer.reprojectAnnotationHeights(); return annotationStats.terrainRebuilds },
    }),
  })

  // pointer 手势状态机 owner（指针表/抑制标志/touch 模式）。
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

  /**
   * client px -> semantic surface point. terrain 走既有 raycast；scenery 表面只在更近时胜出。
   * Width/radius 不使用 camera scale。
   */
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
    /** 3D 标注根（反射 pass 剔除；尚未建立为 null） */
    annotationRoot: () => layer.annotationRoot(),
    setAnnotationsVisible: (visible) => layer.setAnnotationsVisible(visible),
    stats: () => annotationStats,
  };
}
