import { describe, expect, it } from 'vitest'
import type { AgentBattleResult } from '../../api/agent-replay-facets.js'
import results from '../__golden__/wasm-results.json'
import { toCollectorSeed } from './collectorProjection.js'

const result = () => structuredClone(results['random-battle-example.wotbreplay']) as unknown as AgentBattleResult

describe('Collector allowlist projection', () => {
  it('preserves draw, repeated vehicle models and both eligible modes without identity', () => {
    for (const mode of [1, 7]) {
      const r = result(); r.arena_bonus_type = mode; r.winner_team = 0
      r.players.forEach(p => { p.tank_id = 9297 })
      const seed = toCollectorSeed(r)!
      expect(seed.winnerTeam).toBe(0)
      expect(seed.arenaBonusType).toBe(mode)
      expect(seed.teams).toEqual([{ team: 1, vehicles: Array(7).fill(9297) }, { team: 2, vehicles: Array(7).fill(9297) }])
      expect(Object.keys(seed).sort()).toEqual(['schemaVersion', 'arenaId', 'arenaBonusType', 'mapId', 'mapKey', 'clientVersion', 'winnerTeam', 'authorTeam', 'teams'].sort())
      expect(JSON.stringify(seed)).not.toMatch(/account|nickname|clan|file_name|damage|author_eid/)
      expect(seed.teams[0].vehicles).not.toBe(r.players)
    }
  })
  it.each([0, 2, 4, 8])('skips ineligible mode %s', mode => {
    const r = result(); r.arena_bonus_type = mode
    expect(toCollectorSeed(r)).toBeNull()
  })
  it.each([
    (r: AgentBattleResult) => { r.author_team = 0 },
    (r: AgentBattleResult) => { r.winner_team = 3 },
    (r: AgentBattleResult) => { r.arena_id = '' },
    (r: AgentBattleResult) => { r.arena_id = '1'.repeat(21) },
    (r: AgentBattleResult) => { r.map_id = NaN },
    (r: AgentBattleResult) => { r.map_id = 2147483648 },
    (r: AgentBattleResult) => { r.map_key = '' },
    (r: AgentBattleResult) => { r.map_key = 'a'.repeat(129) },
    (r: AgentBattleResult) => { r.client_version = 'v'.repeat(65) },
    (r: AgentBattleResult) => { r.players.pop() },
    (r: AgentBattleResult) => { r.players[0].team = 0 },
    (r: AgentBattleResult) => { r.players.forEach(p => { p.team = 1 }) },
    (r: AgentBattleResult) => { r.players[0].tank_id = 0 },
    (r: AgentBattleResult) => { r.players[0].tank_id = 1.5 },
    (r: AgentBattleResult) => { r.players[0].tank_id = 2147483648 },
  ])('drops malformed admission facts %#', mutate => {
    const r = result(); mutate(r)
    expect(toCollectorSeed(r)).toBeNull()
  })
})
