// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { battleAverage, globalAverage } from './radarReference.js'

// 七维 key（与 playerSummaryMerge.CW_DIM_KEYS 一致）
const D = 'league_damage_score'
const A = 'league_assist_score'
const K = 'league_kill_score'
const E = 'league_exchange_score'
const B = 'league_blocked_score'
const S = 'league_survival_score'
const SH = 'league_shooting_score'

const MAX = {
  [D]: 400, [A]: 100, [K]: 100, [E]: 150, [B]: 50, [S]: 100, [SH]: 100,
}

/** 构造 battle player（cells 含 league_*_score）。rated=true → league_rating 有值（V4.1 finalRating），
 *  表明属于 valid rated population；rated=false → league_rating null（本场未评分 → 非成员）。 */
function bp(accountId, scores, { rated = true } = {}) {
  return {
    cells: {
      account_id: accountId,
      ...(rated ? { league_rating: 800 } : { league_rating: null }),
      ...scores,
    },
  }
}

/** 构造 summary row。rated=true → league 有 PlayerSummary（dimensionMeans 按 CW_DIM_KEYS 顺序），
 *  表明属于 rated unique player；rated=false → league null（aggregate-only / 未评分 → 非成员）。 */
function sr(accountId, means, { rated = true } = {}) {
  if (!rated) return { cells: { account_id: accountId }, league: null }
  const keys = [D, A, K, E, B, S, SH]
  return { cells: { account_id: accountId }, league: { dimensionMeans: keys.map(k => means[k] ?? null) } }
}

describe('battleAverage', () => {
  it('selected 玩家包含在内；不硬编码 14 人', () => {
    // 3 名 rated 玩家：damage 300/200/100 → meanRaw 200, normalized 0.5
    const players = [bp(1, { [D]: 300 }), bp(2, { [D]: 200 }), bp(3, { [D]: 100 })]
    const res = battleAverage(players, { dimKeys: [D], maxByKey: MAX })
    expect(res.available).toBe(true)
    expect(res.axes).toHaveLength(1)
    expect(res.axes[0].rawValue).toBeCloseTo(200, 6)
    expect(res.axes[0].normalized).toBeCloseTo(0.5, 6)
    // 2 人 count 也可算（不固定 14）
    const two = battleAverage([bp(1, { [D]: 400 }), bp(4, { [D]: 0 })], { dimKeys: [D], maxByKey: MAX })
    expect(two.axes[0].rawValue).toBeCloseTo(200, 6)
  })

  it('确定性：输入顺序/不同玩家顺序不改变平均；选中玩家不影响坐标（同一 scope）', () => {
    const base = [bp(1, { [D]: 300, [SH]: 60 }), bp(2, { [D]: 200, [SH]: 40 }), bp(3, { [D]: 100, [SH]: 20 })]
    const shuffled = [bp(3, { [D]: 100, [SH]: 20 }), bp(1, { [D]: 300, [SH]: 60 }), bp(2, { [D]: 200, [SH]: 40 })]
    const r1 = battleAverage(base, { dimKeys: [D, SH], maxByKey: MAX })
    const r2 = battleAverage(shuffled, { dimKeys: [D, SH], maxByKey: MAX })
    expect(r1.axes).toEqual(r2.axes)
  })

  it('cohort 任一 rated 成员缺任一所选维（全员缺）→ unavailable（不跨维换 cohort）', () => {
    // 两名 rated 成员都缺 shooting → cohort 不完整 → unavailable
    const players = [bp(1, { [D]: 300 }), bp(2, { [D]: 200 })]
    const res = battleAverage(players, { dimKeys: [D, SH], maxByKey: MAX })
    expect(res.available).toBe(false)
    expect(res.axes.every(a => !a.available)).toBe(true)
  })

  it('max 缺失/非有限 → 该维不能用，整体 unavailable', () => {
    const players = [bp(1, { [D]: 300 }), bp(2, { [D]: 200 })]
    const res = battleAverage(players, { dimKeys: [D], maxByKey: {} })
    expect(res.available).toBe(false)
  })

  it('partial incomplete cohort：某 rated 成员缺任一所选维 → 整图 unavailable（禁止静默缩小 cohort）', () => {
    // A/B 完整，C 也是 rated（league_rating 有值）但缺 Shooting → 不得用 A+B 凑平均
    const players = [
      bp(1, { [D]: 300, [SH]: 60 }),
      bp(2, { [D]: 200, [SH]: 40 }),
      bp(3, { [D]: 100 }), // rated 但 Shooting missing
    ]
    const res = battleAverage(players, { dimKeys: [D, SH], maxByKey: MAX })
    expect(res.available).toBe(false)
    expect(res.axes.every(a => !a.available)).toBe(true)
    // 绝不允许 A+B 平均（rawValue 必须 null，不得为 (300+200)/2=250）
    expect(res.axes[0].rawValue).toBeNull()
  })

  it('非成员（本场存在但未评分 league_rating=null）被排除，不使 Battle Average unavailable', () => {
    // 只有 A 是 rated 成员且完整；B 是本场出现但未评分 → 非成员，排除
    const players = [bp(1, { [D]: 300, [SH]: 60 }), bp(2, { [D]: 200, [SH]: 40 }, { rated: false })]
    const res = battleAverage(players, { dimKeys: [D, SH], maxByKey: MAX })
    expect(res.available).toBe(true)
    expect(res.axes[0].rawValue).toBeCloseTo(300, 6) // cohort 只有 A
  })
})

describe('globalAverage', () => {
  it('rotation 场景：12/12/3 场次等权（每人 weight=1，不按出场数加权）', () => {
    const rows = [
      sr(1, { [D]: 300, [A]: 60 }),
      sr(2, { [D]: 200, [A]: 40 }),
      sr(3, { [D]: 100, [A]: 20 }),
    ]
    const res = globalAverage(rows, { dimKeys: [D, A], maxByKey: MAX })
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
    const res = globalAverage(rows, { dimKeys: [D], maxByKey: MAX })
    expect(res.axes[0].rawValue).toBeCloseTo(250, 6) // (300+200)/2
  })

  it('确定性：不同输入顺序 → 相同结果', () => {
    const a = globalAverage([sr(1, { [D]: 300 }), sr(2, { [D]: 200 })], { dimKeys: [D], maxByKey: MAX })
    const b = globalAverage([sr(2, { [D]: 200 }), sr(1, { [D]: 300 })], { dimKeys: [D], maxByKey: MAX })
    expect(a.axes).toEqual(b.axes)
  })

  it('V5 隔离：相同 dimensionMeans、不同 ratingV5/median/battles → 几何不变', () => {
    const base = [sr(1, { [D]: 300 }), sr(2, { [D]: 200 })]
    const varied = [
      { ...sr(1, { [D]: 300 }), league: { ...sr(1, { [D]: 300 }).league, ratingV5: 1, ratingRawMedian: 2, battles: 99 } },
      { ...sr(2, { [D]: 200 }), league: { ...sr(2, { [D]: 200 }).league, ratingV5: 3, ratingRawMedian: 4, battles: 1 } },
    ]
    const r1 = globalAverage(base, { dimKeys: [D], maxByKey: MAX })
    const r2 = globalAverage(varied, { dimKeys: [D], maxByKey: MAX })
    expect(r1.axes).toEqual(r2.axes)
  })

  it('partial incomplete cohort：某 rated unique player 缺任一所选维 → Global Average unavailable（禁止静默排除）', () => {
    const rows = [
      sr(1, { [D]: 300, [SH]: 60 }),
      sr(2, { [D]: 200, [SH]: 40 }),
      sr(3, { [D]: 100 }), // rated 但 Shooting missing → 不得排除后用 A+B 凑平均
    ]
    const res = globalAverage(rows, { dimKeys: [D, SH], maxByKey: MAX })
    expect(res.available).toBe(false)
    expect(res.axes.every(a => !a.available)).toBe(true)
    expect(res.axes[0].rawValue).toBeNull()
  })

  it('非成员（aggregate-only / league==null）不属于 rated cohort，不使 Global Average unavailable', () => {
    // 只有 A 是 rated 且完整；B 是 aggregate-only（league null）→ 非成员，排除
    const rows = [
      sr(1, { [D]: 300, [SH]: 60 }),
      { cells: { account_id: 2 }, league: null },
    ]
    const res = globalAverage(rows, { dimKeys: [D, SH], maxByKey: MAX })
    expect(res.available).toBe(true)
    expect(res.axes[0].rawValue).toBeCloseTo(300, 6) // cohort 只有 A
  })

  it('rated-but-incomplete 与 unrated 区分：rated 成员缺维 → unavailable，即便存在 unrated 行', () => {
    // A 是 rated 但缺 Shooting；B 是 aggregate-only（league null）→ 因 A 是不完整成员 → unavailable
    const rows = [
      sr(1, { [D]: 100 }, { rated: true }), // rated 但缺 SH
      { cells: { account_id: 2 }, league: null }, // unrated 非成员
    ]
    const res = globalAverage(rows, { dimKeys: [D, SH], maxByKey: MAX })
    expect(res.available).toBe(false)
  })
})
