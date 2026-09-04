import { describe, expect, it } from 'vitest'
import {
  activeFeed,
  clampViewPan,
  eventsCrossed,
  formatClock,
  KILL_FEED_MS,
  lastKnownPosition,
  normalizeDeg,
  parseAiTime,
  positionAt,
  pushFeed,
  recentPositionTrails,
  screenRotation,
  shortestArcDeg,
  teamPointsAt,
  transientsActive,
  tracerLines,
  trustedPositionAt,
  turretWorldYawDeg,
  zoomViewAt
} from './battlePlayback'

describe('recentPositionTrails', () => {
  const vehicle = (positionSegments) => ({ accountId: 7, friendly: true, positionSegments })

  it('renders only observed samples in the last two seconds and never future points', () => {
    const trails = recentPositionTrails([vehicle([{
      knowledge: 'OBSERVED',
      samples: [{ timeSec: 8, x: 0, y: 0 }, { timeSec: 9, x: 10, y: 0 }, { timeSec: 10, x: 20, y: 0 }, { timeSec: 11, x: 30, y: 0 }],
    }])], 10)
    expect(trails).toHaveLength(2)
    expect(trails.every(trail => trail.to?.timeSec <= 10)).toBe(true)
  })

  it('does not draw across observed gaps or LAST_KNOWN segments', () => {
    const trails = recentPositionTrails([vehicle([
      { knowledge: 'OBSERVED', startSec: 8, endSec: 8, samples: [{ timeSec: 8, x: 0, y: 0 }] },
      { knowledge: 'OBSERVED', startSec: 14, endSec: 14, samples: [{ timeSec: 14, x: 10, y: 0 }] },
      { knowledge: 'LAST_KNOWN', samples: [{ timeSec: 9, x: 1, y: 1 }, { timeSec: 10, x: 2, y: 2 }] },
    ])], 14)
    expect(trails).toHaveLength(1)
    expect(trails[0].point.timeSec).toBe(14)
    expect(trails.some(trail => trail.from)).toBe(false)
  })

  it('uses canonical interpolation for a long single OBSERVED segment without a 5s break', () => {
    const trails = recentPositionTrails([vehicle([{
      knowledge: 'OBSERVED',
      interpolationAllowed: true,
      startSec: 8,
      endSec: 16,
      samples: [{ timeSec: 8, x: 0, y: 0 }, { timeSec: 16, x: 80, y: 0 }],
    }])], 15)
    expect(trails).toHaveLength(1)
    expect(trails[0].from.timeSec).toBe(13)
    expect(trails[0].to.timeSec).toBe(15)
    expect(trails[0].from.x).toBeCloseTo(50)
    expect(trails[0].to.x).toBeCloseTo(70)
  })

  it('does not interpolate a segment that explicitly disallows interpolation', () => {
    const trails = recentPositionTrails([vehicle([{
      knowledge: 'OBSERVED',
      interpolationAllowed: false,
      startSec: 8,
      endSec: 16,
      samples: [{ timeSec: 8, x: 0, y: 0 }, { timeSec: 16, x: 80, y: 0 }],
    }])], 15)
    expect(trails).toHaveLength(0)
  })
})

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

describe('teamPointsAt', () => {
  it('returns the latest broadcast <= t per team, null when absent', () => {
    const samples = [
      { timeSec: 56.233, team: 1, points: 303 },
      { timeSec: 58.234, team: 1, points: 306 },
      { timeSec: 78.534, team: 1, points: 305 },
      { timeSec: 78.534, team: 2, points: 361 }
    ]
    expect(teamPointsAt(samples, 1, 0)).toBeNull()
    expect(teamPointsAt(samples, 1, 56.5)).toBe(303)
    expect(teamPointsAt(samples, 1, 58.5)).toBe(306)
    expect(teamPointsAt(samples, 1, 78.6)).toBe(305)
    expect(teamPointsAt(samples, 2, 78.6)).toBe(361)
    expect(teamPointsAt(samples, 2, 56.5)).toBeNull()
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

})

describe('playback presentation utilities', () => {
  it('formats clocks', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(200)).toBe('03:20')
    expect(formatClock(75.4)).toBe('01:15')
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
    // 前 0.3s（真实时间）保持全亮（激光感），之后线性淡出到 0.8s 窗口结束
    expect(tracerLines([damage], routes, 12.3, 1)[0].opacity).toBeCloseTo(1)
    expect(tracerLines([damage], routes, 12.5, 1)[0].opacity).toBeCloseTo(0.6) // 1 - 0.2/0.5
    expect(tracerLines([damage], routes, 12.8, 1)).toEqual([])
    expect(tracerLines([damage], routes, 12, 1)).toHaveLength(1)
  })

  it('uses canonical position segment permission instead of the legacy 5s gap heuristic', () => {
    const canonical = new Map([
      [1, { positionSegments: [{ knowledge: 'OBSERVED', interpolationAllowed: true, startSec: 0, endSec: 20,
        samples: [{ timeSec: 0, x: 0, y: 0 }, { timeSec: 20, x: 200, y: 0 }] }] }],
      [2, { positionSegments: [{ knowledge: 'OBSERVED', interpolationAllowed: true, startSec: 0, endSec: 20,
        samples: [{ timeSec: 0, x: 0, y: 100 }, { timeSec: 20, x: 200, y: 100 }] }] }],
    ])
    expect(tracerLines([{ ...damage, timeSec: 10 }], canonical, 10, 1)).toHaveLength(1)

    canonical.get(2).positionSegments[0].interpolationAllowed = false
    expect(tracerLines([{ ...damage, timeSec: 10 }], canonical, 10, 1)).toEqual([])
  })

  it('impact flash: short peak curve (invisible→0.9 at 0.1s→0) and vanishes at window end', () => {
    // flashProgress 0→1 over 0.7s real at any speed
    expect(tracerLines([damage], routes, 12, 1)[0].flashProgress).toBeCloseTo(0)
    expect(tracerLines([damage], routes, 12.2, 1)[0].flashProgress).toBeCloseTo(0.2 / 0.7)
    // flashOpacity 峰值曲线：0ms 不可见 → 0.2s 达峰值 0.9 → 0.7s 归零
    expect(tracerLines([damage], routes, 12, 1)[0].flashOpacity).toBeCloseTo(0)
    expect(tracerLines([damage], routes, 12.2, 1)[0].flashOpacity).toBeCloseTo(0.9)
    // 闪光窗口结束点（真实 0.7s）：flashProgress 钳制为 1、flashOpacity 归零，
    // 而炮线本体仍在淡出（0.3→0.8s），不随闪光一起消失
    const atFlashEnd = tracerLines([damage], routes, 12.7, 1)[0]
    expect(atFlashEnd.flashProgress).toBeCloseTo(1)
    expect(atFlashEnd.flashOpacity).toBeCloseTo(0)
    expect(atFlashEnd.opacity).toBeCloseTo(0.2)
    // 炮线窗口结束（真实 0.8s）后整条线消失
    expect(tracerLines([damage], routes, 12.8, 1)).toEqual([])
    // 2×/4×：真实 0.7s 对应游戏 1.4s / 2.8s
    expect(tracerLines([damage], routes, 12.7, 2)[0].flashProgress).toBeCloseTo(0.5)
    expect(tracerLines([damage], routes, 13.4, 4)[0].flashProgress).toBeCloseTo(0.5)
  })

  it('windows scale with playback speed (1x/2x/4x) — short shot effect', () => {
    expect(tracerLines([damage], routes, 12.8, 1)).toEqual([])
    // 1×：窗口 0.8s、保持 0.3s → 12.6（elapsed 0.6）opacity = 1-(0.6-0.3)/0.5 = 0.4
    expect(tracerLines([damage], routes, 12.6, 1)[0].opacity).toBeCloseTo(0.4)
    // 2×：窗口 1.6s、保持 0.6s → 13.5（elapsed 1.5）opacity = 1-(1.5-0.6)/1.0
    expect(tracerLines([damage], routes, 13.5, 2)[0].opacity).toBeCloseTo(1 - 0.9 / 1.0)
    expect(tracerLines([damage], routes, 13.6, 2)).toEqual([])
    // 4×：窗口 3.2s、保持 1.2s → 15（elapsed 3.0）opacity = 1-(3.0-1.2)/2.0
    expect(tracerLines([damage], routes, 15, 4)[0].opacity).toBeCloseTo(1 - 1.8 / 2.0)
    expect(tracerLines([damage], routes, 15.2, 4)).toEqual([])
  })

  it('real visible duration is ≈0.8s at 1x/2x/4x (identical perceived lifetime)', () => {
    // 真实时间 0.6s：三种倍速都仍可见（游戏时间 = 0.6 × speed）
    expect(tracerLines([damage], routes, 12.6, 1)).toHaveLength(1)
    expect(tracerLines([damage], routes, 13.2, 2)).toHaveLength(1)
    expect(tracerLines([damage], routes, 14.4, 4)).toHaveLength(1)
    // 真实时间 0.81s：三种倍速都已消失
    expect(tracerLines([damage], routes, 12.81, 1)).toEqual([])
    expect(tracerLines([damage], routes, 13.62, 2)).toEqual([])
    expect(tracerLines([damage], routes, 15.24, 4)).toEqual([])
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
    expect(tracerLines([damage], routes, 12.9, 1)).toEqual([]) // 1× 窗口后
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

describe('eventsCrossed / transients', () => {
  it('eventsCrossed: strict left-open, inclusive right; no re-trigger at cursor', () => {
    const events = [{ timeSec: 10 }, { timeSec: 20 }, { timeSec: 30 }]
    expect(eventsCrossed(events, 10, 20)).toEqual([{ timeSec: 20 }])
    expect(eventsCrossed(events, 20, 20)).toEqual([])
    expect(eventsCrossed(events, 20, 30)).toEqual([{ timeSec: 30 }])
  })

  it('transientsActive: wall-clock lifecycle', () => {
    const items = [
      { bornRealMs: 1000, durationMs: 500 },
      { bornRealMs: 1500, durationMs: 1000 },
      { bornRealMs: 500, durationMs: 1000 }
    ]
    expect(transientsActive(items, 1999)).toEqual([items[1]])
  })

  it('pushFeed / activeFeed: real banner queue — max 2 visible, 3rd waits (not sliced away)', () => {
    const shown = new Map()
    const mk = (id) => ({ id, durationMs: KILL_FEED_MS })
    // pushFeed 只追加，不 slice 掉旧事件
    expect(pushFeed([{ id: 1 }], { id: 2 })).toEqual([{ id: 1 }, { id: 2 }])
    // 三条同时到达：只显示前两条，第三条排队（不挤出）
    expect(activeFeed([mk(1), mk(2), mk(3)], 1000, shown).map(i => i.id)).toEqual([1, 2])
    expect(activeFeed([mk(1), mk(2), mk(3)], 1500, shown).map(i => i.id)).toEqual([1, 2])
    // 4s 后：前两条已展示完，第三条被提升展示（事件仍在队列中，未被挤出）
    expect(activeFeed([mk(1), mk(2), mk(3)], 7000, shown).map(i => i.id)).toEqual([3])
  })

  it('clampViewPan: pan bounds based on visible stage vs rendered map rect (cover/fit)', () => {
    // 方形地图、宽 stage：scale=1 时 map 宽=stage 宽、map 高>stage 高 → 纵向可平移（被裁区域可达）
    expect(clampViewPan({ scale: 1, tx: 0, ty: 0 }, 1600, 900, 1600, 1600)).toEqual({ scale: 1, tx: 0, ty: 0 })
    expect(clampViewPan({ scale: 1, tx: 0, ty: -400 }, 1600, 900, 1600, 1600).ty).toBe(-400)
    // fit（scale<1 使完整地图可见）→ 居中，不可平移
    expect(clampViewPan({ scale: 0.5, tx: 999, ty: 999 }, 1600, 900, 1600, 1600)).toEqual({ scale: 0.5, tx: 400, ty: 50 })
    // 地图小于 stage（窄图宽视口）→ 居中
    expect(clampViewPan({ scale: 1, tx: 0, ty: 0 }, 1600, 900, 600, 900)).toEqual({ scale: 1, tx: 500, ty: 0 })
    // 超宽视口（3440×1440）cover-fill：地图宽=stage 宽、高度超高 → 纵向被裁区域可达（底边 ty=-2000 可到），
    // 横向无裁切则居中（tx=0）。这是对「宽视口几何」的真实回归：没被 clamp 钉死在 tx/ty=0。
    expect(clampViewPan({ scale: 1, tx: 0, ty: -5000 }, 3440, 1440, 3440, 3440)).toEqual({ scale: 1, tx: 0, ty: -2000 })
    expect(clampViewPan({ scale: 1, tx: 999, ty: 0 }, 3440, 1440, 3440, 3440).tx).toBe(0)
    // 宽视口拟合（地图高 < stage 高）→ 纵向居中，不可平移。
    expect(clampViewPan({ scale: 1, tx: 0, ty: 999 }, 3440, 1440, 3440, 900).ty).toBe(270)
  })

  it('clampViewPan: 1500×1080 stage + 1500×1500 map — 顶边/底边可达 + Reset View fit(scale<1) 不偏移', () => {
    // §Blocker 1：锚定 origin（无 CSS 居中偏移）后，cover 下上下裁剪区域都必须可达，
    // 且 fit(scale<1) 得到完整地图视图不被 clamp 偏移。
    // 顶边：ty=0 即地图顶部（无法再往上 pan）→ 顶端可见。
    expect(clampViewPan({ scale: 1, tx: 0, ty: 0 }, 1500, 1080, 1500, 1500)).toEqual({ scale: 1, tx: 0, ty: 0 })
    // 底边：ty 可下探到 stageH - mapH = 1080 - 1500 = -420（被裁底端可达，而非钉在 0）。
    expect(clampViewPan({ scale: 1, tx: 0, ty: -9999 }, 1500, 1080, 1500, 1500)).toEqual({ scale: 1, tx: 0, ty: -420 })
    expect(clampViewPan({ scale: 1, tx: 0, ty: -420 }, 1500, 1080, 1500, 1500).ty).toBe(-420)
    // Reset View full-map fit：scale = min(1500/1500, 1080/1500) = 0.72，横向居中(210)、纵向恰好贴满(0)。
    // clampViewPan 需保留该 fit 视图（不被错误重置/偏移）。
    expect(clampViewPan({ scale: 0.72, tx: 210, ty: 0 }, 1500, 1080, 1500, 1500)).toEqual({ scale: 0.72, tx: 210, ty: 0 })
  })
})
