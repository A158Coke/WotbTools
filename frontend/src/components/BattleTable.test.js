// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import BattleTable from './BattleTable.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: key => key, te: () => false, locale: { value: 'zh' } })
}))

function makeBattle(players) {
  return {
    mapName: 'Lagoon',
    durationS: 300,
    winnerTeam: 1,
    players
  }
}

function makeCols() {
  return [
    { key: 'nickname', num: false },
    { key: 'damage_dealt', num: true },
    { key: 'contribution', num: true },
    { key: 'kast', num: true },
    { key: 'impact', num: true }
  ]
}

function mountTable(battle, cols) {
  return mount(BattleTable, {
    props: { battle, shownCols: cols },
    global: { mocks: { $t: key => key } }
  })
}

describe('BattleTable derived metrics', () => {
  it('renders contribution/kast/impact columns with % formatting (no performance tab needed)', () => {
    const wrapper = mountTable(makeBattle([
      { team: 1, cells: { nickname: 'A', damage_dealt: 3000, contribution: 22.4, kast: 100, impact: 151.2 } }
    ]), makeCols())

    const text = wrapper.text()
    expect(text).toContain('22.4%')
    expect(text).toContain('100%')
    expect(text).toContain('151.2%')
  })

  it('renders -- for null metrics (HP unknown, not fake 0)', () => {
    const wrapper = mountTable(makeBattle([
      { team: 1, cells: { nickname: 'A', damage_dealt: 3000, contribution: null, kast: null, impact: 120.5 } }
    ]), makeCols())

    const text = wrapper.text()
    expect(text).toContain('--')
    expect(text).toContain('120.5%')
  })

  it('sorts contribution numerically (not lexicographically)', async () => {
    const wrapper = mountTable(makeBattle([
      { team: 1, cells: { nickname: 'A', damage_dealt: 3000, contribution: 100, kast: 100, impact: 200 } },
      { team: 1, cells: { nickname: 'B', damage_dealt: 2000, contribution: 9, kast: 50, impact: 80 } },
      { team: 1, cells: { nickname: 'C', damage_dealt: 1000, contribution: 21, kast: 60, impact: 90 } }
    ]), makeCols())

    // click contribution header -> ascending numeric
    const th = wrapper.findAll('th').find(t => t.text().includes('contribution'))
    await th.trigger('click')
    let firstCols = wrapper.findAll('tbody tr').at(0).findAll('td')
    expect(firstCols.at(2).text()).toBe('9%')

    // click again -> descending
    await th.trigger('click')
    firstCols = wrapper.findAll('tbody tr').at(0).findAll('td')
    expect(firstCols.at(2).text()).toBe('100%')
  })
})

// ---- League Rating（plan §15/§10：概览、Rating 单元格、MVP 徽标、sticky 列、队名编辑） ----

function makeLeagueBattle() {
  return {
    arenaId: '111',
    mapName: 'Lagoon',
    durationS: 300,
    winnerTeam: 1,
    players: [
      { team: 1, cells: { nickname: 'A', account_id: 1001, league_rating: 927.4, league_damage_score: 342.1, damage_dealt: 3000 } },
      { team: 2, cells: { nickname: 'B', account_id: 2001, league_rating: 812.6, league_damage_score: 250.2, damage_dealt: 2500 } }
    ],
    league: {
      mvpNickname: 'A', mvpAccountId: 1001,
      team1BestNickname: 'A', team1BestAccountId: 1001,
      team2BestNickname: 'B', team2BestAccountId: 2001,
      team1: { team: 1, teamKey: 'clan:AAA', teamRating: 880.5, autoName: 'AAA', nameSource: 'CLAN_MAJORITY' },
      team2: { team: 2, teamKey: 'clan:BBB', teamRating: 700.2, autoName: 'BBB', nameSource: 'CLAN_MAJORITY' }
    }
  }
}

const LEAGUE_COLUMN_DEFS = [
  { key: 'league_rating', num: true, max: 1000, fixed: true, defaultVisible: true, group: 'rating' },
  { key: 'league_damage_score', num: true, max: 400, fixed: false, defaultVisible: false, group: 'rating' }
]

function leagueCols() {
  return [
    { key: 'nickname', num: false },
    { key: 'league_rating', num: true },
    { key: 'league_damage_score', num: true },
    { key: 'damage_dealt', num: true }
  ]
}

function mountLeague(battle, cols, teamNames) {
  return mount(BattleTable, {
    props: {
      battle,
      shownCols: cols || leagueCols(),
      leagueColumns: LEAGUE_COLUMN_DEFS,
      league: battle.league,
      teamNames: teamNames || {}
    },
    global: { mocks: { $t: key => key } }
  })
}

describe('BattleTable League Rating', () => {
  it('renders league overview with auto team names and ratings', () => {
    const wrapper = mountLeague(makeLeagueBattle())
    // 自动多数军团标签在队名输入框 value 中
    const inputs = wrapper.findAll('input.team-name-input')
    expect(inputs[0].element.value).toBe('AAA')
    expect(inputs[1].element.value).toBe('BBB')
    // 战队 Rating「881 · 88.1%」在概览文本中
    const text = wrapper.text()
    expect(text).toContain('881')
    expect(text).toContain('88.1%')
  })

  it('renders MVP and team best badges', () => {
    const wrapper = mountLeague(makeLeagueBattle())
    const text = wrapper.text()
    expect(text).toContain('MVP')          // A 全场 MVP
    expect(text).toContain('★')            // B 队2 队内最佳
  })

  it('formats rating cell as total and percentage', () => {
    const wrapper = mountLeague(makeLeagueBattle())
    const text = wrapper.text()
    expect(text).toContain('927 · 92.7%')
    expect(text).toContain('813 · 81.3%')
  })

  it('formats dimension cell as score / max · percentage', () => {
    const wrapper = mountLeague(makeLeagueBattle())
    const text = wrapper.text()
    expect(text).toContain('342 / 400 · 85.5%')
    expect(text).toContain('250 / 400 · 62.6%')
  })

  it('sticks nickname and league_rating columns', () => {
    const wrapper = mountLeague(makeLeagueBattle())
    const ths = wrapper.findAll('th')
    const nicknameTh = ths.find(t => t.text().includes('nickname'))
    const ratingTh = ths.find(t => t.text().includes('league_rating'))
    const damageTh = ths.find(t => t.text().includes('damage_dealt'))
    expect(nicknameTh.classes()).toContain('sticky-col')
    expect(ratingTh.classes()).toContain('sticky-col')
    expect(damageTh.classes()).not.toContain('sticky-col')
  })

  it('emits update-team-name on team name input', async () => {
    const battle = makeLeagueBattle()
    const wrapper = mountLeague(battle)
    const inputs = wrapper.findAll('input.team-name-input')
    expect(inputs.length).toBe(2)
    await inputs[0].setValue('MyTeam')
    const emitted = wrapper.emitted('update-team-name')
    expect(emitted).toBeTruthy()
    expect(emitted[0][0]).toEqual({ arenaId: '111', team: 1, name: 'MyTeam' })
  })

  it('displays override team names from props', () => {
    const battle = makeLeagueBattle()
    const wrapper = mountLeague(battle, leagueCols(), { '111:1': '我的战队' })
    const inputs = wrapper.findAll('input.team-name-input')
    expect(inputs[0].element.value).toBe('我的战队')
  })
})
