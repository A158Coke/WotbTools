/**
 * 列契约（Java `Columns` / `AggregateColumns` / `LeagueColumns`）：key + numeric + 取值，
 * 顺序即 API 列顺序。显示名由前端 i18n 映射，不在此处。
 */

import { javaRound, r1, r2 } from './java.js'
import {
  MAX_ASSIST,
  MAX_BLOCKED,
  MAX_DAMAGE,
  MAX_EXCHANGE,
  MAX_KILL,
  MAX_SHOOTING,
  MAX_SURVIVAL_TRADE,
} from './league-rating.js'
import type { PlayerResult } from './model.js'
import {
  aggAvg,
  aggHitRate,
  aggPenRate,
  aggSurvivalRate,
  aggSurvivalTimeAvg,
  aggVehicleUsage,
  aggWinRate,
  type Agg,
  type PerformanceRow,
} from './performance.js'
import type { TankInfo } from './tankopedia.js'

/** 单场玩家行取值上下文：PlayerResult + Tankopedia 展示派生（Java `Players.enrich` 回填的字段）。 */
export interface EnrichedPlayer {
  p: PlayerResult
  tank: TankInfo
}

interface PlayerColumn {
  key: string
  num: boolean
  get: (e: EnrichedPlayer) => unknown
}

/** 0-100 一位小数比例；分母 <= 0 → null（Java `Columns.rate`）。 */
function rate(denominator: number, numerator: number): number | null {
  if (denominator <= 0) return null
  return javaRound(1000.0 * numerator / denominator) / 10.0
}

/** 单场「玩家数据」表完整列（IDENTITY + STAT + TAIL）。tank_type/tank_nation/survived_label 的码值由 Mapper 转换。 */
export const PLAYER_COLUMNS: readonly PlayerColumn[] = [
  { key: 'nickname', num: false, get: ({ p }) => p.nickname },
  { key: 'clan', num: false, get: ({ p }) => p.clan },
  { key: 'tank_name', num: false, get: ({ tank }) => tank.name },
  { key: 'tank_tier', num: true, get: ({ tank }) => tank.tier },
  { key: 'tank_type', num: false, get: ({ tank }) => tank.type },
  { key: 'tank_nation', num: false, get: ({ tank }) => tank.nation },
  { key: 'survived_label', num: false, get: ({ p }) => (p.survived ? '存活' : '阵亡') },
  { key: 'kills', num: true, get: ({ p }) => p.kills },
  { key: 'damage_dealt', num: true, get: ({ p }) => p.damageDealt },
  { key: 'damage_assisted', num: true, get: ({ p }) => p.damageAssisted },
  { key: 'damage_received', num: true, get: ({ p }) => p.damageReceived },
  { key: 'damage_blocked', num: true, get: ({ p }) => p.damageBlocked },
  { key: 'survival_time', num: true, get: ({ p }) => p.survivalTimeSec },
  { key: 'n_shots', num: true, get: ({ p }) => p.nShots },
  { key: 'n_hits_dealt', num: true, get: ({ p }) => p.nHitsDealt },
  { key: 'n_penetrations_dealt', num: true, get: ({ p }) => p.nPenetrationsDealt },
  { key: 'hit_rate', num: true, get: ({ p }) => rate(p.nShots, p.nHitsDealt) },
  { key: 'pen_rate', num: true, get: ({ p }) => rate(p.nHitsDealt, p.nPenetrationsDealt) },
  { key: 'n_hits_received', num: true, get: ({ p }) => p.nHitsReceived },
  { key: 'n_penetrations_received', num: true, get: ({ p }) => p.nPenetrationsReceived },
  { key: 'n_enemies_damaged', num: true, get: ({ p }) => p.nEnemiesDamaged },
  { key: 'rank', num: true, get: ({ p }) => p.rank },
]

interface CoreColumn {
  key: string
  num: boolean
  get: (a: Agg) => unknown
}

function rateOrNull(v: number | null): number | null {
  return v === null ? null : r1(v)
}

/** 核心跨场事实列（顺序 = API aggregateColumns 顺序）。 */
export const AGGREGATE_CORE_COLUMNS: readonly CoreColumn[] = [
  { key: 'nickname', num: false, get: (a) => a.nickname },
  { key: 'clan', num: false, get: (a) => a.clan },
  { key: 'battles', num: true, get: (a) => a.battles },
  { key: 'wins', num: true, get: (a) => a.wins },
  { key: 'win_rate', num: true, get: (a) => r1(aggWinRate(a)) },
  { key: 'survival_rate', num: true, get: (a) => r1(aggSurvivalRate(a)) },
  { key: 'survival_time_avg', num: true, get: (a) => rateOrNull(aggSurvivalTimeAvg(a)) },
  { key: 'kills', num: true, get: (a) => a.kills },
  { key: 'kills_avg', num: true, get: (a) => r2(aggAvg(a, a.kills)) },
  { key: 'damage', num: true, get: (a) => a.damage },
  { key: 'damage_avg', num: true, get: (a) => r1(aggAvg(a, a.damage)) },
  { key: 'assisted', num: true, get: (a) => a.assisted },
  { key: 'assisted_avg', num: true, get: (a) => r1(aggAvg(a, a.assisted)) },
  { key: 'received_avg', num: true, get: (a) => r1(aggAvg(a, a.received)) },
  { key: 'blocked_avg', num: true, get: (a) => r1(aggAvg(a, a.blocked)) },
  { key: 'hit_rate', num: true, get: (a) => rateOrNull(aggHitRate(a)) },
  { key: 'pen_rate', num: true, get: (a) => rateOrNull(aggPenRate(a)) },
  { key: 'shots', num: true, get: (a) => a.shots },
  { key: 'hits', num: true, get: (a) => a.hits },
  { key: 'pens', num: true, get: (a) => a.pens },
  { key: 'enemies_damaged_avg', num: true, get: (a) => r2(aggAvg(a, a.enemiesDamaged)) },
  { key: 'tanks', num: false, get: (a) => aggVehicleUsage(a) },
  { key: 'earned_total', num: true, get: (a) => a.earned },
  { key: 'earned_avg', num: true, get: (a) => r1(aggAvg(a, a.earned)) },
]

interface PerfColumn {
  key: string
  num: boolean
  get: (row: PerformanceRow) => unknown
}

/** 跨场表现派生列：HP 全部 UNKNOWN 时多伤率 unavailable（null）。 */
export const AGGREGATE_PERFORMANCE_COLUMNS: readonly PerfColumn[] = [
  { key: 'multi_damage_rate', num: true, get: (row) => (row.hpEligible ? r1(row.multiDamageRate) : null) },
]

// ---------- LeagueColumns ----------

export const LEAGUE_RATING = 'league_rating'
export const LEAGUE_OBSERVED_MEAN = 'league_observed_mean'
export const VICTORY_POINTS_EARNED = 'victory_points_earned'

/** 七个 Rating 维度列 key（顺序与 dimensionScores / DIM_MAX 对齐）。 */
export const LEAGUE_DIM_KEYS: readonly string[] = [
  'league_damage_score',
  'league_assist_score',
  'league_kill_score',
  'league_exchange_score',
  'league_blocked_score',
  'league_survival_score',
  'league_shooting_score',
]

export const LEAGUE_DIM_MAX: readonly number[] = [
  MAX_DAMAGE, MAX_ASSIST, MAX_KILL, MAX_EXCHANGE, MAX_BLOCKED, MAX_SURVIVAL_TRADE, MAX_SHOOTING,
]
