// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTournamentHistoricalState, validateTournament } from './tournament-points.js'

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
