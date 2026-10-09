/** Deterministic parse boundary for the browser shots → armor handoff. */
import * as real from '/src/api/agent-replay-facets.ts'
export * from '/src/api/agent-replay-facets.ts'

const enabled = new URLSearchParams(location.search).get('ws-shot-fixture') === '1'
const calls = { playback: 0, shots: 0 }
if (enabled) window.__wsShotParse = calls

export async function parseAgentPlaybackFromBytes(...args) {
  if (!enabled) return real.parseAgentPlaybackFromBytes(...args)
  calls.playback += 1
  return { vehicles: [
    { eid: 7, nickname: 'Fixture shooter', tank_name: 'T-34', tank_id: 1, tank_type: 'mediumTank', team: 1, is_author: true },
    { eid: 8, nickname: 'Fixture target', tank_name: 'Tiger II', tank_id: 2, tank_type: 'heavyTank', team: 2 },
  ] }
}

export async function parseAgentShotsFromBytes(...args) {
  if (!enabled) return real.parseAgentShotsFromBytes(...args)
  calls.shots += 1
  return {
    author_path: 'ok', author_eid: 7,
    shots: [{
      index: 1, time_s: 12, shooter_eid: 7, target_eid: 8,
      shooter_name: 'Fixture shooter', target_name: 'Fixture target',
      shooter_tank_id: 1, target_tank_id: 2, target_config_idx: 1,
      is_author: true, shell_slot: 2, shell_id: 0, damage: 100,
      hit_flags: 0x10, game_hit_result: 3,
      ball_a: [0, 0, 0], ball_b: [10, 0, 0], target_pos: [10, 0, 0],
      target_ang: [0, 0, 0],
    }, {
      index: 2, time_s: 16, shooter_eid: 8, target_eid: 7,
      shooter_name: 'Fixture target', target_name: 'Fixture shooter',
      shooter_tank_id: 2, target_tank_id: 1,
      is_author: false, shell_slot: 0, shell_id: 0, damage: 50,
      hit_flags: 0x10, game_hit_result: 3,
      ball_a: [10, 0, 0], ball_b: [0, 0, 0], target_pos: [0, 0, 0], target_ang: [0, 0, 0],
    }, {
      index: 3, time_s: 24, shooter_eid: 7, target_eid: 8,
      shooter_name: 'Fixture shooter', target_name: 'Fixture target',
      shooter_tank_id: 1, target_tank_id: 2, target_config_idx: 1,
      is_author: true, shell_slot: 2, shell_id: 0, damage: 120,
      hit_flags: 0x10, game_hit_result: 3,
      ball_a: [0, 0, 0], ball_b: [10, 0, 0], target_pos: [10, 0, 0], target_ang: [0, 0, 0],
    }],
  }
}
