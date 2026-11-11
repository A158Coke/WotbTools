// @vitest-environment happy-dom
// 弹道折线生命周期 + perf 看门狗行为测试（#827 接替 playbackScene.occlusion.test.js
// 的 :46/:53/:63/:110）：
// - 折线点表镜像 x（游戏系 → 场景系）：炮口/弹着点/跳弹出射全部取镜像后的 pts3；
// - tracer 完成门 = T >= t1：命中特效在抵达点时刻生成恰好一次；t1 到点归还 ribbon；
//   重复推进不重放；?perf 看门狗 50ms 心跳抓主线程停顿、destroy/stop 清理 interval。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import * as THREE from 'three'
import { createBattleRuntime } from './battleRuntime.js'
import type { BattleRuntimeData, BattleRuntimeDeps } from './battleRuntime.js'
import type { TransientVehicle } from './transientFeedback3d.js'

const HP: Array<[number, number]> = [[0, 100], [28, 60]]
const DATA = {
  shots: [
    // 直射弹：from → to（t_fire=1，飞行 0.5s → t1 = 1.5）
    { t_fire: 1, shooter_eid: 7, target_eid: 8, game_hit_result: 3, flight_secs: 0.5, from: [10, 1, 10], to: [50, 1, 50] },
    // 跳弹折线：from → via → to（leg_secs 与 via 成组消费）
    { t_fire: 1, shooter_eid: 7, target_eid: 9, hit_flags: 0x0008, is_author: true, flight_secs: 0.6, leg_secs: [0.2, 0.4], from: [0, 1, 0], via: [[30, 1, 30]], to: [60, 1, 60] },
  ],
  vehicles: [{ eid: 7, team: 1, hp: HP }],
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

describe('tracer 折线生命周期（行为）', () => {
  it('折线点表镜像 x：弹着点/出射方向取镜像后的 pts3（直射 = 终点、跳弹 = via[0]）', () => {
    const deps = makeDeps()
    const handle = createBattleRuntime(deps)
    handle.advanceShotsTo(1)
    const fx = handle.ensureBattleFx()
    const spawnSpy = vi.spyOn(fx, 'spawnImpact')
    // T=1.25：跳弹已过抵达时刻（legEnds[0] = 1.2）；直射 1.5 未到
    deps.getT = () => 1.25
    handle.updateTracers()
    expect(spawnSpy).toHaveBeenCalledTimes(1)
    // 跳弹弹着点 = 镜像后的 via[0]（不是原始坐标也不是服务器终点）
    const ricoPos = spawnSpy.mock.calls[0][1] as THREE.Vector3
    expect(ricoPos.x).toBe(-30)
    expect(ricoPos.z).toBe(30)
    // 跳弹出射段方向 = 折线下一段（镜像后的 pts3[2] − impactPos）
    const out = spawnSpy.mock.calls[0][3] as THREE.Vector3
    expect(out.x).toBeCloseTo(-60 - -30, 5)
    expect(out.z).toBeCloseTo(60 - 30, 5)
    // T=1.6：直射也已抵达 → 弹着点 = 镜像后的 to（场景系 x 取负），无出射段
    deps.getT = () => 1.6
    handle.updateTracers()
    expect(spawnSpy).toHaveBeenCalledTimes(2)
    const direct = spawnSpy.mock.calls[1]
    expect((direct[1] as THREE.Vector3).x).toBe(-50)
    expect((direct[1] as THREE.Vector3).z).toBe(50)
    expect(direct[3]).toBeNull()
  })

  it('完成门 T >= t1：ribbon 归还恰好一次、tracer 移除；重复推进不重放 impact', () => {
    const deps = makeDeps()
    const handle = createBattleRuntime(deps)
    handle.advanceShotsTo(1)
    const fx = handle.ensureBattleFx()
    const giveSpy = vi.spyOn(fx, 'giveRibbon')
    const spawnSpy = vi.spyOn(fx, 'spawnImpact')
    expect(handle.tracerCount()).toBe(2)
    deps.getT = () => 1.25
    handle.updateTracers()   // 跳弹抵达（legEnds[0]=1.2）→ 一次 impact；直射未到
    expect(spawnSpy).toHaveBeenCalledTimes(1)
    expect(giveSpy).not.toHaveBeenCalled()   // 未到 t1（1.5 / 1.6）：弹头还在飞
    deps.getT = () => 1.7
    handle.updateTracers()   // 跨过 t1：完成 → 归还条带
    expect(handle.tracerCount()).toBe(0)
    // tracer ribbon 归还 2；trail 段有停留期（TRAIL_HOLD_SECS）暂不归还
    expect(giveSpy).toHaveBeenCalledTimes(2)
    deps.getT = () => 2.5
    handle.updateTracers()   // 重复推进：无残留 tracer，不再归还/不再重放 impact
    expect(giveSpy).toHaveBeenCalledTimes(2)
    expect(spawnSpy).toHaveBeenCalledTimes(2)
    // 光迹停留+淡出结束：逐段归还（直射 1 段 + 跳弹 2 段）
    deps.getT = () => 30
    handle.updateTracers()
    expect(giveSpy).toHaveBeenCalledTimes(5)
  })
})

describe('?perf 看门狗（行为）', () => {
  it('50ms 心跳抓主线程停顿（gap > 100ms 记录）；stopWatchdog 清理心跳定时器', async () => {
    window.history.replaceState(null, '', '?perf=1')
    const timers: Array<(fn: () => void) => number> = []
    const setSpy = vi.spyOn(window, 'setInterval').mockImplementation(((fn: () => void) => {
      timers.push(fn)
      return 4321 as unknown as ReturnType<typeof setInterval>
    }) as never)
    const clearSpy = vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined)
    let now = 1000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now)
    try {
      const { createPerfProbe } = await import('./perfProbe.js')
      const probe = createPerfProbe({
        getQualityKey: () => 'mid',
        getCameraMode: () => 'free',
        getArmorHighlightPref: () => false,
        container: document.createElement('div'),
        getRenderer: () => null,
        getT: () => 42,
        terrainCounters: () => ({ terrainChecks: 0, terrainRebuilds: 0 }),
        resetTerrainCounters: () => {},
        paused: () => false,
        annotationStats: () => ({}),
        getVehicles: () => [],
        battle: { tracerCount: () => 0, trajLineCount: () => 0, fxStats: () => null },
        armorStats: () => ({}) as never,
        contactShadowsCount: () => null,
      } as never)
      expect(probe.PERF).toBe(true)
      expect(timers.length).toBeGreaterThanOrEqual(1)   // 工厂即启动心跳（原行为）
      const beat = timers[0]
      // 心跳 1：间隔 300ms（> 2×50ms）→ 记录主线程停顿（t = 回放时刻 42）
      now = 1300
      beat()
      // 心跳 2：间隔 10ms → 不记录
      now = 1310
      beat()
      const report = probe.perfHandle!.report()
      expect(report).toContain('main-thread-stall')
      // destroy/stop：心跳定时器被清（否则永久空转）
      probe.stopWatchdog()
      expect(clearSpy).toHaveBeenCalledWith(4321)
      nowSpy.mockRestore()
    } finally {
      setSpy.mockRestore()
      clearSpy.mockRestore()
      window.history.replaceState(null, '', '?perf')
    }
  })
})
