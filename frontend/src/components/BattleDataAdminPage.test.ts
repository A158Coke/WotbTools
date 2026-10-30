// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import BattleDataAdminPage from './BattleDataAdminPage.vue'
const state = vi.hoisted(() => ({ summary: vi.fn(), battles: vi.fn(), detail: vi.fn() }))
type SpawnStat = { mapKey: string; arenaBonusType: 1 | 7 | null; side: 'NORTH' | 'SOUTH' | 'WEST' | 'EAST'; battles: number; wins: number; draws: number; losses: number }
const stat = (mapKey: string, arenaBonusType: SpawnStat['arenaBonusType'], side: SpawnStat['side'], wins: number, draws: number, losses: number): SpawnStat => ({ mapKey, arenaBonusType, side, battles: wins + draws + losses, wins, draws, losses })
const spawnSummary = {
  maps: [{ key: 'erlenberg', count: 128, latestReceivedAt: '2026-10-29T00:00:00Z' }, { key: 'karieri', count: 83, latestReceivedAt: '2026-10-29T00:00:00Z' }],
  spawnStats: [
    stat('erlenberg', null, 'NORTH', 70, 5, 53), stat('erlenberg', null, 'SOUTH', 53, 5, 70),
    stat('erlenberg', 1, 'NORTH', 60, 4, 36), stat('erlenberg', 1, 'SOUTH', 36, 4, 60),
    stat('erlenberg', 7, 'NORTH', 10, 1, 17), stat('erlenberg', 7, 'SOUTH', 17, 1, 10),
    stat('karieri', null, 'WEST', 40, 3, 40), stat('karieri', null, 'EAST', 40, 3, 40),
  ],
}
const online = ref(true)
const locale = ref('en')
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: online.value, pending: false, messageKey: 'offline' }), requireFeature: () => online.value }) }))
vi.mock('../api/admin-battle-data.js', () => ({ getSummary: state.summary, getBattles: state.battles, getBattle: state.detail }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (s: string, p?: { side?: string }) => (p?.side ? `${s}[${p.side}]` : s), te: () => true, locale }) }))
const summary = { asOf: '2026-10-29T00:00:00Z', totalBattles: 1, last24Hours: 1, last7Days: 1, last30Days: 1, windowBattles: 1, latestReceivedAt: '2026-10-29T00:00:00Z', distinctMaps: 1, distinctClientVersions: 1, modes: [{ key: 1, count: 1 }], winnerTeams: [{ key: 0, count: 1 }], schemaVersions: [{ key: 1, count: 1 }], daily: [], maps: [{ key: 'rift', count: 1, latestReceivedAt: '2026-10-29T00:00:00Z' }], clientVersions: [], spawnStats: [] as SpawnStat[] }
const battle = { id: '1', arenaId: '18446744073709551615', schemaVersion: 1, arenaBonusType: 1, mapId: 1, mapKey: 'rift', clientVersion: '11.18', winnerTeam: 0, team1Spawn: 'NORTH', team2Spawn: 'SOUTH', receivedAt: '2026-10-29T00:00:00Z' }
const vehicles = Array.from({ length: 14 }, (_, i) => ({ team: i < 7 ? 1 : 2, slot: i % 7, vehicleId: 10 + i }))
beforeEach(() => { vi.clearAllMocks(); online.value = true; locale.value = 'en'; state.summary.mockResolvedValue(summary); state.battles.mockResolvedValue({ items: [battle], nextCursor: null }); state.detail.mockResolvedValue({ battle, vehicles }) })
function page() { return mount(BattleDataAdminPage, { global: { stubs: { AppDialog: { props: ['open'], template: '<div v-if="open"><slot /></div>' } } } }) }
describe('BattleDataAdminPage', () => {
  it('shows bias, reviewed zero coverage and detail', async () => {
    const wrapper = page(); await flushPromises()
    expect(wrapper.text()).toContain('battleDataAdmin.biasNotice')
    expect(wrapper.text()).toContain('malinovka')
    expect(wrapper.text()).toContain('battleDataAdmin.reviewedMaps: 29')
    expect(wrapper.text()).toContain('battleDataAdmin.mapsObserved: 1')
    expect(wrapper.text()).toContain('battleDataAdmin.reviewedZero: 28')
    expect(wrapper.text()).toContain('18446744073709551615')
    await wrapper.findAll('button').find(b => b.text() === 'battleDataAdmin.view')!.trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('battleDataAdmin.vehicle #10')
    expect(wrapper.text()).toContain('battleDataAdmin.vehicle #23')
    wrapper.unmount()
  })
  it.each([['zh', '米德尔堡'], ['en', 'Middleburg'], ['ru', 'Миддлбург']])('uses the canonical %s map name as the primary label', async (language, name) => {
    locale.value = language
    state.summary.mockResolvedValueOnce({ ...summary, ...spawnSummary })
    state.battles.mockResolvedValueOnce({ items: [{ ...battle, mapKey: 'erlenberg' }], nextCursor: null })
    const wrapper = page(); await flushPromises()
    expect(wrapper.find('[data-testid=spawn-stats] .map-name').text()).toBe(name)
    expect(wrapper.find('[data-testid=recent-battles] .map-name').text()).toBe(name)
    expect(wrapper.find('[data-testid=spawn-stats] .raw-key').text()).toBe('erlenberg')
    wrapper.unmount()
  })
  it('filters by a single-select map whose wire value stays canonical', async () => {
    state.summary.mockResolvedValueOnce({ ...summary, ...spawnSummary })
    const wrapper = page(); await flushPromises()
    const select = wrapper.find('[data-testid=map-filter]')
    expect(select.element.tagName).toBe('SELECT')
    expect((select.element as HTMLSelectElement).multiple).toBe(false)
    expect(select.findAll('option').map(option => option.text())).toEqual(['battleDataAdmin.allMaps', 'Copperfield', 'Middleburg'])
    await select.setValue('erlenberg')
    await wrapper.find('form').trigger('submit.prevent'); await flushPromises()
    expect(state.battles).toHaveBeenLastCalledWith(expect.objectContaining({ mapKey: 'erlenberg' }))
    wrapper.unmount()
  })
  it('defaults spawn statistics to combined and switches modes without refetching', async () => {
    state.summary.mockResolvedValueOnce({ ...summary, ...spawnSummary })
    const wrapper = page(); await flushPromises()
    const row = () => wrapper.findAll('[data-testid=spawn-stats] tbody tr').find(item => item.text().includes('Middleburg'))!.findAll('td').map(cell => cell.text())
    expect(row().slice(1, 5)).toEqual(['128', '54.7% · 70/128', '41.4% · 53/128', '3.9%'])
    await wrapper.find('[data-testid=spawn-mode-random]').trigger('click'); await flushPromises()
    expect(row().slice(1, 5)).toEqual(['100', '60.0% · 60/100', '36.0% · 36/100', '4.0%'])
    await wrapper.find('[data-testid=spawn-mode-rating]').trigger('click'); await flushPromises()
    expect(row().slice(1, 5)).toEqual(['28', '35.7% · 10/28', '60.7% · 17/28', '3.6%'])
    expect(state.summary).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('labels north/south as top/bottom, keeps Copperfield west/east and renders both axes', async () => {
    state.summary.mockResolvedValueOnce({ ...summary, ...spawnSummary })
    const wrapper = page(); await flushPromises()
    const tables = wrapper.findAll('[data-testid=spawn-stats]')
    expect(tables).toHaveLength(2)
    expect(tables[0].find('thead').text()).toContain('battleDataAdmin.sideWinRate[battleDataAdmin.side.top]')
    expect(tables[0].find('thead').text()).toContain('battleDataAdmin.sideWinRate[battleDataAdmin.side.bottom]')
    expect(tables[1].find('thead').text()).toContain('battleDataAdmin.sideWinRate[battleDataAdmin.side.west]')
    expect(tables[1].find('thead').text()).toContain('battleDataAdmin.sideWinRate[battleDataAdmin.side.east]')
    expect(tables[1].text()).toContain('Copperfield')
    expect(tables[0].text()).not.toContain('Copperfield')
    wrapper.unmount()
  })
  it('renders zero observations without NaN, Infinity or the raw unresolved dump', async () => {
    const wrapper = page(); await flushPromises()
    expect(wrapper.text()).not.toMatch(/NaN|Infinity/)
    expect(wrapper.text()).not.toContain('06_rudniki_rd')
    expect(wrapper.text()).not.toContain('battleDataAdmin.unknown')
    const empty = wrapper.findAll('[data-testid=spawn-stats] tbody tr').find(item => item.text().includes('Middleburg'))!
    expect(empty.findAll('td').map(cell => cell.text()).slice(1, 5)).toEqual(['0', '—', '—', '—'])
    wrapper.unmount()
  })
  it('renders zero rows for the fixed mode and winner sanity buckets', async () => {
    const wrapper = page(); await flushPromises()
    expect(wrapper.text()).toContain('battleDataAdmin.rating: 0')
    expect(wrapper.text()).toContain('battleDataAdmin.team1: 0')
    expect(wrapper.text()).toContain('battleDataAdmin.team2: 0')
    wrapper.unmount()
  })
  it('does not overwrite a newer filtered result with an older refresh', async () => {
    let finishSummary!: (value: typeof summary) => void
    const delayed = new Promise<typeof summary>(resolve => { finishSummary = resolve })
    state.summary.mockReturnValueOnce(delayed)
    state.battles.mockResolvedValueOnce({ items: [battle], nextCursor: null })
      .mockResolvedValueOnce({ items: [{ ...battle, id: '2', arenaId: '2' }], nextCursor: null })
    const wrapper = page(); await flushPromises()
    expect(wrapper.text()).toContain('battleDataAdmin.loading')
    await wrapper.find('form').trigger('submit.prevent'); await flushPromises()
    expect(state.battles).toHaveBeenCalledTimes(2)
    finishSummary(summary); await flushPromises()
    expect(wrapper.text()).not.toContain('18446744073709551615')
    wrapper.unmount()
  })
  it('cannot load an old cursor while a replacement range refresh is pending', async () => {
    state.battles.mockResolvedValueOnce({ items: [battle], nextCursor: 'old-cursor' })
    const wrapper = page(); await flushPromises()
    let finishSummary!: (value: typeof summary) => void
    let finishList!: (value: { items: (typeof battle)[]; nextCursor: string | null }) => void
    const delayedSummary = new Promise<typeof summary>(resolve => { finishSummary = resolve })
    const delayedList = new Promise<{ items: (typeof battle)[]; nextCursor: string | null }>(resolve => { finishList = resolve })
    state.summary.mockReturnValueOnce(delayedSummary)
    state.battles.mockReturnValueOnce(delayedList)
    await wrapper.find('select').setValue('30d')
    await wrapper.vm.$nextTick()
    const loadMore = wrapper.findAll('button').find(button => button.text() === 'battleDataAdmin.loadMore')
    expect(loadMore).toBeDefined()
    expect(loadMore!.attributes('disabled')).toBeDefined()
    await loadMore!.trigger('click'); await flushPromises()
    expect(state.battles).toHaveBeenCalledTimes(2)
    expect(state.battles).not.toHaveBeenCalledWith(expect.objectContaining({ cursor: 'old-cursor' }))
    finishSummary({ ...summary, totalBattles: 4242, windowBattles: 4242, maps: [{ key: 'malinovka', count: 4242, latestReceivedAt: summary.latestReceivedAt }] })
    finishList({ items: [{ ...battle, id: '2', arenaId: 'new-range', mapKey: 'malinovka', clientVersion: '11.19' }], nextCursor: null })
    await flushPromises()
    expect(wrapper.text()).toContain('new-range')
    expect(wrapper.text()).toContain('4242')
    expect(wrapper.text()).not.toContain('18446744073709551615')
    expect(state.battles).toHaveBeenCalledTimes(2)
    const summaryQuery = state.summary.mock.calls.at(-1)![0] as { from: string; to: string }
    const listQuery = state.battles.mock.calls.at(-1)![0] as { from: string; to: string }
    expect(listQuery.from).toBe(summaryQuery.from)
    expect(listQuery.to).toBe(summaryQuery.to)
    expect(wrapper.findAll('button').find(button => button.text() === 'battleDataAdmin.loadMore')).toBeUndefined()
    wrapper.unmount()
  })
  it('shows zero-count UTC days inside the selected window', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-29T00:00:00Z'))
    state.summary.mockResolvedValueOnce({ ...summary, daily: [{ key: '2026-10-27', count: 1 }] })
    const wrapper = page(); await flushPromises()
    expect(wrapper.text()).toContain('2026-10-28')
    wrapper.unmount(); now.mockRestore()
  })
  it('distinguishes an empty dataset and an empty filtered result', async () => {
    state.summary.mockResolvedValueOnce({ ...summary, totalBattles: 0, windowBattles: 0, maps: [], latestReceivedAt: null })
    state.battles.mockResolvedValueOnce({ items: [], nextCursor: null })
    const wrapper = page(); await flushPromises()
    expect(wrapper.text()).toContain('battleDataAdmin.empty')
    state.summary.mockResolvedValueOnce(summary)
    state.battles.mockResolvedValueOnce({ items: [], nextCursor: null })
    const filtered = page(); await flushPromises()
    expect(filtered.text()).toContain('battleDataAdmin.emptyFilter')
    wrapper.unmount(); filtered.unmount()
  })
  it('loads the next page with the opaque cursor', async () => {
    state.battles.mockResolvedValueOnce({ items: [battle], nextCursor: 'next-page' })
      .mockResolvedValueOnce({ items: [{ ...battle, id: '2', arenaId: '2' }], nextCursor: null })
    const wrapper = page(); await flushPromises()
    await wrapper.findAll('button').find(b => b.text() === 'battleDataAdmin.loadMore')!.trigger('click'); await flushPromises()
    expect(state.battles).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'next-page' }))
    expect(wrapper.find('[data-testid=recent-battles]').findAll('tbody tr')).toHaveLength(2)
    wrapper.unmount()
  })
  it('passes string ids to detail and flags abnormal vehicle rows', async () => {
    state.battles.mockResolvedValueOnce({ items: [{ ...battle, id: '9007199254740993' }], nextCursor: null })
    state.detail.mockResolvedValueOnce({ battle, vehicles: vehicles.slice(0, 13) })
    const wrapper = page(); await flushPromises()
    await wrapper.findAll('button').find(b => b.text() === 'battleDataAdmin.view')!.trigger('click'); await flushPromises()
    expect(state.detail).toHaveBeenCalledWith('9007199254740993')
    expect(wrapper.text()).toContain('battleDataAdmin.invalidRows')
    wrapper.unmount()
  })
  it('reports summary failure without clearing the loaded list', async () => {
    state.summary.mockRejectedValueOnce(new Error('boom'))
    const wrapper = page(); await flushPromises()
    expect(wrapper.text()).toContain('battleDataAdmin.error')
    expect(wrapper.text()).toContain('18446744073709551615')
    wrapper.unmount()
  })
  it('reports detail failure without clearing the existing list', async () => {
    state.detail.mockRejectedValueOnce(new Error('404'))
    const wrapper = page(); await flushPromises()
    await wrapper.findAll('button').find(b => b.text() === 'battleDataAdmin.view')!.trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('battleDataAdmin.detailError')
    expect(wrapper.text()).toContain('18446744073709551615')
    wrapper.unmount()
  })
  it('keeps loaded rows offline and blocks additional requests', async () => {
    const wrapper = page(); await flushPromises(); online.value = false; await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('18446744073709551615')
    expect(wrapper.find('[data-testid=battle-offline]').exists()).toBe(true)
    await wrapper.find('form').trigger('submit.prevent'); await flushPromises()
    expect(state.battles).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})
