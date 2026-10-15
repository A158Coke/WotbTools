import { onMounted, onUnmounted, watch, type Ref } from 'vue'
import { postUsageEvents, type UsageEvent } from '../api/usage-events.js'
import { useAuth } from './useAuth.js'
import { useConnectivity } from './useConnectivity.js'
import { isAndroidApp } from './usePlatformBridge.js'
import { ConnectivityState } from '../platform/connectivity.js'

const HEARTBEAT_MS = 5 * 60_000
const FLUSH_MS = 5_000
const MAX_QUEUE = 100
const BATCH_SIZE = 20
const queue: UsageEvent[] = []
let sending = false
let flushTimer: ReturnType<typeof setTimeout> | undefined

/** No disk queue, persistent visitor identifier, file names or raw exceptions. */
export function recordUsage(input: Pick<UsageEvent, 'event' | 'feature'> & Partial<Pick<UsageEvent,
  'outcome' | 'operation_id' | 'error_code' | 'error_id'>>): void {
  try {
    if (queue.length >= MAX_QUEUE) return
    queue.push({ ...input, event_id: crypto.randomUUID(), occurred_at: new Date().toISOString(),
      platform: isAndroidApp() ? 'android' : 'web' })
    if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = undefined; void flushUsage() }, FLUSH_MS)
  } catch { /* Telemetry must never interrupt local/offline functionality. */ }
}

async function flushUsage(): Promise<void> {
  if (sending) return
  sending = true
  try {
    while (queue.length) {
      const batch = queue.splice(0, BATCH_SIZE)
      try { await postUsageEvents(batch) } catch { /* Discard; no retry/offline backlog. */ }
    }
  } finally { sending = false }
}

const FEATURE_BY_VIEW: Readonly<Record<string, UsageEvent['feature']>> = Object.freeze({
  home: 'home', 'battle-playback': 'replay_2d', 'agent-replay': 'replay_3d',
  'agent-shots': 'replay_shots', 'ai-review': 'ai_review',
  'agent-tankopedia': 'tankopedia', 'agent-armor': 'armor', hof: 'hall_of_fame',
  'tournament-points': 'tournament', android: 'android_download', sponsor: 'sponsor', profile: 'profile',
})

// One foreground lifecycle owner even if a shell is temporarily mounted twice during navigation.
let currentOwner: symbol | undefined
const owners = new Map<symbol, (previous?: string) => void>()
let lastActivity: { epoch: number; at: number } | undefined
let activityInFlight = false

/** AppShell supplies the canonical router view; query-only changes do not reopen a feature. */
export function useUsageTelemetry(view: Readonly<Ref<string>>): void {
  const auth = useAuth()
  const { connectivity } = useConnectivity()
  const owner = Symbol('usage-owner')
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let previousView: string | undefined
  let pendingView: string | undefined
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
      }], { auth, isCurrent: () => foreground() && auth.authenticated.value && auth.authEpoch() === epoch })
    } catch { /* The next normal foreground heartbeat can try again. */ }
    finally { activityInFlight = false }
  }

  function recordView(next: string): void {
    if (currentOwner !== owner) return
    if (next === previousView) return
    previousView = next
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
