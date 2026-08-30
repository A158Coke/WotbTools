import { normalizeApiError } from './http.js'

export function enumLabel(t, te, group, value, fallback = '--') {
  if (value == null || value === '') return fallback
  const key = `boost.${group}.${value}`
  return te(key) ? t(key) : String(value)
}

export function apiErrorLabel(t, te, error) {
  const apiError = normalizeApiError(error)
  const statusFallback = {
    400: 'invalid_request', 401: 'auth_unauthenticated', 403: 'auth_forbidden',
    404: 'resource_not_found', 405: 'method_not_allowed', 413: 'upload_too_large',
    415: 'unsupported_media_type', 429: 'rate_limited', 500: 'internal_error',
    502: 'upstream_unavailable', 503: 'service_unavailable', 504: 'upstream_timeout',
  }[apiError.status]
  const keys = [
    apiError.messageKey,
    `errors.${apiError.code.toLowerCase()}`,
    `api_errors.${apiError.code}`,
    statusFallback && `errors.${statusFallback}`,
    'errors.unknown_error',
  ].filter(Boolean)
  const key = keys.find(candidate => te(candidate))
  const label = key ? t(key) : String(apiError.code)
  return apiError.traceId
    ? `${label} · ${t('errors.diagnostic_id', { traceId: apiError.traceId })}`
    : label
}

export function apiCodeLabel(t, te, code, fallbackKey) {
  if (code) {
    const key = `api_codes.${code}`
    if (te(key)) return t(key)
  }
  return fallbackKey ? t(fallbackKey) : (code || '')
}

export function replayValueLabel(t, te, value, fallback = '--') {
  if (value == null || value === '') return fallback
  const key = `replay_values.${value}`
  return te(key) ? t(key) : String(value)
}

/** 页面统一的本地分钟级时间格式；可选 minYear 用于过滤回放中的无效纪元时间。 */
export function formatDateTimeMinute(value, minYear = null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime()) || (minYear != null && date.getFullYear() < minYear)) return ''
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
