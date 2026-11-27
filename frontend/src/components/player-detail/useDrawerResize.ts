import { computed, onUnmounted, ref, watch } from 'vue'
import type { ComputedRef } from 'vue'

const DRAWER_MIN = 320
const DRAWER_DEFAULT = 380
const DRAWER_TABLET = 360
const DRAWER_MAX_RATIO = 0.45
const DRAWER_WIDTH_KEY = 'radarSidePanelWidth'

/** @param {{ open: import('vue').ComputedRef<boolean> }} ctx */
export function useDrawerResize({ open }: { open: ComputedRef<boolean> }) {
  const isMobile = ref(typeof window !== 'undefined' ? window.innerWidth < 768 : false)
  const isDesktop = ref(typeof window !== 'undefined' ? window.innerWidth >= 1200 : true)
  const drawerWidth = ref(DRAWER_DEFAULT)
  const isResizing = ref(false)
  const resizeStartX = ref(0)
  const resizeStartWidth = ref(0)
  const resizeHandle = ref<HTMLElement | null>(null)

  function drawerMaxWidth() {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
    return Math.max(DRAWER_MIN, Math.min(Math.floor(vw * DRAWER_MAX_RATIO), vw - 16))
  }
  function clampDrawerWidth(w: number) {
    return Math.max(DRAWER_MIN, Math.min(drawerMaxWidth(), w))
  }
  function loadDrawerWidth() {
    try {
      const raw = localStorage.getItem(DRAWER_WIDTH_KEY)
      if (raw == null) return DRAWER_DEFAULT
      const n = Number(raw)
      return Number.isFinite(n) ? clampDrawerWidth(n) : DRAWER_DEFAULT
    } catch (_) {
      return DRAWER_DEFAULT
    }
  }
  function saveDrawerWidth(w: number) {
    try { localStorage.setItem(DRAWER_WIDTH_KEY, String(w)) } catch (_) { /* 忽略持久化失败 */ }
  }
  function applyDrawerWidth(w: number) {
    drawerWidth.value = clampDrawerWidth(w)
  }
  function setDrawerWidth(w: number) {
    applyDrawerWidth(w)
    saveDrawerWidth(drawerWidth.value)
  }

  function onResizeStart(e: PointerEvent) {
    if (!isDesktop.value || !open.value) return
    e.preventDefault()
    resizeStartX.value = e.clientX
    resizeStartWidth.value = drawerWidth.value
    isResizing.value = true
    const h = resizeHandle.value
    if (h && typeof h.setPointerCapture === 'function') {
      try { h.setPointerCapture(e.pointerId) } catch (_) { /* happy-dom 无 Pointer Capture */ }
    }
    document.body.style.userSelect = 'none'
    document.body.classList.add('pd-resizing')
  }
  function onResizeMove(e: PointerEvent) {
    if (!isResizing.value) return
    applyDrawerWidth(resizeStartWidth.value + (resizeStartX.value - e.clientX))
  }
  function onResizeEnd() {
    if (!isResizing.value) return
    isResizing.value = false
    saveDrawerWidth(drawerWidth.value)
    document.body.style.userSelect = ''
    document.body.classList.remove('pd-resizing')
  }
  function onResizeKey(delta: number) {
    if (!isDesktop.value) return
    setDrawerWidth(drawerWidth.value + delta)
  }

  const panelWidth = computed(() => {
    if (isMobile.value) return null
    return isDesktop.value ? drawerWidth.value : DRAWER_TABLET
  })

  const workspaceOffset = computed(() =>
    open.value && panelWidth.value ? (panelWidth.value + 8) + 'px' : '0px')
  watch([panelWidth, open], () => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--pd-drawer-offset', workspaceOffset.value)
    }
  }, { immediate: true })

  function updateViewport() {
    const w = window.innerWidth
    isMobile.value = w < 768
    isDesktop.value = w >= 1200
    drawerWidth.value = clampDrawerWidth(drawerWidth.value)
  }
  function bindMobile() { updateViewport(); window.addEventListener('resize', updateViewport) }
  function unbindMobile() { window.removeEventListener('resize', updateViewport) }
  onUnmounted(unbindMobile)

  return {
    drawerMinWidth: DRAWER_MIN,
    isMobile, isDesktop,
    drawerWidth, isResizing, resizeHandle, drawerMaxWidth,
    loadDrawerWidth, setDrawerWidth, bindMobile,
    onResizeStart, onResizeMove, onResizeEnd, onResizeKey,
    panelWidth,
  }
}
