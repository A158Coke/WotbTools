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
  'AI_REVIEW_GROUNDING_FAILED',
  'AI_TIMELINE_UNUSABLE',
  'AI_REVIEW_BUSY',
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
  'UNKNOWN_LOCALE',
  'DATASET_UNAVAILABLE',
  'DATASET_REFERENCE_REQUIRED',
  'JOB_NOT_FOUND',
  'SOURCE_NOT_FOUND',
  'SOURCE_NOT_READY',
  'SOURCE_PROCESSING_FAILED'
])

/** Dataset 生命周期可恢复错误码：job/dataset 引用层面的过期或缺失（≠ source 真失败或
 *  AI 模型问题）。前端可在仍持有原始 replay File 时丢弃过期引用并重新走 Direct Action
 *  dataset preparation，而不是把它当作最终用户错误。 */
export const RECOVERABLE_DATASET_CODES = new Set([
  'DATASET_UNAVAILABLE',
  'DATASET_REFERENCE_REQUIRED',
  'JOB_NOT_FOUND',
  'SOURCE_NOT_FOUND'
])

/** 判定某稳定错误码是否属于「数据集可恢复」类别（可由原 replay File 重新建立）。 */
export function isRecoverableDatasetCode(code) {
  return !!code && RECOVERABLE_DATASET_CODES.has(String(code))
}

export function localizeAiError(rawCode, status, t) {
  let code = ''
  let maxFiles = 1
  if (typeof rawCode === 'object' && rawCode !== null) {
    code = rawCode.code || ''
    maxFiles = rawCode.maxFiles || 1
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
