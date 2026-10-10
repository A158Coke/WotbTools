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
