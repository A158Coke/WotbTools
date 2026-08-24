import { describe, expect, it } from 'vitest'
import { mergeCwPlayerRows, mergeCwPlayerColumns, CW_DIM_KEYS } from './playerSummaryMerge.js'

describe('mergeCwPlayerRows', () => {
  const aggRows = [
    { team: 1, cells: { account_id: 1001, nickname: 'A', battles: 3, damage_avg: 500, earned_avg: 80 } },
    { team: 2, cells: { account_id: 2001, nickname: 'B', battles: 2, damage_avg: 400, earned_avg: 40 } },
    { team: 1, cells: { account_id: 3001, nickname: 'C', battles: 4, damage_avg: 600, earned_avg: 120 } },
  ]
  const summaries = [
    { accountId: 1001, nickname: 'A', clan: 'AAA', battles: 3, ratingMedian: 850.4,
      dimensionMedians: [300.2, 60, 70, 110, 40, 80, 100], mvpCount: 2,
      contribution: 22.4, kast: 100, impact: 151.2 },
    { accountId: 2001, nickname: 'B', clan: 'BBB', battles: 2, ratingMedian: 720.1,
      dimensionMedians: [250, 50, 60, 90, 30, 70, 80], mvpCount: 0,
      contribution: 18.1, kast: 80, impact: 120.5 },
  ]

  it('joins league fields by accountId (not index/order)', () => {
    const rows = mergeCwPlayerRows(aggRows, summaries)
    expect(rows).toHaveLength(3)
    const a = rows.find(r => r.cells.account_id === 1001)
    expect(a.league.accountId).toBe(1001)
    expect(a.cells.league_rating).toBe(850.4)
    expect(a.cells.league_damage_score).toBe(300.2)
    expect(a.cells.league_shooting_score).toBe(100)
    expect(a.cells.mvp_count).toBe(2)
    // BLOCKER 5：评分场次独立于解析场次（aggregate battles 不被 League 覆盖）
    expect(a.cells.battles).toBe(3)
    expect(a.cells.rated_battles).toBe(3)
    // aggregate facts 保留
    expect(a.cells.damage_avg).toBe(500)
    expect(a.cells.earned_avg).toBe(80)
  })

  it('keeps aggregate-only players with null league fields (missing side, plan §21)', () => {
    const rows = mergeCwPlayerRows(aggRows, summaries)
    const c = rows.find(r => r.cells.account_id === 3001)
    expect(c).toBeTruthy()
    expect(c.league).toBeNull()
    expect(c.cells.league_rating).toBeNull()
    expect(CW_DIM_KEYS.every(k => c.cells[k] === null)).toBe(true)
    expect(c.cells.damage_avg).toBe(600) // 基础 facts 仍在
  })

  it('includes league-only players when aggregate misses them (single battle CW)', () => {
    const rows = mergeCwPlayerRows([], summaries)
    expect(rows).toHaveLength(2)
    const a = rows.find(r => r.cells.account_id === 1001)
    expect(a.cells.league_rating).toBe(850.4)
    expect(a.cells.nickname).toBe('A')
    expect(a.cells.damage_avg == null).toBe(true) // aggregate 字段缺失 → UI '--'
    // BLOCKER 1/5：League-only 行带跨场 Performance Metrics + 评分场次
    expect(a.cells.rated_battles).toBe(3)
    expect(a.cells.contribution).toBe(22.4)
    expect(a.cells.kast).toBe(100)
    expect(a.cells.impact).toBe(151.2)
  })

  it('aggregate 行的 Performance Metrics 不被 League-only 样本覆盖（BLOCKER 1：aggregate 全量样本优先）', () => {
    const aggWithPerf = [
      { team: 1, cells: { account_id: 1001, nickname: 'A', battles: 12, contribution: 20.0, kast: 90, impact: 140.0 } },
    ]
    // league summary 携带 rated-only 样本（不同样本，数值不同）
    const rows = mergeCwPlayerRows(aggWithPerf, [{
      accountId: 1001, nickname: 'A', clan: 'AAA', battles: 8, ratingMedian: 850,
      dimensionMedians: [300, 60, 70, 110, 40, 80, 100], mvpCount: 2,
      contribution: 30.0, kast: 99, impact: 200.0,
    }])
    const a = rows[0]
    expect(a.cells.battles).toBe(12)          // 解析场次不被 rated-only 覆盖
    expect(a.cells.rated_battles).toBe(8)     // 评分场次独立
    expect(a.cells.contribution).toBe(20.0)   // aggregate 样本优先
    expect(a.cells.kast).toBe(90)
    expect(a.cells.impact).toBe(140.0)
  })

  it('tolerates null/empty inputs', () => {
    expect(mergeCwPlayerRows(null, null)).toEqual([])
    expect(mergeCwPlayerRows(undefined, [])).toEqual([])
  })
})

describe('mergeCwPlayerColumns', () => {
  const leagueCols = [
    { key: 'nickname', num: false },
    { key: 'battles', num: true },
    { key: 'league_rating', num: true },
    { key: 'league_damage_score', num: true },
    { key: 'mvp_count', num: true },
    { key: 'wins', num: true },
  ]
  const aggCols = [
    { key: 'nickname', num: false },
    { key: 'battles', num: true },
    { key: 'wins', num: true },
    { key: 'win_rate', num: true },
    { key: 'damage_avg', num: true },
    { key: 'earned_avg', num: true },
    { key: 'tanks', num: false },
  ]

  it('prepends league-only cols then appends aggregate cols without duplicates', () => {
    const cols = mergeCwPlayerColumns(leagueCols, aggCols)
    const keys = cols.map(c => c.key)
    // league 特有前置（保持 league summary 顺序）
    expect(keys.indexOf('league_rating')).toBeGreaterThanOrEqual(0)
    expect(keys.indexOf('league_damage_score')).toBeGreaterThan(keys.indexOf('league_rating'))
    expect(keys.indexOf('mvp_count')).toBeGreaterThan(keys.indexOf('league_damage_score'))
    // aggregate 追加且去重（nickname/battles/wins 已在 league 中，不重复）
    expect(keys.indexOf('win_rate')).toBeGreaterThan(keys.indexOf('league_rating'))
    expect(keys.indexOf('earned_avg')).toBeGreaterThan(keys.indexOf('win_rate'))
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.filter(k => k === 'nickname')).toHaveLength(1)
  })

  it('tolerates null inputs', () => {
    expect(mergeCwPlayerColumns(null, null)).toEqual([])
  })
})