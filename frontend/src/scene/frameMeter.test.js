import { describe, expect, it } from 'vitest'
import { createFrameMeter } from './frameMeter.js'

const step = (meter, times) => times.map((t) => meter.sample(t))

describe('createFrameMeter 实时帧率窗口', () => {
  it('60fps：500ms 窗口返回 ≈60 FPS / 16.7ms', () => {
    const m = createFrameMeter({ windowMs: 500 })
    const out = step(m, [0, 16.67, 33.33, 50, 66.67, 83.33, 100, 116.67, 133.33, 150, 166.67, 183.33, 200, 216.67, 233.33, 250, 266.67, 283.33, 300, 316.67, 333.33, 350, 366.67, 383.33, 400, 416.67, 433.33, 450, 466.67, 483.33, 500])
    const last = out[out.length - 1]
    expect(last).not.toBeNull()
    expect(last.fps).toBeGreaterThan(59)
    expect(last.fps).toBeLessThan(61)
    expect(last.frameMs).toBeGreaterThan(15.5)
    expect(last.frameMs).toBeLessThan(17.5)
  })

  it('窗口未满返回 null；一次长停顿拉低窗口帧率', () => {
    const m = createFrameMeter({ windowMs: 500 })
    expect(m.sample(0)).toBeNull()        // 起窗（now=0 是合法时间戳）
    expect(m.sample(100)).toBeNull()      // 100ms < 500
    // 窗口 0→500ms 共 2 帧 ⇒ 4 FPS / 250ms
    expect(m.sample(500)).toEqual({ fps: 4, frameMs: 250 })
  })

  it('reset 后重新起窗；新窗口只统计新帧', () => {
    const m = createFrameMeter({ windowMs: 100 })
    step(m, [0, 10, 20, 30])
    expect(m.sample(100)).toEqual({ fps: 40, frameMs: 25 })
    m.reset()
    expect(m.fps).toBe(0)
    expect(m.sample(200)).toBeNull()
    expect(m.sample(250)).toBeNull()
    expect(m.sample(300)).toEqual({ fps: 20, frameMs: 50 })
  })
})
