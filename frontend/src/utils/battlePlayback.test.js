import { describe, expect, it } from 'vitest'
import {
  aggregateEventsBySecond,
  formatClock,
  interpolateDirection,
  lastKnownPosition,
  normalizeDeg,
  parseAiTime,
  positionAt,
  positionCoveredAt,
  recorderRelated,
  routePrefix,
  screenRotation,
  shortestArcDeg,
  turretWorldYawDeg
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

describe('routePrefix', () => {
  const points = [
    { x: 0, y: 0, timeSec: 10 },
    { x: 10, y: 0, timeSec: 14 },
    { x: 20, y: 0, timeSec: 40 },
    { x: 30, y: 0, timeSec: 44 }
  ]
  it('only returns points up to t (future hidden)', () => {
    const segs = routePrefix(points, 14)
    expect(segs).toHaveLength(1)
    const flat = segs.flat().map(p => p.timeSec)
    expect(Math.max(...flat)).toBeLessThanOrEqual(14.001)
    expect(flat).not.toContain(40)
  })
  it('breaks segments across a gap > 5s', () => {
    const segs = routePrefix(points, 44)
    expect(segs).toHaveLength(2)
    expect(segs[0].map(p => p.timeSec)).toEqual([10, 14])
    expect(segs[1].map(p => p.timeSec)).toEqual([40, 44])
  })
  it('appends the interpolated live position when inside a trusted segment', () => {
    const segs = routePrefix(points, 12)
    const last = segs[0][segs[0].length - 1]
    expect(last.timeSec).toBe(12)
    expect(last.x).toBeCloseTo(5)
  })
  it('does not append a live point inside a gap', () => {
    const segs = routePrefix(points, 20)
    expect(segs).toHaveLength(1)
    expect(segs[0].map(p => p.timeSec)).toEqual([10, 14])
  })
  it('skips invalid coordinates and never through-lines them', () => {
    const bad = [
      { x: 0, y: 0, timeSec: 10 },
      { x: Number.NaN, y: 0, timeSec: 12 },
      { x: 20, y: 0, timeSec: 15 }
    ]
    const segs = routePrefix(bad, 15)
    expect(segs).toHaveLength(1)
    expect(segs[0].map(p => p.timeSec)).toEqual([10, 15])
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
