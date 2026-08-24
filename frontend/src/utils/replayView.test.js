import { describe, expect, it } from 'vitest'
import { replayAggregatePlayerCount } from './replayView.js'

describe('replayAggregatePlayerCount', () => {
  it('uses ordinary aggregate rows for standard replay batches', () => {
    expect(replayAggregatePlayerCount({ aggregate: Array.from({ length: 12 }) })).toBe(12)
  })

  it('uses base Replay aggregate even in League mode (League Summary is additive, not a replacement)', () => {
    // plan Case B：汇总人数必须来自 resp.aggregate，而不是 league.playerSummaries
    expect(replayAggregatePlayerCount({
      aggregate: Array.from({ length: 14 }),
      league: { playerSummaries: [] }
    })).toBe(14)
  })

  it('does not substitute League playerSummaries when aggregate is empty (0 rateable != 0 players)', () => {
    // plan Case A：0/30 可评分 → league.playerSummaries=[]，但 aggregate 为空时人数就是 0，
    // 绝不能用 league.playerSummaries.length 冒充基础汇总人数
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
