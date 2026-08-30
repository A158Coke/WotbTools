import { describe, expect, it } from 'vitest'
import { apiCodeLabel, apiErrorLabel, enumLabel, formatDateTimeMinute, replayValueLabel } from './display.js'

const values = {
  'boost.level.ELITE': 'Elite',
  'api_errors.NETWORK_ERROR': 'Network failed',
  'api_errors.PROFILE_NOT_FOUND': 'Profile missing',
  'errors.auth_forbidden': 'Permission denied',
  'errors.internal_error': 'Server failed',
  'errors.unknown_error': 'Something went wrong',
  'errors.diagnostic_id': 'Diagnostic ID: {id}',
  'api_codes.BOOST_REQUEST_SUBMITTED': 'Submitted',
  'replay_values.HEAVY_TANK': 'Heavy tank'
}
const t = key => values[key] || key
const te = key => Object.hasOwn(values, key)

describe('display helpers', () => {
  it('localizes known enum values and preserves unknown API keys', () => {
    expect(enumLabel(t, te, 'level', 'ELITE')).toBe('Elite')
    expect(enumLabel(t, te, 'level', 'FUTURE_LEVEL')).toBe('FUTURE_LEVEL')
  })

  it('localizes stable replay values and preserves future values', () => {
    expect(replayValueLabel(t, te, 'HEAVY_TANK')).toBe('Heavy tank')
    expect(replayValueLabel(t, te, 'FUTURE_VALUE')).toBe('FUTURE_VALUE')
    expect(replayValueLabel(t, te, null)).toBe('--')
  })

  it('localizes API errors and success codes', () => {
    expect(apiErrorLabel(t, te, { code: 'PROFILE_NOT_FOUND' })).toBe('Profile missing')
    expect(apiErrorLabel(t, te, new TypeError('Failed to fetch'))).toBe('Network failed')
    expect(apiCodeLabel(t, te, 'BOOST_REQUEST_SUBMITTED', 'fallback')).toBe('Submitted')
  })

  it('maps errorCode to i18n and exposes the single diagnostic ID', () => {
    const translated = (key, params) => key === 'errors.diagnostic_id'
      ? `Diagnostic ID: ${params.id}`
      : t(key)
    expect(apiErrorLabel(translated, te, {
      errorCode: 'AUTH_FORBIDDEN', id: 'err-403'
    })).toBe('Permission denied · Diagnostic ID: err-403')
  })

  it('falls back to status category and never exposes an unknown raw code', () => {
    expect(apiErrorLabel(t, te, { code: 'FUTURE_SERVER_FAILURE', status: 500 }))
      .toBe('Server failed')
    expect(apiErrorLabel(t, te, { code: 'FUTURE_UNKNOWN_FAILURE' }))
      .toBe('Something went wrong')
  })

  it('formats local date-time to minutes and rejects invalid or pre-boundary values', () => {
    expect(formatDateTimeMinute('2024-01-02T03:04:00')).toBe('2024-01-02 03:04')
    expect(formatDateTimeMinute('invalid')).toBe('')
    expect(formatDateTimeMinute('2013-01-01T00:00:00', 2014)).toBe('')
  })
})
