import { describe, expect, it, vi } from 'vitest'
import {
  analysisLimitations,
  eventTypeLabel,
  isMultiMode,
  isTeamMode,
  limitationLabel,
  localizeAiError,
  perspectiveTeams
} from './reconstruction-analysis.js'

const t = vi.fn((key, values) => values ? `${key}:${values.status}` : key)

describe('reconstruction analysis presentation', () => {
  it('recognizes single and multi team modes without changing player modes', () => {
    expect(isTeamMode('SINGLE_TEAM_BATTLE')).toBe(true)
    expect(isTeamMode('MULTI_TEAM_BATTLE')).toBe(true)
    expect(isTeamMode('SINGLE_PLAYER_BATTLE')).toBe(false)
    expect(isMultiMode('MULTI_TEAM_BATTLE')).toBe(true)
    expect(isMultiMode('SINGLE_TEAM_BATTLE')).toBe(false)
  })

  it('keeps perspectives and limitations deterministic', () => {
    const result = {
      analyses: [
        { perspectiveTeam: 2, report: { limitations: ['REPLAY_STREAM_PARTIAL'] } },
        { perspectiveTeam: 1, report: { limitations: ['REPLAY_STREAM_PARTIAL', 'AI_INPUT_TRUNCATED'] } }
      ]
    }
    expect(perspectiveTeams(result)).toEqual([1, 2])
    expect(analysisLimitations(result)).toEqual([
      'REPLAY_STREAM_PARTIAL',
      'AI_INPUT_TRUNCATED'
    ])
  })

  it('localizes stable error codes and hides unknown backend text', () => {
    expect(localizeAiError('AI_RATE_LIMITED', 502, t))
      .toBe('recon.errors.AI_RATE_LIMITED')
    expect(localizeAiError('NO_REPLAY_FILE', 400, t))
      .toBe('recon.errors.NO_REPLAY_FILE')
    expect(localizeAiError('INVALID_REPLAY_FILE_TYPE', 400, t))
      .toBe('recon.errors.INVALID_REPLAY_FILE_TYPE')
    expect(localizeAiError('FILE_TOO_LARGE', 400, t))
      .toBe('recon.errors.FILE_TOO_LARGE')
    expect(localizeAiError('java.lang.IllegalStateException', 500, t))
      .toBe('recon.ai_error_http:500')
  })

  it('localizes team event types and preserves unknown codes', () => {
    expect(eventTypeLabel('TEAM_FIRST_CONTACT', t))
      .toBe('recon.event_types.TEAM_FIRST_CONTACT')
    expect(eventTypeLabel('CUSTOM_EVENT', t)).toBe('CUSTOM_EVENT')
    expect(limitationLabel('REPLAY_STREAM_PARTIAL', t))
      .toBe('recon.limitations.REPLAY_STREAM_PARTIAL')
    expect(limitationLabel('RECORDER_NICKNAME_AMBIGUOUS', t))
      .toBe('recon.limitations.RECORDER_NICKNAME_AMBIGUOUS')
    expect(limitationLabel('OUT_OF_BOUNDS_POSITION_EVENTS_IGNORED', t))
      .toBe('recon.limitations.OUT_OF_BOUNDS_POSITION_EVENTS_IGNORED')
    expect(limitationLabel('CUSTOM_LIMIT', t)).toBe('CUSTOM_LIMIT')
  })
})
