import { tryReloadForFreshBundle } from '../utils/lazyModule.js'

const STALE_ASSET_MESSAGES = [
  /^Failed to fetch dynamically imported module:\s+(.+)$/,
  /^Unable to preload CSS for\s+(.+)$/,
]

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
  target.addEventListener('vite:preloadError', event => {
    if (!isConfirmedStaleAsset(event.payload, target)) return

    // Share the existing fresh-bundle guard with the workspace Reload action.
    // Suppress Vite's throw only when this call will really reload; if the guard
    // blocks a second attempt, let the normal lazy-module boundary show the error.
    tryReloadForFreshBundle(() => event.preventDefault(), target)
  })
}
