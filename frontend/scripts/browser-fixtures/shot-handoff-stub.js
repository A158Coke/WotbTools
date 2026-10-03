/** Deterministic parse boundary for the browser shots → armor handoff. */
import * as real from '/src/api/agent-replay-facets.ts'
export * from '/src/api/agent-replay-facets.ts'

const enabled = new URLSearchParams(location.search).get('ws-shot-fixture') === '1'
const calls = { playback: 0, shots: 0 }
if (enabled) window.__wsShotParse = calls

export async function parseAgentPlaybackFromBytes(...args) {
  if (!enabled) return real.parseAgentPlaybackFromBytes(...args)
  calls.playback += 1
  return { vehicles: [] }
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
    }],
  }
}
