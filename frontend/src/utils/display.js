export function enumLabel(t, te, group, value, fallback = '--') {
  if (value == null || value === '') return fallback
  const key = `boost.${group}.${value}`
  return te(key) ? t(key) : String(value)
}

export function apiErrorLabel(t, te, error) {
  const code = error?.name === 'TypeError' && !error?.code
    ? 'NETWORK_ERROR'
    : (error?.code || error?.message || 'UNKNOWN_ERROR')
  const key = `api_errors.${code}`
  return te(key) ? t(key) : String(code)
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
