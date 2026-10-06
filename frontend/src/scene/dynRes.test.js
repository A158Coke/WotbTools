// dynRes 纯状态机单测：降/升阈值、迟滞、冷却、窗口语义、边界钳制。
// 真实场景里的失效形态是"分辨率在阈值附近反复横跳"或"掉下去回不来"——
// 都由这里锁定。
import { describe, expect, it } from 'vitest'
import { createDynRes } from './dynRes.js'

/** 喂 n 帧恒定 dt，返回最后一次非空调整（无调整则 null） */
function feed(dyn, dtMs, n) {
  let last = null
  for (let i = 0; i < n; i++) last = dyn.frame(dtMs)
  return last
}

describe('dynRes 动态分辨率状态机', () => {
  const cfg = { ceilDpr: 1.5, floorDpr: 1, step: 0.25, downMs: 22, upMs: 13, windowN: 45, cooldownFrames: 60 }

  it('窗口未满不决策；持续超预算按步长下降，触底钳制', () => {
    const dyn = createDynRes(cfg)
    for (let i = 0; i < 44; i++) expect(dyn.frame(40)).toBeNull()   // 窗口未满
    expect(dyn.frame(40)).toBe(1.25)                                // 窗口满 → 第一次降
    for (let i = 0; i < 60; i++) dyn.frame(40)                      // 冷却期不动作
    expect(dyn.frame(40)).toBe(1)                                   // 再降 → 触底
    const atFloor = feed(dyn, 40, 200)                              // 已在地板：不再调整
    expect(atFloor).toBeNull()
    expect(dyn.dpr()).toBe(1)
  })

  it('有余量按步长回升到档位上限（ceil 钳制）', () => {
    const dyn = createDynRes(cfg)
    feed(dyn, 40, 400)            // 长期超预算 → 降到地板
    expect(dyn.dpr()).toBe(1)
    feed(dyn, 10, 1000)           // 长期有余量 → 两次回升回到 ceil
    expect(dyn.dpr()).toBe(1.5)
  })

  it('单帧尖峰不触发（滚动均值），冷却期采样但不调整（防阈值振荡）', () => {
    const dyn = createDynRes(cfg)
    for (let i = 0; i < 44; i++) dyn.frame(10)
    dyn.frame(200)                                                  // 一帧 200ms 尖峰混入
    expect(dyn.frame(10)).toBeNull()                                // 均值仍低 → 不动
    // 冷却语义：调整后的 60 帧内即使持续超预算也不降
    const dyn2 = createDynRes(cfg)
    for (let i = 0; i < 44; i++) dyn2.frame(40)
    expect(dyn2.frame(40)).toBe(1.25)
    for (let i = 0; i < 59; i++) expect(dyn2.frame(40)).toBeNull()
  })

  it('迟滞带（upMs ≤ 均值 ≤ downMs）内不动作', () => {
    const dyn = createDynRes(cfg)
    feed(dyn, 40, 3 * 45 + 3 * 60)                                  // 降到 1.0
    const last = feed(dyn, 17, 500)                                 // 17ms 在 (13, 22) 迟滞带内
    expect(last).toBeNull()
    expect(dyn.dpr()).toBe(1)
  })

  it('ceilDpr ≤ floorDpr 是装配期错误（应跳过装配而不是空转）', () => {
    expect(() => createDynRes({ ceilDpr: 1, floorDpr: 1 })).toThrow()
  })
})
