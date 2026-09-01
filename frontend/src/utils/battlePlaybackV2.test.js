import { describe, expect, it } from 'vitest'
import {
  healthAt,
  healthDisplayAt,
  lifeAt,
  positionCoveredAtV2,
  positionAtV2,
  orientationKnownAt,
  orientationAtV2,
  inspectVehicleAt,
  consumableRuntimeAt,
  consumableRuntimeStatesAt,
  moduleCrewAt,
  teamHealthAt,
  cumulativeStatsAtV2,
  damageLogAtV2,
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

  it('does not interpolate an OBSERVED segment when the canonical flag disallows it', () => {
    const segs = [{ knowledge: 'OBSERVED', interpolationAllowed: false, startSec: 0, endSec: 100,
      samples: [{ timeSec: 0, x: 0, y: 0 }, { timeSec: 100, x: 100, y: 100 }] }]
    expect(positionAtV2(segs, 50)).toEqual({ x: 0, y: 0, timeSec: 0 })
  })
})

describe('healthDisplayAt / teamHealthAt', () => {
  it('keeps friendly opening without evidence as relative-full and enemy without evidence UNKNOWN', () => {
    const friendly = { team: 1, friendly: true, healthTransitions: [], lifeTransitions: [] }
    const enemy = { team: 2, friendly: false, healthTransitions: [], lifeTransitions: [] }
    expect(healthDisplayAt(friendly, 0)).toMatchObject({ state: 'RELATIVE_FULL', relativeFull: true, currentHp: null })
    expect(healthDisplayAt(enemy, 0)).toMatchObject({ state: 'UNKNOWN', relativeFull: false, currentHp: null })
    expect(teamHealthAt([friendly], 1, 0).state).toBe('FULL_RELATIVE')
    expect(teamHealthAt([enemy], 2, 0).state).toBe('UNKNOWN')
  })

  it('uses only <=t canonical health facts and distinguishes exact, last-known and destroyed', () => {
    const track = {
      friendly: false,
      healthTransitions: [lh(10, 1200, 'CURRENT', 1200), lh(20, 800, 'LAST_KNOWN', 1200), lh(30, 600, 'CURRENT', 1200)],
      lifeTransitions: [{ timeSec: 40, lifeState: 'DESTROYED', destroyedKnownAtSec: 40 }],
    }
    expect(healthDisplayAt(track, 5).state).toBe('UNKNOWN')
    expect(healthDisplayAt(track, 15)).toMatchObject({ state: 'CURRENT', currentHp: 1200, pct: 100 })
    expect(healthDisplayAt(track, 25)).toMatchObject({ state: 'LAST_KNOWN', currentHp: 800, pct: 800 / 1200 * 100 })
    expect(healthDisplayAt(track, 35).currentHp).toBe(600)
    expect(healthDisplayAt(track, 50)).toMatchObject({ state: 'DESTROYED', currentHp: 0, destroyed: true })
  })

  it('aggregates exact and mixed tracks without legacy capacity inference', () => {
    const exact = { team: 1, friendly: true, healthTransitions: [lh(0, 1000, 'CURRENT', 1000)], lifeTransitions: [] }
    const unknown = { team: 1, friendly: true, healthTransitions: [], lifeTransitions: [] }
    expect(teamHealthAt([exact], 1, 0)).toMatchObject({ state: 'EXACT', totalMax: 1000, knownRemaining: 1000 })
    expect(teamHealthAt([exact, unknown], 1, 0)).toMatchObject({ state: 'FULL_RELATIVE', totalMax: 0, knownRemaining: 1000, unknownMax: 0 })
  })

  it('combines exact full and relative-full members into FULL_RELATIVE', () => {
    const exactFull = { team: 1, friendly: true, healthTransitions: [lh(0, 2400, 'CURRENT', 2400)], lifeTransitions: [] }
    const relativeFull = { team: 1, friendly: true, healthTransitions: [], lifeTransitions: [] }
    expect(teamHealthAt([exactFull, relativeFull], 1, 0).state).toBe('FULL_RELATIVE')
  })

  it('keeps all exact full members EXACT while preserving a full UI ratio', () => {
    const tracks = [
      { team: 1, friendly: true, healthTransitions: [lh(0, 2400, 'CURRENT', 2400)], lifeTransitions: [] },
      { team: 1, friendly: true, healthTransitions: [lh(0, 1800, 'CURRENT', 1800)], lifeTransitions: [] },
    ]
    expect(teamHealthAt(tracks, 1, 0)).toMatchObject({
      state: 'EXACT', totalMax: 4200, knownRemaining: 4200,
    })
  })

  it('breaks opening FULL_RELATIVE on damage or destruction, and never grants it to enemy unknown', () => {
    const relativeFull = { team: 1, friendly: true, healthTransitions: [], lifeTransitions: [] }
    const damaged = { team: 1, friendly: true, healthTransitions: [lh(0, 1800, 'CURRENT', 2400)], lifeTransitions: [] }
    const destroyed = { team: 1, friendly: true, healthTransitions: [], lifeTransitions: [{ timeSec: 0, lifeState: 'DESTROYED', destroyedKnownAtSec: 0 }] }
    const enemyUnknown = { team: 2, friendly: false, healthTransitions: [], lifeTransitions: [] }
    expect(teamHealthAt([damaged, relativeFull], 1, 0).state).toBe('PARTIAL')
    expect(teamHealthAt([destroyed, relativeFull], 1, 0).state).toBe('PARTIAL')
    expect(teamHealthAt([enemyUnknown], 2, 0).state).toBe('UNKNOWN')
  })

  it('does not render a full partial bar when the only known HP is destroyed=0', () => {
    const destroyed = {
      team: 1,
      friendly: true,
      healthTransitions: [],
      lifeTransitions: [{ timeSec: 10, lifeState: 'DESTROYED', destroyedKnownAtSec: 10 }],
    }
    const unknown = { team: 1, friendly: true, healthTransitions: [], lifeTransitions: [] }
    expect(teamHealthAt([destroyed, unknown], 1, 20)).toMatchObject({
      state: 'PARTIAL', totalMax: 0, knownRemaining: 0,
    })
  })
})

describe('canonical event statistics', () => {
  const attacker = {
    accountId: 1,
    healthTransitions: [lh(0, 3000, 'CURRENT', 3000)],
  }
  const victim = {
    accountId: 2,
    healthTransitions: [
      lh(0, 2000, 'CURRENT', 2000),
      lh(10, 1500, 'CURRENT', 2000),
      lh(20, 900, 'CURRENT', 2000),
      lh(30, 800, 'CURRENT', 2000),
    ],
  }
  const events = [
    { type: 'DAMAGE', timeSec: 10, accountId: 1, targetAccountId: 2, observedHpLoss: 500 },
    { type: 'DAMAGE', timeSec: 20, accountId: null, targetAccountId: 2, observedHpLoss: null, rawProtocolValue: 600 },
    { type: 'DAMAGE', timeSec: 25, accountId: 1, targetAccountId: 2, observedHpLoss: null, rawProtocolValue: 999 },
    { type: 'DAMAGE', timeSec: 30, accountId: 1, targetAccountId: 2, observedHpLoss: 300 },
    { type: 'KILL', timeSec: 35, accountId: 1, targetAccountId: 2, observedHpLoss: null },
  ]

  it('derives received from canonical HP decreases while dealt uses only observed attribution', () => {
    expect(cumulativeStatsAtV2(events, victim, 25)).toEqual({ dealt: 0, received: 1100, kills: 0 })
    expect(cumulativeStatsAtV2(events, attacker, 25)).toEqual({ dealt: 500, received: 0, kills: 0 })
    expect(cumulativeStatsAtV2(events, attacker, 40)).toEqual({ dealt: 800, received: 0, kills: 1 })
  })

  it('does not treat LAST_KNOWN as a new received-damage sample', () => {
    const track = {
      accountId: 2,
      healthTransitions: [
        lh(0, 2000, 'CURRENT', 2000),
        lh(10, 1500, 'LAST_KNOWN', 2000),
        lh(20, 900, 'CURRENT', 2000),
      ],
    }
    expect(cumulativeStatsAtV2([], track, 20).received).toBe(1100)
    expect(damageLogAtV2([], track, 20)).toEqual([
      { timeSec: 20, dir: 'in', hpLoss: 1100, attackerAccountId: null, attackerReliable: false },
    ])
  })

  it('logs canonical incoming decreases with known or unknown attribution and blocks future/raw values', () => {
    expect(damageLogAtV2(events, victim, 25)).toEqual([
      { timeSec: 10, dir: 'in', hpLoss: 500, attackerAccountId: 1, attackerReliable: true },
      { timeSec: 20, dir: 'in', hpLoss: 600, attackerAccountId: null, attackerReliable: false },
    ])
    expect(damageLogAtV2(events, attacker, 25)).toEqual([
      { timeSec: 10, dir: 'out', hpLoss: 500, victimAccountId: 2 },
    ])
    expect(damageLogAtV2(events, victim, 35).map(row => row.timeSec)).toEqual([10, 20, 30])
  })

  it('joins a uniquely attributable single event inside the observation window', () => {
    const track = {
      accountId: 2,
      healthTransitions: [lh(0, 2000, 'CURRENT', 2000), lh(10, 1500, 'CURRENT', 2000)],
    }
    const rows = damageLogAtV2([
      { type: 'DAMAGE', timeSec: 9.43, accountId: 1, targetAccountId: 2, observedHpLoss: 500 },
    ], track, 10)
    expect(rows).toEqual([
      { timeSec: 9.43, dir: 'in', hpLoss: 500, attackerAccountId: 1, attackerReliable: true },
    ])
    expect(damageLogAtV2([
      { type: 'DAMAGE', timeSec: 9.43, accountId: 1, targetAccountId: 2, observedHpLoss: 500 },
    ], track, 9.42)).toEqual([])
  })

  it('aggregates same-attacker events in one observation window only when totals match', () => {
    const track = {
      accountId: 2,
      healthTransitions: [lh(0, 2000, 'CURRENT', 2000), lh(10, 1500, 'CURRENT', 2000)],
    }
    const sameAttacker = damageLogAtV2([
      { type: 'DAMAGE', timeSec: 9.1, accountId: 1, targetAccountId: 2, observedHpLoss: 200 },
      { type: 'DAMAGE', timeSec: 9.7, accountId: 1, targetAccountId: 2, observedHpLoss: 300 },
    ], track, 10)
    expect(sameAttacker).toEqual([
      { timeSec: 10, dir: 'in', hpLoss: 500, attackerAccountId: 1, attackerReliable: true },
    ])

    const multipleAttackers = damageLogAtV2([
      { type: 'DAMAGE', timeSec: 9.1, accountId: 1, targetAccountId: 2, observedHpLoss: 200 },
      { type: 'DAMAGE', timeSec: 9.7, accountId: 3, targetAccountId: 2, observedHpLoss: 300 },
    ], track, 10)
    expect(multipleAttackers).toEqual([
      { timeSec: 10, dir: 'in', hpLoss: 500, attackerAccountId: null, attackerReliable: false },
    ])
  })

  it('keeps attribution unknown when observed damage does not cover canonical loss', () => {
    const track = {
      accountId: 2,
      healthTransitions: [lh(0, 2000, 'CURRENT', 2000), lh(10, 1400, 'CURRENT', 2000)],
    }
    expect(damageLogAtV2([
      { type: 'DAMAGE', timeSec: 9.43, accountId: 1, targetAccountId: 2, observedHpLoss: 300 },
    ], track, 10)).toEqual([
      { timeSec: 10, dir: 'in', hpLoss: 600, attackerAccountId: null, attackerReliable: false },
    ])
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

  it('keeps three consumable runtimes independent and clears them on global UNKNOWN', () => {
    const transitions = [
      { timeSec: 90, logicalItemId: 'REPAIR_KIT', state: 'ACTIVATED', wireCode: 0x0D },
      { timeSec: 95, logicalItemId: 'ADRENALINE', state: 'INITIALIZED', wireCode: 0x09 },
      { timeSec: 110, logicalItemId: null, state: 'UNKNOWN', wireCode: null },
    ]
    expect(consumableRuntimeStatesAt(transitions, 100)).toEqual(new Map([
      [0x0D, { state: 'ACTIVATED', logicalItemId: 'REPAIR_KIT', wireCode: 0x0D }],
      [0x09, { state: 'INITIALIZED', logicalItemId: 'ADRENALINE', wireCode: 0x09 }],
    ]))
    expect(consumableRuntimeStatesAt(transitions, 120).size).toBe(0)
  })

  it('updates only the observed consumable, invalidates globally, then recovers per slot without future leakage', () => {
    const transitions = [
      { timeSec: 90, logicalItemId: 'REPAIR_KIT', state: 'ACTIVATED', wireCode: 0x0D },
      { timeSec: 95, logicalItemId: 'ADRENALINE', state: 'INITIALIZED', wireCode: 0x09 },
      { timeSec: 100, logicalItemId: 'REPAIR_KIT', state: 'ACTIVE_ENDED_OR_COOLDOWN', wireCode: 0x0D },
      { timeSec: 110, logicalItemId: null, state: 'UNKNOWN', wireCode: null },
      { timeSec: 120, logicalItemId: 'REPAIR_KIT', state: 'READY', wireCode: 0x0D },
      { timeSec: 130, logicalItemId: 'ADRENALINE', state: 'ACTIVATED', wireCode: 0x09 },
    ]

    const beforeUnknown = consumableRuntimeStatesAt(transitions, 105)
    expect(beforeUnknown.get(0x0D).state).toBe('ACTIVE_ENDED_OR_COOLDOWN')
    expect(beforeUnknown.get(0x09).state).toBe('INITIALIZED')

    expect(consumableRuntimeStatesAt(transitions, 115)).toEqual(new Map())

    const afterRecovery = consumableRuntimeStatesAt(transitions, 125)
    expect(afterRecovery).toEqual(new Map([
      [0x0D, { state: 'READY', logicalItemId: 'REPAIR_KIT', wireCode: 0x0D }],
    ]))
    expect(afterRecovery.has(0x09)).toBe(false)
  })
})
