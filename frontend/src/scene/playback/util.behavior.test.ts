// 共享并发/时钟工具行为测试（#827 接替 sceneryMaterials.test.js 的 :1160/:1077 源码守卫）：
// - mapLimit 有限并发（结果保序）：在飞请求数从不超上限（资产下载/解析共用）；
// - advancePlaybackTime 纯函数：NaN/负增量不污染时钟、END 钳制仍生效。
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
      await new Promise((r) => setTimeout(r, (i % 3) + 1))   // 不均匀时长
      inFlight--
      return i * 2
    })
    expect(maxInFlight).toBeLessThanOrEqual(ASSET_CONCURRENCY)
    expect(maxInFlight).toBeGreaterThan(1)   // 确实并发（非串行）
    expect(out).toEqual(items.map((i) => i * 2))   // 结果顺序 = 输入顺序（资产键序语义）
    // 少于 limit 的清单不空转（workers = min(limit, items)）
    const single = await mapLimit([1], ASSET_CONCURRENCY, async () => 1)
    expect(single).toEqual([1])
  })
})

describe(':1077 播放时钟推进（纯函数）', () => {
  it('正常推进；NaN/负增量不污染；duration 钳制（END）生效', () => {
    expect(advancePlaybackTime(1, 60, 500, 2)).toBeCloseTo(2)      // +0.5s ×2
    // NaN 增量：时钟不动（不污染 T）
    expect(advancePlaybackTime(1, 60, NaN, 2)).toBe(1)
    // 负增量：同样不回退
    expect(advancePlaybackTime(1, 60, -500, 2)).toBe(1)
    // 非 finite 速度：不前进
    expect(advancePlaybackTime(1, 60, 500, NaN)).toBe(1)
    // END 钳制：到达/越过终点停在 duration
    expect(advancePlaybackTime(59.5, 60, 2000, 1)).toBe(60)
    expect(advancePlaybackTime(60, 60, 500, 2)).toBe(60)
    // duration 无效（NaN）：按 0 处理（时钟钳到 0）
    expect(advancePlaybackTime(1, NaN, 500, 2)).toBe(0)
  })
})
