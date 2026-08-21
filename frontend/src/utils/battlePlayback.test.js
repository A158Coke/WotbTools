import { describe, expect, it } from 'vitest'
import {
  aggregateEventsBySecond,
  clampViewPan,
  cumulativeStatsAt,
  damageLogAt,
  eventsCrossed,
  formatClock,
  ghostAround,
  hpDisplay,
  interpolateDirection,
  lastKnownPosition,
  normalizeDeg,
  parseAiTime,
  positionAt,
  positionCoveredAt,
  pushFeed,
  recorderRelated,
  screenRotation,
  shortestArcDeg,
  teamHp,
  teamPointsAt,
  transientsActive,
  vehicleHpAt,
  victimFeedbackAllowed,
  tracerLines,
  trustedPositionAt,
  turretWorldYawDeg,
  zoomViewAt
} from './battlePlayback'

describe('positionAt', () => {
  const points = [
    { x: 0, y: 0, timeSec: 10 },
    { x: 100, y: 50, timeSec: 15 },
    { x: 300, y: 50, timeSec: 40 }
  ]

  it('interpolates within a trusted gap (<=5s)', () => {
    const pos = positionAt(points, 12.5)
    expect(pos).not.toBeNull()
    expect(pos.x).toBeCloseTo(50)
    expect(pos.y).toBeCloseTo(25)
  })

  it('returns null before the first point', () => {
    expect(positionAt(points, 5)).toBeNull()
  })

  it('returns null across a gap > 5s (no through-line interpolation)', () => {
    expect(positionAt(points, 20)).toBeNull()
  })

  it('returns the re-entry point itself even after a gap > 5s (no residual last-known fade)', () => {
    const reentry = [
      { x: 0, y: 0, timeSec: 10 },
      { x: 100, y: 50, timeSec: 14 },
      { x: 200, y: 100, timeSec: 30 }
    ]
    // 20 落在 14→30 的 gap 内（gap 16s）→ 仍为 null（不穿线插值）
    expect(positionAt(reentry, 20)).toBeNull()
    // 30 恰为重新上报首点 → 返回该点本身，而非被 gap 误判为 null（否则 lastKnown 残留淡化）
    expect(positionAt(reentry, 30)).toEqual({ x: 200, y: 100, timeSec: 30 })
  })

  it('returns the last known position after the final point', () => {
    const pos = positionAt(points, 60)
    expect(pos).toEqual({ x: 300, y: 50, timeSec: 40 })
  })

  it('single point: position freezes but last-known time stays the real sample time', () => {
    const single = [{ x: 5, y: 6, timeSec: 10 }]
    const pos = positionAt(single, 30)
    expect(pos).not.toBeNull()
    expect(pos.x).toBe(5)
    expect(pos.y).toBe(6)
    expect(pos.timeSec).toBe(10) // 不是 30：last-known 时间不得随 currentTime 增长
  })

  it('handles empty/null inputs', () => {
    expect(positionAt(null, 0)).toBeNull()
    expect(positionAt([], 0)).toBeNull()
    expect(positionAt(points, Number.NaN)).toBeNull()
  })
})

describe('positionCoveredAt', () => {
  const intervals = [
    { startSec: 10, endSec: 20 },
    { startSec: 40, endSec: 50 }
  ]
  it('true inside intervals, false in gaps (position coverage, not spotting)', () => {
    expect(positionCoveredAt(intervals, 15)).toBe(true)
    expect(positionCoveredAt(intervals, 45)).toBe(true)
    expect(positionCoveredAt(intervals, 30)).toBe(false)
    expect(positionCoveredAt(intervals, 5)).toBe(false)
    expect(positionCoveredAt(null, 15)).toBe(false)
  })
})

describe('vehicleHpAt / teamHp', () => {
  // PR #107 Blocker 3：maxHp 语义混合已拆分为 baseHp（Tankopedia 静态参考）+
  // observedCapacityHp（回放观测容量）——两者都是 metadata，不得冒充本局 current/max/entry
  const vehicles = [
    { team: 1, baseHp: 3000, observedCapacityHp: 3000, hpSamples: [{ timeSec: 0, hp: 3000 }, { timeSec: 10, hp: 2000 }, { timeSec: 20, hp: 0 }] },
    { team: 1, baseHp: 2600, observedCapacityHp: 2600, hpSamples: [] },
    { team: 2, baseHp: 4000, observedCapacityHp: 4000, hpSamples: [{ timeSec: 5, hp: 4000 }, { timeSec: 15, hp: 1000 }] }
  ]

  it('vehicleHpAt: sample priority; no fake fallback from theoretical maxHp (PR #107)', () => {
    expect(vehicleHpAt(vehicles[0], 5)).toBe(3000)
    expect(vehicleHpAt(vehicles[0], 10)).toBe(2000)
    expect(vehicleHpAt(vehicles[0], 25)).toBe(0) // 阵亡 0 采样
    // 存活无采样 → UNKNOWN（null），禁止把理论 maxHp/tankopedia base 当已知血量
    expect(vehicleHpAt(vehicles[1], 50)).toBeNull()
    expect(vehicleHpAt({ team: 1, maxHp: 100 }, 0)).toBeNull()
    // PR #107：assumeFullWhenUnobserved 参数保留但不再伪造数字——任何路径无采样都返回 null
    // （相对满血状态由 hpDisplay 状态机 RULE_DERIVED_FULL_AT_SPAWN 表达）
    expect(vehicleHpAt(vehicles[1], 50, true)).toBeNull()
    expect(vehicleHpAt({ team: 1, maxHp: 100 }, 0, true)).toBeNull()
    // 已阵亡且无采样 → UNKNOWN
    expect(vehicleHpAt({ team: 1, maxHp: 2600, deathSec: 10 }, 50, true)).toBeNull()
    expect(vehicleHpAt({ team: 1, maxHp: 2600, deathSec: 10 }, 5, true)).toBeNull()
    expect(vehicleHpAt(null, 0)).toBeNull()
    // sentinel（0xFFFD=65533 / 0xFFFF=65535）绝不作为 HP
    const sentinel = { team: 1, maxHp: 2600, hpSamples: [{ timeSec: 0, hp: 65533 }, { timeSec: 1, hp: 65535 }] }
    expect(vehicleHpAt(sentinel, 5)).toBeNull()
    expect(vehicleHpAt(sentinel, 5, true)).toBeNull()
  })

  it('teamHp: friendly assumeFullWhenUnobserved → spawnFull 相对满血；enemy keeps UNKNOWN（aggregate state）', () => {
    // PR #107 Blocker 2/3：totalMax 只含已证明的实际最大 HP（OBSERVED_EXACT entryHp）；
    // 无证明时 → totalMax=0（不把 tankopedia base 相加冒充本局总血量）。aggregate state：
    // EXACT（totalMax>0）| PARTIAL（有真实已知剩余、无已证明分母）| FULL_RELATIVE（本方全部
    // 存活车开局相对满血、无任何数字）| UNKNOWN（无任何数据）。
    // vehicles[0]（t=5: 3000、t=15: 2000）、vehicles[1]（无采样）、vehicles[2]（敌方）
    expect(teamHp(vehicles, 1, 5, true)).toEqual({ totalMax: 0, knownRemaining: 3000, unknownMax: 0, spawnFullCount: 1, state: 'PARTIAL' })
    expect(teamHp(vehicles, 1, 15, true)).toEqual({ totalMax: 0, knownRemaining: 2000, unknownMax: 0, spawnFullCount: 1, state: 'PARTIAL' })
    // 敌方（assumeFull=false）：无采样存活车恒 UNKNOWN 灰段，不得 base fallback
    expect(teamHp(vehicles, 1, 5)).toEqual({ totalMax: 0, knownRemaining: 3000, unknownMax: 2600, spawnFullCount: 0, state: 'PARTIAL' })
    expect(teamHp(vehicles, 1, 15)).toEqual({ totalMax: 0, knownRemaining: 2000, unknownMax: 2600, spawnFullCount: 0, state: 'PARTIAL' })
    // 敌方有第一条真实 HP sample（vehicles[2] 首采样 t=5）→ 使用真实 sample，不再 UNKNOWN
    expect(teamHp(vehicles, 2, 5)).toEqual({ totalMax: 0, knownRemaining: 4000, unknownMax: 0, spawnFullCount: 0, state: 'PARTIAL' })
    expect(teamHp(vehicles, 2, 4)).toEqual({ totalMax: 0, knownRemaining: 0, unknownMax: 4000, spawnFullCount: 0, state: 'UNKNOWN' })
    //   首采样前仍 UNKNOWN（敌方不进入 spawnFull；unknownMax 用观测容量 reference）
    expect(teamHp(vehicles, 2, 15)).toEqual({ totalMax: 0, knownRemaining: 1000, unknownMax: 0, spawnFullCount: 0, state: 'PARTIAL' })
    // 阵亡且无采样 → 阵亡是权威事实（HP=0），不把 dead 车容量计入未知灰段 → UNKNOWN
    expect(teamHp([{ team: 1, baseHp: 2000, observedCapacityHp: 2000, deathSec: 5 }], 1, 50, true))
      .toEqual({ totalMax: 0, knownRemaining: 0, unknownMax: 0, spawnFullCount: 0, state: 'UNKNOWN' })
    expect(teamHp([{ team: 1, baseHp: 2000, observedCapacityHp: 2000, deathSec: 5 }], 1, 50))
      .toEqual({ totalMax: 0, knownRemaining: 0, unknownMax: 0, spawnFullCount: 0, state: 'UNKNOWN' })
    // perspectiveTeam=2 场景：team2 用 friendly fallback、team1 保持 enemy UNKNOWN（不写死 team1=本方）
    const mirror = vehicles.map(v => ({ ...v, team: v.team === 1 ? 2 : 1 }))
    expect(teamHp(mirror, 2, 5, true)).toEqual({ totalMax: 0, knownRemaining: 3000, unknownMax: 0, spawnFullCount: 1, state: 'PARTIAL' })
    expect(teamHp(mirror, 1, 5)).toEqual({ totalMax: 0, knownRemaining: 4000, unknownMax: 0, spawnFullCount: 0, state: 'PARTIAL' })
    expect(teamHp([], 1, 0)).toEqual({ totalMax: 0, knownRemaining: 0, unknownMax: 0, spawnFullCount: 0, state: 'UNKNOWN' })
  })

  it('teamHp: 己方全部存活车无采样 → FULL_RELATIVE（100% 实心条状态）；seek 后出现 sample 确定性更新；backward seek 恢复', () => {
    // Blocker 2：7 辆己方均无 sample、无战前掉血 → 全部 RULE_DERIVED_FULL_AT_SPAWN → FULL_RELATIVE
    const sevenFull = Array.from({ length: 7 }, (_, i) => ({
      team: 1, baseHp: 3000, observedCapacityHp: 3000, hpSamples: [], hpLosses: [], deathSec: null,
    }))
    expect(teamHp(sevenFull, 1, 0, true)).toEqual({
      totalMax: 0, knownRemaining: 0, unknownMax: 0, spawnFullCount: 7, state: 'FULL_RELATIVE',
    })
    // seek 后出现可信 sample → 状态确定性更新（PARTIAL：有真实已知剩余、无已证明分母）
    const oneSampled = sevenFull.map((v, i) => i === 0
      ? { ...v, hpSamples: [{ timeSec: 10, hp: 2500 }] }
      : v)
    expect(teamHp(oneSampled, 1, 12, true)).toEqual({
      totalMax: 0, knownRemaining: 2500, unknownMax: 0, spawnFullCount: 6, state: 'PARTIAL',
    })
    // backward seek 回开局（sample 之前）→ 恢复 FULL_RELATIVE
    expect(teamHp(oneSampled, 1, 5, true).state).toBe('FULL_RELATIVE')
    // 敌方无 sample 不获得 FULL_RELATIVE（组件里敌方路径 assumeFull=false → UNKNOWN；
    // assumeFull=true 是「本方」标记，不代表「敌方也能相对满血」）
    const sevenEnemy = sevenFull.map(v => ({ ...v, team: 2 }))
    expect(teamHp(sevenEnemy, 2, 0).state).toBe('UNKNOWN')
    expect(teamHp(sevenEnemy, 2, 0, false).state).toBe('UNKNOWN')
  })

  it('teamHp: totalMax=0 时绝不渲染虚假 knownRemaining / totalMax（Blocker 2 防 0/0）', () => {
    // 有真实已知剩余（2500）但无已证明分母 → PARTIAL：value 显示已知剩余，不显示「/ 0」
    const sampled = [
      { team: 1, baseHp: 3000, observedCapacityHp: 3000, hpSamples: [{ timeSec: 0, hp: 2500 }], deathSec: null },
    ]
    const hp = teamHp(sampled, 1, 5, true)
    expect(hp.totalMax).toBe(0)
    expect(hp.knownRemaining).toBe(2500)
    expect(hp.state).toBe('PARTIAL')
    // 全无数据 → UNKNOWN（value 显示 —，不显示「0 / 0」）
    expect(teamHp([], 1, 0).state).toBe('UNKNOWN')
  })

  it('teamHp: OBSERVED_EXACT 已证明 → EXACT（真实分数可算）；无证明用 base 不进 totalMax', () => {
    const proven = [
      { team: 1, entryHpSource: 'OBSERVED_EXACT', entryHp: 3189, baseHp: 3000, observedCapacityHp: 3189,
        hpSamples: [{ timeSec: 0, hp: 3189 }, { timeSec: 10, hp: 2800 }], deathSec: null },
      { team: 1, entryHpSource: 'OBSERVED_EXACT', entryHp: 3200, baseHp: 3000, observedCapacityHp: 3200,
        hpSamples: [], deathSec: null },
    ]
    const hp = teamHp(proven, 1, 15, true)
    expect(hp.totalMax).toBe(6389) // 3189 + 3200（已证明实际总容量）
    expect(hp.knownRemaining).toBe(6000) // 2800 + 3200（无采样按 entryHp 100%）
    expect(hp.state).toBe('EXACT')
    // 未证明的 baseHp/observedCapacityHp 绝不进 totalMax（不把 tankopedia base 相加冒充总 HP）
    const unproven = [
      { team: 1, baseHp: 3000, observedCapacityHp: 3000, hpSamples: [], deathSec: null },
    ]
    const up = teamHp(unproven, 1, 5, true)
    expect(up.totalMax).toBe(0)
    expect(up.state).toBe('FULL_RELATIVE')
  })

  it('teamPointsAt returns the latest broadcast <= t per team, null when absent', () => {
    const samples = [
      { timeSec: 56.233, team: 1, points: 303 },
      { timeSec: 58.234, team: 1, points: 306 },
      { timeSec: 78.534, team: 1, points: 305 },
      { timeSec: 78.534, team: 2, points: 361 }
    ]
    expect(teamPointsAt(samples, 1, 0)).toBeNull() // 尚未广播
    expect(teamPointsAt(samples, 1, 56.5)).toBe(303)
    expect(teamPointsAt(samples, 1, 58.5)).toBe(306)
    expect(teamPointsAt(samples, 1, 78.6)).toBe(305)
    expect(teamPointsAt(samples, 2, 78.6)).toBe(361)
    expect(teamPointsAt(samples, 2, 56.5)).toBeNull() // 该队暂无广播
    expect(teamPointsAt(null, 1, 0)).toBeNull()
  })
})

describe('parseAiTime', () => {
  it('parses explicit time formats only', () => {
    expect(parseAiTime('03:20')).toBe(200)
    expect(parseAiTime('3分20秒')).toBe(200)
    expect(parseAiTime('3m 20s')).toBe(200)
    expect(parseAiTime('3m20s')).toBe(200)
    expect(parseAiTime('3 мин 20 с')).toBe(200)
    expect(parseAiTime('3 мин. 20 с.')).toBe(200)
  })

  it('does not misread plain numbers or scores', () => {
    expect(parseAiTime('854:275')).toBeNull()
    expect(parseAiTime('123')).toBeNull()
    expect(parseAiTime('5')).toBeNull()
    expect(parseAiTime('854比275')).toBeNull()
  })
})

describe('formatClock', () => {
  it('rounds the total first and never shows 00:60', () => {
    expect(formatClock(59.6)).toBe('01:00')
    expect(formatClock(59.4)).toBe('00:59')
    expect(formatClock(119.5)).toBe('02:00')
    expect(formatClock(359.99)).toBe('06:00')
  })
})

describe('lastKnownPosition', () => {
  const points = [
    { x: 0, y: 0, timeSec: 10 },
    { x: 100, y: 50, timeSec: 15 },
    { x: 300, y: 50, timeSec: 40 }
  ]
  it('returns the latest trusted point <= t', () => {
    expect(lastKnownPosition(points, 20)).toEqual({ x: 100, y: 50, timeSec: 15 })
    expect(lastKnownPosition(points, 60)).toEqual({ x: 300, y: 50, timeSec: 40 })
  })
  it('returns null before the first point (never observed)', () => {
    expect(lastKnownPosition(points, 5)).toBeNull()
    expect(lastKnownPosition(null, 15)).toBeNull()
    expect(lastKnownPosition([], 15)).toBeNull()
  })
  it('skips non-finite coordinates', () => {
    const mixed = [
      { x: 0, y: 0, timeSec: 10 },
      { x: Number.NaN, y: 10, timeSec: 12 },
      { x: 5, y: 5, timeSec: 14 }
    ]
    expect(lastKnownPosition(mixed, 13)).toEqual({ x: 0, y: 0, timeSec: 10 })
  })
})


describe('direction utilities', () => {
  it('normalizeDeg wraps into [-180,180)', () => {
    expect(normalizeDeg(0)).toBe(0)
    expect(normalizeDeg(90)).toBe(90)
    expect(normalizeDeg(180)).toBe(-180)
    expect(normalizeDeg(-180)).toBe(-180)
    expect(normalizeDeg(270)).toBe(-90)
    expect(normalizeDeg(540)).toBe(-180)
  })

  it('shortestArcDeg handles 359° -> 1° and cross-zero interpolation', () => {
    expect(shortestArcDeg(1, 359)).toBe(2)
    expect(shortestArcDeg(359, 1)).toBe(-2)
    expect(shortestArcDeg(-179, 179)).toBe(2)
    expect(shortestArcDeg(179, -179)).toBe(-2)
  })

  it('screenRotation maps the four cardinal map yaws to screen rotations', () => {
    // 地图：yaw 从北(+Z)起顺时针。屏幕：0=朝上、90=朝右(东)、180=朝下、270=朝左。
    expect(screenRotation(0)).toBe(0)
    expect(screenRotation(90)).toBe(90)
    expect(screenRotation(180)).toBe(-180)
    expect(screenRotation(270)).toBe(-90)
  })

  it('turretWorldYawDeg = normalize(hull + relative)', () => {
    expect(turretWorldYawDeg(30, 20)).toBe(50)
    expect(turretWorldYawDeg(170, 20)).toBe(-170)
    expect(turretWorldYawDeg(-170, -20)).toBe(170)
  })

  it('interpolateDirection interpolates both angles along the shortest arc', () => {
    const samples = [
      { timeSec: 10, hullYawDeg: 0, turretRelativeYawDeg: -170 },
      { timeSec: 14, hullYawDeg: 170, turretRelativeYawDeg: 170 }
    ]
    const mid = interpolateDirection(samples, 12)
    expect(mid).not.toBeNull()
    expect(mid.hullYawDeg).toBeCloseTo(85) // 0 → 170 半程
    // -170 → 170 最短圆弧为 -20°（跨 ±180 回绕），半程 = -180 ≡ ±180
    expect(mid.turretRelativeYawDeg).toBeCloseTo(-180, 0)
  })

  it('interpolateDirection freezes at the last trusted sample across a gap and past the end', () => {
    const samples = [
      { timeSec: 10, hullYawDeg: 10, turretRelativeYawDeg: 5 },
      { timeSec: 14, hullYawDeg: 20, turretRelativeYawDeg: 15 },
      { timeSec: 40, hullYawDeg: 90, turretRelativeYawDeg: 60 }
    ]
    const inGap = interpolateDirection(samples, 20)
    expect(inGap).toEqual({ hullYawDeg: 20, turretRelativeYawDeg: 15, timeSec: 14 })
    const pastEnd = interpolateDirection(samples, 60)
    expect(pastEnd.hullYawDeg).toBe(90)
    expect(pastEnd.timeSec).toBe(40)
  })

  it('interpolateDirection returns null before the first sample or without data', () => {
    expect(interpolateDirection(null, 5)).toBeNull()
    expect(interpolateDirection([], 5)).toBeNull()
    expect(interpolateDirection([{ timeSec: 10, hullYawDeg: 0, turretRelativeYawDeg: 0 }], 5)).toBeNull()
  })
})

describe('aggregateEventsBySecond / recorderRelated', () => {
  it('aggregates events by rounded second', () => {
    const events = [
      { type: 'DAMAGE', timeSec: 10.1 },
      { type: 'DAMAGE', timeSec: 10.4 },
      { type: 'DESTROYED', timeSec: 30.4 }
    ]
    const buckets = aggregateEventsBySecond(events)
    expect(buckets).toHaveLength(2)
    expect(buckets[0]).toMatchObject({ sec: 10, count: 2 })
    expect(buckets[0].types).toContain('DAMAGE')
  })

  it('formats clocks', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(200)).toBe('03:20')
    expect(formatClock(75.4)).toBe('01:15')
  })

  it('filters recorder-related events', () => {
    expect(recorderRelated({ type: 'POSITION_REPORTED', accountId: 2 }, 1)).toBe(true)
    expect(recorderRelated({ type: 'DAMAGE', accountId: 2, targetAccountId: 3 }, 1)).toBe(false)
    expect(recorderRelated({ type: 'DAMAGE', accountId: 1, targetAccountId: 3 }, 1)).toBe(true)
    expect(recorderRelated({ type: 'DAMAGE', accountId: 2, targetAccountId: 1 }, 1)).toBe(true)
  })
})

describe('trustedPositionAt', () => {
  const points = [
    { x: 0, y: 0, timeSec: 10 },
    { x: 100, y: 50, timeSec: 15 },
    { x: 300, y: 50, timeSec: 40 }
  ]

  it('returns the interpolated position inside a trusted segment', () => {
    const p = trustedPositionAt(points, 12.5)
    expect(p).not.toBeNull()
    expect(p.timeSec).toBeCloseTo(12.5)
    expect(p.x).toBeCloseTo(50)
  })

  it('accepts an exact sample time', () => {
    expect(trustedPositionAt(points, 15)).not.toBeNull()
  })

  it('rejects gap, before-first and after-last positions (no last-known fabrication)', () => {
    expect(trustedPositionAt(points, 20)).toBeNull()
    expect(trustedPositionAt(points, 5)).toBeNull()
    expect(trustedPositionAt(points, 60)).toBeNull()
  })

  it('rejects non-finite coordinates', () => {
    const bad = [{ x: 0, y: 0, timeSec: 10 }, { x: Number.NaN, y: 0, timeSec: 12 }]
    expect(trustedPositionAt(bad, 11)).toBeNull()
  })
})

describe('tracerLines', () => {
  const routes = new Map([
    [1, { points: [{ x: 0, y: 0, timeSec: 10 }, { x: 100, y: 0, timeSec: 14 }] }],
    [2, { points: [{ x: 0, y: 100, timeSec: 10 }, { x: 100, y: 100, timeSec: 14 }] }]
  ])
  const damage = { type: 'DAMAGE', timeSec: 12, accountId: 1, targetAccountId: 2, damage: 400 }

  it('laser opacity holds bright then fades over the short window (seek-safe)', () => {
    expect(tracerLines([damage], routes, 11.99, 1)).toEqual([])
    const at = tracerLines([damage], routes, 12, 1)
    expect(at).toHaveLength(1)
    expect(at[0].x1).toBeCloseTo(50)
    expect(at[0].y2).toBeCloseTo(100)
    expect(at[0].opacity).toBeCloseTo(1)
    // 前 0.15s（真实时间）保持全亮（激光感），之后快速线性淡出到 0.4s 窗口结束
    expect(tracerLines([damage], routes, 12.15, 1)[0].opacity).toBeCloseTo(1)
    expect(tracerLines([damage], routes, 12.25, 1)[0].opacity).toBeCloseTo(0.6) // 1 - 0.1/0.25
    expect(tracerLines([damage], routes, 12.4, 1)).toEqual([])
    expect(tracerLines([damage], routes, 12, 1)).toHaveLength(1)
  })

  it('impact flash: short peak curve (invisible→0.9 at 0.1s→0) and vanishes at window end', () => {
    // flashProgress 0→1 over 0.35s real at any speed
    expect(tracerLines([damage], routes, 12, 1)[0].flashProgress).toBeCloseTo(0)
    expect(tracerLines([damage], routes, 12.1, 1)[0].flashProgress).toBeCloseTo(0.1 / 0.35)
    // flashOpacity 峰值曲线：0ms 不可见 → 0.1s 达峰值 0.9 → 0.35s 归零（不再全程实体圆球）
    expect(tracerLines([damage], routes, 12, 1)[0].flashOpacity).toBeCloseTo(0)
    expect(tracerLines([damage], routes, 12.1, 1)[0].flashOpacity).toBeCloseTo(0.9)
    // 闪光窗口结束点（真实 0.35s）：flashProgress 钳制为 1、flashOpacity 归零（组件不再渲染圆点），
    // 而炮线本体仍在淡出（0.15→0.4s），不随闪光一起消失
    const atFlashEnd = tracerLines([damage], routes, 12.35, 1)[0]
    expect(atFlashEnd.flashProgress).toBeCloseTo(1)
    expect(atFlashEnd.flashOpacity).toBeCloseTo(0)
    expect(atFlashEnd.opacity).toBeCloseTo(0.2)
    // 炮线窗口结束（真实 0.4s）后整条线消失
    expect(tracerLines([damage], routes, 12.4, 1)).toEqual([])
    // 2×/4×：真实 0.35s 对应游戏 0.7s / 1.4s
    expect(tracerLines([damage], routes, 12.35, 2)[0].flashProgress).toBeCloseTo(0.5)
    expect(tracerLines([damage], routes, 12.7, 4)[0].flashProgress).toBeCloseTo(0.5)
  })

  it('windows scale with playback speed (1x/2x/4x) — short shot effect', () => {
    expect(tracerLines([damage], routes, 12.4, 1)).toEqual([])
    // 1×：窗口 0.4s、保持 0.15s → 12.3（elapsed 0.3）opacity = 1-(0.3-0.15)/0.25 = 0.4
    expect(tracerLines([damage], routes, 12.3, 1)[0].opacity).toBeCloseTo(0.4)
    // 2×：窗口 0.8s、保持 0.3s → 12.75（elapsed 0.75）opacity = 1-(0.75-0.3)/0.5
    expect(tracerLines([damage], routes, 12.75, 2)[0].opacity).toBeCloseTo(1 - 0.45 / 0.5)
    expect(tracerLines([damage], routes, 12.8, 2)).toEqual([])
    // 4×：窗口 1.6s、保持 0.6s → 13.5（elapsed 1.5）opacity = 1-(1.5-0.6)/1.0
    expect(tracerLines([damage], routes, 13.5, 4)[0].opacity).toBeCloseTo(1 - 0.9 / 1.0)
    expect(tracerLines([damage], routes, 13.6, 4)).toEqual([])
  })

  it('real visible duration is ≈0.4s at 1x/2x/4x (identical perceived lifetime)', () => {
    // 真实时间 0.3s：三种倍速都仍可见（游戏时间 = 0.3 × speed）
    expect(tracerLines([damage], routes, 12.3, 1)).toHaveLength(1)
    expect(tracerLines([damage], routes, 12.6, 2)).toHaveLength(1)
    expect(tracerLines([damage], routes, 13.2, 4)).toHaveLength(1)
    // 真实时间 0.41s：三种倍速都已消失（不再挂在地图上整秒）
    expect(tracerLines([damage], routes, 12.41, 1)).toEqual([])
    expect(tracerLines([damage], routes, 12.82, 2)).toEqual([])
    expect(tracerLines([damage], routes, 13.64, 4)).toEqual([])
  })

  it('shot geometry stays at event-time trusted positions while vehicles keep moving', () => {
    const moving = new Map([
      [1, { points: [{ x: 0, y: 0, timeSec: 10 }, { x: 100, y: 0, timeSec: 12 }, { x: 400, y: 0, timeSec: 14 }] }],
      [2, { points: [{ x: 0, y: 100, timeSec: 10 }, { x: 100, y: 100, timeSec: 12 }, { x: 400, y: 400, timeSec: 14 }] }]
    ])
    // t=12（事件时刻）两端 = 采样点 (100,0)/(100,100)；此后双方继续移动
    const l = tracerLines([damage], moving, 12.3, 1)[0]
    expect(l.x1).toBeCloseTo(100)
    expect(l.y1).toBeCloseTo(0)
    expect(l.x2).toBeCloseTo(100)
    expect(l.y2).toBeCloseTo(100)
    // 禁止把端点改成 currentTime 车辆位置（此刻 attacker≈(400,0)、target≈(400,400)）
    expect(l.x1).not.toBeCloseTo(400)
    expect(l.y2).not.toBeCloseTo(400)
  })

  it('seek semantics: no tracer before the event, visible inside, gone after', () => {
    expect(tracerLines([damage], routes, 11.9, 1)).toEqual([]) // 事件前
    expect(tracerLines([damage], routes, 12.2, 1)).toHaveLength(1) // 窗口内
    expect(tracerLines([damage], routes, 12.3, 4)).toHaveLength(1) // 4× 窗口内（游戏时间 1.2s）
    expect(tracerLines([damage], routes, 12.5, 1)).toEqual([]) // 1× 窗口后
  })

  it('dedupes DAMAGE+KILL of the same shot into one line', () => {
    const kill = { type: 'KILL', timeSec: 12.1, accountId: 1, targetAccountId: 2, damage: null }
    expect(tracerLines([damage, kill], routes, 12.05, 1)).toHaveLength(1)
    expect(tracerLines([damage, kill], routes, 12.3, 2)).toHaveLength(1)
    // 不同射击（相距 > 判同窗口）各画各的
    const d2 = { type: 'DAMAGE', timeSec: 13.5, accountId: 1, targetAccountId: 2, damage: 100 }
    expect(tracerLines([damage, d2], routes, 13.5, 1)).toHaveLength(1)
    expect(tracerLines([damage, d2], routes, 13.5, 4).map(l => l.timeSec)).toEqual([12, 13.5])
  })

  it('dedupes across bucket boundaries by actual time difference (no fixed buckets)', () => {
    const d1 = { type: 'DAMAGE', timeSec: 12.249, accountId: 1, targetAccountId: 2, damage: 100 }
    const kill = { type: 'KILL', timeSec: 12.251, accountId: 1, targetAccountId: 2, damage: null }
    // 相差 2ms（≤0.25s）必须算同一炮
    expect(tracerLines([d1, kill], routes, 12.25, 1)).toHaveLength(1)
    // KILL 在前时优先保留 DAMAGE
    const pref = tracerLines([kill, d1], routes, 12.25, 1)
    expect(pref).toHaveLength(1)
    expect(pref[0].timeSec).toBeCloseTo(12.249)
    // 真正超过阈值的两次射击保留两条
    const d2 = { type: 'DAMAGE', timeSec: 12.6, accountId: 1, targetAccountId: 2, damage: 100 }
    expect(tracerLines([d1, d2], routes, 12.3, 1)).toHaveLength(1)
    expect(tracerLines([d1, d2], routes, 12.6, 4).map(l => l.timeSec)).toEqual([12.249, 12.6])
  })

  it('rejects shots whose either end lacks a trusted position', () => {
    const gappy = new Map([
      [1, { points: [{ x: 0, y: 0, timeSec: 10 }, { x: 100, y: 0, timeSec: 40 }] }],
      [2, { points: [{ x: 0, y: 100, timeSec: 10 }, { x: 100, y: 100, timeSec: 14 }] }]
    ])
    expect(tracerLines([{ ...damage, timeSec: 20 }], gappy, 20, 1)).toEqual([])
    const ended = new Map([
      [1, { points: [{ x: 0, y: 0, timeSec: 10 }, { x: 100, y: 0, timeSec: 14 }] }],
      [2, { points: [{ x: 0, y: 100, timeSec: 10 }] }]
    ])
    expect(tracerLines([{ ...damage, timeSec: 30 }], ended, 30, 1)).toEqual([])
    const never = new Map([[1, { points: [{ x: 0, y: 0, timeSec: 10 }, { x: 100, y: 0, timeSec: 14 }] }]])
    expect(tracerLines([damage], never, 12, 1)).toEqual([])
  })

  it('skips unresolved attacker/target and self-shots', () => {
    expect(tracerLines([{ type: 'DAMAGE', timeSec: 12, accountId: null, targetAccountId: 2, damage: 1 }], routes, 12, 1)).toEqual([])
    expect(tracerLines([{ type: 'KILL', timeSec: 12, accountId: 1, targetAccountId: 1, damage: null }], routes, 12, 1)).toEqual([])
  })
})

describe('zoomViewAt / clampViewPan', () => {
  it('clamps scale into [1,4] and keeps the anchor point fixed', () => {
    const z = zoomViewAt({ scale: 1, tx: 0, ty: 0 }, 100, 50, 1.2)
    expect(z.scale).toBeCloseTo(1.2)
    expect(z.tx).toBeCloseTo(100 - 100 * (z.scale / 1))
    expect(z.ty).toBeCloseTo(50 - 50 * (z.scale / 1))
    expect(zoomViewAt({ scale: 3.9, tx: 0, ty: 0 }, 0, 0, 2).scale).toBe(4)
    expect(zoomViewAt({ scale: 1.1, tx: 0, ty: 0 }, 0, 0, 0.5).scale).toBe(1)
  })

  it('keeps the content point under the screen anchor fixed after prior zoom/pan', () => {
    const view = { scale: 1.7, tx: 80, ty: -40 }
    const p = { x: 150, y: 90 }
    const z = zoomViewAt(view, p.x, p.y, 1.3)
    expect(z.scale).toBeCloseTo(2.21)
    const before = { x: (p.x - view.tx) / view.scale, y: (p.y - view.ty) / view.scale }
    const after = { x: (p.x - z.tx) / z.scale, y: (p.y - z.ty) / z.scale }
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
  })

  it('keeps the anchor fixed when clamped at the max scale', () => {
    const view = { scale: 3.9, tx: 50, ty: 30 }
    const p = { x: 200, y: 100 }
    const z = zoomViewAt(view, p.x, p.y, 2)
    expect(z.scale).toBe(4)
    const before = { x: (p.x - view.tx) / view.scale, y: (p.y - view.ty) / view.scale }
    const after = { x: (p.x - z.tx) / z.scale, y: (p.y - z.ty) / z.scale }
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
  })

  it('clampViewPan resets at scale 1 and keeps content inside the viewport', () => {
    expect(clampViewPan({ scale: 1, tx: 50, ty: 50 }, 400, 300)).toEqual({ scale: 1, tx: 0, ty: 0 })
    const panned = clampViewPan({ scale: 2, tx: 100, ty: -500 }, 400, 300)
    expect(panned.tx).toBe(0)
    expect(panned.ty).toBe(-300)
    expect(clampViewPan({ scale: 2, tx: -500, ty: 0 }, 400, 300).tx).toBe(-400)
    // 尺寸未知（无布局环境）不钳制
    expect(clampViewPan({ scale: 2, tx: 50, ty: 20 }, 0, 0)).toEqual({ scale: 2, tx: 50, ty: 20 })
  })
})

describe('hpDisplay / ghostAround / cumulativeStatsAt / eventsCrossed / transients', () => {
  // PR #107 Blocker 3：baseHp（Tankopedia 静态参考）+ observedCapacityHp（回放观测容量）
  // 都是 metadata——CURRENT_HP_EXACT_MAX_UNKNOWN 不得用它们计算 pct/maxHp
  const base = { team: 1, baseHp: 3000, observedCapacityHp: 3000, deathSec: null, entryHpSource: null, entryHp: null, hpSamples: [] }

  it('hpDisplay: authoritative samples > destroyed=0 > friendly proven entry fallback > UNKNOWN', () => {
    // 采样优先；进场 max 未证明 → maxHp/pct 均为 null（Blocker 3：不得用 base/观测容量算百分比）
    const sampled = { ...base, hpSamples: [{ timeSec: 0, hp: 3000 }, { timeSec: 10, hp: 2000 }, { timeSec: 20, hp: 0 }] }
    expect(hpDisplay(sampled, 5)).toMatchObject({ current: 3000, maxHp: null, pct: null, destroyed: false, state: 'CURRENT_HP_EXACT_MAX_UNKNOWN' })
    expect(hpDisplay(sampled, 15)).toMatchObject({ current: 2000, maxHp: null, pct: null })
    // 0 采样 = 已知归零；destroyed 状态由 deathSec 判定（无 deathSec 不冒充击毁标记）
    expect(hpDisplay(sampled, 25)).toMatchObject({ current: 0, maxHp: null, pct: null, destroyed: false })
    // 已阵亡但无 0 采样 → 权威 0（不冒充满血/残血）
    const deadNoZero = { ...base, deathSec: 12, hpSamples: [{ timeSec: 0, hp: 3000 }, { timeSec: 10, hp: 2000 }] }
    expect(hpDisplay(deadNoZero, 15)).toMatchObject({ current: 0, pct: 0, destroyed: true })
    expect(hpDisplay(deadNoZero, 10)).toMatchObject({ current: 2000, destroyed: false })
    // 敌方存活无采样 → UNKNOWN（null），不是 0
    expect(hpDisplay({ ...base, hpSamples: [] }, 50).current).toBeNull()
    // 本方存活无采样 + OBSERVED_EXACT → entryHp 满血回退
    const proven = { ...base, entryHpSource: 'OBSERVED_EXACT', entryHp: 3200, hpSamples: [] }
    expect(hpDisplay(proven, 50, { friendly: true })).toMatchObject({ current: 3200 })
    // 本方存活无采样但未证明（BASE_FALLBACK/UNKNOWN）→ 禁止拿 base/观测容量冒充
    const unproven = { ...base, entryHpSource: 'BASE_FALLBACK', entryHp: null, hpSamples: [] }
    expect(hpDisplay(unproven, 50, { friendly: true }).current).toBeNull()
    expect(hpDisplay(unproven, 50).current).toBeNull()
    // base 缺失 → 显示 current，maxHp/pct 不伪造（null）
    const noMax = { ...base, baseHp: null, observedCapacityHp: null, hpSamples: [{ timeSec: 0, hp: 1520 }] }
    expect(hpDisplay(noMax, 5)).toMatchObject({ current: 1520, maxHp: null, pct: null })
    expect(hpDisplay(null, 5)).toBeNull()
  })

  it('ghostAround: only when HP actually drops across the event AND max is proven; null otherwise', () => {
    // Blocker 3：pct 只在 OBSERVED_EXACT 下存在——ghost 需要 pct，未证明 max 时不伪造 ghost
    const v = { ...base, entryHpSource: 'OBSERVED_EXACT', entryHp: 3000, hpSamples: [{ timeSec: 0, hp: 3000 }, { timeSec: 10, hp: 2100 }] }
    const g = ghostAround(v, 10)
    expect(g).toEqual({ prevPct: 100, nextPct: 70 })
    // 进场 max 未证明（CURRENT_HP_EXACT_MAX_UNKNOWN，pct=null）→ 不伪造 ghost
    const unprovenDrop = { ...base, hpSamples: [{ timeSec: 0, hp: 3000 }, { timeSec: 10, hp: 2100 }] }
    expect(ghostAround(unprovenDrop, 10)).toBeNull()
    // 无变化 / 数据缺失 → null（不伪造 ghost）
    expect(ghostAround({ ...base, entryHpSource: 'OBSERVED_EXACT', entryHp: 3000, hpSamples: [{ timeSec: 0, hp: 3000 }] }, 10)).toBeNull()
    expect(ghostAround(v, 5)).toBeNull()
    expect(ghostAround(null, 10)).toBeNull()
  })

  it('cumulativeStatsAt: deterministic dealt/received/kills at arbitrary t（hpLosses 口径，§16/§17）', () => {
    // vehicles：车辆 1 是受害者（received），车辆 2 是攻击者（dealt attribution）
    const vehicles = [
      { accountId: 1, hpLosses: [
        { fromSec: 0, toSec: 10, hpLoss: 400, attackerAccountId: 2, attackerReliable: true },
        { fromSec: 10, toSec: 12, hpLoss: 540, attackerAccountId: null, attackerReliable: false }, // 不可归属
      ] },
      { accountId: 2, hpLosses: [
        { fromSec: 12, toSec: 30, hpLoss: 320, attackerAccountId: 1, attackerReliable: true },     // 车辆 1 造成的
      ] },
    ]
    const events = [
      { type: 'KILL', timeSec: 30, accountId: 1, targetAccountId: 2 },
    ]
    expect(cumulativeStatsAt(events, 1, 5, vehicles)).toEqual({ dealt: 0, received: 0, kills: 0 })
    expect(cumulativeStatsAt(events, 1, 11, vehicles)).toEqual({ dealt: 0, received: 400, kills: 0 })
    expect(cumulativeStatsAt(events, 1, 12, vehicles)).toEqual({ dealt: 0, received: 940, kills: 0 })
    expect(cumulativeStatsAt(events, 1, 40, vehicles)).toEqual({ dealt: 320, received: 940, kills: 1 })
    expect(cumulativeStatsAt(events, 2, 40, vehicles)).toEqual({ dealt: 400, received: 320, kills: 0 })
    // backward seek 恢复旧值（不依赖单向累减）
    expect(cumulativeStatsAt(events, 1, 12, vehicles)).toEqual({ dealt: 0, received: 940, kills: 0 })
    expect(cumulativeStatsAt(null, 1, 10)).toEqual({ dealt: 0, received: 0, kills: 0 })
    // raw Type-8 协议值不参与统计（即使出现在 events 里）
    const rawEvents = [{ type: 'DAMAGE', timeSec: 5, accountId: 1, targetAccountId: 2, rawProtocolValue: 9999 }]
    expect(cumulativeStatsAt(rawEvents, 1, 10, vehicles)).toEqual({ dealt: 0, received: 400, kills: 0 })
  })

  it('damageLogAt: 最近伤害记录（§19）——in/out + 不可归属 + anti-future-leak + 最近 N 条', () => {
    const vehicles = [
      { accountId: 1, hpLosses: [
        { fromSec: 0, toSec: 10, hpLoss: 400, attackerAccountId: 2, attackerReliable: true },
        { fromSec: 10, toSec: 12, hpLoss: 540, attackerAccountId: null, attackerReliable: false },
      ] },
      { accountId: 2, hpLosses: [
        { fromSec: 5, toSec: 15, hpLoss: 300, attackerAccountId: 1, attackerReliable: true },
        { fromSec: 15, toSec: 50, hpLoss: 700, attackerAccountId: 1, attackerReliable: true },
      ] },
      { accountId: 3, hpLosses: [] },
    ]
    // t=20：future（50s）不泄漏
    let log = damageLogAt(vehicles, 1, 20)
    expect(log.map(r => [r.dir, r.hpLoss])).toEqual([
      ['in', 400], ['in', 540], ['out', 300],
    ])
    expect(log[0].attackerAccountId).toBe(2)
    expect(log[0].attackerReliable).toBe(true)
    expect(log[1].attackerReliable).toBe(false) // 不可归属
    expect(log[2].victimAccountId).toBe(2)
    // t=60：全部可见；最近 2 条（时间升序的末 2 条）
    const last2 = damageLogAt(vehicles, 1, 60, 2)
    expect(last2.map(r => r.hpLoss)).toEqual([300, 700])
    // 无效输入
    expect(damageLogAt(null, 1, 60)).toEqual([])
    expect(damageLogAt(vehicles, 99, 60)).toEqual([])
  })

  it('eventsCrossed: strict left-open, inclusive right; no re-trigger at cursor', () => {
    const events = [
      { type: 'DAMAGE', timeSec: 10, accountId: 1, targetAccountId: 2, damage: 100 },
      { type: 'DAMAGE', timeSec: 10.5, accountId: 2, targetAccountId: 1, damage: 200 },
      { type: 'KILL', timeSec: 20, accountId: 1, targetAccountId: 2, damage: null }
    ]
    expect(eventsCrossed(events, 0, 10)).toHaveLength(1) // 10 恰在 to：消费
    expect(eventsCrossed(events, 10, 10.5)).toHaveLength(1) // 10 在 from 上：不重复
    expect(eventsCrossed(events, 10.5, 11)).toHaveLength(0)
    expect(eventsCrossed(events, 11, 21)).toHaveLength(1) // KILL 20
    expect(eventsCrossed(events, 20, 21)).toHaveLength(0) // seek 到事件时刻：不补播
    expect(eventsCrossed(null, 0, 5)).toEqual([])
  })

  it('transientsActive / pushFeed: wall-clock lifecycle + queue eviction', () => {
    const a = { id: 1, bornRealMs: 1000, durationMs: 1000 }
    const b = { id: 2, bornRealMs: 1500, durationMs: 1000 }
    expect(transientsActive([a, b], 1999)).toHaveLength(2)
    expect(transientsActive([a, b], 2000)).toHaveLength(1) // a 到期
    expect(transientsActive([a, b], 2501)).toHaveLength(0)
    expect(transientsActive(null, 0)).toEqual([])
    // kill feed 队列：最多 3 条、新进挤最旧、不合并
    let feed = []
    feed = pushFeed(feed, { victimAccountId: 1 })
    feed = pushFeed(feed, { victimAccountId: 2 })
    feed = pushFeed(feed, { victimAccountId: 3 })
    feed = pushFeed(feed, { victimAccountId: 4 })
    expect(feed.map(i => i.victimAccountId)).toEqual([2, 3, 4])
    expect(pushFeed([], { victimAccountId: 5 }, 0)).toHaveLength(0)
  })

  it('victimFeedbackAllowed: covered at event time only (last-known 期间受击不跳伤害)', () => {
    const v = { positionIntervals: [{ startSec: 10, endSec: 20 }, { startSec: 40, endSec: 60 }] }
    expect(victimFeedbackAllowed(v, 15)).toBe(true)
    expect(victimFeedbackAllowed(v, 45)).toBe(true)
    expect(victimFeedbackAllowed(v, 30)).toBe(false) // 失察期间受击：不跳伤害
    expect(victimFeedbackAllowed(v, 20)).toBe(true)
    expect(victimFeedbackAllowed(null, 15)).toBe(false)
  })

  it('hpDisplay (review Blocker 3): enemy HP 冻结在 last-known，恢复 coverage 后跳到最新可信值；friendly 不受影响', () => {
    const intervals = [{ startSec: 0, endSec: 20 }, { startSec: 40, endSec: 60 }]
    const enemy = {
      ...base, team: 2, baseHp: 3000, observedCapacityHp: 3000,
      positionIntervals: intervals,
      hpSamples: [
        { timeSec: 10, hp: 3000 },
        { timeSec: 30, hp: 2200 },
        { timeSec: 35, hp: 1800 },
        { timeSec: 42, hp: 1700 }
      ]
    }
    // 覆盖期内正常更新
    expect(hpDisplay(enemy, 15)).toMatchObject({ current: 3000 })
    // 失察期（20–40）：冻结在进入 last-known 前最后可信 HP——hidden interval 内
    // 的后续采样（2200@30 / 1800@35）不得提前泄漏
    for (const t of [25, 30, 35, 39.9]) {
      expect(hpDisplay(enemy, t)).toMatchObject({ current: 3000 })
    }
    // 恢复 coverage（40+）：直接跳到届时最新可信值（不补播 hidden interval 历史动画）
    expect(hpDisplay(enemy, 40)).toMatchObject({ current: 1800 })
    expect(hpDisplay(enemy, 42)).toMatchObject({ current: 1700 })
    // backward seek 确定性：回到失察期仍冻结
    expect(hpDisplay(enemy, 30)).toMatchObject({ current: 3000 })
    // friendly 不受敌方冻结规则误伤：同一 gap 结构下 HP 正常更新
    const friendly = { ...enemy, team: 1 }
    expect(hpDisplay(friendly, 30, { friendly: true })).toMatchObject({ current: 2200 })
    // 无 positionIntervals 的车辆不建模覆盖（旧语义：直接使用 t）
    const noIntervals = { ...base, hpSamples: [{ timeSec: 0, hp: 3000 }, { timeSec: 30, hp: 2200 }] }
    expect(hpDisplay(noIntervals, 30)).toMatchObject({ current: 2200 })
    // 从未覆盖（无 last-known 可冻结）→ UNKNOWN（不得把 hidden 采样当已知血量）
    const neverSeen = { ...base, positionIntervals: [{ startSec: 40, endSec: 60 }], hpSamples: [{ timeSec: 10, hp: 3000 }] }
    expect(hpDisplay(neverSeen, 30).current).toBeNull()
  })
  // ---- PR #107 HP provenance：开局相对满血 / max 未知 / 不伪造 ----

  it('hpDisplay: 己方开局无 sample 且无战前掉血 → RULE_DERIVED_FULL_AT_SPAWN（fullState，不伪造数字）', () => {
    const v = { ...base, hpSamples: [], hpLosses: [], team: 1 }
    const r = hpDisplay(v, 0, { friendly: true })
    expect(r.current).toBeNull() // 不伪造具体数字
    expect(r.maxHp).toBeNull()   // 不用 tankopedia base 冒充 max
    expect(r.pct).toBeNull()     // 不伪造百分比
    expect(r.state).toBe('RULE_DERIVED_FULL_AT_SPAWN')
    expect(r.fullState).toBe(true) // 前端渲染 100% 阵营色条
  })

  it('hpDisplay: 己方开局无 sample 但有战前掉血 → UNKNOWN（不误判满血）', () => {
    const v = { ...base, hpSamples: [], hpLosses: [{ fromSec: 0, toSec: 2, hpLoss: 100, attackerAccountId: null, attackerReliable: false }], team: 1 }
    const r = hpDisplay(v, 5, { friendly: true })
    expect(r.current).toBeNull()
    expect(r.state).toBe('UNKNOWN')
    expect(r.fullState).toBe(false)
  })

  it('hpDisplay: 首个 sample 在首次受击后 → 真实 current；max 未证明 → maxHp/pct 均为 null', () => {
    // Blocker 3 回归：baseHp=3000、实际 entryHp 未证明、current=2500：
    // state=CURRENT_HP_EXACT_MAX_UNKNOWN、current=2500、maxHp=null、pct=null——
    // 禁止出现按 2500/3000 计算的结果（baseHp/observedCapacityHp 只是 metadata）
    const v = { ...base, baseHp: 3000, observedCapacityHp: 3000, hpSamples: [{ timeSec: 10, hp: 2500 }] }
    const before = hpDisplay(v, 5)
    expect(before.current).toBeNull() // sample 前无依据（敌方/无 fullState）
    const after = hpDisplay(v, 15)
    expect(after.current).toBe(2500) // 真实 current
    expect(after.state).toBe('CURRENT_HP_EXACT_MAX_UNKNOWN') // 进场 max 未证明
    expect(after.maxHp).toBeNull() // 绝不按 baseHp/observedCapacityHp 冒充 max
    expect(after.pct).toBeNull() // 绝不计算真实百分比
  })

  it('hpDisplay: OBSERVED_EXACT 已证明 → 精确 current/max/pct', () => {
    const v = { ...base, entryHpSource: 'OBSERVED_EXACT', entryHp: 3200, hpSamples: [{ timeSec: 0, hp: 3200 }, { timeSec: 10, hp: 2800 }] }
    const r = hpDisplay(v, 5)
    expect(r.current).toBe(3200)
    expect(r.maxHp).toBe(3200)
    expect(r.pct).toBe(100)
    expect(r.state).toBe('OBSERVED_EXACT')
  })

  it('hpDisplay: 敌方无 sample 恒 UNKNOWN（不因己方 fallback 泄漏满血）', () => {
    const enemy = { ...base, team: 2, hpSamples: [] }
    const r = hpDisplay(enemy, 0, { friendly: false })
    expect(r.current).toBeNull()
    expect(r.state).toBe('UNKNOWN')
    expect(r.fullState).toBe(false)
    // 即使 friendly=true 也不得把敌方当本方（team 语义由调用方决定；此处显式敌方路径）
    const alsoEnemy = hpDisplay(enemy, 0)
    expect(alsoEnemy.state).toBe('UNKNOWN')
  })

  it('hpDisplay: 敌方 last-known 冻结，hidden interval 不泄漏', () => {
    const intervals = [{ startSec: 0, endSec: 20 }, { startSec: 40, endSec: 60 }]
    const enemy = {
      ...base, team: 2,
      positionIntervals: intervals,
      hpSamples: [{ timeSec: 10, hp: 3000 }, { timeSec: 30, hp: 2200 }, { timeSec: 42, hp: 1700 }]
    }
    // 覆盖期（10）→ 3000
    expect(hpDisplay(enemy, 15).current).toBe(3000)
    // 失察期（25-39）→ 冻结 3000，hidden 采样 2200@30 不泄漏
    for (const t of [25, 30, 35, 39]) {
      expect(hpDisplay(enemy, t).current).toBe(3000)
    }
    // 恢复覆盖（42）→ 1700
    expect(hpDisplay(enemy, 42).current).toBe(1700)
  })

  it('hpDisplay: seek 0s → 开局相对满血（己方）；首个 sample 后 → 真实 current；阵亡 → 0', () => {
    const v = { ...base, team: 1, deathSec: 30, hpSamples: [{ timeSec: 10, hp: 2500 }, { timeSec: 30, hp: 0 }] }
    // seek 到 0s：首个 sample（10s）之前 → 己方相对满血
    const t0 = hpDisplay(v, 0, { friendly: true })
    expect(t0.state).toBe('RULE_DERIVED_FULL_AT_SPAWN')
    expect(t0.current).toBeNull()
    // seek 到 15s：sample 后 → 真实 current
    const t15 = hpDisplay(v, 15, { friendly: true })
    expect(t15.current).toBe(2500)
    expect(t15.state).toBe('CURRENT_HP_EXACT_MAX_UNKNOWN')
    // backward seek 回 0s：确定性重建（又回到相对满血）
    expect(hpDisplay(v, 0, { friendly: true }).state).toBe('RULE_DERIVED_FULL_AT_SPAWN')
    // seek 到阵亡后 → 0
    const t31 = hpDisplay(v, 31, { friendly: true })
    expect(t31.current).toBe(0)
    expect(t31.destroyed).toBe(true)
  })

  it('hpDisplay: Tankopedia base 不冒充 actual——base=3000 真实 entry=3189 时只显示 3189', () => {
    // Blocker 3：baseHp=3000、已证明 entryHp=3189、current=2500 → maxHp=3189、pct=2500/3189
    //（绝不按 2500/3000 计算）
    const v = { ...base, baseHp: 3000, observedCapacityHp: 3000, entryHpSource: 'OBSERVED_EXACT', entryHp: 3189, hpSamples: [{ timeSec: 0, hp: 2500 }] }
    const r = hpDisplay(v, 5)
    expect(r.current).toBe(2500)
    expect(r.maxHp).toBe(3189)
    expect(r.pct).toBeCloseTo(2500 / 3189 * 100, 6)
    expect(r.state).toBe('OBSERVED_EXACT')
    // 未证明时 maxHp 不得显示具体 base
    const unproven = { ...base, baseHp: 3000, observedCapacityHp: 3000, entryHpSource: null, hpSamples: [] }
    const r2 = hpDisplay(unproven, 0, { friendly: true })
    expect(r2.current).toBeNull()
    expect(r2.maxHp).toBeNull()
    expect(r2.fullState).toBe(true) // 相对满血状态，无具体数字
  })
})