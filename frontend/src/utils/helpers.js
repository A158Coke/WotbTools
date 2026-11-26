import MAP_NAMES from '../../../common/map_names.json'

export const DEFAULT_VISIBLE = [
  'nickname', 'clan', 'tank_name', 'survived_label',
  'kills', 'damage_dealt', 'damage_assisted', 'damage_blocked'
]

export const AGG_DEFAULT_VISIBLE = [
  'nickname', 'clan', 'battles', 'win_rate', 'damage_avg', 'assisted_avg', 'kills_avg', 'survival_rate'
]

export const LEGACY_DEFAULT_VISIBLE = [
  ['nickname', 'clan', 'tank_name', 'tank_type', 'survived_label',
    'kills', 'damage_dealt', 'damage_assisted',
    'damage_received', 'damage_blocked', 'n_shots', 'n_hits_dealt', 'n_penetrations_dealt',
    'hit_rate', 'pen_rate', 'n_enemies_damaged'],
]

export const EXTENDED_ONLY_PLAYER_KEYS = new Set([
  'rank'
])

export const UNPRESENTABLE_COLUMN_KEYS = new Set([
  'tanks'
])

export const LEAGUE_DEFAULT_VISIBLE = [
  'nickname', 'clan', 'tank_name', 'damage_dealt', 'damage_assisted', 'kills', 'league_rating'
]

export const CW_SUMMARY_DEFAULT_VISIBLE = [
  'nickname', 'league_rating', 'clan', 'battles', 'rated_battles', 'wins', 'mvp_count', 'damage_avg'
]

export const LEGACY_CW_SUMMARY_DEFAULT_VISIBLE = [
  ['nickname', 'league_rating', 'league_observed_mean',
    'league_damage_score', 'league_assist_score', 'league_kill_score',
    'league_exchange_score', 'league_blocked_score', 'league_survival_score',
    'league_shooting_score', 'mvp_count',
    'clan', 'battles', 'rated_battles', 'wins', 'win_rate',
    'damage_avg', 'assisted_avg', 'kills_avg', 'earned_avg'],
]

export const LEAGUE_FIXED_KEYS = ['nickname', 'league_rating']

export function leagueMaxByKey(leagueColumns) {
  return Object.fromEntries((leagueColumns || []).map(c => [c.key, c.max]))
}

export function ratingTotalText(value) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '--'
  return String(Math.round(Number(value) * 10) / 10)
}

export function ratingCellText(value, key, maxByKey = {}) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '--'
  const v = Number(value)
  if (key === 'league_rating') return ratingTotalText(v)
  const max = Number(maxByKey[key]) || 0
  if (max <= 0) return String(Math.round(v * 10) / 10)
  const pct = Math.round(1000 * v / max) / 10
  return Math.round(v) + ' / ' + max + ' \u00B7 ' + pct + '%'
}

const COL_GROUP_CAT = {
  nickname: 'identity', clan: 'identity',
  gun_marks: 'vehicle', tank_name: 'vehicle', tank_tier: 'vehicle', tank_type: 'vehicle', tank_nation: 'vehicle',
  survived_label: 'battle', survival_time: 'battle', kills: 'battle', damage_dealt: 'battle',
  damage_assisted: 'battle', damage_received: 'battle', damage_blocked: 'battle',
  n_shots: 'battle', n_hits_dealt: 'battle', n_penetrations_dealt: 'battle',
  n_hits_received: 'battle', n_penetrations_received: 'battle', n_enemies_damaged: 'battle',
  multi_damage_rate: 'battle',
  league_rating: 'rating', league_observed_mean: 'rating', league_damage_score: 'rating', league_assist_score: 'rating',
  league_kill_score: 'rating', league_exchange_score: 'rating', league_blocked_score: 'rating',
  league_survival_score: 'rating', league_shooting_score: 'rating',
  victory_points_earned: 'battle',
  mvp_count: 'overview', damage_total: 'battle', assist_total: 'battle', kills_total: 'battle',
  team_name: 'identity',
  rank: 'extra',
  battles: 'overview', wins: 'overview', win_rate: 'overview', survival_rate: 'overview',
  rated_battles: 'overview',
  kills_avg: 'battle', damage: 'battle', damage_avg: 'battle', assisted: 'battle', assisted_avg: 'battle',
  received_avg: 'battle', blocked_avg: 'battle', hit_rate: 'battle', pen_rate: 'battle',
  enemies_damaged_avg: 'battle', survival_time_avg: 'battle',
}

const MAP_FALLBACK_LOCALE = 'zh'

function currentMapLocale(locale) {
  return locale || MAP_FALLBACK_LOCALE
}

export function fmtDuration(s, t) {
  if (s == null) return ''
  const total = Math.floor(s)
  return t('duration', { min: Math.floor(total / 60), sec: total % 60 })
}

export function hasChineseMapName(key) {
  const labels = MAP_NAMES[String(key || '').toLowerCase().trim()]
  return typeof labels === 'object' && labels !== null && Boolean(labels.zh)
}

export function mapLabel(m, locale) {
  const key = (m || '').toLowerCase().trim()
  if (!key) return m
  const labels = MAP_NAMES[key]
  if (!labels) return m
  if (typeof labels === 'string') return labels
  const normalizedLocale = String(currentMapLocale(locale) || MAP_FALLBACK_LOCALE)
    .toLowerCase()
    .trim()
    .split('-')[0]
  return labels[normalizedLocale] || labels[MAP_FALLBACK_LOCALE] || labels.en || m
}

export function fileKey(f) {
  return `${f.webkitRelativePath || f.name}:${f.size}:${f.lastModified}`
}

export function displayName(f) {
  return f.webkitRelativePath || f.name
}

export function catOf(key, t) {
  const c = COL_GROUP_CAT[key]
  return c ? t('col_groups.' + c) : ''
}
