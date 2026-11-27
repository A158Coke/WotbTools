// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { battleAverage, globalAverage } from './radarReference.js'

const D = 'league_damage_score'
const A = 'league_assist_score'
const K = 'league_kill_score'
const E = 'league_exchange_score'
const B = 'league_blocked_score'
const S = 'league_survival_score'
const SH = 'league_shooting_score'

function bp(accountId, scores, { rated = true } = {}) {
  return {
    accountId,
    cells: {
      ...(rated ? { league_rating: 800 } : { league_rating: null }),
      ...scores,
    },
  }
}

function sr(accountId, means, { rated = true } = {}) {
  if (!rated) return { accountId, cells: {}, league: null }
  const keys = [D, A, K, E, B, S, SH]
  return { accountId, cells: {}, league: { dimensionMeans: keys.map(k => means[k] ?? null) } }
}

describe('battleAverage', () => {
  it('selected 玩家包含在内；不硬编码 14 人', () => {
    const players = [bp(1, { [D]: 300 }), bp(2, { [D]: 200 }), bp(3, { [D]: 100 })]
    const res = battleAverage(players, { dimKeys: [D] })
    expect(res.available).toBe(true)
    expect(res.axes).toHaveLength(1)
    expect(res.axes[0].rawValue).toBeCloseTo(200, 6)
    const two = battleAverage([bp(1, { [D]: 400 }), bp(4, { [D]: 0 })], { dimKeys: [D] })
    expect(two.axes[0].rawValue).toBeCloseTo(200, 6)
  })

  it('确定性：输入顺序/不同玩家顺序不改变平均；选中玩家不影响坐标（同一 scope）', () => {
    const base = [bp(1, { [D]: 300, [SH]: 60 }), bp(2, { [D]: 200, [SH]: 40 }), bp(3, { [D]: 100, [SH]: 20 })]
    const shuffled = [bp(3, { [D]: 100, [SH]: 20 }), bp(1, { [D]: 300, [SH]: 60 }), bp(2, { [D]: 200, [SH]: 40 })]
    const r1 = battleAverage(base, { dimKeys: [D, SH] })
    const r2 = battleAverage(shuffled, { dimKeys: [D, SH] })
    expect(r1.axes).toEqual(r2.axes)
  })

  it('cohort 任一 rated 成员缺任一所选维（全员缺）→ unavailable（不跨维换 cohort）', () => {
    const players = [bp(1, { [D]: 300 }), bp(2, { [D]: 200 })]
    const res = battleAverage(players, { dimKeys: [D, SH] })
    expect(res.available).toBe(false)
    expect(res.axes.every(a => !a.available)).toBe(true)
  })

  it('max metadata 缺失不影响完整 raw cohort 的 reference average', () => {
    const players = [bp(1, { [D]: 300 }), bp(2, { [D]: 200 })]
    const res = battleAverage(players, { dimKeys: [D], maxByKey: {} })
    expect(res.available).toBe(true)
    expect(res.axes[0]).toEqual({ key: D, rawValue: 250, available: true })
  })

  it('partial incomplete cohort：某 rated 成员缺任一所选维 → 整图 unavailable（禁止静默缩小 cohort）', () => {
    const players = [
      bp(1, { [D]: 300, [SH]: 60 }),
      bp(2, { [D]: 200, [SH]: 40 }),
      bp(3, { [D]: 100 }), // rated 但 Shooting missing
    ]
    const res = battleAverage(players, { dimKeys: [D, SH] })
    expect(res.available).toBe(false)
    expect(res.axes.every(a => !a.available)).toBe(true)
    expect(res.axes[0].rawValue).toBeNull()
  })

  it('非成员（本场存在但未评分 league_rating=null）被排除，不使 Battle Average unavailable', () => {
    const players = [bp(1, { [D]: 300, [SH]: 60 }), bp(2, { [D]: 200, [SH]: 40 }, { rated: false })]
    const res = battleAverage(players, { dimKeys: [D, SH] })
    expect(res.available).toBe(true)
    expect(res.axes[0].rawValue).toBeCloseTo(300, 6)
  })
})

describe('globalAverage', () => {
  it('rotation 场景：12/12/3 场次等权（每人 weight=1，不按出场数加权）', () => {
    const rows = [
      sr(1, { [D]: 300, [A]: 60 }),
      sr(2, { [D]: 200, [A]: 40 }),
      sr(3, { [D]: 100, [A]: 20 }),
    ]
    const res = globalAverage(rows, { dimKeys: [D, A] })
    expect(res.available).toBe(true)
    expect(res.axes[0].rawValue).toBeCloseTo(200, 6)
    expect(res.axes[1].rawValue).toBeCloseTo(40, 6)
  })

  it('按 accountId 去重：重复行只计一次（weight=1）', () => {
    const rows = [
      sr(1, { [D]: 300 }),
      sr(1, { [D]: 300 }),
      sr(2, { [D]: 200 }),
    ]
    const res = globalAverage(rows, { dimKeys: [D] })
    expect(res.axes[0].rawValue).toBeCloseTo(250, 6)
  })

  it('确定性：不同输入顺序 → 相同结果', () => {
    const a = globalAverage([sr(1, { [D]: 300 }), sr(2, { [D]: 200 })], { dimKeys: [D] })
    const b = globalAverage([sr(2, { [D]: 200 }), sr(1, { [D]: 300 })], { dimKeys: [D] })
    expect(a.axes).toEqual(b.axes)
  })

  it('V6 隔离：相同 dimensionMeans、不同 rating/observedMean/ratedBattles → 几何不变', () => {
    const base = [sr(1, { [D]: 300 }), sr(2, { [D]: 200 })]
    const varied = [
      { ...sr(1, { [D]: 300 }), league: { ...sr(1, { [D]: 300 }).league, rating: 1, observedMean: 2, ratedBattles: 99 } },
      { ...sr(2, { [D]: 200 }), league: { ...sr(2, { [D]: 200 }).league, rating: 3, observedMean: 4, ratedBattles: 1 } },
    ]
    const r1 = globalAverage(base, { dimKeys: [D] })
    const r2 = globalAverage(varied, { dimKeys: [D] })
    expect(r1.axes).toEqual(r2.axes)
  })

  it('partial incomplete cohort：某 rated unique player 缺任一所选维 → Global Average unavailable（禁止静默排除）', () => {
    const rows = [
      sr(1, { [D]: 300, [SH]: 60 }),
      sr(2, { [D]: 200, [SH]: 40 }),
      sr(3, { [D]: 100 }), // rated 但 Shooting missing → 不得排除后用 A+B 凑平均
    ]
    const res = globalAverage(rows, { dimKeys: [D, SH] })
    expect(res.available).toBe(false)
    expect(res.axes.every(a => !a.available)).toBe(true)
    expect(res.axes[0].rawValue).toBeNull()
  })

  it('非成员（aggregate-only / league==null）不属于 rated cohort，不使 Global Average unavailable', () => {
    const rows = [
      sr(1, { [D]: 300, [SH]: 60 }),
      { accountId: 2, cells: {}, league: null },
    ]
    const res = globalAverage(rows, { dimKeys: [D, SH] })
    expect(res.available).toBe(true)
    expect(res.axes[0].rawValue).toBeCloseTo(300, 6)
  })

  it('rated-but-incomplete 与 unrated 区分：rated 成员缺维 → unavailable，即便存在 unrated 行', () => {
    const rows = [
      sr(1, { [D]: 100 }, { rated: true }),
      { accountId: 2, cells: {}, league: null }, // unrated 非成员
    ]
    const res = globalAverage(rows, { dimKeys: [D, SH] })
    expect(res.available).toBe(false)
  })
})
