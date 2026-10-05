// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { messages } from '../locales/messages.js'
import TournamentPointsTable from './TournamentPointsTable.vue'
import type { TournamentStandings } from '../api/tournament-points.js'
describe('tournament table projection', () => {
  it.each([2, 3])('renders every configured day plus round totals for %i days, preserves server ranking and zero vs missing', days => {
    const event = { id: 1, version: 1, year: 2026, region: 'EU', season: 'FIRE_CUP', roundCount: 4, daysPerRound: days, configLocked: true, dayLabels: ['Day 1', 'Day 2', 'Day 3'].slice(0, days) }
    const standings = { event, days: [], rows: [
      { rank: 1, clanTag: '-KSR-', totalPoints: 100, rounds: [{ roundNumber: 1, totalPoints: 100, days: [{ dayNumber: 1, points: 0 }, { dayNumber: 2, points: 100 }] }] },
      { rank: 1, clanTag: 'REQM', totalPoints: 100, rounds: [] },
      { rank: 3, clanTag: 'CHRD', totalPoints: 1, rounds: [] },
    ] } as TournamentStandings
    const wrapper = mount(TournamentPointsTable, { props: { standings }, global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] } })
    expect(wrapper.findAll('thead th')).toHaveLength(3 + 4 * (days + 1))
    expect(wrapper.findAll('tbody tr').map(row => row.find('td').text())).toEqual(['1', '1', '3'])
    expect(wrapper.findAll('tbody tr')[0].text()).toContain('-KSR-')
    expect(wrapper.findAll('tbody tr')[0].findAll('td').map(cell => cell.text())).toContain('0')
    expect(wrapper.findAll('tbody tr')[0].findAll('td').map(cell => cell.text())).toContain('—')
  })
})
