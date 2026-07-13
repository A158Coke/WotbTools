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
