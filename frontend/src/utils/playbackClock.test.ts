import { expect, expectTypeOf, it } from 'vitest'
import type { PlaybackSpeed } from '../types/playback.js'
import { advancePlaybackTime, nextPlaybackSpeed } from './playbackClock.js'

it('keeps the playback speed contract closed over supported rates', () => {
  const speed: PlaybackSpeed = nextPlaybackSpeed(4)
  expect(speed).toBe(0.5)
  expectTypeOf(speed).toEqualTypeOf<PlaybackSpeed>()
})

it('advances in battle-relative seconds', () => {
  expect(advancePlaybackTime(10, 60, 500, 2)).toBe(11)
})
