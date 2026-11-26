import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createHudFeed } from './hudFeed.js'
import type { HudFeedStore } from './hudFeed.js'

function makeRig() {
  let t = 0
  const kills = [
    { t: 1, killer_eid: 1, victim_eid: 3 },
    { t: 2, killer_eid: 2, victim_eid: 4 },
    { t: 3.5, killer_eid: 1, victim_eid: 3 },
    { t: 5, killer_eid: 3, victim_eid: 1 },   // 友方阵亡 → 敌方比分（覆盖 team 1 分支）
  ]
  const store: HudFeedStore = {
    killfeed: [],
    scoreFriend: 0,
    scoreEnemy: 0,
    friendlyTeam: 1,
    roster: { team1: [], team2: [], unknown: [] },
  }
  const feed = createHudFeed({
    store,
    getData: () => ({ meta: { friendly_team: 1 }, kills }),
    getT: () => t,
    getV: () => [
      { def: { eid: 1, team: 1, nickname: 'Alpha', tank_name: 'A' } },
      { def: { eid: 2, team: 1, nickname: 'Bravo', tank_name: 'B' } },
      { def: { eid: 3, team: 2, nickname: 'Charlie', tank_name: 'C' } },
      { def: { eid: 4, team: 2, nickname: 'Delta', tank_name: 'D' } },
    ],
    getSessionGen: () => 0,
    deathAt: () => false,
    getReloadStateAt: () => null,
    getFollowEid: () => null,
  })
  return { feed, store, setT: (v: number) => { t = v }, kills }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe(':1150 击杀/比分游标（增量而非全量扫描）', () => {
  it('advanceKills：按 t 升序消费（乱序数组由事件源升序保证）；未到期不消费', () => {
    const { feed, store, setT } = makeRig()
    setT(2)
    feed.advanceKills()
    expect(store.killfeed.map((e) => e.text)).toEqual(['Alpha 击毁 Charlie', 'Bravo 击毁 Delta'])
    feed.advanceKills()
    expect(store.killfeed.length).toBe(2)
    setT(3.5)
    feed.advanceKills()
    expect(store.killfeed.length).toBe(3)
    expect(store.killfeed[2].text).toBe('Alpha 击毁 Charlie')
  })

  it('updateScore：单调游标增量；同 T 重复调用不重复计分；恢复推进后继续', () => {
    const { feed, store, setT } = makeRig()
    setT(2)
    feed.updateScore()
    expect(store.scoreFriend).toBe(2)
    expect(store.scoreEnemy).toBe(0)
    feed.updateScore()
    expect(store.scoreFriend).toBe(2)
    setT(3.5)
    feed.updateScore()
    expect(store.scoreFriend).toBe(3)
    expect(store.scoreEnemy).toBe(0)
    setT(5)
    feed.updateScore()
    expect(store.scoreFriend).toBe(3)
    expect(store.scoreEnemy).toBe(1)
    feed.resetScore()
    setT(0)
    feed.updateScore()
    expect(store.scoreFriend).toBe(0)
  })
})
