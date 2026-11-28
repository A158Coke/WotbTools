import { isAndroidRuntime } from '../platform/runtime.js'
import { TANKOPEDIA_QUERY_KEYS } from '../shared/tankopediaQueryKeys.js'

export const ANDROID_PATH = '/download/android'
export const SPONSOR_PATH = '/sponsor'

export const LEGACY_VIEW_ALIASES = Object.freeze({
  leaderboard: 'hof',
  extended: 'replay',
  reconstruction: 'battle-playback',
})

export const ALLOWED_VIEWS = Object.freeze([
  'home', 'replay', 'hof', 'more', 'hof-admin',
  'profile', 'admin-users', 'admin-battle-data', 'admin-ai-review-feedback', 'admin-site-feedback', 'history', 'technical-evolution', 'contact',
  'ai-review', 'battle-playback', 'agent-replay', 'agent-events', 'agent-tankopedia', 'agent-mobility', 'agent-armor', 'agent-shots', 'agent-techtree',
  'agent-version-diff',
  'map-preview',
  'rating-docs', 'tournament-points', 'tournament-points-config', 'tournament-points-admin',
  'android', 'sponsor', 'league-broadcasts', 'recommendations', 'recommended-videos', 'creators', 'creators-config',
])

export const NAV_GROUPS = Object.freeze([
  Object.freeze({ id: 'battle', labelKey: 'nav.groups.battle' }),
  Object.freeze({ id: 'reference', labelKey: 'nav.groups.reference' }),
  Object.freeze({ id: 'events', labelKey: 'nav.groups.events' }),
  Object.freeze({ id: 'community', labelKey: 'nav.groups.community' }),
])

export const PRIMARY_NAV = Object.freeze([
  Object.freeze({ id: 'version-diff', view: 'agent-version-diff', labelKey: 'nav.versionChanges' }),
  Object.freeze({ id: 'home', view: 'home', labelKey: 'nav.home', homeHostOnly: true }),
  Object.freeze({ id: 'replay', view: 'replay', labelKey: 'nav.replay', group: 'battle' }),
  Object.freeze({ id: 'hof', view: 'hof', labelKey: 'nav.hof', group: 'battle' }),
  Object.freeze({ id: 'tankopedia', view: 'agent-tankopedia', labelKey: 'nav.tankopedia', group: 'reference' }),
  Object.freeze({ id: 'techtree', view: 'agent-techtree', labelKey: 'research.title', group: 'reference' }),
  Object.freeze({ id: 'maps', view: 'map-preview', labelKey: 'nav.maps', group: 'reference' }),
  Object.freeze({ id: 'tournament-points', view: 'tournament-points', labelKey: 'tournament.title', group: 'events' }),
  Object.freeze({ id: 'league-broadcasts', view: 'league-broadcasts', labelKey: 'leagueBroadcasts.title', shortLabelKey: 'leagueBroadcasts.navTitle', group: 'events' }),
  Object.freeze({ id: 'creators', view: 'recommendations', labelKey: 'creators.nav', group: 'community' }),
  Object.freeze({ id: 'more', view: 'more', labelKey: 'nav.more' }),
])

export const ADMIN_NAV = Object.freeze([
  Object.freeze({ id: 'admin-users', view: 'admin-users', labelKey: 'admin.title', role: 'admin' }),
  Object.freeze({ id: 'admin-battle-data', view: 'admin-battle-data', labelKey: 'battleDataAdmin.title', role: 'admin' }),
  Object.freeze({ id: 'admin-ai-review-feedback', view: 'admin-ai-review-feedback', labelKey: 'aiFeedback.adminTitle', role: 'admin' }),
  Object.freeze({ id: 'admin-site-feedback', view: 'admin-site-feedback', labelKey: 'siteFeedback.adminTitle', role: 'admin' }),
  Object.freeze({ id: 'hof-admin', view: 'hof-admin', labelKey: 'hofAdmin.cardTitle', role: 'hofAdmin' }),
  Object.freeze({ id: 'tournament-points-config', view: 'tournament-points-config', labelKey: 'tournament.configTitle', role: 'tournamentAdmin' }),
  Object.freeze({ id: 'tournament-points-admin', view: 'tournament-points-admin', labelKey: 'tournament.adminTitle', role: 'tournamentAdmin' }),
  Object.freeze({ id: 'creators-config', view: 'creators-config', labelKey: 'creators.configTitle', role: 'contentAdmin' }),
])

const PRIMARY_SECTION_OF_VIEW = Object.freeze({
  home: 'home',
  replay: 'replay',
  'ai-review': 'replay',
  'battle-playback': 'replay',
  'agent-replay': 'replay',
  'agent-events': 'replay',
  'agent-shots': 'replay',
  hof: 'hof',
  'agent-tankopedia': 'tankopedia',
  'agent-mobility': 'tankopedia',
  'agent-armor': 'tankopedia',
  'agent-techtree': 'techtree',
  'agent-version-diff': 'version-diff',
  'map-preview': 'maps',
  'tournament-points': 'tournament-points',
  'league-broadcasts': 'league-broadcasts',
  creators: 'creators',
  recommendations: 'creators',
  'recommended-videos': 'creators',
  'admin-users': 'admin-users',
  'admin-battle-data': 'admin-battle-data',
  'admin-ai-review-feedback': 'admin-ai-review-feedback',
  'admin-site-feedback': 'admin-site-feedback',
  'hof-admin': 'hof-admin',
  'tournament-points-config': 'tournament-points-config',
  'tournament-points-admin': 'tournament-points-admin',
  'creators-config': 'creators-config',
  profile: 'account',
})

export function primarySection(view) {
  return PRIMARY_SECTION_OF_VIEW[view] ?? 'more'
}

const WORKSPACE_SECTIONS = Object.freeze(['replay', 'maps', 'techtree'])
export function isWorkspaceView(view) {
  return view === 'agent-armor' || WORKSPACE_SECTIONS.includes(primarySection(view))
}

export function primaryNavItems(hostname = window.location.hostname) {
  const android = isAndroidRuntime()
  return PRIMARY_NAV.filter(item => !item.homeHostOnly || (!android && isHomeHost(hostname)))
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
  return !isAndroidRuntime() && isHomeHost(hostname) ? 'home' : 'replay'
}

export function canonicalView(view) {
  return LEGACY_VIEW_ALIASES[view] ?? view
}

export function viewFromRoute(route) {
  const rawView = isSponsorPath(route.path)
    ? 'sponsor'
    : route.query.view ?? (isAndroidPath(route.path) ? 'android' : null)
  const view = canonicalView(rawView)
  if (isAndroidRuntime() && view === 'home') return 'replay'
  if (!ALLOWED_VIEWS.includes(view)) return defaultView()
  return view
}

const HOF_QUERY_KEYS = ['tab', 'page', 'tank', 'nation', 'type', 'tier', 'bt', 'nick', 'limit']
const ARMOR_SCENE_QUERY_KEYS = [
  'tank', 'shooter', 'config', 'scfg', 'sengine', 'strack', 'sdev', 'shell', 'shot', 'world', 'heatmap',
  'az', 'h', 'd', 'eqcal', 'eqenh', 'eqpitch', 'quality', 'move', 'rel', 'clean', 'debug',
  'upgrade', 'abilities', 'supgrade', 'sabilities',
]
const BROADCAST_QUERY_KEYS = ['lbServer', 'lbSeason', 'lbCategory']
const MAP_PREVIEW_QUERY_KEYS = ['map', 'mode', 'bases']
const VERSION_DIFF_QUERY_KEYS = ['from', 'to']

export function locationForView(view, route) {
  const query = { ...route.query }
  if (route.query?.view === 'league-broadcasts' && view !== 'league-broadcasts') {
    for (const key of BROADCAST_QUERY_KEYS) delete query[key]
  }
  if (['creators', 'recommended-videos'].includes(route.query?.view) && view !== route.query.view) delete query.creatorCategory
  if (route.query?.view === 'creators-config' && view !== 'creators-config') delete query.recommendationType
  if ((route.query?.view === 'hof') !== (view === 'hof')) {
    for (const key of HOF_QUERY_KEYS) delete query[key]
  }
  if (view !== 'agent-mobility') {
    delete query.comparison
    delete query.mobilitySeed
    delete query.mobilityReturn
  }
  if (route.query?.view === 'agent-tankopedia' && view !== 'agent-tankopedia') {
    for (const key of TANKOPEDIA_QUERY_KEYS) delete query[key]
  }
  if (route.query?.view === 'agent-armor' && view !== 'agent-armor') {
    for (const key of ARMOR_SCENE_QUERY_KEYS) delete query[key]
  }
  if (route.query?.view === 'map-preview' && view !== 'map-preview') {
    for (const key of MAP_PREVIEW_QUERY_KEYS) delete query[key]
  }
  if (route.query?.view === 'agent-version-diff' && view !== 'agent-version-diff') {
    for (const key of VERSION_DIFF_QUERY_KEYS) delete query[key]
  }
  if (view === 'home' || view === 'android' || view === 'sponsor') delete query.view
  else query.view = view
  return {
    path: view === 'android' ? ANDROID_PATH : view === 'sponsor' ? SPONSOR_PATH : '/',
    query,
    ...(['creators', 'recommended-videos', 'recommendations', 'creators-config'].includes(view) ? { hash: route.hash } : {}),
  }
}

export function sectionTitleKey(view) {
  const section = primarySection(view)
  const item = [...primaryNavItems(), ...ADMIN_NAV].find(entry => entry.id === section)
  return item?.labelKey ?? (section === 'account' ? 'nav.account' : null)
}
