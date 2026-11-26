import type { BattlePlaybackDataset, PlaybackReloadTelemetry } from '../types/playback-v2'
import type { PoseFacet } from '../replay-local/pose/vehiclePose'
import { gunMarksByAccount } from '../utils/gunMarks.js'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import { usePlaybackWorkspaceToggles } from '../composables/usePlaybackWorkspaceToggles'
import { usePlaybackPortraitViewport } from '../composables/usePlaybackPortraitViewport.js'
import { usePlaybackPreferences } from '../composables/usePlaybackPreferences.js'
import { usePlaybackFullscreen } from '../composables/usePlaybackFullscreen.js'
import { usePlaybackTransients } from '../composables/usePlaybackTransients.js'
import { usePlaybackCamera } from '../composables/usePlaybackCamera.js'
import { usePlaybackAnnotationEditor } from '../composables/usePlaybackAnnotationEditor.js'
import { usePlaybackVehicleSelection } from '../composables/usePlaybackVehicleSelection.js'
import { usePlaybackReplayData } from '../composables/usePlaybackReplayData.js'
import { usePlaybackClock } from '../composables/usePlaybackClock.js'
import { usePlaybackVehicleProjection } from '../composables/usePlaybackVehicleProjection.js'
import { useBattlePlaybackRoster, type SceneSemantics } from './useBattlePlaybackRoster.ts'
import { useBattlePlaybackMapModel } from './useBattlePlaybackMapModel.ts'
import { useBattlePlaybackLifecycle } from './useBattlePlaybackLifecycle.ts'
import { useBattlePlaybackPresentation } from './useBattlePlaybackPresentation.ts'
import { usePlaybackMapGestures } from '../composables/usePlaybackMapGestures.js'

export type PlaybackModelProps = {
  active: boolean
  autoFullscreen: { token?: number; key?: string } | null
  playbackV2: BattlePlaybackDataset | null
  reloadTelemetry: PlaybackReloadTelemetry | null
  poseFacet: PoseFacet | null
  clockOffset: number | null
  loop: boolean
  seekTo: number | null
  result: unknown
  overview: Parameters<typeof useBattlePlaybackMapModel>[0]['overview']
}

export function useBattlePlaybackModel(props: PlaybackModelProps) {
const mapSemantics = Object.values(import.meta.glob<SceneSemantics>('../../../common/map-semantics/*.semantic.json', {
  eager: true, import: 'default',
}))

const { t, locale } = useI18n()
const gunMarks = computed(() => gunMarksByAccount(props.result))
const uiHidden = ref(false)

const {
  pbOverview, image, imageSrc, mapView, palette, playback, duration, friendlyTeam,
  hpVehicles, friendlyHp, enemyHp, friendlyPoints, enemyPoints, baseStatesAt,
  disposeMapPresentation,
} = useBattlePlaybackMapModel(props, () => currentTime.value)

const nowMs = ref(typeof performance !== 'undefined' ? performance.now() : 0)
const { labelPrefs, hpPrefs, trailPrefs, markerPrefs, uiPrefs, declutterActive, toggleDeclutter } = usePlaybackPreferences()
const hpModeOptions = computed(() => ['bar', 'ring'].map(mode => ({
  value: mode, label: t(`recon.map.playback.hp_mode_${mode}`), testid: `pb-hp-mode-${mode}`,
})))


function realNowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

const {
  eventCursor,
  floatItems,
  burstItems,
  resetTransients,
  consumeEvents,
  hasPendingTransients,
  pruneTransients,
  ghostFor,
  flashFor,
  visibleFeed,
} = usePlaybackTransients({
  nowMs,
  authoritativeEvents: () => authoritativeEvents.value,
  hpVehicles: () => hpVehicles.value,
  vehiclesByAccount: () => vehiclesByAccount.value,
  feedVisible: () => !uiHidden.value && !!uiPrefs.showKillfeed,
})

const mobileOverlay = ref<{ reveal?: () => void } | null>(null)
const transportEl = ref<HTMLElement | null>(null)
const displayOpen = ref(false)
const displaySection = ref('display')
const displayAnchor = ref<HTMLElement | null>(null)
function toggleDisplay(anchor: HTMLElement | null) { displayAnchor.value = anchor; displaySection.value = 'display'; displayOpen.value = !displayOpen.value }
const battlefieldWorkspaceEl = ref<HTMLElement | null>(null)
const mapComponent = ref<{ textInputRef?: HTMLInputElement | null } | null>(null)
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
function freezeTransportHeight(el: HTMLElement) { el.style.height = `${el.getBoundingClientRect().height}px` }
function startTransportEnter(el: HTMLElement) {
  if (!el.style.height) el.style.height = '0px'
}
function openTransportHeight(el: HTMLElement) {
  void el.offsetHeight
  el.style.height = `${el.scrollHeight}px`
}
function closeTransportHeight(el: HTMLElement) {
  void el.offsetHeight
  el.style.height = '0px'
}
function clearTransportHeight(el: HTMLElement) { el.style.height = '' }
function toggleTransport() {
  if (!controlsCollapsed.value && transportContentEl.value?.contains(document.activeElement)) {
    transportToggleEl.value?.focus({ preventScroll: true })
  }
  toggleControlsCollapsed()
}
const playbackLifecycle = { active: true }
const lifecycleVisible = ref(true)
const { isFullscreen, pseudoFullscreen, fullscreenSupported, toggleFullscreen, exitOwnedFullscreen } = usePlaybackFullscreen({
  target: () => pbRoot.value, pseudoFallback: true,
  isPhone: isMobileDevice,
  isActive: () => playbackLifecycle.active && props.active && lifecycleVisible.value,
  onChange: () => nextTick(() => fitViewIfReady(true)),
  auto: () => ({ token: props.autoFullscreen?.token ?? 0, key: props.autoFullscreen?.key, ready: true, active: props.active && lifecycleVisible.value }),
})

const floatingFullscreenRow = computed(() => isMobileDevice.value && fullscreenSupported.value && !phoneLandscape.value && !uiHidden.value)
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
} = usePlaybackCamera(mapView, {
  mapComponent,
  mapStageEl,
  isFullscreen: () => isFullscreen.value,
  wideLayout: () => wideLayout.value,
  isMobileDevice: () => isMobileDevice.value,
})

const {
  wheelHintVisible,
  mapTouchPan,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onViewportClick,
  resetGestureState,
} = usePlaybackMapGestures(
  { view, applyView, screenPoint, fitScale },
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
    selectAtPointer: (clientX, clientY) => selectAt(null, clientX, clientY),
    onPlainClick: () => mobileOverlay.value?.reveal?.(),
  },
)


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
} = usePlaybackReplayData(mapView, {
  playback,
  playbackV2: () => props.playbackV2,
  reloadTelemetry: () => props.reloadTelemetry,
  poseFacet: () => props.poseFacet,
  clockOffset: () => props.clockOffset,
  mapCode: () => pbOverview.value.mapCode,
})

const {
  annotationOpen,
  activeTool,
  routePoints,
  annotColor,
  annotVisible,
  annotWidthSlider,
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
  mapView,
  {
    textInputRef: () => mapComponent.value?.textInputRef || null,
    onOpen: () => { pause(); displayOpen.value = false },
    resetGestures: resetGestureState,
    reliefUnproject,
    projectedSemanticNorm,
    reliefHasModel: () => !!reliefModelForPlayback(),
    overview: () => props.overview,
  },
)

const {
  currentTime,
  playing,
  speed,
  hpNoTransition,
  play,
  pause,
  seek,
  step,
  setSpeed,
  seekToEvent,
  disposeClock,
} = usePlaybackClock({
  duration: () => duration.value,
  loop: () => props.loop,
  nowMs,
  realNowMs,
  consumeEvents: (fromSec, toSec) => consumeEvents(fromSec, toSec),
  resetTransients: (sec) => resetTransients(sec),
  hasPendingTransients: (now) => hasPendingTransients(now),
  pruneTransients: (now) => pruneTransients(now),
  rewindTransientCursor: () => { eventCursor.value = 0 },
  feedVisible: () => !uiHidden.value && !!uiPrefs.showKillfeed,
  onPlayStart: () => { if (annotationOpen.value) closeAnnotation() },
  seekTo: () => props.seekTo,
})

const {
  vehicleStates,
  visibleTracers,
  tracerColor,
  visibleTrails,
  markerScreen,
  hpFor,
  hpDisplayNumText,
} = usePlaybackVehicleProjection(
  mapView,
  { view, mapWidth, mapHeight, mapRenderRect, markerTransform, overlayInverse, overlayInverseScale },
  { poseAtTime, poseSource, vehicleReloadAt, vehicleConsumablesAt, routesByAccount, vehiclesByAccount, projectedSemanticNorm },
  {
    playbackV2: () => props.playbackV2,
    recorderAccountId: () => pbOverview.value.recorderAccountId ?? null,
    currentTime,
    speed,
    authoritativeEvents: () => authoritativeEvents.value,
    hpVehicles: () => hpVehicles.value,
    gunMarks: () => gunMarks.value,
    isMobileDevice,
    trailPrefs,
    t,
  },
)

const exposed = {
  pause,
  displayOpened: () => displayOpen.value,
  openDisplay: () => {
    if (displayOpen.value) return false
    toggleDisplay(pbRoot.value?.querySelector('[data-test="pb-secondary-entry"]') || null)
    return true
  },
  closeDisplay: () => { displayOpen.value = false },
  annotationsOpen: () => annotationOpen.value,
  openAnnotations: () => {
    if (annotationOpen.value) return false
    toggleAnnotation()
    return true
  },
  closeAnnotations: closeAnnotation,
}



const authoritativeEvents = computed(() => (playback.value ? playback.value.events : []))
const userVisibleEvents = computed(() => authoritativeEvents.value.filter((event) => (
  event.type === 'DAMAGE' || event.type === 'KILL' || event.type === 'DESTROYED'
)))

const {
  selectedAccountId,
  detailsSide,
  detailsState,
  selectedTrack,
  selectedHealth,
  selectedPortraitUrl,
  selLastKnownSec,
  selCurStats,
  selDamageLog,
  closeSidebar,
  onMarkerSelect,
  selectAt,
  selectFromRoster,
} = usePlaybackVehicleSelection(
  { view, mapEl, mapRenderRect, mapWidth },
  {
    vehicleStates,
    playback,
    currentTime,
    authoritativeEvents,
    hpVehicles,
    uiHidden,
    hpPrefs,
    markerPrefs,
    battlefieldWorkspaceEl,
    markerScreen,
    projectedSemanticNorm,
    mobileOverlay,
    t,
  },
)

const {
  setUiHidden, hpPrefsForMap, markerPrefsForMap, visibleFloats, visibleBursts,
  eventLabel, showRosterPresentation,
} = useBattlePlaybackPresentation({
  computed, uiHidden, t, nowMs, floatItems, burstItems, vehicleStates, markerScreen,
  hpPrefs, markerPrefs, vehiclesByAccount, closeAnnotation, displayOpen, uiPrefs,
})

const { transport, stageResizeObserver, writeSquareAvailHeight, dragStart, dragEnd } = useBattlePlaybackLifecycle({
  props, lifecycleVisible, wideLayout, playbackLifecycle,
  pbRoot, mapStageEl, transportEl, battlefieldWorkspaceEl, isFullscreen,
  fitViewIfReady, pause, exitOwnedFullscreen, disposeClock, disposeCamera, disposeMapPresentation,
  annotationOpen, routePoints, draft, cancelRoute, selectedAnnotation, selectedAnnotationIndex,
  closeAnnotation, finishRoute, deleteSelected, redoAnnot, undoAnnot, setUiHidden, uiHidden,
  duration, currentTime, playing, play, step, seek,
})

const {
  teamVehicles, rosterTeams, destroyedNow, rosterLanes, rosterEntryVisible, hudClockVisible,
  inlineStack, detailsFloating, rosterHealth, rosterReload, floatTeamClass,
  markerLabel, hudBaseStates, basesAt, mapStyle,
} = useBattlePlaybackRoster({
  computed, watch, nextTick, props, currentTime, playback, pbOverview, baseStatesAt, friendlyTeam,
  mapSemantics, showRosterPresentation, isPhonePortrait, rosterLanesOpen, uiHidden,
  uiPrefs, pbRoot, stageResizeObserver, writeSquareAvailHeight, vehicleReloadAt,
  vehicleStates, mapWidth, mapView, hpPrefs, markerPrefs, mapEl, markerScreen, hpFor,
  hpDisplayNumText, selectedAccountId, labelPrefs, palette,
})
return {
  t, locale, gunMarks, uiHidden, pbOverview, image, imageSrc, mapView,
  playback, duration, friendlyTeam, friendlyHp, enemyHp, friendlyPoints, enemyPoints, labelPrefs,
  hpPrefs, trailPrefs, markerPrefs, uiPrefs, declutterActive, toggleDeclutter, hpModeOptions, ghostFor,
  flashFor, visibleFeed, mobileOverlay, transportEl, displayOpen, displaySection, displayAnchor, toggleDisplay,
  battlefieldWorkspaceEl, mapComponent, mapStageEl, pbRoot, formFactor, isMobileDevice, phoneLandscape, compactAnnotation,
  controlsCollapsed, controlsContentId, rosterLanesOpen, toggleRosterLanes, transportToggleEl, transportContentEl, freezeTransportHeight, startTransportEnter,
  openTransportHeight, closeTransportHeight, clearTransportHeight, toggleTransport, lifecycleVisible, isFullscreen, pseudoFullscreen, fullscreenSupported,
  toggleFullscreen, floatingFullscreenRow, view, viewportStyle, resetView, wheelHintVisible, mapTouchPan, onWheel,
  onPointerDown, onPointerMove, onPointerUp, onViewportClick, annotationOpen, activeTool, routePoints, annotColor,
  annotVisible, annotWidthSlider, textSession, textInputStyle, renderedAnnotations, history, historyIndex, annotations,
  selectedAnnotation, cancelRoute, toggleTool, toggleAnnotation, closeAnnotation, undoAnnot, redoAnnot, clearAll,
  setAnnotColor, toggleAnnotations, finishRoute, commitSession, cancelSession, deleteSelected, renameSelected, currentTime,
  playing, speed, hpNoTransition, play, seek, step, setSpeed, seekToEvent,
  vehicleStates, visibleTracers, tracerColor, visibleTrails, hpFor, userVisibleEvents, selectedAccountId, detailsSide,
  detailsState, selectedTrack, selectedHealth, selectedPortraitUrl, selLastKnownSec, selCurStats, selDamageLog, closeSidebar,
  onMarkerSelect, selectFromRoster, setUiHidden, hpPrefsForMap, markerPrefsForMap, visibleFloats, visibleBursts, eventLabel,
  showRosterPresentation, transport, dragStart, dragEnd, teamVehicles, rosterTeams, destroyedNow, rosterLanes,
  rosterEntryVisible, hudClockVisible, inlineStack, detailsFloating, rosterHealth, rosterReload, floatTeamClass, markerLabel,
  hudBaseStates, basesAt, mapStyle, exposed
}

}
