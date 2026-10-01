import { describe, expect, it } from 'vitest'
import { baseSide, baseView, foldAssaultProgress, foldSupremacyTransitions } from './baseStatus.js'

describe('baseStatus', () => {
  it('阵营：友方队伍未知或无主时一律中立', () => {
    expect(baseSide(1, 1)).toBe('friendly')
    expect(baseSide(2, 1)).toBe('enemy')
    expect(baseSide(null, 1)).toBe('neutral')
    expect(baseSide(1, null)).toBe('neutral')
  })

  it('争霸：只有存在占领方时才给进度', () => {
    expect(baseView({ baseId: 'C', ownerTeam: 1, capturingTeam: 2, captureProgress: 60 }, 1))
      .toEqual({ baseId: 'C', kind: 'supremacy', owner: 'friendly', capturing: 'enemy', progress: 60 })
    expect(baseView({ baseId: 'B', ownerTeam: 1, capturingTeam: null, captureProgress: 35 }, 1).progress).toBeNull()
  })

  it('单基地：恒为中性，不推断归属，只保留进度', () => {
    expect(baseView({ baseId: 'BASE', ownerTeam: 2, capturingTeam: 2, captureProgress: 72 }, 1))
      .toEqual({ baseId: 'BASE', kind: 'assault', owner: 'neutral', capturing: null, progress: 72 })
  })

  it('3D 折叠：每基地取 clock ≤ t 的最后一条，未出现的基地无主', () => {
    const tracks = [
      { clock: 10, base_id: 0, owner_team: null, capturing_team: 1, capture_progress: 20 },
      { clock: 30, base_id: 0, owner_team: 1, capturing_team: null, capture_progress: null },
      { clock: 40, base_id: 2, owner_team: null, capturing_team: 2, capture_progress: 50 },
    ]
    const at35 = foldSupremacyTransitions(tracks, 35)
    expect(at35.map((s) => s.baseId)).toEqual(['A', 'B', 'C', 'D'])
    expect(at35[0]).toMatchObject({ ownerTeam: 1, capturingTeam: null })
    expect(at35[2]).toMatchObject({ ownerTeam: null, capturingTeam: null })
    expect(foldAssaultProgress([{ clock: 5, progress: 10 }, { clock: 50, progress: 90 }], 20).captureProgress).toBe(10)
  })
})
