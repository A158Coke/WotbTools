import { validateTournament } from '../api/tournament-points.js'
import type { TournamentEvent, TournamentHistoricalPreviewRequest } from '../api/tournament-points.js'

/** Imported JSON carries an event identity; it must never silently target another season. */
export function parseTournamentHistoricalFile(text: string, event: TournamentEvent): TournamentHistoricalPreviewRequest {
  const file: unknown = JSON.parse(text)
  if (!file || typeof file !== 'object' || Array.isArray(file)) throw new SyntaxError('historicalInvalid')
  const value = file as Record<string, unknown>
  for (const key of ['year', 'region', 'season', 'roundCount', 'daysPerRound'] as const) {
    if (value[key] !== event[key]) throw new SyntaxError('historicalEventMismatch')
  }
  const request = validateTournament('TournamentHistoricalPreviewRequest', {
    expectedEventVersion: event.version,
    sourceName: value.sourceName,
    sourceSha256: value.sourceSha256,
    rows: value.rows,
  })
  if (request.rows.some(row => row.points.length !== event.roundCount * event.daysPerRound)) {
    throw new SyntaxError('historicalInvalid')
  }
  return request
}
