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
      dimensionMedians: [300.2, 60, 70, 110, 40, 80, 100], mvpCount: 2 },
    { accountId: 2001, nickname: 'B', clan: 'BBB', battles: 2, ratingMedian: 720.1,
      dimensionMedians: [250, 50, 60, 90, 30, 70, 80], mvpCount: 0 },
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