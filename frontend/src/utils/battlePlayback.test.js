import { describe, expect, it } from 'vitest'
import {
  aggregateEventsBySecond,
  clampViewPan,
  formatClock,
  interpolateDirection,
  lastKnownPosition,
  normalizeDeg,
  parseAiTime,
  positionAt,
  positionCoveredAt,
  recorderRelated,
  screenRotation,
  shortestArcDeg,
  teamHp,
  teamPointsAt,
  vehicleHpAt,
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
  const vehicles = [
    { team: 1, maxHp: 3000, hpSamples: [{ timeSec: 0, hp: 3000 }, { timeSec: 10, hp: 2000 }, { timeSec: 20, hp: 0 }] },
    { team: 1, maxHp: 2600, hpSamples: [] },
    { team: 2, maxHp: 4000, hpSamples: [{ timeSec: 5, hp: 4000 }, { timeSec: 15, hp: 1000 }] }
  ]

  it('vehicleHpAt: sample priority; full-HP fallback only when assumeFullWhenUnobserved and alive', () => {
    expect(vehicleHpAt(vehicles[0], 5)).toBe(3000)
    expect(vehicleHpAt(vehicles[0], 10)).toBe(2000)
    expect(vehicleHpAt(vehicles[0], 25)).toBe(0) // 阵亡 0 采样
    // 敌方/未知路径（默认 false）：存活无采样 → UNKNOWN，禁止把理论 maxHp 当已知血量
    expect(vehicleHpAt(vehicles[1], 50)).toBeNull()
    expect(vehicleHpAt({ team: 1, maxHp: 100 }, 0)).toBeNull()
    // 本方路径（assumeFullWhenUnobserved=true）：存活无采样 → 满血回退
    expect(vehicleHpAt(vehicles[1], 50, true)).toBe(2600)
    expect(vehicleHpAt({ team: 1, maxHp: 100 }, 0, true)).toBe(100)
    // 已阵亡且无采样 → UNKNOWN（即使本方路径也不冒充满血/0）
    expect(vehicleHpAt({ team: 1, maxHp: 2600, deathSec: 10 }, 50, true)).toBeNull()
    expect(vehicleHpAt({ team: 1, maxHp: 2600, deathSec: 10 }, 5, true)).toBe(2600) // 阵亡前未受击=满血
    expect(vehicleHpAt(null, 0)).toBeNull()
    // sentinel（0xFFFD=65533 / 0xFFFF=65535）绝不作为 HP：忽略后按调用方策略
    const sentinel = { team: 1, maxHp: 2600, hpSamples: [{ timeSec: 0, hp: 65533 }, { timeSec: 1, hp: 65535 }] }
    expect(vehicleHpAt(sentinel, 5)).toBeNull() // 敌方路径 → UNKNOWN
    expect(vehicleHpAt(sentinel, 5, true)).toBe(2600) // 本方路径存活 → 满血回退
  })

  it('teamHp: friendly assumeFullWhenUnobserved; enemy keeps UNKNOWN without samples', () => {
    // 本方（assumeFull=true）：无采样存活车按满血回退
    expect(teamHp(vehicles, 1, 5, true)).toEqual({ totalMax: 5600, knownRemaining: 5600, unknownMax: 0 })
    expect(teamHp(vehicles, 1, 15, true)).toEqual({ totalMax: 5600, knownRemaining: 4600, unknownMax: 0 }) // 2000 + 满血回退 2600
    // 敌方（assumeFull=false）：无采样存活车恒 UNKNOWN 灰段，不得 maxHp fallback
    expect(teamHp(vehicles, 1, 5)).toEqual({ totalMax: 5600, knownRemaining: 3000, unknownMax: 2600 })
    expect(teamHp(vehicles, 1, 15)).toEqual({ totalMax: 5600, knownRemaining: 2000, unknownMax: 2600 })
    // 敌方有第一条真实 HP sample（vehicles[2] 首采样 t=5）→ 使用真实 sample，不再 UNKNOWN
    expect(teamHp(vehicles, 2, 5)).toEqual({ totalMax: 4000, knownRemaining: 4000, unknownMax: 0 })
    expect(teamHp(vehicles, 2, 4)).toEqual({ totalMax: 4000, knownRemaining: 0, unknownMax: 4000 }) // 首采样前仍 UNKNOWN
    expect(teamHp(vehicles, 2, 15)).toEqual({ totalMax: 4000, knownRemaining: 1000, unknownMax: 0 })
    // 阵亡且无采样 → 双方路径都 UNKNOWN
    expect(teamHp([{ team: 1, maxHp: 2000, deathSec: 5 }], 1, 50, true))
      .toEqual({ totalMax: 2000, knownRemaining: 0, unknownMax: 2000 })
    expect(teamHp([{ team: 1, maxHp: 2000, deathSec: 5 }], 1, 50))
      .toEqual({ totalMax: 2000, knownRemaining: 0, unknownMax: 2000 })
    // perspectiveTeam=2 场景：team2 用 friendly fallback、team1 保持 enemy UNKNOWN（不写死 team1=本方）
    const mirror = vehicles.map(v => ({ ...v, team: v.team === 1 ? 2 : 1 }))
    expect(teamHp(mirror, 2, 5, true)).toEqual({ totalMax: 5600, knownRemaining: 5600, unknownMax: 0 })
    expect(teamHp(mirror, 1, 5)).toEqual({ totalMax: 4000, knownRemaining: 4000, unknownMax: 0 })
    expect(teamHp([], 1, 0)).toEqual({ totalMax: 0, knownRemaining: 0, unknownMax: 0 })
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
