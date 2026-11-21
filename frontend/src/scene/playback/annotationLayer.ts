// 3D annotation GPU 资源层 owner（committed/draft ribbon 合批 mesh + 橡皮 ring + 派生投影
// 缓存）——自 annotationScene.ts 出仓（2026-11-21 #LOC 结构拆分：代码与搬移前逐字一致；
// 闭包读数改经 deps 注入）。committed annotation 的权威 owner 是 Replay3DPane；本模块只
// 保存最后一次 projection 引用作为 terrain rebuild 的派生缓存。draft/GPU 资源归本模块，
// 绝不回写 history。纯几何在 ./annotation3d.js。
import * as THREE from 'three'
import {
  ANNOTATION_LIFT, buildPenRibbon, reprojectRibbonPositions,
} from './annotation3d.js'
import type { SemanticPoint, PenAnnotation, PenRibbonResult } from './annotation3d.js'
import type { AnnotationInput } from './annotationScene.js'

/** ?debug 诊断钩子（window.__annotationLayer；宿主 JS 域裸写口径同 mapWorld.ts）。 */
const debugWindow = (typeof window !== 'undefined' ? window : {}) as Window & { __annotationLayer?: unknown }

/** 图层消费的宿主依赖（getter 快照；语义见 annotationScene.ts 的 deps 注释）。 */
export interface AnnotationLayerDeps {
  getScene(): import('three').Scene | null
  invalidate(): void
  debug: boolean
  /** 地表采样（世界事实 owner = mapWorld；经宿主 deps 注入）。 */
  annotationSurfaceHeightAt(x: number, z: number): number | null
  /** 共享 perf 统计（owner = annotationScene 的 handle.stats）。 */
  stats: {
    committedBuilds: number; draftBuilds: number; eraseCallbacks: number; terrainRebuilds: number
    lastBuildMs: number; lastPickMs: number; committedVertices: number; draftVertices: number
  }
  /** ?perf 域（与宿主同口径：探针期间才测 lastBuildMs）。 */
  perfEnabled(): boolean
  /** 会话清空时的手势复位（owner = gesture 状态机；晚绑定箭头；含指针表复位）。 */
  cancelGesture(): void
  /** ?debug 诊断探针内容（ensureAnnotationLayer 时装配；debug 关闭时不调用）。 */
  debugProbe: () => Record<string, unknown>
}

/** 图层句柄（宿主与 gesture 状态机的唯一消费面）。 */
export interface AnnotationLayerHandle {
  /** renderer 装配/重建后的 layer 挂载（幂等；未就绪返回 false）。 */
  ensure(): boolean
  rebuildCommitted(): void
  rebuildDraft(): void
  /** 白 ring + 半透明黑外圈：任意地表（尤其雪地/亮石面）都保留可见的半径 affordance。 */
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
  // 提交时算一次的 ribbon 拓扑：细分校验很贵，LOD 变化只刷新高度，不重算。
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

  // ---------- 3D annotation layer（scene-owned derived geometry）----------
  // annotation 的 x 是 replay X，进入 scene 时取负；回调时再转回 semantic。
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

  /**
   * 把 pane 的 semantic annotations 投影成当前 terrain 上的 merged geometry。
   * 颜色写进 per-vertex color：一个 material / 一个 draw call，不需要 per-stroke material。
   */
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
      // pane 的 SSOT 是 semantic (x=replay X, y=replay Z)；scene 系 x 取负后交给纯几何。
      // 防御异常/旧 state：缺 points 的 pen 不能让整个 annotation layer 抛错。
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

  /** semantic → scene（annotation 的 x 是 replay X，进入 scene 时取负）。 */
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
      // rebuildRenderer() replaces THREE.Scene without disposing the annotation layer
      // (materials/geometries are reusable). Reattach before returning; otherwise the
      // layer keeps rebuilding into a scene that is no longer rendered.
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

  /** 地表整体更换（首次就绪 / 2D 回退）：拓扑失效，全部重建。 */
  function rebuildAnnotationProjection() {
    if (!annotationGroup) return
    annotationStats.terrainRebuilds++
    annotationRibbons = new WeakMap()
    rebuildCommittedAnnotations()
    rebuildDraftAnnotation()
  }

  /** 地形 LOD 变化：XZ 来自 semantic points，只在原 geometry 上刷新 Y。 */
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
