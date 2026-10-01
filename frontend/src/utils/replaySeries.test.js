import { describe, expect, it } from 'vitest'
import { buildSeriesOverview } from './replaySeries.js'

function battle(i, winnerTeam, extra = {}) {
  return { sourceId: `r${i}`, arenaId: `a${i}`, mapName: `map_${i}`, durationS: 300 + i, startTime: 1_700_000_000 + i, winnerTeam, players: [], ...extra }
}

function cwResp(battles, teamSummaries) {
  return { leagueMode: true, battles, league: { teamSummaries } }
}

describe('buildSeriesOverview', () => {
  it('两支稳定战队：按逐场胜方计系列赛比分，胜多者在前', () => {
    const resp = cwResp(
      [battle(0, 1), battle(1, 2), battle(2, 1), battle(3, 1)],
      [
        { teamKey: 'clan:TOP', autoName: 'TOP', arenaTeams: ['a0:2', 'a1:2', 'a2:2', 'a3:2'] },
        { teamKey: 'clan:CHRD', autoName: 'CHRD', arenaTeams: ['a0:1', 'a1:1', 'a2:1', 'a3:1'] },
      ],
    )
    const series = buildSeriesOverview(resp)
    expect(series.teams).toEqual([
      { key: 'clan:CHRD', name: 'CHRD', wins: 3 },
      { key: 'clan:TOP', name: 'TOP', wins: 1 },
    ])
    expect(series.unresolved).toBe(0)
    expect(series.battles.map(b => b.winnerName)).toEqual(['CHRD', 'TOP', 'CHRD', 'CHRD'])
  })

  it('批次覆盖名优先于自动名', () => {
    const resp = cwResp([battle(0, 1)], [
      { teamKey: 'clan:A', autoName: 'A', arenaTeams: ['a0:1'] },
      { teamKey: 'clan:B', autoName: 'B', arenaTeams: ['a0:2'] },
    ])
    const series = buildSeriesOverview(resp, { 'clan:A': '甲队' })
    expect(series.teams[0].name).toBe('甲队')
    expect(series.battles[0].winnerName).toBe('甲队')
  })

  it('不可评分场次（不在 arenaTeams 中）不计入比分，单独计为 unresolved', () => {
    const resp = cwResp([battle(0, 1), battle(1, 1)], [
      { teamKey: 'clan:A', autoName: 'A', arenaTeams: ['a0:1'] },
      { teamKey: 'clan:B', autoName: 'B', arenaTeams: ['a0:2'] },
    ])
    const series = buildSeriesOverview(resp)
    expect(series.teams.map(t => t.wins)).toEqual([1, 0])
    expect(series.unresolved).toBe(1)
    expect(series.battles[1]).toMatchObject({ winnerTeam: 1, winnerKey: null, winnerName: null })
  })

  it('存在 arenaId:team 兜底键或不是两支队伍时不推算系列赛', () => {
    const fallback = cwResp([battle(0, 1)], [
      { teamKey: 'clan:A', autoName: 'A', arenaTeams: ['a0:1'] },
      { teamKey: 'a0:2', autoName: null, arenaTeams: ['a0:2'] },
    ])
    expect(buildSeriesOverview(fallback).teams).toBeNull()

    const three = cwResp([battle(0, 1)], [
      { teamKey: 'clan:A', arenaTeams: [] }, { teamKey: 'clan:B', arenaTeams: [] }, { teamKey: 'clan:C', arenaTeams: [] },
    ])
    expect(buildSeriesOverview(three).teams).toBeNull()
  })

  it('普通批次：只有逐场结果，没有系列赛；未知胜方为 null', () => {
    const series = buildSeriesOverview({ leagueMode: false, battles: [battle(0, 2), battle(1, null), battle(2, 0)] })
    expect(series.teams).toBeNull()
    expect(series.unresolved).toBe(0)
    expect(series.battles.map(b => b.winnerTeam)).toEqual([2, null, null])
    expect(series.battles[0]).toMatchObject({ sourceId: 'r0', index: 0, mapName: 'map_0', durationS: 300 })
  })

  it('空结果', () => {
    expect(buildSeriesOverview(null)).toEqual({ teams: null, unresolved: 0, battles: [] })
  })
})

describe('battlePickerOptions', () => {
  it('每项：第 N 场 · 地图；meta = 胜方 · 时间；可按文件名检索', async () => {
    const { battlePickerOptions } = await import('./replaySeries.js')
    const series = buildSeriesOverview({ leagueMode: false, battles: [battle(0, 1, { sourceName: 'a.wotbreplay' }), battle(1, null, { startTime: null })] })
    const t = (key, params) => `${key}${params ? JSON.stringify(params) : ''}`
    const options = battlePickerOptions(series, { t, locale: 'zh', mapLabel: m => `M(${m})`, formatTime: () => '10-01 20:31' })
    expect(options[0]).toEqual({
      value: 'r0',
      label: 'workspace.battle_n{"n":1} · M(map_0)',
      meta: 'workspace.series_team_winner{"team":1} · 10-01 20:31',
      search: 'a.wotbreplay map_0',
    })
    expect(options[1].meta).toBe('workspace.series_unknown_winner')
  })
})
