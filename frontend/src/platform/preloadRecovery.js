import { tryReloadForFreshBundle } from '../utils/lazyModule.js'

const STALE_ASSET_MESSAGES = [
  /^Failed to fetch dynamically imported module:\s+(.+)$/i,
  /^error loading dynamically imported module:\s+(.+)$/i,
  /^Unable to preload CSS for\s+(.+)$/i,
]

/**
 * The browser default Resource Timing buffer is small (often 250 entries). A tab
 * kept open across deployments can fill it long before the next stale-chunk 404,
 * after which the failed request's entry may never be recorded and
 * isConfirmedStaleAsset() loses its only safe signal. Reserve headroom up front
 * and keep doubling on resourcetimingbufferfull; never clear existing entries.
 */
const RESOURCE_TIMING_BUFFER_SIZE = 1000
const installedTargets = new WeakSet()
const timingCapacityOwners = new WeakSet()

function ensureResourceTimingCapacity(performance) {
  if (typeof performance?.setResourceTimingBufferSize !== 'function') return
  if (timingCapacityOwners.has(performance)) return
  timingCapacityOwners.add(performance)

  let size = RESOURCE_TIMING_BUFFER_SIZE
  const resize = () => {
    try {
      performance.setResourceTimingBufferSize(size)
    } catch {
      // Sizing is best-effort; stale detection keeps its existing fallback.
    }
  }
  resize()
  try {
    performance.addEventListener?.('resourcetimingbufferfull', () => {
      size *= 2
      resize()
    })
  } catch {
    // No listener support: the initial reservation is still useful.
  }
}

function failedAssetUrl(error, target) {
  const message = error instanceof Error ? error.message : String(error || '')
  const rawUrl = STALE_ASSET_MESSAGES
    .map(pattern => message.match(pattern)?.[1])
    .find(Boolean)
  if (!rawUrl) return null

  try {
    const url = new URL(rawUrl, target.location.href)
    if (url.origin !== target.location.origin || !url.pathname.startsWith('/assets/')) return null
    return url.href
  } catch {
    return null
  }
}

/**
 * A Vite preload error is not enough to prove a stale deployment: transient
 * network failures emit the same event. Only auto-reload when Resource Timing
 * confirms that the same-origin hashed asset actually returned 404. Browsers
 * without responseStatus support keep the existing user-controlled error path.
 */
export function isConfirmedStaleAsset(error, target = window) {
  const url = failedAssetUrl(error, target)
  if (!url) return false
  const entries = target.performance?.getEntriesByName?.(url) || []
  return entries.at(-1)?.responseStatus === 404
}

export function installPreloadErrorRecovery(target = window) {
  // Idempotent for repeated installs (tests / HMR / future bootstrap changes): no duplicate
  // preload or resourcetimingbufferfull listeners.
  if (installedTargets.has(target)) return
  ensureResourceTimingCapacity(target.performance)
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
  installedTargets.add(target)
}
