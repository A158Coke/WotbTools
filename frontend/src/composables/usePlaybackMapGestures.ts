import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { zoomViewAt } from '../utils/battlePlayback.js'
import type { PlaybackCamera } from './usePlaybackCamera.js'

/** 标注绘制侧与手势状态机交互的最小接口（owner 仍在标注编辑器）。 */
export interface GestureDrawingHooks {
  /** 当前是否处于标注工具激活状态（null = 非标注模式）。 */
  activeTool: () => string | null
  /** 正在绘制的 pointerId（null = 无绘制会话）。 */
  drawingPointerId: () => number | null
  /** 绘制起点的 client 坐标（select 拖动阈值判定用）。 */
  drawingStartScreen: () => { x: number; y: number } | null
  /** 标注模式是否打开（viewport click 分支判定）。 */
  annotationOpen: () => boolean
  /** 当前选中的标注下标（-1 = 无；select 模式 stationary tap 交给车辆检视）。 */
  selectedAnnotationIndex: () => number
  startDrawing: (e: PointerEvent) => void
  moveDrawing: (e: PointerEvent) => void
  endDrawing: () => void
  cancelDrawing: () => void
  /** 绘制会话结束（cancel/finish）后由手势侧清空 pointerId。 */
  clearDrawingPointer: () => void
}

/**
 * 2D 回放地图手势状态机（#820 Agent C 拆分）：pointer/pan/pinch/wheel 的**唯一 owner**。
 *
 * - pointer capture + touch 多指语义保持原实现：单指 pan、双指 pinch、捏合结束剩单指续 pan；
 * - 手势结束后的首个 click 必须被吞掉（suppressClick），纯点击车辆仍正常选中；
 * - wheel 只在用户明确与地图交互时生效（审计 PB-04 cooperative gestures），否则提示；
 * - 标注激活时单指转入绘制（回调到标注编辑器），双指仍保留地图捏合；
 *   第二根手指落下时取消绘制会话，避免落下意外标记/路线点。
 *
 * 相机状态（view/applyView/fitScale）由 usePlaybackCamera 唯一持有，本 composable 只消费。
 */
export function usePlaybackMapGestures(
  camera: PlaybackCamera,
  mapEl: Ref<HTMLElement | null>,
  hooks: {
    isFullscreen: () => boolean
    drawing: GestureDrawingHooks
    /** 标注 select 模式下点击未标记车辆空间 → 检视回放车辆（stationary tap）。 */
    selectAtPointer: (clientX: number | undefined, clientY: number | undefined) => void
    /** 非标注模式下的普通视口点击（mobile overlay reveal）。 */
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
  // 当前交互是否为真实手势（单指拖动超阈值 / 双指捏合距离或中点移动超阈值）：
  // 手势结束后的首个 click 必须被吞掉，纯点击车辆仍正常选中
  let gestureMoved = false

  /** 滚轮缩放只在用户明确与地图交互时生效（审计 PB-04，同 Google Maps 的 cooperative gestures）：
   * 全屏、按住 Ctrl / ⌘、或刚在地图上按下过指针（直到指针离开地图）。否则让页面正常滚动，并短暂提示。 */
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

  /** 审计 PB-01：地图未放大、非全屏、未在标注时，单指纵向滑动交给页面滚动。 */
  const mapTouchPan = computed(() => !hooks.isFullscreen() && !hooks.drawing.activeTool() && camera.view.scale <= camera.fitScale() + 1e-3)

  function onWheel(e: WheelEvent) {
    if (!(hooks.isFullscreen() || e.ctrlKey || e.metaKey || mapEngaged.value)) {
      showWheelHint()
      return
    }
    e.preventDefault()
    wheelHintVisible.value = false
    const p = camera.screenPoint(e.clientX, e.clientY)
    // 缩放下限 = 完整地图 fit scale：放大后再缩小能回到原始完整视图，不会卡在 1x。
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
    // 鼠标在地图上按下拖动（平移 / 画标注）不能变成浏览器的文本 / 图片选择——否则拖过的车辆标记与
    // 名牌会被选中成一片蓝色色块。只拦鼠标主键：触屏的滚动 / 捏合由 touch-action 决定，click 照常触发。
    if (e.button != null && e.button !== 0) return
    if (e.pointerType === 'mouse' && e.button === 0) e.preventDefault()
    // preventDefault keeps the last toolbar button focused. Move keyboard ownership to the
    // map after a map gesture so Enter/Escape/Delete reach the editor, not that old button.
    const target = e.currentTarget as HTMLElement | null
    target?.focus?.({ preventScroll: true })
    mapEngaged.value = true
    suppressClick = false
    gestureMoved = false
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    // 指针捕获（受支持时）：指针移出地图仍持续收到 move/up；不支持的环境走 window 级兜底
    const downTarget = e.target as Element | null
    try {
      if (downTarget && typeof downTarget.setPointerCapture === 'function') {
        downTarget.setPointerCapture(e.pointerId)
      }
    } catch {
      // 某些测试环境不支持指针捕获，忽略
    }
    // 标注编辑：单指走选择/绘制，双指仍保留地图捏合。
    if (hooks.drawing.activeTool() && pointers.size === 1) {
      hooks.drawing.startDrawing(e)
      return
    }
    // 第二根手指转入捏合，取消当前手势，避免落下意外标记/路线点。
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
        // 锚点 = 双指中点相对地图容器的屏幕坐标（zoomViewAt 契约）
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
        // 两指中点整体移动 = 屏幕平移（translate 单位为屏幕像素，直接加 client 位移）
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
      // 捏合结束剩下一根手指：以该手指为新基线继续平移，状态不卡死
      const [p] = [...pointers.values()]
      panStart = { x: p!.x, y: p!.y, tx: camera.view.tx, ty: camera.view.ty, moved: false }
    }
  }

  /** 拖动/捏合结束后吞掉随之而来的 click 避免误选车；未拖动的点击正常到达车辆按钮。 */
  function onViewportClick(e: MouseEvent) {
    const annotationOpen = hooks.drawing.annotationOpen()
    if (annotationOpen || suppressClick) {
      // Select mode owns annotation picking first; a stationary tap on unmarked
      // vehicle space may inspect the replay vehicle. Drawing/dragging never does.
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
