// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { messages } from '../locales/messages.js'
import TournamentPointsTable from './TournamentPointsTable.vue'
import type { TournamentStandings } from '../api/tournament-points.js'
import { projectTournamentPoints } from '../utils/tournamentPointsExport.js'

const tableMessages: Record<string, { tournament: Record<string, unknown> }> = {
  zh: { tournament: messages.zh.tournament },
  en: { tournament: messages.en.tournament },
  ru: { tournament: messages.ru.tournament },
}
describe('tournament table projection', () => {
  it.each([2, 3])('renders every configured day plus round totals for %i days, preserves server ranking and zero vs missing', days => {
    const event = { id: 1, version: 1, year: 2026, region: 'EU', season: 'FIRE_CUP', roundCount: 4, daysPerRound: days, configLocked: true, dayLabels: ['Day 1', 'Day 2', 'Day 3'].slice(0, days) }
    const standings = { event, days: [], rows: [
      { rank: 1, clanTag: '-KSR-', totalPoints: 100, rounds: [{ roundNumber: 1, totalPoints: 100, days: [{ dayNumber: 1, points: 0 }, { dayNumber: 2, points: 100 }] }] },
      { rank: 1, clanTag: 'REQM', totalPoints: 100, rounds: [] },
      { rank: 3, clanTag: 'CHRD', totalPoints: 1, rounds: [] },
    ] } as TournamentStandings
    const wrapper = mount(TournamentPointsTable, { props: { standings }, global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: tableMessages })] } })
    expect(wrapper.findAll('thead th')).toHaveLength(3 + 4 * (days + 1))
    expect(wrapper.findAll('tbody tr').map(row => row.find('td').text())).toEqual(['1', '1', '3'])
    expect(wrapper.findAll('tbody tr')[0].text()).toContain('-KSR-')
    expect(wrapper.findAll('tbody tr')[0].findAll('td').map(cell => cell.text())).toContain('0')
    expect(wrapper.findAll('tbody tr')[0].findAll('td').map(cell => cell.text())).toContain('—')
  })
})

describe('public tournament presentation', () => {
  function fixture(roundCount = 5, daysPerRound = 2): TournamentStandings {
    return {
      event: { id: 1, version: 1, year: 2026, region: 'CN', season: 'FIRE_CUP', roundCount, daysPerRound,
        configLocked: true, dayLabels: ['Day 1', 'Day 2', 'Day 3'].slice(0, daysPerRound) },
      days: Array.from({ length: roundCount * daysPerRound }, (_, index) => ({
        roundNumber: Math.floor(index / daysPerRound) + 1, dayNumber: index % daysPerRound + 1,
        label: `Day ${index % daysPerRound + 1}`, published: index < 2,
      })),
      rows: [
        { rank: 1, clanTag: '-KSR-', totalPoints: 100, rounds: [{ roundNumber: 1, totalPoints: 100, days: [{ dayNumber: 1, points: 0 }, { dayNumber: 2, points: 100 }] }] },
        { rank: 1, clanTag: 'REQM', totalPoints: 100, rounds: [] },
        { rank: 3, clanTag: '很长的军团简称LongClanTag-CHRD-', totalPoints: 0, rounds: [] },
      ],
    }
  }
  function mountTable(standings: TournamentStandings, publicView = true, locale = 'en') {
    const i18n = createI18n({ legacy: false, locale, messages: tableMessages })
    const wrapper = mount(TournamentPointsTable, { props: { standings, publicView }, global: { plugins: [i18n] } })
    return { wrapper, i18n }
  }
  it.each([[4, 2], [4, 3], [5, 2], [5, 3]])('groups %i rounds with %i days without changing a single body cell', (roundCount, daysPerRound) => {
    const standings = fixture(roundCount, daysPerRound)
    const publicTable = mountTable(standings)
    const adminTable = mountTable(standings, false)
    const { wrapper, i18n } = publicTable
    const projection = projectTournamentPoints(standings, 'en', (key, params) => i18n.global.t(key, params ?? {}))
    const rows = wrapper.findAll('thead tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].findAll('th').slice(0, 3).map(cell => [cell.attributes('scope'), cell.attributes('rowspan')])).toEqual(Array(3).fill(['col', '2']))
    expect(rows[0].findAll('th[scope="colgroup"]')).toHaveLength(roundCount)
    expect(rows[0].findAll('th[scope="colgroup"]').map(cell => cell.attributes('colspan'))).toEqual(Array(roundCount).fill(String(daysPerRound + 1)))
    expect(rows[1].findAll('th')).toHaveLength(roundCount * (daysPerRound + 1))
    expect(rows[1].findAll('th').every(cell => cell.attributes('scope') === 'col')).toBe(true)
    expect(wrapper.findAll('colgroup').map(group => group.attributes('span'))).toEqual(['3', ...Array(roundCount).fill(String(daysPerRound + 1))])
    expect(wrapper.findAll('tbody tr').map(row => row.findAll('th,td').map(cell => cell.text())))
      .toEqual(adminTable.wrapper.findAll('tbody tr').map(row => row.findAll('th,td').map(cell => cell.text())))
    expect(wrapper.findAll('tbody tr').map(row => row.find('td.rank').text())).toEqual(['1', '1', '3'])
    expect(wrapper.findAll('tbody tr').every(row => row.findAll('th,td').length === projection.columns.length)).toBe(true)
    expect(wrapper.get('[data-testid="tournament-public-summary"] h2').text()).toBe(projection.identity)
    expect(wrapper.get('[data-testid="tournament-clan-count"]').text()).toBe('3')
    expect(wrapper.get('[data-testid="tournament-published-days"]').text()).toBe(`2 / ${roundCount * daysPerRound}`)
    expect(wrapper.get('tbody tr td.day').text()).toBe('0')
    expect(wrapper.findAll('tbody tr')[1].find('td.day').text()).toBe('—')
    expect(adminTable.wrapper.find('[data-testid="tournament-public-summary"]').exists()).toBe(false)
    expect(adminTable.wrapper.findAll('thead tr')).toHaveLength(1)
    expect(adminTable.wrapper.get('caption').text()).toBe(projection.identity)
    expect(wrapper.find('caption').exists()).toBe(false)
    expect(wrapper.get('table').attributes('aria-label')).toBe(projection.identity)
    wrapper.unmount(); adminTable.wrapper.unmount()
  })
  it.each(['zh', 'en', 'ru'])('localizes preset day labels in %s and preserves administrator names', locale => {
    const standings = fixture(4, 3)
    standings.event.dayLabels = ['小组赛', '决赛圈', '自定义比赛日 / Final day']
    const { wrapper, i18n } = mountTable(standings, true, locale)
    const labels = wrapper.get('thead tr.tournament-day-headings').findAll('th').slice(0, 3).map(cell => cell.text())
    expect(labels).toEqual([i18n.global.t('tournament.groupStage'), i18n.global.t('tournament.finalStage'), '自定义比赛日 / Final day'])
    expect(wrapper.get('[data-testid="tournament-public-summary"] h2').text()).toBe(projectTournamentPoints(standings, locale, (key, params) => i18n.global.t(key, params ?? {})).identity)
    expect(wrapper.findAll('[data-testid="tournament-public-summary"] dt').map(cell => cell.text()))
      .toEqual([i18n.global.t('tournament.participatingClans'), i18n.global.t('tournament.publishedMatchDays')])
    wrapper.unmount()
  })
  it('groups administrator scores without presenting the snapshot as published standings', async () => {
    const { wrapper } = mountTable(fixture(), false)
    const cells = wrapper.findAll('tbody tr').map(row => row.text())
    await wrapper.setProps({ grouped: true })
    expect(wrapper.findAll('thead tr')).toHaveLength(2)
    expect(wrapper.findAll('tbody tr').map(row => row.text())).toEqual(cells)
    expect(wrapper.get('caption').text()).toBe('2026 · China · Fire Cup')
    expect(wrapper.find('[data-testid="tournament-public-summary"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tournament-published-days"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('updates only the two factual statistics with a new snapshot and keeps the empty table accessible', async () => {
    const { wrapper } = mountTable(fixture())
    const empty = fixture()
    empty.rows = []
    empty.days.forEach(day => { day.published = false })
    await wrapper.setProps({ standings: empty })
    expect(wrapper.findAll('[data-testid="tournament-public-summary"] dt')).toHaveLength(2)
    expect(wrapper.get('[data-testid="tournament-clan-count"]').text()).toBe('0')
    expect(wrapper.get('[data-testid="tournament-published-days"]').text()).toBe('0 / 10')
    expect(wrapper.get('tbody td').attributes('colspan')).toBe('18')
    expect(wrapper.get('.tournament-table-wrap').attributes()).toMatchObject({ tabindex: '0', 'aria-label': 'League standings' })
    expect(wrapper.find('caption').exists()).toBe(false)
    expect(wrapper.get('table').attributes('aria-label')).toBe('2026 · China · Fire Cup')
    wrapper.unmount()
  })
})
