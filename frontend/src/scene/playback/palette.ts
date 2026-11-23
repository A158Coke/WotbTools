// Playback 数值色 adapter：唯一事实源是 data/mapTeamColors.js 的 PLAYBACK_ROLES。
//
// 3D 材质需要 number；这里只做 string → number 转换与角色分流，不再拥有独立 HEX。
// 车辆/基地/标签使用 vehicle/base 变体；炮线使用 tracer 变体（同一角色，受控亮度差异）。
import { PLAYBACK_ROLES, teamRoleOf } from '../../data/mapTeamColors.js'

function numeric(hex: string): number {
  return parseInt(hex.slice(1), 16)
}

export const COLOR_FRIENDLY = numeric(PLAYBACK_ROLES.friendly.vehicle)
export const COLOR_ENEMY = numeric(PLAYBACK_ROLES.enemy.vehicle)
export const COLOR_UNKNOWN = numeric(PLAYBACK_ROLES.neutral.vehicle)

export const TRACER_FRIENDLY = numeric(PLAYBACK_ROLES.friendly.tracer)
export const TRACER_ENEMY = numeric(PLAYBACK_ROLES.enemy.tracer)

/** 车辆/基地/标签阵营色（深色板；中立与未知阵营一律 white——unknown ≠ enemy）。
 *  入参是**队伍号本身**而非车辆对象：调用方必须显式解出 `v.def.team`（RuntimeVehicle
 *  带索引签名，整对象传入无法被类型拦下——评审 P2 的阵营色全白回归即源于此）。 */
export function teamColorOf(team: number | null | undefined, friendlyTeam: number | null | undefined): number {
  const role = teamRoleOf(team, friendlyTeam)
  if (role === 'friendly') return COLOR_FRIENDLY
  if (role === 'enemy') return COLOR_ENEMY
  return COLOR_UNKNOWN
}
