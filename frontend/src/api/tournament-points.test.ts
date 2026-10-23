import { describe, expect, it } from 'vitest'
import { validateTournament } from './tournament-points.js'
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
