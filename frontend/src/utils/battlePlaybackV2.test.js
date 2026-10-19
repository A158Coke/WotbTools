import { describe, expect, it } from 'vitest'
import {
  healthAt,
  healthDisplayAt,
  lifeAt,
  observedFreezeTimeAt,
  positionCoveredAtV2,
  positionAtV2,
  orientationKnownAt,
  orientationAtV2,
  friendlyHealthAt,
  consumableRuntimeSlotsAt,
  moduleCrewStatesAt,
  ghostAroundV2,
  cumulativeStatsAtV2,
  damageLogAtV2,
} from './battlePlaybackV2'

const lh = (timeSec, currentHp, knowledge, displayCapacityHp) =>
  ({ timeSec, currentHp, knowledge, source: 'EXACT_BATTLE_EVENT', displayCapacityHp,
    relativeFull: currentHp != null && currentHp === displayCapacityHp, confidence: 'HIGH' })

describe('healthAt', () => {
  it('returns last <= t health with knowledge + anti-future-leak capacity', () => {
    const track = { healthTransitions: [lh(90, 1500, 'CURRENT', 1500), lh(140, 600, 'CURRENT', 1500)] }
    expect(healthAt(track, 120)).toEqual(expect.objectContaining({ currentHp: 1500, knowledge: 'CURRENT', displayCapacityHp: 1500 }))
    expect(healthAt(track, 145).currentHp).toBe(600)
    // 120s 绝不能拿到 140s 的 600（anti-future-leak）
    expect(healthAt(track, 120).currentHp).toBe(1500)
    expect(healthAt(track, 50)).toBeNull()
  })

  it('treats a nullable or invalid health transition as no canonical fact', () => {
    const track = { healthTransitions: [{ timeSec: 0, currentHp: null, knowledge: null, source: null, displayCapacityHp: null, confidence: 'UNKNOWN' }] }
    expect(healthAt(track, 1)).toBeNull()
    expect(healthDisplayAt({ ...track, friendly: false, lifeTransitions: [] }, 1)).toMatchObject({
      state: 'UNKNOWN', currentHp: null,
    })
  })

  it('honors an explicit health invalidation boundary before reacquired HP', () => {
    const track = {
      healthTransitions: [
        lh(10, 2000, 'CURRENT', 2000),
        { timeSec: 20, currentHp: null, knowledge: null, source: null,
          displayCapacityHp: null, relativeFull: false, confidence: 'UNKNOWN' },
        lh(30, 1500, 'CURRENT', 2000),
      ],
      lifeTransitions: [],
    }
    expect(healthAt(track, 15)).toMatchObject({ currentHp: 2000 })
    expect(healthAt(track, 25)).toBeNull()
    expect(healthDisplayAt(track, 25)).toMatchObject({ state: 'UNKNOWN', currentHp: null })
    expect(healthAt(track, 35)).toMatchObject({ currentHp: 1500, relativeFull: false })
  })
})

describe('lifeAt', () => {
  it('returns null when no canonical life transition exists', () => {
    expect(lifeAt({ lifeTransitions: [] }, 10)).toBeNull()
  })

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

describe('observedFreezeTimeAt（失察即冻结的采样时刻）', () => {
  const segs = [
    { startSec: 0, endSec: 100, knowledge: 'OBSERVED' },
    { startSec: 100, endSec: 140, knowledge: 'LAST_KNOWN' },
    { startSec: 140, endSec: 200, knowledge: 'OBSERVED' },
  ]

  it('观测区间内返回 t 本身（正常采样）', () => {
    expect(observedFreezeTimeAt(segs, 0)).toBe(0)
    expect(observedFreezeTimeAt(segs, 50)).toBe(50)
    expect(observedFreezeTimeAt(segs, 100)).toBe(100)
    expect(observedFreezeTimeAt(segs, 160)).toBe(160)
  })

  it('失察区间内冻结在最后一个 OBSERVED 段的结束时刻（不跟随滤波器预测）', () => {
    expect(observedFreezeTimeAt(segs, 120)).toBe(100)
    expect(observedFreezeTimeAt(segs, 139.9)).toBe(100)
  })

  it('首个观测之前 / 无有效段 / 非法时刻 → null（调用方不显示）', () => {
    expect(observedFreezeTimeAt([{ startSec: 10, endSec: 20, knowledge: 'OBSERVED' }], 5)).toBeNull()
    expect(observedFreezeTimeAt([{ startSec: 0, endSec: 10, knowledge: 'LAST_KNOWN' }], 50)).toBeNull()
    expect(observedFreezeTimeAt([], 5)).toBeNull()
    expect(observedFreezeTimeAt(null, 5)).toBeNull()
    expect(observedFreezeTimeAt(segs, Number.NaN)).toBeNull()
  })

  it('多段：跨多个失察区间时取最近一个已结束的观测段末尾', () => {
    const many = [
      { startSec: 0, endSec: 10, knowledge: 'OBSERVED' },
      { startSec: 30, endSec: 40, knowledge: 'OBSERVED' },
      { startSec: 60, endSec: 70, knowledge: 'OBSERVED' },
    ]
    expect(observedFreezeTimeAt(many, 45)).toBe(40)
    expect(observedFreezeTimeAt(many, 59)).toBe(40)
    expect(observedFreezeTimeAt(many, 100)).toBe(70)
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
    // anti-future-leak: currentTime=23, 敌方第一次观测=186 → 绝不能提前显示
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
    // anti-future-leak：不得因为段标记为 LAST_KNOWN 就取它的最后样本
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

describe('healthDisplayAt / friendlyHealthAt', () => {
  it('keeps friendly opening without evidence as relative-full and enemy without evidence UNKNOWN', () => {
    const friendly = { team: 1, friendly: true, healthTransitions: [
      { timeSec: 0, currentHp: null, knowledge: 'CURRENT', source: 'RELATIVE_FULL', displayCapacityHp: null, relativeFull: true, confidence: 'UNKNOWN' },
    ], lifeTransitions: [] }
    const enemy = { team: 2, friendly: false, healthTransitions: [], lifeTransitions: [] }
    expect(healthDisplayAt(friendly, 0)).toMatchObject({ state: 'RELATIVE_FULL', relativeFull: true, currentHp: null })
    expect(healthDisplayAt(enemy, 0)).toMatchObject({ state: 'UNKNOWN', relativeFull: false, currentHp: null })
    expect(friendlyHealthAt([friendly], true, 0).state).toBe('FULL_RELATIVE')
    expect(friendlyHealthAt([enemy], false, 0).state).toBe('UNKNOWN')
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
    const unknown = { team: 1, friendly: true, healthTransitions: [
      { timeSec: 0, currentHp: null, knowledge: 'CURRENT', source: 'RELATIVE_FULL', displayCapacityHp: null, relativeFull: true, confidence: 'UNKNOWN' },
    ], lifeTransitions: [] }
    expect(friendlyHealthAt([exact], true, 0)).toMatchObject({ state: 'EXACT', totalMax: 1000, knownRemaining: 1000 })
    expect(friendlyHealthAt([exact, unknown], true, 0)).toMatchObject({ state: 'FULL_RELATIVE', totalMax: 0, knownRemaining: 1000, unknownMax: 0 })
  })

  it('combines exact full and relative-full members into FULL_RELATIVE', () => {
    const exactFull = { team: 1, friendly: true, healthTransitions: [lh(0, 2400, 'CURRENT', 2400)], lifeTransitions: [] }
    const relativeFull = { team: 1, friendly: true, healthTransitions: [
      { timeSec: 0, currentHp: null, knowledge: 'CURRENT', source: 'RELATIVE_FULL', displayCapacityHp: null, relativeFull: true, confidence: 'UNKNOWN' },
    ], lifeTransitions: [] }
    expect(friendlyHealthAt([exactFull, relativeFull], true, 0).state).toBe('FULL_RELATIVE')
  })

  it('keeps all exact full members EXACT while preserving a full UI ratio', () => {
    const tracks = [
      { team: 1, friendly: true, healthTransitions: [lh(0, 2400, 'CURRENT', 2400)], lifeTransitions: [] },
      { team: 1, friendly: true, healthTransitions: [lh(0, 1800, 'CURRENT', 1800)], lifeTransitions: [] },
    ]
    expect(friendlyHealthAt(tracks, true, 0)).toMatchObject({
      state: 'EXACT', totalMax: 4200, knownRemaining: 4200,
    })
  })

  it('breaks opening FULL_RELATIVE on damage or destruction, and never grants it to enemy unknown', () => {
    const relativeFull = { team: 1, friendly: true, healthTransitions: [], lifeTransitions: [] }
    const damaged = { team: 1, friendly: true, healthTransitions: [lh(0, 1800, 'CURRENT', 2400)], lifeTransitions: [] }
    const destroyed = { team: 1, friendly: true, healthTransitions: [], lifeTransitions: [{ timeSec: 0, lifeState: 'DESTROYED', destroyedKnownAtSec: 0 }] }
    const enemyUnknown = { team: 2, friendly: false, healthTransitions: [], lifeTransitions: [] }
    expect(friendlyHealthAt([damaged, relativeFull], true, 0).state).toBe('PARTIAL')
    expect(friendlyHealthAt([destroyed, relativeFull], true, 0).state).toBe('PARTIAL')
    expect(friendlyHealthAt([enemyUnknown], false, 0).state).toBe('UNKNOWN')
  })

  it('does not render a full partial bar when the only known HP is destroyed=0', () => {
    const destroyed = {
      team: 1,
      friendly: true,
      healthTransitions: [],
      lifeTransitions: [{ timeSec: 10, lifeState: 'DESTROYED', destroyedKnownAtSec: 10 }],
    }
    const unknown = { team: 1, friendly: true, healthTransitions: [], lifeTransitions: [] }
    expect(friendlyHealthAt([destroyed, unknown], true, 20)).toMatchObject({
      state: 'PARTIAL', totalMax: 0, knownRemaining: 0,
    })
  })
})

describe('canonical event statistics', () => {
  const attacker = {
    accountId: 1,
    healthTransitions: [lh(0, 3000, 'CURRENT', 3000)],
    damageLosses: [],
  }
  const victim = {
    accountId: 2,
    healthTransitions: [
      lh(0, 2000, 'CURRENT', 2000),
      lh(10, 1500, 'CURRENT', 2000),
      lh(20, 900, 'CURRENT', 2000),
      lh(30, 800, 'CURRENT', 2000),
    ],
    damageLosses: [
      { fromSec: 0, toSec: 10, hpLoss: 500, attackerAccountId: 1, attackerReliable: true, damageEventCount: 1 },
      { fromSec: 10, toSec: 20, hpLoss: 600, attackerAccountId: null, attackerReliable: false, damageEventCount: 1 },
    ],
  }
  const events = [
    { type: 'DAMAGE', timeSec: 10, accountId: 1, targetAccountId: 2, observedHpLoss: 500 },
    { type: 'DAMAGE', timeSec: 20, accountId: null, targetAccountId: 2, observedHpLoss: null, rawProtocolValue: 600 },
    { type: 'DAMAGE', timeSec: 25, accountId: 1, targetAccountId: 2, observedHpLoss: null, rawProtocolValue: 999 },
    { type: 'DAMAGE', timeSec: 30, accountId: 1, targetAccountId: 2, observedHpLoss: 300 },
    { type: 'KILL', timeSec: 35, accountId: 1, targetAccountId: 2, observedHpLoss: null },
  ]

  it('uses canonical DamageLoss for received/dealt and events only for kills', () => {
    expect(cumulativeStatsAtV2(events, victim, 25, [attacker, victim])).toEqual({ dealt: 0, received: 1100, kills: 0 })
    expect(cumulativeStatsAtV2(events, attacker, 25, [attacker, victim])).toEqual({ dealt: 500, received: 0, kills: 0 })
    expect(cumulativeStatsAtV2(events, attacker, 40, [attacker, victim])).toEqual({ dealt: 500, received: 0, kills: 1 })
  })

  it('uses the recorded cumulative total without adding overlapping HP attribution or future totals', () => {
    const recorder = { ...attacker, damageDealtSamples: [
      { timeSec: 10, total: 900 }, { timeSec: 20, total: 1200 },
    ] }
    expect(cumulativeStatsAtV2(events, recorder, 9, [recorder, victim]).dealt).toBe(0)
    expect(cumulativeStatsAtV2(events, recorder, 15, [recorder, victim])).toEqual({ dealt: 900, received: 0, kills: 0 })
    expect(cumulativeStatsAtV2(events, recorder, 40, [recorder, victim])).toEqual({ dealt: 1200, received: 0, kills: 1 })
    // Seek backwards queries the same evidence timeline rather than retaining the later total.
    expect(cumulativeStatsAtV2(events, recorder, 15, [recorder, victim]).dealt).toBe(900)
    // 30s 的 900 → 800 是 HP 条上的可信下降（没有对应 DamageLoss，例如 materialization 读数）：承受伤害按 HP 条计
    expect(cumulativeStatsAtV2(events, victim, 40, [recorder, victim]).received).toBe(1200)
  })

  it('preserves an observed zero and ignores malformed or future totals', () => {
    const recorder = { ...attacker, damageDealtSamples: [
      { timeSec: 12, total: 0 }, { timeSec: 30, total: 9999 },
      { timeSec: 14, total: -1 }, { timeSec: -1, total: 8888 },
      { timeSec: NaN, total: 7777 },
    ] }
    expect(cumulativeStatsAtV2(events, recorder, 15, [recorder, victim]).dealt).toBe(0)
  })

  it('received matches the HP bar: a drop first seen on a materialization read still counts (issue: 承受伤害漏算)', () => {
    // 点亮时 materialization 满血 3536，首发命中后第一条 prop3 = 3067（Java 口径没有 DamageLoss）
    const track = {
      accountId: 9,
      healthTransitions: [
        { ...lh(0, 3350, 'CURRENT', 3350), source: 'TANKOPEDIA_BASE_PROVISIONAL', confidence: 'MEDIUM' },
        lh(92, 3536, 'CURRENT', 3536),
        lh(95, 3067, 'CURRENT', 3536),
        lh(110, 2608, 'CURRENT', 3536),
      ],
      damageLosses: [{ fromSec: 95, toSec: 110, hpLoss: 459, attackerAccountId: 1, attackerReliable: true, damageEventCount: 1 }],
    }
    expect(cumulativeStatsAtV2([], track, 90).received).toBe(0)
    // provisional 种子不作下降起点（3350 → 3536 是量程修正，不是回血也不是掉血）
    expect(cumulativeStatsAtV2([], track, 95).received).toBe(469)
    expect(cumulativeStatsAtV2([], track, 110).received).toBe(928)
  })

  it('a provisional seed above the first observed HP is never counted as damage', () => {
    const track = {
      accountId: 9,
      healthTransitions: [
        { ...lh(0, 3700, 'CURRENT', 3700), source: 'TANKOPEDIA_BASE_PROVISIONAL', confidence: 'MEDIUM' },
        lh(50, 3570, 'CURRENT', 3570),
      ],
      damageLosses: [],
    }
    expect(cumulativeStatsAtV2([], track, 60).received).toBe(0)
  })

  it('does not treat LAST_KNOWN as a new received-damage sample', () => {
    const track = {
      accountId: 2,
      healthTransitions: [
        lh(0, 2000, 'CURRENT', 2000),
        lh(10, 1500, 'LAST_KNOWN', 2000),
        lh(20, 900, 'CURRENT', 2000),
      ],
      damageLosses: [{ fromSec: 0, toSec: 20, hpLoss: 1100, attackerAccountId: null, attackerReliable: false, damageEventCount: 2 }],
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
    expect(damageLogAtV2(events, attacker, 25, 8, [attacker, victim])).toEqual([
      { timeSec: 10, dir: 'out', hpLoss: 500, victimAccountId: 2 },
    ])
    expect(damageLogAtV2(events, victim, 35).map(row => row.timeSec)).toEqual([10, 20])
  })

  it('uses the canonical loss boundary instead of notification timestamps', () => {
    const track = {
      accountId: 2,
      healthTransitions: [lh(0, 2000, 'CURRENT', 2000), lh(10, 1500, 'CURRENT', 2000)],
      damageLosses: [{ fromSec: 0, toSec: 10, hpLoss: 500, attackerAccountId: 1, attackerReliable: true, damageEventCount: 1 }],
    }
    const rows = damageLogAtV2([
      { type: 'DAMAGE', timeSec: 9.43, accountId: 1, targetAccountId: 2, observedHpLoss: 500 },
    ], track, 10)
    expect(rows).toEqual([
      { timeSec: 10, dir: 'in', hpLoss: 500, attackerAccountId: 1, attackerReliable: true },
    ])
    expect(damageLogAtV2([
      { type: 'DAMAGE', timeSec: 9.43, accountId: 1, targetAccountId: 2, observedHpLoss: 500 },
    ], track, 9.42)).toEqual([])
  })

  it('aggregates same-attacker events in one observation window only when totals match', () => {
    const track = {
      accountId: 2,
      healthTransitions: [lh(0, 2000, 'CURRENT', 2000), lh(10, 1500, 'CURRENT', 2000)],
      damageLosses: [{ fromSec: 0, toSec: 10, hpLoss: 500, attackerAccountId: 1, attackerReliable: true, damageEventCount: 2 }],
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
      { timeSec: 10, dir: 'in', hpLoss: 500, attackerAccountId: 1, attackerReliable: true },
    ])
  })

  it('keeps attribution unknown when observed damage does not cover canonical loss', () => {
    const track = {
      accountId: 2,
      healthTransitions: [lh(0, 2000, 'CURRENT', 2000), lh(10, 1400, 'CURRENT', 2000)],
      damageLosses: [{ fromSec: 0, toSec: 10, hpLoss: 600, attackerAccountId: null, attackerReliable: false, damageEventCount: 1 }],
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

describe('canonical vehicle selectors', () => {
  it('keeps health and position queries independent across an AoI gap', () => {
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
    expect(healthDisplayAt(track, 95).currentHp).toBe(1200)
    expect(positionCoveredAtV2(track.positionSegments, 95)).toBe(true)
    expect(healthDisplayAt(track, 120).currentHp).toBe(1200)
    expect(positionCoveredAtV2(track.positionSegments, 120)).toBe(false)
  })
})

describe('slot and component runtime selectors', () => {
  it('keeps recorder-visible component provenance', () => {
    const states = moduleCrewStatesAt([
      { timeSec: 120, component: 'ENGINE', state: 'CRITICAL_DISABLED', recorderVisible: true, confidence: 'HIGH' },
    ], 130)
    expect(states).toEqual([{
      component: 'ENGINE', state: 'CRITICAL_DISABLED', recorderVisible: true, confidence: 'HIGH',
    }])
  })

  it('clears repaired modules and healed crew, while auto-repair keeps damaged state', () => {
    const transitions = [
      { timeSec: 10, component: 'ENGINE', state: 'DAMAGED_DEGRADED', recorderVisible: true, confidence: 'HIGH' },
      { timeSec: 20, component: 'ENGINE', state: null, recorderVisible: true, confidence: 'HIGH' },
      { timeSec: 30, component: 'GUN', state: 'DAMAGED_DEGRADED', recorderVisible: true, confidence: 'HIGH' },
      { timeSec: 40, component: 'GUN', state: 'DAMAGED_DEGRADED', recorderVisible: true, confidence: 'HIGH' },
      { timeSec: 50, component: 'CREW', state: 'CREW_SHELL_SHOCKED', recorderVisible: true, confidence: 'HIGH' },
      { timeSec: 60, component: 'CREW', state: null, recorderVisible: true, confidence: 'HIGH' },
    ]
    expect(moduleCrewStatesAt(transitions, 25)).toEqual([])
    expect(moduleCrewStatesAt(transitions, 45)).toEqual([
      { component: 'GUN', state: 'DAMAGED_DEGRADED', recorderVisible: true, confidence: 'HIGH' },
    ])
    expect(moduleCrewStatesAt(transitions, 70)).toEqual([
      { component: 'GUN', state: 'DAMAGED_DEGRADED', recorderVisible: true, confidence: 'HIGH' },
    ])
  })

  it('matches ghost damage to its canonical loss window, not exact transition time', () => {
    expect(ghostAroundV2({ fromHp: 2000, toHp: 1500, displayCapacityHp: 2000 })).toEqual({ prevPct: 100, nextPct: 75 })
    expect(ghostAroundV2({ fromHp: 1500, toHp: 900, displayCapacityHp: 2000 })).toEqual({ prevPct: 75, nextPct: 45 })
    expect(ghostAroundV2({ fromHp: 2000, toHp: 1500, displayCapacityHp: null })).toBeNull()
    expect(ghostAroundV2({ fromHp: null, toHp: 1500, displayCapacityHp: 2000 })).toBeNull()
  })

  it('keeps three consumable slots independent and clears them on global UNKNOWN', () => {
    const transitions = [
      { timeSec: 90, consumableSlot: 0, logicalItemId: 'REPAIR_KIT', state: 'ACTIVATED', wireCode: 0x0D },
      { timeSec: 95, consumableSlot: 1, logicalItemId: 'ADRENALINE', state: 'INITIALIZED', wireCode: 0x09 },
      { timeSec: 110, consumableSlot: null, logicalItemId: null, state: 'UNKNOWN', invalidation: true, wireCode: null },
    ]
    expect(consumableRuntimeSlotsAt(transitions, 100)).toEqual(new Map([
      [0, { state: 'ACTIVATED', logicalItemId: 'REPAIR_KIT', wireCode: 0x0D }],
      [1, { state: 'INITIALIZED', logicalItemId: 'ADRENALINE', wireCode: 0x09 }],
    ]))
    expect(consumableRuntimeSlotsAt(transitions, 120).size).toBe(0)
  })

  it('updates only the observed consumable, invalidates globally, then recovers per slot without future leakage', () => {
    const transitions = [
      { timeSec: 90, consumableSlot: 0, logicalItemId: 'REPAIR_KIT', state: 'ACTIVATED', wireCode: 0x0D },
      { timeSec: 95, consumableSlot: 1, logicalItemId: 'ADRENALINE', state: 'INITIALIZED', wireCode: 0x09 },
      { timeSec: 100, consumableSlot: 0, logicalItemId: 'REPAIR_KIT', state: 'ACTIVE_ENDED_OR_COOLDOWN', wireCode: 0x0D },
      { timeSec: 110, consumableSlot: null, logicalItemId: null, state: 'UNKNOWN', invalidation: true, wireCode: null },
      { timeSec: 120, consumableSlot: 0, logicalItemId: 'REPAIR_KIT', state: 'READY', wireCode: 0x0D },
      { timeSec: 130, consumableSlot: 1, logicalItemId: 'ADRENALINE', state: 'ACTIVATED', wireCode: 0x09 },
    ]

    const beforeUnknown = consumableRuntimeSlotsAt(transitions, 105)
    expect(beforeUnknown.get(0).state).toBe('ACTIVE_ENDED_OR_COOLDOWN')
    expect(beforeUnknown.get(1).state).toBe('INITIALIZED')

    expect(consumableRuntimeSlotsAt(transitions, 115)).toEqual(new Map())

    const afterRecovery = consumableRuntimeSlotsAt(transitions, 125)
    expect(afterRecovery).toEqual(new Map([
      [0, { state: 'READY', logicalItemId: 'REPAIR_KIT', wireCode: 0x0D }],
    ]))
    expect(afterRecovery.has(1)).toBe(false)
  })
})
