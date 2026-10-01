import MAP_NAMES from '../../../common/map_names.json'

/**
 * 默认只显示 6–8 个核心列（审计 BZ-07），其余指标在「列」面板里按需打开。
 * 修改默认值时把旧值追加进对应的 LEGACY_* 列表：从未改过列的用户会迁到新默认值，自定义过的保持不变。
 */
export const DEFAULT_VISIBLE = [
  'nickname', 'clan', 'tank_name', 'survived_label',
  'kills', 'damage_dealt', 'damage_assisted', 'damage_blocked'
]

/** 汇总表（普通批次）核心列；以前默认全部可见。 */
export const AGG_DEFAULT_VISIBLE = [
  'nickname', 'clan', 'battles', 'win_rate', 'damage_avg', 'assisted_avg', 'kills_avg', 'survival_rate'
]

/** 历代默认可见列：localStorage 里的可见列与其中某一版完全相同 = 用户没改过，迁到当前默认值。 */
export const LEGACY_DEFAULT_VISIBLE = [
  ['nickname', 'clan', 'tank_name', 'tank_type', 'survived_label',
    'kills', 'damage_dealt', 'damage_assisted',
    'damage_received', 'damage_blocked', 'n_shots', 'n_hits_dealt', 'n_penetrations_dealt',
    'hit_rate', 'pen_rate', 'n_enemies_damaged'],
]

export const EXTENDED_ONLY_PLAYER_KEYS = new Set([
  'rank'
])

/**
 * B6：仍在 wire 上但不是展示列的 key——列层没有任何解析/本地化能力，
 * 必须从每个列 universe（picker / 表格 / locale label）排除。
 * `tanks` = 结构化 vehicle 使用量 `[{ tankId, battles }]`（坦克名属 Tank Knowledge，导出侧消费）。
 */
export const UNPRESENTABLE_COLUMN_KEYS = new Set([
  'tanks'
])

/** League Rating 模式默认可见列（玩家/战队/车辆/伤害/助攻/击杀/总 Rating）。 */
export const LEAGUE_DEFAULT_VISIBLE = [
  'nickname', 'clan', 'tank_name', 'damage_dealt', 'damage_assisted', 'kills', 'league_rating'
]

/**
 * CW 统一玩家表默认可见列（只有 nickname + league_rating 是
 * 固定核心列；其余列（七维/MVP/表现指标/facts）都只是默认可见，用户可隐藏、可拖拽）。
 * 七维 + MVP 默认展示（延续旧体验），但不再是 alwaysVisible 硬编码。
 */
export const CW_SUMMARY_DEFAULT_VISIBLE = [
  'nickname', 'league_rating', 'clan', 'battles', 'rated_battles', 'wins', 'mvp_count', 'damage_avg'
]

/** CW 统一玩家表历代默认值（七维与观察均值已移到「列」面板，审计 BZ-07）。 */
export const LEGACY_CW_SUMMARY_DEFAULT_VISIBLE = [
  ['nickname', 'league_rating', 'league_observed_mean',
    'league_damage_score', 'league_assist_score', 'league_kill_score',
    'league_exchange_score', 'league_blocked_score', 'league_survival_score',
    'league_shooting_score', 'mvp_count',
    'clan', 'battles', 'rated_battles', 'wins', 'win_rate',
    'damage_avg', 'assisted_avg', 'kills_avg', 'earned_avg'],
]

/** League 模式固定列（玩家 + 总 Rating；sticky 布局依据，不可隐藏/移动）。 */
export const LEAGUE_FIXED_KEYS = ['nickname', 'league_rating']

/** Rating 列满分元数据（resp.league.columns：key → max）。 */
export function leagueMaxByKey(leagueColumns) {
  return Object.fromEntries((leagueColumns || []).map(c => [c.key, c.max]))
}

/**
 * Rating 单元格文本（单场表 / CW 统一玩家表 / PNG 导出共用同一 contract）：
 * 总 Rating 只在展示层保留 1 位小数（927.4），不显示 /1000 冗余完成度
 * （唯一 formatter = ratingTotalText）；
 * 七维显示「342 / 400 · 85.5%」（max 来自后端 metadata）；
 * 缺失（null / '' / NaN）→ '--'，不冒充 0；只有真实 raw 0 才显示 0。
 */
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
  tank_name: 'vehicle', tank_tier: 'vehicle', tank_type: 'vehicle', tank_nation: 'vehicle',
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
