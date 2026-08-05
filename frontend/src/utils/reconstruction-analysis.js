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
  'TOTAL_REQUEST_TOO_LARGE',
  'UNKNOWN_LOCALE'
])

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
