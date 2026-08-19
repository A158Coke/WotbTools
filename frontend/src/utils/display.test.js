import { describe, expect, it } from 'vitest'
import { apiCodeLabel, apiErrorLabel, enumLabel, replayValueLabel } from './display.js'

const values = {
  'boost.level.ELITE': 'Elite',
  'api_errors.NETWORK_ERROR': 'Network failed',
  'api_errors.PROFILE_NOT_FOUND': 'Profile missing',
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
})
