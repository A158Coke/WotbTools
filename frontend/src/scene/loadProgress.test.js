import { describe, expect, it, vi } from 'vitest'
import { createLoadProgress, progressPercent } from './loadProgress.js'

describe('createLoadProgress', () => {
  it('没有登记任何项时进度未知', () => {
    expect(createLoadProgress().snapshot()).toEqual({ fraction: null, done: 0, total: 0 })
  })

  it('按字节进度平均各项，完成后计满', () => {
    const onChange = vi.fn()
    const progress = createLoadProgress(onChange)
    progress.expect('armor')
    progress.expect('visual')
    progress.update('armor', 50, 100)
    expect(progress.snapshot()).toEqual({ fraction: 0.25, done: 0, total: 2 })
    progress.complete('armor')
    progress.update('visual', 30, 0)   // 长度未知：完成前不推进
    expect(progress.snapshot().fraction).toBe(0.5)
    progress.complete('visual')
    expect(progress.snapshot()).toEqual({ fraction: 1, done: 2, total: 2 })
    expect(onChange).toHaveBeenLastCalledWith({ fraction: 1, done: 2, total: 2 })
  })

  it('后登记的项不会让进度倒退；reset 后重新开始', () => {
    const progress = createLoadProgress()
    progress.expect('a')
    progress.complete('a')
    progress.expect('b')
    expect(progress.snapshot().fraction).toBe(1)
    progress.reset()
    expect(progress.snapshot().fraction).toBeNull()
    progress.expect('c')
    expect(progress.snapshot().fraction).toBe(0)
  })

  it('字节进度超出 total 时封顶', () => {
    const progress = createLoadProgress()
    progress.expect('a')
    progress.update('a', 500, 100)
    expect(progress.snapshot().fraction).toBe(1)
  })

  it('忽略未登记项的 update / complete，不虚构总工作量', () => {
    const progress = createLoadProgress()
    progress.expect('scenery')
    progress.update('map', 50, 100)
    progress.complete('terrain')
    expect(progress.snapshot()).toEqual({ fraction: 0, done: 0, total: 1 })
    progress.complete('scenery')
    expect(progress.snapshot()).toEqual({ fraction: 1, done: 1, total: 1 })
  })
})

describe('progressPercent', () => {
  it('转为 0–100 整数，未知保持 null', () => {
    expect(progressPercent(null)).toBeNull()
    expect(progressPercent(Number.NaN)).toBeNull()
    expect(progressPercent(0.256)).toBe(26)
    expect(progressPercent(2)).toBe(100)
    expect(progressPercent(-1)).toBe(0)
  })
})
