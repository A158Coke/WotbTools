import { describe, expect, it } from 'vitest'
import { parseTournamentHistoricalFile } from './tournamentHistoricalImport.js'
import type { TournamentEvent } from '../api/tournament-points.js'

const event: TournamentEvent = { id: 7, version: 3, year: 2026, region: 'CN', season: 'SUMMER', roundCount: 4,
  daysPerRound: 2, dayLabels: ['小组赛', '决赛圈'], configLocked: false }
function source() {
  return { year: 2026, region: 'CN', season: 'SUMMER', roundCount: 4, daysPerRound: 2,
    sourceName: 'historical top 32', sourceSha256: 'a'.repeat(64),
    rows: [{ clanTag: '送葬者*', points: [10, null, 0, null, null, null, null, null], sourceTotal: 10 }] }
}
describe('historical import file boundary', () => {
  it('preserves null, explicit zero, punctuation and the selected event version', () => {
    const result = parseTournamentHistoricalFile(JSON.stringify(source()), event)
    expect(result.expectedEventVersion).toBe(3)
    expect(result.rows[0]).toEqual(source().rows[0])
  })
  it.each(['year', 'region', 'season', 'roundCount', 'daysPerRound'])('rejects another event identity at %s', key => {
    expect(() => parseTournamentHistoricalFile(JSON.stringify({ ...source(), [key]: 'different' }), event)).toThrow('historicalEventMismatch')
  })
  it('rejects wrong dimensions and numeric strings instead of filling or coercing cells', () => {
    const file = source()
    file.rows[0].points.push(null)
    expect(() => parseTournamentHistoricalFile(JSON.stringify(file), event)).toThrow('historicalInvalid')
    const numberString = source()
    ;(numberString.rows[0].points as unknown[])[0] = '10'
    expect(() => parseTournamentHistoricalFile(JSON.stringify(numberString), event)).toThrow('INVALID_RESPONSE')
  })
  it('rejects missing totals or malformed provenance before calling the server', () => {
    const file = source()
    file.sourceSha256 = 'unknown'
    expect(() => parseTournamentHistoricalFile(JSON.stringify(file), event)).toThrow('INVALID_RESPONSE')
    expect(() => parseTournamentHistoricalFile('[]', event)).toThrow('historicalInvalid')
    expect(() => parseTournamentHistoricalFile('{', event)).toThrow()
  })
})
