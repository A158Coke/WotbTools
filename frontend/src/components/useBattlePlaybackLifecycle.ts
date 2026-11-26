import { inject, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, watch, type Ref } from 'vue'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'
import { isInteractiveTarget, usePlaybackTransport } from '../composables/usePlaybackTransport.js'

type LifecycleDeps = {
  props: { active: boolean }
  lifecycleVisible: Ref<boolean>
  wideLayout: Ref<boolean>
  playbackLifecycle: { active: boolean }
  pbRoot: Ref<HTMLElement | null>
  mapStageEl: Ref<HTMLElement | null>
  transportEl: Ref<HTMLElement | null>
  battlefieldWorkspaceEl: Ref<HTMLElement | null>
  isFullscreen: Ref<boolean>
  fitViewIfReady: (force: boolean) => void
  pause: () => void
  exitOwnedFullscreen: () => void
  disposeClock: () => void
  disposeCamera: () => void
  disposeMapPresentation: () => void
  annotationOpen: Ref<boolean>
  routePoints: Ref<unknown[]>
  draft: Ref<unknown>
  cancelRoute: () => void
  selectedAnnotation: Ref<unknown>
  selectedAnnotationIndex: Ref<number>
  closeAnnotation: () => void
  finishRoute: () => void
  deleteSelected: () => void
  redoAnnot: () => void
  undoAnnot: () => void
  setUiHidden: (hidden: boolean) => void
  duration: Ref<number>
  currentTime: Ref<number>
  playing: Ref<boolean>
  play: () => void
  step: (delta: number) => void
  seek: (time: number) => void
  uiHidden: Ref<boolean>
}

export function useBattlePlaybackLifecycle(deps: LifecycleDeps) {
  const {
    props, lifecycleVisible, wideLayout, playbackLifecycle,
    pbRoot, mapStageEl, transportEl, battlefieldWorkspaceEl, isFullscreen, fitViewIfReady,
    pause, exitOwnedFullscreen, disposeClock, disposeCamera, disposeMapPresentation,
    annotationOpen, routePoints, draft, cancelRoute, selectedAnnotation, selectedAnnotationIndex,
    closeAnnotation, finishRoute, deleteSelected, redoAnnot, undoAnnot, setUiHidden,
    duration, currentTime, playing, play, step, seek, uiHidden,
  } = deps
  let stageResizeObserver: ResizeObserver | null = null
  let wideLayoutQuery: MediaQueryList | null = null

  function onWideLayoutChange(event: MediaQueryListEvent) {
    wideLayout.value = !!(event && event.matches)
  }
function writeSquareAvailHeight() {
  const root = pbRoot.value
  if (!root) return
  const hud = root.querySelector('.pb-hud')
  const transport = transportEl.value
  const rootRect = root.getBoundingClientRect()
  const style = getComputedStyle(root)
  const viewportH = window.visualViewport?.height || window.innerHeight
  const pageStyle = getComputedStyle(document.documentElement)
  const headerH = parseFloat(pageStyle.getPropertyValue('--header-h')) || 0
  const top = isFullscreen.value ? 0 : headerH
  const workspaceH = Math.max(1, viewportH - top)
  root.style.setProperty('--pb-workspace-h', `${workspaceH}px`)
  const main = battlefieldWorkspaceEl.value
  const above = main ? Math.max(0, main.getBoundingClientRect().top - rootRect.top) : 0
  const content = transport?.closest?.('.pb-mobile-overlay-content')
  const controlsH = content?.getBoundingClientRect().height || transport?.getBoundingClientRect().height || 0
  const gap = parseFloat(style.getPropertyValue('--space-1')) || 4
  const bottom = parseFloat(style.paddingBottom) || 0
  const hudH = hud?.getBoundingClientRect().height || 0
  const budget = Math.max(1, workspaceH - above - hudH - controlsH - gap * 2 - bottom)
  root.style.setProperty('--pb-square-avail-h', `${Math.floor(budget)}px`)
}

const shellChrome = inject(SHELL_CHROME_KEY, null)
watch(() => shellChrome?.immersive.value, () => nextTick(() => { writeSquareAvailHeight(); fitViewIfReady(true) }))

watch(() => mapStageEl.value, (el) => {
  if (stageResizeObserver) { stageResizeObserver.disconnect(); stageResizeObserver = null }
  if (!el || typeof ResizeObserver !== 'function') return
  stageResizeObserver = new ResizeObserver(writeSquareAvailHeight)
  stageResizeObserver.observe(el)
  if (pbRoot.value) stageResizeObserver.observe(pbRoot.value)
  if (transportEl.value) stageResizeObserver.observe(transportEl.value)
  const hud = pbRoot.value?.querySelector('.pb-hud')
  if (hud) stageResizeObserver.observe(hud)
  writeSquareAvailHeight()
}, { immediate: true })
watch(transportEl, (el, previous) => {
  if (previous && stageResizeObserver) stageResizeObserver.unobserve(previous)
  if (el && stageResizeObserver) stageResizeObserver.observe(el)
  nextTick(writeSquareAvailHeight)
})

onMounted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    wideLayoutQuery = window.matchMedia('(min-width: 1200px)')
    wideLayout.value = !!wideLayoutQuery.matches
    if (typeof wideLayoutQuery.addEventListener === 'function') {
      wideLayoutQuery.addEventListener('change', onWideLayoutChange)
    }
  }
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', writeSquareAvailHeight)
})

function dragStart() {
  transport.scrubStart()
}

function dragEnd() {
  transport.scrubEnd()
}

onDeactivated(() => { lifecycleVisible.value = false; pause(); exitOwnedFullscreen() })
onActivated(() => { lifecycleVisible.value = true })
watch(() => props.active, (value) => { if (!value) { pause(); exitOwnedFullscreen() } })

const transport = usePlaybackTransport({
  isPlaying: () => playing.value,
  play: () => play(),
  pause: () => pause(),
  step: (delta) => step(delta),
  isAtEnd: () => duration.value > 0 && currentTime.value >= duration.value,
  restart: () => seek(0),
  isActive: () => props.active && lifecycleVisible.value,
}, { keyboard: false })

function onKeydown(e: KeyboardEvent) {
  if (!props.active || !lifecycleVisible.value || e.isComposing) return
  if (annotationOpen.value && !isInteractiveTarget(e.target as HTMLElement | null)) {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (routePoints.value.length || draft.value) cancelRoute()
      else if (selectedAnnotation.value) selectedAnnotationIndex.value = -1
      else closeAnnotation()
      return
    }
    if (e.key === 'Enter' && routePoints.value.length) { e.preventDefault(); finishRoute(); return }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redoAnnot() : undoAnnot(); return }
  }
  if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey && !isInteractiveTarget(e.target as HTMLElement | null)) {
    e.preventDefault()
    setUiHidden(!uiHidden.value)
    return
  }
  transport.handleKeydown(e)
}

onBeforeUnmount(() => {
  playbackLifecycle.active = false
  disposeMapPresentation()
  disposeClock()
  disposeCamera()
  if (stageResizeObserver) {
    stageResizeObserver.disconnect()
    stageResizeObserver = null
  }
  if (typeof document !== 'undefined') {
    if (pbRoot.value && pbRoot.value === document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      try {
        const exitResult = document.exitFullscreen()
        if (exitResult && typeof exitResult.catch === 'function') exitResult.catch(() => {})
      } catch {
        // fullscreen teardown is best-effort during component unmount
      }
    }
  }
  if (wideLayoutQuery && typeof wideLayoutQuery.removeEventListener === 'function') {
    wideLayoutQuery.removeEventListener('change', onWideLayoutChange)
  }
  wideLayoutQuery = null
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', writeSquareAvailHeight)
})


  return { transport, stageResizeObserver: () => stageResizeObserver, writeSquareAvailHeight, dragStart, dragEnd }
}
