import { expect, it } from 'vitest'
import { advancePlaybackTime } from './playbackClock.js'

it('advances in battle-relative seconds', () => {
  expect(advancePlaybackTime(10, 60, 500, 2)).toBe(11)
})
