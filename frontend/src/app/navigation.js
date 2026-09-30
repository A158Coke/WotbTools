export const ANDROID_PATH = '/download/android'
export const SPONSOR_PATH = '/sponsor'

export const LEGACY_VIEW_ALIASES = Object.freeze({
  leaderboard: 'hof',
  extended: 'replay',
  reconstruction: 'battle-playback',
})

export const ALLOWED_VIEWS = Object.freeze([
  'home', 'replay', 'hof', 'hof-admin',
  'profile', 'admin-users', 'history', 'technical-evolution', 'contact',
  'ai-review', 'battle-playback', 'agent-replay', 'agent-tankopedia', 'agent-armor', 'agent-shots',
  'playback-qa', 'rating-docs', 'rating-v2',
  'android', 'sponsor',
])

/**
 * 仅管理员可见的视图（feature flag：`wotbtools-admin` 角色）。
 * Agent 数据平面（射击复现 / 坦克百科 / 装甲查看器）合入主干期间先小范围放量：
 * 非管理员看不到导航入口，且直达深链会被 viewFromRoute 收敛回默认视图。
 * 注意：这些视图仍在 ALLOWED_VIEWS / VIEW_COMPONENTS 登记（注册与可见性是两件事，
 * 保留登记以维持"两条清单恒等"的不变量）。
 */
export const ADMIN_ONLY_VIEWS = Object.freeze([
  'agent-replay', 'agent-tankopedia', 'agent-armor', 'agent-shots',
])

export function isAdminOnlyView(view) {
  return ADMIN_ONLY_VIEWS.includes(view)
}

export function isAndroidPath(path) {
  return path === ANDROID_PATH || path === `${ANDROID_PATH}/`
}

export function isSponsorPath(path) {
  return path === SPONSOR_PATH || path === `${SPONSOR_PATH}/`
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

/**
 * Derive a supported product view from the router's canonical location.
 *
 * `allowAdminViews` 由调用方按当前角色注入（fail-closed：缺省视为不开放）——
 * 非管理员直达 `?view=agent-*` 深链时收敛回默认视图，与隐藏导航入口共同构成
 * admin-only 功能的可见性边界。
 */
export function viewFromRoute(route, { allowAdminViews = false } = {}) {
  const rawView = isSponsorPath(route.path)
    ? 'sponsor'
    : route.query.view ?? (isAndroidPath(route.path) ? 'android' : null)
  const view = canonicalView(rawView)
  if (!ALLOWED_VIEWS.includes(view)) return defaultView()
  if (isAdminOnlyView(view) && !allowAdminViews) return defaultView()
  return view
}

/** Keep legacy query URLs as the public URL contract while Vue Router owns history. */
export function locationForView(view, route) {
  const query = { ...route.query }
  if (view === 'home' || view === 'android' || view === 'sponsor') delete query.view
  else query.view = view
  return {
    path: view === 'android' ? ANDROID_PATH : view === 'sponsor' ? SPONSOR_PATH : '/',
    query,
  }
}
