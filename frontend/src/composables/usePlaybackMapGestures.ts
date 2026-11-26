import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { zoomViewAt } from '../utils/battlePlayback.js'
import type { PlaybackCamera } from './usePlaybackCamera.js'

export interface GestureDrawingHooks {
  activeTool: () => string | null
  drawingPointerId: () => number | null
  drawingStartScreen: () => { x: number; y: number } | null
  annotationOpen: () => boolean
  selectedAnnotationIndex: () => number
  startDrawing: (e: PointerEvent) => void
  moveDrawing: (e: PointerEvent) => void
  endDrawing: () => void
  cancelDrawing: () => void
  clearDrawingPointer: () => void
}

export function usePlaybackMapGestures(
  camera: Pick<PlaybackCamera, 'view' | 'applyView' | 'screenPoint' | 'fitScale'>,
  mapEl: Ref<HTMLElement | null>,
  hooks: {
    isFullscreen: () => boolean
    drawing: GestureDrawingHooks
    selectAtPointer: (clientX: number | undefined, clientY: number | undefined) => void
    onPlainClick: () => void
  },
) {
  const PAN_THRESHOLD_PX = 5
  const PINCH_THRESHOLD_PX = 5
  const ZOOM_STEP = 1.2

  const pointers = new Map<number, { x: number; y: number }>()
  let panStart: { x: number; y: number; tx: number; ty: number; moved: boolean } | null = null
  let pinchStart: {
    mid: { x: number; y: number }
    dist: number
    anchorScreen: { x: number; y: number }
    scale: number
    tx: number
    ty: number
    moved: boolean
  } | null = null
  let suppressClick = false
  let gestureMoved = false

  const mapEngaged = ref(false)
  const wheelHintVisible = ref(false)
  let wheelHintTimer: ReturnType<typeof setTimeout> | null = null
  function showWheelHint() {
    wheelHintVisible.value = true
    if (wheelHintTimer != null) clearTimeout(wheelHintTimer)
    wheelHintTimer = setTimeout(() => { wheelHintVisible.value = false; wheelHintTimer = null }, 1500)
  }
  function onMapPointerLeave() { mapEngaged.value = false }

  watch(() => mapEl.value, (el, prev) => {
    if (prev) prev.removeEventListener('pointerleave', onMapPointerLeave)
    if (el) el.addEventListener('pointerleave', onMapPointerLeave)
  })

  const mapTouchPan = computed(() => !hooks.isFullscreen() && !hooks.drawing.activeTool() && camera.view.scale <= camera.fitScale() + 1e-3)

  function onWheel(e: WheelEvent) {
    if (!(hooks.isFullscreen() || e.ctrlKey || e.metaKey || mapEngaged.value)) {
      showWheelHint()
      return
    }
    e.preventDefault()
    wheelHintVisible.value = false
    const p = camera.screenPoint(e.clientX, e.clientY)
    camera.applyView(
      zoomViewAt(camera.view, p.x, p.y, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, camera.fitScale()),
      true,
    )
  }

  function pinchInfo() {
    const [a, b] = [...pointers.values()]
    const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 }
    return { mid, dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) }
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button != null && e.button !== 0) return
    if (e.pointerType === 'mouse' && e.button === 0) e.preventDefault()
    const target = e.currentTarget as HTMLElement | null
    target?.focus?.({ preventScroll: true })
    mapEngaged.value = true
    suppressClick = false
    gestureMoved = false
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const downTarget = e.target as Element | null
    try {
      if (downTarget && typeof downTarget.setPointerCapture === 'function') {
        downTarget.setPointerCapture(e.pointerId)
      }
    } catch {
      // 某些测试环境不支持指针捕获，忽略
    }
    if (hooks.drawing.activeTool() && pointers.size === 1) {
      hooks.drawing.startDrawing(e)
      return
    }
    if (hooks.drawing.drawingPointerId() != null && pointers.size === 2) {
      hooks.drawing.cancelDrawing()
      hooks.drawing.clearDrawingPointer()
    }
    if (pointers.size === 1) {
      panStart = { x: e.clientX, y: e.clientY, tx: camera.view.tx, ty: camera.view.ty, moved: false }
    } else if (pointers.size === 2) {
      const info = pinchInfo()
      pinchStart = {
        mid: info.mid,
        dist: info.dist,
        anchorScreen: camera.screenPoint(info.mid.x, info.mid.y),
        scale: camera.view.scale,
        tx: camera.view.tx,
        ty: camera.view.ty,
        moved: false,
      }
      panStart = null
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (hooks.drawing.drawingPointerId() === e.pointerId && hooks.drawing.activeTool()) {
      const start = hooks.drawing.drawingStartScreen()
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > PAN_THRESHOLD_PX) gestureMoved = true
      hooks.drawing.moveDrawing(e)
      return
    }
    if (pointers.size === 2 && pinchStart) {
      const { mid, dist } = pinchInfo()
      if (!pinchStart.moved
          && (Math.abs(dist - pinchStart.dist) > PINCH_THRESHOLD_PX
              || Math.hypot(mid.x - pinchStart.mid.x, mid.y - pinchStart.mid.y) > PINCH_THRESHOLD_PX)) {
        pinchStart.moved = true
        gestureMoved = true
      }
      if (pinchStart.dist > 0 && dist > 0) {
        const next = zoomViewAt(
          { scale: pinchStart.scale, tx: pinchStart.tx, ty: pinchStart.ty },
          pinchStart.anchorScreen.x, pinchStart.anchorScreen.y, dist / pinchStart.dist,
          camera.fitScale(),
        )
        next.tx += mid.x - pinchStart.mid.x
        next.ty += mid.y - pinchStart.mid.y
        camera.applyView(next, true)
      }
      return
    }
    if (pointers.size === 1 && panStart) {
      const dx = e.clientX - panStart.x
      const dy = e.clientY - panStart.y
      if (!panStart.moved && Math.hypot(dx, dy) < PAN_THRESHOLD_PX) return
      panStart.moved = true
      gestureMoved = true
      camera.applyView({ scale: camera.view.scale, tx: panStart.tx + dx, ty: panStart.ty + dy }, true)
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!pointers.delete(e.pointerId)) return
    const upTarget = e.target as Element | null
    try {
      if (upTarget && typeof upTarget.releasePointerCapture === 'function') {
        upTarget.releasePointerCapture(e.pointerId)
      }
    } catch {
      // 忽略（无捕获或已释放）
    }
    if (hooks.drawing.drawingPointerId() === e.pointerId) {
      const blockClick = gestureMoved || e.type === 'pointercancel'
      if (e.type === 'pointercancel') hooks.drawing.cancelDrawing()
      else hooks.drawing.endDrawing()
      hooks.drawing.clearDrawingPointer()
      if (pointers.size === 0) {
        panStart = null
        pinchStart = null
        gestureMoved = false
        suppressClick = blockClick
      }
      return
    }
    if (gestureMoved) suppressClick = true
    if (pointers.size < 2) pinchStart = null
    if (pointers.size === 0) {
      panStart = null
      gestureMoved = false
    } else if (pointers.size === 1 && pinchStart == null && panStart == null) {
      const [p] = [...pointers.values()]
      panStart = { x: p!.x, y: p!.y, tx: camera.view.tx, ty: camera.view.ty, moved: false }
    }
  }

  function onViewportClick(e: MouseEvent) {
    const annotationOpen = hooks.drawing.annotationOpen()
    if (annotationOpen || suppressClick) {
      if (annotationOpen && hooks.drawing.activeTool() === 'select' && hooks.drawing.selectedAnnotationIndex() < 0 && !suppressClick) {
        hooks.selectAtPointer(e.clientX, e.clientY)
      }
      suppressClick = false
      e.stopPropagation()
      e.preventDefault()
      return
    }
    hooks.onPlainClick()
  }

  function resetGestureState() {
    pointers.clear()
    panStart = null
    pinchStart = null
    gestureMoved = false
    suppressClick = false
  }

  onMounted(() => {
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  })

  onBeforeUnmount(() => {
    if (wheelHintTimer != null) clearTimeout(wheelHintTimer)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    resetGestureState()
  })

  return {
    mapEngaged,
    wheelHintVisible,
    mapTouchPan,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onViewportClick,
    onMapPointerLeave,
    resetGestureState,
  }
}
