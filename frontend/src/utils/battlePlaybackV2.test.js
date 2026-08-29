import { describe, expect, it } from 'vitest'
import {
  healthAt,
  lifeAt,
  positionCoveredAtV2,
  orientationKnownAt,
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
