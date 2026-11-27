import { describe, expect, it } from 'vitest'
import { createDynRes } from './dynRes.ts'

function feed(dyn, dtMs, n) {
  let last = null
  for (let i = 0; i < n; i++) last = dyn.frame(dtMs)
  return last
}

describe('dynRes 动态分辨率状态机', () => {
  const cfg = { ceilDpr: 1.5, floorDpr: 1, step: 0.25, downMs: 22, upMs: 17, windowN: 45, cooldownFrames: 60 }

  it('窗口未满不决策；持续超预算按步长下降，触底钳制', () => {
    const dyn = createDynRes(cfg)
    for (let i = 0; i < 44; i++) expect(dyn.frame(40)).toBeNull()
    expect(dyn.frame(40)).toBe(1.25)
    for (let i = 0; i < 60; i++) dyn.frame(40)
    expect(dyn.frame(40)).toBe(1)
    const atFloor = feed(dyn, 40, 200)
    expect(atFloor).toBeNull()
    expect(dyn.dpr()).toBe(1)
  })

  it('有余量按步长回升到档位上限（ceil 钳制）', () => {
    const dyn = createDynRes(cfg)
    feed(dyn, 40, 400)
    expect(dyn.dpr()).toBe(1)
    feed(dyn, 10, 1000)
    expect(dyn.dpr()).toBe(1.5)
  })

  it('单帧尖峰不触发（滚动均值），冷却期采样但不调整（防阈值振荡）', () => {
    const dyn = createDynRes(cfg)
    for (let i = 0; i < 44; i++) dyn.frame(10)
    dyn.frame(200)
    expect(dyn.frame(10)).toBeNull()
    const dyn2 = createDynRes(cfg)
    for (let i = 0; i < 44; i++) dyn2.frame(40)
    expect(dyn2.frame(40)).toBe(1.25)
    for (let i = 0; i < 59; i++) expect(dyn2.frame(40)).toBeNull()
  })

  it('迟滞带（upMs ≤ 均值 ≤ downMs）内不动作', () => {
    const dyn = createDynRes(cfg)
    feed(dyn, 40, 3 * 45 + 3 * 60)
    const last = feed(dyn, 17, 500)
    expect(last).toBeNull()
    expect(dyn.dpr()).toBe(1)
  })

  it('60Hz VSync 帧间隔（16.67ms）下负载消退必须能恢复上限', () => {
    const dyn = createDynRes(cfg)
    feed(dyn, 40, 400)
    expect(dyn.dpr()).toBe(1)
    feed(dyn, 1000 / 60, 1000)
    expect(dyn.dpr()).toBe(1.5)
  })

  it('ceilDpr ≤ floorDpr 是装配期错误（应跳过装配而不是空转）', () => {
    expect(() => createDynRes({ ceilDpr: 1, floorDpr: 1 })).toThrow()
  })
})
