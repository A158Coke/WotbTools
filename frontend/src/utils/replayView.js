export function replayAggregatePlayerCount(response) {
  if (response?.league) {
    return Array.isArray(response.league.playerSummaries)
      ? response.league.playerSummaries.length
      : 0
  }
  return Array.isArray(response?.aggregate) ? response.aggregate.length : 0
}
