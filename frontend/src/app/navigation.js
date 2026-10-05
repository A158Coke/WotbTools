export const ANDROID_PATH = '/download/android'
export const SPONSOR_PATH = '/sponsor'

export const LEGACY_VIEW_ALIASES = Object.freeze({
  leaderboard: 'hof',
  extended: 'replay',
  reconstruction: 'battle-playback',
})

export const ALLOWED_VIEWS = Object.freeze([
  'home', 'replay', 'hof', 'more', 'hof-admin',
  'profile', 'admin-users', 'history', 'technical-evolution', 'contact',
  'ai-review', 'battle-playback', 'agent-replay', 'agent-tankopedia', 'agent-armor', 'agent-shots',
  'rating-docs', 'tournament-points', 'tournament-points-config', 'tournament-points-admin',
  'android', 'sponsor',
])

/**
 * 主导航（design-language §9）：
 * - 手机 / App（compact）：底部 Tab 栏渲染 PRIMARY_NAV。
 * - 平板 / 桌面：左侧边栏渲染 PRIMARY_NAV 中除"更多"外的栏目 + 管理组（ADMIN_NAV）；
 *   "更多"在侧边栏底部是弹出面板（显示设置 + 关于与支持），不再是一个整页。
 * 账户（个人中心 / 登录登出）不在主导航里：手机在顶栏右侧，平板 / 桌面在侧边栏底部。
 * `homeHostOnly`：首页只在 wotbtools.com 上存在（本地开发默认进入回放）。
 */
export const PRIMARY_NAV = Object.freeze([
  Object.freeze({ id: 'home', view: 'home', labelKey: 'nav.home', homeHostOnly: true }),
  Object.freeze({ id: 'replay', view: 'replay', labelKey: 'nav.replay' }),
  Object.freeze({ id: 'hof', view: 'hof', labelKey: 'nav.hof' }),
  Object.freeze({ id: 'tankopedia', view: 'agent-tankopedia', labelKey: 'nav.tankopedia' }),
  Object.freeze({ id: 'more', view: 'more', labelKey: 'nav.more' }),
])

/**
 * 侧边栏管理组（平板 / 桌面）。role 由对应领域角色决定。
 */
export const ADMIN_NAV = Object.freeze([
  Object.freeze({ id: 'admin-users', view: 'admin-users', labelKey: 'admin.title', role: 'admin' }),
  Object.freeze({ id: 'hof-admin', view: 'hof-admin', labelKey: 'hofAdmin.cardTitle', role: 'hofAdmin' }),
  Object.freeze({ id: 'tournament-points-config', view: 'tournament-points-config', labelKey: 'tournament.configTitle', role: 'tournamentAdmin' }),
  Object.freeze({ id: 'tournament-points-admin', view: 'tournament-points-admin', labelKey: 'tournament.adminTitle', role: 'tournamentAdmin' }),
])

const PRIMARY_SECTION_OF_VIEW = Object.freeze({
  home: 'home',
  replay: 'replay',
  'ai-review': 'replay',
  'battle-playback': 'replay',
  'agent-replay': 'replay',
  'agent-shots': 'replay',
  hof: 'hof',
  'agent-tankopedia': 'tankopedia',
  'agent-armor': 'tankopedia',
  'admin-users': 'admin-users',
  'hof-admin': 'hof-admin',
  'tournament-points-config': 'tournament-points-config',
  'tournament-points-admin': 'tournament-points-admin',
  profile: 'account',
})

export function primarySection(view) {
  return PRIMARY_SECTION_OF_VIEW[view] ?? 'more'
}

export function primaryNavItems(hostname = window.location.hostname) {
  return PRIMARY_NAV.filter(item => !item.homeHostOnly || isHomeHost(hostname))
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

export function viewFromRoute(route) {
  const rawView = isSponsorPath(route.path)
    ? 'sponsor'
    : route.query.view ?? (isAndroidPath(route.path) ? 'android' : null)
  const view = canonicalView(rawView)
  if (!ALLOWED_VIEWS.includes(view)) return defaultView()
  return view
}

const HOF_QUERY_KEYS = ['tab', 'page', 'tank', 'nation', 'type', 'tier', 'bt', 'nick', 'limit']
const TANKOPEDIA_QUERY_KEYS = ['q', 'tier', 'nation', 'type', 'sort', 'tank', 'config']
const ARMOR_SCENE_QUERY_KEYS = [
  'tank', 'shooter', 'config', 'scfg', 'shell', 'shot', 'world', 'heatmap',
  'az', 'h', 'd', 'eqcal', 'eqenh', 'quality', 'move', 'rel', 'clean', 'debug',
]

export function locationForView(view, route) {
  const query = { ...route.query }
  if ((route.query?.view === 'hof') !== (view === 'hof')) {
    for (const key of HOF_QUERY_KEYS) delete query[key]
  }
  if (route.query?.view === 'agent-tankopedia' && view !== 'agent-tankopedia') {
    for (const key of TANKOPEDIA_QUERY_KEYS) delete query[key]
  }
  if (route.query?.view === 'agent-armor' && view !== 'agent-armor') {
    for (const key of ARMOR_SCENE_QUERY_KEYS) delete query[key]
  }
  if (view === 'home' || view === 'android' || view === 'sponsor') delete query.view
  else query.view = view
  return {
    path: view === 'android' ? ANDROID_PATH : view === 'sponsor' ? SPONSOR_PATH : '/',
    query,
  }
}

export function sectionTitleKey(view) {
  const section = primarySection(view)
  const item = [...primaryNavItems(), ...ADMIN_NAV].find(entry => entry.id === section)
  return item?.labelKey ?? (section === 'account' ? 'nav.account' : null)
}
