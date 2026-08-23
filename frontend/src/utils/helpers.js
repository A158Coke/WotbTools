import MAP_NAMES from '../../../common/map_names.json'

export const DEFAULT_VISIBLE = [
  'nickname', 'clan', 'tank_name', 'tank_type', 'survived_label',
  'kills', 'damage_dealt', 'damage_assisted',
  'contribution', 'kast', 'impact',
  'damage_received', 'damage_blocked', 'n_shots', 'n_hits_dealt', 'n_penetrations_dealt',
  'hit_rate', 'pen_rate', 'n_enemies_damaged'
]

export const EXTENDED_ONLY_PLAYER_KEYS = new Set([
  'alpha_damage', 'potential_damage', 'potential_damage_supplement', 'potential_damage_detail',
  'rank'
])

const COL_GROUP_CAT = {
  nickname: 'identity', clan: 'identity', account_id: 'extra',
  tank_name: 'vehicle', tank_tier: 'vehicle', tank_type: 'vehicle', tank_nation: 'vehicle',
  alpha_damage: 'vehicle', tank_id: 'extra',
  survived_label: 'battle', survival_time: 'battle', kills: 'battle', damage_dealt: 'battle',
  potential_damage: 'battle', potential_damage_supplement: 'battle', potential_damage_detail: 'extra',
  damage_assisted: 'battle', damage_received: 'battle', damage_blocked: 'battle',
  n_shots: 'battle', n_hits_dealt: 'battle', n_penetrations_dealt: 'battle',
  n_hits_received: 'battle', n_penetrations_received: 'battle', n_enemies_damaged: 'battle',
  contribution: 'battle', kast: 'battle', impact: 'battle',
  multi_damage_rate: 'battle', traded_deaths: 'battle',
  platoon_label: 'extra', rank: 'extra',
  battles: 'overview', wins: 'overview', win_rate: 'overview', survival_rate: 'overview',
  kills_avg: 'battle', damage: 'battle', damage_avg: 'battle', assisted: 'battle', assisted_avg: 'battle',
  received_avg: 'battle', blocked_avg: 'battle', hit_rate: 'battle', pen_rate: 'battle',
  enemies_damaged_avg: 'battle', survival_avg: 'battle', tanks: 'extra',
}

const MAP_FALLBACK_LOCALE = 'zh'

function currentMapLocale(locale) {
  if (locale) return locale
  if (typeof localStorage !== 'undefined') return localStorage.getItem('wotb-lang')
  return MAP_FALLBACK_LOCALE
}

export function fmtDuration(s, t) {
  if (s == null) return ''
  const total = Math.floor(s)
  return t('duration', { min: Math.floor(total / 60), sec: total % 60 })
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
