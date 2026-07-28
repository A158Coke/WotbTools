const TEAM_MODES = new Set(['SINGLE_TEAM_BATTLE', 'MULTI_TEAM_BATTLE'])
const MULTI_MODES = new Set(['MULTI_PLAYER_BATTLE', 'MULTI_TEAM_BATTLE'])

const LOCALIZED_ERROR_CODES = new Set([
  'AI_NOT_CONFIGURED',
  'AI_INVALID_REQUEST',
  'AI_AUTHENTICATION_ERROR',
  'AI_RATE_LIMITED',
  'AI_CONTEXT_TOO_LARGE',
  'AI_UPSTREAM_UNAVAILABLE',
  'AI_TIMEOUT',
  'AI_EMPTY_RESPONSE',
  'AI_RESPONSE_INVALID',
  'NO_BATTLE_DATA',
  'UNSUPPORTED_BATTLE_CATEGORY',
  'PERSPECTIVE_TEAM_UNRESOLVED',
  'PERSPECTIVE_TEAM_CONFLICT',
  'TEAM_ENTITY_MAPPING_INSUFFICIENT',
  'TEAM_FEATURES_UNAVAILABLE',
  'MIXED_ANALYSIS_SCOPES',
  'MIXED_RANDOM_BATTLE_RECORDERS',
  'NO_REPLAY_FILE',
  'NO_REPLAY_FILES',
  'INVALID_REPLAY_FILE_TYPE',
  'FILE_TOO_LARGE',
  'TOO_MANY_REPLAY_FILES',
  'REPLAY_FILE_COUNT_EXCEEDED',
  'TOTAL_REQUEST_TOO_LARGE'
])

const LOCALIZED_EVENT_TYPES = new Set([
  'TEAM_MEMBER_DESTROYED',
  'TEAM_FIRST_CONTACT',
  'TEAM_FORMATION_SPLIT',
  'BATTLE_END'
])

const LOCALIZED_LIMITATIONS = new Set([
  'RECORDER_ENTITY_UNMAPPED',
  'RECORDER_ENTITY_REENTRY',
  'RECORDER_MATCHED_BY_NICKNAME',
  'RECORDER_NICKNAME_AMBIGUOUS',
  'RECORDER_IDENTITY_CONFLICT',
  'TEAM_ENTITY_MAPPING_UNAVAILABLE',
  'TEAM_ENTITY_MAPPING_CONFLICT',
  'TEAM_ENTITY_MAPPING_INSUFFICIENT',
  'OBSERVED_DAMAGE_IS_PARTIAL',
  'AUTHORITATIVE_TEAM_RESULT_UNAVAILABLE',
  'POSITION_FORMATION_UNAVAILABLE',
  'TEAM_ENGAGEMENTS_UNAVAILABLE',
  'UNATTRIBUTED_DAMAGE_EVENTS_PRESENT',
  'UNATTRIBUTED_POSITION_EVENTS_PRESENT',
  'OUT_OF_BOUNDS_POSITION_EVENTS_IGNORED',
  'INVALID_EVENT_TIMESTAMPS_IGNORED',
  'REPLAY_STREAM_PARTIAL',
  'TEAM_FEATURES_UNAVAILABLE',
  'TEAM_MEMBER_ENTITY_UNMAPPED',
  'TEAM_MEMBER_MOVEMENT_UNAVAILABLE',
  'AI_INPUT_TRUNCATED',
  'PERSPECTIVE_TIMELINES_ISOLATED',
  'ROSTER_CONSISTENCY_UNCONFIRMED',
  'AI_PERSPECTIVE_OMITTED_FROM_PROMPT'
])

export function isTeamMode(mode) {
  return TEAM_MODES.has(mode)
}

export function isMultiMode(mode) {
  return MULTI_MODES.has(mode)
}

export function perspectiveTeams(result) {
  const teams = (result?.analyses || [])
    .map(unit => unit?.perspectiveTeam)
    .filter(team => Number.isInteger(team) && team > 0)
  return [...new Set(teams)].sort((left, right) => left - right)
}

export function analysisLimitations(result) {
  const limitations = [
    ...(Array.isArray(result?.limitations) ? result.limitations : []),
    ...(result?.analyses || [])
      .flatMap(unit => Array.isArray(unit?.report?.limitations)
        ? unit.report.limitations
        : [])
  ]
    .filter(value => typeof value === 'string' && value.length > 0)
  return [...new Set(limitations)]
}

export function localizeAiError(rawCode, status, t) {
  let code = ''
  let maxFiles = 16
  if (typeof rawCode === 'object' && rawCode !== null) {
    code = rawCode.code || ''
    maxFiles = rawCode.maxFiles || 16
  } else if (typeof rawCode === 'string') {
    code = rawCode.trim()
  }
  if (code === 'REPLAY_FILE_COUNT_EXCEEDED') {
    return t('recon.errors.REPLAY_FILE_COUNT_EXCEEDED', { max: maxFiles })
  }
  if (LOCALIZED_ERROR_CODES.has(code)) {
    return t(`recon.errors.${code}`)
  }
  return t('recon.ai_error_http', { status })
}

export function eventTypeLabel(type, t) {
  return LOCALIZED_EVENT_TYPES.has(type)
    ? t(`recon.event_types.${type}`)
    : type
}

export function localizeLimitation(code, t) {
  const omittedMatch = code.match(/^PERSPECTIVES_OMITTED_COUNT_(\d+)$/)
  if (omittedMatch) {
    return t('recon.limitations.PERSPECTIVES_OMITTED', { count: omittedMatch[1] })
  }
  return limitationLabel(code, t)
}

export function limitationLabel(code, t) {
  return LOCALIZED_LIMITATIONS.has(code)
    ? t(`recon.limitations.${code}`)
    : code
}
