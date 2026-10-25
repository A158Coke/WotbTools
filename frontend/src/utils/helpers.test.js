import { afterEach, describe, expect, it, vi } from 'vitest'
import { mapLabel } from './helpers.js'

describe('mapLabel locale selection', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the explicit locale and a pure Chinese fallback when omitted', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'ru' })
    expect(mapLabel('canal', 'en')).toBe('Canal')
    expect(mapLabel('canal')).toBe('运河尽头')
  })
})
