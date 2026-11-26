import { PLAYBACK_ROLES, teamRoleOf } from '../../data/mapTeamColors.js'

function numeric(hex: string): number {
  return parseInt(hex.slice(1), 16)
}

export const COLOR_FRIENDLY = numeric(PLAYBACK_ROLES.friendly.vehicle)
export const COLOR_ENEMY = numeric(PLAYBACK_ROLES.enemy.vehicle)
export const COLOR_UNKNOWN = numeric(PLAYBACK_ROLES.neutral.vehicle)

export const TRACER_FRIENDLY = numeric(PLAYBACK_ROLES.friendly.tracer)
export const TRACER_ENEMY = numeric(PLAYBACK_ROLES.enemy.tracer)

export function teamColorOf(team: number | null | undefined, friendlyTeam: number | null | undefined): number {
  const role = teamRoleOf(team, friendlyTeam)
  if (role === 'friendly') return COLOR_FRIENDLY
  if (role === 'enemy') return COLOR_ENEMY
  return COLOR_UNKNOWN
}
