// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { nextTick } from 'vue'
import { messages } from '../locales/messages.js'
import TournamentPointsPage from './TournamentPointsPage.vue'
import TournamentEventSelect from './TournamentEventSelect.vue'
import TournamentPointsTable from './TournamentPointsTable.vue'
import Banner from './Banner.vue'
import type { TournamentEvent, TournamentStandings } from '../api/tournament-points.js'

const state = vi.hoisted(() => ({
  list: vi.fn(), board: vi.fn(), source: vi.fn(), xlsx: vi.fn(), print: vi.fn(), download: vi.fn(), android: false,
  online: null as unknown as { value: boolean },
}))
vi.mock('../api/tournament-points.js', async importOriginal => ({ ...await importOriginal<object>(), listTournamentEvents: state.list, getTournamentStandings: state.board, getTournamentDataSource: state.source }))
vi.mock('../composables/useFeatureGate.js', async () => {
  const { ref } = await import('vue')
  state.online = ref(true)
  return { useFeatureGate: () => ({ availability: () => ({ available: state.online.value }) }) }
})
vi.mock('../composables/usePlatformBridge.js', async importOriginal => ({ ...await importOriginal<object>(), isAndroidApp: () => state.android }))
vi.mock('../utils/tournamentPointsExport.js', async importOriginal => ({ ...await importOriginal<object>(), createTournamentPointsXlsx: state.xlsx, printTournamentPoints: state.print }))
vi.mock('../utils/exportReplayPng.js', async importOriginal => ({ ...await importOriginal<object>(), downloadBlob: state.download }))

const events: TournamentEvent[] = [
  { id: 7, version: 1, year: 2026, region: 'CN', season: 'SUMMER', roundCount: 5, daysPerRound: 2, dayLabels: ['小组赛', '决赛圈'], configLocked: true },
  { id: 8, version: 1, year: 2025, region: 'EU', season: 'FIRE_CUP', roundCount: 4, daysPerRound: 3, dayLabels: ['Day 1', 'Day 2', 'Day 3'], configLocked: true },
]
const board = (index = 0, empty = false): TournamentStandings => ({
  event: events[index], days: [{ roundNumber: 1, dayNumber: 1, label: events[index].dayLabels[0], published: !empty }], rows: empty ? [] : [{ rank: 1, clanTag: index ? 'NEW' : 'KSR', totalPoints: 100, rounds: [] }],
})
function page() {
  const i18n = createI18n({ legacy: false, locale: 'zh', messages: messages as Record<string, any> })
  const wrapper = mount(TournamentPointsPage, { global: { plugins: [i18n] } })
  const selected = async (id: number | null = 7) => {
    wrapper.findComponent(TournamentEventSelect).vm.$emit('update:modelValue', id)
    await nextTick()
    await flushPromises()
  }
  const exportItem = async (format: 'xlsx' | 'csv' | 'pdf') => {
    await wrapper.get('[data-testid="tournament-export"]').trigger('click')
    await wrapper.get(`[data-testid="tournament-export-${format}"]`).trigger('click')
  }
  return { wrapper, i18n, selected, exportItem }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.android = false
  state.online.value = true
  state.list.mockResolvedValue(events)
  state.board.mockImplementation(id => Promise.resolve(board(id === 8 ? 1 : 0)))
  state.source.mockResolvedValue({ csvImported: false, attribution: null })
  state.xlsx.mockResolvedValue({ blob: new Blob(['xlsx']), filename: 'scores.xlsx' })
  state.print.mockResolvedValue(undefined)
  state.download.mockResolvedValue(undefined)
})

describe('public tournament summary', () => {
  const snapshot = (index = 0): TournamentStandings => ({
    event: events[index],
    days: [
      { roundNumber: 1, dayNumber: 1, label: events[index].dayLabels[0], published: true },
      { roundNumber: 1, dayNumber: 2, label: events[index].dayLabels[1], published: true },
      { roundNumber: 2, dayNumber: 1, label: events[index].dayLabels[0], published: false },
    ],
    rows: [
      { rank: 1, clanTag: 'ALPHA', totalPoints: 100, rounds: [{ roundNumber: 1, totalPoints: 100, days: [{ dayNumber: 1, points: 100 }, { dayNumber: 2, points: null }] }] },
      { rank: 1, clanTag: 'BETA', totalPoints: 100, rounds: [{ roundNumber: 1, totalPoints: 100, days: [{ dayNumber: 1, points: 0 }, { dayNumber: 2, points: 100 }] }] },
      { rank: 3, clanTag: 'GAMMA', totalPoints: 0, rounds: [{ roundNumber: 1, totalPoints: 0, days: [{ dayNumber: 1, points: 0 }, { dayNumber: 2, points: null }] }] },
    ],
  })
  it('derives only clan and published-day statistics from the current board without adding requests or changing ranks and scores', async () => {
    const initial = snapshot()
    const historical = { ...snapshot(1), days: snapshot(1).days.map((day, index) => ({ ...day, published: index === 0 })), rows: snapshot(1).rows.slice(0, 2) }
    state.board.mockImplementation(id => Promise.resolve(id === 8 ? historical : initial))
    const p = page(); await flushPromises()
    const table = p.wrapper.findComponent(TournamentPointsTable)
    expect(table.props('publicView')).toBe(true)
    const summary = () => p.wrapper.get('[data-testid="tournament-public-summary"]')
    expect(summary().findAll('dt').map(label => label.text())).toEqual([
      p.i18n.global.t('tournament.participatingClans'), p.i18n.global.t('tournament.publishedMatchDays'),
    ])
    expect(summary().get('[data-testid="tournament-clan-count"]').text()).toBe('3')
    expect(summary().get('[data-testid="tournament-published-days"]').text()).toBe('2 / 10')
    expect(table.findAll('tbody .rank').map(cell => cell.text())).toEqual(['1', '1', '3'])
    expect(table.findAll('tbody .clan').map(cell => cell.text())).toEqual(['ALPHA', 'BETA', 'GAMMA'])
    expect(table.findAll('tbody tr')[0].findAll('td.day').slice(0, 2).map(cell => cell.text())).toEqual(['100', '—'])
    expect(table.findAll('tbody tr')[1].findAll('td.day').slice(0, 2).map(cell => cell.text())).toEqual(['0', '100'])
    expect(table.props('standings').rows).toEqual(initial.rows)
    expect(p.wrapper.text()).not.toMatch(/最高积分|并列|前三名/)
    expect(state.list).toHaveBeenCalledTimes(1)
    expect(state.board.mock.calls.map(call => call[0])).toEqual([7])
    expect(state.source.mock.calls.map(call => call[0])).toEqual([7])

    await p.selected(8)
    expect(summary().get('[data-testid="tournament-clan-count"]').text()).toBe('2')
    expect(summary().get('[data-testid="tournament-published-days"]').text()).toBe('1 / 12')
    const refreshed = { ...historical, event: { ...historical.event, version: 2 }, days: historical.days.map(day => ({ ...day, published: true })), rows: [...historical.rows, ...initial.rows.slice(2)] }
    state.board.mockResolvedValueOnce(refreshed)
    await p.wrapper.findAll('button').find(button => button.text() === p.i18n.global.t('tournament.refresh'))!.trigger('click')
    await flushPromises()
    expect(summary().get('[data-testid="tournament-clan-count"]').text()).toBe('3')
    expect(summary().get('[data-testid="tournament-published-days"]').text()).toBe('3 / 12')
    expect(p.wrapper.findComponent(TournamentPointsTable).props('standings').rows).toEqual(refreshed.rows)
    p.i18n.global.locale.value = 'en'; await nextTick()
    expect(summary().findAll('dt').map(label => label.text())).toEqual(['Participating clans', 'Published match days'])
    expect(state.list).toHaveBeenCalledTimes(1)
    expect(state.board.mock.calls.map(call => call[0])).toEqual([7, 8, 8])
    expect(state.source.mock.calls.map(call => call[0])).toEqual([7, 8, 8])
    p.wrapper.unmount()
  })
  it('hides a previous summary during loading and while offline, and keeps current statistics when source metadata fails', async () => {
    state.board.mockResolvedValueOnce(snapshot())
    const p = page(); await flushPromises()
    expect(p.wrapper.get('[data-testid="tournament-clan-count"]').text()).toBe('3')
    let finish!: (value: TournamentStandings) => void
    state.board.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    state.source.mockRejectedValueOnce({ errorCode: 'INTERNAL_ERROR', status: 500 })
    await p.selected(8)
    expect(p.wrapper.find('[data-testid="tournament-public-summary"]').exists()).toBe(false)
    expect(p.wrapper.get('[data-testid="tournament-export"]').attributes('disabled')).toBeDefined()
    expect(p.wrapper.find('[data-testid="tournament-data-source-error"]').exists()).toBe(true)
    const historical = { ...snapshot(1), rows: snapshot(1).rows.slice(0, 2) }
    finish(historical); await flushPromises()
    expect(p.wrapper.get('[data-testid="tournament-clan-count"]').text()).toBe('2')
    expect(p.wrapper.get('[data-testid="tournament-published-days"]').text()).toBe('2 / 12')
    expect(p.wrapper.get('[data-testid="tournament-export"]').attributes('disabled')).toBeUndefined()
    expect(p.wrapper.find('[data-testid="tournament-data-source-error"]').exists()).toBe(true)
    state.online.value = false; await nextTick()
    expect(p.wrapper.find('[data-testid="tournament-public-summary"]').exists()).toBe(false)
    expect(p.wrapper.findComponent(TournamentPointsTable).exists()).toBe(false)
    expect(state.list).toHaveBeenCalledTimes(1)
    expect(state.board.mock.calls.map(call => call[0])).toEqual([7, 8])
    expect(state.source.mock.calls.map(call => call[0])).toEqual([7, 8])
    p.wrapper.unmount()
  })
})

describe('public tournament export lifecycle', () => {
  it('offers localized canonical CSV guidance and downloads the selected standings', async () => {
    const p = page(); await flushPromises()
    expect(p.wrapper.get('[data-testid="tournament-csv-hint"]').text()).toBe(p.i18n.global.t('tournament.csvExportHint'))
    await p.wrapper.get('[data-testid="tournament-export"]').trigger('click')
    expect(p.wrapper.get('[data-testid="tournament-export-csv"]').text()).toBe(p.i18n.global.t('tournament.exportCsv'))
    await p.wrapper.get('[data-testid="tournament-export-csv"]').trigger('click')
    await flushPromises()
    expect(state.download).toHaveBeenCalledOnce()
    expect(state.download.mock.calls[0][1]).toBe('2026_CN_SUMMER.csv')
    expect(state.download.mock.calls[0][0].type).toBe('text/csv;charset=utf-8')
    for (const locale of ['en', 'ru']) {
      p.i18n.global.locale.value = locale
      await nextTick()
      expect(p.wrapper.get('[data-testid="tournament-csv-hint"]').text()).toBe(p.i18n.global.t('tournament.csvExportHint'))
    }
    p.wrapper.unmount()
  })

  it('ignores an older initial event list after a reconnect search has completed', async () => {
    let finishOld!: (value: TournamentEvent[]) => void
    state.list.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve }))
    const p = page()
    await flushPromises()
    state.online.value = false
    await nextTick()
    state.online.value = true
    await flushPromises()
    finishOld([{ ...events[0], id: 999, year: 2030, season: 'WINTER' }])
    await flushPromises()
    expect(p.wrapper.findComponent(TournamentEventSelect).props('events')).toEqual(events)
    expect(p.wrapper.findComponent(TournamentEventSelect).props('modelValue')).toBe(7)
    expect(state.board.mock.calls.map(call => call[0])).toEqual([7])
    expect(state.list.mock.calls[0][1].aborted).toBe(true)
    p.wrapper.unmount()
  })

  it('ignores an old initial board error after a reconnect selects a fresh official board', async () => {
    let failOld!: (reason: Error) => void
    state.board.mockReturnValueOnce(new Promise((_, reject) => { failOld = reject }))
    const p = page()
    await flushPromises()
    state.online.value = false
    await nextTick()
    state.online.value = true
    await flushPromises()
    failOld(new Error('outdated initial request'))
    await flushPromises()
    expect(p.wrapper.findComponent(TournamentEventSelect).props('modelValue')).toBe(7)
    expect(p.wrapper.findComponent(Banner).exists()).toBe(false)
    expect(p.wrapper.get('[data-testid="tournament-export"]').attributes('disabled')).toBeUndefined()
    expect(state.board.mock.calls[0][1].aborted).toBe(true)
    p.wrapper.unmount()
  })

  it('restores a historical board cancelled during reconnect without accepting its late response', async () => {
    const p = page()
    await flushPromises()
    let finishOld!: (value: TournamentStandings) => void
    state.board.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve }))
    await p.selected(8)
    state.online.value = false
    await nextTick()
    state.online.value = true
    await flushPromises()
    finishOld(board())
    await flushPromises()
    expect(p.wrapper.findComponent(TournamentEventSelect).props('modelValue')).toBe(8)
    expect(p.wrapper.text()).toContain('NEW')
    expect(p.wrapper.get('[data-testid="tournament-export"]').attributes('disabled')).toBeUndefined()
    expect(state.board.mock.calls.map(call => call[0])).toEqual([7, 8, 8])
    p.wrapper.unmount()
  })
  it('disables export while no event is selected, while loading, on empty results and on load failure', async () => {
    let finish!: (value: TournamentStandings) => void
    state.board.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const p = page()
    const disabled = () => p.wrapper.get('[data-testid="tournament-export"]').attributes('disabled') !== undefined
    expect(disabled()).toBe(true)
    await flushPromises()
    expect(disabled()).toBe(true)
    finish(board())
    await flushPromises()
    expect(disabled()).toBe(false)
    state.board.mockResolvedValueOnce(board(1, true))
    await p.selected(8)
    expect(disabled()).toBe(true)
    state.board.mockRejectedValueOnce(new Error('network failure'))
    await p.selected(7)
    expect(disabled()).toBe(true)
    await p.selected(null)
    expect(disabled()).toBe(true)
    p.wrapper.unmount()
  })

  it('defaults to the newest CN calendar event with published data, skipping newer empty events', async () => {
    const options: TournamentEvent[] = [
      { ...events[0], id: 40, year: 2027, region: 'EU', season: 'WINTER' },
      { ...events[0], id: 50, year: 2026, season: 'FIRE_CUP' },
      { ...events[0], id: 30, year: 2026, season: 'AUTUMN' },
      { ...events[0], id: 5, year: 2026, season: 'WINTER' },
      { ...events[0], id: 60, year: 2025, season: 'WINTER' },
    ]
    state.list.mockResolvedValue(options)
    state.board.mockImplementation(id => Promise.resolve({ ...board(0, id !== 50), event: options.find(event => event.id === id) }))
    const p = page()
    await flushPromises()
    expect(p.wrapper.findComponent(TournamentEventSelect).props('modelValue')).toBe(50)
    expect(p.wrapper.findAll('select').map(select => (select.element as HTMLSelectElement).value)).toEqual(['2026', 'CN', 'FIRE_CUP'])
    expect(state.board.mock.calls.map(call => call[0])).toEqual([5, 50])
    p.wrapper.unmount()
  })

  it('prioritizes the year over the season and chooses the latest available region if CN is absent', async () => {
    const options: TournamentEvent[] = [
      { ...events[0], id: 12, year: 2026, region: 'EU', season: 'WINTER' },
      { ...events[0], id: 11, year: 2027, region: 'ASIA', season: 'SPRING' },
    ]
    state.list.mockResolvedValue(options)
    state.board.mockImplementation(id => Promise.resolve({ ...board(), event: options.find(event => event.id === id) }))
    const p = page()
    await flushPromises()
    expect(p.wrapper.findComponent(TournamentEventSelect).props('modelValue')).toBe(11)
    expect(state.board.mock.calls.map(call => call[0])).toEqual([11])
    p.wrapper.unmount()
  })

  it('accepts a season with only one finalized day, without requiring the whole round', async () => {
    state.board.mockResolvedValue({ ...board(), days: [
      { roundNumber: 1, dayNumber: 1, label: '小组赛', published: false },
      { roundNumber: 1, dayNumber: 2, label: '决赛圈', published: true },
    ] })
    const p = page()
    await flushPromises()
    expect(p.wrapper.findComponent(TournamentEventSelect).props('modelValue')).toBe(7)
    expect(state.board.mock.calls.map(call => call[0])).toEqual([7])
    p.wrapper.unmount()
  })

  it('does not default to an empty CN board and can find newly published data on refresh', async () => {
    state.board.mockResolvedValue(board(0, true))
    const p = page()
    await flushPromises()
    expect(p.wrapper.findComponent(TournamentEventSelect).props('modelValue')).toBeNull()
    expect(p.wrapper.text()).toContain(p.i18n.global.t('tournament.empty'))
    state.board.mockResolvedValue(board())
    await p.wrapper.findAll('button').find(button => button.text() === '刷新')!.trigger('click')
    await flushPromises()
    expect(p.wrapper.findComponent(TournamentEventSelect).props('modelValue')).toBe(7)
    expect(state.board.mock.calls.map(call => call[0])).toEqual([7, 7])
    p.wrapper.unmount()
  })

  it('keeps an explicitly selected historical event when its official board is refreshed', async () => {
    const p = page()
    await flushPromises()
    expect(p.wrapper.findComponent(TournamentEventSelect).props('modelValue')).toBe(7)
    await p.selected(8)
    await p.wrapper.findAll('button').find(button => button.text() === '刷新')!.trigger('click')
    await flushPromises()
    expect(p.wrapper.findComponent(TournamentEventSelect).props('modelValue')).toBe(8)
    expect(state.board.mock.calls.map(call => call[0])).toEqual([7, 8, 8])
    p.wrapper.unmount()
  })

  it('exports the click-time public event and language even when another event finishes loading', async () => {
    const p = page()
    await flushPromises()
    await p.selected()
    let finish!: (value: { blob: Blob; filename: string }) => void
    state.xlsx.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await p.exportItem('xlsx')
    expect(p.wrapper.get('[data-testid="tournament-export"]').attributes('disabled')).toBeDefined()
    await p.selected(8)
    p.i18n.global.locale.value = 'en'
    await nextTick()
    expect(p.wrapper.findComponent(TournamentEventSelect).props('modelValue')).toBe(8)
    const snapshot = state.xlsx.mock.calls[0][0]
    expect(snapshot.title).toContain('2026 · 国服 · 夏季赛')
    expect(snapshot.columns[0].label).toBe('排名')
    expect(snapshot.rows[0].cells[1]).toBe('KSR')
    const blob = new Blob(['original'])
    finish({ blob, filename: '2026-original.xlsx' })
    await flushPromises()
    expect(state.download).toHaveBeenCalledWith(blob, '2026-original.xlsx')
    expect(state.board.mock.calls.map(call => call[0])).toEqual([7, 8])
    expect(p.wrapper.get('[data-testid="tournament-export"]').attributes('disabled')).toBeUndefined()
    p.wrapper.unmount()
  })

  it('shows a localized export failure and permits a successful retry', async () => {
    const p = page()
    await flushPromises()
    await p.selected()
    state.xlsx.mockRejectedValueOnce(new Error('chunk unavailable'))
    await p.exportItem('xlsx')
    await flushPromises()
    expect(p.wrapper.text()).toContain(p.i18n.global.t('tournament.exportFailed'))
    expect(p.wrapper.get('[data-testid="tournament-export"]').attributes('disabled')).toBeUndefined()
    await p.exportItem('xlsx')
    await flushPromises()
    expect(state.download).toHaveBeenCalledOnce()
    expect(p.wrapper.find('[role="status"]').exists()).toBe(false)
    p.wrapper.unmount()
  })

  it('prints only the selected public matrix and gives Android a system-browser hint', async () => {
    const p = page()
    await flushPromises()
    await p.selected(8)
    await p.exportItem('pdf')
    await flushPromises()
    expect(state.print.mock.calls[0][0].identity).toContain('2025')
    expect(state.print.mock.calls[0][0].columns).toHaveLength(19)
    state.android = true
    await p.exportItem('pdf')
    await flushPromises()
    expect(state.print).toHaveBeenCalledOnce()
    expect(p.wrapper.text()).toContain(p.i18n.global.t('tournament.exportPdfBrowser'))
    expect(state.download).not.toHaveBeenCalled()
    p.wrapper.unmount()
  })
})

describe('persistent CSV source attribution', () => {
  const source = { csvImported: true, attribution: { name: '_EK_', url: 'https://b23.tv/rqx5iYX' } }
  it('shows and exports the initial standings while source loading is pending or fails, then retries on refresh', async () => {
    let failSource!: (value: unknown) => void
    state.source.mockReturnValueOnce(new Promise((_, reject) => { failSource = reject }))
    const p = page(); await flushPromises()
    expect(p.wrapper.findComponent(TournamentEventSelect).props('modelValue')).toBe(7)
    expect(p.wrapper.get('.tournament-table').text()).toContain('KSR')
    expect(p.wrapper.get('.tournament-table').text()).toContain('100')
    expect(p.wrapper.get('[data-testid="tournament-export"]').attributes('disabled')).toBeUndefined()
    failSource({ errorCode: 'INTERNAL_ERROR', status: 500 }); await flushPromises()
    expect(p.wrapper.get('[data-testid="tournament-data-source-error"]').text()).toContain(p.i18n.global.t('tournament.dataSourceLoadFailed'))
    expect(p.wrapper.get('.tournament-table').text()).toContain('KSR')
    await p.exportItem('xlsx'); await flushPromises()
    expect(state.download).toHaveBeenCalledOnce()
    state.source.mockResolvedValueOnce(source)
    await p.wrapper.findAll('button').find(button => button.text() === p.i18n.global.t('tournament.refresh'))!.trigger('click')
    await flushPromises()
    expect(p.wrapper.find('[data-testid="tournament-data-source-error"]').exists()).toBe(false)
    expect(p.wrapper.get('[data-testid="tournament-data-source"] a').text()).toBe('_EK_')
    p.wrapper.unmount()
  })
  it('keeps a manually selected board usable when source loading times out and restores the source on refresh', async () => {
    const p = page(); await flushPromises()
    let failSource!: (value: unknown) => void
    state.source.mockReturnValueOnce(new Promise((_, reject) => { failSource = reject }))
    await p.selected(8)
    expect(p.wrapper.get('.tournament-table').text()).toContain('NEW')
    expect(p.wrapper.get('.tournament-table').text()).toContain('100')
    expect(p.wrapper.get('[data-testid="tournament-export"]').attributes('disabled')).toBeUndefined()
    failSource({ errorCode: 'NETWORK_TIMEOUT', status: 504 }); await flushPromises()
    expect(p.wrapper.get('[data-testid="tournament-data-source-error"]').text()).toContain(p.i18n.global.t('tournament.dataSourceLoadFailed'))
    expect(p.wrapper.get('.tournament-table').text()).toContain('NEW')
    await p.exportItem('xlsx'); await flushPromises()
    expect(state.download).toHaveBeenCalledOnce()
    state.source.mockResolvedValueOnce(source)
    await p.wrapper.findAll('button').find(button => button.text() === p.i18n.global.t('tournament.refresh'))!.trigger('click')
    await flushPromises()
    expect(p.wrapper.findComponent(TournamentEventSelect).props('modelValue')).toBe(8)
    expect(p.wrapper.find('[data-testid="tournament-data-source-error"]').exists()).toBe(false)
    expect(p.wrapper.get('[data-testid="tournament-data-source"] a').text()).toBe('_EK_')
    p.wrapper.unmount()
  })
  it('shows a real external source button on initial load and after a refresh', async () => {
    state.source.mockResolvedValue(source)
    const p = page(); await flushPromises()
    const link = p.wrapper.get('[data-testid="tournament-data-source"] a')
    expect(link.text()).toBe('_EK_')
    expect(link.attributes()).toMatchObject({ href: source.attribution.url, target: '_blank', rel: 'noopener noreferrer' })
    await p.wrapper.findAll('button').find(button => button.text() === p.i18n.global.t('tournament.refresh'))!.trigger('click')
    await flushPromises()
    expect(state.source.mock.calls.map(call => call[0])).toEqual([7, 7])
    expect(p.wrapper.find('[data-testid="tournament-data-source"]').exists()).toBe(true)
    p.wrapper.unmount()
  })
  it('hides the credit on a non-CSV tournament and for a previous backend', async () => {
    state.source.mockImplementation(id => Promise.resolve(id === 7 ? source : null))
    const p = page(); await flushPromises()
    expect(p.wrapper.find('[data-testid="tournament-data-source"]').exists()).toBe(true)
    await p.selected(8)
    expect(p.wrapper.find('[data-testid="tournament-data-source"]').exists()).toBe(false)
    p.wrapper.unmount()
  })
  it('rejects late source metadata from an older tournament and clears it while offline', async () => {
    const p = page(); await flushPromises()
    let finish!: (value: any) => void
    state.source.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const pending = p.selected(8)
    await nextTick()
    await p.selected(7)
    finish(source); await pending
    expect(p.wrapper.find('[data-testid="tournament-data-source"]').exists()).toBe(false)
    state.source.mockResolvedValue(source)
    await p.selected(8)
    expect(p.wrapper.find('[data-testid="tournament-data-source"]').exists()).toBe(true)
    state.online.value = false; await nextTick()
    expect(p.wrapper.find('[data-testid="tournament-data-source"]').exists()).toBe(false)
    p.wrapper.unmount()
  })
})
