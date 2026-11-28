import { computed, nextTick, onScopeDispose, provide, readonly, ref, watch, type Ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { Feature } from '../app/featureCapabilities.js'
import { HOF_PENDING_COUNT_KEY, type HofCountReason, type HofCountSnapshot, type HofCountStatus, type HofPendingCount } from '../shared/hofPendingCount.js'
import { useAuth } from './useAuth.js'
import { useFeatureGate } from './useFeatureGate.js'

const FRESH_MS = 30_000
const COOLDOWN_MS = 5_000
const TIMEOUT_MS = 5_000

export function provideHofPendingCount(
  view: Readonly<Ref<string>>,
  drawerOpen: Readonly<Ref<boolean>>,
  readTotals: (signal: AbortSignal) => Promise<{ hundred: number; mark3: number }>,
) {
  const auth = useAuth()
  const gate = useFeatureGate()
  function identity() {
    if (!auth.initialized.value || auth.authInitState.value !== 'authenticated' || !auth.authenticated.value || !auth.isHofAdmin.value) return null
    const claims = auth.tokenParsed.value
    if (!claims?.sub) return null
    const roles = claims.realm_access?.roles ?? []
    return JSON.stringify([claims.sub, auth.authEpoch(), roles.includes('HoF-admin'), roles.includes('wotbtools-admin')])
  }
  const availability = computed(() => {
    const feature = gate.availability(Feature.HALL_OF_FAME)
    if (feature.pending) return 'pending'
    return feature.available ? 'online' : 'offline'
  })
  const snapshot = ref<HofCountSnapshot | null>(null)
  const status = ref<HofCountStatus>('hidden')
  const reason = ref<HofCountReason | null>(null)
  let frozen: 'unauthorized' | 'forbidden' | null = null
  let generation = 0
  let scopeEpoch = 0
  let lastFailure: { at: number; reason: HofCountReason } | null = null
  let invalidated = true
  let trailing = false
  let disposed = false
  let flight: { controller: AbortController; timer: ReturnType<typeof setTimeout> } | null = null

  function cancelFlight() {
    generation++
    trailing = false
    if (!flight) return
    clearTimeout(flight.timer)
    flight.controller.abort()
    flight = null
  }

  function refresh(intent: 'passive' | 'manual' | 'invalidate' = 'passive') {
    const scope = identity()
    if (disposed || scope === null) return
    if (intent === 'invalidate') {
      invalidated = true
      generation++
      if (flight) trailing = true
    }
    if (availability.value !== 'online') return
    if (intent === 'manual') frozen = null
    if (frozen) return
    if (flight) return
    const now = Date.now()
    if (intent === 'passive') {
      if (!invalidated && snapshot.value && now - snapshot.value.sampledAt < FRESH_MS) {
        status.value = 'ready'
        reason.value = null
        return
      }
      if (lastFailure && now - lastFailure.at < COOLDOWN_MS) {
        status.value = 'unknown'
        reason.value = lastFailure.reason
        return
      }
    }
    const ticket = ++generation
    invalidated = true
    status.value = 'loading'
    reason.value = null
    const controller = new AbortController()
    const batch = { controller, timer: setTimeout(() => {
      controller.abort()
      finish(null, 'timeout')
    }, TIMEOUT_MS) }
    flight = batch
    function finish(counts: { hundred: number; mark3: number } | null, error: HofCountReason | null) {
      if (flight !== batch) return
      clearTimeout(batch.timer)
      flight = null
      if (disposed || scope !== identity() || availability.value !== 'online') return
      if (error === 'unauthorized' || error === 'forbidden') {
        frozen = error
        trailing = false
      }
      if (ticket === generation || frozen) {
        if (counts && !error) {
          snapshot.value = { ...counts, total: counts.hundred + counts.mark3, sampledAt: Date.now() }
          status.value = 'ready'
          invalidated = false
          lastFailure = null
        } else {
          const failure = error ?? 'unavailable'
          reason.value = failure
          status.value = 'unknown'
          lastFailure = { at: Date.now(), reason: failure }
        }
      }
      if (trailing) {
        trailing = false
        refresh('invalidate')
      }
    }
    void readTotals(controller.signal).then(counts => {
      const valid = [counts.hundred, counts.mark3, counts.hundred + counts.mark3].every(n => Number.isSafeInteger(n) && n >= 0)
      if (valid) finish(counts, null)
      else finish(null, 'unavailable')
    }, (error: unknown) => {
      controller.abort()
      const httpStatus = error && typeof error === 'object' && 'status' in error ? error.status : null
      if (httpStatus === 401) finish(null, 'unauthorized')
      else if (httpStatus === 403) finish(null, 'forbidden')
      else finish(null, 'unavailable')
    })
  }

  watch([identity, availability], ([scope, network], previous) => {
    cancelFlight()
    if (scope !== previous[0]) {
      scopeEpoch++
      snapshot.value = null
      invalidated = true
      frozen = null
      lastFailure = null
    }
    reason.value = frozen
    if (!scope) status.value = 'hidden'
    else if (frozen) status.value = 'unknown'
    else if (network === 'offline') { status.value = 'unknown'; reason.value = 'offline' }
    else status.value = 'loading'
    if (scope && network === 'online') void nextTick(() => refresh())
  }, { immediate: true, flush: 'sync' })
  watch(view, active => { if (active === 'hof-admin') refresh() })
  watch(drawerOpen, open => { if (open) refresh() })
  useEventListener('focus', () => refresh())
  useEventListener('online', () => refresh())
  useEventListener(document, 'visibilitychange', () => { if (document.visibilityState === 'visible') refresh() })
  onScopeDispose(() => {
    disposed = true
    cancelFlight()
    snapshot.value = null
    status.value = 'hidden'
    reason.value = null
  })
  const context: HofPendingCount = {
    snapshot: readonly(snapshot), status: readonly(status), reason: readonly(reason),
    retry: () => refresh('manual'),
    captureInvalidation() {
      const scope = identity()
      const capturedEpoch = scopeEpoch
      return () => {
        if (scope !== null && scope === identity() && capturedEpoch === scopeEpoch) refresh('invalidate')
      }
    },
  }
  provide(HOF_PENDING_COUNT_KEY, context)
  return context
}
