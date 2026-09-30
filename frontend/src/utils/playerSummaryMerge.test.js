import { describe, expect, it } from 'vitest'
import { mergeCwPlayerRows, mergeCwPlayerColumns, CW_DIM_KEYS } from './playerSummaryMerge.js'

describe('mergeCwPlayerRows', () => {
  // B6：身份是结构化 accountId，不再是 cells.account_id
  const aggRows = [
    { team: 1, accountId: 1001, cells: { nickname: 'A', battles: 3, damage_avg: 500, earned_avg: 80 } },
    { team: 2, accountId: 2001, cells: { nickname: 'B', battles: 2, damage_avg: 400, earned_avg: 40 } },
    { team: 1, accountId: 3001, cells: { nickname: 'C', battles: 4, damage_avg: 600, earned_avg: 120 } },
  ]
  const summaries = [
    { accountId: 1001, nickname: 'A', clan: 'AAA', ratedBattles: 3, rating: 779.3, observedMean: 850.4,
      dimensionMeans: [300.2, 60, 70, 110, 40, 80, 100], mvpCount: 2 },
    { accountId: 2001, nickname: 'B', clan: 'BBB', ratedBattles: 2, rating: 666.4, observedMean: 720.1,
      dimensionMeans: [250, 50, 60, 90, 30, 70, 80], mvpCount: 0 },
  ]

  it('joins league fields by structural accountId (not index/order)', () => {
    const rows = mergeCwPlayerRows(aggRows, summaries)
    expect(rows).toHaveLength(3)
    const a = rows.find(r => r.accountId === 1001)
    expect(a.league.accountId).toBe(1001)
    // V6：Rating、Observed Mean、七维均值均来自同一 pooled summary
    expect(a.league.dimensionMeans).toEqual([300.2, 60, 70, 110, 40, 80, 100])
    expect(a.cells.league_rating).toBe(779.3)
    expect(a.cells.league_observed_mean).toBe(850.4)
    expect(a.cells.league_damage_score).toBe(300.2)
    expect(a.cells.league_shooting_score).toBe(100)
    expect(a.cells.mvp_count).toBe(2)
    // 评分场次独立于解析场次（aggregate battles 不被 League 覆盖）
    expect(a.cells.battles).toBe(3)
    expect(a.cells.rated_battles).toBe(3)
    // aggregate facts 保留
    expect(a.cells.damage_avg).toBe(500)
    expect(a.cells.earned_avg).toBe(80)
    // identity 不写回 cells（B6：account_id 不再是列）
    expect(a.cells.account_id).toBeUndefined()
  })

  it('keeps aggregate-only players with null league fields (missing side)', () => {
    const rows = mergeCwPlayerRows(aggRows, summaries)
    const c = rows.find(r => r.accountId === 3001)
    expect(c).toBeTruthy()
    expect(c.league).toBeNull()
    expect(c.cells.league_rating).toBeNull()
    expect(CW_DIM_KEYS.every(k => c.cells[k] === null)).toBe(true)
    expect(c.cells.damage_avg).toBe(600) // 基础 facts 仍在
  })

  it('CW 单场：backend 生成基础 aggregate row → merge 后 facts 不缺失', () => {
    // CW 单场的 resp.aggregate 由 Replay Core 生成（battles=1 → avg=本场值），
    // Unified Summary 的 damage_avg/assisted_avg/kills_avg/earned_avg 是真实事实，不再显示 '--'
    const rows = mergeCwPlayerRows([
      { team: 1, accountId: 1001, cells: { nickname: 'A', clan: 'AAA', battles: 1, wins: 1, damage_avg: 500, assisted_avg: 100, kills_avg: 2, earned_avg: 80 } },
    ], summaries)
    const a = rows.find(r => r.accountId === 1001)
    expect(a.cells.league_rating).toBe(779.3)
    expect(a.cells.league_observed_mean).toBe(850.4)
    expect(a.cells.damage_avg).toBe(500)
    expect(a.cells.assisted_avg).toBe(100)
    expect(a.cells.kills_avg).toBe(2)
    expect(a.cells.earned_avg).toBe(80)
    // 评分场次保留；已退役的 Performance Metrics 不再存在
    expect(a.cells.rated_battles).toBe(3)
    expect(a.cells.contribution).toBeUndefined()
    expect(a.cells.kast).toBeUndefined()
    expect(a.cells.impact).toBeUndefined()
  })

  it('aggregate 为空时评分玩家仍安全保留（防御路径，非单场 CW 产品契约）', () => {
    const rows = mergeCwPlayerRows([], summaries)
    expect(rows).toHaveLength(2)
    const a = rows.find(r => r.accountId === 1001)
    expect(a.cells.league_rating).toBe(779.3)
    expect(a.cells.league_observed_mean).toBe(850.4)
    expect(a.cells.nickname).toBe('A')
    expect(a.cells.damage_avg == null).toBe(true) // aggregate 缺失 → UI '--'（仅防御路径）
    expect(a.cells.rated_battles).toBe(3)
    // identity 是结构化字段（兜底行同样如此）
    expect(a.cells.account_id).toBeUndefined()
    expect(a.accountId).toBe(1001)
  })

  it('聚合样本的 rated_battles 来自 league summary，不被 aggregate battles 覆盖', () => {
    const aggWithFacts = [
      { team: 1, accountId: 1001, cells: { nickname: 'A', battles: 12 } },
    ]
    // league summary 携带 rated-only 样本（不同样本，场次不同）
    const rows = mergeCwPlayerRows(aggWithFacts, [{
      accountId: 1001, nickname: 'A', clan: 'AAA', ratedBattles: 8, rating: 779.3, observedMean: 850,
      dimensionMeans: [300, 60, 70, 110, 40, 80, 100], mvpCount: 2,
    }])
    const a = rows[0]
    expect(a.cells.battles).toBe(12)          // 解析场次不被 rated-only 覆盖
    expect(a.cells.rated_battles).toBe(8)     // 评分场次独立
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
    // rated_battles 来自 league.playerSummaryColumns，必须进入统一表 universe
    { key: 'rated_battles', num: true },
    { key: 'league_rating', num: true },
    { key: 'league_damage_score', num: true },
    { key: 'mvp_count', num: true },
    { key: 'wins', num: true },
  ]
  // B6：backend 仍在 wire 上输出 tanks（结构化 vehicle usage），但前端列层不展示
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
    // rated_battles 保留（league 特有列，aggregate 无 → 不重复）
    expect(keys).toContain('rated_battles')
    expect(keys.filter(k => k === 'rated_battles')).toHaveLength(1)
    // aggregate 追加且去重（nickname/battles/wins 已在 league 中，不重复）
    expect(keys.indexOf('win_rate')).toBeGreaterThan(keys.indexOf('league_rating'))
    expect(keys.indexOf('earned_avg')).toBeGreaterThan(keys.indexOf('win_rate'))
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.filter(k => k === 'nickname')).toHaveLength(1)
  })

  it('B6：tanks 不进 CW 列 universe（wire 上仍在，列层不展示/无本地化）', () => {
    const keys = mergeCwPlayerColumns(leagueCols, aggCols).map(c => c.key)
    expect(keys).not.toContain('tanks')
  })

  it('tolerates null inputs', () => {
    expect(mergeCwPlayerColumns(null, null)).toEqual([])
  })
})
