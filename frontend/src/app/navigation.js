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
  Object.freeze({ id: 'tournament-points', view: 'tournament-points', labelKey: 'tournament.title' }),
  Object.freeze({ id: 'more', view: 'more', labelKey: 'nav.more' }),
])

/**
 * 侧边栏管理组（平板 / 桌面）。role 对应 useAuth 的各域管理权限；全站管理员具备所有管理入口。
 * 手机没有侧边栏，这些入口留在"更多"页的管理分组里。
 */
export const ADMIN_NAV = Object.freeze([
  Object.freeze({ id: 'admin-users', view: 'admin-users', labelKey: 'admin.title', role: 'admin' }),
  Object.freeze({ id: 'hof-admin', view: 'hof-admin', labelKey: 'hofAdmin.cardTitle', role: 'hofAdmin' }),
  Object.freeze({ id: 'tournament-points-config', view: 'tournament-points-config', labelKey: 'tournament.configTitle', role: 'tournamentAdmin' }),
  Object.freeze({ id: 'tournament-points-admin', view: 'tournament-points-admin', labelKey: 'tournament.adminTitle', role: 'tournamentAdmin' }),
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
  'tournament-points': 'tournament-points',
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

/**
 * Derive a supported product view from the router's canonical location.
 * Authentication gates belong to capability/page hosts; deep links remain discoverable.
 */
export function viewFromRoute(route) {
  const rawView = isSponsorPath(route.path)
    ? 'sponsor'
    : route.query.view ?? (isAndroidPath(route.path) ? 'android' : null)
  const view = canonicalView(rawView)
  if (!ALLOWED_VIEWS.includes(view)) return defaultView()
  return view
}

/** 名人堂写进 URL 的筛选键（utils/hofQuery.js）：只属于 hof，导航到别的页面时丢掉。 */
const HOF_QUERY_KEYS = ['tab', 'page', 'tank', 'nation', 'type', 'tier', 'bt', 'nick', 'limit']
/** 坦克百科写进 URL 的筛选 / 详情键（utils/tankopediaQuery.js）：离开百科时丢掉，不带到别的页面。 */
const TANKOPEDIA_QUERY_KEYS = ['q', 'tier', 'nation', 'type', 'sort', 'tank', 'config']
/**
 * 装甲查看器 / 射击复现场景写进 URL 的键（`AgentShots.srViewerUrl` 的交接链接 + `tankViewer` 的 QP 读取）：
 * tank / shooter / config / scfg / shell / shot / world / heatmap，加相机与显示档（az / h / d / eqcal / …）
 * 与 `clean` / `debug` 这类只对该场景有意义的开关。它们**只属于该视图**——不清理的话，
 * 从场景里用侧边栏切走，URL 会变成 ?view=replay&tank=…&shot=…&world=1&heatmap=1（用户实测反馈）。
 *
 * 清理方向与坦克百科一致：只处理**离开**场景。进入方向一律保留——这些键就是目的地的参数，
 * 而"射击分析 → 装甲查看器"的交接（`ReplayShotsPane.openInViewer`）与坦克百科入口
 * （`AgentTankopedia` 的 router.push）都不经本函数；但任何以 URL 表达的交接都不该在入场时被吞掉。
 */
const ARMOR_SCENE_QUERY_KEYS = [
  'tank', 'shooter', 'config', 'scfg', 'shell', 'shot', 'world', 'heatmap',
  'az', 'h', 'd', 'eqcal', 'eqenh', 'quality', 'move', 'rel', 'clean', 'debug',
]

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
  // 离开装甲场景时丢掉场景参数（进入方向见上面 ARMOR_SCENE_QUERY_KEYS 的说明）
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

/** 当前页面所属一级区块的标题 key（顶栏紧凑标题与 document.title 共用）；不属于任何区块时为 null。 */
export function sectionTitleKey(view) {
  const section = primarySection(view)
  const item = [...primaryNavItems(), ...ADMIN_NAV].find(entry => entry.id === section)
  return item?.labelKey ?? (section === 'account' ? 'nav.account' : null)
}
