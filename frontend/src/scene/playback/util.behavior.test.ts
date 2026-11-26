import { describe, expect, it } from 'vitest'
import { mapLimit, ASSET_CONCURRENCY } from './util.js'
import { advancePlaybackTime } from '../../utils/playbackClock.js'

describe(':1160 资产加载有限并发', () => {
  it('mapLimit 在飞请求数 ≤ limit（=ASSET_CONCURRENCY 4），结果保序', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const items = Array.from({ length: 11 }, (_, i) => i)
    const out = await mapLimit(items, ASSET_CONCURRENCY, async (i) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, (i % 3) + 1))
      inFlight--
      return i * 2
    })
    expect(ASSET_CONCURRENCY).toBe(4)
    expect(maxInFlight).toBe(4)
    expect(maxInFlight).toBeGreaterThan(1)
    expect(out).toEqual(items.map((i) => i * 2))
    const single = await mapLimit([1], ASSET_CONCURRENCY, async () => 1)
    expect(single).toEqual([1])
  })
})

describe(':1077 播放时钟推进（纯函数）', () => {
  it('正常推进；NaN/负增量不污染；duration 钳制（END）生效', () => {
    expect(advancePlaybackTime(1, 60, 500, 2)).toBeCloseTo(2)
    expect(advancePlaybackTime(1, 60, NaN, 2)).toBe(1)
    expect(advancePlaybackTime(1, 60, -500, 2)).toBe(1)
    expect(advancePlaybackTime(1, 60, 500, NaN)).toBe(1)
    expect(advancePlaybackTime(59.5, 60, 2000, 1)).toBe(60)
    expect(advancePlaybackTime(60, 60, 500, 2)).toBe(60)
    expect(advancePlaybackTime(1, NaN, 500, 2)).toBe(0)
  })
})
