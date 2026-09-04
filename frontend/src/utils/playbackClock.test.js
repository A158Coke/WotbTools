import { describe, expect, it } from 'vitest'
import { advancePlaybackTime, clampPlaybackTime } from './playbackClock.js'

describe('playbackClock', () => {
  it('clamps seek values to the replay duration', () => {
    expect(clampPlaybackTime(-1, 30)).toBe(0)
    expect(clampPlaybackTime(45, 30)).toBe(30)
    expect(clampPlaybackTime(Number.NaN, 30)).toBe(0)
  })

  it('advances by wall-clock delta and playback speed', () => {
    expect(advancePlaybackTime(10, 60, 500, 2)).toBe(11)
    expect(advancePlaybackTime(59.9, 60, 500, 2)).toBe(60)
  })

  it('does not advance on invalid or negative deltas', () => {
    expect(advancePlaybackTime(10, 60, -500, 2)).toBe(10)
    expect(advancePlaybackTime(10, 60, Number.NaN, 2)).toBe(10)
  })

})
