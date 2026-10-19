const PRELOAD_RELOAD_KEY = 'wotb:preload-reload-at'
const PRELOAD_RELOAD_COOLDOWN_MS = 60_000

/**
 * Vite emits `vite:preloadError` when a lazy chunk from the currently running
 * bundle can no longer be fetched (for example after a new frontend deploy).
 * Reload once so the browser picks up the current index/bundle, but let a
 * repeated failure surface normally instead of creating a reload loop.
 */
export function installPreloadErrorRecovery(target = window) {
  target.addEventListener('vite:preloadError', event => {
    const now = Date.now()
    const previousReload = Number(target.sessionStorage.getItem(PRELOAD_RELOAD_KEY))
    if (Number.isFinite(previousReload) && previousReload > 0 && now - previousReload < PRELOAD_RELOAD_COOLDOWN_MS) {
      return
    }

    event.preventDefault()
    target.sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(now))
    target.location.reload()
  })
}
