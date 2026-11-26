import { useI18n } from 'vue-i18n'
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { Feature } from '../app/featureCapabilities.js'
import { usePlaybackPreferences } from '../composables/usePlaybackPreferences.js'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import { usePlaybackPortraitViewport } from '../composables/usePlaybackPortraitViewport.js'
import { isInteractiveTarget } from '../composables/usePlaybackTransport.js'
import type { EventTargetLike } from '../composables/usePlaybackTransport.js'
import type { Ref } from 'vue'
import { createPlaybackStore } from '../scene/playbackStore.js'
import { feedbackPrefs, setFeedbackPref } from '../composables/useFeedbackPrefs.js'
import { shadowQualityEligible } from '../scene/playback/quality.js'
import { replaySettingsDiff, type Replay3DSettings } from '../scene/playback/renderSettings.js'
import { discardReloadReplay, stageReplayForReload } from '../replay-local/replayReloadCache.js'
import { showToast } from '../composables/useToast.js'
import type { initPlayback } from '../scene/playbackScene.js'

type Store = ReturnType<typeof createPlaybackStore>

export type SceneApiLike = ReturnType<typeof initPlayback>

export interface R3dAParts {
  store: Store
  rootEl: Ref<HTMLElement | null>
  webgl: { supported: boolean }
  closeAnnotation: () => void
  resetAnnotationState: () => void
  shortWorkspace: Ref<boolean>
  CAMERAS: Ref<ReadonlyArray<{ id: string; label: string }> | string[]>
  sceneApi: SceneApiLike | null
  /** 渲染设置整页重载前暂存当前回放与本次接地阴影目标；失败时抛错并中止重载。 */
  stageReloadReplay?: (contactShadows?: boolean) => Promise<void>
  /** 重载恢复的自动重播信号（A 段拥有匹配/消费，C 段只在完整就绪后 claim）。 */
  resumePending?: Ref<boolean>
  claimResume?: () => boolean
  consumeResume?: () => void
  maybeAutoStart?: () => void
  emitResumeConsumed?: () => void
}

export interface ReplayResumeRequest { id: string, file: File }

export interface R3dAProps {
  active: boolean
  file: unknown
  /** 当前回放是否为官方示例（重载后需重新下载校验，不能直接复用 File 身份）。 */
  demo?: boolean
  /** 重载暂存用的完整批次与选择代次（当前 File 可能只是批次中的一场）。 */
  replayFiles?: readonly File[]
  selectionRevision?: number
  /** 已恢复并解析完成的回放；只有 file 匹配时才允许触发一次自动重播。 */
  resumeRequest?: ReplayResumeRequest | null
}

export function r3dA(S: R3dAParts, props: R3dAProps): void {
const { t, locale } = useI18n()
const onboarding = inject(ONBOARDING_KEY, null)

onMounted(() => onboarding?.registerSurface('3d', {
  ready: () => props.active && S.store.hasData,
  prepare: async () => {
    controlsCollapsed.value = false
    await nextTick()
  },
  failed: () => !S.webgl.supported || !!S.store.err || (!online.value.pending && !online.value.available),
}))
onBeforeUnmount(() => onboarding?.registerSurface('3d', null))
const { availability, requireFeature } = useFeatureGate()
const online = computed(() => availability(Feature.PLAYBACK_3D))

const { labelPrefs, hpPrefs, markerPrefs, uiPrefs, lastKnownPrefs, declutterActive, toggleDeclutter } = usePlaybackPreferences()

const uiHidden = ref(false)
const settingsOpen = ref(false)
const settingsAnchor = ref<HTMLElement | null>(null)
const settingsDraft = ref<Replay3DSettings>({
  qualityKey: 'high',
  logdepth: false,
  dynres: true,
  armorHighlight: false,
  contactShadows: false,
  battleSound: feedbackPrefs.value.battleSound,
})
function currentSettings(): Replay3DSettings {
  return {
    qualityKey: S.store.qualityKey as Replay3DSettings['qualityKey'],
    logdepth: S.store.logdepth,
    dynres: S.store.dynres,
    armorHighlight: S.store.armorHighlight,
    contactShadows: S.store.contactShadows,
    battleSound: feedbackPrefs.value.battleSound,
  }
}
function toggleSettings(anchor: HTMLElement | null): void {
  if (settingsOpen.value) { settingsOpen.value = false; return }
  displayOpen.value = false
  S.closeAnnotation()
  settingsDraft.value = currentSettings()
  settingsAnchor.value = anchor
  settingsOpen.value = true
}
function closeSettings(): void { settingsOpen.value = false }
function setDraftQuality(key: Replay3DSettings['qualityKey']): void {
  settingsDraft.value = {
    ...settingsDraft.value,
    qualityKey: key,
    contactShadows: shadowQualityEligible(key) ? settingsDraft.value.contactShadows : false,
  }
}
async function saveSettings(): Promise<void> {
  const diff = replaySettingsDiff(settingsDraft.value, currentSettings())
  settingsOpen.value = false
  if (!diff.changed) return
  if (diff.live.armorHighlight !== undefined) S.sceneApi?.setArmorHighlight?.(diff.live.armorHighlight)
  if (diff.live.battleSound !== undefined) setFeedbackPref('battleSound', diff.live.battleSound)
  if (diff.render) await S.sceneApi?.applyRenderSettings?.(diff.render)
}

function sameReplayFiles(next: readonly unknown[], previous: readonly File[]): boolean {
  return next.length === previous.length && next.every((file, index) => file === previous[index])
}
async function stageReloadReplay(contactShadows?: boolean): Promise<void> {
  const file = props.file
  if (!(file instanceof File)) return
  const capturedFiles = (props.replayFiles ?? []).filter((item): item is File => item instanceof File)
  const files = capturedFiles.includes(file) ? capturedFiles : [file, ...capturedFiles]
  const selectionRevision = props.selectionRevision
  const shadowTarget = contactShadows ?? S.store.contactShadows
  let reloadId: string | null = null
  try {
    reloadId = await stageReplayForReload({
      files, currentIndex: files.indexOf(file), demo: !!props.demo, contactShadows: shadowTarget,
    })
    const unchanged = props.selectionRevision === selectionRevision
      && props.file === file
      && sameReplayFiles(props.replayFiles ?? [], capturedFiles)
    if (!unchanged) throw new Error('Replay selection changed before reload')
  } catch (error) {
    if (reloadId) await discardReloadReplay(reloadId)
    showToast({
      id: 'replay3d-reload-stage',
      tone: 'error',
      messageKey: 'agentReplay.settings_reload_failed',
    })
    throw error
  }
}
S.stageReloadReplay = stageReloadReplay
const resumePending = ref(false)
let consumedResumeId: string | null = null
function resumeMatches(): boolean {
  const request = props.resumeRequest
  return !!request && request.file === props.file
}
function consumeResume(): void {
  const request = props.resumeRequest
  if (!request || !resumeMatches() || request.id === consumedResumeId) return
  resumePending.value = false
  consumedResumeId = request.id
  S.emitResumeConsumed?.()
}
function claimResume(): boolean {
  const request = props.resumeRequest
  if (!resumePending.value || !request || !resumeMatches() || request.id === consumedResumeId) return false
  resumePending.value = false
  consumedResumeId = request.id
  S.emitResumeConsumed?.()
  return true
}
resumePending.value = resumeMatches()
watch([() => props.resumeRequest?.id ?? '', () => props.file], () => {
  const request = props.resumeRequest
  resumePending.value = !!request && request.file === props.file && request.id !== consumedResumeId
  if (resumePending.value) S.maybeAutoStart?.()
}, { flush: 'post' })
S.resumePending = resumePending
S.claimResume = claimResume
S.consumeResume = consumeResume
const displayOpen = ref(false)
const displayAnchor = ref<HTMLElement | null>(null)
function toggleDisplay(anchor: HTMLElement | null): void {
  if (!displayOpen.value) { S.closeAnnotation(); settingsOpen.value = false }
  displayAnchor.value = anchor
  displayOpen.value = !displayOpen.value
}

const controlsCollapsed = ref(false)
const controlsContentId = useId()
const controlsDocked = ref(false)
function slideContentFrom(el: HTMLElement): void {
  controlsDocked.value = false
  el.style.height = '0px'
}
function slideContentOpen(el: HTMLElement): void {
  el.style.height = `${el.scrollHeight}px`
}
function slideContentClose(el: HTMLElement): void {
  el.style.height = `${el.offsetHeight}px`
}
function slideContentShut(el: HTMLElement): void {
  void el.offsetHeight
  el.style.height = '0px'
}
function clearSlideHeight(el: HTMLElement): void {
  el.style.height = ''
}
function dockControls(el: HTMLElement): void {
  clearSlideHeight(el)
  controlsDocked.value = true
}
function toggleControls() {
  controlsCollapsed.value = !controlsCollapsed.value
  if (controlsCollapsed.value) {
    displayOpen.value = false
    settingsOpen.value = false
    S.closeAnnotation()
  }
}
watch(() => props.file, () => {
  controlsCollapsed.value = false
  controlsDocked.value = false
  settingsOpen.value = false
  S.resetAnnotationState()
  S.sceneApi?.setContactShadows?.(false)
})
const { isPhone } = usePlaybackPhoneForm()
const { isPortrait } = usePlaybackPortraitViewport()
const portraitFlow = computed(() => isPortrait.value)
const compactBar = computed(() => !portraitFlow.value && (isPhone.value || S.shortWorkspace.value))
const phoneLandscape = computed(() => isPhone.value && !portraitFlow.value)

const selectedEid = ref<number | null>(null)
const detailsOpen = ref(false)
const detailsSide = ref('right')

function followFromRoster(eid: number): void {
  selectedEid.value = eid
  displayOpen.value = false
  followUnlessRecorder(eid)
}
function followUnlessRecorder(eid: number): void {
  if (S.store.cam !== 'recorder') S.sceneApi?.setFollow?.(eid)
}
function handleSceneSelect(eid: number | null, event: MouseEvent | null = null): void {
  if (eid == null) { closeDetails(); return }
  selectVehicle(eid, event)
  followUnlessRecorder(eid)
}
function selectVehicle(eid: number, event: MouseEvent | null = null): void {
  selectedEid.value = eid
  detailsOpen.value = true
  displayOpen.value = false
  const side = detailsSideFor(event)
  if (side) detailsSide.value = side
}
function detailsSideFor(event: MouseEvent | null): 'left' | 'right' | null {
  const target = event?.target as (EventTarget & { closest?: (selector: string) => Element | null }) | null
  if (target?.closest?.('.side-left')) return 'right'
  if (target?.closest?.('.side-right')) return 'left'
  const root = S.rootEl.value
  const clientX = event?.clientX
  if (!root || typeof clientX !== 'number' || !Number.isFinite(clientX)) return null
  const rect = root.getBoundingClientRect()
  return clientX > rect.left + rect.width / 2 ? 'left' : 'right'
}
function closeDetails() {
  detailsOpen.value = false
}
const cameraTools = computed(() => ({ cam: S.store.cam, cameras: S.CAMERAS.value, glbOn: S.store.glbOn, glbAllowed: S.store.glbAllowed }))
function chooseCamera(mode: string): void {
  S.sceneApi?.setCam?.(mode)
}
function setUiHidden(hidden: boolean): void {
  uiHidden.value = hidden
  if (hidden) {
    displayOpen.value = false
    settingsOpen.value = false
    S.closeAnnotation()
  }
}
function toggleUiHidden() { setUiHidden(!uiHidden.value) }
function onUiToggleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'h' && event.key !== 'H') return
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (!props.active || !S.store.hasData) return
  if (isInteractiveTarget(event.target as EventTargetLike | null)) return
  event.preventDefault()
  toggleUiHidden()
}

const showTopbar = computed(() => !uiHidden.value && uiPrefs.showTopbar)
const showRoster = computed(() => !uiHidden.value && uiPrefs.showRoster)
const rosterEntryVisible = computed(() => !portraitFlow.value)
function toggleRoster() { uiPrefs.showRoster = !uiPrefs.showRoster }
const showKillfeed = computed(() => !uiHidden.value && uiPrefs.showKillfeed)
const showBaseStatus = computed(() => !uiHidden.value && uiPrefs.showBaseStatus)
const showFps = computed(() => !uiHidden.value && S.store.hasData)
const fpsText = computed(() => (S.store.fps > 0
  ? `${S.store.fps.toFixed(1)} FPS · ${S.store.frameMs.toFixed(1)}/${S.store.framePeakMs.toFixed(1)} ms`
  : '— FPS'))
const fpsJanky = computed(() => S.store.fps > 0
  && (S.store.fps < 45 || (S.store.framePeakMs > 0 && S.store.framePeakMs > S.store.frameMs * 2.5)))


  Object.assign(S, {
    t,
    locale,
    onboarding,
    availability,
    requireFeature,
    online,
    labelPrefs,
    hpPrefs,
    markerPrefs,
    uiPrefs,
    lastKnownPrefs,
    declutterActive,
    toggleDeclutter,
    uiHidden,
    displayOpen,
    displayAnchor,
    toggleDisplay,
    settingsOpen,
    settingsAnchor,
    settingsDraft,
    toggleSettings,
    closeSettings,
    setDraftQuality,
    saveSettings,
    controlsCollapsed,
    controlsContentId,
    controlsDocked,
    slideContentFrom,
    slideContentOpen,
    slideContentClose,
    slideContentShut,
    clearSlideHeight,
    dockControls,
    toggleControls,
    isPhone,
    isPortrait,
    portraitFlow,
    compactBar,
    phoneLandscape,
    selectedEid,
    detailsOpen,
    detailsSide,
    followFromRoster,
    followUnlessRecorder,
    handleSceneSelect,
    selectVehicle,
    detailsSideFor,
    closeDetails,
    cameraTools,
    chooseCamera,
    setUiHidden,
    toggleUiHidden,
    onUiToggleKeydown,
    showTopbar,
    showRoster,
    rosterEntryVisible,
    toggleRoster,
    showKillfeed,
    showBaseStatus,
    showFps,
    fpsText,
    fpsJanky
  })
}
