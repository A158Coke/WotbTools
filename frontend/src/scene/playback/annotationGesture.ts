import type { PenAnnotation, SemanticPoint } from './annotation3d.js'
import { ANNOTATION_LIFT, ANNOTATION_MAX_ERASER_POINTS, ANNOTATION_MAX_INPUT_POINTS, buildEraserRing, normalizePenPoints } from './annotation3d.js'
import type { AnnotationLayerHandle } from './annotationLayer.ts'
import type { AnnotationSurfacePicker } from './annotationSurfacePicker.ts'
import type { AnnotationInteractionConfig } from './annotationScene.js'

const ANNOTATION_THIN_PX = 2
const ANNOTATION_MAX_RECONNECT = 25
const ANNOTATION_RING_OUTLINE_SCALE = 1.06

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

export interface AnnotationGestureDeps {
  container: HTMLElement
  invalidate(): void
  interaction(): Required<AnnotationInteractionConfig> & { tool: 'pen' | 'eraser' | null }
  toolActive(): boolean
  pick(clientX: number, clientY: number): { semantic: SemanticPoint } | null
  visible(): boolean
  getControls(): { touches?: { ONE: string | null } | null } | null
  annotationSurfaceHeightAt(x: number, z: number): number | null
  layer: AnnotationLayerHandle
  picker: AnnotationSurfacePicker
  stats: { eraseCallbacks: number }
  onAnnotationCommit?: ((payload: { type: 'pen'; color: string; width: number; points: SemanticPoint[] }) => void) | null
  onAnnotationErase?: ((payload: { points: SemanticPoint[]; radius: number }) => void) | null
}

export interface AnnotationGestureHandle {
  attachListeners(): void
  detach(): void
  hasGesture(): boolean
  cancelAnnotationGesture(): void
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
      gesture.hadGroundMiss = true
      if (gesture.tool === 'eraser') setAnnotationRingPositions(null)
      return
    }
    const previous = gesture.points[gesture.points.length - 1]
    const jump = Math.hypot(pick.semantic.x - previous.x, pick.semantic.y - previous.y)
    const reconnected = gesture.hadGroundMiss && jump > ANNOTATION_MAX_RECONNECT
    gesture.hadGroundMiss = false
    if (reconnected) {
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
      layer.setDraft({ ...(annotationDraftOf(gesture) as PenAnnotation), points: normalizePenPoints(gesture.points) })
      layer.rebuildDraft()
    } else {
      if (gesture.points.length > ANNOTATION_MAX_ERASER_POINTS) {
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

  function attachListeners() {
    container.addEventListener('pointerdown', onAnnotationPointerDown, true);
    container.addEventListener('pointermove', onAnnotationPointerMove, true);
    container.addEventListener('pointerup', onAnnotationPointerUp, true);
    container.addEventListener('pointercancel', onAnnotationPointerUp, true);
    container.addEventListener('lostpointercapture', onAnnotationCaptureLost, true);
    layer.ensure();
    applyTouch();
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
