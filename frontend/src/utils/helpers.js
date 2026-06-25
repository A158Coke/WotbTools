import MAP_NAMES from '../../../common/map_names.json'

export const DEFAULT_VISIBLE = [
  'nickname', 'clan', 'tank_name', 'tank_type', 'rating', 'survived_label',
  'kills', 'damage_dealt', 'damage_assisted', 'damage_received',
  'damage_blocked', 'n_shots', 'n_hits_dealt', 'n_penetrations_dealt',
  'hit_rate', 'pen_rate', 'n_enemies_damaged'
]

export const RATING_KEYS = new Set(['rating', 'rating_avg'])

export const COL_GROUP_CAT = {
  nickname: 'identity', clan: 'identity', account_id: 'extra',
  tank_name: 'vehicle', tank_tier: 'vehicle', tank_type: 'vehicle', tank_nation: 'vehicle', tank_id: 'extra',
  rating: 'battle', survived_label: 'battle', survival_time: 'battle', kills: 'battle', damage_dealt: 'battle',
  damage_assisted: 'battle', damage_received: 'battle', damage_blocked: 'battle',
  n_shots: 'battle', n_hits_dealt: 'battle', n_penetrations_dealt: 'battle',
  n_hits_received: 'battle', n_penetrations_received: 'battle', n_enemies_damaged: 'battle',
  platoon_label: 'extra',
  battles: 'overview', wins: 'overview', win_rate: 'overview', survival_rate: 'overview', rating_avg: 'overview',
  kills_avg: 'battle', damage: 'battle', damage_avg: 'battle', assisted: 'battle', assisted_avg: 'battle',
  received_avg: 'battle', blocked_avg: 'battle', hit_rate: 'battle', pen_rate: 'battle',
  enemies_damaged_avg: 'battle', survival_avg: 'battle', tanks: 'extra',
}

export const RATING_TIERS = [
  { cls: 'r-elite', key: 'elite', min: 1600 },
  { cls: 'r-great', key: 'great', min: 1300 },
  { cls: 'r-good', key: 'good', min: 1000 },
  { cls: 'r-mid', key: 'mid', min: 700 },
  { cls: 'r-poor', key: 'poor', min: 0 },
]

export const RATING_DEFAULTS = { assist: 0.6, block: 0.35, killValue: 200, winBonus: 0.05, minSamples: 5, scale: 1000, classFactor: {} }

export function fmtDuration(s, t) {
  if (s == null) return ''
  const total = Math.floor(s)
  return t('duration', { min: Math.floor(total / 60), sec: total % 60 })
}

export function ratingTier(v) {
  v = Number(v) || 0
  if (v >= 1600) return 'r-elite'
  if (v >= 1300) return 'r-great'
  if (v >= 1000) return 'r-good'
  if (v >= 700) return 'r-mid'
  return 'r-poor'
}

export function medal(rows, key, val) {
  if (!rows?.length) return ''
  let maxV = -Infinity, minV = Infinity
  for (const r of rows) {
    const v = Number(r.cells[key]) || 0
    if (v > maxV) maxV = v
    if (v < minV) minV = v
  }
  const v = Number(val) || 0
  if (v === maxV && maxV > 0) return 'first'
  if (v === minV && minV > 0) return 'last'
  return ''
}

export function tierRange(i) {
  if (i === 0) return '≥ ' + RATING_TIERS[0].min
  if (RATING_TIERS[i].min === 0) return '< ' + RATING_TIERS[i - 1].min
  return RATING_TIERS[i].min + '–' + (RATING_TIERS[i - 1].min - 1)
}

export function mapLabel(m) {
  return MAP_NAMES[(m || '').toLowerCase().trim()] || m
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
