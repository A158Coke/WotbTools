import { describe, expect, it, vi } from 'vitest'
import { createBattleRuntime } from './battleRuntime.js'
import type { BattleRuntimeData, BattleRuntimeDeps } from './battleRuntime.js'
import { firstIndexAfter } from '../seekPointer.js'
import type { TransientVehicle } from './transientFeedback3d.js'

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

    handle.transients.advanceTo(9)
    expect(spawnDamage).toHaveBeenCalledTimes(1)
    expect(handle.transients.hasActive()).toBe(true)

    const T = 25
    handle.clearEffects()
    handle.resetShotsTo(firstIndexAfter(DATA.shots, T, (s) => (s as { t_fire: number }).t_fire))
    handle.transients.rewind(T)

    expect(handle.transients.hasActive()).toBe(false)
    expect(handle.transients.ghostOf(7)).toBeUndefined()
    expect(handle.transients.hasFlash(7)).toBe(false)

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

    handle.transients.advanceTo(30)
    expect(spawnDamage).toHaveBeenCalledTimes(1)
    expect(handle.fxStats()?.bursts).toBe(1)
    handle.transients.advanceTo(30)
    expect(spawnDamage).toHaveBeenCalledTimes(1)
    expect(handle.fxStats()?.bursts).toBe(1)
  })
})
