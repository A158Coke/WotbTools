import type { AgentBattleResult } from '../../api/agent-replay-facets.js'
import type { CollectorSeed } from './collectorWorkerProtocol.js'

/** 主线程仅做有界准入投影；完整 wire validation 在 Worker 发送前执行。 */
export function toCollectorSeed(result: AgentBattleResult): CollectorSeed | null {
  if (!result || (result.arena_bonus_type !== 1 && result.arena_bonus_type !== 7)
    || (result.author_team !== 1 && result.author_team !== 2)
    || ![0, 1, 2].includes(result.winner_team)
    || typeof result.arena_id !== 'string' || !result.arena_id || result.arena_id.length > 20
    || !Number.isInteger(result.map_id) || result.map_id < 1 || result.map_id > 2147483647
    || typeof result.map_key !== 'string' || !result.map_key || result.map_key.length > 128
    || typeof result.client_version !== 'string' || !result.client_version || result.client_version.length > 64
    || !Array.isArray(result.players) || result.players.length !== 14) return null
  const teams: CollectorSeed['teams'] = [{ team: 1, vehicles: [] }, { team: 2, vehicles: [] }]
  for (const player of result.players) {
    if (!player || (player.team !== 1 && player.team !== 2)
      || !Number.isInteger(player.tank_id) || player.tank_id < 1 || player.tank_id > 2147483647) return null
    teams[player.team - 1].vehicles.push(player.tank_id)
  }
  if (teams.some(team => team.vehicles.length !== 7)) return null
  return {
    schemaVersion: 1, arenaId: result.arena_id, arenaBonusType: result.arena_bonus_type,
    mapId: result.map_id, mapKey: result.map_key, clientVersion: result.client_version,
    winnerTeam: result.winner_team as 0 | 1 | 2, authorTeam: result.author_team, teams,
  }
}
