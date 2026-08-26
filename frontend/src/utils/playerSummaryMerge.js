/**
 * CW 统一玩家表数据合并：
 * 以 Replay Aggregate（Replay Core，覆盖全部已解析 CW 场次与玩家）为基底，
 * 按 accountId join League Player Summary（Rating 附加字段）。
 *
 * - join identity 一律 accountId，禁止 array index / nickname / row order。
 * - 缺失侧（有 Aggregate 无 League Rating）保留玩家，League 字段补 null → UI 显示 "--"（missing side）。
 * - 样本语义分离：cells.battles = Replay Aggregate 解析场次（不被 League 覆盖）；
 *   cells.rated_battles = League Player Summary 评分场次（LeaguePlayerSummary.battles，rated-only）。
 * - Performance Metrics（contribution/kast/impact）为跨场 aggregate 样本；仅当某评分玩家
 *   在 aggregate 中缺失（防御路径，见 mergeCwPlayerRows）时，才取 league playerSummary
 *   携带的跨场值兜底。
 *
 * 生产 contract：CW 批次必生成基础 Replay Aggregate（shouldAggregate = battles.size() > 1
 * || league != null），因此「单场 CW 无 aggregate」不是合法状态——League-only 分支只为
 * aggregate 侧数据形状变化（如未来过滤/裁剪）保留 union 兜底，正常不触发。
 */

/** League Rating 七维列 key（顺序与后端 LeagueColumns.DIM_KEYS 一致）。 */
export const CW_DIM_KEYS = [
  'league_damage_score',
  'league_assist_score',
  'league_kill_score',
  'league_exchange_score',
  'league_blocked_score',
  'league_survival_score',
  'league_shooting_score',
]

/** League 特有、aggregate 不持有的列（统一表列定义中前置插入）。
 * rated_battles 也来自 league.playerSummaryColumns（评分场次 ≠ 解析场次），
 * 必须进入 cw 列 universe（ColumnPicker 可显示/隐藏/reorder）。 */
const LEAGUE_ONLY_KEYS = new Set([
  'league_rating', 'league_rating_raw_median', ...CW_DIM_KEYS, 'mvp_count', 'rated_battles',
])

/**
 * 合并统一玩家行（union：Aggregate ∪ League，按 accountId）。
 * - 有 Aggregate 无 League：保留玩家，League 字段补 null（UI 显示 "--"，missing side）。
 * - 有 League 无 Aggregate：防御兜底——保留评分玩家，Aggregate 字段补 null（当前 contract 下
 *   CW 批次必生成 aggregate，正常不触发）。
 * @param {Array} aggregateRows resp.aggregate（每行 {team, cells}，cells 含 account_id）
 * @param {Array} playerSummaries league.playerSummaries（每项 accountId/nickname/clan/battles/ratingV5/ratingRawMedian/
 *   dimensionMedians/dimensionMeans/mvpCount/wins；dimensionMeans 原样透传到 row.league 供 Summary Radar）
 * @returns {Array<{team:number, cells:Object, league:Object|null}>}
 */
export function mergeCwPlayerRows(aggregateRows, playerSummaries) {
  const summaries = (playerSummaries || []).slice()
  const byAccount = new Map(summaries.map(s => [String(s.accountId), s]))
  const rows = (aggregateRows || []).map(row => {
    const cells = { ...(row.cells || {}) }
    const summary = byAccount.get(String(cells.account_id)) || null
    fillLeagueCells(cells, summary)
    if (summary) {
      byAccount.delete(String(cells.account_id))
    }
    return { team: row.team, cells, league: summary }
  })
  // 防御兜底：playerSummary 中存在但 aggregate 未覆盖的玩家（当前 contract 下 CW 批次
  // 必生成 aggregate，正常不触发）——保留评分玩家，Aggregate 字段补 null。
  for (const s of byAccount.values()) {
    const cells = {
      account_id: s.accountId,
      nickname: s.nickname ?? null,
      clan: s.clan ?? null,
      battles: s.battles ?? null,
      wins: s.wins ?? null,
      damage_total: s.damageTotal ?? null,
      assist_total: s.assistTotal ?? null,
      kills_total: s.killsTotal ?? null,
    }
    fillLeagueCells(cells, s, true)
    rows.push({ team: 0, cells, league: s })
  }
  return rows
}

/** 把 League summary 字段写入统一行 cells（V5 主 Rating / Raw Observed Median / 七维中位数 /
 * MVP 次数 / 评分场次；
 * includePerf=true 时附加跨场 Performance Metrics，仅用于 aggregate 未覆盖的兜底行，
 * 绝不覆盖 aggregate 样本）。
 */
function fillLeagueCells(cells, summary, includePerf = false) {
  // V5：league_rating = Batch Player Rating（Evidence Adjustment 后主 Rating）；
  // league_rating_raw_median = Raw Observed Median（explainability，可隐藏）。
  cells.league_rating = summary?.ratingV5 ?? null
  cells.league_rating_raw_median = summary?.ratingRawMedian ?? null
  const dims = summary?.dimensionMedians || []
  CW_DIM_KEYS.forEach((key, i) => { cells[key] = dims[i] ?? null })
  cells.mvp_count = summary?.mvpCount ?? null
  // 评分场次（rated-only 样本，独立于 aggregate 的解析场次）
  cells.rated_battles = summary?.battles ?? null
  // 跨场 Performance Metrics：只给 aggregate 未覆盖的兜底行补值
  if (includePerf) {
    cells.contribution = summary?.contribution ?? null
    cells.kast = summary?.kast ?? null
    cells.impact = summary?.impact ?? null
  }
}

/**
 * 合并统一表列定义：League 特有列（Rating + 七维 + MVP 次数）前置，
 * 其后追加 Replay Aggregate 全部列（nickname/battles/wins/win_rate/damage_avg/earned_avg 等），去重。
 * @param {Array} leagueSummaryCols league.playerSummaryColumns
 * @param {Array} aggregateCols resp.aggregateColumns
 * @returns {Array<{key:string, num:boolean}>}
 */
export function mergeCwPlayerColumns(leagueSummaryCols, aggregateCols) {
  const seen = new Set()
  const out = []
  for (const c of (leagueSummaryCols || [])) {
    if (!LEAGUE_ONLY_KEYS.has(c.key) || seen.has(c.key)) continue
    seen.add(c.key)
    out.push(c)
  }
  for (const c of (aggregateCols || [])) {
    if (seen.has(c.key)) continue
    seen.add(c.key)
    out.push(c)
  }
  return out
}
