import { tryReloadForFreshBundle } from '../utils/lazyModule.js'

const STALE_ASSET_MESSAGES = [
  /^Failed to fetch dynamically imported module:\s+(.+)$/i,
  /^error loading dynamically imported module:\s+(.+)$/i,
  /^Unable to preload CSS for\s+(.+)$/i,
]

/**
 * The browser default Resource Timing buffer is small (often 250 entries). A tab
 * kept open across deployments can fill it long before the next stale-chunk 404,
 * after which the failed request's entry may never reach the primary buffer.
 * Reserve headroom up front and keep doubling on resourcetimingbufferfull; never
 * clear existing entries. Correctness still comes from the observer below.
 */
const RESOURCE_TIMING_BUFFER_SIZE = 1000
/** Cap browser-side retention; the observer cache, not the main buffer, is the correctness source. */
const RESOURCE_TIMING_BUFFER_MAX = 4000
/** Only keep enough recent resource records for URL correlation; never a telemetry store. */
const RESOURCE_TIMING_RECENT_LIMIT = 200

/** One recovery state per target: timing capacity, observer cache and installed flag. */
const recoveryStates = new WeakMap<object, RecoveryState>()

type ResourceRecord = { name: string; responseStatus: number }

type RecoveryState = {
  installed: boolean
  timingBufferSize: number
  recentResources: Map<string, ResourceRecord>
  takePending(): void
}

type RecoveryTarget = Window & typeof globalThis

function ensureRecoveryState(target: RecoveryTarget) {
  let state = recoveryStates.get(target)
  if (state) return state

  const created: RecoveryState = {
    installed: false,
    timingBufferSize: RESOURCE_TIMING_BUFFER_SIZE,
    recentResources: new Map(),
    takePending() {},
  }
  recoveryStates.set(target, created)
  ensureResourceTimingCapacity(target, created)
  ensureResourceTimingObserver(target, created)
  return created
}

function ensureResourceTimingCapacity(target: RecoveryTarget, state: RecoveryState) {
  const performance = target.performance
  if (typeof performance?.setResourceTimingBufferSize !== 'function') return

  const resize = () => {
    try {
      performance.setResourceTimingBufferSize(state.timingBufferSize)
    } catch {
      // Sizing is best-effort; stale detection keeps its existing fallback.
    }
  }
  resize()
  try {
    performance.addEventListener?.('resourcetimingbufferfull', () => {
      const next = Math.min(state.timingBufferSize * 2, RESOURCE_TIMING_BUFFER_MAX)
      if (next === state.timingBufferSize) return
      state.timingBufferSize = next
      resize()
    })
  } catch {
    // No listener support: the initial reservation is still useful.
  }
}

function sameOriginAssetUrl(rawUrl: string | null | undefined, target: RecoveryTarget) {
  if (!rawUrl) return null
  try {
    const url = new URL(rawUrl, target.location.href)
    if (url.origin !== target.location.origin || !url.pathname.startsWith('/assets/')) return null
    return url.href
  } catch {
    return null
  }
}

function failedAssetUrl(error: unknown, target: RecoveryTarget) {
  const message = error instanceof Error ? error.message : String(error || '')
  const rawUrl = STALE_ASSET_MESSAGES
    .map(pattern => message.match(pattern)?.[1])
    .find(Boolean)
  return sameOriginAssetUrl(rawUrl, target)
}

/**
 * Performance Timeline queues a resource entry to observers before the resource
 * timing buffer logic runs. Keeping a bounded recent cache plus takeRecords()
 * lets the synchronous preloadError decision see a 404 even when that entry is
 * still in the secondary buffer or has not reached getEntriesByName() yet.
 */
function ensureResourceTimingObserver(target: RecoveryTarget, state: RecoveryState) {
  const performance = target.performance
  if (typeof performance?.getEntriesByName !== 'function') return
  const PerformanceObserverCtor = target.PerformanceObserver
  if (typeof PerformanceObserverCtor !== 'function') return

  const remember = (entry: PerformanceResourceTiming) => {
    const name = sameOriginAssetUrl(entry?.name, target)
    if (!name) return
    const record = { name, responseStatus: entry.responseStatus }
    // Move updated URLs to the end so the bounded map evicts the least recently seen asset.
    state.recentResources.delete(name)
    state.recentResources.set(name, record)
    while (state.recentResources.size > RESOURCE_TIMING_RECENT_LIMIT) {
      state.recentResources.delete(state.recentResources.keys().next().value as string)
    }
  }

  let observer: PerformanceObserver | undefined
  try {
    observer = new PerformanceObserverCtor((list) => {
      try {
        for (const entry of list.getEntries()) remember(entry as PerformanceResourceTiming)
      } catch {
        // Best-effort observation; getEntriesByName remains the URL-ful fallback.
      }
    })
    observer.observe({ type: 'resource', buffered: true })
  } catch {
    try {
      observer?.observe({ entryTypes: ['resource'] })
    } catch {
      return
    }
  }

  state.takePending = () => {
    try {
      for (const entry of observer!.takeRecords()) remember(entry as PerformanceResourceTiming)
    } catch {
      // Partial implementations still expose entries delivered via callback.
    }
  }
}

/**
 * A Vite preload error is not enough to prove a stale deployment: transient
 * network failures emit the same event. Only auto-reload when a same-origin
 * hashed asset is confirmed 404. A URL-less Safari dynamic-import failure cannot
 * be safely correlated with one specific resource entry, so it intentionally
 * fails closed and keeps the existing user-controlled error path.
 */
export function isConfirmedStaleAsset(error: unknown, target: RecoveryTarget = window) {
  const state = recoveryStates.get(target)
  state?.takePending()

  const url = failedAssetUrl(error, target)
  if (!url) return false
  return isConfirmedAsset404(url, target, state)
}

function isConfirmedAsset404(url: string, target: RecoveryTarget, state: RecoveryState | undefined) {
  const recent = state?.recentResources.get(url)
  if (recent) return recent.responseStatus === 404
  const entries = target.performance?.getEntriesByName?.(url) || []
  return (entries.at(-1) as PerformanceResourceTiming | undefined)?.responseStatus === 404
}

export function installPreloadErrorRecovery(target: RecoveryTarget = window) {
  const state = ensureRecoveryState(target)
  if (state.installed) return
  target.addEventListener('vite:preloadError', event => {
    if (!isConfirmedStaleAsset(event.payload, target)) return

    // Share the existing fresh-bundle cooldown/key with the workspace Reload
    // action, but automatic recovery is stricter: the guard must actually be
    // persisted before we suppress the import error or reload. If storage is
    // denied, keep the normal lazy-module failure UI instead of risking a
    // reload loop that cannot survive navigation.
    tryReloadForFreshBundle(
      () => event.preventDefault(),
      target,
      { requirePersistentGuard: true },
    )
  })
  state.installed = true
}
