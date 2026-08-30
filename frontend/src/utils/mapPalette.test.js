import { describe, expect, it } from 'vitest'
import {
  LUMINANCE_THRESHOLD,
  darkMapPalette,
  lightMapPalette,
  paletteForLuminance
} from './mapPalette'

describe('mapPalette', () => {
  it('uses the dark palette below the threshold and the light palette at/above it', () => {
    expect(paletteForLuminance(LUMINANCE_THRESHOLD - 0.01)).toBe(darkMapPalette)
    expect(paletteForLuminance(LUMINANCE_THRESHOLD)).toBe(lightMapPalette)
    expect(paletteForLuminance(0.1)).toBe(darkMapPalette)
    expect(paletteForLuminance(0.8)).toBe(lightMapPalette)
  })

  it('falls back to the dark palette when luminance is unknown or invalid', () => {
    expect(paletteForLuminance(null)).toBe(darkMapPalette)
    expect(paletteForLuminance(undefined)).toBe(darkMapPalette)
    expect(paletteForLuminance(Number.NaN)).toBe(darkMapPalette)
    expect(paletteForLuminance(Number.POSITIVE_INFINITY)).toBe(darkMapPalette)
  })

  it('keeps warm/cool route separation and high-contrast grid on light maps', () => {
    expect(lightMapPalette.friendlyColors).toHaveLength(7)
    expect(lightMapPalette.enemyColors).toHaveLength(7)
    expect(lightMapPalette.regionStroke).toContain('0,0,0')
    expect(darkMapPalette.regionStroke).toContain('255,255,255')
  })

  it('exposes a clearly visible Battle Playback grid stroke (each column separated)', () => {
    expect(darkMapPalette.gridStrokeStrong).toContain('255,255,255')
    expect(lightMapPalette.gridStrokeStrong).toContain('0,0,0')
  })
})
