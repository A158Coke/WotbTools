// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
const state = vi.hoisted(() => ({ fetch: vi.fn(), auth: null as any }))
vi.mock('../utils/http.js', async original => ({ ...await original<object>(), apiFetch: state.fetch }))
vi.mock('../composables/useAuth.js', async original => ({ ...await original<object>(), useAuth: () => state.auth }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ requireFeature: () => true }) }))
import { getTournamentAudit, getTournamentStandings, listTournamentEvents, validateTournament } from './tournament-points.js'
describe('tournament runtime transport contract', () => {
  const event = { id: 1, version: 0, year: 2026, region: 'CN', season: 'SPRING', roundCount: 5, daysPerRound: 2, dayLabels: ['Day 1', 'Day 2'], configLocked: false }
  it('accepts the canonical public shape without administrator evidence fields', () => {
    expect(validateTournament('TournamentStandings', { event, days: [], rows: [] }).event.id).toBe(1)
  })
  it('rejects a legacy/localized region and any private material attached to the public standings', () => {
    expect(() => validateTournament('TournamentEvent', { ...event, region: 'asia' })).toThrow('INVALID_RESPONSE')
    expect(() => validateTournament('TournamentStandings', { event, days: [], rows: [], screenshots: [] })).toThrow('INVALID_RESPONSE')
    expect(() => validateTournament('TournamentStandings', { event, days: [], rows: [], canonicalStandings: { event, days: [], rows: [] } })).toThrow('INVALID_RESPONSE')
  })
  it('keeps canonical pre-clear facts optional and restricted to the authenticated day response', () => {
    const standings = { event, days: [], rows: [] }
    const day = { eventId: 1, roundNumber: 1, dayNumber: 1, eventVersion: 0, rulesVersion: 0, version: 0,
      status: 'EMPTY', expectedGroupCount: null, groups: [], published: false, standings }
    expect(validateTournament('TournamentDayView', day).standings).toEqual(standings)
    expect(validateTournament('TournamentDayView', { ...day, canonicalStandings: standings }).canonicalStandings).toEqual(standings)
  })
  it('rejects malformed recognition ranks instead of silently treating them as positions', () => {
    expect(() => validateTournament('TournamentRecognitionResult', { groupNumber: 1, teams: [{ clanTag: 'REQM', rank: '1', rankText: '1' }], complete: true, issues: [], imageHash: 'a'.repeat(64) })).toThrow('INVALID_RESPONSE')
  })
})

beforeEach(() => {
  vi.clearAllMocks(); state.fetch.mockReset()
  state.auth = { authenticated: ref(true), tokenParsed: ref({ realm_access: { roles: ['tournament-admin'] } }), authEpoch: () => 1,
    ensureToken: vi.fn(async () => true), token: () => 'access-token' }
})

describe('tournament-points JSON decode failures', () => {
  const reads = [['json', (signal?: AbortSignal) => getTournamentStandings(1, signal)], ['event list', (signal?: AbortSignal) => listTournamentEvents(false, signal)], ['audit list', (signal?: AbortSignal) => getTournamentAudit(1, signal)]] as const
  it.each(reads)('normalizes malformed %s JSON without exposing the body', async (_, read) => {
    state.fetch.mockResolvedValueOnce(new Response('{private malformed body'))
    await expect(read()).rejects.toMatchObject({ name: 'ApiError', errorCode: 'INVALID_RESPONSE', retryable: false, errorMsg: null, details: {} })
  })
  it.each(reads)('preserves %s body cancellation and transport failures', async (_, read) => {
    const signal = new AbortController().signal
    for (const error of [new DOMException('aborted', 'AbortError'), new TypeError('body stream failed')]) {
      const response = new Response()
      vi.spyOn(response, 'json').mockRejectedValueOnce(error)
      state.fetch.mockResolvedValueOnce(response)
      await expect(read(signal)).rejects.toBe(error)
      expect(state.fetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ signal }))
    }
  })
})

describe('tournament valid response decoding', () => {
  it('keeps canonical standings and empty event/audit lists', async () => {
    const event = { id: 1, version: 0, year: 2026, region: 'CN', season: 'SPRING', roundCount: 5, daysPerRound: 2, dayLabels: ['Day 1', 'Day 2'], configLocked: false }
    const standings = { event, days: [], rows: [] }
    state.fetch.mockResolvedValueOnce(new Response(JSON.stringify(standings)))
    await expect(getTournamentStandings(1)).resolves.toEqual(standings)
    state.fetch.mockResolvedValueOnce(new Response('[]'))
    await expect(listTournamentEvents()).resolves.toEqual([])
    state.fetch.mockResolvedValueOnce(new Response('[]'))
    await expect(getTournamentAudit(1)).resolves.toEqual([])
  })
})
