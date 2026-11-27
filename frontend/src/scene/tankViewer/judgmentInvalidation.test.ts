import { describe, expect, it, vi } from 'vitest'
import { invalidateJudgment } from './judgmentInvalidation.js'

describe('判定失效统一入口', () => {
  it('递增 penSeq 并清卡片、命中标记、点击缓存与 HUD 本次弹道', () => {
    const S = {
      jc: { bumpPenSeq: vi.fn(), clearLastClickNdc: vi.fn() },
      tc: { tidyTrajectory: vi.fn() },
      fxScene: null,
      onJudgmentDistance: vi.fn(),
    }
    invalidateJudgment(S)
    expect(S.jc.bumpPenSeq).toHaveBeenCalledOnce()
    expect(S.tc.tidyTrajectory).toHaveBeenCalledOnce()
    expect(S.jc.clearLastClickNdc).toHaveBeenCalledOnce()
    expect(S.onJudgmentDistance).toHaveBeenCalledWith(null)
  })
})