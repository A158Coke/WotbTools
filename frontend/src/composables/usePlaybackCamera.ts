import { computed, reactive, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { clampViewPan } from '../utils/battlePlayback.js'

export interface PlaybackMapViewLike {
  W: number
  H: number
  toX(x: number): number
  toY(y: number): number
  fromX?(x: number): number | null
  fromY?(y: number): number | null
  renderBounds?: { xMin: number; xMax: number; yMin: number; yMax: number } | null
}

export interface PlaybackCameraHost {
  mapComponent: Ref<PlaybackMapBridge | null>
  mapStageEl: Ref<HTMLElement | null>
  isFullscreen: () => boolean
  wideLayout: () => boolean
  isMobileDevice: () => boolean
}

export interface PlaybackMapBridge {
  mapEl?: HTMLElement | null
  textInputRef?: { focus(opts?: { preventScroll?: boolean }): void } | null
}

export function usePlaybackCamera(
  mapView: Ref<PlaybackMapViewLike>,
  host: PlaybackCameraHost,
) {
  const mapComponent = host.mapComponent
  const mapStageEl = host.mapStageEl
  const mapEl = computed(() => mapComponent.value?.mapEl || null)

  const mapSize = ref({ w: 0, h: 0 })
  let mapResizeObserver: ResizeObserver | null = null
  function mapWidth() {
    return mapSize.value.w || (mapEl.value ? mapEl.value.clientWidth : 0)
  }
  function mapHeight() {
    return mapSize.value.h || (mapEl.value ? mapEl.value.clientHeight : 0)
  }

  function mapRenderRect() {
    const width = mapWidth()
    const ratio = mapView.value.H / mapView.value.W
    return { left: 0, top: 0, width, height: width * ratio }
  }

  const view = reactive({ scale: 1, tx: 0, ty: 0 })
  let cameraUserModified = false

  function applyView(next: { scale: number; tx: number; ty: number }, userGesture = false) {
    const stageW = mapWidth()
    const fullH = mapStageEl.value ? mapStageEl.value.clientHeight : mapHeight()
    const safeH = Math.max(0, fullH)
    const rect = mapRenderRect()
    const clamped = clampViewPan(next, stageW, safeH, rect.width, rect.height)
    if (userGesture && (clamped.scale !== view.scale || clamped.tx !== view.tx || clamped.ty !== view.ty)) {
      cameraUserModified = true
    }
    view.scale = clamped.scale
    view.tx = clamped.tx
    view.ty = clamped.ty
  }

  const viewportStyle = computed(() => [
    `transform: translate(${view.tx}px, ${view.ty}px)`,
    `width: ${view.scale * 100}%`,
  ])

  const markerTransform = computed(() => `translate(-50%, -50%)`)
  const overlayInverse = computed(() => 1 / view.scale)
  const overlayInverseScale = computed(() => `scale(${overlayInverse.value})`)

  function screenPoint(clientX: number, clientY: number) {
    const rect = mapEl.value ? mapEl.value.getBoundingClientRect() : { left: 0, top: 0 }
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  const FIT_MARGIN = 0.98

  function fitScale() {
    const stageW = mapWidth()
    const fullH = mapStageEl.value ? mapStageEl.value.clientHeight : mapHeight()
    const safeH = Math.max(0, fullH)
    const rect = mapRenderRect()
    if (stageW > 0 && safeH > 0 && rect.width > 0 && rect.height > 0) {
      return Math.min(stageW / rect.width, safeH / rect.height) * FIT_MARGIN
    }
    return 1
  }

  function resetView() {
    cameraUserModified = false
    const stageW = mapWidth()
    const fullH = mapStageEl.value ? mapStageEl.value.clientHeight : mapHeight()
    const safeH = Math.max(0, fullH)
    const rect = mapRenderRect()
    if (stageW > 0 && safeH > 0 && rect.width > 0 && rect.height > 0) {
      const scale = fitScale()
      const tx = (stageW - rect.width * scale) / 2
      const ty = (safeH - rect.height * scale) / 2
      applyView({ scale, tx, ty })
      return
    }
    applyView({ scale: 1, tx: 0, ty: 0 })
  }

  let lastFitSignature = ''
  function fitViewIfReady(force = false) {
    if (force) lastFitSignature = ''
    const stageW = mapWidth()
    const fullH = mapStageEl.value ? mapStageEl.value.clientHeight : mapHeight()
    const safeH = Math.max(0, fullH)
    const rect = mapRenderRect()
    if (stageW <= 0 || safeH <= 0 || rect.width <= 0 || rect.height <= 0) return
    const signature = [host.isFullscreen(), host.wideLayout(), host.isMobileDevice(), stageW, safeH, rect.width, rect.height].join('|')
    if (!force && signature === lastFitSignature) return
    lastFitSignature = signature
    if (!cameraUserModified) resetView()
  }

  watch(() => mapEl.value, (el) => {
    if (!el || mapResizeObserver) return
    if (typeof ResizeObserver === 'function') {
      mapResizeObserver = new ResizeObserver((entries) => {
        for (const e of entries || []) {
          if (e && e.target === el) {
            mapSize.value = { w: e.contentRect.width, h: e.contentRect.height }
          }
        }
        fitViewIfReady()
      })
      mapResizeObserver.observe(el)
      if (mapStageEl.value) mapResizeObserver.observe(mapStageEl.value)
    }
  })

  function disposeCamera() {
    if (mapResizeObserver) {
      mapResizeObserver.disconnect()
      mapResizeObserver = null
    }
  }

  return {
    mapEl,
    mapSize,
    mapWidth,
    mapHeight,
    mapRenderRect,
    view,
    applyView,
    viewportStyle,
    markerTransform,
    overlayInverse,
    overlayInverseScale,
    screenPoint,
    fitScale,
    resetView,
    fitViewIfReady,
    disposeCamera,
  }
}

export type PlaybackCamera = ReturnType<typeof usePlaybackCamera>
