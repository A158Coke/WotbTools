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
  t: number | (() => number)
}) {
  const getT = typeof t === 'function' ? t : () => t
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
    getT,    getV: () => vehicles as never,
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
    expect(store.roster.team1.map((r) => (r as { eid: number }).eid)).toEqual([1])
    expect(store.roster.team2.map((r) => (r as { eid: number }).eid)).toEqual([2])
    expect(store.friendlyTeam).toBe(1)
    feed.updateRoster()
    const row1 = store.roster.team1[0] as { hp: number; dead: boolean }
    expect(row1.hp).toBe(600)
    expect(row1.dead).toBe(false)
    expect(deathAt).toHaveBeenCalled()
    const { feed: feed2, store: store2 } = makeFeed({ vehicles, deathAt, t: 12 })
    feed2.buildRoster()
    feed2.updateRoster()
    const row12 = store2.roster.team1[0] as { hp: number; dead: boolean }
    expect(row12.hp).toBe(0)
    expect(row12.dead).toBe(true)
  })

  it('resetRoster 清空 eid → 行 索引：其后 updateRoster 不写旧会话的行（teardown 语义）', () => {
    const vehicles = [makeVehicle(1, 1, 'ally')]
    const deathAt = vi.fn((_v, time) => time >= 12)
    let t = 5
    const live = makeFeed({ vehicles, deathAt, t: () => t })
    live.feed.buildRoster()
    live.feed.updateRoster()
    const liveRow = live.store.roster.team1[0] as { hp: number; dead: boolean }
    expect(liveRow.hp).toBe(600)
    t = 12
    live.feed.updateRoster()
    expect(liveRow.hp).toBe(0)
    expect(liveRow.dead).toBe(true)

    t = 5
    const torn = makeFeed({ vehicles, deathAt, t: () => t })
    torn.feed.buildRoster()
    torn.feed.updateRoster()
    const row = torn.store.roster.team1[0] as { hp: number; dead: boolean; followed: boolean }
    expect(row.hp).toBe(600)
    torn.feed.resetRoster()
    t = 12
    torn.feed.updateRoster()
    expect(row.hp).toBe(600)
    expect(row.dead).toBe(false)
  })
})
