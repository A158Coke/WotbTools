// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import LeagueSummaryTable from './LeagueSummaryTable.vue'

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
    ratingMedian: 850.4,
    dimensionMedians: [300.2, 60, 70, 110, 40, 80, 45, 30],
    wins: 1,
    arenaTeams: ['111:1', '222:1'],
    ...overrides
  }
}

describe('LeagueSummaryTable', () => {
  it('renders rows with team name, battles and rating median', () => {
    const wrapper = mount(LeagueSummaryTable, {
      props: { title: 'T', type: 'team', rows: [teamRow()], columns: SUMMARY_COLS, teamNames: {} },
      global: { mocks: { $t: key => key } }
    })
    const text = wrapper.text()
    expect(text).toContain('850')
    expect(text).toContain('85%')
    expect(text).toContain('2')
    const input = wrapper.find('input.team-name-input')
    expect(input.element.value).toBe('AAA')
  })

  it('shows override team name from teamNames', () => {
    const wrapper = mount(LeagueSummaryTable, {
      props: {
        title: 'T', type: 'team', rows: [teamRow()], columns: SUMMARY_COLS,
        teamNames: { '111:1': '我的战队' }
      },
      global: { mocks: { $t: key => key } }
    })
    expect(wrapper.find('input.team-name-input').element.value).toBe('我的战队')
  })

  it('emits update-team-name for all arenaTeams on edit', async () => {
    const wrapper = mount(LeagueSummaryTable, {
      props: { title: 'T', type: 'team', rows: [teamRow()], columns: SUMMARY_COLS, teamNames: {} },
      global: { mocks: { $t: key => key } }
    })
    await wrapper.find('input.team-name-input').setValue('新队名')
    const emitted = wrapper.emitted('update-team-name')
    expect(emitted).toBeTruthy()
    expect(emitted.length).toBe(2)
    expect(emitted[0][0]).toEqual({ arenaId: '111', team: 1, name: '新队名' })
    expect(emitted[1][0]).toEqual({ arenaId: '222', team: 1, name: '新队名' })
  })

  it('renders pending label when unnamed', () => {
    const wrapper = mount(LeagueSummaryTable, {
      props: {
        title: 'T', type: 'team',
        rows: [teamRow({ autoName: null, nameSource: 'UNNAMED' })],
        columns: SUMMARY_COLS, teamNames: {}
      },
      global: { mocks: { $t: key => key } }
    })
    expect(wrapper.find('input.team-name-input').element.value).toBe('league.team_name_pending')
  })
})
