// 战斗特效池与 busy 判定行为测试（#827 接替 sceneryMaterials.test.js 的
// :1107/:1180/:1240 源码守卫）：
// - 炮线/光迹条带走 battleFx 对象池（takeRibbon 按射击数借出、完成时归还、热路径零 dispose，
//   资源释放在会话结束 battleFx.dispose 一次性完成）；
// - 按需渲染 busy 判定 = battle.isActive() 真值表（tracers / fx 活跃 / transients 三来源）；
// - 炮线阵营色按射手阵营直出（绿=友 / 红=敌 / 白=未知），由 battleFx.setTracer 消费。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import * as THREE from 'three'
import { createBattleRuntime } from './battleRuntime.js'
import type { BattleRuntimeData, BattleRuntimeDeps } from './battleRuntime.js'
import type { TransientVehicle } from './transientFeedback3d.js'

const HP: Array<[number, number]> = [[0, 100], [28, 60]]
const DATA = {
  shots: [
    { t_fire: 1, shooter_eid: 7, target_eid: 9, game_hit_result: 3, flight_secs: 0.5, from: [10, 1, 10], to: [50, 1, 50] },
    { t_fire: 1, shooter_eid: 8, target_eid: 7, game_hit_result: 2, flight_secs: 0.5, from: [0, 1, 0], to: [40, 1, 40] },
  ],
  vehicles: [{ eid: 7, team: 1, hp: HP }, { eid: 8, team: 2, hp: HP }],
  meta: { friendly_team: 1 },
  kills: [],
} as unknown as BattleRuntimeData

function makeDeps() {
  const vehicle = {
    def: { eid: 7, max_hp: 100, hp: HP },
    group: { visible: true, position: { x: 0, y: 0, z: 0 }, rotation: { y: 0 } },
  } as unknown as TransientVehicle & Record<string, unknown>
  const deps: BattleRuntimeDeps = {
    getData: () => DATA,
    getT: () => 0,
    getScene: () => new THREE.Scene(),
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
    deathTimesOf: () => [],
    qualityFx: () => ({ capacity: 64 } as never),
    getLabelOverlay: () => ({ spawnDamage: vi.fn(), clearDamages: () => {} }),
    invalidateLabels: () => {},
  }
  return deps
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe(':1107 特效对象池（take/give，热路径不 dispose）', () => {
  it('每发射击从池借条带（tracer + trail）；完成/过期归还同一实例；热路径 geometry/material 零 dispose', () => {
    const deps = makeDeps()
    const handle = createBattleRuntime(deps)
    const fx = handle.ensureBattleFx()
    const takeSpy = vi.spyOn(fx, 'takeRibbon')
    const giveSpy = vi.spyOn(fx, 'giveRibbon')
    handle.advanceShotsTo(1)
    // 2 发直射弹：每发 1 tracer + 1 trail（折线无跳弹 = 1 段）
    expect(takeSpy.mock.calls.filter((c) => c[0] === 'tracer').length).toBe(2)
    expect(takeSpy.mock.calls.filter((c) => c[0] === 'trail').length).toBe(2)
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')
    const materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose')
    deps.getT = () => 1.25
    handle.updateTracers()   // 飞行中：写条带，不归还
    deps.getT = () => 1.7
    handle.updateTracers()   // 跨 t1：tracer 归还（trail 有停留期）
    expect(giveSpy).toHaveBeenCalled()
    // 热路径零 dispose（资源释放只在会话结束）
    expect(geometryDispose).not.toHaveBeenCalled()
    expect(materialDispose).not.toHaveBeenCalled()
    // 归还的 mesh 正是借出的池实例（对象池复用，不是 dispose 后新建）
    const borrowed = takeSpy.mock.results.map((r) => r.value)
    for (const call of giveSpy.mock.calls) expect(borrowed).toContain(call[0])
    geometryDispose.mockRestore()
    materialDispose.mockRestore()
    // 会话结束：battleFx.dispose 整体释放池（对象清单见 battleFx.test.js）
    handle.dispose()
  })
})

describe(':1180 dirty-frame busy 判定（battle.isActive）', () => {
  it('真值表：无战斗 = false；tracers 在飞 = true；fx 活跃 = true；全静 = false', () => {
    const deps = makeDeps()
    const handle = createBattleRuntime(deps)
    expect(handle.isActive()).toBe(false)   // 会话开始：无 tracer、fx 未创建、无 transient
    handle.advanceShotsTo(1)
    expect(handle.isActive()).toBe(true)    // 曳光在飞
    const fx = handle.ensureBattleFx()
    const activeSpy = vi.spyOn(fx, 'active')
    activeSpy.mockReturnValue(false)
    handle.clearEffects()                   // seek/teardown 路径：tracer/光迹全部归还
    expect(handle.isActive()).toBe(false)   // fx 不活跃 + 无 transient → 跳帧
    activeSpy.mockReturnValue(true)
    expect(handle.isActive()).toBe(true)    // fx 粒子批次活跃 → 继续重绘
    activeSpy.mockRestore()
    handle.dispose()
  })
})

describe(':1240 炮线阵营语义色（直出）', () => {
  it('setTracer 按射手阵营收色：友方亮绿 / 敌方亮红（命中结果不改色）', () => {
    const deps = makeDeps()
    const handle = createBattleRuntime(deps)
    handle.advanceShotsTo(1)
    const fx = handle.ensureBattleFx()
    const setSpy = vi.spyOn(fx, 'setTracer')
    deps.getT = () => 1.25   // 两发都在飞（t1 = 1.5）
    handle.updateTracers()
    expect(setSpy).toHaveBeenCalledTimes(2)
    const colors = setSpy.mock.calls.map((c) => c[3] as number)
    expect(colors).toContain(0x88ccff)   // 射手 eid 7（team 1 = 友）
    expect(colors).toContain(0xff8866)   // 射手 eid 8（team 2 = 敌）
    handle.dispose()
  })
})
