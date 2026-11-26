import { computed, inject, nextTick, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import { usePlaybackPortraitViewport } from '../composables/usePlaybackPortraitViewport.js'
import { usePlaybackWorkspaceToggles } from '../composables/usePlaybackWorkspaceToggles'
import { usePlaybackFullscreen } from '../composables/usePlaybackFullscreen.js'
import { usePlaybackCamera } from '../composables/usePlaybackCamera.js'
import type { PlaybackMapBridge, PlaybackMapViewLike } from '../composables/usePlaybackCamera.js'
import { usePlaybackMapGestures } from '../composables/usePlaybackMapGestures.js'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'
import { usePlaybackReplayData } from '../composables/usePlaybackReplayData.js'
import { usePlaybackAnnotationEditor } from '../composables/usePlaybackAnnotationEditor.js'
import { usePlaybackVehicleSelection } from '../composables/usePlaybackVehicleSelection.js'
import type { BattlePlaybackDataset } from '../types/playback-v2.js'

type ReplayDataDeps = Parameters<typeof usePlaybackReplayData>[1]
type ReloadTelemetry = ReturnType<ReplayDataDeps['reloadTelemetry']>
type PoseFacet = ReturnType<ReplayDataDeps['poseFacet']>

type SelectionSelectAt = ReturnType<typeof usePlaybackVehicleSelection>['selectAt']

export interface BpBParts {
  mapView: Ref<PlaybackMapViewLike>
  pause: () => void
  pbOverview: Ref<{ mapCode: string | null }>
  playback: ComputedRef<BattlePlaybackDataset | null>
  selectAt: SelectionSelectAt
  uiPrefs: { showRoster?: boolean }
}

export interface BpBProps {
  active: boolean
  autoFullscreen: { token?: number; key?: string } | null
  clockOffset: number | null
  overview: unknown
  playbackV2: BattlePlaybackDataset | null
  poseFacet: PoseFacet
  reloadTelemetry: ReloadTelemetry
}

export function bpB(S: BpBParts, props: BpBProps): void {

const uiHidden = ref(false)
function setUiHidden(hidden: boolean): void {
  uiHidden.value = hidden
  if (hidden) { displayOpen.value = false; closeAnnotation() }
}
const showRosterPresentation = computed(() => !uiHidden.value && S.uiPrefs.showRoster !== false)
const mobileOverlay = ref<{ reveal?: () => void } | null>(null)
const transportEl = ref<HTMLElement | null>(null)
const displayOpen = ref(false)
const displaySection = ref('display')
const displayAnchor = ref<HTMLElement | null>(null)
function toggleDisplay(anchor: HTMLElement | null): void { displayAnchor.value = anchor; displaySection.value = 'display'; displayOpen.value = !displayOpen.value }
const battlefieldWorkspaceEl = ref<HTMLElement | null>(null)
const mapComponent = ref<PlaybackMapBridge | null>(null)
const mapStageEl = ref<HTMLElement | null>(null)

const pbRoot = ref<HTMLElement | null>(null)
const wideLayout = ref(false)
const formFactor = computed(() => {
  if (isMobileDevice.value) return 'mobile'
  return wideLayout.value ? 'pc' : 'tablet'
})

const { isPhone: isMobileDevice } = usePlaybackPhoneForm()
const { isPortrait: isPhonePortrait } = usePlaybackPortraitViewport()
const phoneLandscape = computed(() => isMobileDevice.value && !isPhonePortrait.value)
const compactAnnotation = computed(() => annotationOpen.value && phoneLandscape.value)

const { controlsCollapsed, controlsContentId, toggleControlsCollapsed, rosterLanesOpen, toggleRosterLanes } =
  usePlaybackWorkspaceToggles({ phoneLandscape, onCollapse: () => { displayOpen.value = false; closeAnnotation() } })
const transportToggleEl = ref<HTMLElement | null>(null)
const transportContentEl = ref<HTMLElement | null>(null)
function freezeTransportHeight(el: HTMLElement): void { el.style.height = `${el.getBoundingClientRect().height}px` }
function startTransportEnter(el: HTMLElement): void {
  if (!el.style.height) el.style.height = '0px'
}
function openTransportHeight(el: HTMLElement): void {
  void el.offsetHeight
  el.style.height = `${el.scrollHeight}px`
}
function closeTransportHeight(el: HTMLElement): void {
  void el.offsetHeight
  el.style.height = '0px'
}
function clearTransportHeight(el: HTMLElement): void { el.style.height = '' }
function toggleTransport() {
  if (!controlsCollapsed.value && transportContentEl.value?.contains(document.activeElement)) {
    transportToggleEl.value?.focus({ preventScroll: true })
  }
  toggleControlsCollapsed()
}
let playbackLifecycleActive = true
const lifecycleVisible = ref(true)
let wideLayoutQuery: MediaQueryList | null = null
function onWideLayoutChange(event: MediaQueryListEvent | null): void {
  wideLayout.value = !!(event && event.matches)
}
const { isFullscreen, pseudoFullscreen, fullscreenSupported, toggleFullscreen, exitOwnedFullscreen } = usePlaybackFullscreen({
  target: () => pbRoot.value, pseudoFallback: true,
  isPhone: isMobileDevice,
  isActive: () => playbackLifecycleActive && props.active && lifecycleVisible.value,
  onChange: () => nextTick(() => fitViewIfReady(true)),
  auto: () => ({ token: props.autoFullscreen?.token ?? 0, key: props.autoFullscreen?.key, ready: true, active: props.active && lifecycleVisible.value }),
})

const floatingFullscreenRow = computed(() => isMobileDevice.value && fullscreenSupported.value && !phoneLandscape.value && !uiHidden.value)
const camera = usePlaybackCamera(S.mapView, {
  mapComponent,
  mapStageEl,
  isFullscreen: () => isFullscreen.value,
  wideLayout: () => wideLayout.value,
  isMobileDevice: () => isMobileDevice.value,
})
const {
  mapEl,
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
} = camera

const {
  mapEngaged,
  wheelHintVisible,
  mapTouchPan,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onViewportClick,
  resetGestureState,
} = usePlaybackMapGestures(
  camera,
  mapEl,
  {
    isFullscreen: () => isFullscreen.value,
    drawing: {
      activeTool: () => activeTool.value,
      drawingPointerId: () => getDrawingPointerId(),
      drawingStartScreen: () => getDrawingStartScreen(),
      annotationOpen: () => annotationOpen.value,
      selectedAnnotationIndex: () => selectedAnnotationIndex.value,
      startDrawing: (e) => startDrawing(e),
      moveDrawing: (e) => moveDrawing(e),
      endDrawing: () => endDrawing(),
      cancelDrawing: () => cancelDrawing(),
      clearDrawingPointer: () => {},
    },
    selectAtPointer: (clientX, clientY) => S.selectAt(null, clientX, clientY),
    onPlainClick: () => mobileOverlay.value?.reveal?.(),
  },
)

let stageResizeObserver: ResizeObserver | null = null
function writeSquareAvailHeight(): void {
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
  const reserve = isFullscreen.value ? 0 : (parseFloat(style.getPropertyValue('--pb-viewer-reserve')) || 0)
  const workspaceH = Math.max(1, viewportH - top - reserve)
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


const {
  vehicleReloadAt,
  vehicleConsumablesAt,
  routesByAccount,
  vehiclesByAccount,
  poseSource,
  poseAtTime,
  reliefModelForPlayback,
  projectedSemanticNorm,
  reliefUnproject,
} = usePlaybackReplayData(S.mapView, {
  playback: S.playback,
  playbackV2: () => props.playbackV2,
  reloadTelemetry: () => props.reloadTelemetry,
  poseFacet: () => props.poseFacet,
  clockOffset: () => props.clockOffset,
  mapCode: () => S.pbOverview.value.mapCode,
})

const {
  annotationOpen,
  activeTool,
  routePoints,
  annotColor,
  annotVisible,
  annotWidthSlider,
  semPerSvgX,
  semPerSvgY,
  textSession,
  textInputStyle,
  renderedAnnotations,
  history,
  historyIndex,
  annotations,
  draft,
  selectedAnnotationIndex,
  selectedAnnotation,
  drawingPointerId: getDrawingPointerId,
  drawingStartScreen: getDrawingStartScreen,
  resetAnnotations,
  cancelDrawing,
  cancelRoute,
  toggleTool,
  toggleAnnotation,
  closeAnnotation,
  undoAnnot,
  redoAnnot,
  clearAll,
  setAnnotColor,
  toggleAnnotations,
  finishRoute,
  startDrawing,
  moveDrawing,
  endDrawing,
  commitSession,
  cancelSession,
  deleteSelected,
  renameSelected,
} = usePlaybackAnnotationEditor(
  { view, screenPoint, mapRenderRect, mapWidth, mapHeight },
  S.mapView,
  {
    textInputRef: () => mapComponent.value?.textInputRef || null,
    onOpen: () => { S.pause(); displayOpen.value = false },
    resetGestures: resetGestureState,
    reliefUnproject,
    projectedSemanticNorm,
    reliefHasModel: () => !!reliefModelForPlayback(),
    overview: () => props.overview,
  },
)


  Object.assign(S, {
    uiHidden,
    setUiHidden,
    showRosterPresentation,
    mobileOverlay,
    transportEl,
    displayOpen,
    displaySection,
    displayAnchor,
    toggleDisplay,
    battlefieldWorkspaceEl,
    mapComponent,
    mapStageEl,
    pbRoot,
    wideLayout,
    formFactor,
    isMobileDevice,
    isPhonePortrait,
    phoneLandscape,
    compactAnnotation,
    controlsCollapsed,
    controlsContentId,
    toggleControlsCollapsed,
    rosterLanesOpen,
    toggleRosterLanes,
    transportToggleEl,
    transportContentEl,
    freezeTransportHeight,
    startTransportEnter,
    openTransportHeight,
    closeTransportHeight,
    clearTransportHeight,
    toggleTransport,
    lifecycleVisible,
    onWideLayoutChange,
    isFullscreen,
    pseudoFullscreen,
    fullscreenSupported,
    toggleFullscreen,
    exitOwnedFullscreen,
    floatingFullscreenRow,
    mapEl,
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
    mapEngaged,
    wheelHintVisible,
    mapTouchPan,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onViewportClick,
    resetGestureState,
    writeSquareAvailHeight,
    shellChrome,
    vehicleReloadAt,
    vehicleConsumablesAt,
    routesByAccount,
    vehiclesByAccount,
    poseSource,
    poseAtTime,
    reliefModelForPlayback,
    projectedSemanticNorm,
    reliefUnproject,
    annotationOpen,
    activeTool,
    routePoints,
    annotColor,
    annotVisible,
    annotWidthSlider,
    semPerSvgX,
    semPerSvgY,
    textSession,
    textInputStyle,
    renderedAnnotations,
    history,
    historyIndex,
    annotations,
    draft,
    selectedAnnotationIndex,
    selectedAnnotation,
    getDrawingPointerId,
    getDrawingStartScreen,
    resetAnnotations,
    cancelDrawing,
    cancelRoute,
    toggleTool,
    toggleAnnotation,
    closeAnnotation,
    undoAnnot,
    redoAnnot,
    clearAll,
    setAnnotColor,
    toggleAnnotations,
    finishRoute,
    startDrawing,
    moveDrawing,
    endDrawing,
    commitSession,
    cancelSession,
    deleteSelected,
    renameSelected
  })
  Object.defineProperty(S, 'playbackLifecycleActive', { get: () => playbackLifecycleActive, set: (v) => { playbackLifecycleActive = v }, configurable: true })
  Object.defineProperty(S, 'wideLayoutQuery', { get: () => wideLayoutQuery, set: (v) => { wideLayoutQuery = v }, configurable: true })
  Object.defineProperty(S, 'stageResizeObserver', { get: () => stageResizeObserver, set: (v) => { stageResizeObserver = v }, configurable: true })
}
