import { nextTick, onBeforeUnmount, onMounted, ref, unref, watch } from 'vue'
import type { Ref } from 'vue'
import { DETAILS_EDGE_MARGIN, detailsPlacementLimits } from '../utils/detailsPlacementBounds.ts'

export interface PanelPosition {
  left: number
  top: number
}

export interface ClampedPlacement {
  left: number
  top: number
  maxHeight: number
}

interface DragSession {
  pointerId: number | null
  dx: number
  dy: number
}

const EDGE_MARGIN = DETAILS_EDGE_MARGIN
const MIN_PANEL_WIDTH = 240

export interface DetailsPlacementOptions {
  isActive: () => boolean
  hostEl: Ref<HTMLElement | null>
  panelEl: Ref<HTMLElement | null>
  boundsEl?: Ref<HTMLElement | null> | null
  initialSide?: Ref<'left' | 'right' | null> | 'left' | 'right' | null
  initialVertical?: Ref<'top' | 'bottom'> | 'top' | 'bottom'
}

export function usePlaybackDetailsPlacement({
  isActive,
  hostEl,
  panelEl,
  boundsEl = null,
  initialSide = null,
  initialVertical = 'top',
}: DetailsPlacementOptions) {
  const pos = ref<PanelPosition | null>(null)
  const maxPanelHeight = ref<number | null>(null)
  const maxPanelWidth = ref<number | null>(null)
  const userPositioned = ref(false)

  let session: DragSession | null = null

  /**
   * 把一组候选坐标夹进当前可用矩形。
   * `panelWidth`：已决定但 DOM 尚未应用的宽度（初始落位收窄时），缺省用实测宽度。
   * @returns {{left:number, top:number, maxHeight:number}|null} 尺寸不可测量时为 null
   */
  function clampToBounds(left: number, top: number, panelWidth: number | null = null): ClampedPlacement | null {
    const host = hostEl.value
    const panel = panelEl.value
    if (!host || !panel) return null
    const hostRect = host.getBoundingClientRect()
    const measured = panel.getBoundingClientRect()
    if (!hostRect.width || !hostRect.height) return null
    if (!measured.width || !measured.height) return null
    const rect = { width: panelWidth ?? measured.width, height: measured.height }
    const hostStyle = typeof getComputedStyle === 'function' ? getComputedStyle(host) : null
    const padStart = parseFloat(hostStyle?.paddingLeft ?? '') || 0
    const bounds = boundsEl?.value
    let transportTop: number | null = null
    if (bounds) {
      const boundsRect = bounds.getBoundingClientRect()
      if (boundsRect.height > 0) transportTop = boundsRect.top - hostRect.top
    }
    const limits = detailsPlacementLimits({
      hostWidth: hostRect.width,
      hostHeight: hostRect.height,
      paddingLeft: padStart,
      paddingRight: parseFloat(hostStyle?.paddingRight ?? '') || 0,
      paddingTop: parseFloat(hostStyle?.paddingTop ?? '') || 0,
      panelWidth: rect.width,
      panelHeight: rect.height,
      transportTop,
    })
    return {
      left: Math.round(Math.min(Math.max(left, limits.minLeft), limits.maxLeft)),
      top: Math.round(Math.min(Math.max(top, limits.minTop), limits.maxTop)),
      maxHeight: limits.maxHeight,
    }
  }

  function apply(next: ClampedPlacement | null): void {
    if (!next) return
    pos.value = { left: next.left, top: next.top }
    maxPanelHeight.value = next.maxHeight
  }

  function clampIntoHost(): void {
    if (!pos.value) return
    apply(clampToBounds(pos.value.left, pos.value.top))
  }

  function placeInitial(origin: { x: number } | null = null): void {
    if (userPositioned.value) return
    const host = hostEl.value
    const panel = panelEl.value
    if (!host || !panel) return
    const hostRect = host.getBoundingClientRect()
    const rect = panel.getBoundingClientRect()
    if (!hostRect.width || !rect.width) return
    let side: 'left' | 'right' | null = unref(initialSide) ?? null
    if (origin && Number.isFinite(origin.x)) {
      side = origin.x > hostRect.width / 2 ? 'left' : 'right'
    }
    const gutter = EDGE_MARGIN * 2
    const padStart = parseFloat(getComputedStyle?.(host)?.paddingLeft ?? '') || 0
    const room = side ? sideRoom(side, hostRect, gutter, padStart) : null
    maxPanelWidth.value = room
    const width = room == null ? rect.width : Math.min(rect.width, room)
    const left = side === 'right'
      ? hostRect.width - width - gutter
      : gutter + padStart
    const top = unref(initialVertical) === 'bottom' ? Number.MAX_SAFE_INTEGER : EDGE_MARGIN * 2
    const next = clampToBounds(left, top, width)
    if (next) {
      apply(next)
    }
  }

  function sideRoom(
    side: 'left' | 'right',
    hostRect: DOMRect,
    gutter: number,
    padStart: number,
  ): number | null {
    const bounds = boundsEl?.value
    if (!bounds) return null
    const center = bounds.getBoundingClientRect()
    if (!center.width || !center.height) return null
    const room = side === 'right'
      ? hostRect.width - gutter - (center.right - hostRect.left + EDGE_MARGIN)
      : (center.left - hostRect.left - EDGE_MARGIN) - (gutter + padStart)
    return room >= MIN_PANEL_WIDTH ? Math.floor(room) : null
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button != null && event.button !== 0) return
    const panel = panelEl.value
    if (!panel) return
    event.preventDefault?.()
    const rect = panel.getBoundingClientRect()
    session = {
      pointerId: event.pointerId,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
    }
    try {
      const currentTarget = event.currentTarget as Element | null
      currentTarget?.setPointerCapture?.(event.pointerId)
    } catch {
      /* 无捕获能力（测试环境 / 老浏览器）时 window 监听已经足够 */
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  }

  function onPointerMove(event: PointerEvent): void {
    if (!session || (session.pointerId != null && event.pointerId !== session.pointerId)) return
    const host = hostEl.value
    if (!host) return
    const hostRect = host.getBoundingClientRect()
    const next = clampToBounds(event.clientX - hostRect.left - session.dx, event.clientY - hostRect.top - session.dy)
    if (!next) return
    apply(next)
    userPositioned.value = true
  }

  function onPointerUp(): void {
    session = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    if (pos.value) userPositioned.value = true
  }

  let panelObserver: ResizeObserver | null = null
  let hostObserver: ResizeObserver | null = null
  onMounted(() => {
    if (isActive()) nextTick(() => placeInitial())
    if (typeof ResizeObserver === 'function') {
      if (panelEl.value) {
        panelObserver = new ResizeObserver(clampIntoHost)
        panelObserver.observe(panelEl.value)
      }
      if (hostEl.value) {
        hostObserver = new ResizeObserver(() => {
          if (pos.value == null) return
          if (userPositioned.value) clampIntoHost()
          else placeInitial()
        })
        hostObserver.observe(hostEl.value)
        if (boundsEl?.value) hostObserver.observe(boundsEl.value)
      }
    }
  })
  onBeforeUnmount(() => {
    panelObserver?.disconnect()
    panelObserver = null
    hostObserver?.disconnect()
    hostObserver = null
    session = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
  })

  function onSelectionChange(): void {
    if (userPositioned.value || pos.value == null) return
    nextTick(() => placeInitial())
  }

  watch(() => !!isActive(), (active) => {
    if (!active) {
      pos.value = null
      maxPanelHeight.value = null
      maxPanelWidth.value = null
      userPositioned.value = false

      return
    }
    nextTick(() => placeInitial())
  })

  return { pos, maxPanelHeight, maxPanelWidth, userPositioned, clampIntoHost, placeInitial, onSelectionChange, onPointerDown, hostEl, boundsEl, panelEl }
}
