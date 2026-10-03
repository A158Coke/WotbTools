import { describe, expect, it } from 'vitest'
import { teamHpTotals } from './teamHpTotals.js'

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
