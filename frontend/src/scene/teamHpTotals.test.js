import { describe, expect, it } from 'vitest'
import { perspectiveScore, teamHpTotals } from './teamHpTotals.js'

const vehicle = (team, hp, maxHp) => ({ team, hp, maxHp })

describe('teamHpTotals（3D 顶栏双方总血量）', () => {
  it('按 friendlyTeam 分桶汇总剩余与上限，并给出百分比', () => {
    const totals = teamHpTotals(
      [vehicle(1, 800, 1000), vehicle(1, 700, 1000), vehicle(2, 300, 500), vehicle(2, 200, 500)],
      1,
    )
    expect(totals).toMatchObject({
      hpFriend: 1500, hpFriendMax: 2000, hpEnemy: 500, hpEnemyMax: 1000,
      hpFriendPct: 75, hpEnemyPct: 50,
    })
  })

  it('friendlyTeam = 2 时桶按阵营翻转', () => {
    const totals = teamHpTotals([vehicle(1, 100, 200), vehicle(2, 150, 200)], 2)
    expect(totals).toMatchObject({ hpFriend: 150, hpFriendMax: 200, hpEnemy: 100, hpEnemyMax: 200 })
  })

  it('未知阵营不计入任一方（unknown ≠ enemy）', () => {
    const totals = teamHpTotals([vehicle(1, 100, 100), vehicle(0, 999, 999), vehicle(2, 50, 100)], 1)
    expect(totals).toMatchObject({ hpFriend: 100, hpFriendMax: 100, hpEnemy: 50, hpEnemyMax: 100 })
  })

  it('friendlyTeam 未知（0 / null）时两队都归零，不把全队算进敌方', () => {
    const totals = teamHpTotals([vehicle(1, 900, 1000), vehicle(2, 800, 1000)], 0)
    expect(totals).toMatchObject({
      hpFriend: 0, hpFriendMax: 0, hpEnemy: 0, hpEnemyMax: 0, hpFriendPct: 0, hpEnemyPct: 0,
    })
  })

  it('负血量 / 缺字段夹到 0；空队伍百分比为 0（不产生 NaN）', () => {
    const totals = teamHpTotals([vehicle(1, -50, 1000), vehicle(1, undefined, undefined)], 1)
    expect(totals.hpFriend).toBe(0)
    expect(totals.hpFriendMax).toBe(1000)
    expect(totals.hpFriendPct).toBe(0)
    expect(Number.isFinite(totals.hpEnemyPct)).toBe(true)
  })
})

describe('perspectiveScore（顶栏比分与血条同一阵营视角）', () => {
  it('friendlyTeam = 1：物理顺序即视角顺序', () => {
    expect(perspectiveScore(3, 1, 1)).toEqual({ scoreFriend: 3, scoreEnemy: 1 })
  })

  it('friendlyTeam = 2：交换，左=己方（team 2）', () => {
    expect(perspectiveScore(1, 3, 2)).toEqual({ scoreFriend: 3, scoreEnemy: 1 })
  })

  it('friendlyTeam 未知（0/null）：不建立视角，比分归零（unknown ≠ enemy）', () => {
    // 与 teamHpTotals（两队血量都算 0）、pointsAt（friend/enemy 都是 null）同口径：
    // 视角未知时不得把物理 team1 当「己方」上屏——那会被 HUD 染成 ally/enemy 两色
    expect(perspectiveScore(3, 1, 0)).toEqual({ scoreFriend: 0, scoreEnemy: 0 })
    expect(perspectiveScore(3, 1, null)).toEqual({ scoreFriend: 0, scoreEnemy: 0 })
    expect(perspectiveScore(3, 1, undefined)).toEqual({ scoreFriend: 0, scoreEnemy: 0 })
  })

  it('perspective 对齐：friendlyTeam = 2 时，左侧血桶与左侧比分都来自 team 2', () => {
    // 顶栏布局：己方 HP | 己方比分 : 敌方比分 | 敌方 HP —— 两者必须同一视角
    const vehicles = [vehicle(1, 100, 1000), vehicle(1, 200, 1000), vehicle(2, 700, 800)]
    const totals = teamHpTotals(vehicles, 2)              // team 2 是己方
    const score = perspectiveScore(3, 1, 2)               // 物理：team1 杀 3、team2 杀 1
    expect(totals.hpFriend + totals.hpFriendMax).toBe(1500)   // 左侧血量总量 = team 2
    expect(score.scoreFriend).toBe(1)                          // 左侧比分 = team 2 的击杀
    expect(score.scoreEnemy).toBe(3)                           // 右侧比分 = team 1
    // 直接对照：己方血量桶的 max 必须来自 team 2（与 scoreFriend 同队）
    expect(totals.hpFriendMax).toBe(800)
    expect(totals.hpEnemyMax).toBe(2000)
  })
})
