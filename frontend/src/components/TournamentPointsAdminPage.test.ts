// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { messages } from '../locales/messages.js'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import TournamentPointsAdminPage from './TournamentPointsAdminPage.vue'
import TournamentEventSelect from './TournamentEventSelect.vue'

const state = vi.hoisted(() => ({ api: {} as Record<string, any>, auth: null as any }))
vi.mock('../composables/useAuth.js', async importOriginal => {
  const { ref } = await import('vue')
  state.auth = { authenticated: ref(true), tokenParsed: ref({ sub: 'a', realm_access: { roles: ['tournament-admin'] } }), authEpoch: () => 1 }
  return { ...await importOriginal<object>(), useAuth: () => state.auth }
})
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: true }) }) }))
vi.mock('../api/tournament-points.js', async importOriginal => {
  const original = await importOriginal<Record<string, any>>()
  const mock = { ...original }
  for (const name of ['listTournamentEvents', 'getTournamentRuleSource', 'getTournamentConfig', 'getTournamentDay',
    'getTournamentAudit', 'getTournamentHistoricalState', 'supportsTournamentCsvImport', 'getTournamentDataSource',
    'previewTournamentCsvImport', 'importTournamentCsv', 'previewTournamentHistoricalImport', 'importTournamentHistorical']) {
    state.api[name] = vi.fn(); mock[name] = state.api[name]
  }
  return mock
})
const event = { id: 7, version: 1, year: 2026, region: 'CN', season: 'FIRE_CUP', roundCount: 5, daysPerRound: 2, dayLabels: ['Day 1', 'Day 2'], configLocked: false }
const standings = { event, days: [], rows: [] }
const preview = { standings, sourceName: 'scores.csv', sourceSha256: 'a'.repeat(64), sourceRowCount: 200, clanCount: 200, missingCellCount: 1800, eventVersion: 1,
  changes: { addedClans: 2, changedClans: 3, removedClans: 4, addedScores: 5, changedScores: 6, removedScores: 7, preservedClears: 8 } }
function page() {
  const i18n = createI18n({ legacy: false, locale: 'zh', messages: messages as Record<string, any> })
  const wrapper = mount(TournamentPointsAdminPage, { global: { plugins: [i18n], provide: { [DIALOG_INLINE_KEY as symbol]: true }, stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
  const select = async () => { await flushPromises(); wrapper.findComponent(TournamentEventSelect).vm.$emit('update:modelValue', 7); await flushPromises() }
  const file = async (kind: string, file: File) => {
    const input = wrapper.get(`[data-testid="${kind}-file"]`)
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    await input.trigger('change'); await flushPromises()
  }
  return { wrapper, i18n, select, file }
}
beforeEach(() => {
  vi.clearAllMocks()
  state.api.listTournamentEvents.mockResolvedValue([event])
  state.api.getTournamentConfig.mockResolvedValue({ event, clans: [], rounds: [] })
  state.api.getTournamentRuleSource.mockResolvedValue(null)
  state.api.getTournamentDay.mockResolvedValue({ eventId: 7, roundNumber: 1, dayNumber: 1, eventVersion: 1, version: 1,
    rulesVersion: 0, status: 'EMPTY', expectedGroupCount: null, groups: [], published: false, standings })
  state.api.getTournamentAudit.mockResolvedValue([])
  state.api.getTournamentHistoricalState.mockResolvedValue({ canImport: true, imported: false, historical: false, eventVersion: 1 })
  state.api.supportsTournamentCsvImport.mockResolvedValue(true)
  state.api.getTournamentDataSource.mockResolvedValue({ csvImported: false, attribution: null })
  state.api.previewTournamentCsvImport.mockResolvedValue(preview)
  state.api.importTournamentCsv.mockResolvedValue(preview)
})
describe('independent CSV administration flow', () => {
  it('guides event selection without showing a create prompt for existing events', async () => {
    const p = page(); await flushPromises()
    expect(p.wrapper.get('[data-testid="tournament-admin-empty"]').text()).toContain(p.i18n.global.t('tournament.adminSelectionHint'))
    expect(p.wrapper.find('[data-testid="tournament-admin-empty"] a').exists()).toBe(false)
    await p.select()
    expect(p.wrapper.find('[data-testid="tournament-admin-empty"]').exists()).toBe(false)
    expect(p.wrapper.get('[data-testid="tournament-admin-summary"]').text()).toContain('2026 · 国服 · 战火杯')
    expect(p.wrapper.get('.tournament-admin-preview').text()).toContain(p.i18n.global.t('tournament.draftHint'))
    expect(p.wrapper.findAll('.tournament-admin-preview thead tr')).toHaveLength(2)
    expect(p.wrapper.find('[data-testid="tournament-public-summary"]').exists()).toBe(false)
    p.wrapper.unmount()
  })
  it('offers creation only for a successfully loaded empty event list', async () => {
    state.api.listTournamentEvents.mockResolvedValue([])
    const p = page(); await flushPromises()
    expect(p.wrapper.get('[data-testid="tournament-admin-empty"] a').text()).toBe(p.i18n.global.t('tournament.newEvent'))
    p.wrapper.unmount()
  })
  it('does not mistake a loading or failed event list for an empty list', async () => {
    let reject!: (reason: unknown) => void
    state.api.listTournamentEvents.mockImplementation(() => new Promise((_, fail) => { reject = fail }))
    const p = page(); await flushPromises()
    expect(p.wrapper.find('[data-testid="tournament-admin-empty"]').exists()).toBe(false)
    reject({ errorCode: 'NETWORK_ERROR' }); await flushPromises()
    expect(p.wrapper.find('[data-testid="tournament-admin-empty"]').exists()).toBe(false)
    p.wrapper.unmount()
  })
  it.each([
    ['getTournamentDataSource', 'tournament-data-source-error', 'tournament.dataSourceLoadFailed'],
    ['supportsTournamentCsvImport', 'tournament-csv-capability-error', 'tournament.csvCapabilityLoadFailed'],
  ])('keeps the editor enabled with a localized warning when %s fails, then recovers on refresh', async (request, testid, message) => {
    state.api.getTournamentConfig.mockResolvedValue({ event, clans: [], rounds: [{ roundNumber: 1, complete: true, locked: false, rulesVersion: 1, days: [] }] })
    state.api.getTournamentDataSource.mockResolvedValue({ csvImported: true, attribution: { name: '_EK_', url: 'https://b23.tv/rqx5iYX' } })
    state.api[request].mockRejectedValueOnce({ errorCode: 'INTERNAL_ERROR', status: 500 })
    const p = page(); await p.select()
    expect(p.wrapper.get('[data-testid="expected-group-count"]').attributes('disabled')).toBeUndefined()
    expect(p.wrapper.get(`[data-testid="${testid}"]`).text()).toContain(p.i18n.global.t(message))
    if (request === 'supportsTournamentCsvImport') expect(p.wrapper.get('[data-testid="tournament-data-source"] a').text()).toBe('_EK_')
    await p.wrapper.findAll('button').find(button => button.text() === p.i18n.global.t('tournament.refresh'))!.trigger('click')
    await flushPromises()
    expect(p.wrapper.find(`[data-testid="${testid}"]`).exists()).toBe(false)
    expect(p.wrapper.get('[data-testid="expected-group-count"]').attributes('disabled')).toBeUndefined()
    expect(p.wrapper.get('[data-testid="tournament-data-source"] a').text()).toBe('_EK_')
    expect(p.wrapper.find('[data-testid="csv-import"]').exists()).toBe(true)
    p.wrapper.unmount()
  })
  it('keeps JSON and CSV inputs separate, previews changes and cancels before writing', async () => {
    const p = page(); await p.select()
    expect(p.wrapper.get('[data-testid="csv-file"]').attributes('accept')).toBe('.csv,text/csv')
    expect(p.wrapper.get('[data-testid="historical-file"]').attributes('accept')).toBe('.json,application/json')
    await p.file('csv', new File(['scores'], 'scores.csv'))
    expect(state.api.previewTournamentCsvImport).not.toHaveBeenCalled()
    await p.wrapper.get('[data-testid="csv-preview"]').trigger('click'); await flushPromises()
    const section = p.wrapper.get('[data-testid="csv-import"]')
    expect(section.text()).toContain(p.i18n.global.t('tournament.csvClanChanges', { added: 2, changed: 3, removed: 4 }))
    expect(section.text()).toContain(p.i18n.global.t('tournament.csvScoreChanges', { added: 5, changed: 6, removed: 7 }))
    expect(section.text()).toContain(p.i18n.global.t('tournament.csvReplaceWarning'))
    await p.wrapper.get('[data-testid="csv-publish"]').trigger('click')
    expect(p.wrapper.get('[role="dialog"]').text()).toContain('2026 · 国服 · 战火杯')
    await p.wrapper.get('[data-testid="csv-cancel"]').trigger('click')
    expect(p.wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(state.api.importTournamentCsv).not.toHaveBeenCalled()
    expect(state.api.previewTournamentHistoricalImport).not.toHaveBeenCalled()
    p.wrapper.unmount()
  })
  it('confirms a full replacement and refreshes persistent attribution', async () => {
    const p = page(); await p.select()
    await p.file('csv', new File(['scores'], 'scores.csv'))
    await p.wrapper.get('[data-testid="csv-preview"]').trigger('click'); await flushPromises()
    await p.wrapper.get('[data-testid="csv-publish"]').trigger('click')
    state.api.getTournamentDataSource.mockResolvedValue({ csvImported: true, attribution: { name: '_EK_', url: 'https://b23.tv/rqx5iYX' } })
    state.api.getTournamentHistoricalState.mockResolvedValue({ canImport: false, imported: false, historical: true, eventVersion: 2 })
    await p.wrapper.get('[data-testid="csv-confirm"]').trigger('click'); await flushPromises()
    expect(state.api.importTournamentCsv).toHaveBeenCalledOnce()
    expect(p.wrapper.get('[data-testid="tournament-data-source"] a').text()).toBe('_EK_')
    expect(p.wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(p.wrapper.text()).toContain(p.i18n.global.t('tournament.csvImported'))
    p.wrapper.unmount()
  })
  it('shows CSV row and column validation details with a localized reason', async () => {
    const p = page(); await p.select()
    state.api.previewTournamentCsvImport.mockRejectedValue({ errorCode: 'TOURNAMENT_CSV_INVALID', status: 400, details: { rowNumber: 9, column: 'R1D1', reason: 'number' } })
    await p.file('csv', new File(['scores'], 'scores.csv'))
    await p.wrapper.get('[data-testid="csv-preview"]').trigger('click'); await flushPromises()
    expect(p.wrapper.text()).toContain(p.i18n.global.t('tournament.csvErrorLocation', { row: 9, column: 'R1D1', reason: p.i18n.global.t('tournament.csvReasons.number') }))
    expect(state.api.importTournamentCsv).not.toHaveBeenCalled()
    p.wrapper.unmount()
  })
  it('keeps a failed replacement and its error visible inside the dialog until canceled', async () => {
    const p = page(); await p.select()
    const file = new File(['scores'], 'scores.csv')
    await p.file('csv', file)
    await p.wrapper.get('[data-testid="csv-preview"]').trigger('click'); await flushPromises()
    await p.wrapper.get('[data-testid="csv-publish"]').trigger('click')
    state.api.importTournamentCsv.mockRejectedValueOnce({ errorCode: 'TOURNAMENT_VERSION_CONFLICT', status: 409 })
    await p.wrapper.get('[data-testid="csv-confirm"]').trigger('click'); await flushPromises()
    expect(p.wrapper.get('[role="dialog"]').text()).toContain(p.i18n.global.t('tournament.stale'))
    expect(p.wrapper.get('[data-testid="csv-confirm"]').attributes('disabled')).toBeDefined()
    expect(p.wrapper.get('[data-testid="csv-import"]').text()).toContain('scores.csv')
    expect(p.wrapper.find('[data-testid="csv-publish"]').exists()).toBe(true)
    expect(state.api.importTournamentCsv.mock.calls[0][1]).toBe(file)
    await p.wrapper.get('[data-testid="csv-cancel"]').trigger('click')
    expect(p.wrapper.find('[role="dialog"]').exists()).toBe(false)
    p.wrapper.unmount()
  })
})
