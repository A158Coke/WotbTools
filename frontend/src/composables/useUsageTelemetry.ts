import { onMounted, onUnmounted, watch, type Ref } from 'vue'
import { postUsageEvents, type GenericUsageEvent } from '../api/usage-events.js'
import { useAuth } from './useAuth.js'
import { useConnectivity } from './useConnectivity.js'
import { isAndroidApp } from './usePlatformBridge.js'
import { ConnectivityState } from '../platform/connectivity.js'

const HEARTBEAT_MS = 5 * 60_000
const FLUSH_MS = 5_000
const MAX_QUEUE = 100
const BATCH_SIZE = 20
const queue: GenericUsageEvent[] = []
let sending = false
let flushTimer: ReturnType<typeof setTimeout> | undefined

const online = () => String(useConnectivity().connectivity.value) === ConnectivityState.ONLINE
function discardQueue(): void {
  queue.length = 0
  clearTimeout(flushTimer)
  flushTimer = undefined
}

/** No disk queue, persistent visitor identifier, file names or raw exceptions. */
export function recordUsage(input: Pick<GenericUsageEvent, 'event' | 'feature'> & Partial<Pick<GenericUsageEvent,
  'outcome' | 'operation_id' | 'error_code' | 'error_id'>>): void {
  try {
    if (!online() || queue.length >= MAX_QUEUE) return
    queue.push({ ...input, event_id: crypto.randomUUID(), occurred_at: new Date().toISOString(),
      platform: isAndroidApp() ? 'android' : 'web' })
    if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = undefined; void flushUsage() }, FLUSH_MS)
  } catch { /* Telemetry must never interrupt local/offline functionality. */ }
}

async function flushUsage(): Promise<void> {
  if (!online()) { discardQueue(); return }
  if (sending) return
  sending = true
  try {
    while (queue.length) {
      if (!online()) { discardQueue(); return }
      const batch = queue.splice(0, BATCH_SIZE)
      try { await postUsageEvents(batch) } catch { /* Discard; no retry/offline backlog. */ }
    }
  } finally { sending = false }
}

const FEATURE_BY_VIEW: Readonly<Record<string, GenericUsageEvent['feature']>> = Object.freeze({
  home: 'home', 'battle-playback': 'replay_2d', 'agent-replay': 'replay_3d',
  'agent-shots': 'replay_shots', 'ai-review': 'ai_review',
  'agent-tankopedia': 'tankopedia', 'agent-armor': 'armor', hof: 'hall_of_fame',
  'tournament-points': 'tournament', sponsor: 'sponsor', profile: 'profile',
})

// One foreground lifecycle owner even if a shell is temporarily mounted twice during navigation.
let currentOwner: symbol | undefined
const owners = new Map<symbol, (previous?: string) => void>()
let lastActivity: { epoch: number; at: number } | undefined
let activityInFlight = false

/** AppShell supplies the canonical router view; query-only changes do not reopen a feature. */
export function useUsageTelemetry(view: Readonly<Ref<string>>): void {
  const auth = useAuth()
  const { connectivity, settled } = useConnectivity()
  const owner = Symbol('usage-owner')
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let previousView: string | undefined
  let pendingView: string | undefined
  let initialView: string | undefined
  const foreground = () => currentOwner === owner && document.visibilityState !== 'hidden'

  async function activity(force = false): Promise<void> {
    if (!foreground() || !auth.authenticated.value || auth.authInitState.value !== 'authenticated'
      || String(connectivity.value) !== ConnectivityState.ONLINE || activityInFlight) return
    const epoch = auth.authEpoch()
    if (!force && lastActivity && lastActivity.epoch === epoch && Date.now() - lastActivity.at < HEARTBEAT_MS) return
    activityInFlight = true
    lastActivity = { epoch, at: Date.now() }
    try {
      await postUsageEvents([{
        event_id: crypto.randomUUID(), event: 'active_user', feature: 'home',
        platform: isAndroidApp() ? 'android' : 'web', occurred_at: new Date().toISOString(),
      }], { auth, isCurrent: () => online() && foreground() && auth.authenticated.value && auth.authEpoch() === epoch })
    } catch { /* The next normal foreground heartbeat can try again. */ }
    finally { activityInFlight = false }
  }

  function recordView(next: string): void {
    if (currentOwner !== owner) return
    if (next === previousView) return
    previousView = next
    if (!settled.value) { initialView = next; return }
    if (!online()) return
    if (!foreground()) { pendingView = next; return }
    pendingView = undefined
    const feature = FEATURE_BY_VIEW[next]
    if (feature) recordUsage({ event: 'feature_open', feature })
    void activity()
  }
  function visibilityChanged(): void {
    if (foreground()) {
      if (pendingView) { const next = pendingView; previousView = undefined; recordView(next) }
      void activity(true)
    }
  }
  const stopView = watch(view, recordView)
  const stopConnectivity = watch(connectivity, () => {
    if (!online()) {
      discardQueue()
      pendingView = undefined
    }
  }, { flush: 'sync' })
  // The connectivity owner sets settled before projecting its first state.
  // Observe the completed Vue update rather than consuming that intermediate state.
  const stopInitialView = watch([connectivity, settled], () => {
    if (settled.value && initialView) {
      const next = initialView
      initialView = undefined
      if (online()) { previousView = undefined; recordView(next) }
    }
  })
  const stopAuth = watch([auth.authenticated, auth.authInitState, () => auth.authEpoch(), connectivity], () => {
    void activity()
  })
  onMounted(() => {
    const activate = (previous?: string) => {
      currentOwner = owner
      previousView = previous
      recordView(view.value)
      void activity()
    }
    owners.set(owner, activate)
    if (!currentOwner) activate()
    document.addEventListener('visibilitychange', visibilityChanged)
    heartbeat = setInterval(() => { void activity(true) }, HEARTBEAT_MS)
  })
  onUnmounted(() => {
    stopView()
    stopConnectivity()
    stopInitialView()
    stopAuth()
    clearInterval(heartbeat)
    document.removeEventListener('visibilitychange', visibilityChanged)
    owners.delete(owner)
    if (currentOwner === owner) {
      currentOwner = undefined
      owners.values().next().value?.(previousView)
    }
  })
}
