import { describe, expect, it } from 'vitest'
import { addPerfStage } from './perfStages.ts'

describe('addPerfStage（?perf 单帧分段累加）', () => {
  it('累加父/子区间但保持独立 key', () => {
    const stages = {}
    addPerfStage(stages, 'labelsUpdateMs', 2.5, 1)
    addPerfStage(stages, 'labelsProjectionMs', 0.75, 4)
    addPerfStage(stages, 'labelsUpdateMs', 1.5, 1)
    expect(stages).toEqual({
      labelsUpdateMs: 4,
      labelsUpdateMsCalls: 2,
      labelsProjectionMs: 0.75,
      labelsProjectionMsCalls: 4,
    })
  })

  it('保留计数为 0 的有效样本，不把无幽灵帧丢掉', () => {
    const stages = {}
    addPerfStage(stages, 'ghostProjected', 0, 0)
    addPerfStage(stages, 'ghostLabelDrawn', 0, 0)
    addPerfStage(stages, 'ghostProjected', 0, 2)
    expect(stages).toEqual({ ghostProjectedCount: 2, ghostLabelDrawnCount: 0 })
  })

  it('空阶段表与缺失 count 不制造 key', () => {
    expect(addPerfStage(null, 'x', 1, 1)).toBeUndefined()
    const stages = {}
    addPerfStage(stages, 'x', 1)
    expect(stages).toEqual({ x: 1 })
  })
})
