import { describe, it, expect } from 'vitest'
import { keyframeAt, sampleKeyframes, segmentAt, sampleChannel } from './trackInterp.js'

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
