import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { REPLACE_DECLINED } from '../shared/onboarding.js'
import { loadOfficialDemo } from '../replay-local/demo.js'
import { mapLabel } from '../utils/helpers.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from './useFeatureGate.js'
import { useAuth } from './useAuth.js'
import { useMountedWhenActive } from './useMountedWhenActive.js'
import { useReplayViewerClockBridge } from './useReplayViewerClockBridge.js'
import { showToast } from './useToast.js'
import { notify } from './useNotifications.js'
import { battlePickerOptions, buildSeriesOverview, replayCollectionRows } from '../utils/replaySeries.js'
import type { Ref } from 'vue'
import type { LazyModule } from '../utils/lazyModule.js'
import type { ReplayCapability } from '../types/workspace.js'
import type { useReplayWorkspace } from './useReplayWorkspace.js'

type Workspace = ReturnType<typeof useReplayWorkspace>
type PaneModules = Record<'playback' | 'three' | 'shots' | 'ai' | 'events', LazyModule<unknown>>

interface OnboardingHooks {
  guideActive?: Ref<boolean>
  sampleOpened?: () => void
}

type ConfirmFn = (options: {
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  signal?: AbortSignal
}) => Promise<boolean>

export const REPLAY_WORKSPACE_CAPABILITY_OPTIONS = [
  { key: 'data', labelKey: 'workspace.tab_data' },
  { key: 'replay', labelKey: 'workspace.tab_replay' },
  { key: 'shots', labelKey: 'workspace.tab_shots' },
  { key: 'ai', labelKey: 'workspace.tab_ai' },
]

export function useReplayViewerState(
  workspace: Workspace,
  modules: PaneModules,
  { navigate, onboarding }: { navigate?: (view: string) => void; onboarding?: OnboardingHooks | null },
) {
  const { t, locale } = useI18n()
  const { authenticated } = useAuth()
  const { availability, requireFeature } = useFeatureGate()
  const onlineFeatures = { '3d': Feature.PLAYBACK_3D, ai: Feature.AI_REVIEW }
  const threeAvailability = computed(() => availability(Feature.PLAYBACK_3D))
  const aiAvailability = computed(() => availability(Feature.AI_REVIEW))
  const { files, resp, analysis, isDemoSelection } = workspace.replay



const activeCapability = workspace.activeWorkspaceTab
const canUseDemoCapabilities = computed(() => authenticated.value || isDemoSelection.value)
const VIEWER_CAPS = new Set(['playback', '3d', 'events'])
const viewerActive = computed(() => VIEWER_CAPS.has(activeCapability.value))
const viewerMode = computed(() => (activeCapability.value === '3d' ? '3d' : '2d'))
const activeTab = computed(() => (viewerActive.value ? 'replay' : activeCapability.value))
const viewerMounted = useMountedWhenActive(() => viewerActive.value)
const playbackMounted = useMountedWhenActive(() => activeCapability.value === 'playback' || activeCapability.value === 'events')
const threeMounted = useMountedWhenActive(() =>
  canUseDemoCapabilities.value && activeCapability.value === '3d' && threeAvailability.value.available)
const shotsMounted = useMountedWhenActive(() => canUseDemoCapabilities.value && activeCapability.value === 'shots')
const eventsMounted = useMountedWhenActive(() => canUseDemoCapabilities.value && viewerActive.value)
const aiMounted = useMountedWhenActive(() =>
  authenticated.value && activeCapability.value === 'ai' && aiAvailability.value.available)

function paneLoadError(module: LazyModule<unknown>): string {
  return module.error.value ? 'workspace.pane_load_failed' : ''
}
const playbackLoadError = computed(() => paneLoadError(modules.playback))
const threeLoadError = computed(() => paneLoadError(modules.three))
const shotsLoadError = computed(() => paneLoadError(modules.shots))
const aiLoadError = computed(() => paneLoadError(modules.ai))
const eventsLoadError = computed(() => paneLoadError(modules.events))

async function retryPane(module: LazyModule<unknown>): Promise<void> {
  await module.retry()
}

const currentBattleId = workspace.currentBattleId

const battleOptions = computed(() =>
  battlePickerOptions(buildSeriesOverview(resp.value), { t, locale: locale.value, mapLabel }))
function onBattleSelect(sourceId: string): void {
  workspace.selectBattle(sourceId)
}

const targetFile = computed(() => workspace.currentTargetFile.value)
const initialLoading = computed(() => analysis.value.phase === 'parsing' && !resp.value)
const openFailed = computed(() => analysis.value.phase === 'failed' && !resp.value)
const workspaceReady = computed(() => !!resp.value && files.value.length > 0)
watch(resp, (next, previous) => {
  if (!next || next === previous || !files.value.length || isDemoSelection.value) return
  const count = files.value.length
  showToast({ id: 'replay-parsed', tone: 'success', titleKey: 'notifications.replayParsed' })
  notify({ id: 'replay-parsed', kind: 'replay-parsed', titleKey: 'notifications.replayParsed', bodyKey: 'notifications.replayParsedBody', params: { count }, view: 'replay' })
})
const contentVisible = computed(() => !files.value.length || !!resp.value)
const demoEntryVisible = computed(() => !files.value.length || onboarding?.guideActive?.value === true)

const sourcePicker = ref<HTMLElement | null>(null)
const collectionManager = ref<HTMLElement | null>(null)
const collectionRows = computed(() => replayCollectionRows(files.value, battleOptions.value, resp.value, {
  currentSourceId: activeCapability.value === 'data' && workspace.dataViewMode.value !== 'SINGLE' ? null : currentBattleId.value,
  parsing: analysis.value.phase === 'parsing',
}))
const collectionProgress = computed(() => (analysis.value.phase === 'parsing' && resp.value
  ? { done: analysis.value.done, total: analysis.value.total } : null))

const failedReplayCount = computed(() => resp.value?.failures?.length || 0)
const acknowledgedResult = shallowRef<unknown>(null)
const partialFailureVisible = computed(() => failedReplayCount.value > 0 && acknowledgedResult.value !== resp.value)

const showBattlePicker = computed(() => {
  const cap = activeCapability.value
  if (cap === 'data' || !battleOptions.value.length) return false
  if (viewerActive.value) {
    if (viewerMode.value === '3d') return canUseDemoCapabilities.value && threeAvailability.value.available && !threeLoadError.value
    if (cap === 'events') return canUseDemoCapabilities.value && !eventsLoadError.value
    return !playbackLoadError.value
  }
  if (cap === 'shots') return canUseDemoCapabilities.value && !shotsLoadError.value
  return aiAvailability.value.available && !aiLoadError.value
})
const battlePickerTestId = computed(() => (viewerActive.value ? 'replay' : activeCapability.value) + '-battle-picker')

const VIEW_BY_CAPABILITY = Object.freeze({
  data: 'replay',
  playback: 'battle-playback',
  '3d': 'agent-replay',
  events: 'agent-events',
  shots: 'agent-shots',
  ai: 'ai-review',
})

function viewFor(cap: string): string {
  return (VIEW_BY_CAPABILITY as Record<string, string>)[cap] || 'replay'
}

function switchCapability(key: string, pushHistory: boolean): void {
  workspace.setWorkspaceTab(key as ReplayCapability)
  const feature = onlineFeatures[key as keyof typeof onlineFeatures]
  if (feature) requireFeature(feature)
  if (pushHistory && navigate) navigate(viewFor(key))
}

const {
  playbackSeek, playbackSeekRequest, pending3dSeek,
  setViewerMode, applyCapabilityFromRoute, onEventSeek, resetViewerClockBridge,
} = useReplayViewerClockBridge({ viewerMode, activeCapability, switchCapability })

const sceneFacet = computed(() => {
  const file = targetFile.value
  if (!file || !workspace.playbackSession?.getState) return null
  return workspace.playbackSession.getState(file)?.scenePlayback ?? null
})
const viewerShotFacet = computed(() => (Array.isArray(sceneFacet.value?.shots) ? sceneFacet.value.shots : []))
const viewerKillFacet = computed(() => (Array.isArray(sceneFacet.value?.kills) ? sceneFacet.value.kills : []))
async function viewIn2d(sec: number): Promise<void> {
  await setCapability('playback')
  playbackSeek.value = null
  await nextTick()
  playbackSeek.value = sec
}

watch(targetFile, () => resetViewerClockBridge())

function onTabSelect(key: string): void {
  if (key === 'replay') {
    setCapability(viewerMode.value === '3d' ? '3d' : 'playback')
    return
  }
  setCapability(key)
}

async function setCapability(key: string): Promise<void> {
  if (key === activeCapability.value) return
  switchCapability(key, true)
}

return {
  capabilityOptions: REPLAY_WORKSPACE_CAPABILITY_OPTIONS,
  activeCapability, canUseDemoCapabilities, viewerActive, viewerMode, activeTab,
  viewerMounted, playbackMounted, threeMounted, shotsMounted, eventsMounted, aiMounted,
  playbackLoadError, threeLoadError, shotsLoadError, aiLoadError, eventsLoadError, retryPane,
  currentBattleId, battleOptions, onBattleSelect, targetFile,
  initialLoading, openFailed, workspaceReady, contentVisible, demoEntryVisible,
  sourcePicker, collectionManager, collectionRows, collectionProgress,
  failedReplayCount, acknowledgedResult, partialFailureVisible,
  showBattlePicker, battlePickerTestId, viewFor,
  playbackSeek, playbackSeekRequest, viewerShotFacet, viewerKillFacet,
  viewIn2d, pending3dSeek, onTabSelect, setViewerMode, applyCapabilityFromRoute, onEventSeek, setCapability,
  threeAvailability, aiAvailability,
}
}


const PANE_TEST_IDS: Partial<Record<ReplayCapability, string>> = { playback: 'ws-playback', '3d': 'ws-3d', events: 'ws-events', shots: 'ws-shots', ai: 'ws-ai' }

export function useReplayAutoCenter({ activeCapability, initialLoading }: { activeCapability: Ref<ReplayCapability>; initialLoading: Ref<boolean> }) {
  const workspaceContentEl = ref<HTMLElement | null>(null)
function activePaneEl(): Element | null {
  const id = PANE_TEST_IDS[activeCapability.value]
  if (!id) return null
  const root = workspaceContentEl.value?.parentElement ?? (typeof document !== 'undefined' ? document : null)
  return root?.querySelector?.(`[data-testid="${id}"]`) ?? null
}

function centerReplayPane(): void {
  const pane = activePaneEl()
  if (!pane || typeof pane.scrollIntoView !== 'function') return
  const rect = pane.getBoundingClientRect()
  const viewportH = typeof window !== 'undefined' && Number.isFinite(window.innerHeight) ? window.innerHeight : 0
  const tallerThanViewport = viewportH > 0 && rect.height > viewportH
  pane.scrollIntoView({ block: tallerThanViewport ? 'start' : 'center' })
}

const REPLAY_CAPABILITIES = new Set(['playback', '3d', 'events', 'shots', 'ai'])
const PANE_READY_SELECTOR = '[data-pane-ready="true"]'
let centerToken = 0
let centerObserver: ResizeObserver | null = null
let centerMutationObserver: MutationObserver | null = null
function cancelPendingCenter() {
  centerToken += 1
  centerObserver?.disconnect?.()
  centerObserver = null
}
function paneIsReady(pane: Element | null): boolean {
  if (initialLoading.value) return false
  if (!pane || !pane.querySelector(PANE_READY_SELECTOR)) return false
  return pane.getBoundingClientRect().height > 0
}
function scheduleCenterWhenLaidOut(): void {
  const token = centerToken
  const tryOnce = () => {
    if (token !== centerToken) return true
    const pane = activePaneEl()
    if (!paneIsReady(pane)) return false
    centerReplayPane()
    cancelPendingCenter()
    return true
  }
  if (tryOnce()) return
  const pane = activePaneEl()
  if (!pane || typeof ResizeObserver === 'undefined') return
  centerObserver = new ResizeObserver(() => {
    if (tryOnce()) { centerObserver?.disconnect?.(); centerObserver = null }
  })
  centerObserver.observe(pane)
  if (typeof MutationObserver !== 'undefined') {
    centerMutationObserver?.disconnect?.()
    centerMutationObserver = new MutationObserver(() => {
      if (tryOnce()) { centerMutationObserver?.disconnect?.(); centerMutationObserver = null }
    })
    centerMutationObserver.observe(pane, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-pane-ready'] })
  }
}

watch(activeCapability, (cap) => {
  cancelPendingCenter()
  centerMutationObserver?.disconnect?.()
  centerMutationObserver = null
  if (!REPLAY_CAPABILITIES.has(cap)) return
  nextTick(scheduleCenterWhenLaidOut)
}, { immediate: true })
onBeforeUnmount(() => {
  cancelPendingCenter()
  centerMutationObserver?.disconnect?.()
  centerMutationObserver = null
})

  return { workspaceContentEl }
}


export function useReplayIngest(
  workspace: Workspace,
  { t, confirm, onboarding, setCapability }: {
    t: (key: string) => string
    confirm: ConfirmFn
    onboarding?: OnboardingHooks | null
    setCapability: (capability: string) => Promise<void>
  },
) {
  const replay = workspace.replay
  const { files, loading, resp, updateDemoFile, updateFiles, selectionRevision, analysis, analyze, isDemoSelection } = replay
const demoLoading = ref(false)
const demoError = ref('')
let demoController: AbortController | null = null
let disposed = false

async function loadDemo(signal?: AbortSignal): Promise<void> {
  if (isDemoSelection.value && resp.value && analysis.value.phase === 'ready') {
    await setCapability('data')
    return
  }
  if (demoLoading.value || loading.value) throw new Error('Replay workspace is busy')
  const revision = selectionRevision.value
  const controller = new AbortController()
  demoController = controller
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  demoLoading.value = true
  demoError.value = ''
  try {
    controller.signal.throwIfAborted()
    if (files.value.length && !isDemoSelection.value) {
      const confirmed = await confirm({
        title: t('onboarding.demo_replace_title'), message: t('onboarding.demo_replace_message'),
        confirmLabel: t('onboarding.demo_replace_confirm'), cancelLabel: t('onboarding.demo_replace_cancel'),
        signal: controller.signal,
      })
      controller.signal.throwIfAborted()
      if (!confirmed) throw new DOMException('Official replay replacement declined', REPLACE_DECLINED)
    }
    controller.signal.throwIfAborted()
    if (!isDemoSelection.value) {
      const file = await loadOfficialDemo(controller.signal)
      controller.signal.throwIfAborted()
      if (disposed || selectionRevision.value !== revision) throw new DOMException('Official replay superseded', 'AbortError')
      demoController = null
      updateDemoFile(file)
    }
    const demoRevision = selectionRevision.value
    await setCapability('data')
    controller.signal.throwIfAborted()
    const result = await analyze()
    controller.signal.throwIfAborted()
    if (disposed || selectionRevision.value !== demoRevision) throw new DOMException('Official replay superseded', 'AbortError')
    if (!result?.completed || !resp.value) throw new Error('Official replay analysis failed')
  } catch (e) {
    const declined = (e as { name?: string } | null)?.name
    if (declined !== 'AbortError' && declined !== REPLACE_DECLINED) demoError.value = t('onboarding.demo_failed')
    throw e
  } finally {
    signal?.removeEventListener('abort', abort)
    if (demoController === controller) demoController = null
    demoLoading.value = false
  }
}

async function onDemoClick(): Promise<void> {
  try {
    await loadDemo()
    onboarding?.sampleOpened?.()
  } catch { /* Visible error above; cancelled replacement keeps the current selection. */ }
}

watch(selectionRevision, () => {
  demoController?.abort()
  demoError.value = ''
}, { flush: 'sync' })

async function importPendingFile(file: File): Promise<boolean> {
  workspace.setWorkspaceTab('data')
  updateFiles([file])
  const result = await analyze()
  return result?.completed === true
}
  function markDisposed(): void { disposed = true }
  function abortDemo(): void { demoController?.abort() }
  return { demoLoading, demoError, onDemoClick, importPendingFile, loadDemo, markDisposed, abortDemo }
}
