// 3D annotation 场景层 owner（#820 结构拆分，2026-11-06 自 initPlayback 闭包出仓）：
// committed/draft 的 GPU 资源与 rebuild 编排（emptyAnnotationGeometry /
// replaceAnnotationGeometry / ribbonFor / buildMergedAnnotationGeometry /
// ensureAnnotationLayer / rebuildCommittedAnnotations / rebuildDraftAnnotation /
// applyRingGeometry / setAnnotationRingPositions / rebuildAnnotationProjection /
// reprojectAnnotationHeights / clearAnnotationProjection / disposeAnnotationLayer）、
// 地表拾取（setRaycasterFromClient / raycastAnnotationGround / raycastAnnotationScenery /
// debugPickAnnotationSurface / pickAnnotationSurface / annotationSemanticWidth）与
// pointer 手势状态机（begin/append/finish/cancel + onAnnotationPointerDown/Move/Up/
// onAnnotationCaptureLost）的唯一归属。
// 代码与搬移前逐字一致；闭包读数改经 deps 注入（getter 快照）：相机/共享 raycaster/
// OrbitControls 来自宿主渲染器核心，地表采样与候选格 owner = mapWorld（经 handle 消费）。
// 事件监听注册/摘除收口为 attachListeners()/detach()（initScene 的 annotation 段与
// destroy 的摘除段逐字对应；重复 attach 由 addEventListener 同引用去重保证幂等）。
// 纯几何在 ./annotation3d.js；surface 候选/判定在 ./annotationSurface.ts。
// committed annotation 的权威 owner 是 Replay3DPane；本模块只保存最后一次 projection
// 引用作为 terrain rebuild 的派生缓存。draft/GPU 资源归本模块，绝不回写 history。
import * as THREE from 'three'
import type { PerspectiveCamera } from 'three'
import { mapImages } from '../../data/mapImages.js'
import { semanticWidthFromSlider } from '../../utils/annotation.js'
import { occlusionCells } from './pure.js'
import { chainVisible } from '../pickDebug.js'
import {
  ANNOTATION_LIFT, ANNOTATION_MAX_ERASER_POINTS, ANNOTATION_MAX_INPUT_POINTS,
  buildEraserRing, buildPenRibbon, hitWorldNormal, normalizePenPoints, reprojectRibbonPositions,
} from './annotation3d.js'
import type { SemanticPoint, PenAnnotation, PenRibbonResult } from './annotation3d.js'
import {
  chooseAnnotationHit, collectSurfaceCandidates, pickDrawableSurfaceHit,
} from './annotationSurface.ts'
import type { AnnotationHitLike } from './annotationSurface.ts'

/** ?debug 诊断钩子（window.__annotationLayer；宿主 JS 域裸写口径同 mapWorld.ts）。 */
const debugWindow = (typeof window !== 'undefined' ? window : {}) as Window & { __annotationLayer?: unknown };

/** pane 推送的 committed annotation 输入面（结构防御在 buildMergedAnnotationGeometry）。 */
export interface AnnotationInput {
  type?: unknown
  color?: unknown
  points?: Array<SemanticPoint & Record<string, unknown>>
  [key: string]: unknown
}

/** drawing tool 配置（pane 是唯一 owner；宿主 setAnnotationInteraction 委托入）。 */
export interface AnnotationInteractionConfig {
  enabled?: boolean
  tool?: string | null
  color?: string
  width?: number
  eraserWidth?: number
}

/** 本模块消费的 OrbitControls 结构面（touches.ONE 置 null = 交出单指手势）。 */
interface AnnotationControls {
  target: THREE.Vector3
  touches: { ONE: string | null }
}

/** 宿主注入的依赖（getter 快照；语义见各字段处原文注释）。 */
export interface AnnotationSceneDeps {
  container: HTMLElement
  /** 场景根（layer 装配/重挂；owner = 宿主渲染器核心，initScene 后非空）。 */
  getScene(): THREE.Scene | null
  /** ?debug 诊断（window.__annotationLayer 挂钩）。 */
  debug: boolean
  /** ?perf 性能探针开关（原 PERF：重建/拾取的耗时统计门控）。 */
  perfEnabled(): boolean
  invalidate(): void
  getCamera(): PerspectiveCamera
  /** 共享 raycaster（宿主渲染器核心 owner；fly/selection 同一实例）。 */
  getRaycaster(): THREE.Raycaster
  /** OrbitControls（applyAnnotationTouchMode 的 touches.ONE 交还）。 */
  getControls(): AnnotationControls | null
  /** 世界事实（owner = mapWorld；地表采样/候选格/地图跨度）。 */
  mapWorld: {
    heightMeta(): { zmax?: unknown; span?: unknown } | null
    annotationSurfaceGrid(): unknown
    setAnnotationSurfaceGrid(grid: unknown): void
    mapKey(): string | null
    mapMetaInfo(): { size_m?: unknown } | null
    terrainSpanOf(): number
  }
  /** annotation 地表采样 = 世界事实的唯一采样口径（mapWorld owner；消费别名）。 */
  annotationSurfaceHeightAt(x: number, z: number): number | null
  /** pane 的提交回调（gesture 完成时透传，本模块不落 history）。 */
  onAnnotationCommit?(annotation: unknown): void
  onAnnotationErase?(erase: unknown): void
}

/** annotation 场景层对外句柄（宿主的唯一消费面）。 */
export interface AnnotationSceneHandle {
  /** initScene 的 annotation 段（注册 capture 监听 + 独立 raycaster + layer 就绪 + 触摸模式）。 */
  attachListeners(): void
  /** destroy 的摘除段（5 个 capture 监听；宿主容器复用前必须 detach）。 */
  detach(): void
  /** drawing tool 是否启用（fly/selection 路径的让位判定）。 */
  annotationToolActive(): boolean
  /** 当前是否有进行中的手势（相机模式跳变不得继续旧 draft）。 */
  hasGesture(): boolean
  cancelAnnotationGesture(): void
  /** 地形 rebuild 的派生缓存重建（mapWorld owner 调用；原 rebuildAnnotationProjection）。 */
  rebuildAnnotationProjection(): void
  /** 地形 LOD 变化的高度刷新（mapWorld owner 调用；原 reprojectAnnotationHeights）。 */
  reprojectAnnotationHeights(): void
  /** 旧会话的 annotation 派生几何清理（teardownSession；原 clearAnnotationProjection）。 */
  clearSessionProjection(): void
  /** annotation 材质/geometry/group 随实例释放（destroy；原 disposeAnnotationLayer）。 */
  dispose(): void
  /** destroy 时把 touches.ONE 交还 OrbitControls（原 destroy 的 touches 恢复段）。 */
  restoreTouches(): void
  /** fly 路径消费：client px → 共享 raycaster（原 setRaycasterFromClient）。 */
  setRaycasterFromClient(clientX: number, clientY: number, rect: DOMRect, rc?: THREE.Raycaster): void
  /** fly 单指平移的地形取面（原 raycastAnnotationGround）。 */
  raycastAnnotationGround(clientX: number, clientY: number, rect: DOMRect): { point: THREE.Vector3; distance: number } | null
  /** 宿主公开 API 的委托目标（语义见宿主端 doc 注释）。 */
  setAnnotations(annotations: unknown): void
  setAnnotationInteraction(config?: AnnotationInteractionConfig): void
  setAnnotationsVisible(visible: boolean): void
  /** ?perf 报告的 annotation 统计面（原 annotationStats 引用）。 */
  stats(): AnnotationStats
}

interface AnnotationStats {
  committedBuilds: number; draftBuilds: number; eraseCallbacks: number; terrainRebuilds: number;
  lastBuildMs: number; lastPickMs: number; committedVertices: number; draftVertices: number;
}

export function createAnnotationScene(deps: AnnotationSceneDeps): AnnotationSceneHandle {
  const { container } = deps
  let projectedAnnotations: AnnotationInput[] = []
  // 提交时算一次的 ribbon 拓扑：细分校验很贵，LOD 变化只刷新高度，不重算。
  let annotationRibbons = new WeakMap<object, PenRibbonResult | null>()
  // 3D annotation 的 scenery 候选格（装配期构建）owner = mapWorld；经 getter 消费。
  // 独立 raycaster：不给共享 raycaster 留 near/far 副作用（fly/selection 仍用共享实例）。
  let annotationSurfaceRaycaster: THREE.Raycaster | null = null
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
  const annotationStats: AnnotationStats = {
    committedBuilds: 0, draftBuilds: 0, eraseCallbacks: 0, terrainRebuilds: 0,
    lastBuildMs: 0, lastPickMs: 0, committedVertices: 0, draftVertices: 0,
  }
  let annotationInteraction: Required<AnnotationInteractionConfig> & { tool: 'pen' | 'eraser' | null } = {
    enabled: false, tool: null, color: '#ff4d4f', width: 3, eraserWidth: 16,
  }
  const annotationPointers = new Map<number, string>()
  interface AnnotationGesture {
    pointerId: number
    pointerType: string
    tool: 'pen' | 'eraser'
    color: string
    width: number
    radius: number
    points: SemanticPoint[]
    lastScreen: { x: number; y: number }
    frozen: boolean
    hadGroundMiss: boolean
    capture: boolean
  }
  let annotationGesture: AnnotationGesture | null = null
  let annotationSuppressUntilAllUp = false
  let annotationOriginalTouchesOne: string | null = null

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
        pick: (x: number, y: number) => pickAnnotationSurface(x, y),
        pickDebug: (x: number, y: number) => debugPickAnnotationSurface(x, y),
        setSurfaceGrid: (grid: unknown) => deps.mapWorld.setAnnotationSurfaceGrid(grid),
        gesture: () => annotationGesture,
        rebuild: () => { rebuildAnnotationProjection(); return annotationStats.terrainRebuilds },
        reproject: () => { reprojectAnnotationHeights(); return annotationStats.terrainRebuilds },
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

  /** 白 ring + 半透明黑外圈：任意地表（尤其雪地/亮石面）都保留可见的半径 affordance。 */
  function setAnnotationRingPositions(positions: Float32Array | null, outlinePositions: Float32Array | null = null) {
    if (!annotationRing) return
    applyRingGeometry(annotationRing, positions)
    applyRingGeometry(annotationRingOutline, outlinePositions)
    deps.invalidate()
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
    cancelAnnotationGesture()
    annotationPointers.clear()
    annotationSuppressUntilAllUp = false
    projectedAnnotations = []
    annotationDraft = null
    if (annotationCommittedMesh) replaceAnnotationGeometry(annotationCommittedMesh, emptyAnnotationGeometry())
    if (annotationDraftMesh) replaceAnnotationGeometry(annotationDraftMesh, emptyAnnotationGeometry())
    setAnnotationRingPositions(null)
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

  // ---------- annotation pointer ownership（desktop + touch）----------
  // 单指/单指针 drawing 的 owner 是本模块；pane 不镜像指针状态。mouse/pen 命中地形才
  // 消费事件（未命中保留 OrbitControls/fly 的既有导航）；touch 不 stopPropagation，
  // 让 OrbitControls 保留 pointer 跟踪，第二指才能自然进入 TOUCH_DOLLY_PAN。
  const ANNOTATION_THIN_PX = 2          // 屏幕像素抽稀；与 2D 的 ANNOT_THIN_PX 同量级
  const ANNOTATION_MAX_RECONNECT = 25   // hit→miss→hit 后 XZ 跳超过此距离才冻结 stroke
  const ANNOTATION_RING_OUTLINE_SCALE = 1.06  // 半透明黑外圈相对白 ring 的半径倍数

  function annotationToolActive() {
    return annotationInteraction.enabled && !!annotationInteraction.tool
  }

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
    // renderer.render 才更新 matrixWorld；暂停/无首帧时也必须得到当前相机射线。
    // 无布局测试/首帧前 aspect 可能仍是 NaN（renderer 创建时 clientWidth/clientHeight=0），
    // 用容器实测比例修复投影；真实浏览器不会走到这里。
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
    const controls = deps.getControls()
    if (!camera || !raycaster || !controls || !rect || !(rect.width > 0) || !(rect.height > 0)) return null
    setRaycasterFromClient(clientX, clientY, rect)
    const origin = raycaster.ray.origin
    const direction = raycaster.ray.direction
    const maxT = Math.min(4000, Number.isFinite(camera.far) ? camera.far : 4000)
    const distance = camera.position.distanceTo(controls.target)
    const step = Math.max(1.5, Math.min(8, (Number.isFinite(distance) ? distance : 200) / 160))
    // ceiling 只用于向上射线提前退出；+100 m 是地形 zmax 之上的安全余量。
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

  /**
   * camera ray × 可绘制 static scenery：候选来自装配期 16m 足印格，不遍历整张 GLB。
   * far 收到 terrain hit 距离之前，因此只有真正位于地面之前的表面才会被选中。
   */
  function raycastAnnotationScenery(clientX: number, clientY: number, rect: DOMRect, groundHit: ReturnType<typeof raycastAnnotationGround>) {
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
      point: hit.point,
      distance: hit.distance,
      surfaceY: hit.point.y,
      surfaceN: normal ? { x: normal.x, y: normal.y, z: normal.z } : undefined,
    }
  }

  /**
   * 诊断专用：解释一次 annotation surface pick 的 grid/candidate/rejection。
   * 与 pickAnnotationSurface 共用同一 grid/candidate/raycast/policy，不建立第二套 telemetry。
   */
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

  /**
   * client px -> semantic surface point. terrain 走既有 raycast；scenery 表面只在更近时胜出。
   * Width/radius 不使用 camera scale。
   */
  function pickAnnotationSurface(clientX: number, clientY: number) {
    if (!annotationToolActive() || !annotationsVisible) return null
    const PERF = deps.perfEnabled()
    const startedAt = PERF ? performance.now() : 0
    const rect = container.getBoundingClientRect()
    const groundHit = raycastAnnotationGround(clientX, clientY, rect)
    const surfaceHit = raycastAnnotationScenery(clientX, clientY, rect, groundHit)
    const surfaceHitView = surfaceHit as (AnnotationHitLike & { surfaceN?: { x: number; y: number; z: number } }) | null
    const hit = chooseAnnotationHit(groundHit, surfaceHit)
    if (!hit || !hit.point) return null
    if (PERF) annotationStats.lastPickMs = performance.now() - startedAt
    const fromSurface = hit === surfaceHit
    return {
      semantic: semanticFromScene(
        hit.point.x, hit.point.z,
        fromSurface ? hit.point.y : undefined,
        fromSurface ? surfaceHitView?.surfaceN : undefined,
      ),
    }
  }

  /**
   * Toolbar logical width -> canonical map-space width. Reuse mapImages (2D canonical
   * registry) and terrain/map span; never current camera projection. Unknown map key
   * falls back to 1:1 map units so the slider stays stable without a second registry.
   */
  function annotationSemanticWidth(sliderValue: number) {
    const image = deps.mapWorld.mapKey() ? mapImages[deps.mapWorld.mapKey() as keyof typeof mapImages] : null
    const bounds = image?.coordinateBounds
    const semanticSpan = bounds
      ? bounds.xMax - bounds.xMin
      : (Number(deps.mapWorld.mapMetaInfo()?.size_m) || Number(deps.mapWorld.heightMeta()?.span) || deps.mapWorld.terrainSpanOf())
    const logicalSpan = Number(image?.width) || semanticSpan
    return semanticWidthFromSlider(sliderValue, { semanticSpan, logicalSpan })
  }

  function applyAnnotationTouchMode() {
    const controls = deps.getControls()
    if (!controls || !controls.touches) return
    if (annotationToolActive()) {
      if (annotationOriginalTouchesOne === null) annotationOriginalTouchesOne = controls.touches.ONE
      controls.touches.ONE = null
    } else if (annotationOriginalTouchesOne !== null) {
      controls.touches.ONE = annotationOriginalTouchesOne
      annotationOriginalTouchesOne = null
    }
  }

  function updateAnnotationRing(semantic: SemanticPoint | null, radius: number) {
    if (!annotationRing) return
    if (!semantic || !(radius > 0)) {
      setAnnotationRingPositions(null)
      return
    }
    const center = sceneFromSemantic(semantic)
    const ring = buildEraserRing(center, radius, deps.annotationSurfaceHeightAt, { lift: ANNOTATION_LIFT / 2 })
    const outline = buildEraserRing(center, radius * ANNOTATION_RING_OUTLINE_SCALE, deps.annotationSurfaceHeightAt, {
      lift: ANNOTATION_LIFT / 2,
    })
    setAnnotationRingPositions(ring ? ring.positions : null, outline ? outline.positions : null)
  }

  function beginAnnotationGesture(e: PointerEvent, pick: { semantic: SemanticPoint }) {
    const tool = annotationInteraction.tool
    const semantic = semanticPoint(pick.semantic)
    annotationGesture = {
      pointerId: e.pointerId,
      pointerType: e.pointerType || 'mouse',
      tool: tool as 'pen' | 'eraser',
      color: annotationInteraction.color,
      width: tool === 'pen' ? Math.max(0.01, annotationSemanticWidth(annotationInteraction.width)) : 0,
      radius: tool === 'eraser' ? Math.max(0.01, annotationSemanticWidth(annotationInteraction.eraserWidth)) : 0,
      points: [semantic],
      lastScreen: { x: e.clientX, y: e.clientY },
      frozen: false,
      hadGroundMiss: false,
      capture: false,
    }
    if (tool === 'pen') {
      setAnnotationRingPositions(null)
      annotationDraft = {
        type: 'pen',
        color: annotationGesture.color,
        width: annotationGesture.width,
        points: [semanticPoint(semantic)],
      }
      rebuildDraftAnnotation()
    } else {
      annotationDraft = null
      rebuildDraftAnnotation()
      updateAnnotationRing(semantic, annotationGesture.radius)
    }
    deps.invalidate()
  }

  function appendAnnotationPoint(e: PointerEvent) {
    const gesture = annotationGesture
    if (!gesture || gesture.frozen) return
    const pick = pickAnnotationSurface(e.clientX, e.clientY)
    if (!pick) {
      // 连续有效 hit 之间的大跳只是 fast swipe / 低帧率 / 合并事件，不是 reconnect；
      // 只有真的经过 terrain miss 后才允许用 maxReconnect 保护。
      gesture.hadGroundMiss = true
      if (gesture.tool === 'eraser') setAnnotationRingPositions(null)
      return
    }
    const previous = gesture.points[gesture.points.length - 1]
    const jump = Math.hypot(pick.semantic.x - previous.x, pick.semantic.y - previous.y)
    const reconnected = gesture.hadGroundMiss && jump > ANNOTATION_MAX_RECONNECT
    gesture.hadGroundMiss = false
    if (reconnected) {
      // 不让一次 gesture 跨地图拉巨线；也不拆成第二条 annotation（one gesture = one undo）。
      gesture.frozen = true
      if (gesture.tool === 'eraser') setAnnotationRingPositions(null)
      return
    }
    if (jump < 1e-6) return
    if (gesture.tool === 'pen' && gesture.points.length >= ANNOTATION_MAX_INPUT_POINTS) {
      gesture.frozen = true
      return
    }
    const next = semanticPoint(pick.semantic)
    gesture.points.push(next)
    if (gesture.tool === 'pen') {
      // Draft 与 commit 用同一个 deterministic normalizer，避免 pointerup 时视觉 snap。
      annotationDraft!.points = normalizePenPoints(gesture.points)
      rebuildDraftAnnotation()
    } else {
      if (gesture.points.length > ANNOTATION_MAX_ERASER_POINTS) {
        // 保留首尾做隔点抽稀；capsule 对稀疏 eraser path 仍然正确。
        const thinned: SemanticPoint[] = []
        for (let i = 0; i < gesture.points.length; i += 2) thinned.push(gesture.points[i])
        const last = gesture.points[gesture.points.length - 1]
        if (thinned[thinned.length - 1] !== last) thinned.push(last)
        gesture.points = thinned
      }
      updateAnnotationRing(next, gesture.radius)
    }
    deps.invalidate()
  }

  function finishAnnotationGesture(cancelled: boolean) {
    const gesture = annotationGesture
    annotationGesture = null
    annotationDraft = null
    rebuildDraftAnnotation()
    setAnnotationRingPositions(null)
    if (gesture && gesture.capture) {
      try { container.releasePointerCapture(gesture.pointerId) } catch (_) {}
    }
    if (!gesture || cancelled) {
      deps.invalidate()
      return
    }
    if (gesture.tool === 'pen') {
      if (gesture.points.length >= 2) {
        deps.onAnnotationCommit?.({
          type: 'pen',
          color: gesture.color,
          width: gesture.width,
          points: normalizePenPoints(gesture.points),
        })
      }
    } else if (gesture.points.length > 0) {
      annotationStats.eraseCallbacks++
      deps.onAnnotationErase?.({
        points: gesture.points.map((point) => semanticPoint(point)),
        radius: gesture.radius,
      })
    }
    deps.invalidate()
  }

  function cancelAnnotationGesture() {
    const gesture = annotationGesture
    annotationGesture = null
    annotationDraft = null
    rebuildDraftAnnotation()
    setAnnotationRingPositions(null)
    if (gesture && gesture.capture) {
      try { container.releasePointerCapture(gesture.pointerId) } catch (_) {}
    }
    if (annotationPointers.size > 0) annotationSuppressUntilAllUp = true
    deps.invalidate()
  }

  function onAnnotationPointerDown(e: PointerEvent) {
    if (!annotationToolActive()) return
    if (e.pointerType !== 'touch' && e.button !== 0) return
    if (!annotationPointers.has(e.pointerId)) {
      annotationPointers.set(e.pointerId, e.pointerType || 'mouse')
    }
    if (annotationGesture && annotationGesture.pointerId !== e.pointerId) {
      cancelAnnotationGesture()
      annotationSuppressUntilAllUp = true
      return
    }
    if (e.pointerType === 'touch') {
      if (annotationPointers.size >= 2) {
        cancelAnnotationGesture()
        annotationSuppressUntilAllUp = true
        return
      }
      if (annotationSuppressUntilAllUp || annotationGesture || !annotationsVisible) return
      const pick = pickAnnotationSurface(e.clientX, e.clientY)
      if (!pick) return
      beginAnnotationGesture(e, pick)
      return
    }
    if (annotationSuppressUntilAllUp || annotationGesture || !annotationsVisible) return
    const pick = pickAnnotationSurface(e.clientX, e.clientY)
    if (!pick) return
    beginAnnotationGesture(e, pick)
    let captured = false
    try { container.setPointerCapture(e.pointerId); captured = true } catch (_) {}
    annotationGesture!.capture = captured
    e.preventDefault()
    // 同节点还有 fly capture 监听：stopPropagation 不会拦住同一元素的其他 listener；
    // 必须 stopImmediatePropagation，否则 free camera 下 mouse 画线会同时转头。
    e.stopImmediatePropagation()
  }

  function onAnnotationPointerMove(e: PointerEvent) {
    const gesture = annotationGesture
    if (!gesture || gesture.pointerId !== e.pointerId) return
    if (e.pointerType === 'touch' && annotationPointers.size >= 2) return
    const dx = e.clientX - gesture.lastScreen.x
    const dy = e.clientY - gesture.lastScreen.y
    if (Math.hypot(dx, dy) < ANNOTATION_THIN_PX) return
    gesture.lastScreen = { x: e.clientX, y: e.clientY }
    if (gesture.pointerType !== 'touch') {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    if (gesture.frozen) return
    appendAnnotationPoint(e)
  }

  function onAnnotationPointerUp(e: PointerEvent) {
    const gesture = annotationGesture
    if (gesture && gesture.pointerId === e.pointerId) {
      if (gesture.pointerType !== 'touch') {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
      finishAnnotationGesture(e.type === 'pointercancel')
    }
    annotationPointers.delete(e.pointerId)
    if (annotationPointers.size === 0) annotationSuppressUntilAllUp = false
  }

  function onAnnotationCaptureLost(e: PointerEvent) {
    if (!annotationGesture || annotationGesture.pointerId !== e.pointerId) return
    finishAnnotationGesture(true)
    annotationPointers.delete(e.pointerId)
    if (annotationPointers.size === 0) annotationSuppressUntilAllUp = false
  }

  // ---- 宿主接线收口 ----
  // attachListeners = initScene 的 annotation 段逐字对应（独立 raycaster 每次渲染器装配
  // 重建；监听重复注册由 addEventListener 同引用去重；layer 与触摸模式随后就绪）。
  function attachListeners() {
    annotationSurfaceRaycaster = new THREE.Raycaster();
    // annotation 先于 fly capture 注册：mouse/pen 命中地形时消费事件；touch 不消费，
    // 让 OrbitControls / fly 继续跟踪第二指。
    container.addEventListener('pointerdown', onAnnotationPointerDown, true);
    container.addEventListener('pointermove', onAnnotationPointerMove, true);
    container.addEventListener('pointerup', onAnnotationPointerUp, true);
    container.addEventListener('pointercancel', onAnnotationPointerUp, true);
    container.addEventListener('lostpointercapture', onAnnotationCaptureLost, true);
    ensureAnnotationLayer();   // annotation layer 跟随 renderer 生命周期（lazy，材质/geometry 可复用）
    applyAnnotationTouchMode();   // pane 可能在 initScene 之前就推送了 interaction
  }
  function detach() {
    try { container.removeEventListener('pointerdown', onAnnotationPointerDown, true); } catch (_) {}
    try { container.removeEventListener('pointermove', onAnnotationPointerMove, true); } catch (_) {}
    try { container.removeEventListener('pointerup', onAnnotationPointerUp, true); } catch (_) {}
    try { container.removeEventListener('pointercancel', onAnnotationPointerUp, true); } catch (_) {}
    try { container.removeEventListener('lostpointercapture', onAnnotationCaptureLost, true); } catch (_) {}
  }

  return {
    attachListeners,
    detach,
    annotationToolActive,
    hasGesture: () => !!annotationGesture,
    cancelAnnotationGesture,
    rebuildAnnotationProjection,
    reprojectAnnotationHeights,
    clearSessionProjection: clearAnnotationProjection,
    dispose: disposeAnnotationLayer,
    restoreTouches() {
      const controls = deps.getControls()
      if (controls && annotationOriginalTouchesOne !== null) {
        try { controls.touches.ONE = annotationOriginalTouchesOne; } catch (_) {}
      }
      annotationOriginalTouchesOne = null
    },
    setRaycasterFromClient,
    raycastAnnotationGround,
    setAnnotations(annotations: unknown) {
      const next = Array.isArray(annotations) ? (annotations as AnnotationInput[]) : []
      if (next === projectedAnnotations) return
      projectedAnnotations = next
      if (ensureAnnotationLayer()) rebuildCommittedAnnotations()
      deps.invalidate()
    },
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
      if (changed) cancelAnnotationGesture()
      applyAnnotationTouchMode()
      deps.invalidate()
    },
    setAnnotationsVisible(visible: boolean) {
      annotationsVisible = visible !== false
      if (!annotationsVisible) cancelAnnotationGesture()
      if (annotationGroup) annotationGroup.visible = annotationsVisible
      deps.invalidate()
    },
    stats: () => annotationStats,
  };
}
