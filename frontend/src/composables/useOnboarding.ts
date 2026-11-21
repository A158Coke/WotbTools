import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, watchEffect } from 'vue'
import type { Ref } from 'vue'
import { useAuth } from './useAuth.js'
import { useConnectivity } from './useConnectivity.js'
import { useBusinessUserBootstrap } from './useBusinessUserBootstrap.js'
import { REPLACE_DECLINED } from '../shared/onboarding.js'
import type { OnboardingContext, OnboardingSurface, OnboardingSurfaceId, OnboardingTopic, OnboardingWorkspace } from '../shared/onboarding.js'
import {
  EMPTY_RECEIPT,
  ONBOARDING_RELEASE,
  ONBOARDING_STORAGE_KEY,
  type LocalOnboardingReceipt,
  type OnboardingGuidePosition,
  mergeOnboardingReceipts,
  pendingLoginFresh,
  readCache,
  readPendingLogin,
  shouldOfferOnboarding,
  withoutGuide,
  withoutReceipt,
  writePendingLogin,
} from './useOnboardingStorage.js'
import { createOnboardingReceiptSync } from './useOnboardingSync.js'
import { createOnboardingDemoLoad, waitForValue } from './useOnboardingDemoLoad.js'
import { ONBOARDING_GUIDES, SURFACES_READY_BEFORE_PREPARE } from './useOnboardingGuides.js'

// —— 公共面保持稳定：内容注册表 / 存储键 / 回执工具从本入口 re-export ——
export { ONBOARDING_GUIDES, ONBOARDING_TOPICS } from './useOnboardingGuides.js'
export type { GuideStage, GuideStep } from './useOnboardingGuides.js'
export { ONBOARDING_PENDING_LOGIN_KEY, ONBOARDING_STORAGE_KEY, mergeOnboardingReceipts, shouldOfferOnboarding, validOnboardingReceipt } from './useOnboardingStorage.js'

/** Increment epoch only when existing users need the core guide again. Copy/anchor changes use revision. */
const isReplaceDeclined = (e: unknown) => (e as { name?: string } | null)?.name === REPLACE_DECLINED
const REPLAY_VIEWS = new Set(['replay', 'battle-playback', 'agent-replay', 'agent-events', 'agent-shots', 'ai-review'])
/** Where a guide was when an explicit login took the document away (OIDC redirect, #670). */



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
  let previousIdentity = identity.value
  const anonymousTerminal = ref<LocalOnboardingReceipt | null>(null)
  const { persist, record, synchronize, stopSync } = createOnboardingReceiptSync({
    cache, identity, receiptKnown, anonymousTerminal,
    authEpoch: () => auth.authEpoch(),
    authInitState: auth.authInitState,
    authenticated: auth.authenticated,
    connectivity,
  })
  let explicitLoginPending = auth.loginInFlight?.value === true
  let pendingLogin = readPendingLogin()
  /**
   * A guide marker read at document boot may belong to an OIDC round-trip that was canceled;
   * one written by this document belongs to an in-place (Android) login whose result is still
   * pending. Only the former may be discarded by a settled unauthenticated init.
   */
  let guideFromBoot = Boolean(pendingLogin?.guide)
  /** Ownership generation: a guide login stamps it, user cancel/replace bumps it. */
  let guideLoginGeneration = pendingLogin?.guide?.generation ?? 0
  /** Set by `loginAiGuide()` so the loginInFlight watcher knows this login owns the AI lesson. */
  let guideLoginIntent: OnboardingGuidePosition | null = null
  const preparingDemo = ref(false)
  const { beginDemoLoad, awaitDemoLoad, cancelDemoLoad, currentDemoGeneration } = createOnboardingDemoLoad({
    mode, workspace, demoFailed, preparingDemo, ensureReplayView,
  })


  function stopRun() {
    ++runGeneration
    runAbort.abort()
    runAbort = new AbortController()
    cancelDemoLoad()
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

  /**
   * A login can take the whole document away (OIDC redirect), so remember *why* it was requested in
   * the same one-shot handoff the receipt migration uses. Only a terminal anonymous receipt and the
   * guide position are kept — never replay files or account data.
   *
   * Only a login the guide itself issued may own a continuation. A plain profile/header login
   * passes `null` and therefore drops any older guide instead of inheriting and refreshing it,
   * so a canceled tutorial cannot resurface from an unrelated login (#690 review).
   */
  function rememberLogin(position: OnboardingGuidePosition | null) {
    const anonymous = cache.value.anonymous
    const receipt = pendingLogin?.receipt || (identity.value === 'anonymous' && anonymous && !anonymous.migrationConsumed
      && ['COMPLETED', 'SKIPPED'].includes(anonymous.disposition) ? anonymous : null)
    const guide = position ? { ...position, generation: ++guideLoginGeneration } : null
    pendingLogin = receipt || guide
      ? { requestedAt: Date.now(), ...(receipt ? { receipt } : {}), ...(guide ? { guide } : {}) }
      : null
    guideFromBoot = false
    writePendingLogin(pendingLogin)
  }

  /**
   * A user action that withdraws the pending guide continuation (skip/close, start/switch guide,
   * open the directory, finish). Bumping the generation makes a late auth result unable to
   * resume the abandoned lesson. Internal lifecycle interrupts (identity change, view change,
   * loginAiGuide) must never call this.
   */
  function cancelGuideContinuation() {
    if (!pendingLogin?.guide) return
    guideLoginGeneration += 1
    pendingLogin = withoutGuide(pendingLogin)
    guideFromBoot = false
    writePendingLogin(pendingLogin)
  }

  function transferAnonymous(value: LocalOnboardingReceipt, owner: string) {
    persist(owner, { coreEpoch: value.coreEpoch, disposition: value.disposition })
    const anonymous = cache.value.anonymous
    if (anonymous?.coreEpoch === value.coreEpoch) persist('anonymous', { ...anonymous, migrationConsumed: true })
    pendingLogin = withoutReceipt(pendingLogin)
    writePendingLogin(pendingLogin)
  }

  if (auth.loginInFlight) watch(auth.loginInFlight, requested => {
    // loginInFlight only covers the login() call / native RPC. Android's login RPC returns long
    // before the external user-agent reports success, so `false` is not a canceled transaction:
    // the continuation must survive until the real auth result (or expiry) arrives.
    if (!requested) { guideLoginIntent = null; return }
    explicitLoginPending = true
    const position = guideLoginIntent ?? (mode.value === 'tour'
      ? { topic: topic.value, index: index.value, stageIndex: stageIndex.value } : null)
    guideLoginIntent = null
    rememberLogin(position)
  }, { flush: 'sync' })

  watch([identity, auth.authInitState, connectivity, bootstrap.state], () => {
    const anonymous = mergeOnboardingReceipts(cache.value.anonymous || EMPTY_RECEIPT, readCache().anonymous || EMPTY_RECEIPT)
    if (previousIdentity !== identity.value) {
      const migration = explicitLoginPending && previousIdentity === 'anonymous' && identity.value.startsWith('sub:')
        && anonymousTerminal.value?.coreEpoch === anonymous.coreEpoch && !anonymous.migrationConsumed ? anonymousTerminal.value : null
      anonymousTerminal.value = null
      explicitLoginPending = false
      previousIdentity = identity.value
      interrupt()
      if (migration) transferAnonymous(migration, identity.value)
    }
    // A confirmed session is enough to resume a tutorial, even before claims/sub are available
    // (Android can report authenticated=true with tokenParsed=null). Account receipt migration
    // still requires a stable subject, so the two concerns are judged separately.
    if (auth.authenticated.value && auth.authInitState.value === 'authenticated' && pendingLogin) {
      if (!pendingLoginFresh(pendingLogin)) {
        // Same-document Android can consume 30+ minutes after the marker was written; the TTL
        // applies to the whole pending-login object and to both consumption paths.
        pendingLogin = null
        guideFromBoot = false
        writePendingLogin(null)
      } else {
        if (identity.value.startsWith('sub:')) {
          const receipt = pendingLogin.receipt
          if (receipt && receipt.coreEpoch === anonymous.coreEpoch && !anonymous.migrationConsumed) transferAnonymous(receipt, identity.value)
          else if (receipt) { pendingLogin = withoutReceipt(pendingLogin); writePendingLogin(pendingLogin) }
        }
        const position = pendingLogin?.guide
        if (position && (position.generation ?? guideLoginGeneration) === guideLoginGeneration) {
          // Guide consumed; an account-owned receipt (no stable subject yet) stays pending.
          pendingLogin = withoutGuide(pendingLogin)
          guideFromBoot = false
          writePendingLogin(pendingLogin)
          void begin(false, position)
        } else if (position) {
          // Ownership was withdrawn; never resurrect the lesson, but keep the receipt.
          pendingLogin = withoutGuide(pendingLogin)
          guideFromBoot = false
          writePendingLogin(pendingLogin)
        }
      }
    }
    // Fresh document + settled unauthenticated init = the OIDC round-trip produced no session
    // (cancel/failure). Discard the guide inherited from that document; a guide written here
    // belongs to an in-place Android login and must wait for its authChanged callback, while an
    // initializing init keeps the marker until it settles (#690 review).
    if (guideFromBoot && auth.authInitState.value === 'unauthenticated') {
      pendingLogin = withoutGuide(pendingLogin)
      guideFromBoot = false
      writePendingLogin(pendingLogin)
    }
    // `bootstrap.state` 是依赖，但**失败态不是触发源**：whenBusinessUserSettled 在非 ready 时会
    // 主动 ensure，失败再落回 failed ⇒ 本 watcher 被自己的状态翻转反复唤醒 =
    // failed → ensure → pending → failed 的请求风暴（本机实测 ≈380 req/s 的
    // `PUT /api/users/profile`）。失败的重试权属于 owner：AppShell 的认证 / 连通性变化，
    // 或用户在失败横幅上的显式 retry。bootstrap 转 ready 时本 watcher 仍会重跑并完成同步。
    if (bootstrap.state.value === 'failed') return
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
        // 这条路径不经过 prepareStep：下一阶段的目标可能在 prepare 才打开的面里
        const nextStage = currentStage.value
        if (nextStage?.prepare && nextStage.surface) {
          Promise.resolve(surfaces.value[nextStage.surface]?.prepare?.()).catch(() => { issue.value = 'unavailable' })
        }
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
      && selection !== previous && !preparingDemo.value) interrupt()
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
    stopSync()
    window.removeEventListener('storage', onStorage)
  })

  function start(selectedTopic: OnboardingTopic = 'core') {
    cancelGuideContinuation()
    stopRun()
    hintVisible.value = false
    mode.value = 'welcome'
    topic.value = selectedTopic
    index.value = 0
    stageIndex.value = 0
    record('OFFERED')
  }

  function openDirectory() {
    cancelGuideContinuation()
    stopRun()
    hintVisible.value = false
    record('OFFERED')
    mode.value = 'directory'
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
      if (!await awaitDemoLoad()) return
      if (!owns()) return
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
          return surface && (!SURFACES_READY_BEFORE_PREPARE.has(id) || surface.ready() || surface.failed?.()) ? surface : null
        }, signal)
        if (!owns()) return
        if (id !== 'shots' && owner.failed?.()) throw new Error('GUIDE_SURFACE_UNAVAILABLE')
        await owner.prepare?.()
        if (owner.failed?.()) throw new Error('GUIDE_SURFACE_UNAVAILABLE')
      }
      if (owns()) issue.value = ''
    } catch { if (owns()) issue.value = 'unavailable' }
  }

  async function begin(resume = false, position?: OnboardingGuidePosition) {
    if (position) {
      topic.value = position.topic
      index.value = Math.min(position.index, steps.value.length - 1)
      stageIndex.value = Math.min(position.stageIndex, steps.value[index.value].stages.length - 1)
    } else {
      index.value = resume && canResume.value ? Math.min(receipt.value.coreStep || 0, steps.value.length - 1) : 0
      stageIndex.value = 0
    }
    if (topic.value === 'ai' && !isSignedIn.value) return
    demoFailed.value = false
    hintVisible.value = false
    mode.value = 'tour'
    const needsReplay = steps.value.some(step => step.capability)
    if (needsReplay) {
      issue.value = 'loading'
      const generation = ++runGeneration
      try {
        await beginDemoLoad()
      } catch (e) {
        // 用户在「替换当前回放」确认里选了保留：不是加载失败，直接结束教程，原回放原样保留。
        if (generation === runGeneration && mode.value === 'tour' && isReplaceDeclined(e)) { skip(); return }
        if (generation === runGeneration && mode.value === 'tour') { issue.value = 'unavailable'; demoFailed.value = true }
        return
      }
      if (generation !== runGeneration || mode.value !== 'tour') return
    }
    await prepareStep()
  }

  /**
   * Retry reloads the sample in place: the current topic/index/stage stays put.
   * begin(false) would reset an optional guide to its first page, so it must not be used here.
   */
  async function retry() {
    if (mode.value !== 'tour') return
    if (!demoFailed.value) return prepareStep()
    demoFailed.value = false
    issue.value = 'loading'
    const load = beginDemoLoad()
    // A retry can outlive its guide. Capture this load's ownership before awaiting so a late
    // rejection/success from the old load never writes into a guide started meanwhile.
    const generation = currentDemoGeneration()
    const owns = () => generation === currentDemoGeneration() && mode.value === 'tour'
    try {
      await load
    } catch (e) {
      if (!owns()) return
      if (isReplaceDeclined(e)) { skip(); return }
      issue.value = 'unavailable'
      demoFailed.value = true
      return
    }
    if (owns()) await prepareStep()
  }

  function next() {
    if (mode.value !== 'tour') return
    if (index.value >= steps.value.length - 1) {
      cancelGuideContinuation()
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
    cancelGuideContinuation()
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
  function loginAiGuide() {
    if (auth.loginInFlight?.value) return auth.login('ai-review')
    guideLoginIntent = { topic: 'ai', index: 0, stageIndex: 0 }
    interrupt()
    try {
      return auth.login('ai-review')
    } finally {
      // The flush-sync watcher consumes the intent when loginInFlight flips; if the login never
      // started, drop it so a later unrelated login cannot inherit this lesson.
      if (auth.loginInFlight?.value !== true) guideLoginIntent = null
    }
  }
  function reserveShotGuideSpace(pixels: number) {
    surfaces.value.shots?.setGuideInset?.(pixels)
  }
  const guideActive = computed(() => mode.value === 'tour')
  const context: OnboardingContext = { guideActive, start, openDirectory, sampleOpened, registerWorkspace, registerSurface }
  return { ...context, context, mode, topic, index, stageIndex, issue, currentStep, currentStage, steps, hasFiles, hintVisible, canResume, isSignedIn,
    begin, next, back, skip, interrupt, useOwnReplay, loginAiGuide, reserveShotGuideSpace, resume: () => begin(true), dismissHint: () => { hintVisible.value = false }, retry }
}

export type OnboardingController = ReturnType<typeof useOnboarding>
