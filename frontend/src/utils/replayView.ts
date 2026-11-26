export function replayAggregatePlayerCount(response: { aggregate?: unknown } | null | undefined) {
  return Array.isArray(response?.aggregate) ? response.aggregate.length : 0
}
