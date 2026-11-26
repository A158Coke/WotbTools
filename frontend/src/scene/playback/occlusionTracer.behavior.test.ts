// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import * as THREE from 'three'
import { createBattleRuntime } from './battleRuntime.js'
import type { BattleRuntimeData, BattleRuntimeDeps } from './battleRuntime.js'
import type { TransientVehicle } from './transientFeedback3d.js'

const HP: Array<[number, number]> = [[0, 100], [28, 60]]
const DATA = {
  shots: [
    { t_fire: 1, shooter_eid: 7, target_eid: 8, game_hit_result: 3, flight_secs: 0.5, from: [10, 1, 10], to: [50, 1, 50] },
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
    deps.getT = () => 1.25
    handle.updateTracers()
    expect(spawnSpy).toHaveBeenCalledTimes(1)
    const ricoPos = spawnSpy.mock.calls[0][1] as THREE.Vector3
    expect(ricoPos.x).toBe(-30)
    expect(ricoPos.z).toBe(30)
    const out = spawnSpy.mock.calls[0][3] as THREE.Vector3
    expect(out.x).toBeCloseTo(-60 - -30, 5)
    expect(out.z).toBeCloseTo(60 - 30, 5)
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
    handle.updateTracers()
    expect(spawnSpy).toHaveBeenCalledTimes(1)
    expect(giveSpy).not.toHaveBeenCalled()
    deps.getT = () => 1.7
    handle.updateTracers()
    expect(handle.tracerCount()).toBe(0)
    expect(giveSpy).toHaveBeenCalledTimes(2)
    deps.getT = () => 2.5
    handle.updateTracers()
    expect(giveSpy).toHaveBeenCalledTimes(2)
    expect(spawnSpy).toHaveBeenCalledTimes(2)
    deps.getT = () => 30
    handle.updateTracers()
    expect(giveSpy).toHaveBeenCalledTimes(5)
  })
})

describe('?perf 看门狗（行为）', () => {
  it('50ms 心跳抓主线程停顿（gap > 100ms 记录）；stopWatchdog 清理心跳定时器', async () => {
    window.history.replaceState(null, '', '?perf=1')
    const timers: Array<() => void> = []
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
        getSpeed: () => 1,
        getDynres: () => false,
        getCameraMode: () => 'free',
        getArmorHighlightPref: () => false,
        getViewportSize: () => ({ x: 1280, y: 720 }),
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
      expect(timers.length).toBeGreaterThanOrEqual(1)
      const beat = timers[0]
      now = 1300
      beat()
      now = 1310
      beat()
      const report = probe.perfHandle!.report()
      expect(report).toContain('main-thread-stall')
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
