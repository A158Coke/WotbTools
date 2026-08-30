import { describe, expect, it } from 'vitest'
import {
  healthAt,
  lifeAt,
  positionCoveredAtV2,
  positionAtV2,
  orientationKnownAt,
  orientationAtV2,
  inspectVehicleAt,
  consumableRuntimeAt,
  moduleCrewAt,
} from './battlePlaybackV2'

const lh = (timeSec, currentHp, knowledge, displayCapacityHp) =>
  ({ timeSec, currentHp, knowledge, source: 'EXACT_BATTLE_EVENT', displayCapacityHp, confidence: 'HIGH' })

describe('healthAt', () => {
  it('returns last <= t health with knowledge + anti-future-leak capacity', () => {
    const track = { healthTransitions: [lh(90, 1500, 'CURRENT', 1500), lh(140, 600, 'CURRENT', 1500)] }
    expect(healthAt(track, 120)).toEqual(expect.objectContaining({ currentHp: 1500, knowledge: 'CURRENT', displayCapacityHp: 1500 }))
    expect(healthAt(track, 145).currentHp).toBe(600)
    // 120s 绝不能拿到 140s 的 600（anti-future-leak）
    expect(healthAt(track, 120).currentHp).toBe(1500)
    expect(healthAt(track, 50)).toBeNull()
  })
})

describe('lifeAt', () => {
  it('positive-HP drowning yields DESTROYED with currentHp preserved', () => {
    const track = { lifeTransitions: [{ timeSec: 150, lifeState: 'DESTROYED', destroyedKnownAtSec: 150 }] }
    const life = lifeAt(track, 160)
    expect(life.lifeState).toBe('DESTROYED')
    // death 不与 HP=0 强耦合；currentHp 由 healthAt 独立给出
    expect(healthAt({ healthTransitions: [lh(149, 500, 'CURRENT', 1500)] }, 160).currentHp).toBe(500)
  })
})

describe('positionCoveredAtV2', () => {
  it('uses OBSERVED segments as AoI boundary, not 5s rule', () => {
    const segs = [{ startSec: 0, endSec: 100, knowledge: 'OBSERVED' }, { startSec: 140, endSec: 200, knowledge: 'OBSERVED' }]
    expect(positionCoveredAtV2(segs, 50)).toBe(true)
    expect(positionCoveredAtV2(segs, 120)).toBe(false) // hidden interval
    expect(positionCoveredAtV2(segs, 160)).toBe(true)
  })
})

describe('positionAtV2', () => {
  it('interpolates within OBSERVED segment, freezes outside (no cross-gap)', () => {
    const segs = [
      { knowledge: 'OBSERVED', startSec: 0, endSec: 100, samples: [
        { timeSec: 0, x: 0, y: 0 }, { timeSec: 100, x: 100, y: 50 },
      ] },
    ]
    const mid = positionAtV2(segs, 50)
    expect(mid.x).toBeCloseTo(50, 5)
    expect(mid.y).toBeCloseTo(25, 5)
    // 段外（hidden）：返回最后已知
    expect(positionAtV2(segs, 120).timeSec).toBe(100)
  })

  it('anti-future-leak: future-only OBSERVED segment is invisible (never leaks 186s)', () => {
    // plan §26: currentTime=23, 敌方第一次观测=186 → 绝不能提前显示
    const segs = [
      { knowledge: 'OBSERVED', startSec: 186, endSec: 190, samples: [{ timeSec: 186, x: 999, y: 888 }] },
    ]
    expect(positionAtV2(segs, 23)).toBeNull()
    expect(positionAtV2(segs, 186).x).toBe(999)
  })

  it('anti-future-leak: past + future OBSERVED returns only last <= t (never 186)', () => {
    const segs = [
      { knowledge: 'OBSERVED', startSec: 10, endSec: 15, samples: [{ timeSec: 10, x: 10, y: 20 }, { timeSec: 15, x: 11, y: 21 }] },
      { knowledge: 'OBSERVED', startSec: 186, endSec: 190, samples: [{ timeSec: 186, x: 999, y: 888 }] },
    ]
    const pos = positionAtV2(segs, 23)
    expect(pos.timeSec).toBe(15)
    expect(pos.x).toBe(11)
    expect(pos.x).not.toBe(999)
  })

  it('anti-future-leak: future LAST_KNOWN segment must not freeze into lastSeen', () => {
    // plan §17：不得因为段标记为 LAST_KNOWN 就取它的最后样本
    const segs = [
      { knowledge: 'OBSERVED', startSec: 10, endSec: 15, samples: [{ timeSec: 10, x: 10, y: 20 }, { timeSec: 15, x: 11, y: 21 }] },
      { knowledge: 'LAST_KNOWN', startSec: 186, endSec: 190, samples: [{ timeSec: 186, x: 500, y: 500 }, { timeSec: 190, x: 600, y: 600 }] },
    ]
    const pos = positionAtV2(segs, 23)
    expect(pos.timeSec).toBe(15)
    expect(pos.x).toBe(11)
  })
})

describe('orientationAtV2', () => {
  it('returns frozen last sample for LAST_KNOWN segment', () => {
    const segs = [{ knowledge: 'LAST_KNOWN', startSec: 100, endSec: 100,
      samples: [{ timeSec: 100, hullYawDeg: 30, turretRelativeYawDeg: 10 }] }]
    const o = orientationAtV2(segs, 120)
    expect(o.hullYawDeg).toBe(30)
    expect(o.turretRelativeYawDeg).toBe(10)
  })

  it('anti-future-leak: all samples > t => null; past+future => last <= t only', () => {
    const future = [{ knowledge: 'CURRENT', startSec: 186, endSec: 190,
      samples: [{ timeSec: 186, hullYawDeg: 90, turretRelativeYawDeg: 5 }] }]
    expect(orientationAtV2(future, 23)).toBeNull()

    const mixed = [
      { knowledge: 'CURRENT', startSec: 10, endSec: 100, samples: [
        { timeSec: 10, hullYawDeg: 30, turretRelativeYawDeg: 0 }, { timeSec: 100, hullYawDeg: 40, turretRelativeYawDeg: 5 },
      ] },
      { knowledge: 'CURRENT', startSec: 186, endSec: 190, samples: [{ timeSec: 186, hullYawDeg: 99, turretRelativeYawDeg: 9 }] },
    ]
    const o = orientationAtV2(mixed, 120)
    expect(o.hullYawDeg).toBe(40)
    expect(o.hullYawDeg).not.toBe(99)
  })
})

describe('orientationKnownAt', () => {
  it('enemy leaves AoI => LAST_KNOWN, not real-time turret direction', () => {
    const track = { orientationSegments: [{ startSec: 0, endSec: 100, knowledge: 'CURRENT', samples: [] }] }
    expect(orientationKnownAt(track, 50)).toBe('CURRENT')
    expect(orientationKnownAt(track, 120)).toBe('LAST_KNOWN')
    expect(orientationKnownAt(track, 200)).toBe('LAST_KNOWN')
  })
})

describe('inspectVehicleAt', () => {
  it('loadout persists after enemy disappears; consumable runtime UNKNOWN during hidden', () => {
    const track = {
      accountId: 2002,
      playerName: 'enemy',
      tankId: 456,
      tankName: 'Enemy',
      tankClass: 'Medium tank',
      team: 2,
      friendly: false,
      loadout: { consumables: ['REPAIR_KIT', null, 'ADRENALINE'], provisions: ['SANDBAG_ARMOR', null, null], equipmentIds: [100, 108, 114, 104, 111, 117, 106, 113, 101] },
      positionSegments: [{ startSec: 90, endSec: 100, knowledge: 'OBSERVED', samples: [] }],
      orientationSegments: [{ startSec: 90, endSec: 100, knowledge: 'CURRENT', samples: [] }],
      healthTransitions: [lh(90, 1200, 'CURRENT', 1200)],
      lifeTransitions: [],
    }
    const beforeLeave = inspectVehicleAt(track, 95)
    expect(beforeLeave.loadoutKnown).toBe(true)
    expect(beforeLeave.positionCovered).toBe(true)
    // t=120：hidden interval —— loadout 仍 KNOWN（持久配置），但 positionCovered=false
    const hidden = inspectVehicleAt(track, 120)
    expect(hidden.loadoutKnown).toBe(true)
    expect(hidden.health.currentHp).toBe(1200) // last-known HP preserved
    expect(hidden.positionCovered).toBe(false)
  })
})

describe('consumableRuntimeAt / moduleCrewAt', () => {
  it('hidden interval runtime is UNKNOWN, not READY', () => {
    const transitions = [{ timeSec: 90, logicalItemId: 'REPAIR_KIT', state: 'ACTIVATED', wireCode: 0x0D }]
    expect(consumableRuntimeAt(transitions, 120).state).toBe('ACTIVATED')
  })

  it('module/crew keeps recorderVisible provenance', () => {
    const t = moduleCrewAt([{ timeSec: 120, component: 'ENGINE', state: 'CRITICAL_DISABLED', recorderVisible: true, confidence: 'HIGH' }], 130)
    expect(t.recorderVisible).toBe(true)
    expect(t.component).toBe('ENGINE')
  })
})
