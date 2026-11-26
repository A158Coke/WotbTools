import { describe, expect, it } from 'vitest'
import {
  PLAYBACK_ON_NEUTRAL,
  PLAYBACK_ROLES,
  ReplayMapFactionStyle,
  TEAM_TOKENS,
  friendlyRoleOf,
  playbackTracerColor,
  teamCssVars,
  teamRoleOf,
} from './mapTeamColors'

describe('Playback 语义色（ALLY=GREEN，ENEMY=RED，unknown≠enemy）', () => {
  it('四个角色拥有同一语义下的用途变体', () => {
    expect(PLAYBACK_ROLES.friendly.base).toBe('#86efac')
    expect(PLAYBACK_ROLES.enemy.base).toBe('#f87171')
    expect(PLAYBACK_ROLES.neutral.base).toBe('#f5f5f5')
    expect(PLAYBACK_ROLES.objective.base).toBe('#ffc24b')
    for (const role of ['friendly', 'enemy', 'neutral', 'objective']) {
      const r = PLAYBACK_ROLES[role]
      expect(r, role).toBeDefined()
      for (const variant of ['base', 'text', 'outline', 'glow', 'tracer', 'vehicle']) {
        expect(typeof r[variant], `${role}.${variant}`).toBe('string')
        expect(r[variant].length).toBeGreaterThan(0)
      }
      expect(r.outline).toContain('rgba(')
      expect(r.glow).toContain('rgba(')
    }
    expect(PLAYBACK_ROLES.friendly.vehicle).toBe('#26794a')
    expect(PLAYBACK_ROLES.enemy.vehicle).toBe('#98322a')
    expect(PLAYBACK_ROLES.friendly.tracer).toBe('#3ee08a')
    expect(PLAYBACK_ROLES.enemy.tracer).toBe('#ff5a45')
    expect(PLAYBACK_ON_NEUTRAL).toBe('#1c1f1d')
  })

  it('TEAM_TOKENS 保留 green/red 兼容别名', () => {
    expect(Object.keys(TEAM_TOKENS).sort()).toEqual(['green', 'red'])
    expect(TEAM_TOKENS.green.text).toBe(PLAYBACK_ROLES.friendly.text)
    expect(TEAM_TOKENS.green.outline).toBe(PLAYBACK_ROLES.friendly.outline)
    expect(TEAM_TOKENS.red.text).toBe(PLAYBACK_ROLES.enemy.text)
    expect(ReplayMapFactionStyle.ALLY).toBe(TEAM_TOKENS.green)
    expect(ReplayMapFactionStyle.ENEMY).toBe(TEAM_TOKENS.red)
  })

  it('teamRoleOf：只有合法 physical team + friendlyTeam 才产生敌我关系', () => {
    expect(teamRoleOf(1, 1)).toBe('friendly')
    expect(teamRoleOf(2, 1)).toBe('enemy')
    expect(teamRoleOf(1, 2)).toBe('enemy')
    expect(teamRoleOf(2, 2)).toBe('friendly')
    expect(teamRoleOf(3, 1)).toBe('neutral')
    expect(teamRoleOf(0, 1)).toBe('neutral')
    expect(teamRoleOf(1, 0)).toBe('neutral')
    expect(teamRoleOf(null, 1)).toBe('neutral')
    expect(teamRoleOf(undefined, 1)).toBe('neutral')
  })

  it('friendlyRoleOf / playbackTracerColor：null 未知不落敌军', () => {
    expect(friendlyRoleOf(true)).toBe('friendly')
    expect(friendlyRoleOf(false)).toBe('enemy')
    expect(friendlyRoleOf(null)).toBe('neutral')
    expect(friendlyRoleOf(undefined)).toBe('neutral')
    expect(playbackTracerColor(true)).toBe(PLAYBACK_ROLES.friendly.tracer)
    expect(playbackTracerColor(false)).toBe(PLAYBACK_ROLES.enemy.tracer)
    expect(playbackTracerColor(null)).toBe(PLAYBACK_ROLES.neutral.tracer)
  })

  it('teamCssVars：保留 pb 变量并覆盖 Playback root 角色 token', () => {
    const v = teamCssVars('skit')
    expect(v['--pb-team-text']).toBe(PLAYBACK_ROLES.friendly.text)
    expect(v['--pb-team-outline']).toBe(PLAYBACK_ROLES.friendly.outline)
    expect(v['--pb-team-glow']).toBe(PLAYBACK_ROLES.friendly.glow)
    expect(v['--pb-enemy-text']).toBe(PLAYBACK_ROLES.enemy.text)
    expect(v['--pb-enemy-outline']).toBe(PLAYBACK_ROLES.enemy.outline)
    expect(v['--pb-enemy-glow']).toBe(PLAYBACK_ROLES.enemy.glow)
    expect(v['--color-team-ally']).toBe(PLAYBACK_ROLES.friendly.base)
    expect(v['--color-team-enemy']).toBe(PLAYBACK_ROLES.enemy.base)
    expect(v['--color-team-neutral']).toBe(PLAYBACK_ROLES.neutral.base)
    expect(v['--color-objective']).toBe(PLAYBACK_ROLES.objective.base)
    expect(v['--color-on-team-neutral']).toBe(PLAYBACK_ON_NEUTRAL)
  })
})
