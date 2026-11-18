import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { clampViewPan, zoomViewAt } from '../utils/battlePlayback.js'
import { usePaneFillHeight } from './usePaneFillHeight.js'
import { usePlaybackFullscreen } from './usePlaybackFullscreen.js'
import { usePlaybackPhoneForm } from './usePlaybackPhoneForm.js'
import type { ComputedRef, Ref } from 'vue'
import type { PlaybackMapViewLike } from './usePlaybackCamera.js'

type View = { scale: number; tx: number; ty: number }
type MapImage = { width: number; height: number }
type ElementRef = Ref<HTMLElement | null>
type CameraOptions = {
  props: { active: boolean }
  rootEl: ElementRef
  stageEl: ElementRef
  squareEl: ElementRef
  controlsEl: ElementRef
  mapComponent: Ref<{ mapEl?: HTMLElement | null } | null>
  image: ComputedRef<MapImage | null>
  mapView: ComputedRef<PlaybackMapViewLike>
}

export function useMapPreview2DCamera({ props, rootEl, stageEl, squareEl, controlsEl, mapComponent, image, mapView }: CameraOptions) {
  /** Use BattleMap's actual map element: on wide layouts it is narrower than the stage. */
  const mapEl = computed(() => mapComponent.value?.mapEl || null)
  const { height: stageHeight } = usePaneFillHeight(rootEl)
  const { isPhone } = usePlaybackPhoneForm()
  const { isFullscreen, fullscreenSupported, toggleFullscreen } = usePlaybackFullscreen({
    target: () => rootEl.value,
    isPhone,
    isActive: () => props.active,
  })
  watch(() => props.active, (active) => {
    if (!active && isFullscreen.value) toggleFullscreen()
  })
  const view = reactive({ scale: 1, tx: 0, ty: 0 })
  const ZOOM_STEP = 1.2
  const PAN_THRESHOLD_PX = 5
  const FIT_MARGIN = 0.98
  /** Mobile uses available width, mobile fullscreen reserves toolbar height, desktop fits the stage. */
  const squareSide = ref(0)
  function measureSquare() {
    const w = stageEl.value?.clientWidth || 0
    const h = stageEl.value?.clientHeight || 0
    if (isPhone.value && isFullscreen.value) {
      const fill = Number.parseFloat(stageHeight.value) || 0
      const budget = fill - (controlsEl.value?.offsetHeight || 0)
      squareSide.value = w > 0 ? Math.floor(Math.min(w, Math.max(budget, 160))) : 0
      return
    }
    if (isPhone.value) {
      squareSide.value = w > 0 ? Math.floor(w) : 0
      return
    }
    squareSide.value = w > 0 && h > 0 ? Math.floor(Math.min(w, h)) : 0
  }

  function mapWidth() {
    return mapEl.value ? mapEl.value.clientWidth : 0
  }
  function mapHeight() {
    return mapEl.value ? mapEl.value.clientHeight : 0
  }
  function stageWidth() {
    return squareEl.value ? squareEl.value.clientWidth : (stageEl.value ? stageEl.value.clientWidth : 0)
  }
  function stageHeightPx() {
    return squareEl.value ? squareEl.value.clientHeight : (stageEl.value ? stageEl.value.clientHeight : 0)
  }
  function renderRect() {
    const width = mapWidth()
    const ratio = mapView.value.H / mapView.value.W
    return { width, height: width * ratio }
  }
  function fitScale() {
    const stageW = stageWidth()
    const stageH = stageHeightPx()
    const rect = renderRect()
    if (stageW > 0 && stageH > 0 && rect.width > 0 && rect.height > 0) {
      return Math.min(stageW / rect.width, stageH / rect.height) * FIT_MARGIN
    }
    return 1
  }
  function applyView(next: View) {
    // Clamp to the stage while measuring the rendered map element.
    const clamped = clampViewPan(next, stageWidth(), stageHeightPx(), renderRect().width, renderRect().height)
    view.scale = clamped.scale
    view.tx = clamped.tx
    view.ty = clamped.ty
  }
  function fitView() {
    const stageW = stageWidth()
    const stageH = stageHeightPx()
    const rect = renderRect()
    if (stageW > 0 && stageH > 0 && rect.width > 0 && rect.height > 0) {
      const scale = fitScale()
      applyView({ scale, tx: (stageW - rect.width * scale) / 2, ty: (stageH - rect.height * scale) / 2 })
      return
    }
    applyView({ scale: 1, tx: 0, ty: 0 })
  }
  const fitObserved = ref(false)
  let mapSizeObserver: ResizeObserver | null = null
  watch(mapEl, (el, prev) => {
    if (prev && mapSizeObserver) mapSizeObserver.unobserve(prev)
    if (el && mapSizeObserver) mapSizeObserver.observe(el)
    // A new map element needs a fresh fit after its real dimensions become available.
    fitObserved.value = false
  }, { flush: 'post' })
  watch(stageHeight, measureSquare, { flush: 'post' })
  watch(isFullscreen, () => nextTick(measureSquare), { flush: 'post' })
  onMounted(() => {
    measureSquare()
    if (typeof ResizeObserver === 'function') {
      let lastValidSide = 0
      mapSizeObserver = new ResizeObserver(() => {
        const prevSide = lastValidSide
        measureSquare()
        // A v-show-hidden pane reports zero; preserve the last valid size and view.
        if (!squareSide.value) return
        const firstValid = prevSide === 0
        const sideChanged = !firstValid && squareSide.value !== prevSide
        lastValidSide = squareSide.value
        // Refit a newly loaded map even when its dimensions match the previous image.
        if (!firstValid && !sideChanged && fitObserved.value) return
        // Wait for Vue to commit the new square size before measuring and clamping.
        nextTick(() => {
          if (!squareSide.value) return
          if (!fitObserved.value) {
            // Keep the initial fit pending until the basemap element has a usable size.
            if (mapEl.value && mapEl.value.clientWidth > 0) {
              fitObserved.value = true
              fitView()
            }
            return
          }
          if (sideChanged) applyView(view)   // 保留用户 scale/tx/ty，按新边界 clamp
        })
      })
      if (mapEl.value) mapSizeObserver.observe(mapEl.value)
      if (stageEl.value) mapSizeObserver.observe(stageEl.value)
      // Fullscreen sizing depends on toolbar height.
      if (controlsEl.value) mapSizeObserver.observe(controlsEl.value)
    }
  })
  onBeforeUnmount(() => {
    mapSizeObserver?.disconnect()
    mapSizeObserver = null
  })
  watch([image, stageHeight], () => {
    if (!image.value) return
    if (!fitObserved.value && stageWidth() > 0) {
      fitObserved.value = true
      fitView()
    }
  }, { flush: 'post' })

  const viewportStyle = computed(() => [
    `transform: translate(${view.tx}px, ${view.ty}px)`,
    `width: ${view.scale * 100}%`,
  ])
  function screenPoint(clientX: number, clientY: number) {
    const rect = mapEl.value ? mapEl.value.getBoundingClientRect() : { left: 0, top: 0 }
    return { x: clientX - rect.left, y: clientY - rect.top }
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault()
    const p = screenPoint(e.clientX, e.clientY)
    applyView(zoomViewAt(view, p.x, p.y, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, fitScale()))
  }
  return { mapEl, stageHeight, isPhone, isFullscreen, fullscreenSupported, toggleFullscreen, view, squareSide, fitObserved, stageWidth, stageHeightPx, mapWidth, mapHeight, renderRect, fitScale, applyView, fitView, viewportStyle, screenPoint, onWheel, PAN_THRESHOLD_PX }
}
