import { describe, expect, it, vi } from 'vitest'
import { shotViewerQuery } from './agentData.js'
vi.mock('../../../common/shot-tank-data.json', () => ({ default: { tanks: { 101: {
  configs: [{ shell_global_ids: [13, 42] }, { shell_global_ids: [42, 91] }],
} } } }))
describe('shot viewer mounted-config handoff', () => {
  it('keeps the mounted gun and shell index together', async () => {
    expect(await shotViewerQuery({ index: 6, shooter_tank_id: 101, target_tank_id: 202, shell_id: 42, shooter_config_idx: 0, target_config_idx: 3 }))
      .toEqual({ view: 'agent-armor', shot: '6', shooter: '101', tank: '202', scfg: '0', config: '3', shell: '1', world: '1', heatmap: '1' })
  })
  it('uses the highest matching configuration when no mounted match is known', async () => {
    const query = await shotViewerQuery({ index: 8, shooter_tank_id: 101, target_tank_id: 202, shell_id: 42 })
    expect(query.scfg).toBe('1'); expect(query.shell).toBe('0')
  })
  it('only uses recorder slot fallback and does not invent unknown data', async () => {
    const base = { index: 9, shooter_tank_id: 999, shell_id: 123, shell_slot: 2 }
    const author = await shotViewerQuery({ ...base, is_author: true })
    expect(author.shell).toBe('2'); expect(author.tank).toBe('999'); expect(author).not.toHaveProperty('scfg')
    expect(await shotViewerQuery(base)).not.toHaveProperty('shell'); expect(await shotViewerQuery({ index: 10 })).toBeNull()
  })
})

describe('shotBallisticLength（射击复现交战距离 = 服务器解码弹道长度）', () => {
  it('直线弹：ball_a → ball_b 直线距离', async () => {
    const { shotBallisticLength } = await import('./agentData.js')
    expect(shotBallisticLength({ ball_a: [0, 0, 0], ball_b: [0, 0, 300] })).toBeCloseTo(300, 6)
  })
  it('跳弹链：via 各段逐段计入（折线总长 > 直线）', async () => {
    const { shotBallisticLength } = await import('./agentData.js')
    const len = shotBallisticLength({ ball_a: [0, 0, 0], via: [[0, 0, 100], [0, 0, 150]], ball_b: [100, 0, 150] })
    expect(len).toBeCloseTo(100 + 50 + 100, 6)
  })
  it('字段缺失/非法：返回 0（调用方回退相机距离）', async () => {
    const { shotBallisticLength } = await import('./agentData.js')
    expect(shotBallisticLength(null)).toBe(0)
    expect(shotBallisticLength({})).toBe(0)
    expect(shotBallisticLength({ ball_a: [0, 0, 0] })).toBe(0)
    expect(shotBallisticLength({ ball_a: [0, 0, 0], ball_b: [0, NaN, 1] })).toBe(0)
    expect(shotBallisticLength({ ball_a: [0, 0, 0], via: [[1, 2]], ball_b: [0, 0, 1] })).toBe(0)
  })
})
