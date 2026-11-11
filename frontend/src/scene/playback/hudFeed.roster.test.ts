// 名册桥接行为测试（#827 接替 rosterState.test.js:133/:140）：
// - store 名册 = buildRosterRows 静态身份 + projectRoster(getV, getT, deathAt) 运行时投影
//   （HP/阵亡走场景 resolver，不另起一套判据）；
// - teardown 清空 eid → 行 索引：resetRoster 后 updateRoster 是 no-op（不写旧会话的行）。
import { describe, expect, it, vi } from 'vitest'
import { createHudFeed } from './hudFeed.js'
import type { HudFeedStore } from './hudFeed.js'

const HP = [[0, 1000], [5, 600], [12, 0]] as Array<[number, number]>

function makeVehicle(eid: number, team: number, nickname: string) {
  return { def: { eid, account_id: eid, tank_id: 10001 + eid, team, nickname, tank_name: 'Tank' + eid, max_hp: 1000, hp: HP } }
}

function makeFeed({ vehicles, deathAt, t }: {
  vehicles: Array<ReturnType<typeof makeVehicle>>
  deathAt?: (v: unknown, t: number) => boolean
  t: number
}) {
  const store = {
    killfeed: [],
    scoreFriend: 0,
    scoreEnemy: 0,
    friendlyTeam: null,
    roster: { team1: [], team2: [], unknown: [] },
  } as unknown as HudFeedStore & { roster: { team1: unknown[]; team2: unknown[]; unknown: unknown[] } }
  const feed = createHudFeed({
    store,
    getData: () => ({ meta: { friendly_team: 1 }, kills: [] }) as never,
    getT: () => t,
    getV: () => vehicles as never,
    getSessionGen: () => 0,
    deathAt: (deathAt ?? (() => false)) as never,
    getReloadStateAt: () => null,
    getFollowEid: () => null,
  })
  return { feed, store }
}

describe('createHudFeed 名册投影（行为）', () => {
  it('buildRoster + updateRoster：store 行 = 静态身份 + projectRoster 投影（HP/阵亡走场景 resolver）', () => {
    const vehicles = [makeVehicle(1, 1, 'ally'), makeVehicle(2, 2, 'enemy')]
    const deathAt = vi.fn((_v, t) => t >= 12)
    const { feed, store } = makeFeed({ vehicles, deathAt, t: 5 })
    feed.buildRoster()
    // 静态身份分组：store 行 = buildRosterRows(V)（team1/team2 按 def.team）
    expect(store.roster.team1.map((r) => (r as { eid: number }).eid)).toEqual([1])
    expect(store.roster.team2.map((r) => (r as { eid: number }).eid)).toEqual([2])
    expect(store.friendlyTeam).toBe(1)
    // 运行时投影：t=5 → hp=600、未阵亡
    feed.updateRoster()
    const row1 = store.roster.team1[0] as { hp: number; dead: boolean }
    expect(row1.hp).toBe(600)
    expect(row1.dead).toBe(false)
    expect(deathAt).toHaveBeenCalled()
    // t=12 之后：hp=0 且 resolver 判阵亡（死亡判据复用注入的 deathAt）
    const { feed: feed2, store: store2 } = makeFeed({ vehicles, deathAt, t: 12 })
    feed2.buildRoster()
    feed2.updateRoster()
    const row12 = store2.roster.team1[0] as { hp: number; dead: boolean }
    expect(row12.hp).toBe(0)
    expect(row12.dead).toBe(true)
  })

  it('resetRoster 清空 eid → 行 索引：其后 updateRoster 不写旧会话的行（teardown 语义）', () => {
    const vehicles = [makeVehicle(1, 1, 'ally')]
    const { feed, store } = makeFeed({ vehicles, deathAt: () => false, t: 5 })
    feed.buildRoster()
    feed.updateRoster()
    const row = store.roster.team1[0] as { hp: number; dead: boolean; followed: boolean }
    expect(row.hp).toBe(600)
    // teardown：索引清空。旧行对象仍被外部持有（store 已被新会话重建），但
    // 旧 hudFeed 的 updateRoster 不再触碰它们（无索引即跳过）。
    feed.resetRoster()
    feed.updateRoster()
    expect(row.hp).toBe(600)   // 未被 stale 投影污染
    expect(row.dead).toBe(false)
  })
})
