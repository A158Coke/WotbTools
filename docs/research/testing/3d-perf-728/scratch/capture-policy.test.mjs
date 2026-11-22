import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureName, capturePolicy, verifySceneResources, verifyScoredEntry } from './capture-policy.mjs'
import { startTimelineTrace } from './trace.mjs'

test('scoring rejects diagnostic hooks and requires a safe run identifier', () => {
  for (const flag of ['--trace', '--profile', '--count-anchors']) {
    assert.throws(() => capturePolicy(['--no-perf', '--run-id=pair1', flag], 30), /diagnostic hooks/)
  }
  assert.throws(() => capturePolicy(['--no-perf'], 30), /run-id/)
  assert.throws(() => capturePolicy(['--run-id=../bad'], 30), /run-id/)
  assert.deepEqual(capturePolicy(['--no-perf', '--run-id=pair1'], 30), { mode: 'score', seconds: 30, runId: 'pair1' })
})

test('mode, duration and run identifier distinguish capture paths', () => {
  const base = { tag: '', fixture: 'random-battle-example', scenario: 'follow-mid', rate: 1 }
  const name = policy => captureName({ ...base, ...policy })
  const score = name(capturePolicy(['--no-perf', '--run-id=pair1'], 30))
  assert.notEqual(score, name(capturePolicy(['--run-id=pair1'], 30)))
  assert.notEqual(score, name(capturePolicy(['--no-perf', '--run-id=pair1'], 60)))
  assert.notEqual(score, name(capturePolicy(['--no-perf', '--run-id=pair2'], 30)))
})

test('a diagnostic trace cannot overwrite an existing report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wotb-trace-'))
  const path = join(directory, 'trace.json')
  await writeFile(path, 'original')
  let completed
  const client = {
    on: (_event, callback) => { completed = callback },
    send: async method => {
      if (method === 'Tracing.end') completed({ stream: 'trace-stream', dataLossOccurred: false })
      return {}
    },
  }
  try {
    const save = await startTimelineTrace(client)
    await assert.rejects(save(path), { code: 'EEXIST' })
    assert.equal(await readFile(path, 'utf8'), 'original')
  } finally {
    await unlink(path)
    await rmdir(directory)
  }
})

test('score accepts only a production entry matching the independently registered digest', () => {
  const sha256 = 'a'.repeat(64)
  const entry = { path: '/assets/index.js', sha256 }
  verifyScoredEntry(entry, sha256)
  assert.throws(() => verifyScoredEntry(entry), /registered/)
  assert.throws(() => verifyScoredEntry(null, sha256), /registered/)
  assert.throws(() => verifyScoredEntry(entry, 'b'.repeat(64)), /registered/)
  assert.throws(() => verifyScoredEntry({ ...entry, path: '/src/main.ts' }, sha256), /registered/)
})

test('every loaded terrain, scenery and vehicle must belong to the registered dataset', () => {
  const root = 'https://assets.example/v/A'
  const version = { dataset_id: 'A', content_digest: 'sha256:' + '0'.repeat(64) }
  const urls = ['map/demo/terrain.u16.bin', 'map/demo/scenery.glb', 'glb/123/model.glb'].map(path => root + '/' + path)
  const check = entries => verifySceneResources(entries, root, version, 'A', true)
  assert.equal(check([...urls, 'https://assets.example/shared/font.woff2']).vehicles.length, 1)
  for (const url of urls) assert.throws(() => check([...urls, url.replace('/A/', '/B/')]), /Mixed/)
  assert.throws(() => check(urls.slice(0, 2)), /Missing/)
})
