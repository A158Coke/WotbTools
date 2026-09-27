// Local corpus scan for the client engine.
//
// Not a CI test: it walks a directory of *gitignored* research samples (typically
// `common/data/**`, which holds the 11.19 controlled corpus) and reports how the engine behaves
// across versions. CI only runs the committed-fixture parity tests.
//
// Usage (from `replay-engine/`, after building the node boundary):
//   node tests/corpus-scan.mjs ../WotbTools/common/data
//
// `--strict` turns any parse failure into a non-zero exit, so a wider corpus can be used as a local
// gate while remaining informative by default.

import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const engineDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const engine = require(path.join(engineDir, 'crates/replay-wasm/pkg/replay_wasm.js'))

const args = process.argv.slice(2)
const strict = args.includes('--strict')
const root = args.find((argument) => !argument.startsWith('--'))
if (!root) {
  console.error('usage: node tests/corpus-scan.mjs <replay-dir> [--strict]')
  process.exit(2)
}

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.name.toLowerCase().endsWith('.wotbreplay')) yield full
  }
}

const byVersion = new Map()
const failures = []
const arenaIds = new Map()
let parsed = 0
let duplicates = 0
let largestRoster = 0

for (const file of walk(root)) {
  try {
    const result = JSON.parse(engine.parse_result(readFileSync(file)))
    parsed += 1
    largestRoster = Math.max(largestRoster, result.participants.length)
    const version = result.game_version ?? '(no meta version)'
    byVersion.set(version, (byVersion.get(version) ?? 0) + 1)
    if (arenaIds.has(result.arena_id)) duplicates += 1
    arenaIds.set(result.arena_id, file)
  } catch (error) {
    failures.push(`${path.relative(root, file)}: ${error.message ?? error}`)
  }
}

console.log(`parsed=${parsed} failures=${failures.length} distinctArenas=${arenaIds.size} duplicateArenas=${duplicates}`)
console.log(`largestRoster=${largestRoster}`)
for (const [version, count] of [...byVersion].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${version}: ${count}`)
}
if (failures.length) {
  console.log('failures:')
  for (const failure of failures.slice(0, 20)) console.log(`  ${failure}`)
  if (failures.length > 20) console.log(`  ... and ${failures.length - 20} more`)
}
process.exit(strict && failures.length ? 1 : 0)
