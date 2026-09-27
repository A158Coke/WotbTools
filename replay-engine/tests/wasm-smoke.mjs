// WASM boundary smoke test: loads the wasm-bindgen output in Node and parses a real replay.
//
// This is the "the boundary actually works" gate: it proves the engine runs compiled-to-wasm
// (not just natively) and that identifiers cross the JS boundary as strings.
//
// Usage (from `replay-engine/`): node tests/wasm-smoke.mjs

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const engineDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const glue = path.join(engineDir, 'crates/replay-wasm/pkg/replay_wasm.js')

const require = createRequire(import.meta.url)
const engine = require(glue)

function fail(message) {
  console.error(`FAIL ${message}`)
  process.exit(1)
}

const fixture = path.join(engineDir, '../common/fixtures/replays/random-battle-example.wotbreplay')
const bytes = readFileSync(fixture)

const raw = engine.parse_result(bytes)
const result = JSON.parse(raw)

if (typeof engine.engine_version() !== 'string') fail('engine_version must be a string')
if (typeof result.arena_id !== 'string' || !/^\d+$/.test(result.arena_id)) {
  fail(`arena_id must be a decimal string, got ${JSON.stringify(result.arena_id)}`)
}
if (!Array.isArray(result.participants) || result.participants.length !== 14) {
  fail(`expected 14 participants, got ${result.participants?.length}`)
}
if (![1, 2].includes(result.winner_team)) fail(`unexpected winner_team ${result.winner_team}`)
for (const participant of result.participants) {
  if (typeof participant.game_account_id !== 'string') fail('game_account_id must be a string')
  if (typeof participant.participant_ref !== 'string') fail('participant_ref must be a string')
  if (participant.vehicle_id !== null && typeof participant.vehicle_id !== 'string') {
    fail('vehicle_id must be a string or null')
  }
}
if (!Number.isSafeInteger(result.participants[0].damage_dealt ?? 0)) {
  fail('damage_dealt must stay a small integer')
}

console.log(
  `PASS wasm boundary: arena=${result.arena_id} version=${result.game_version} ` +
    `players=${result.participants.length} winner=${result.winner_team} engine=${engine.engine_version()}`,
)
