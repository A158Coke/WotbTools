import { describe, expect, it } from 'vitest'
import { formatGameVersion } from './gameVersion.js'

describe('formatGameVersion', () => {
  it('strips platform / distribution suffixes and keeps only the game version', () => {
    expect(formatGameVersion('10.6.0_apple')).toBe('10.6.0')
    expect(formatGameVersion('11.20.0_china')).toBe('11.20.0')
    expect(formatGameVersion('12.0.0_eu')).toBe('12.0.0')
    expect(formatGameVersion(' 11.20.0_CHINA ')).toBe('11.20.0')
  })

  it('keeps plain versions untouched', () => {
    expect(formatGameVersion('11.18.0')).toBe('11.18.0')
    expect(formatGameVersion('11.20.0.887')).toBe('11.20.0.887')
  })

  it('keeps unknown formats verbatim and returns empty for missing values', () => {
    expect(formatGameVersion('beta build')).toBe('beta build')
    expect(formatGameVersion('')).toBe('')
    expect(formatGameVersion(null)).toBe('')
  })
})
