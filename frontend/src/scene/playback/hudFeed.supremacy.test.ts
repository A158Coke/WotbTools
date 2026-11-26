import { describe, expect, it } from 'vitest'
import { applySupremacyPointsToStore } from '../supremacyPoints.js'

function makeStore() {
  return { pointsFriend: null as number | null, pointsEnemy: null as number | null }
}

const samples = [
  { clock: 0, team: 1, points: 10 },
  { clock: 10, team: 2, points: 20 },
  { clock: 20, team: 1, points: 720 },
]

describe('applySupremacyPointsToStore（每 tick 无条件重算 + 变更守卫）', () => {
  it('有采样：按 friendly_team 拆 friend/enemy 写入 store', () => {
    const store = makeStore()
    applySupremacyPointsToStore(store, { supremacy_points: samples, meta: { friendly_team: 1 } }, 25)
    expect(store.pointsFriend).toBe(720)
    expect(store.pointsEnemy).toBe(20)
  })

  it('Supremacy → Regular 会话切换：无采样也写入 null（清上一场残值，不包在有采样 if 里）', () => {
    const store = makeStore()
    applySupremacyPointsToStore(store, { supremacy_points: samples, meta: { friendly_team: 1 } }, 25)
    expect(store.pointsFriend).toBe(720)
    applySupremacyPointsToStore(store, { supremacy_points: undefined, meta: { friendly_team: 1 } }, 25)
    expect(store.pointsFriend).toBeNull()
    expect(store.pointsEnemy).toBeNull()
  })

  it('unknown friendly_team：一律 null（unknown ≠ enemy），不把某一方猜成敌方', () => {
    const store = makeStore()
    applySupremacyPointsToStore(store, { supremacy_points: samples, meta: { friendly_team: null } }, 25)
    expect(store).toEqual({ pointsFriend: null, pointsEnemy: null })
  })

  it('变更守卫：同值不写（Vue 同值短路只免 trigger，不免 proxy set 本身）', () => {
    const store = makeStore()
    const writes: string[] = []
    const reactiveStore = {
      get pointsFriend() { return store.pointsFriend },
      set pointsFriend(v: number | null) { writes.push('friend'); store.pointsFriend = v },
      get pointsEnemy() { return store.pointsEnemy },
      set pointsEnemy(v: number | null) { writes.push('enemy'); store.pointsEnemy = v },
    }
    applySupremacyPointsToStore(reactiveStore, { supremacy_points: samples, meta: { friendly_team: 1 } }, 5)
    expect(writes).toEqual(['friend'])
    applySupremacyPointsToStore(reactiveStore, { supremacy_points: samples, meta: { friendly_team: 1 } }, 5)
    expect(writes).toEqual(['friend'])
    applySupremacyPointsToStore(reactiveStore, { supremacy_points: samples, meta: { friendly_team: 1 } }, 25)
    expect(writes).toEqual(['friend', 'friend', 'enemy'])
  })
})
