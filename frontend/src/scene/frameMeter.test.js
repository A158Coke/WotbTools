import { describe, expect, it } from 'vitest'
import { createFrameMeter } from './frameMeter.js'

const step = (meter, times) => times.map((t) => meter.sample(t))

describe('createFrameMeter 实时帧率窗口（只统计渲染帧）', () => {
  it('60fps：500ms 窗口返回 ≈60 FPS / 16.7ms 平均与峰值', () => {
    const m = createFrameMeter({ windowMs: 500 })
    const times = [0]
    for (let i = 1; i <= 30; i++) times.push(i * 16.67)
    const out = step(m, times)
    const last = out[out.length - 1]
    expect(last).not.toBeNull()
    expect(last.fps).toBeGreaterThan(59)
    expect(last.fps).toBeLessThan(61)
    expect(last.frameMs).toBeGreaterThan(15.5)
    expect(last.frameMs).toBeLessThan(17.5)
    expect(last.peakMs).toBeLessThan(17.5)
  })

  it('窗口未满返回 null；窗口内长帧抬高峰值', () => {
    const m = createFrameMeter({ windowMs: 300, maxGapMs: 400 })
    expect(m.sample(0)).toBeNull()
    expect(m.sample(16)).toBeNull()
    expect(m.sample(32)).toBeNull()
    expect(m.sample(300)).toEqual({ fps: 10, frameMs: 100, peakMs: 268 })
  })

  it('空闲断层：间隔 > maxGapMs 重新起窗，不把空闲算成掉帧', () => {
    const m = createFrameMeter({ windowMs: 100, maxGapMs: 200 })
    step(m, [0, 10, 20, 30])
    expect(m.sample(100)).toEqual({ fps: 40, frameMs: 25, peakMs: 70 })
    expect(m.sample(400)).toBeNull()      // 300ms 空闲断层 → 新窗口
    expect(m.peakMs).toBe(0)
    for (let t = 410; t < 500; t += 10) expect(m.sample(t)).toBeNull()
    expect(m.sample(500)).toEqual({ fps: 100, frameMs: 10, peakMs: 10 })
  })

  it('reset 后重新起窗；新窗口只统计新帧', () => {
    const m = createFrameMeter({ windowMs: 100 })
    step(m, [0, 10, 20, 30])
    expect(m.sample(100)).toEqual({ fps: 40, frameMs: 25, peakMs: 70 })
    m.reset()
    expect(m.fps).toBe(0)
    expect(m.sample(200)).toBeNull()
    expect(m.sample(250)).toBeNull()
    expect(m.sample(300)).toEqual({ fps: 20, frameMs: 50, peakMs: 50 })
  })
})
