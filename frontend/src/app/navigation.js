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
  'rating-docs',
  'android', 'sponsor',
])

/**
 * 仅管理员可见的视图（feature flag：`wotbtools-admin` 角色）。
 * Agent 数据平面（3D 回放 / 射击分析 / 装甲查看器）仍在内测；坦克百科已公开（2026-10-01）。
 * 非管理员看不到导航入口，且直达深链会被 viewFromRoute 收敛回默认视图。
 * 注意：这些视图仍在 ALLOWED_VIEWS / VIEW_COMPONENTS 登记（注册与可见性是两件事，
 * 保留登记以维持"两条清单恒等"的不变量）。
 */
export const ADMIN_ONLY_VIEWS = Object.freeze([
  'agent-replay', 'agent-armor', 'agent-shots',
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
 * 侧边栏管理组（平板 / 桌面）。`role`：'admin' = wotbtools-admin；'hofAdmin' = HoF-admin 或全站管理员。
 * 手机没有侧边栏，这些入口留在"更多"页的管理分组里。
 */
export const ADMIN_NAV = Object.freeze([
  Object.freeze({ id: 'admin-users', view: 'admin-users', labelKey: 'admin.title', role: 'admin' }),
  Object.freeze({ id: 'hof-admin', view: 'hof-admin', labelKey: 'hofAdmin.cardTitle', role: 'hofAdmin' }),
])

// 视图 → 所属栏目。个人中心属于账户入口；管理视图各自是侧边栏的一项；
// 未列出的视图（设置、关于等）都归入"更多"。
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
  profile: 'account',
})

export function primarySection(view) {
  return PRIMARY_SECTION_OF_VIEW[view] ?? 'more'
}

export function primaryNavItems(hostname = window.location.hostname) {
  return PRIMARY_NAV.filter(item => !item.homeHostOnly || isHomeHost(hostname))
}

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

/** 名人堂写进 URL 的筛选键（utils/hofQuery.js）：只属于 hof，导航到别的页面时丢掉。 */
const HOF_QUERY_KEYS = ['tab', 'page', 'tank', 'nation', 'type', 'tier', 'bt', 'nick', 'limit']
/** 坦克百科写进 URL 的筛选 / 详情键（utils/tankopediaQuery.js）：离开百科时丢掉，不带到别的页面。 */
const TANKOPEDIA_QUERY_KEYS = ['q', 'tier', 'nation', 'type', 'sort', 'tank', 'config']

/** Keep legacy query URLs as the public URL contract while Vue Router owns history. */
export function locationForView(view, route) {
  const query = { ...route.query }
  // 进出名人堂都丢掉这些键：既不把筛选带到别的页面，也不把别处同名参数（如坦克百科的 tank）当成名人堂筛选
  if ((route.query?.view === 'hof') !== (view === 'hof')) {
    for (const key of HOF_QUERY_KEYS) delete query[key]
  }
  if (route.query?.view === 'agent-tankopedia' && view !== 'agent-tankopedia') {
    for (const key of TANKOPEDIA_QUERY_KEYS) delete query[key]
  }
  if (view === 'home' || view === 'android' || view === 'sponsor') delete query.view
  else query.view = view
  return {
    path: view === 'android' ? ANDROID_PATH : view === 'sponsor' ? SPONSOR_PATH : '/',
    query,
  }
}

/** 当前页面所属一级区块的标题 key（顶栏紧凑标题与 document.title 共用）；不属于任何区块时为 null。 */
export function sectionTitleKey(view) {
  const section = primarySection(view)
  const item = [...primaryNavItems(), ...ADMIN_NAV].find(entry => entry.id === section)
  return item?.labelKey ?? (section === 'account' ? 'nav.account' : null)
}
