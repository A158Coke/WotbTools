import { describe, expect, it, vi } from 'vitest'
import { renderJudgmentResult } from './judgmentResult.js'

describe('失效的异步判定', () => {
  it('penSeq 递增后不回写结果卡', async () => {
    const tc = { showTrajectory: vi.fn() }
    await renderJudgmentResult({
      result: 'PENETRATION', blocked_no_primary: false, total_effective: 0,
      layers: [], probability_layers: [], probability_penetration: 0,
      ricochet: false, ricochet_remaining_pen: 0, damage: 0, he: null,
    }, { tc, isStale: () => true } as any)
    expect(tc.showTrajectory).not.toHaveBeenCalled()
  })
})