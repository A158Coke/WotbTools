/**
 * 汇总 Tab 的真实基础选手数量。
 *
 * 语义（plan §5/§10）：Replay Aggregate 永远属于 Replay Core，人数一律来自
 * `resp.aggregate`。League Rating Summary 是附加分析，其人数由 League 区块自行
 * 展示（`league.playerSummaries.length`），不得混入基础汇总人数——0 场可评分
 * 只意味着 League Summary 没数据，不意味着 Replay 汇总没数据。
 */
export function replayAggregatePlayerCount(response) {
  return Array.isArray(response?.aggregate) ? response.aggregate.length : 0
}
