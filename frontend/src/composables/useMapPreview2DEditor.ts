import { computed, nextTick, reactive, ref } from 'vue'
import {
  ANNOT_COLORS, ANNOT_ERASER_RADIUS_DEFAULT, ANNOT_TANK_CLASSES, ANNOT_WIDTH_DEFAULT,
  annotationDraftFromTool, applyEraser, hitTestAnnotation, isDegenerateAnnotation,
  screenToSemantic, svgToScreen, translateAnnotation,
} from '../utils/annotation.js'
import { useAnnotationState } from './useAnnotationState.js'
import { useAnnotationSvgProjection } from './useAnnotationSvgProjection.js'
import { zoomViewAt } from '../utils/battlePlayback.js'
import type { ComputedRef, Ref } from 'vue'
import type { MapAnnotation } from './useAnnotationState.js'
import type { PlaybackMapViewLike } from './usePlaybackCamera.js'
import type { useMapPreview2DCamera } from './useMapPreview2DCamera.js'

const ANNOT_THIN_PX = 2

type Point = { x: number; y: number }
type PanStart = Point & { tx: number; ty: number }
type TextSession = { point: Point; text: string; cancelled?: boolean; committed?: boolean }
type Camera = ReturnType<typeof useMapPreview2DCamera>
type EditorOptions = {
  mapView: ComputedRef<PlaybackMapViewLike>
  camera: Camera
  mapComponent: Ref<{ textInputRef?: { focus(options?: { preventScroll?: boolean }): void } | null } | null>
}

export function useMapPreview2DEditor({ mapView, camera, mapComponent }: EditorOptions) {
  const { view, screenPoint, renderRect, mapWidth, mapHeight, fitScale, applyView, PAN_THRESHOLD_PX } = camera
  const annotWidthSlider = ref(ANNOT_WIDTH_DEFAULT)
  const annotationEraserRadius = ref(ANNOT_ERASER_RADIUS_DEFAULT)
  const annotationOpen = ref(false)
  const annotationTool = ref<string | null>(null)
  const annotationColor = ref(ANNOT_COLORS[0])
  const annotationsVisible = ref(true)
  const routePoints = ref<Point[]>([])
  const textSession = ref<TextSession | null>(null)
  let moveOriginal: MapAnnotation | null = null
  let drawStart: Point | null = null
  let drawPoints: Point[] = []
  let drawScreen: Point[] = []
  let drawingPointerId: number | null = null
  const exportingImage = ref(false)
  const exportError = ref('')

  const {
    history: annotationHistory, historyIndex: annotationIndex, annotations, draft, selectedAnnotationIndex,
    selectedAnnotation, reset: resetAnnotationHistory, replaceAnnotations, commitDraft, undo: undoHistory,
    redo: redoHistory, clearAll, deleteSelected, renameSelected: renameSelectedState, updateSelected,
  } = useAnnotationState()
  const { semPerSvgX, annotWidth, renderedAnnotations } = useAnnotationSvgProjection(mapView, {
    widthSlider: annotWidthSlider,
    annotations,
    draft,
    selectedIndex: selectedAnnotationIndex,
    replacingSelected: () => !!moveOriginal,
    showSelection: () => annotationOpen.value,
  })
  function undoAnnotation() {
    cancelRoute()
    undoHistory()
  }
  function redoAnnotation() {
    cancelRoute()
    redoHistory()
  }
  function clearAnnotations() {
    cancelRoute()
    clearAll()
  }
  function renameSelected(label: string) {
    if (selectedAnnotation.value?.type === 'text' && !String(label).trim()) return
    renameSelectedState(label)
  }
  function setAnnotationTool(tool: string) {
    if (textSession.value) commitTextSession(textSession.value)
    cancelRoute()
    selectedAnnotationIndex.value = -1
    annotationsVisible.value = true
    annotationTool.value = tool
  }
  function setAnnotationColor(color: string) {
    annotationColor.value = color
    if (selectedAnnotation.value) updateSelected({ color })
    if (routePoints.value.length) draft.value = routeDraft()
  }
  function toggleAnnotations() {
    cancelRoute()
    selectedAnnotationIndex.value = -1
    annotationsVisible.value = !annotationsVisible.value
  }
  function openAnnotation() {
    if (annotationOpen.value) return
    annotationOpen.value = true
    annotationTool.value = 'select'
    annotationsVisible.value = true
  }
  function closeAnnotation() {
    if (textSession.value) commitTextSession(textSession.value)
    cancelRoute()
    annotationOpen.value = false
    annotationTool.value = null
    selectedAnnotationIndex.value = -1
  }
  function resetAnnotationState() {
    resetAnnotationHistory()
    annotationOpen.value = false
    annotationTool.value = null
    annotationsVisible.value = true
    routePoints.value = []
    if (textSession.value) cancelTextSession(textSession.value)
    textSession.value = null
    exportError.value = ''
    exportingImage.value = false
    pointers.clear()
    drawingPointerId = null
    drawStart = null
    drawPoints = []
    drawScreen = []
    moveOriginal = null
  }

  function semanticPoint(e: PointerEvent): Point | null {
    const sp = screenPoint(e.clientX, e.clientY)
    return screenToSemantic(view, mapView.value, sp.x, sp.y, renderRect().width, renderRect().height)
  }

  const pointers = new Map<number, Point>()
  let panStart: PanStart | null = null
  let pinchStart: { mid: Point; dist: number; anchorScreen: Point; scale: number; tx: number; ty: number } | null = null

  function pinchInfo() {
    const [a, b] = [...pointers.values()]
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    return { mid, dist: Math.hypot(a.x - b.x, a.y - b.y) }
  }

  function cancelRoute() {
    routePoints.value = []
    cancelDrawing()
  }

  function routeDraft(): MapAnnotation {
    return { type: 'route', color: annotationColor.value, width: annotWidth.value, points: [...routePoints.value] }
  }

  function finishRoute() {
    if (routePoints.value.length < 2) return
    const annotation = routeDraft()
    routePoints.value = []
    cancelDrawing()
    commitDraft(annotation)
  }

  function selectionTolerance() {
    const rect = renderRect()
    const width = rect.width || mapView.value.W
    return 12 * semPerSvgX.value * mapView.value.W / width / Math.max(1, view.scale)
  }

  function startDrawing(e: PointerEvent) {
    const point = semanticPoint(e)
    if (!point || !annotationsVisible.value) return
    drawingPointerId = e.pointerId
    const tool = annotationTool.value
    if (tool === 'select') {
      selectedAnnotationIndex.value = hitTestAnnotation(annotations.value, point, selectionTolerance())
      moveOriginal = selectedAnnotation.value
      drawStart = point
      return
    }
    if (tool === 'route' || ANNOT_TANK_CLASSES.some(item => item.key === tool)) {
      drawStart = point
      if (tool === 'route') draft.value = routeDraft()
      return
    }
    if (tool === 'text') {
      if (textSession.value) commitTextSession(textSession.value)
      textSession.value = reactive({ point, text: '' })
      nextTick(() => mapComponent.value?.textInputRef?.focus())
      return
    }
    if (tool === 'pen' || tool === 'eraser') {
      drawPoints = [point]
      drawScreen = [{ x: e.clientX, y: e.clientY }]
      draft.value = { type: tool, color: annotationColor.value, width: annotWidth.value, points: [point] }
      return
    }
    drawStart = point
    draft.value = annotationDraftFromTool(tool, point, point, { color: annotationColor.value, width: annotWidth.value })
  }

  function moveDrawing(e: PointerEvent) {
    const point = semanticPoint(e)
    if (!point) return
    const tool = annotationTool.value
    if (tool === 'select' && moveOriginal && drawStart) {
      if (Math.hypot(point.x - drawStart.x, point.y - drawStart.y) > 1e-9) {
        draft.value = translateAnnotation(moveOriginal, point.x - drawStart.x, point.y - drawStart.y)
      }
      return
    }
    if (tool === 'route' || ANNOT_TANK_CLASSES.some(item => item.key === tool)) return
    if (tool === 'pen' || tool === 'eraser') {
      const last = drawScreen[drawScreen.length - 1]
      if (last == null || Math.hypot(e.clientX - last.x, e.clientY - last.y) >= ANNOT_THIN_PX) {
        drawScreen.push({ x: e.clientX, y: e.clientY })
        drawPoints.push(point)
        const currentDraft = draft.value
        if (currentDraft) draft.value = { ...currentDraft, points: [...drawPoints] }
      }
      return
    }
    if (drawStart) draft.value = annotationDraftFromTool(tool, drawStart, point, { color: annotationColor.value, width: annotWidth.value })
  }

  function endDrawing() {
    const tool = annotationTool.value
    if (!tool) return
    if (tool === 'select') {
      const movedAnnotation = draft.value
      if (movedAnnotation && moveOriginal && selectedAnnotationIndex.value >= 0) {
        const index = selectedAnnotationIndex.value
        replaceAnnotations(annotations.value.map((annotation, i) => i === index ? movedAnnotation : annotation))
      }
    } else if (tool === 'route') {
      if (drawStart) {
        const last = routePoints.value.at(-1)
        if (!last || Math.hypot(last.x - drawStart.x, last.y - drawStart.y) > 1e-9) routePoints.value.push(drawStart)
      }
      cancelDrawing()
      return
    } else if (ANNOT_TANK_CLASSES.some(item => item.key === tool) && drawStart) {
      commitDraft({ type: 'unit', tankClass: tool, color: annotationColor.value, x: drawStart.x, y: drawStart.y, radius: 16 * semPerSvgX.value, label: '' })
    } else if (tool === 'pen') {
      if (drawPoints.length >= 2) commitDraft({ type: 'pen', color: annotationColor.value, width: annotWidth.value, points: drawPoints })
    } else if (tool === 'eraser') {
      if (drawPoints.length) {
        const next = applyEraser(annotations.value, drawPoints, annotationEraserRadius.value)
        if (next !== annotations.value) replaceAnnotations(next)
      }
    } else if (draft.value && !isDegenerateAnnotation(draft.value)) {
      commitDraft(draft.value)
    }
    cancelDrawing()
  }

  function cancelDrawing() {
    draft.value = routePoints.value.length ? routeDraft() : null
    drawStart = null
    drawPoints = []
    drawScreen = []
    moveOriginal = null
    drawingPointerId = null
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button != null && e.button !== 0) return
    const target = e.target as (Element & { setPointerCapture?: (pointerId: number) => void }) | null
    if (target?.closest('input, textarea') || (target instanceof HTMLElement && target.isContentEditable)) return
    if (e.pointerType === 'mouse' && e.button === 0) e.preventDefault()
    if (e.currentTarget instanceof HTMLElement) e.currentTarget.focus({ preventScroll: true })
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    try {
      if (typeof target?.setPointerCapture === 'function') target.setPointerCapture(e.pointerId)
    } catch {
    }
    if (annotationOpen.value && annotationTool.value && pointers.size === 1) {
      startDrawing(e)
      return
    }
    if (drawingPointerId != null && pointers.size === 2) cancelDrawing()
    if (pointers.size === 1) {
      panStart = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }
    } else if (pointers.size === 2) {
      const info = pinchInfo()
      pinchStart = {
        mid: info.mid,
        dist: info.dist,
        anchorScreen: screenPoint(info.mid.x, info.mid.y),
        scale: view.scale,
        tx: view.tx,
        ty: view.ty,
      }
      panStart = null
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (drawingPointerId === e.pointerId && annotationTool.value) {
      moveDrawing(e)
      return
    }
    if (pointers.size === 2 && pinchStart) {
      const { mid, dist } = pinchInfo()
      if (pinchStart.dist > 0 && dist > 0) {
        const next = zoomViewAt(
          { scale: pinchStart.scale, tx: pinchStart.tx, ty: pinchStart.ty },
          pinchStart.anchorScreen.x, pinchStart.anchorScreen.y, dist / pinchStart.dist,
          fitScale(),
        )
        next.tx += mid.x - pinchStart.mid.x
        next.ty += mid.y - pinchStart.mid.y
        applyView(next)
      }
      return
    }
    if (pointers.size === 1 && panStart) {
      const dx = e.clientX - panStart.x
      const dy = e.clientY - panStart.y
      if (Math.hypot(dx, dy) < PAN_THRESHOLD_PX) return
      applyView({ scale: view.scale, tx: panStart.tx + dx, ty: panStart.ty + dy })
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!pointers.delete(e.pointerId)) return
    try {
      const target = e.target as (Element & { releasePointerCapture?: (pointerId: number) => void }) | null
      if (typeof target?.releasePointerCapture === 'function') target.releasePointerCapture(e.pointerId)
    } catch {
    }
    if (drawingPointerId === e.pointerId) {
      if (e.type === 'pointercancel') cancelDrawing()
      else endDrawing()
    }
    if (pointers.size < 2) pinchStart = null
    if (pointers.size === 0) {
      panStart = null
    } else if (pointers.size === 1 && pinchStart == null && panStart == null) {
      const [p] = [...pointers.values()]
      panStart = { x: p.x, y: p.y, tx: view.tx, ty: view.ty }
    }
  }

  function onStageKeydown(e: KeyboardEvent) {
    if (!annotationOpen.value || e.isComposing) return
    const tag = e.target instanceof Element ? e.target.tagName : undefined
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if (e.key === 'Enter' && annotationTool.value === 'route') {
      e.preventDefault()
      finishRoute()
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnotation.value) {
      e.preventDefault()
      deleteSelected()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      if (routePoints.value.length) cancelRoute()
      else closeAnnotation()
    }
  }

  function updateTextSession(value: string) {
    if (textSession.value) textSession.value.text = String(value)
  }

  function commitTextSession(session: TextSession | null) {
    if (!session || session.cancelled || session.committed) return
    if (textSession.value === session) textSession.value = null
    session.committed = true
    const text = session.text.trim()
    if (!text) return
    commitDraft({ type: 'text', color: annotationColor.value, x: session.point.x, y: session.point.y, text })
  }

  function cancelTextSession(session: TextSession | null) {
    if (textSession.value === session) textSession.value = null
    if (session) session.cancelled = true
  }

  const textInputStyle = computed(() => {
    const session = textSession.value
    if (!session) return null
    const point = svgToScreen(mapView.value, view, mapView.value.toX(session.point.x), mapView.value.toY(session.point.y), mapWidth(), mapHeight())
    if (!point) return null
    return { left: `${point.x}px`, top: `${point.y}px` }
  })

  const mapTouchPan = computed(() => !annotationOpen.value && view.scale <= fitScale() + 1e-3)
  return { annotationOpen, annotationTool, annotationColor, annotationsVisible, routePoints, textSession, exportingImage, exportError, annotWidthSlider, annotationEraserRadius, annotationHistory, annotationIndex, annotations, draft, selectedAnnotationIndex, selectedAnnotation, replaceAnnotations, commitDraft, clearAll, deleteSelected, updateSelected, semPerSvgX, annotWidth, renderedAnnotations, resetAnnotationState, undoAnnotation, redoAnnotation, clearAnnotations, renameSelected, setAnnotationTool, setAnnotationColor, toggleAnnotations, openAnnotation, closeAnnotation, cancelRoute, finishRoute, onPointerDown, onPointerMove, onPointerUp, onStageKeydown, updateTextSession, commitTextSession, cancelTextSession, textInputStyle, mapTouchPan }
}
