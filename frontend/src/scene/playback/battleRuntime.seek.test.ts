// Issue #827 Wave 1 Pilot — seek 游标语义行为测试（接替 seekPointer.test.js 的源码文本守卫）。
//
// 原守卫（PR #411 P0）：seekTo 必须把**三个**游标（射击/伤害/击毁）都重定到 seek 时刻之后，
// 且 clearEffects 清空 transient 状态——只重定 shotPtr 会在 tick() 补播全部历史事件。
// 原断言是 playbackScene.js / battleRuntime.ts / transientFeedback3d.ts 的源码文本切片；
// 本文件改为运行生产代码：battleRuntime handle（真实 createBattleRuntime + 真实
// transientFeedback3d）复刻宿主 seekTo 的三行编排，断言可观察行为：
//   1) clearEffects 后无任何未到期壁钟反馈（两张 Map 清空）；
//   2) seek 后 advanceTo 不补播历史伤害，只触发 seek 时刻之后的事件（不永久丢弃）。
// 射击游标消费条件（t_fire <= T）与击毁游标（firstIndexAfter 同式）由 seekPointer.test.js
// 的 firstIndexAfter 纯函数测试覆盖。façade seekTo 三行 glue 的接线归属 Integration
// Contract（宿主无注入点，见 seekPointer.test.js 保留的最小 glue 守卫与台账 F3 标注）。
import { describe, expect, it, vi } from 'vitest'
import { createBattleRuntime } from './battleRuntime.js'
import type { BattleRuntimeData, BattleRuntimeDeps } from './battleRuntime.js'
import { firstIndexAfter } from '../seekPointer.js'
import type { TransientVehicle } from './transientFeedback3d.js'

// 伤害事件：t=5 与 t=12（seek 前）、t=28（seek 后）。击毁：t=28。射击：t_fire 10/20/30。
const HP: Array<[number, number]> = [
  [0, 100],
  [5, 80],
  [9, 80],
  [12, 60],
  [25, 60],
  [28, 30],
]
const DATA = {
  shots: [{ t_fire: 10 }, { t_fire: 20 }, { t_fire: 30 }],
  vehicles: [{ eid: 7, team: 1, hp: HP }],
  meta: { friendly_team: 1 },
  kills: [{ t: 28 }],
} as unknown as BattleRuntimeData

function makeDeps() {
  const spawnDamage = vi.fn()
  const vehicle = {
    def: { eid: 7, max_hp: 100, hp: HP },
    group: { visible: true, position: { x: 0, y: 0, z: 0 }, rotation: { y: 0 } },
  } as unknown as TransientVehicle & Record<string, unknown>
  const deps: BattleRuntimeDeps = {
    getData: () => DATA,
    getT: () => 0,
    getScene: () => null,
    getCamera: () => ({} as never),
    getViewportHeight: () => 800,
    debug: false,
    getVehicles: () => [vehicle] as never,
    vehicles: {
      poseGlbRig: () => {},
      posAt: (_v, _t, out) => out,
      vehicleByEid: (eid) => (eid === 7 ? (vehicle as never) : undefined),
    },
    sceneLifeAt: () => null,
    colorUnknown: 0xffffff,
    tracerFriendly: 0x88ccff,
    tracerEnemy: 0xff8866,
    invalidate: () => {},
    deathTimesOf: () => [28],
    qualityFx: () => ({}) as never,
    getLabelOverlay: () => ({ spawnDamage, clearDamages: () => {} }),
    invalidateLabels: () => {},
  }
  return { deps, spawnDamage }
}

describe('battleRuntime seek 游标语义（行为测试，接替 seekPointer 源码文本守卫）', () => {
  it('seek 编排（clearEffects → resetShotsTo → transients.rewind）后不补播历史：壁钟反馈清空', () => {
    const { deps, spawnDamage } = makeDeps()
    const handle = createBattleRuntime(deps)
    handle.transients.rebuildSources()

    // seek 前推进到 t=9：t=5 的伤害已触发（幽灵段/受击闪活跃）
    handle.transients.advanceTo(9)
    expect(spawnDamage).toHaveBeenCalledTimes(1)
    expect(handle.transients.hasActive()).toBe(true)

    // 复刻 playbackScene.seekTo 的三行编排（T=25：跨过 5/12s 伤害，未到 28s 事件）
    const T = 25
    handle.clearEffects()
    handle.resetShotsTo(firstIndexAfter(DATA.shots, T, (s) => (s as { t_fire: number }).t_fire))
    handle.transients.rewind(T)

    // clearEffects：两张 Map 清空 → 无未到期反馈
    expect(handle.transients.hasActive()).toBe(false)
    expect(handle.transients.ghostOf(7)).toBeUndefined()
    expect(handle.transients.hasFlash(7)).toBe(false)

    // seek 后推进到 30：不补播 t≤25 的历史伤害（5s/12s 均不重放），
    // 只触发游标之后的事件（t=28，hpLoss=30）
    spawnDamage.mockClear()
    handle.transients.advanceTo(30)
    expect(spawnDamage).toHaveBeenCalledTimes(1)
    expect(spawnDamage.mock.calls[0][1]).toBe(30)
  })

  it('seek 之后的新事件仍然触发（游标重定 ≠ 永久丢弃）', () => {
    const { deps, spawnDamage } = makeDeps()
    const handle = createBattleRuntime(deps)
    handle.transients.rebuildSources()

    const T = 25
    handle.clearEffects()
    handle.resetShotsTo(firstIndexAfter(DATA.shots, T, (s) => (s as { t_fire: number }).t_fire))
    handle.transients.rewind(T)

    // t=28 的伤害与击毁在游标之后：推进即触发，恰好一次
    handle.transients.advanceTo(30)
    expect(spawnDamage).toHaveBeenCalledTimes(1)
    expect(handle.fxStats()?.bursts).toBe(1)
    // 重复推进不重放
    handle.transients.advanceTo(30)
    expect(spawnDamage).toHaveBeenCalledTimes(1)
    expect(handle.fxStats()?.bursts).toBe(1)
  })
})
