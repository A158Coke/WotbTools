import { tryReloadForFreshBundle } from '../utils/lazyModule.js'

const STALE_ASSET_MESSAGES = [
  /^Failed to fetch dynamically imported module:\s+(.+)$/i,
  /^error loading dynamically imported module:\s+(.+)$/i,
  /^Unable to preload CSS for\s+(.+)$/i,
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

    // Share the existing fresh-bundle cooldown/key with the workspace Reload
    // action, but automatic recovery is stricter: the guard must actually be
    // persisted before we suppress the import error or reload. If storage is
    // denied, keep the normal lazy-module failure UI instead of risking a
    // reload loop that cannot survive navigation.
    let guardPersisted = false
    const guardedTarget = {
      sessionStorage: {
        getItem: key => target.sessionStorage.getItem(key),
        setItem: (key, value) => {
          target.sessionStorage.setItem(key, value)
          guardPersisted = true
        },
      },
      location: {
        reload: () => {
          if (guardPersisted) target.location.reload()
        },
      },
    }

    tryReloadForFreshBundle(
      () => {
        if (guardPersisted) event.preventDefault()
      },
      guardedTarget,
    )
  })
}
