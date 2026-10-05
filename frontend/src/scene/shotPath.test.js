import { describe, it, expect } from 'vitest'
import {
  pathPointsOf, legSecsOf, legEndTimes, pointAt, legArcEnds, arcAtTime, pointAtArc,
} from './shotPath.js'

// 跳弹样本（20260821_1917 Intotherainy/KRV）：炮口 → 受击方装甲处（跳弹点）→ 服务器终点（天上）
const ricochet = {
  from: [109.65, 32.33, 135.39],
  via: [[131.92, 30.58, 72.5]],
  to: [385.4, 452.1, -394.3],
  leg_secs: [0.097, 0.977],
}
const straight = { from: [0, 10, 0], to: [0, 10, -680], leg_secs: [] }

describe('shotPath：折线弹道求值（跳弹/穿透续段）', () => {
  it('点表 = from → via… → to；直射弹退化为两点', () => {
    expect(pathPointsOf(ricochet)).toEqual([ricochet.from, ricochet.via[0], ricochet.to])
    expect(pathPointsOf(straight)).toEqual([straight.from, straight.to])
  })

  it('段时长：优先 leg_secs；缺省/形状不符时退化为单段 fallback', () => {
    expect(legSecsOf(ricochet, 0.5)).toEqual([0.097, 0.977])
    expect(legSecsOf(straight, 0.42)).toEqual([0.42])
    expect(legSecsOf({ from: [0, 0, 0], to: [1, 0, 0], via: [[0.5, 0, 0]], leg_secs: [0.1] }, 0.42)).toEqual([0.42])
    // 非法段值（0/负/NaN）同样退化，不产生零长段
    expect(legSecsOf({ from: [0, 0, 0], to: [1, 0, 0], via: [[0.5, 0, 0]], leg_secs: [0, 0.2] }, 0.42)).toEqual([0.42])
  })

  it('via 存在但 leg_secs 缺失/非法时整体回退 from→to，禁止 fallback 末端瞬移', () => {
    const shot = { from: [0, 0, 0], via: [[10, 10, 0], [20, 10, 0]], to: [30, 0, 0] }
    const pts = pathPointsOf(shot)
    expect(pts).toEqual([[0, 0, 0], [30, 0, 0]])
    const legs = legSecsOf(shot, 0.3)
    const ends = legEndTimes(legs, 1)
    expect(pointAt(pts, ends, 1.15, 1)).toEqual([15, 0, 0])
    expect(pointAt(pts, ends, 1.3, 1)).toEqual([30, 0, 0])

    const malformed = { ...shot, leg_secs: [0, 0.1, 0.1] }
    expect(pathPointsOf(malformed)).toEqual([[0, 0, 0], [30, 0, 0]])
    expect(legSecsOf(malformed, 0.3)).toEqual([0.3])
  })

  it('头部按时间落在当前段：段内匀速、拐点处位置连续', () => {
    const pts = pathPointsOf(ricochet)
    const ends = legEndTimes(ricochet.leg_secs, 71.219)
    expect(ends[0]).toBeCloseTo(71.316, 6)
    // 段 0 起点 = 炮口
    expect(pointAt(pts, ends, 71.219, 71.219)).toEqual(ricochet.from)
    // 段 0 中点 ≈ 炮口与跳弹点之间
    const mid = pointAt(pts, ends, 71.219 + 0.097 / 2, 71.219)
    expect(mid[0]).toBeCloseTo((109.65 + 131.92) / 2, 3)
    // 拐点：段 1 起点 == 段 0 终点（连续）
    const corner = pointAt(pts, ends, 71.316, 71.219)
    expect(corner[0]).toBeCloseTo(131.92, 6)
    expect(corner[2]).toBeCloseTo(72.5, 6)
    // 段 1 内前进（朝服务器终点方向）
    const later = pointAt(pts, ends, 71.316 + 0.5, 71.219)
    expect(later[1]).toBeGreaterThan(30.58)
    expect(later[2]).toBeLessThan(72.5)
    // 超出末端 → 服务器终点（**在服务器终点处中止**）
    expect(pointAt(pts, ends, 999, 71.219)).toEqual(ricochet.to)
  })

  it('弧长：累计段长、弧长位置反查、尾部回退', () => {
    const pts = pathPointsOf(ricochet)
    const arc = legArcEnds(pts)
    const l0 = Math.hypot(131.92 - 109.65, 30.58 - 32.33, 72.5 - 135.39)
    expect(arc[0]).toBeCloseTo(l0, 6)
    expect(arc[1]).toBeGreaterThan(arc[0])
    // 弧长 0 → from；超过总长 → to
    expect(pointAtArc(pts, arc, 0)).toEqual(ricochet.from)
    expect(pointAtArc(pts, arc, arc[1] + 10)).toEqual(ricochet.to)
    // 头部在拐点时刻的弧长 = 段 0 全长
    const ends = legEndTimes(ricochet.leg_secs, 0)
    const sCorner = arcAtTime(pts, ends, arc, ends[0], 0)
    expect(sCorner).toBeCloseTo(l0, 6)
    // 尾部 = 头部回退 9m：仍在段 0 上（跳弹点距炮口 > 9m）
    const tail = pointAtArc(pts, arc, sCorner - 9)
    const dFrom = Math.hypot(tail[0] - ricochet.from[0], tail[1] - ricochet.from[1], tail[2] - ricochet.from[2])
    expect(dFrom).toBeCloseTo(l0 - 9, 6)
  })

  it('端点安全：空/单点退化不抛错', () => {
    expect(pointAt([[1, 2, 3]], [], 5, 0)).toEqual([1, 2, 3])
    expect(pointAtArc([[1, 2, 3]], [], 5)).toEqual([1, 2, 3])
    expect(arcAtTime([[1, 2, 3]], [], [], 5, 0)).toBe(0)
  })
})
