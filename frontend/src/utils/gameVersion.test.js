import { describe, expect, it } from 'vitest'
import { formatGameVersion, parseGameVersion } from './gameVersion.js'

const labels = { apple: 'Apple', china: '中国服' }
const editionLabel = code => labels[code] || ''

describe('parseGameVersion', () => {
  it('splits the version number from the client edition', () => {
    expect(parseGameVersion('10.6.0_apple')).toEqual({ number: '10.6.0', edition: 'apple' })
    expect(parseGameVersion(' 11.20.0_CHINA ')).toEqual({ number: '11.20.0', edition: 'china' })
    expect(parseGameVersion('11.20.0.887')).toEqual({ number: '11.20.0.887', edition: '' })
  })

  it('returns null for empty values and keeps unknown formats verbatim', () => {
    expect(parseGameVersion('')).toBeNull()
    expect(parseGameVersion(null)).toBeNull()
    expect(parseGameVersion(undefined)).toBeNull()
    expect(parseGameVersion('beta build')).toEqual({ number: 'beta build', edition: '' })
  })
})

describe('formatGameVersion', () => {
  it('formats known editions through the provided labels', () => {
    expect(formatGameVersion('10.6.0_apple', editionLabel)).toBe('10.6.0 · Apple')
    expect(formatGameVersion('11.20.0_china', editionLabel)).toBe('11.20.0 · 中国服')
  })

  it('falls back to a readable code for editions without a label', () => {
    expect(formatGameVersion('12.0.0_eu', editionLabel)).toBe('12.0.0 · EU')
    expect(formatGameVersion('12.0.0_steam')).toBe('12.0.0 · Steam')
  })

  it('leaves plain versions untouched and returns an empty string for missing versions', () => {
    expect(formatGameVersion('11.18.0', editionLabel)).toBe('11.18.0')
    expect(formatGameVersion('', editionLabel)).toBe('')
    expect(formatGameVersion(null, editionLabel)).toBe('')
  })
})
