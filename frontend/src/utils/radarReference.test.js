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

/** 构造 battle player（cells 含 league_*_score）。 */
function bp(accountId, scores) {
  return { cells: { account_id: accountId, ...scores } }
}

/** 构造 summary row（league.dimensionMeans 按 CW_DIM_KEYS 顺序）。 */
function sr(accountId, means) {
  const keys = [D, A, K, E, B, S, SH]
  return { cells: { account_id: accountId }, league: { dimensionMeans: keys.map(k => means[k] ?? null) } }
}

describe('battleAverage（计划 §13/§57）', () => {
  it('selected 玩家包含在内；不硬编码 14 人', () => {
    // 3 人：damage 300/200/100 → meanRaw 200, normalized 0.5
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

  it('用同一 cohort 聚合，不跨维换样本；群体缺所选维（全员缺）→ unavailable', () => {
    // 只有 damage + shooting 完整的人进 cohort；全员缺 shooting → cohort 空 → unavailable
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
})

describe('globalAverage（计划 §14/§58）', () => {
  it('rotation 场景：12/12/3 场次等权（每人 weight=1，不按出场数加权）', () => {
    // A/B 12 场、C 3 场，dimensionMeans 不同 → 均值 = (A+B+C)/3
    const rows = [
      sr(1, { [D]: 300, [A]: 60 }),
      sr(2, { [D]: 200, [A]: 40 }),
      sr(3, { [D]: 100, [A]: 20 }),
    ]
    const res = globalAverage(rows, { dimKeys: [D, A], maxByKey: MAX })
    expect(res.available).toBe(true)
    expect(res.axes[0].rawValue).toBeCloseTo(200, 6) // (300+200+100)/3
    expect(res.axes[1].rawValue).toBeCloseTo(40, 6)  // (60+40+20)/3
  })

  it('按 accountId 去重：重复行只计一次（weight=1）', () => {
    const rows = [
      sr(1, { [D]: 300 }),
      sr(1, { [D]: 300 }), // 重复 accountId
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

  it('aggregate-only（无 dimensionMeans）玩家被排除；全员缺 → unavailable', () => {
    const rows = [
      { cells: { account_id: 1 }, league: null }, // aggregate-only
      { cells: { account_id: 2 }, league: { dimensionMeans: [null, null, null, null, null, null, null] } },
    ]
    const res = globalAverage(rows, { dimKeys: [D], maxByKey: MAX })
    expect(res.available).toBe(false)
  })
})
