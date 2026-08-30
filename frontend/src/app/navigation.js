export const ANDROID_PATH = '/download/android'

export const LEGACY_VIEW_ALIASES = Object.freeze({
  leaderboard: 'hof',
  extended: 'replay',
  reconstruction: 'battle-playback',
})

export const ALLOWED_VIEWS = Object.freeze([
  'home', 'replay', 'hof', 'hof-admin',
  'profile', 'boost', 'admin-users', 'version', 'contact',
  'ai-review', 'battle-playback', 'playback-qa', 'rating-docs', 'rating-v2',
  'android',
])

export function isAndroidPath(path) {
  return path === ANDROID_PATH || path === `${ANDROID_PATH}/`
}

export function isHomeHost(hostname) {
  return hostname === 'wotbtools.com' || hostname === 'www.wotbtools.com'
}

export function defaultView(hostname = window.location.hostname) {
  return isHomeHost(hostname) ? 'home' : 'replay'
}

export function canonicalView(view) {
  return LEGACY_VIEW_ALIASES[view] ?? view
}

/** Derive a supported product view from the router's canonical location. */
export function viewFromRoute(route) {
  const rawView = route.query.view ?? (isAndroidPath(route.path) ? 'android' : null)
  const view = canonicalView(rawView)
  return ALLOWED_VIEWS.includes(view) ? view : defaultView()
}

/** Keep legacy query URLs as the public URL contract while Vue Router owns history. */
export function locationForView(view, route) {
  const query = { ...route.query }
  if (view === 'home' || view === 'android') delete query.view
  else query.view = view
  return {
    path: view === 'android' ? ANDROID_PATH : '/',
    query,
  }
}
