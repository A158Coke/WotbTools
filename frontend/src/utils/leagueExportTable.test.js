import { describe, expect, it } from 'vitest'
import {
  leagueBattleExportTable,
  leagueAggregateExportTables,
  ratingCellText,
  isMissingValue,
} from './leagueExportTable.js'

const PLAYER_COLS = [
  { key: 'nickname', num: false },
  { key: 'clan', num: false },
  { key: 'tank_name', num: false },
  { key: 'damage_dealt', num: true },
  { key: 'damage_assisted', num: true },
  { key: 'kills', num: true },
  { key: 'contribution', num: true },
  { key: 'kast', num: true },
  { key: 'impact', num: true },
  { key: 'league_rating', num: true },
  { key: 'league_damage_score', num: true },
  { key: 'league_assist_score', num: true },
  { key: 'league_kill_score', num: true },
  { key: 'league_exchange_score', num: true },
  { key: 'league_blocked_score', num: true },
  { key: 'league_survival_score', num: true },
  { key: 'league_shooting_score', num: true },
  { key: 'victory_points_earned', num: true },
]

const LEAGUE_COLS = [
  { key: 'league_rating', max: 1000, fixed: true },
  { key: 'league_damage_score', max: 400 },
  { key: 'league_assist_score', max: 100 },
  { key: 'league_kill_score', max: 100 },
  { key: 'league_exchange_score', max: 150 },
  { key: 'league_blocked_score', max: 50 },
  { key: 'league_survival_score', max: 100 },
  { key: 'league_shooting_score', max: 100 },
]

const labelFor = key => 'LBL.' + key

describe('leagueBattleExportTable（完整列 universe = resp.playerColumns）', () => {
  const battle = {
    arenaId: '111',
    players: [
      { team: 1, cells: {
        nickname: 'Alpha', clan: 'AAA', tank_name: 'KV-2', damage_dealt: 5000,
        damage_assisted: 900, kills: 3, contribution: 22.4, kast: 100, impact: 151.2,
        league_rating: 927.4, league_damage_score: 342, league_assist_score: 60,
        league_kill_score: 70, league_exchange_score: 110, league_blocked_score: 40,
        league_survival_score: 80, league_shooting_score: 100, victory_points_earned: 5,
      } },
      { team: 2, cells: {
        nickname: 'Beta', clan: 'BBB', tank_name: 'IS-7', damage_dealt: 3000,
        damage_assisted: 400, kills: 1, contribution: null, kast: null, impact: 80.5,
        league_rating: null, league_damage_score: null, league_assist_score: null,
        league_kill_score: null, league_exchange_score: null, league_blocked_score: null,
        league_survival_score: null, league_shooting_score: null, victory_points_earned: 0,
      } },
    ],
  }

  it('导出全部 backend playerColumns 定义字段（不受任何 ColumnPicker 可见性影响）', () => {
    const html = leagueBattleExportTable(battle, PLAYER_COLS, LEAGUE_COLS, labelFor)
    for (const c of PLAYER_COLS) {
      expect(html).toContain('<th>LBL.' + c.key + '</th>')
    }
  })

  it('包含 nickname / damage / contribution / kast / impact / league_rating / 七维 / victory_points_earned', () => {
    const html = leagueBattleExportTable(battle, PLAYER_COLS, LEAGUE_COLS, labelFor)
    for (const k of ['nickname', 'damage_dealt', 'contribution', 'kast', 'impact',
      'league_rating', 'league_damage_score', 'league_shooting_score', 'victory_points_earned']) {
      expect(html).toContain('<th>LBL.' + k + '</th>')
    }
    expect(html).toContain('Alpha')
    expect(html).toContain('5000')
  })

  it('Rating 格式元数据来自 resp.league.columns：总 Rating 整数；七维 score/max/%', () => {
    const html = leagueBattleExportTable(battle, PLAYER_COLS, LEAGUE_COLS, labelFor)
    expect(html).toContain('927')
    expect(html).not.toContain('927.4')
    expect(html).toContain('342 / 400 · 85.5%')
    expect(html).toContain('100 / 100 · 100%') // league_shooting_score
  })

  it('Rating-ineligible：league_rating null → --；七维 null → --；不得伪造 0 / 0%', () => {
    const html = leagueBattleExportTable(battle, PLAYER_COLS, LEAGUE_COLS, labelFor)
    // Beta 行：Rating 与七维全缺失 → '--'，绝不出现 fake '0 / 1000' / '0 / 400 · 0%'
    expect(html).not.toContain('0 / 1000')
    expect(html).not.toContain('0 / 400 · 0%')
    expect(html).not.toMatch(/0 \/ \d+ · 0%/) // 无任何伪造的「0 / max · 0%」维度单元格
    // 真实 raw 0（victory_points_earned=0）保留 0（缺省数值列 round1）
    expect(html).toContain('<td>0</td>')
    // 真实 raw 0 的 Rating 维度允许显示 0（不误判为 missing）
    expect(ratingCellText(0, 'league_damage_score', { league_damage_score: 400 })).toBe('0 / 400 · 0%')
    expect(isMissingValue(0)).toBe(false)
    expect(isMissingValue(null)).toBe(true)
    expect(isMissingValue('')).toBe(true)
  })

  it('表现指标以百分比展示', () => {
    const html = leagueBattleExportTable(battle, PLAYER_COLS, LEAGUE_COLS, labelFor)
    expect(html).toContain('22.4%')
    expect(html).toContain('151.2%')
  })
})

describe('leagueAggregateExportTables（汇总完整 export DOM）', () => {
  const resp = {
    aggregate: [
      { team: 1, cells: { account_id: 1001, nickname: 'Alpha', clan: 'AAA', battles: 1, wins: 1, damage_avg: 5000, earned_avg: 5, contribution: 22.4, kast: 100, impact: 151.2 } },
    ],
    aggregateColumns: [
      { key: 'nickname', num: false }, { key: 'battles', num: true }, { key: 'wins', num: true },
      { key: 'damage_avg', num: true }, { key: 'earned_avg', num: true },
      { key: 'contribution', num: true }, { key: 'kast', num: true }, { key: 'impact', num: true },
    ],
    league: {
      columns: LEAGUE_COLS,
      playerSummaries: [
        { accountId: 1001, nickname: 'Alpha', clan: 'AAA', battles: 1, ratingMedian: 927.4,
          dimensionMedians: [342, 60, 70, 110, 40, 80, 100], mvpCount: 1, wins: 1,
          contribution: 22.4, kast: 100, impact: 151.2 },
      ],
      playerSummaryColumns: [
        { key: 'nickname', num: false }, { key: 'rated_battles', num: true },
        { key: 'league_rating', num: true }, { key: 'league_damage_score', num: true },
        { key: 'mvp_count', num: true }, { key: 'contribution', num: true },
        { key: 'kast', num: true }, { key: 'impact', num: true },
      ],
      teamSummaries: [
        { teamKey: 'AAA', autoName: 'AAA', battles: 1, ratingMedian: 900.6,
          dimensionMedians: [300, 50, 60, 90, 30, 70, 80], wins: 1 },
      ],
      teamSummaryColumns: [
        { key: 'team_name', num: false }, { key: 'battles', num: true },
        { key: 'league_rating', num: true }, { key: 'league_damage_score', num: true },
        { key: 'league_shooting_score', num: true }, { key: 'wins', num: true },
      ],
    },
  }

  it('UI 隐藏 KAST / Impact / 某七维时，export DOM 仍包含完整 columns', () => {
    // 模拟当前 UI 只显示 nickname+league_rating（其余全部隐藏）——export 不受影响
    const { player, team } = leagueAggregateExportTables(resp, labelFor, labelFor, {})
    expect(player).toContain('<th>LBL.kast</th>')
    expect(player).toContain('<th>LBL.impact</th>')
    expect(player).toContain('<th>LBL.league_damage_score</th>')
    expect(player).toContain('<th>LBL.rated_battles</th>')
    expect(player).toContain('<th>LBL.damage_avg</th>')
    expect(player).toContain('<th>LBL.earned_avg</th>')
    expect(team).toContain('<th>LBL.league_damage_score</th>')
    expect(team).toContain('<th>LBL.league_shooting_score</th>')
  })

  it('统一玩家表行 = Replay Aggregate ∪ League Summary（facts 与 Rating 并存）', () => {
    const { player } = leagueAggregateExportTables(resp, labelFor, labelFor, {})
    expect(player).toContain('Alpha')
    expect(player).toContain('5000')     // damage_avg facts
    expect(player).toContain('927')      // total Rating 整数
    expect(player).toContain('342 / 400 · 85.5%')
    expect(player).toContain('22.4%')
  })

  it('战队汇总表：总 Rating 整数、七维保留一位小数、team_name 支持 override', () => {
    const { team } = leagueAggregateExportTables(resp, labelFor, labelFor, { 'AAA': 'Override Name' })
    expect(team).toContain('Override Name')
    expect(team).toContain('901') // ratingMedian 900.6 → 整数 901
    expect(team).toContain('300')
    expect(team).toContain('1') // battles/wins
  })

  it('Rating-ineligible 汇总：league 字段 null → --，facts 不丢', () => {
    const ineligibleResp = {
      aggregate: [{ team: 1, cells: { account_id: 2001, nickname: 'Beta', battles: 1, damage_avg: 3000 } }],
      aggregateColumns: [{ key: 'nickname', num: false }, { key: 'battles', num: true }, { key: 'damage_avg', num: true }],
      league: {
        columns: LEAGUE_COLS,
        playerSummaries: [],
        playerSummaryColumns: [{ key: 'nickname', num: false }, { key: 'league_rating', num: true }],
        teamSummaries: [], teamSummaryColumns: [],
      },
    }
    const { player } = leagueAggregateExportTables(ineligibleResp, labelFor, labelFor, {})
    expect(player).toContain('Beta')
    expect(player).toContain('3000')
    expect(player).toContain('<td>--</td>') // league_rating 缺失
    expect(player).not.toContain('0 / 1000')
    expect(player).not.toContain('0%')
  })
})
