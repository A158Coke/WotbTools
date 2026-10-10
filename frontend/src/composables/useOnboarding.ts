import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, watchEffect } from 'vue'
import type { Ref } from 'vue'
import { readOnboardingReceipt, saveOnboardingReceipt } from '../api/onboarding.js'
import type { OnboardingReceipt } from '../api/onboarding.js'
import { profileBackendAllowed } from '../app/featureCapabilities.js'
import { useAuth } from './useAuth.js'
import { useConnectivity } from './useConnectivity.js'
import { useBusinessUserBootstrap, whenBusinessUserSettled } from './useBusinessUserBootstrap.js'
import type { OnboardingContext, OnboardingSurface, OnboardingSurfaceId, OnboardingTopic, OnboardingWorkspace } from '../shared/onboarding.js'
import type { ReplayCapability } from '../types/workspace.js'

/** Increment epoch only when existing users need the core guide again. Copy/anchor changes use revision. */
const ONBOARDING_RELEASE = Object.freeze({ enabled: true, coreEpoch: 1, contentRevision: 1 })
export const ONBOARDING_STORAGE_KEY = 'wotbtools-onboarding'
export const ONBOARDING_PENDING_LOGIN_KEY = 'wotbtools-onboarding-pending-login'
const PENDING_LOGIN_MAX_AGE_MS = 30 * 60 * 1000
const REPLAY_VIEWS = new Set(['replay', 'battle-playback', 'agent-replay', 'agent-shots', 'ai-review'])
type Disposition = OnboardingReceipt['disposition'] | 'OFFERED'
export interface LocalOnboardingReceipt { coreEpoch: number; disposition: Disposition; coreStep?: number; migrationConsumed?: boolean }
const EMPTY_RECEIPT: LocalOnboardingReceipt = { coreEpoch: 0, disposition: 'NONE' }
const PRECEDENCE: Record<Disposition, number> = { NONE: 0, OFFERED: 1, SKIPPED: 2, COMPLETED: 3 }

export function validOnboardingReceipt(value: unknown): value is LocalOnboardingReceipt {
  if (!value || typeof value !== 'object') return false
  const receipt = value as LocalOnboardingReceipt
  return Number.isSafeInteger(receipt.coreEpoch) && receipt.coreEpoch >= 0
    && Object.hasOwn(PRECEDENCE, receipt.disposition)
    && (receipt.coreEpoch > 0 || receipt.disposition === 'NONE')
    && (receipt.coreStep === undefined || Number.isSafeInteger(receipt.coreStep) && receipt.coreStep >= 0)
    && (receipt.migrationConsumed === undefined || typeof receipt.migrationConsumed === 'boolean')
}

/** Same-epoch completion wins; old devices cannot overwrite a newer release. */
export function mergeOnboardingReceipts(a: LocalOnboardingReceipt, b: LocalOnboardingReceipt): LocalOnboardingReceipt {
  if (a.coreEpoch !== b.coreEpoch) return { ...(a.coreEpoch > b.coreEpoch ? a : b) }
  return { ...(PRECEDENCE[a.disposition] > PRECEDENCE[b.disposition] ? a : b),
    ...(a.migrationConsumed || b.migrationConsumed ? { migrationConsumed: true } : {}) }
}

export function shouldOfferOnboarding(receipt: LocalOnboardingReceipt, epoch: number = ONBOARDING_RELEASE.coreEpoch) {
  return receipt.coreEpoch < epoch || (receipt.coreEpoch === epoch && receipt.disposition === 'NONE')
}

export interface GuideStage {
  anchor: string
  copy: string
  /** Some tools act on a second real surface, such as drawing on the map. */
  interactionAnchor?: string
  surface?: OnboardingSurfaceId
  /** Advance after a real owner reports readiness, without synthesizing a click. */
  advanceOnReady?: boolean
  prepare?: boolean
}
export interface GuideStep {
  id: string
  capability?: ReplayCapability
  view?: string
  stages: GuideStage[]
}
const stage = (anchor: string, copy: string, extra: Partial<GuideStage> = {}): GuideStage => ({ anchor, copy, ...extra })
const step = (id: string, capability: ReplayCapability, stages: GuideStage[]): GuideStep => ({ id, capability, stages })
const demo = step('demo', 'data', [stage('workspace-demo', 'demo')])
const data = step('data', 'data', [stage('data-toolbar', 'data')])
const playback = step('playback', 'playback', [stage('playback-transport', 'playback', { surface: 'playback', prepare: true })])
const annotations = step('annotations', 'playback', [
  stage('playback-annotation-entry', 'annotationEntry', { surface: 'annotations', advanceOnReady: true }),
  stage('playback-annotation-tools', 'annotationTools', { surface: 'annotations', interactionAnchor: 'playback-map' }),
])
const declutter = step('declutter', 'playback', [stage('playback-declutter', 'declutter', { surface: 'playback', prepare: true })])
const replay3d = step('3d', '3d', [
  stage('replay3d-start', 'replay3dStart', { surface: '3d', advanceOnReady: true }),
  stage('replay3d-camera', 'replay3dCamera', { surface: '3d', interactionAnchor: 'replay3d-workspace' }),
])
const shots = step('shots', 'shots', [
  stage('shots-first-shot', 'shots', { surface: 'shots', advanceOnReady: true }),
  stage('shot-open-viewer', 'shotViewer', { surface: 'armor', advanceOnReady: true }),
  stage('armor-workspace', 'armor', { surface: 'armor' }),
])

/** One registry is shared by the short core guide and the optional function guides. */
export const ONBOARDING_GUIDES: Record<OnboardingTopic, GuideStep[]> = {
  core: [demo, data, playback, annotations, declutter, replay3d, shots],
  data: [demo, data, step('columns', 'data', [stage('data-columns', 'columns', { interactionAnchor: 'data-column-options' })]), step('export', 'data', [stage('data-export', 'export')])],
  playback: [playback, step('timeline', 'playback', [stage('playback-timeline', 'timeline')]), step('display', 'playback', [stage('playback-display', 'display', { interactionAnchor: 'playback-display-options' })])],
  annotations: [annotations, step('drawing', 'playback', [stage('playback-annotation-tools', 'drawing', { surface: 'annotations', prepare: true, interactionAnchor: 'playback-map' })]), declutter],
  '3d': [replay3d, step('camera', '3d', [stage('replay3d-camera', 'camera', { surface: '3d', interactionAnchor: 'replay3d-workspace' })]), step('3dDisplay', '3d', [stage('playback-display', 'display', { interactionAnchor: 'playback-display-options' })])],
  shots: [step('shotList', 'shots', [stage('shots-first-shot', 'shots', { surface: 'shots', advanceOnReady: true })]),
    step('shotOpen', 'shots', [stage('shot-open-viewer', 'shotViewer', { surface: 'armor', advanceOnReady: true })]),
    { id: 'armor', stages: [stage('armor-workspace', 'armor', { surface: 'armor' })] }],
  ai: [step('aiFiles', 'ai', [stage('workspace-file-controls', 'aiFiles')]), step('aiStart', 'ai', [stage('ai-review-start', 'aiStart')]), step('aiReport', 'ai', [stage('ai-review-report', 'aiReport')])],
  tankopedia: [
    { id: 'tankFilters', view: 'agent-tankopedia', stages: [stage('tankopedia-search', 'tankFilters', { interactionAnchor: 'tankopedia-filters' })] },
    { id: 'tankDetail', view: 'agent-tankopedia', stages: [stage('tankopedia-list', 'tankDetail')] },
    { id: 'tankArmor', view: 'agent-tankopedia', stages: [stage('tankopedia-armor', 'tankArmor')] },
  ],
  hof: [
    { id: 'hofBoards', view: 'hof', stages: [stage('hof-tabs', 'hofBoards')] },
    { id: 'hofFilters', view: 'hof', stages: [stage('hof-filters', 'hofFilters', { interactionAnchor: 'hof-filter-options' })] },
    { id: 'hofRecords', view: 'hof', stages: [stage('hof-records', 'hofRecords')] },
    { id: 'hofSubmit', view: 'hof', stages: [stage('hof-submit', 'hofSubmit')] },
  ],
  tournament: [
    { id: 'tournamentEvent', view: 'tournament-points', stages: [stage('tournament-event', 'tournamentEvent')] },
    { id: 'tournamentStandings', view: 'tournament-points', stages: [stage('tournament-standings', 'tournamentStandings')] },
    { id: 'tournamentExport', view: 'tournament-points', stages: [stage('tournament-export', 'tournamentExport')] },
  ],
  settings: [
    { id: 'settingsTheme', view: 'more', stages: [stage('settings-theme', 'settingsTheme')] },
    { id: 'settingsLanguage', view: 'more', stages: [stage('settings-language', 'settingsLanguage')] },
    { id: 'settingsAccount', view: 'profile', stages: [stage('settings-account', 'settingsAccount')] },
  ],
}
export const ONBOARDING_TOPICS = Object.keys(ONBOARDING_GUIDES).filter(id => id !== 'core') as Exclude<OnboardingTopic, 'core'>[]

function readCache(): Record<string, LocalOnboardingReceipt> {
  try {
    const value = JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) || '{}')
    if (value.version !== 1 || !value.receipts || typeof value.receipts !== 'object') return {}
    return Object.fromEntries(Object.entries(value.receipts).filter(([, receipt]) => validOnboardingReceipt(receipt))) as Record<string, LocalOnboardingReceipt>
  } catch { return {} }
}

function readPendingLogin(): LocalOnboardingReceipt | null {
  try {
    const pending = JSON.parse(sessionStorage.getItem(ONBOARDING_PENDING_LOGIN_KEY) || 'null')
    const age = Date.now() - pending?.requestedAt
    if (validOnboardingReceipt(pending?.receipt) && ['COMPLETED', 'SKIPPED'].includes(pending.receipt.disposition)
      && Number.isFinite(age) && age >= 0 && age <= PENDING_LOGIN_MAX_AGE_MS) return pending.receipt
    sessionStorage.removeItem(ONBOARDING_PENDING_LOGIN_KEY)
  } catch { /* The same-SPA handoff can still use session memory. */ }
  return null
}

function writePendingLogin(receipt: LocalOnboardingReceipt | null) {
  try {
    if (receipt) sessionStorage.setItem(ONBOARDING_PENDING_LOGIN_KEY, JSON.stringify({ requestedAt: Date.now(), receipt }))
    else sessionStorage.removeItem(ONBOARDING_PENDING_LOGIN_KEY)
  } catch { /* Login and manual guides remain usable without storage. */ }
}

/** AppShell is the single lifecycle owner; panes only register their existing commands. */
export function useOnboarding(options: {
  navigate: (view: string) => void | Promise<unknown>
  view: Readonly<Ref<string>>
  canInvite?: Readonly<Ref<boolean>>
}) {
  const auth = useAuth()
  const isSignedIn = computed(() => auth.authenticated.value === true)
  const { connectivity } = useConnectivity()
  const bootstrap = useBusinessUserBootstrap()
  const workspace = shallowRef<OnboardingWorkspace | null>(null)
  const surfaces = shallowRef<Partial<Record<OnboardingSurfaceId, OnboardingSurface>>>({})
  const mode = ref<'idle' | 'welcome' | 'tour' | 'finish' | 'directory'>('idle')
  const hintVisible = ref(false)
  const topic = ref<OnboardingTopic>('core')
  const index = ref(0)
  const stageIndex = ref(0)
  const issue = ref<'' | 'loading' | 'unavailable'>('')
  const receiptKnown = ref(false)
  const cache = ref(readCache())
  const identity = computed(() => auth.authenticated.value
    ? (auth.tokenParsed.value?.sub ? `sub:${auth.tokenParsed.value.sub}` : 'unknown-account') : 'anonymous')
  const receipt = computed(() => cache.value[identity.value] || EMPTY_RECEIPT)
  const canResume = computed(() => topic.value === 'core' && receipt.value.coreEpoch === ONBOARDING_RELEASE.coreEpoch
    && receipt.value.disposition === 'OFFERED' && (receipt.value.coreStep || 0) > 0)
  const steps = computed(() => ONBOARDING_GUIDES[topic.value])
  const currentStep = computed(() => steps.value[index.value])
  const currentStage = computed(() => currentStep.value?.stages[stageIndex.value])
  const hasFiles = computed(() => !!workspace.value?.hasFiles())
  const demoFailed = ref(false)
  let runGeneration = 0
  let runAbort = new AbortController()
  let syncGeneration = 0
  let syncAbort = new AbortController()
  let previousIdentity = identity.value
  let anonymousTerminal: LocalOnboardingReceipt | null = null
  let explicitLoginPending = auth.loginInFlight?.value === true
  let pendingLogin = readPendingLogin()
  let preparingDemo = false

  function persist(identityKey: string, incoming: LocalOnboardingReceipt) {
    // Read before writing so a same-browser account switch/tab cannot erase other users' receipts.
    const disk = readCache()
    const merged = { ...disk, ...cache.value }
    for (const [key, value] of Object.entries(disk)) merged[key] = mergeOnboardingReceipts(merged[key] || EMPTY_RECEIPT, value)
    merged[identityKey] = mergeOnboardingReceipts(merged[identityKey] || EMPTY_RECEIPT, incoming)
    cache.value = merged
    try { localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ version: 1, receipts: merged })) } catch { /* Session memory still suppresses repeated invitations. */ }
  }

  function record(disposition: Disposition) {
    const previous = cache.value[identity.value]
    const coreStep = disposition === 'OFFERED' && previous?.coreEpoch === ONBOARDING_RELEASE.coreEpoch ? previous.coreStep : undefined
    const migrationConsumed = previous?.coreEpoch === ONBOARDING_RELEASE.coreEpoch && previous.migrationConsumed === true
    const value = { coreEpoch: ONBOARDING_RELEASE.coreEpoch, disposition, ...(coreStep === undefined ? {} : { coreStep }), ...(migrationConsumed ? { migrationConsumed: true } : {}) }
    persist(identity.value, value)
    if (identity.value === 'anonymous' && !migrationConsumed && (disposition === 'COMPLETED' || disposition === 'SKIPPED')) anonymousTerminal = value
  }

  async function synchronize() {
    const generation = ++syncGeneration
    syncAbort.abort()
    syncAbort = new AbortController()
    const signal = syncAbort.signal
    const owner = identity.value
    const epoch = auth.authEpoch()
    const context = { authInitState: auth.authInitState.value, authenticated: auth.authenticated.value, connectivity: connectivity.value }
    const owns = () => generation === syncGeneration && owner === identity.value && epoch === auth.authEpoch() && !signal.aborted
    receiptKnown.value = owner === 'anonymous' && context.authInitState === 'unauthenticated'
    if (owner === 'anonymous' || owner === 'unknown-account' || !profileBackendAllowed(context)) return
    try {
      if (!await whenBusinessUserSettled(context) || !owns()) return
      const remote = await readOnboardingReceipt(signal)
      if (!owns()) return
      persist(owner, remote)
      receiptKnown.value = true
      const local = cache.value[owner]
      if (local && (local.disposition === 'COMPLETED' || local.disposition === 'SKIPPED')
        && (local.coreEpoch > remote.coreEpoch || (local.coreEpoch === remote.coreEpoch && PRECEDENCE[local.disposition] > PRECEDENCE[remote.disposition]))) {
        const saved = await saveOnboardingReceipt({ coreEpoch: local.coreEpoch, disposition: local.disposition }, signal)
        if (owns()) persist(owner, saved)
      }
    } catch { /* Unknown server receipt must never be interpreted as a fresh account. Manual guides remain available. */ }
  }

  function stopRun() {
    ++runGeneration
    runAbort.abort()
    runAbort = new AbortController()
    issue.value = ''
    demoFailed.value = false
    for (const surface of Object.values(surfaces.value)) {
      try { surface?.cleanup?.() } catch { /* A disposing pane cannot keep the guide's trap alive. */ }
    }
  }

  function interrupt() {
    stopRun()
    mode.value = 'idle'
    hintVisible.value = false
  }

  function transferAnonymous(value: LocalOnboardingReceipt, owner: string) {
    persist(owner, { coreEpoch: value.coreEpoch, disposition: value.disposition })
    const anonymous = cache.value.anonymous
    if (anonymous?.coreEpoch === value.coreEpoch) persist('anonymous', { ...anonymous, migrationConsumed: true })
    pendingLogin = null
    writePendingLogin(null)
  }

  if (auth.loginInFlight) watch(auth.loginInFlight, requested => {
    if (requested) {
      explicitLoginPending = true
      const anonymous = cache.value.anonymous
      if (identity.value === 'anonymous' && anonymous && !anonymous.migrationConsumed
        && ['COMPLETED', 'SKIPPED'].includes(anonymous.disposition)) {
        pendingLogin = anonymous
        writePendingLogin(anonymous)
      }
    } else void nextTick(() => {
      if (!auth.authenticated.value) { explicitLoginPending = false; pendingLogin = null; writePendingLogin(null) }
    })
  }, { flush: 'sync' })

  watch([identity, auth.authInitState, connectivity, bootstrap.state], () => {
    const anonymous = mergeOnboardingReceipts(cache.value.anonymous || EMPTY_RECEIPT, readCache().anonymous || EMPTY_RECEIPT)
    if (previousIdentity !== identity.value) {
      const migration = explicitLoginPending && previousIdentity === 'anonymous' && identity.value.startsWith('sub:')
        && anonymousTerminal?.coreEpoch === anonymous.coreEpoch && !anonymous.migrationConsumed ? anonymousTerminal : null
      anonymousTerminal = null
      explicitLoginPending = false
      previousIdentity = identity.value
      interrupt()
      if (migration) transferAnonymous(migration, identity.value)
    }
    // sessionStorage survives the browser's explicit OIDC redirect, but the marker is used once.
    if (identity.value.startsWith('sub:') && auth.authInitState.value === 'authenticated' && pendingLogin) {
      if (pendingLogin.coreEpoch === anonymous.coreEpoch && !anonymous.migrationConsumed) transferAnonymous(pendingLogin, identity.value)
      else { pendingLogin = null; writePendingLogin(null) }
    }
    void synchronize()
  }, { immediate: true })

  watchEffect(() => {
    const safe = options.view.value === 'home' || (options.view.value === 'replay' && workspace.value && !workspace.value.hasFiles() && !workspace.value.busy())
    if (!ONBOARDING_RELEASE.enabled || !isSignedIn.value || options.canInvite?.value === false || mode.value !== 'idle'
      || !receiptKnown.value || !shouldOfferOnboarding(receipt.value)) return
    if (options.view.value === 'replay' && !workspace.value) return
    if (workspace.value?.busy()) return
    if (typeof document !== 'undefined' && (document.fullscreenElement || document.querySelector('.dialog-scrim'))) return
    record('OFFERED')
    topic.value = 'core'
    if (safe) mode.value = 'welcome'
    else hintVisible.value = true
  })

  watch([mode, topic, index], () => {
    if (mode.value === 'tour' && topic.value === 'core') persist(identity.value,
      { coreEpoch: ONBOARDING_RELEASE.coreEpoch, disposition: 'OFFERED', coreStep: index.value })
  }, { flush: 'sync' })

  // State comes from the actual pane, so 3D Start and shot selection keep their normal user semantics.
  watchEffect(() => {
    if (mode.value !== 'tour' || issue.value === 'loading') return
    const stage = currentStage.value
    const previous = currentStep.value.stages[stageIndex.value - 1]
    if (previous?.advanceOnReady && (previous.surface === 'annotations' || previous.surface === 'shots')
      && surfaces.value[previous.surface] && !surfaces.value[previous.surface]?.ready()) {
      stageIndex.value--
      return
    }
    if (!stage?.surface) return
    const surface = surfaces.value[stage.surface]
    if (surface?.failed?.()) { issue.value = 'unavailable'; return }
    if (stage.advanceOnReady && surface?.ready()) {
      if (stageIndex.value < currentStep.value.stages.length - 1) {
        stageIndex.value++
        issue.value = ''
      } else if (index.value < steps.value.length - 1) next()
    }
  })

  // A route chosen outside the current lesson interrupts it. The legitimate shot handoff is allowed.
  watch(options.view, (view) => {
    if (mode.value !== 'tour') return
    const expected = currentStep.value?.view
    const isWorkspace = REPLAY_VIEWS.has(view)
    const isShotHandoff = currentStep.value?.stages.some(stage => stage.surface === 'armor') && view === 'agent-armor'
    if (expected ? view !== expected : !isWorkspace && !isShotHandoff) interrupt()
  })

  watch(() => workspace.value?.selectionIdentity(), (selection, previous) => {
    if (mode.value === 'tour' && selection !== undefined && previous !== undefined
      && selection !== previous && !preparingDemo) interrupt()
  }, { flush: 'sync' })

  function onStorage(event: StorageEvent) {
    if (event.key !== ONBOARDING_STORAGE_KEY || !event.newValue) return
    const disk = readCache()
    const incoming = disk[identity.value]
    for (const [key, value] of Object.entries(disk)) cache.value[key] = mergeOnboardingReceipts(cache.value[key] || EMPTY_RECEIPT, value)
    if (incoming && !shouldOfferOnboarding(incoming) && (mode.value === 'welcome' || hintVisible.value)) interrupt()
  }
  onMounted(() => window.addEventListener('storage', onStorage))
  onBeforeUnmount(() => {
    interrupt()
    ++syncGeneration
    syncAbort.abort()
    window.removeEventListener('storage', onStorage)
  })

  function start(selectedTopic: OnboardingTopic = 'core') {
    stopRun()
    hintVisible.value = false
    mode.value = 'welcome'
    topic.value = selectedTopic
    index.value = 0
    stageIndex.value = 0
    record('OFFERED')
  }

  function openDirectory() {
    stopRun()
    hintVisible.value = false
    record('OFFERED')
    mode.value = 'directory'
  }

  function waitForValue<T>(read: () => T | null, signal: AbortSignal): Promise<T> {
    const initial = read()
    if (initial) return Promise.resolve(initial)
    return new Promise((resolve, reject) => {
      let stop = () => {}
      const finish = (value?: T) => {
        stop()
        clearTimeout(timeout)
        signal.removeEventListener('abort', abort)
        value ? resolve(value) : reject(new Error('GUIDE_SURFACE_UNAVAILABLE'))
      }
      const abort = () => finish()
      const timeout = setTimeout(() => finish(), 10000)
      signal.addEventListener('abort', abort, { once: true })
      stop = watch(read, value => { if (value) finish(value) }, { flush: 'sync' })
      if (signal.aborted) finish()
    })
  }

  async function ensureReplayView() {
    // A cached workspace owner does not prove that its real page is currently visible.
    if (!REPLAY_VIEWS.has(options.view.value)) await options.navigate('replay')
  }

  async function prepareStep() {
    const generation = ++runGeneration
    runAbort.abort()
    runAbort = new AbortController()
    const signal = runAbort.signal
    const current = currentStep.value
    const owns = () => generation === runGeneration && mode.value === 'tour' && !signal.aborted
    issue.value = 'loading'
    try {
      if (current?.view) await options.navigate(current.view)
      if (current?.capability) {
        await ensureReplayView()
        if (!owns()) return
        const owner = await waitForValue(() => workspace.value, signal)
        if (!owns()) return
        await owner.setCapability(current.capability)
      }
      if (!owns()) return
      await nextTick()
      const currentStage = current.stages[stageIndex.value]
      if (currentStage.prepare && currentStage.surface) {
        const id = currentStage.surface
        const owner = await waitForValue(() => {
          const surface = surfaces.value[id]
          return surface && (id !== 'playback' || surface.ready() || surface.failed?.()) ? surface : null
        }, signal)
        if (!owns()) return
        if (owner.failed?.()) throw new Error('GUIDE_SURFACE_UNAVAILABLE')
        await owner.prepare?.()
      }
      if (owns()) issue.value = ''
    } catch { if (owns()) issue.value = 'unavailable' }
  }

  async function begin(resume = false) {
    demoFailed.value = false
    index.value = resume && canResume.value ? Math.min(receipt.value.coreStep || 0, steps.value.length - 1) : 0
    stageIndex.value = 0
    mode.value = 'tour'
    const needsReplay = steps.value.some(step => step.capability)
    if (needsReplay) {
      issue.value = 'loading'
      const generation = ++runGeneration
      const signal = runAbort.signal
      try {
        await ensureReplayView()
        const owner = await waitForValue(() => workspace.value, signal)
        if (generation !== runGeneration || mode.value !== 'tour') return
        preparingDemo = true
        try { await owner.loadDemo(signal) } finally { preparingDemo = false }
        if (generation !== runGeneration || mode.value !== 'tour') return
      } catch {
        if (generation === runGeneration && mode.value === 'tour') { issue.value = 'unavailable'; demoFailed.value = true }
        return
      }
    }
    await prepareStep()
  }

  function next() {
    if (mode.value !== 'tour') return
    if (index.value >= steps.value.length - 1) {
      stopRun()
      if (topic.value === 'core') { record('COMPLETED'); void synchronize() }
      mode.value = 'finish'
      return
    }
    ++index.value
    stageIndex.value = 0
    void prepareStep()
  }
  function back() {
    if (mode.value !== 'tour' || index.value === 0) return
    --index.value
    stageIndex.value = 0
    void prepareStep()
  }
  function skip() {
    if (topic.value === 'core' && (mode.value === 'welcome' || mode.value === 'tour')) { record('SKIPPED'); void synchronize() }
    interrupt()
  }
  function registerWorkspace(value: OnboardingWorkspace | null) {
    if (!value && workspace.value && mode.value === 'tour' && !preparingDemo && options.view.value !== 'agent-armor') {
      // The workspace legitimately unmounts during the shot → viewer handoff.
      if (!currentStep.value?.stages.some(stage => stage.surface === 'armor')) interrupt()
    }
    workspace.value = value
  }
  function registerSurface(id: OnboardingSurfaceId, value: OnboardingSurface | null) {
    surfaces.value = { ...surfaces.value, [id]: value || undefined }
  }
  async function useOwnReplay() {
    interrupt()
    const generation = runGeneration
    const signal = runAbort.signal
    try {
      await options.navigate('replay')
      await nextTick()
      if (generation !== runGeneration || signal.aborted) return
      const owner = await waitForValue(() => workspace.value, signal)
      if (generation !== runGeneration || signal.aborted) return
      await owner.chooseOwnReplay()
    } catch { /* The workspace owns picker errors; canceling this handoff keeps the terminal receipt. */ }
  }
  function sampleOpened() {
    if (mode.value === 'tour' && currentStep.value.id === 'demo' && issue.value === '') next()
  }
  const context: OnboardingContext = { start, openDirectory, sampleOpened, registerWorkspace, registerSurface }
  return { ...context, context, mode, topic, index, stageIndex, issue, currentStep, currentStage, steps, hasFiles, hintVisible, canResume, isSignedIn,
    begin, next, back, skip, interrupt, useOwnReplay, resume: () => begin(true), dismissHint: () => { hintVisible.value = false }, retry: () => demoFailed.value ? begin(canResume.value) : prepareStep() }
}

export type OnboardingController = ReturnType<typeof useOnboarding>
