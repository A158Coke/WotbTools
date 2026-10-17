// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearTournamentDefaultRules, getTournamentDefaultRules, getTournamentRuleSource, getTournamentHistoricalState, saveTournamentDefaultConfiguration, setTournamentDefaultRules, validateTournament } from './tournament-points.js'

vi.mock('../composables/useAuth.js', async importOriginal => ({
  ...await importOriginal<typeof import('../composables/useAuth.js')>(),
  useAuth: () => ({ authenticated: { value: true }, tokenParsed: { value: { realm_access: { roles: ['tournament-admin'] } } },
    authEpoch: () => 1, token: () => 'fixture-token', ensureToken: async () => true }),
}))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ requireFeature: () => true }) }))
afterEach(() => vi.unstubAllGlobals())
describe('historical capability rollout compatibility', () => {
  it('accepts the already-deployed day shape and keeps rejecting unnegotiated extra fields', () => {
    const event = { id: 1, version: 0, year: 2026, region: 'CN', season: 'SUMMER', roundCount: 5, daysPerRound: 2, dayLabels: ['Day 1', 'Day 2'], configLocked: false }
    const day = { eventId: 1, roundNumber: 1, dayNumber: 1, eventVersion: 0, rulesVersion: 0, version: 0,
      status: 'EMPTY', expectedGroupCount: null, groups: [], published: false, standings: { event, days: [], rows: [] } }
    expect(validateTournament('TournamentDayView', day)).toEqual(day)
    expect(() => validateTournament('TournamentDayView', { ...day, historical: true })).toThrow('INVALID_RESPONSE')
  })
  it('treats only the previous backend’s 404 as unsupported historical import', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    await expect(getTournamentHistoricalState(1, 1, 1)).resolves.toBeNull()
  })
  it.each([403, 500])('does not mask %i failures as a previous backend', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })))
    await expect(getTournamentHistoricalState(1, 1, 1)).rejects.toMatchObject({ status })
  })
  it('uses committed state even when no historical day contains scores', async () => {
    const state = { eventVersion: 1, imported: true, canImport: false, historical: false }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(state), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    await expect(getTournamentHistoricalState(1, 1, 1)).resolves.toEqual(state)
  })
})

describe('default rules capability rollout compatibility', () => {
  it('uses the two-segment route for every default operation so legacy event-id routes cannot intercept it', async () => {
    const state = { version: 7, active: false, sourceEventId: null, sourceLabel: '', updatedAt: null, rounds: [] }
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, options) => options?.method === 'HEAD'
      ? new Response(null, { status: 200, headers: { 'X-Tournament-Default-Rules': '1' } })
      : new Response(JSON.stringify(state), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    await expect(getTournamentDefaultRules()).resolves.toEqual(state)
    await expect(setTournamentDefaultRules({ eventId: 1, expectedEventVersion: 2, expectedDefaultVersion: 7, confirm: true })).resolves.toEqual(state)
    await expect(clearTournamentDefaultRules({ expectedDefaultVersion: 7, confirm: true })).resolves.toEqual(state)
    await expect(saveTournamentDefaultConfiguration({ expectedDefaultVersion: 7, confirm: true, rounds: [] })).resolves.toEqual(state)
    expect(fetch.mock.calls.map(([url, options]) => [url, options?.method ?? 'GET'])).toEqual([
      ['/api/admin/tournaments', 'HEAD'],
      ['/api/admin/tournaments/rules/default', 'GET'],
      ['/api/admin/tournaments/rules/default', 'PUT'],
      ['/api/admin/tournaments/rules/default', 'DELETE'],
      ['/api/admin/tournaments/rules/default/configuration', 'PUT'],
    ])
  })
  it.each([getTournamentDefaultRules, () => getTournamentRuleSource(1)])('does not call dedicated routes on a backend without the capability header', async get => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await expect(get()).resolves.toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]).toEqual(['/api/admin/tournaments', expect.objectContaining({ method: 'HEAD' })])
  })
  it.each([getTournamentDefaultRules, () => getTournamentRuleSource(1)])('disables only the missing dedicated endpoint', async get => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async (_url, options) => options?.method === 'HEAD'
      ? new Response(null, { status: 200, headers: { 'X-Tournament-Default-Rules': '1' } })
      : new Response('', { status: 404 })))
    await expect(get()).resolves.toBeNull()
    for (const status of [400, 403, 500]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })))
      await expect(get()).rejects.toMatchObject({ status })
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'X-Tournament-Default-Rules': '1' } })))
    await expect(get()).rejects.toMatchObject({ errorCode: 'INVALID_RESPONSE' })
  })
})
