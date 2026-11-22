// 3D annotation pointer 手势状态机（desktop + touch 单指 drawing / eraser）——自
// annotationScene.ts 出仓（2026-11-21 #LOC 结构拆分：代码与搬移前逐字一致；闭包读数改经
// deps 注入）。指针表/抑制标志/touch 模式的 owner 随迁本模块；事件监听注册/摘除收口为
// attachListeners()/detach()（initScene 的 annotation 段与 destroy 的摘除段逐字对应；
// 重复 attach 由 addEventListener 同引用去重保证幂等）。
import type { PenAnnotation, SemanticPoint } from './annotation3d.js'
import { ANNOTATION_LIFT, ANNOTATION_MAX_ERASER_POINTS, ANNOTATION_MAX_INPUT_POINTS, buildEraserRing, normalizePenPoints } from './annotation3d.js'
import type { AnnotationLayerHandle } from './annotationLayer.ts'
import type { AnnotationSurfacePicker } from './annotationSurfacePicker.ts'
import type { AnnotationInteractionConfig } from './annotationScene.js'

const ANNOTATION_THIN_PX = 2          // 屏幕像素抽稀；与 2D 的 ANNOT_THIN_PX 同量级
const ANNOTATION_MAX_RECONNECT = 25   // hit→miss→hit 后 XZ 跳超过此距离才冻结 stroke
const ANNOTATION_RING_OUTLINE_SCALE = 1.06  // 半透明黑外圈相对白 ring 的半径倍数

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

/** 手势状态机消费的宿主依赖（getter 快照；语义见 annotationScene.ts 的 deps 注释）。 */
export interface AnnotationGestureDeps {
  container: HTMLElement
  invalidate(): void
  /** annotation 工具配置（owner = 宿主 setAnnotationInteraction）。 */
  interaction(): Required<AnnotationInteractionConfig> & { tool: 'pen' | 'eraser' | null }
  /** 工具是否激活（宿主口径 = interaction.enabled && !!tool）。 */
  toolActive(): boolean
  /** 带工具门控与 perf 统计的地表拾取（宿主 pickAnnotationSurface）。 */
  pick(clientX: number, clientY: number): { semantic: SemanticPoint } | null
  /** 名牌/标注层可见性（owner = layer；工具门控消费）。 */
  visible(): boolean
  /** OrbitControls（touch.touches.ONE 模式切换；来自宿主渲染器核心）。 */
  getControls(): { touches?: { ONE: string | null } | null } | null
  /** 地表采样（ring 贴地构建；owner = mapWorld 经宿主注入）。 */
  annotationSurfaceHeightAt(x: number, z: number): number | null
  /** GPU 图层句柄（draft / ring / ensure 的唯一写入口）。 */
  layer: AnnotationLayerHandle
  /** semantic 坐标换算与宽度解析（owner = surface picker）。 */
  picker: AnnotationSurfacePicker
  /** 共享 perf 统计（eraseCallbacks 计数）。 */
  stats: { eraseCallbacks: number }
  onAnnotationCommit?: ((payload: { type: 'pen'; color: string; width: number; points: SemanticPoint[] }) => void) | null
  onAnnotationErase?: ((payload: { points: SemanticPoint[]; radius: number }) => void) | null
}

/** 手势状态机句柄（宿主接线与图层清空复位的唯一消费面）。 */
export interface AnnotationGestureHandle {
  attachListeners(): void
  detach(): void
  hasGesture(): boolean
  cancelAnnotationGesture(): void
  /** 会话清空：指针表与抑制标志随会话复位（原 clearAnnotationProjection 段）。 */
  resetPointerState(): void
  applyAnnotationTouchMode(): void
  restoreTouches(): void
  gesture(): unknown
}

export function createAnnotationGesture(deps: AnnotationGestureDeps): AnnotationGestureHandle {
  const { container } = deps
  const { layer, picker } = deps
  const annotationPointers = new Map<number, string>()
  let annotationGesture: AnnotationGesture | null = null
  let annotationSuppressUntilAllUp = false
  let annotationOriginalTouchesOne: string | null = null

  function setAnnotationRingPositions(positions: Float32Array | null, outlinePositions: Float32Array | null = null) {
    layer.setRingPositions(positions, outlinePositions)
  }

  function applyTouch() {
    const controls = deps.getControls()
    if (!controls || !controls.touches) return
    if (deps.toolActive()) {
      if (annotationOriginalTouchesOne === null) annotationOriginalTouchesOne = controls.touches.ONE
      controls.touches.ONE = null
    } else if (annotationOriginalTouchesOne !== null) {
      controls.touches.ONE = annotationOriginalTouchesOne
      annotationOriginalTouchesOne = null
    }
  }

  function updateAnnotationRing(semantic: SemanticPoint | null, radius: number) {
    if (!layer.hasRing()) return
    if (!semantic || !(radius > 0)) {
      setAnnotationRingPositions(null)
      return
    }
    const center = picker.sceneFromSemantic(semantic)
    const ring = buildEraserRing(center, radius, deps.annotationSurfaceHeightAt, { lift: ANNOTATION_LIFT / 2 })
    const outline = buildEraserRing(center, radius * ANNOTATION_RING_OUTLINE_SCALE, deps.annotationSurfaceHeightAt, {
      lift: ANNOTATION_LIFT / 2,
    })
    setAnnotationRingPositions(ring ? ring.positions : null, outline ? outline.positions : null)
  }

  function beginAnnotationGesture(e: PointerEvent, pick: { semantic: SemanticPoint }) {
    const interaction = deps.interaction()
    const tool = interaction.tool
    const semantic = picker.semanticPoint(pick.semantic)
    annotationGesture = {
      pointerId: e.pointerId,
      pointerType: e.pointerType || 'mouse',
      tool: tool as 'pen' | 'eraser',
      color: interaction.color,
      width: tool === 'pen' ? Math.max(0.01, picker.annotationSemanticWidth(interaction.width)) : 0,
      radius: tool === 'eraser' ? Math.max(0.01, picker.annotationSemanticWidth(interaction.eraserWidth)) : 0,
      points: [semantic],
      lastScreen: { x: e.clientX, y: e.clientY },
      frozen: false,
      hadGroundMiss: false,
      capture: false,
    }
    if (tool === 'pen') {
      setAnnotationRingPositions(null)
      layer.setDraft({
        type: 'pen',
        color: annotationGesture.color,
        width: annotationGesture.width,
        points: [picker.semanticPoint(semantic)],
      } as PenAnnotation)
      layer.rebuildDraft()
    } else {
      layer.setDraft(null)
      layer.rebuildDraft()
      updateAnnotationRing(semantic, annotationGesture.radius)
    }
    deps.invalidate()
  }

  function appendAnnotationPoint(e: PointerEvent) {
    const gesture = annotationGesture
    if (!gesture || gesture.frozen) return
    const pick = deps.pick(e.clientX, e.clientY)
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
    const next = picker.semanticPoint(pick.semantic)
    gesture.points.push(next)
    if (gesture.tool === 'pen') {
      // Draft 与 commit 用同一个 deterministic normalizer，避免 pointerup 时视觉 snap。
      layer.setDraft({ ...(annotationDraftOf(gesture) as PenAnnotation), points: normalizePenPoints(gesture.points) })
      layer.rebuildDraft()
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
  /** 当前 draft（gesture 的 pen 影子；owner = layer）。 */
  function annotationDraftOf(gesture: AnnotationGesture): PenAnnotation | null {
    return gesture.tool === 'pen'
      ? { type: 'pen', color: gesture.color, width: gesture.width, points: gesture.points }
      : null
  }

  function finishAnnotationGesture(cancelled: boolean) {
    const gesture = annotationGesture
    annotationGesture = null
    layer.setDraft(null)
    layer.rebuildDraft()
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
      deps.stats.eraseCallbacks++
      deps.onAnnotationErase?.({
        points: gesture.points.map((point) => picker.semanticPoint(point)),
        radius: gesture.radius,
      })
    }
    deps.invalidate()
  }

  function cancelAnnotationGesture() {
    const gesture = annotationGesture
    annotationGesture = null
    layer.setDraft(null)
    layer.rebuildDraft()
    setAnnotationRingPositions(null)
    if (gesture && gesture.capture) {
      try { container.releasePointerCapture(gesture.pointerId) } catch (_) {}
    }
    if (annotationPointers.size > 0) annotationSuppressUntilAllUp = true
    deps.invalidate()
  }

  function onAnnotationPointerDown(e: PointerEvent) {
    if (!deps.toolActive()) return
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
      if (annotationSuppressUntilAllUp || annotationGesture || !deps.visible()) return
      const pick = deps.pick(e.clientX, e.clientY)
      if (!pick) return
      beginAnnotationGesture(e, pick)
      return
    }
    if (annotationSuppressUntilAllUp || annotationGesture || !deps.visible()) return
    const pick = deps.pick(e.clientX, e.clientY)
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
    // annotation 先于 fly capture 注册：mouse/pen 命中地形时消费事件；touch 不消费，
    // 让 OrbitControls / fly 继续跟踪第二指。
    container.addEventListener('pointerdown', onAnnotationPointerDown, true);
    container.addEventListener('pointermove', onAnnotationPointerMove, true);
    container.addEventListener('pointerup', onAnnotationPointerUp, true);
    container.addEventListener('pointercancel', onAnnotationPointerUp, true);
    container.addEventListener('lostpointercapture', onAnnotationCaptureLost, true);
    layer.ensure();   // annotation layer 跟随 renderer 生命周期（lazy，材质/geometry 可复用）
    applyTouch();   // pane 可能在 initScene 之前就推送了 interaction
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
    hasGesture: () => !!annotationGesture,
    cancelAnnotationGesture,
    resetPointerState() {
      annotationPointers.clear()
      annotationSuppressUntilAllUp = false
    },
    applyAnnotationTouchMode: applyTouch,
    restoreTouches() {
      const controls = deps.getControls()
      if (controls && annotationOriginalTouchesOne !== null && controls.touches) {
        try { controls.touches.ONE = annotationOriginalTouchesOne; } catch (_) {}
      }
      annotationOriginalTouchesOne = null
    },
    gesture: () => annotationGesture,
  }
}
