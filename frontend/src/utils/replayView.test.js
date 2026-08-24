import { describe, expect, it } from 'vitest'
import { replayAggregatePlayerCount } from './replayView.js'

describe('replayAggregatePlayerCount', () => {
  it('uses ordinary aggregate rows for standard replay batches', () => {
    expect(replayAggregatePlayerCount({ aggregate: Array.from({ length: 12 }) })).toBe(12)
  })

  it('uses League playerSummaries even when aggregate is intentionally empty', () => {
    expect(replayAggregatePlayerCount({
      aggregate: [],
      league: { playerSummaries: Array.from({ length: 14 }) }
    })).toBe(14)
  })

  it('returns zero for missing summary data without throwing', () => {
    expect(replayAggregatePlayerCount(null)).toBe(0)
    expect(replayAggregatePlayerCount({ league: {} })).toBe(0)
  })
})
