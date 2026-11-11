// 争霸点数 → HUD store 的会话残留清理（#827 接替 supremacyPoints.test.js:55）：
// 重算与写入已从 playbackScene.tick 闭包出仓为 supremacyPoints.applySupremacyPointsToStore
//（与 hudFeed 同批出仓的 HUD 派生域；每 tick 由宿主无条件调用）。
// 行为契约：有采样 → 按阵营视角写入；会话切换（无 supremacy_points）→ 写 null 清残值；
// 同值守卫：值不变不产生 store 写入。
import { describe, expect, it, vi } from 'vitest'
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
    // 下一场回放没有 supremacy_points：同一调用形态必须把 null 推上屏
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
    // 模拟响应式 store：setter 可观测
    const writes: string[] = []
    const reactiveStore = {
      get pointsFriend() { return store.pointsFriend },
      set pointsFriend(v: number | null) { writes.push('friend'); store.pointsFriend = v },
      get pointsEnemy() { return store.pointsEnemy },
      set pointsEnemy(v: number | null) { writes.push('enemy'); store.pointsEnemy = v },
    }
    applySupremacyPointsToStore(reactiveStore, { supremacy_points: samples, meta: { friendly_team: 1 } }, 5)
    expect(writes).toEqual(['friend'])   // t=5 只有 team1 采样：friend null→10；enemy 保持 null 不写
    applySupremacyPointsToStore(reactiveStore, { supremacy_points: samples, meta: { friendly_team: 1 } }, 5)
    expect(writes).toEqual(['friend'])   // 同 t 重算：值不变，零写入
    applySupremacyPointsToStore(reactiveStore, { supremacy_points: samples, meta: { friendly_team: 1 } }, 25)
    expect(writes).toEqual(['friend', 'friend', 'enemy'])   // friend 10→720、enemy null→20 变化才写
  })
})
