import { describe, expect, it } from 'vitest'
import { replayAggregatePlayerCount } from './replayView.js'

describe('replayAggregatePlayerCount', () => {
  it('uses ordinary aggregate rows for standard replay batches', () => {
    expect(replayAggregatePlayerCount({ aggregate: Array.from({ length: 12 }) })).toBe(12)
  })

  it('uses base Replay aggregate even in League mode (League Summary is additive, not a replacement)', () => {
    expect(replayAggregatePlayerCount({
      aggregate: Array.from({ length: 14 }),
      league: { playerSummaries: [] }
    })).toBe(14)
  })

  it('does not substitute League playerSummaries when aggregate is empty (0 rateable != 0 players)', () => {
    expect(replayAggregatePlayerCount({
      aggregate: [],
      league: { playerSummaries: Array.from({ length: 14 }) }
    })).toBe(0)
  })

  it('returns zero for missing summary data without throwing', () => {
    expect(replayAggregatePlayerCount(null)).toBe(0)
    expect(replayAggregatePlayerCount({ league: {} })).toBe(0)
  })
})
