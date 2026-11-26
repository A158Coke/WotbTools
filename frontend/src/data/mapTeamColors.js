export const PLAYBACK_ROLES = Object.freeze({
  friendly: Object.freeze({
    base: '#86efac',
    text: '#86efac',
    outline: 'rgba(134, 239, 172, 0.9)',
    glow: 'rgba(134, 239, 172, 0.5)',
    tracer: '#3ee08a',
    vehicle: '#26794a',
  }),
  enemy: Object.freeze({
    base: '#f87171',
    text: '#f87171',
    outline: 'rgba(248, 113, 113, 0.9)',
    glow: 'rgba(248, 113, 113, 0.5)',
    tracer: '#ff5a45',
    vehicle: '#98322a',
  }),
  neutral: Object.freeze({
    base: '#f5f5f5',
    text: '#f5f5f5',
    outline: 'rgba(245, 245, 245, 0.9)',
    glow: 'rgba(245, 245, 245, 0.5)',
    tracer: '#f5f5f5',
    vehicle: '#f5f5f5',
  }),
  objective: Object.freeze({
    base: '#ffc24b',
    text: '#ffc24b',
    outline: 'rgba(255, 194, 75, 0.9)',
    glow: 'rgba(255, 194, 75, 0.5)',
    tracer: '#ffc24b',
    vehicle: '#ffc24b',
  }),
})

export const PLAYBACK_ON_NEUTRAL = '#1c1f1d'

export function teamRoleOf(team, friendlyTeam) {
  if ((team !== 1 && team !== 2) || (friendlyTeam !== 1 && friendlyTeam !== 2)) return 'neutral'
  return team === friendlyTeam ? 'friendly' : 'enemy'
}

export function friendlyRoleOf(friendly) {
  if (friendly === true) return 'friendly'
  if (friendly === false) return 'enemy'
  return 'neutral'
}

export function playbackTracerColor(friendly) {
  return PLAYBACK_ROLES[friendlyRoleOf(friendly)].tracer
}

export const TEAM_TOKENS = Object.freeze({
  green: Object.freeze({
    text: PLAYBACK_ROLES.friendly.text,
    outline: PLAYBACK_ROLES.friendly.outline,
    glow: PLAYBACK_ROLES.friendly.glow,
  }),
  red: Object.freeze({
    text: PLAYBACK_ROLES.enemy.text,
    outline: PLAYBACK_ROLES.enemy.outline,
    glow: PLAYBACK_ROLES.enemy.glow,
  }),
})

export const ReplayMapFactionStyle = Object.freeze({
  ALLY: TEAM_TOKENS.green,
  ENEMY: TEAM_TOKENS.red,
})

export function teamCssVars(_mapCode) {
  const f = PLAYBACK_ROLES.friendly
  const e = PLAYBACK_ROLES.enemy
  return {
    '--pb-team-text': f.text,
    '--pb-team-outline': f.outline,
    '--pb-team-glow': f.glow,
    '--pb-enemy-text': e.text,
    '--pb-enemy-outline': e.outline,
    '--pb-enemy-glow': e.glow,
    '--color-team-ally': f.base,
    '--color-team-enemy': e.base,
    '--color-team-neutral': PLAYBACK_ROLES.neutral.base,
    '--color-objective': PLAYBACK_ROLES.objective.base,
    '--color-on-team-neutral': PLAYBACK_ON_NEUTRAL,
  }
}
