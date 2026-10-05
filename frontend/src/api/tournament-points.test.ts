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
  })
  it('rejects malformed recognition ranks instead of silently treating them as positions', () => {
    expect(() => validateTournament('TournamentRecognitionResult', { groupNumber: 1, teams: [{ clanTag: 'REQM', rank: '1', rankText: '1' }], complete: true, issues: [], imageHash: 'a'.repeat(64) })).toThrow('INVALID_RESPONSE')
  })
})
