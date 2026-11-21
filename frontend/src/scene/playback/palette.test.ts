// palette.teamColorOf：数字优先签名的语义回归 + { def } 调用链契约
// （评审 P2：出仓时入参错位把整车阵营色打成中立白——签名收窄为队伍号本身，
//   整对象传入在类型层不可能；本文件再锁行为）。
import { describe, expect, it } from 'vitest'
import { COLOR_ENEMY, COLOR_FRIENDLY, COLOR_UNKNOWN, teamColorOf } from './palette.js'

describe('teamColorOf（阵营色语义）', () => {
  it('友军 / 敌军 / 中立 0 / 未知阵营 0 → 深绿 / 深红 / 白', () => {
    expect(teamColorOf(1, 1)).toBe(COLOR_FRIENDLY)
    expect(teamColorOf(2, 1)).toBe(COLOR_ENEMY)
    expect(teamColorOf(1, 2)).toBe(COLOR_ENEMY)
    expect(teamColorOf(2, 2)).toBe(COLOR_FRIENDLY)
    expect(teamColorOf(0, 1)).toBe(COLOR_UNKNOWN)   // 中立＝白
    expect(teamColorOf(1, 0)).toBe(COLOR_UNKNOWN)   // friendly_team 未知
    expect(teamColorOf(null, 1)).toBe(COLOR_UNKNOWN)
    expect(teamColorOf(undefined, 1)).toBe(COLOR_UNKNOWN)
  })

  it('调用链契约：vehicleRuntime 的 dep 传 RuntimeVehicle，必须解 v.def.team（评审 P2 回归）', () => {
    // 复刻宿主接线：`teamColor: (v) => teamColorOf(v.def.team, DATA.meta.friendly_team)`
    const v = { def: { team: 2 } } as { def: { team: number } }
    const friendlyTeam = 1
    expect(teamColorOf(v.def.team, friendlyTeam)).toBe(COLOR_ENEMY)
    // 若错把整车对象传入，`v.team` 不存在 → undefined → 白：正是该回归的形状
    const wrong = teamColorOf((v as unknown as { team?: number }).team, friendlyTeam)
    expect(wrong).toBe(COLOR_UNKNOWN)
  })
})
