
import { UNPRESENTABLE_COLUMN_KEYS } from './helpers.js'

type Cells = Record<string, unknown>
type CwAggregateRow = { team: number; accountId: number | string; cells?: Cells | null }
type CwPlayerSummary = {
  accountId: number | string
  nickname?: string | null
  clan?: string | null
  battles?: number | null
  wins?: number | null
  damageTotal?: number | null
  assistTotal?: number | null
  killsTotal?: number | null
  rating?: number | null
  observedMean?: number | null
  dimensionMeans?: Array<number | null> | null
  mvpCount?: number | null
  ratedBattles?: number | null
}

export const CW_DIM_KEYS = [
  'league_damage_score',
  'league_assist_score',
  'league_kill_score',
  'league_exchange_score',
  'league_blocked_score',
  'league_survival_score',
  'league_shooting_score',
]

const LEAGUE_ONLY_KEYS = new Set([
  'league_rating', 'league_observed_mean', ...CW_DIM_KEYS, 'mvp_count', 'rated_battles',
])

/**
 * 合并统一玩家行（union：Aggregate ∪ League，按结构化 accountId）。
 * - 有 Aggregate 无 League：保留玩家，League 字段补 null（UI 显示 "--"，missing side）。
 * - 有 League 无 Aggregate：防御兜底——保留评分玩家，Aggregate 字段补 null（当前 contract 下
 *   CW 批次必生成 aggregate，正常不触发）。
 * @param {Array} aggregateRows resp.aggregate（每行 {team, cells, accountId}）
 * @param {Array} playerSummaries league.playerSummaries（每项 accountId/nickname/clan/ratedBattles/rating/observedMean/
 *   dimensionMeans/mvpCount/wins；dimensionMeans 原样透传到 row.league 供 Summary Radar）
 * @returns {Array<{team:number, accountId:number|string, cells:Object, league:Object|null}>}
 */
export function mergeCwPlayerRows<S extends CwPlayerSummary>(
  aggregateRows: CwAggregateRow[] | null | undefined,
  playerSummaries: S[] | null | undefined,
) {
  const summaries = (playerSummaries || []).slice()
  const byAccount = new Map(summaries.map((s): [string, S] => [String(s.accountId), s]))
  const rows = (aggregateRows || []).map(row => {
    const cells: Cells = { ...(row.cells || {}) }
    const summary = byAccount.get(String(row.accountId)) || null
    fillLeagueCells(cells, summary)
    if (summary) {
      byAccount.delete(String(row.accountId))
    }
    return { team: row.team, accountId: row.accountId, cells, league: summary as S | null }
  })
  for (const s of byAccount.values()) {
    const cells: Cells = {
      nickname: s.nickname ?? null,
      clan: s.clan ?? null,
      battles: s.battles ?? null,
      wins: s.wins ?? null,
      damage_total: s.damageTotal ?? null,
      assist_total: s.assistTotal ?? null,
      kills_total: s.killsTotal ?? null,
    }
    fillLeagueCells(cells, s)
    rows.push({ team: 0, accountId: s.accountId, cells, league: s })
  }
  return rows
}

function fillLeagueCells(cells: Cells, summary: CwPlayerSummary | null) {
  cells.league_rating = summary?.rating ?? null
  cells.league_observed_mean = summary?.observedMean ?? null
  const dims = summary?.dimensionMeans || []
  CW_DIM_KEYS.forEach((key, i) => { cells[key] = dims[i] ?? null })
  cells.mvp_count = summary?.mvpCount ?? null
  cells.rated_battles = summary?.ratedBattles ?? summary?.battles ?? null
}

/**
 * 合并统一表列定义：League 特有列（Rating + 七维 + MVP 次数）前置，
 * 其后追加 Replay Aggregate 全部列（nickname/battles/wins/win_rate/damage_avg/earned_avg 等），去重。
 * B6：wire 上仍有但不是展示列的 key（`tanks`）不进 universe。
 * @param {Array} leagueSummaryCols league.playerSummaryColumns
 * @param {Array} aggregateCols resp.aggregateColumns
 * @returns {Array<{key:string, num:boolean}>}
 */
export function mergeCwPlayerColumns<T extends { key: string }>(
  leagueSummaryCols: T[] | null | undefined,
  aggregateCols: T[] | null | undefined,
) {
  const seen = new Set<string>()
  const out: T[] = []
  for (const c of (leagueSummaryCols || [])) {
    if (!LEAGUE_ONLY_KEYS.has(c.key) || seen.has(c.key)) continue
    seen.add(c.key)
    out.push(c)
  }
  for (const c of (aggregateCols || [])) {
    if (seen.has(c.key) || UNPRESENTABLE_COLUMN_KEYS.has(c.key)) continue
    seen.add(c.key)
    out.push(c)
  }
  return out
}
