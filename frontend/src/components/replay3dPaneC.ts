import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import { cumulativeStatsAtV2, healthDisplayAt, lifeAt, positionAtV2, positionCoveredAtV2 } from '../utils/battlePlaybackV2.ts'
import { detailsDamageLogAtV2 } from '../utils/playbackDetails.js'
import { Feature } from '../app/featureCapabilities.js'
import { usePlaybackFullscreen } from '../composables/usePlaybackFullscreen.js'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'
import { initPlayback } from '../scene/playbackScene.js'
import type { SceneApiLike } from './replay3dPaneA.js'
import type { LocalPlayback } from '../replay-local/playback/parseLocalPlayback.js'
import type { useFeatureGate } from '../composables/useFeatureGate.js'
import { createPlaybackStore } from '../scene/playbackStore.js'
import { useSceneFlyControls } from '../composables/useSceneFlyControls.js'
import type { useI18n } from 'vue-i18n'
import type { MapAnnotation } from '../composables/useAnnotationState.js'
import type { SceneErasePath } from '../composables/useSceneAnnotations.js'
import { useReplay3DAutoStart } from '../composables/useReplay3DAutoStart.js'

type Store = ReturnType<typeof createPlaybackStore>
type FlyControls = ReturnType<typeof useSceneFlyControls>
type I18nT = ReturnType<typeof useI18n>['t']
type RosterRowLike = { eid: number; accountId: number | null; tankId: number | null; team: number | null; nick: string; tank: string; dead?: boolean; hp?: number; maxHp?: number }

interface PlaybackSessionLike {
  loadScene(file: File): unknown
  getState(file: File): { sceneState: string }
  invalidate(file: File): void
}

export interface R3dCParts {
  store: Store
  t: I18nT
  selectedEid: Ref<number | null>
  detailsOpen: Ref<boolean>
  displayOpen: Ref<boolean>
  selectedRow: Ref<RosterRowLike | null>
  detailPlayback: Ref<LocalPlayback | null>
  detailTime: Ref<number>
  teamColors: Ref<{ ally: string; enemy: string; unknown: string }>
  parseController: AbortController | null
  lastFile: File | null
  lastFileName: Ref<string>
  loadedFile: File | null
  requireFeature: ReturnType<typeof useFeatureGate>['requireFeature']
  sceneApi: SceneApiLike | null
  renderActive: Ref<boolean>
  fly: FlyControls
  resetAnnotationState: () => void
  commitAnnotationFromScene: (annotation: MapAnnotation) => void
  eraseFromScene: (path: SceneErasePath) => void
  pushAnnotationProjection: () => void
  pushAnnotationInteraction: () => void
  pushAnnotationVisibility: () => void
  closeAnnotation: () => void
  recorderReticle: Ref<HTMLElement | null>
  labelOverlay: Ref<HTMLElement | null>
  stage: Ref<HTMLElement | null>
  /** 渲染设置整页重载前暂存当前回放（A 段定义，随场景宿主转交）。 */
  stageReloadReplay?: () => Promise<void>
  isPhone: Ref<boolean>
  markerPrefs: { battleMarkers?: boolean }
  uiHidden: Ref<boolean>
  compactBar: Ref<boolean>
  portraitFlow: Ref<boolean>
  portraitGeneration: number
  laneBoundsObserver: ResizeObserver | null
  handleSceneSelect: (eid: number | null, event?: MouseEvent | null) => void
  onUiToggleKeydown: (event: KeyboardEvent) => void
  pushLabelPrefs: () => void
  online: Ref<{ available: boolean }>
  webgl: { supported: boolean }
  jumpBase?: number | null
  QUALITY_ORDER: string[]
}

export interface R3dCProps {
  active: boolean
  autoFullscreenToken: number
  blockedReason: string
  file: File | null
  playbackSession: PlaybackSessionLike | null
  autoStartUserId: string
}

export function r3dC(S: R3dCParts, props: R3dCProps): void {
const selectedTrack = computed(() => S.detailPlayback.value?.dataset?.vehicles.find(track =>
  S.selectedRow.value?.accountId != null && track.accountId === S.selectedRow.value.accountId) || null)
const selectedLife = computed(() => selectedTrack.value ? lifeAt(selectedTrack.value, S.detailTime.value) : null)
const selLastKnownSec = computed(() => {
  const track = selectedTrack.value
  if (!track || positionCoveredAtV2(track.positionSegments, S.detailTime.value)) return null
  return positionAtV2(track.positionSegments, S.detailTime.value)?.timeSec ?? null
})
const selCurStats = computed(() => {
  const playback = S.detailPlayback.value
  const track = selectedTrack.value
  if (!track || !playback || !playback.dataset) return null
  return cumulativeStatsAtV2(playback.dataset.events, track, S.detailTime.value, playback.dataset.vehicles)
})
const selDamageLog = computed(() => detailsDamageLogAtV2(S.detailPlayback.value?.dataset,
  selectedTrack.value, S.detailTime.value, S.t('recon.map.playback.source_unknown')))
const selectedPortraitUrl = ref<string | null>(null)

watch(() => selectedTrack.value?.tankId ?? S.selectedRow.value?.tankId, async tankId => {
  const generation = ++S.portraitGeneration
  selectedPortraitUrl.value = null
  if (tankId == null) return
  try {
    const { loadVehiclePortrait } = await import('../vehicle-portraits/runtime.js')
    const url = await loadVehiclePortrait(tankId)
    if (generation === S.portraitGeneration) selectedPortraitUrl.value = url
  } catch { /* Missing assets keep the panel without a portrait. */ }
})

const selectedDetailState = computed(() => S.selectedRow.value ? {
  vehicle: selectedTrack.value || { tankName: S.selectedRow.value.tank, playerName: S.selectedRow.value.nick,
    tankId: S.selectedRow.value.tankId, accountId: S.selectedRow.value.accountId,
    team: S.selectedRow.value.team, friendly: ([1, 2] as Array<number | null>).includes(S.store.friendlyTeam) && ([1, 2] as Array<number | null>).includes(S.selectedRow.value.team) ? S.selectedRow.value.team === S.store.friendlyTeam : null },
  destroyed: selectedLife.value ? selectedLife.value.lifeState === 'DESTROYED' : S.selectedRow.value.dead,
  destroyedKnownAtSec: selectedLife.value?.destroyedKnownAtSec ?? null,
} : null)
const selectedHealth = computed(() => {
  if (selectedTrack.value) {
    const health = healthDisplayAt(selectedTrack.value, S.detailTime.value)
    return { currentHp: health?.currentHp ?? null, maxHp: health?.displayCapacityHp ?? null }
  }
  return S.selectedRow.value ? {
    currentHp: typeof S.selectedRow.value.hp === 'number' && Number.isFinite(S.selectedRow.value.hp) ? S.selectedRow.value.hp : null,
    maxHp: typeof S.selectedRow.value.maxHp === 'number' && Number.isFinite(S.selectedRow.value.maxHp) && S.selectedRow.value.maxHp > 0 ? S.selectedRow.value.maxHp : null,
  } : null
})

const bannerColor = computed(() => {
  const outcome = S.store.banner?.outcome
  if (outcome === 'win') return S.teamColors.value.ally
  if (outcome === 'lose') return S.teamColors.value.enemy
  return S.teamColors.value.unknown
})


function abortParse(): void {
  S.parseController?.abort()
  S.parseController = null
}

async function loadFile(file: File): Promise<void> {
  if (!file || !S.sceneApi || !S.requireFeature(Feature.PLAYBACK_3D)) return
  abortParse()
  S.parseController = new AbortController()
  S.lastFile = file
  S.lastFileName.value = file.name || 'replay'
  await S.sceneApi.loadData({ kind: 'local', file, signal: S.parseController.signal, session: props.playbackSession ?? undefined })
}

async function retryLoad(): Promise<void> {
  if (S.lastFile) {
    if (props.playbackSession?.getState(S.lastFile).sceneState === 'error') props.playbackSession.invalidate(S.lastFile)
    return loadFile(S.lastFile)
  }
}

function bannerText(): string {
  const banner = S.store.banner
  if (!banner) return ''
  return banner.outcome ? S.t('agentReplay.banner_' + banner.outcome) : (banner.text ?? '')
}
function killfeedVerb(kf: { kill?: boolean }): string {
  return S.t(kf.kill ? 'agentReplay.destroyed' : 'agentReplay.destroyed_by_environment')
}

function destroyScene(): void {
  abortParse()
  S.resetAnnotationState()
  S.selectedEid.value = null
  S.detailsOpen.value = false
  S.fly.stopLoop()
  if (!S.sceneApi) return
  S.sceneApi.destroy?.()
  S.sceneApi = null
}

function shouldHaveScene(): boolean {
  return S.online.value.available && !!S.webgl.supported && !props.blockedReason && !!props.file
}

function ensureScene(): boolean {
  if (S.sceneApi || !S.renderActive.value || !shouldHaveScene()) return false
  const stageEl = S.stage.value
  if (!stageEl) return false
  S.sceneApi = initPlayback(stageEl, S.store, S.labelOverlay.value, {
    onVehicleSelect: S.handleSceneSelect,
    onAnnotationCommit: S.commitAnnotationFromScene,
    onAnnotationErase: S.eraseFromScene,
    recorderReticle: S.recorderReticle.value,
    stageReloadReplay: S.stageReloadReplay ?? null,
  })
  S.sceneApi?.setPaused?.(!S.renderActive.value)
  S.sceneApi?.setFlySpeed?.(S.fly.flySpeedIndex())
  S.sceneApi?.setMobileTouch?.(S.isPhone.value)
  S.pushLabelPrefs();
  S.sceneApi?.setBattleMarkers?.(!!S.markerPrefs.battleMarkers && !S.uiHidden.value);
  S.pushAnnotationProjection()
  S.pushAnnotationInteraction()
  S.pushAnnotationVisibility()
  return true
}

const startedFile = shallowRef<File | null>(null)
const autoStart = useReplay3DAutoStart(() => props.autoStartUserId)
const qualityOptions = computed(() =>
  S.QUALITY_ORDER.map((k) => ({ value: k, label: S.t('agentReplay.q_' + k) })),
)

function startReplay(): void {
  if (!props.file) return
  startedFile.value = props.file
  reconcileScene()
}

function maybeAutoStart(): void {
  autoStart.refresh()
  if (!autoStart.available.value || !autoStart.enabled.value) return
  if (!props.active || !S.renderActive.value) return
  const file = props.file
  if (!file || startedFile.value === file) return
  if (!S.online.value.available || !S.webgl.supported || props.blockedReason) return
  if (!S.requireFeature(Feature.PLAYBACK_3D)) return
  startReplay()
}

function reconcileScene(): void {
  if (!shouldHaveScene()) {
    destroyScene()
    S.loadedFile = null
    startedFile.value = null
    return
  }
  const created = ensureScene()
  const file = props.file
  if (file !== startedFile.value) {
    if (S.loadedFile) {
      S.sceneApi?.reset?.()
      abortParse()
      S.loadedFile = null
      S.selectedEid.value = null
      S.detailsOpen.value = false
      S.displayOpen.value = false
    }
    return
  }
  if (created || file !== S.loadedFile) {
    if (!file) return
    S.loadedFile = file
    loadFile(file)
  }
}

const rootEl = ref<HTMLElement | null>(null)
const hudEl = ref<HTMLElement | null>(null)
const controlsEl = ref<HTMLElement | null>(null)

const SHORT_WORKSPACE_MAX_H = 700
const KILLFEED_MAX_LINES = 3
const KILLFEED_ROW_BORDER_PX = 2
const killfeedMaxLines = ref(KILLFEED_MAX_LINES)
const visibleKillfeed = computed(() => S.store.killfeed.slice(-killfeedMaxLines.value))
const shortWorkspace = ref(false)
// 全屏只扩大可用像素，不切换控制条档位：记住最近一次非全屏的工作台高度，
// 全屏期间沿用它，避免同一回放进出全屏时工具条在紧凑 / 宽形态之间跳变。
let windowedWorkspaceH = 0
function measurePresentationBounds(): void {
  const root = rootEl.value
  if (!root) return
  const pageStyle = getComputedStyle(document.documentElement)
  const header = parseFloat(pageStyle.getPropertyValue('--header-h')) || 0
  const viewportH = window.visualViewport?.height || window.innerHeight
  const full = document.fullscreenElement === root
  const top = full ? 0 : header
  const workspaceH = Math.max(1, viewportH - top - (full ? 0 : (parseFloat(getComputedStyle(root).getPropertyValue('--pb-viewer-reserve')) || 0)))
  root.style.setProperty('--pb-workspace-h', `${workspaceH}px`)
  if (!full) windowedWorkspaceH = workspaceH
  shortWorkspace.value = (windowedWorkspaceH || workspaceH) <= SHORT_WORKSPACE_MAX_H
  const style = getComputedStyle(root)
  const gap = parseFloat(style.getPropertyValue('--space-1')) || 0
  const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
  const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
  const hudH = hudEl.value?.getBoundingClientRect().height || 0
  const controlsH = controlsEl.value?.getBoundingClientRect().height || 0
  const budget = Math.max(1, workspaceH - padding - border - hudH - controlsH - gap * 2)
  root.style.setProperty('--pb-square-avail-h', `${Math.floor(budget)}px`)
  const hudBottom = (hudEl.value?.getBoundingClientRect().bottom ?? 0) - root.getBoundingClientRect().top
  const killfeedLineH = (parseFloat(style.getPropertyValue('--line-height-caption')) || 16) + KILLFEED_ROW_BORDER_PX + gap
  const lineBudget = Math.floor(((root.clientHeight - controlsH - gap * 2) * 0.2 - hudBottom - gap) / killfeedLineH)
  killfeedMaxLines.value = S.compactBar.value || S.portraitFlow.value || !root.clientHeight ? KILLFEED_MAX_LINES : Math.min(KILLFEED_MAX_LINES, Math.max(1, lineBudget))
  root.style.setProperty('--pb-controls-dock-h', `${Math.ceil(controlsH)}px`)
}
function observeLaneBounds(): void {
  if (typeof ResizeObserver !== 'function') return
  S.laneBoundsObserver?.disconnect()
  S.laneBoundsObserver = new ResizeObserver(measurePresentationBounds)
  for (const el of [rootEl.value, hudEl.value, controlsEl.value]) if (el) S.laneBoundsObserver.observe(el)
}
watch([controlsEl, hudEl], (elements) => {
  for (const el of elements) if (el && S.laneBoundsObserver) S.laneBoundsObserver.observe(el)
  measurePresentationBounds()
}, { flush: 'post' })

const { isFullscreen, fullscreenSupported, toggleFullscreen, unlockOrientation, exitOwnedFullscreen } = usePlaybackFullscreen({
  target: () => rootEl.value,
  isPhone: S.isPhone,
  isActive: () => props.active,
  auto: () => ({ token: props.autoFullscreenToken, key: props.file, active: props.active, ready: !!props.file && !props.blockedReason && props.file === startedFile.value && !S.store.err && !!S.store.hasData }), // 成功就绪（非 paneReady：终态错误时它也为 true）
})

type DebugWindow = Window & { __pbPane?: { store: Store; selectedEid: number | null; detailsOpen: boolean; labelOverlay: HTMLElement | null; sceneApi: SceneApiLike | null } }
const debugWindow = window as DebugWindow
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')) {
  debugWindow.__pbPane = {
    store: S.store,
    get selectedEid() { return S.selectedEid.value },
    get detailsOpen() { return S.detailsOpen.value },
    get labelOverlay() { return S.labelOverlay.value },
    get sceneApi() { return S.sceneApi },
  }
}


onMounted(() => {
  reconcileScene()
  maybeAutoStart()
  observeLaneBounds()
  window.addEventListener('keydown', S.onUiToggleKeydown)
})
onBeforeUnmount(() => {
  S.portraitGeneration++
  destroyScene()
  S.laneBoundsObserver?.disconnect()
  S.laneBoundsObserver = null
  window.removeEventListener('keydown', S.onUiToggleKeydown)
  if (debugWindow.__pbPane?.store === S.store) delete debugWindow.__pbPane
})

const sceneLiveness = computed(() => [props.file, props.blockedReason, S.renderActive.value, S.online.value.available] as const)
watch(sceneLiveness, (next, previous) => {
  reconcileScene()
  maybeAutoStart()
  const active = next[2]
  const activeChanged = previous != null && previous.length >= 3 && previous[2] !== active
  if (activeChanged) {
    S.sceneApi?.setPaused?.(!active)
    if (!active) S.fly.stopLoop()
  }
}, { flush: 'post' })

watch(() => props.active, (active) => {
  if (!active) { S.closeAnnotation(); unlockOrientation(); exitOwnedFullscreen() }
})

watch([() => props.active, () => props.autoStartUserId, () => autoStart.enabled.value], () => {
  maybeAutoStart()
}, { flush: 'post' })

function onViewportResize(): void { measurePresentationBounds() }
const shellChrome = inject(SHELL_CHROME_KEY, null)
watch(() => shellChrome?.immersive.value, () => nextTick(measurePresentationBounds))
onMounted(() => window.addEventListener('resize', onViewportResize))
onBeforeUnmount(() => window.removeEventListener('resize', onViewportResize))

  Object.assign(S, {
    selectedTrack,
    selectedLife,
    selLastKnownSec,
    selCurStats,
    selDamageLog,
    selectedPortraitUrl,
    selectedDetailState,
    selectedHealth,
    bannerColor,
    abortParse,
    loadFile,
    retryLoad,
    bannerText,
    killfeedVerb,
    destroyScene,
    shouldHaveScene,
    ensureScene,
    startedFile,
    qualityOptions,
    startReplay,
    maybeAutoStart,
    reconcileScene,
    rootEl,
    hudEl,
    controlsEl,
    SHORT_WORKSPACE_MAX_H,
    KILLFEED_MAX_LINES,
    KILLFEED_ROW_BORDER_PX,
    killfeedMaxLines,
    visibleKillfeed,
    shortWorkspace,
    measurePresentationBounds,
    observeLaneBounds,
    isFullscreen,
    fullscreenSupported,
    toggleFullscreen,
    unlockOrientation,
    exitOwnedFullscreen,
    onViewportResize,
    shellChrome
  })
}
