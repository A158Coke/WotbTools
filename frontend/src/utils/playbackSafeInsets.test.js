import { describe, expect, it } from 'vitest'
import { playbackSafeInsetOwnership } from './playbackSafeInsets.js'

describe('playbackSafeInsetOwnership', () => {
  it('reserves nothing outside fullscreen', () => {
    expect(playbackSafeInsetOwnership({
      isFullscreen: false,
      formFactor: 'mobile',
      sideSlots: false,
      controlsInRail: false,
    })).toEqual({ reserveTop: false, reserveBottom: false })
  })

  it.each(['pc', 'tablet'])('keeps the %s top HUD while side-slot controls stay out of the bottom inset', (formFactor) => {
    expect(playbackSafeInsetOwnership({
      isFullscreen: true,
      formFactor,
      sideSlots: true,
      controlsInRail: false,
    })).toEqual({ reserveTop: true, reserveBottom: false })
  })

  it('reserves the mobile fullscreen top HUD and bottom transient controller when rendered', () => {
    expect(playbackSafeInsetOwnership({
      isFullscreen: true,
      formFactor: 'mobile',
      sideSlots: false,
      controlsInRail: false,
    })).toEqual({ reserveTop: true, reserveBottom: true })
  })

  it('reserves a non-mobile bottom overlay only when controls are neither in rail nor side slots', () => {
    expect(playbackSafeInsetOwnership({
      isFullscreen: true,
      formFactor: 'tablet',
      sideSlots: false,
      controlsInRail: false,
    })).toEqual({ reserveTop: true, reserveBottom: true })
    expect(playbackSafeInsetOwnership({
      isFullscreen: true,
      formFactor: 'pc',
      sideSlots: false,
      controlsInRail: true,
    })).toEqual({ reserveTop: true, reserveBottom: false })
  })
})
