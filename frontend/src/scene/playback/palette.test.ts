// palette.teamColorOf：数值 adapter 必须从 PLAYBACK_ROLES 派生，并保持视角语义。
import { describe, expect, it } from 'vitest'
import { COLOR_ENEMY, COLOR_FRIENDLY, COLOR_UNKNOWN, TRACER_ENEMY, TRACER_FRIENDLY, teamColorOf } from './palette.js'
import { PLAYBACK_ROLES } from '../../data/mapTeamColors.js'

const numeric = (hex: string) => parseInt(hex.slice(1), 16)

describe('teamColorOf（阵营色语义）', () => {
  it('数值常量来自同一 SSOT 角色', () => {
    expect(COLOR_FRIENDLY).toBe(numeric(PLAYBACK_ROLES.friendly.vehicle))
    expect(COLOR_ENEMY).toBe(numeric(PLAYBACK_ROLES.enemy.vehicle))
    expect(COLOR_UNKNOWN).toBe(numeric(PLAYBACK_ROLES.neutral.vehicle))
    expect(TRACER_FRIENDLY).toBe(numeric(PLAYBACK_ROLES.friendly.tracer))
    expect(TRACER_ENEMY).toBe(numeric(PLAYBACK_ROLES.enemy.tracer))
  })

  it('友军 / 敌军 / 中立 0 / 未知阵营 0 → 深绿 / 深红 / 白', () => {
    expect(teamColorOf(1, 1)).toBe(COLOR_FRIENDLY)
    expect(teamColorOf(2, 1)).toBe(COLOR_ENEMY)
    expect(teamColorOf(1, 2)).toBe(COLOR_ENEMY)
    expect(teamColorOf(2, 2)).toBe(COLOR_FRIENDLY)
    expect(teamColorOf(0, 1)).toBe(COLOR_UNKNOWN)
    expect(teamColorOf(1, 0)).toBe(COLOR_UNKNOWN)
    expect(teamColorOf(null, 1)).toBe(COLOR_UNKNOWN)
    expect(teamColorOf(undefined, 1)).toBe(COLOR_UNKNOWN)
    expect(teamColorOf(3, 1)).toBe(COLOR_UNKNOWN)
  })

  it('调用链契约：vehicleRuntime 的 dep 传 RuntimeVehicle，必须解 v.def.team（评审 P2 回归）', () => {
    const v = { def: { team: 2 } } as { def: { team: number } }
    const friendlyTeam = 1
    expect(teamColorOf(v.def.team, friendlyTeam)).toBe(COLOR_ENEMY)
    const wrong = teamColorOf((v as unknown as { team?: number }).team, friendlyTeam)
    expect(wrong).toBe(COLOR_UNKNOWN)
  })
})
