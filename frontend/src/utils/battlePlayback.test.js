import { describe, expect, it } from 'vitest'
import {
  aggregateEventsBySecond,
  formatClock,
  lastKnownPosition,
  parseAiTime,
  positionAt,
  positionCoveredAt,
  recorderRelated,
  routePrefix
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
