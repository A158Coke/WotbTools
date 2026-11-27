import { describe, expect, it } from 'vitest'
import { publishViewerClock, resetViewerClocks, viewerClocks } from './viewerClockSync.js'

describe('viewerClockSync', () => {
  it('发布完整状态：相对秒 / playing / ready / startRaw / speed', () => {
    resetViewerClocks()
    publishViewerClock('2d', 42.5, true, true, 30, 2)
    expect(viewerClocks['2d']).toEqual({ time: 42.5, playing: true, ready: true, startRaw: 30, speed: 2 })
    publishViewerClock('3d', 12.25, false, true, 30, 0.5)
    expect(viewerClocks['3d']).toEqual({ time: 12.25, playing: false, ready: true, startRaw: 30, speed: 0.5 })
  })

  it('非法值不覆盖上一个有效状态；reset 回到未就绪', () => {
    resetViewerClocks()
    publishViewerClock('2d', 42.5, true, true, 30, 2)
    publishViewerClock('2d', Number.NaN, true, true, 30, 2)
    expect(viewerClocks['2d'].time).toBe(42.5)
    publishViewerClock('2d', 43, true, true, Number.NaN, 2)
    expect(viewerClocks['2d'].time).toBe(42.5)
    resetViewerClocks()
    for (const slot of Object.values(viewerClocks)) {
      expect(slot).toEqual({ time: 0, playing: false, ready: false, startRaw: 0, speed: 1 })
    }
  })
})