// 地图阵营语义色：唯一规则 ALLY=GREEN / ENEMY=RED；旧 friendly per-map green|blue、amber/cyan 一律 obsolete。
import { describe, expect, it } from 'vitest'
import { TEAM_TOKENS, ReplayMapFactionStyle, teamCssVars } from './mapTeamColors'

describe('地图阵营语义色（ALLY=GREEN，ENEMY=RED）', () => {
  it('ReplayMapFactionStyle：ALLY=green 系、ENEMY=red 系', () => {
    const allyRgb = hexToRgb(ReplayMapFactionStyle.ALLY.text)
    const enemyRgb = hexToRgb(ReplayMapFactionStyle.ENEMY.text)
    expect(allyRgb.g).toBeGreaterThan(allyRgb.r)
    expect(enemyRgb.r).toBeGreaterThan(enemyRgb.g)
  })

  it('TEAM_TOKENS 只保留 green/red（blue 已删除）', () => {
    expect(Object.keys(TEAM_TOKENS).sort()).toEqual(['green', 'red'])
    for (const tone of ['green', 'red']) {
      const t = TEAM_TOKENS[tone]
      expect(t, tone).toBeDefined()
      expect(typeof t.text).toBe('string')
      expect(t.text.length).toBeGreaterThan(0)
      expect(t.outline).toContain('rgba(')
      expect(t.glow).toContain('rgba(')
    }
  })

  it('teamCssVars 恒定 friendly=green / enemy=red（不随地图变化）', () => {
    const v = teamCssVars('skit')
    expect(v['--pb-team-text']).toBe(TEAM_TOKENS.green.text)
    expect(v['--pb-team-outline']).toBe(TEAM_TOKENS.green.outline)
    expect(v['--pb-enemy-text']).toBe(TEAM_TOKENS.red.text)
    expect(v['--pb-enemy-outline']).toBe(TEAM_TOKENS.red.outline)
  })
})

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}
