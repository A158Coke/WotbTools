// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import LeagueSummaryTable from './LeagueSummaryTable.vue'
import { CW_DIM_KEYS } from '../utils/playerSummaryMerge.js'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: key => key, locale: { value: 'zh' } })
}))
import { vi } from 'vitest'

const SUMMARY_COLS = [
  { key: 'team_name', num: false },
  { key: 'battles', num: true },
  { key: 'league_rating', num: true },
  { key: 'league_damage_score', num: true },
  { key: 'wins', num: true }
]

function teamRow(overrides = {}) {
  return {
    teamKey: 'clan:AAA',
    autoName: 'AAA',
    nameSource: 'CLAN_MAJORITY',
    battles: 2,
    rating: 850.4,
    observedMean: 850.4,
    dimensionMeans: [300.2, 60, 70, 110, 40, 80, 45],
    wins: 1,
    arenaTeams: ['111:1', '222:1'],
    ...overrides
  }
}

describe('LeagueSummaryTable', () => {
  it('七维 invariant：战队汇总 dimensionMeans 恰好 7 个值（无残留第八维）', () => {
    expect(teamRow().dimensionMeans).toHaveLength(7)
    expect(CW_DIM_KEYS).toHaveLength(7)
  })

  it('renders rows with team name, battles and rating', () => {
    const wrapper = mount(LeagueSummaryTable, {
      props: { title: 'T', rows: [teamRow()], columns: SUMMARY_COLS, teamNames: {} },
      global: { mocks: { $t: key => key } }
    })
    const text = wrapper.text()
    expect(text).toContain('850.4')
    expect(text).not.toContain('850 ·')
    expect(text).toContain('2')
    const input = wrapper.find('input.team-name-input')
    expect(input.element.value).toBe('AAA')
  })

  it('shows teamKey override name from teamNames', () => {
    const wrapper = mount(LeagueSummaryTable, {
      props: {
        title: 'T', rows: [teamRow()], columns: SUMMARY_COLS,
        teamNames: { 'clan:AAA': '我的战队' }
      },
      global: { mocks: { $t: key => key } }
    })
    expect(wrapper.find('input.team-name-input').element.value).toBe('我的战队')
  })

  it('ignores battle-level arenaId:team overrides for summary display', () => {
    const wrapper = mount(LeagueSummaryTable, {
      props: {
        title: 'T', rows: [teamRow()], columns: SUMMARY_COLS,
        teamNames: { '111:1': '单场名' }
      },
      global: { mocks: { $t: key => key } }
    })
    expect(wrapper.find('input.team-name-input').element.value).toBe('AAA')
  })

  it('emits single update-summary-team-name with teamKey (no arenaTeams loop)', async () => {
    const wrapper = mount(LeagueSummaryTable, {
      props: { title: 'T', rows: [teamRow()], columns: SUMMARY_COLS, teamNames: {} },
      global: { mocks: { $t: key => key } }
    })
    await wrapper.find('input.team-name-input').setValue('新队名')
    const emitted = wrapper.emitted('update-summary-team-name')
    expect(emitted).toBeTruthy()
    expect(emitted.length).toBe(1)
    expect(emitted[0][0]).toEqual({ teamKey: 'clan:AAA', name: '新队名' })
    expect(wrapper.emitted('update-team-name')).toBeUndefined()
  })

  it('renders pending label when unnamed', () => {
    const wrapper = mount(LeagueSummaryTable, {
      props: {
        title: 'T',
        rows: [teamRow({ autoName: null, nameSource: 'UNNAMED' })],
        columns: SUMMARY_COLS, teamNames: {}
      },
      global: { mocks: { $t: key => key } }
    })
    expect(wrapper.find('input.team-name-input').element.value).toBe('league.team_name_pending')
  })

  it('shows explicit neutral empty state instead of bare -- when no rows', () => {
    const wrapper = mount(LeagueSummaryTable, {
      props: { title: 'T', rows: [], columns: SUMMARY_COLS, teamNames: {} },
      global: { mocks: { $t: key => key } }
    })
    expect(wrapper.find('td.league-summary-empty').text()).toBe('league.summary.no_rateable')
    expect(wrapper.find('td.league-summary-empty').text()).not.toBe('--')
  })

  it('sorts rating asc by raw rating (valueGetter 映射修复)', async () => {
    const rows = [
      teamRow({ teamKey: 'clan:AAA', rating: 850.4, autoName: 'AAA' }),
      teamRow({ teamKey: 'clan:CCC', rating: null, autoName: 'CCC' }),
      teamRow({ teamKey: 'clan:BBB', rating: 700.2, autoName: 'BBB' }),
    ]
    const wrapper = mount(LeagueSummaryTable, {
      props: { title: 'T', rows, columns: SUMMARY_COLS, teamNames: {} },
      global: { mocks: { $t: key => key } }
    })
    const th = wrapper.findAll('th').find(t => t.text().includes('league_rating'))
    await th.trigger('click')
    const rowsOut = wrapper.findAll('tbody tr')
    expect(rowsOut.at(0).text()).toContain('700.2')
    expect(rowsOut.at(1).text()).toContain('850.4')
    expect(rowsOut.at(2).text()).toContain('--')
  })

  it('team summary sorting uses full-precision raw Rating when display values tie', async () => {
    const rows = [
      teamRow({ teamKey: 'clan:HIGH', rating: 700.24, autoName: 'HIGH' }),
      teamRow({ teamKey: 'clan:LOW', rating: 700.21, autoName: 'LOW' })
    ]
    const wrapper = mount(LeagueSummaryTable, {
      props: { title: 'T', rows, columns: SUMMARY_COLS, teamNames: {} },
      global: { mocks: { $t: key => key } }
    })
    const th = wrapper.findAll('th').find(t => t.text().includes('league_rating'))
    await th.trigger('click')
    const rowsOut = wrapper.findAll('tbody tr')
    expect(rowsOut.at(0).find('input').element.value).toBe('LOW')
    expect(rowsOut.at(1).find('input').element.value).toBe('HIGH')
    expect(rowsOut.at(0).text()).toContain('700.2')
    expect(rowsOut.at(1).text()).toContain('700.2')
  })

  it('sorts team name by final display name (override-aware)', async () => {
    const rows = [
      teamRow({ teamKey: 'clan:A', autoName: 'TeamA' }),
      teamRow({ teamKey: 'clan:B', autoName: 'TeamB' }),
    ]
    const wrapper = mount(LeagueSummaryTable, {
      props: {
        title: 'T', rows, columns: SUMMARY_COLS,
        teamNames: { 'clan:B': 'Alpha' }
      },
      global: { mocks: { $t: key => key } }
    })
    const th = wrapper.findAll('th').find(t => t.text().includes('team_name'))
    await th.trigger('click')
    const rowsOut = wrapper.findAll('tbody tr')
    expect(rowsOut.at(0).find('input').element.value).toBe('Alpha')
    expect(rowsOut.at(1).find('input').element.value).toBe('TeamA')
  })
})
