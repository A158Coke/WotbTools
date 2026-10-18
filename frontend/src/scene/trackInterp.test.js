import { sampleDetachedPose } from './trackInterp.js'
import { describe, it, expect } from 'vitest'
import { coverageSpanAt, keyframeAt, sampleKeyframes, segmentAt, sampleChannel, sampleChannelWithin, spansContainAt, visibilitySpanForSampling } from './trackInterp.js'

describe('trackInterp：位姿关键帧折线（客户端渲染路径）', () => {
  it('keyframeAt：段定位与端点保持', () => {
    const t = [10, 10.2, 10.5, 11]
    expect(keyframeAt(10.1, t)).toEqual({ i: 0, f: 0.5 })
    expect(keyframeAt(10.2, t)).toEqual({ i: 1, f: 0 })       // 命中关键帧 = 右段起点
    const s = keyframeAt(10.9, t)
    expect(s.i).toBe(2)
    expect(s.f).toBeCloseTo(0.8, 12)
    // 端点外保持：早于首点 → 首段 f=0；晚于末点 → 末段 f=1
    expect(keyframeAt(0, t)).toEqual({ i: 0, f: 0 })
    expect(keyframeAt(99, t)).toEqual({ i: 2, f: 1 })
  })

  it('sampleKeyframes：段内线性、关键帧处取原值、端点保持', () => {
    const t = [10, 10.2, 10.5]
    const v = [0, 2, 5]
    const get = (i) => v[i]
    expect(sampleKeyframes(get, t, 10)).toBeCloseTo(0, 12)
    expect(sampleKeyframes(get, t, 10.2)).toBeCloseTo(2, 12)
    expect(sampleKeyframes(get, t, 10.1)).toBeCloseTo(1, 12)      // 中点 = 线性
    expect(sampleKeyframes(get, t, 10.35)).toBeCloseTo(3.5, 12)
    expect(sampleKeyframes(get, t, 5)).toBeCloseTo(0, 12)          // 端点保持
    expect(sampleKeyframes(get, t, 50)).toBeCloseTo(5, 12)
  })

  it('keep/jump 结构逐步复现：阶梯不会被抹成滑行', () => {
    // 客户端 12Hz 位置更新、每步 1.4m：保持 ~0.083s，然后在 1/60s 内跳完一步
    const t = [0, 0.0833, 0.0833 + 1 / 60, 0.1667, 0.1667 + 1 / 60, 0.25]
    const x = [0, 0, 1.4, 1.4, 2.8, 2.8]
    const at = (s) => sampleKeyframes((i) => x[i], t, s)
    expect(at(0.05)).toBeCloseTo(0, 9)          // 保持段内不动
    expect(at(0.09)).toBeGreaterThan(0)         // 跳变段内已开始移动
    expect(at(0.1)).toBeCloseTo(1.4, 3)         // 整步在 1/60s 内走完（不是平摊到 0.083s）
    expect(at(0.15)).toBeCloseTo(1.4, 9)        // 之后继续保持
    expect(at(0.25)).toBeCloseTo(2.8, 9)
    expect(at(0.5)).toBeCloseTo(2.8, 9)         // 末点保持
  })

  it('端点安全：空序列/单点/越界不抛错', () => {
    expect(sampleKeyframes(() => 0, [], 1)).toBe(0)
    expect(sampleKeyframes(() => 7, [5], 1)).toBe(7)
    expect(keyframeAt(1, [])).toEqual({ i: 0, f: 0 })
    expect(keyframeAt(1, [5])).toEqual({ i: 0, f: 0 })
  })
})

describe('trackInterp：10Hz 网格回退路径（旧 facet / 无关键帧通道）', () => {
  it('segmentAt：段内比例与边界钳位', () => {
    expect(segmentAt(0.25, 0, 0.1, 10)).toEqual({ i: 2, f: 0.5 })
    expect(segmentAt(-1, 0, 0.1, 10)).toEqual({ i: 0, f: 0 })
    expect(segmentAt(99, 0, 0.1, 10)).toEqual({ i: 8, f: 1 })   // n-2 = 8
  })

  it('sampleChannel：网格内线性、端点保持、越界不抛错', () => {
    const a = [0, 1, 2, 3]
    expect(sampleChannel((i) => a[i], a.length, 0.05, 0, 0.1)).toBeCloseTo(0.5, 12)
    expect(sampleChannel((i) => a[i], a.length, 0.25, 0, 0.1)).toBeCloseTo(2.5, 12)
    expect(sampleChannel((i) => a[i], a.length, -5, 0, 0.1)).toBeCloseTo(0, 12)
    expect(sampleChannel((i) => a[i], a.length, 99, 0, 0.1)).toBeCloseTo(3, 12)
    expect(sampleChannel(() => 5, 1, 10, 0, 0.1)).toBe(5)
    expect(sampleChannel(() => 5, 0, 10, 0, 0.1)).toBe(0)
  })
})


describe('sampleDetachedPose: recorded rigid bodies and AoI spans', () => {
  const track = {
    coverage: [10, 12, 20, 24],
    pose_kf: { t: [10, 11, 20, 21], pos: [1, 2, 3, 3, 4, 5, 100, 200, 300, 102, 202, 302],
      yaw: [0, 1, 2, 3], pitch: [0, 0.2, 0.4, 0.6], roll: [0, 0.4, 0.8, 1] },
  }
  it('mirrors position/yaw/roll once, keeps pitch and all recorded axes', () => {
    const out = {}
    expect(sampleDetachedPose(track, 10.5, out)).toBe(true)
    expect(out).toEqual({ x: -2, y: 3, z: 4, yaw: -0.5, pitch: 0.1, roll: -0.2 })
  })
  it('holds the last known pose in its span and never interpolates across missing coverage', () => {
    const out = {}
    expect(sampleDetachedPose(track, 12, out)).toBe(true)
    expect(out.x).toBe(-3)
    expect(sampleDetachedPose(track, 15, out)).toBe(false)
    expect(sampleDetachedPose(track, 19.999, out)).toBe(false)
    expect(sampleDetachedPose(track, 20, out)).toBe(true)
    expect(out.x).toBe(-100)
    expect(sampleDetachedPose(track, 24, out)).toBe(true)
    expect(out.x).toBe(-102)
    expect(sampleDetachedPose(track, 24.001, out)).toBe(false)
    expect(sampleDetachedPose(track, 9, out)).toBe(false)
  })
  it('supports a one-pose track and does not read a future first sample', () => {
    const single = { coverage: [9, 12], pose_kf: { t: [10], pos: [1, 2, 3], yaw: [0], pitch: [1], roll: [2] } }
    expect(sampleDetachedPose(single, 9.5, {})).toBe(false)
    const out = {}
    expect(sampleDetachedPose(single, 10, out)).toBe(true)
    expect(out).toEqual({ x: -1, y: 2, z: 3, yaw: -0, pitch: 1, roll: -2 })
    expect(sampleDetachedPose(single, 12, out)).toBe(true)
  })
})


describe('trackInterp：覆盖段内网格采样（禁止跨隐藏段插值）', () => {
  it('coverageSpanAt：闭区间命中、区间外 null、浮点容差', () => {
    const cov = [10, 12, 20, 24]
    expect(coverageSpanAt(cov, 10)).toEqual([10, 12])
    expect(coverageSpanAt(cov, 12)).toEqual([10, 12])
    expect(coverageSpanAt(cov, 13)).toBeNull()
    expect(coverageSpanAt(cov, 20.0000005)).toEqual([20, 24])
    // 末次可见段：buildPoseFacet 对缺省 t_out 写 +Infinity，必须仍是有效段
    expect(coverageSpanAt([0.85, Number.POSITIVE_INFINITY], 0.86)).toEqual([0.85, Number.POSITIVE_INFINITY])
    expect(coverageSpanAt([], 1)).toBeNull()
    expect(coverageSpanAt(null, 1)).toBeNull()
  })

  it('sampleChannelWithin：只在段内网格点之间插值，段首保持第一个段内点', () => {
    const a = [0, 1, 2, 3, 4, 5, 6]
    const get = (i) => a[i]
    // 网格 t0=0, dt=0.1；覆盖 [0.05, 0.25]：段内点 = 0.1/0.2
    expect(sampleChannelWithin(get, a.length, 0.05, 0, 0.1, 0.05, 0.25)).toBeCloseTo(1, 12)
    expect(sampleChannelWithin(get, a.length, 0.15, 0, 0.1, 0.05, 0.25)).toBeCloseTo(1.5, 12)
    expect(sampleChannelWithin(get, a.length, 0.25, 0, 0.1, 0.05, 0.25)).toBeCloseTo(2, 12)
    // 段短于一个网格间隔：取段末之前的最近证据（不得取段后下一点，防下一段角度泄漏）
    expect(sampleChannelWithin(get, a.length, 0.05, 0, 0.1, 0.05, 0.08)).toBeCloseTo(0, 12)
    // 开放的末段（+Infinity）从段内第一个点起正常插值
    expect(sampleChannelWithin(get, a.length, 0.25, 0, 0.1, 0.05, Number.POSITIVE_INFINITY)).toBeCloseTo(2.5, 12)
    // 空/单点安全
    expect(sampleChannelWithin(() => 7, 1, 0.05, 0, 0.1, 0.05, 0.08)).toBe(7)
    expect(sampleChannelWithin(() => 7, 0, 0.05, 0, 0.1, 0.05, 0.08)).toBe(0)
  })
})


describe('trackInterp：可见段采样/显隐（短隐藏段保持最后已知）', () => {
  const spans = [42, 42.75, 42.85, 43]
  it('spansContainAt：段外（含短隐藏段）为 false', () => {
    expect(spansContainAt(spans, 42.75)).toBe(true)
    expect(spansContainAt(spans, 42.8)).toBe(false)
    expect(spansContainAt(spans, 42.85)).toBe(true)
    expect(spansContainAt(spans, 41)).toBe(false)
  })
  it('visibilitySpanForSampling：隐藏段夹到前一段，段前取首段、段后取末段', () => {
    expect(visibilitySpanForSampling(spans, 42.8)).toEqual([42, 42.75])
    expect(visibilitySpanForSampling(spans, 41)).toEqual([42, 42.75])
    expect(visibilitySpanForSampling(spans, 44)).toEqual([42.85, 43])
    expect(visibilitySpanForSampling([0.85, Number.POSITIVE_INFINITY], 0.9)).toEqual([0.85, Number.POSITIVE_INFINITY])
  })
})
