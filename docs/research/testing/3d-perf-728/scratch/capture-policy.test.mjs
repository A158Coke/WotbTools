import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureName, capturePolicy, verifySceneResources, verifyScoredEntry, verifyScoredFrames, verifyScoredScene } from './capture-policy.mjs'
import { startTimelineTrace } from './trace.mjs'

test('scoring rejects diagnostic hooks and requires a safe run identifier', () => {
  for (const flag of ['--trace', '--profile', '--count-anchors']) {
    assert.throws(() => capturePolicy(['--no-perf', '--run-id=pair1', flag], 30), /diagnostic hooks/)
  }
  assert.throws(() => capturePolicy(['--no-perf'], 30), /run-id/)
  assert.throws(() => capturePolicy(['--run-id=../bad'], 30), /run-id/)
  assert.deepEqual(capturePolicy(['--no-perf', '--run-id=pair1'], 30), { mode: 'score', seconds: 30, runId: 'pair1', hooks: [] })
  assert.deepEqual(capturePolicy(['--trace', '--run-id=diag1'], 60).hooks, ['trace'])
})

test('mode, duration, run identifier, window and hooks distinguish capture paths', () => {
  const base = { tag: '', fixture: 'random-battle-example', scenario: 'follow-mid', rate: 1, viewport: { width: 1280, height: 720, dpr: 1 } }
  const name = (policy, viewport = base.viewport) => captureName({ ...base, ...policy, viewport })
  const score = name(capturePolicy(['--no-perf', '--run-id=pair1'], 30))
  assert.notEqual(score, name(capturePolicy(['--run-id=pair1'], 30)))
  assert.notEqual(score, name(capturePolicy(['--no-perf', '--run-id=pair1'], 60)))
  assert.notEqual(score, name(capturePolicy(['--no-perf', '--run-id=pair2'], 30)))
  assert.notEqual(score, name(capturePolicy(['--no-perf', '--run-id=pair1'], 30), { width: 1920, height: 1080, dpr: 2 }))
  assert.notEqual(
    name(capturePolicy(['--run-id=pair1'], 30)),
    name(capturePolicy(['--run-id=pair1', '--trace'], 30)),
  )
  assert.throws(() => name(capturePolicy(['--no-perf', '--run-id=pair1'], 30), null), /viewport/)
})

test('score mode reads the production page state without enabling ?perf', () => {
  const expectedInputSha256 = 'a'.repeat(64)
  const canvas = { webgl: {}, width: 1280, height: 720 }
  const observed = {
    url: 'https://wotbtools.com/?view=replay',
    perfHandle: false,
    inputSha256: expectedInputSha256,
    expectedInputSha256,
    camera: 'top',
    followed: false,
    expectedCamera: 'top',
    quality: 'high',
    expectedQuality: 'high',
    canvas,
  }
  assert.equal(verifyScoredScene(observed).camera, 'top')
  assert.equal(verifyScoredScene({ ...observed, expectedCamera: 'follow', camera: 'free', followed: true }).camera, 'follow')
  assert.throws(() => verifyScoredScene({ ...observed, url: 'https://wotbtools.com/?view=replay&perf' }), /\?perf/)
  assert.throws(() => verifyScoredScene({ ...observed, perfHandle: true }), /\?perf/)
  assert.throws(() => verifyScoredScene({ ...observed, inputSha256: 'b'.repeat(64) }), /input/)
  assert.throws(() => verifyScoredScene({ ...observed, inputSha256: null }), /input/)
  assert.equal(verifyScoredScene({ ...observed, inputSha256: undefined, expectedInputSha256: undefined, inputFiles: ['C:\\fixtures\\battle.wotbreplay'], expectedInput: 'C:\\fixtures\\battle.wotbreplay' }).camera, 'top')
  assert.throws(() => verifyScoredScene({ ...observed, camera: 'free' }), /camera/)
  assert.throws(() => verifyScoredScene({ ...observed, expectedCamera: 'follow' }), /camera/)
  assert.throws(() => verifyScoredScene({ ...observed, quality: 'mid' }), /quality/)
  assert.throws(() => verifyScoredScene({ ...observed, canvas: { webgl: null, width: 1280, height: 720 } }), /WebGL/)
  assert.throws(() => verifyScoredScene({ ...observed, canvas: { webgl: {}, width: 0, height: 720 } }), /WebGL/)
})

test('score mode requires presented frames across the measured window', () => {
  const frames = Array.from({ length: 12 }, (_, index) => ({ at: index * 1000, hash: index % 2 ? 'a' : 'b' }))
  assert.equal(verifyScoredFrames(frames, { durationMs: 10_000 }).frames, 11)
  assert.throws(() => verifyScoredFrames(frames.slice(0, 3), { durationMs: 10_000 }), /too few/)
  assert.throws(() => verifyScoredFrames(frames.slice(0, 5), { durationMs: 10_000 }), /only span/)
  assert.throws(() => verifyScoredFrames(frames.map(frame => ({ ...frame, hash: 'a' })), { durationMs: 10_000 }), /frozen/)
  // 开头有变化、最后 25% 冻结：不是持续绘制。
  assert.throws(() => verifyScoredFrames(frames.map((frame, index) => ({ ...frame, hash: index < 6 ? 'a' : 'b' })), { durationMs: 10_000 }), /stopped drawing/)
  // 只采样窗口两端（中间 23 s 没有 canvas 证据）也必须拒收，不能只看 span。
  const gapped = [
    { at: 0, hash: 'a' }, { at: 1000, hash: 'b' }, { at: 2000, hash: 'c' },
    { at: 29_000, hash: 'd' }, { at: 30_000, hash: 'e' },
  ]
  assert.throws(() => verifyScoredFrames(gapped, { durationMs: 30_000 }), /gap/)
  // 30 s 窗口只覆盖前半或后半：即使 span 达到 50%，首尾不贴窗口也必须拒收。
  const firstHalf = Array.from({ length: 16 }, (_, index) => ({ at: index * 1000, hash: index % 2 ? 'a' : 'b' }))
  assert.throws(() => verifyScoredFrames(firstHalf, { durationMs: 30_000 }), /before the window ended/)
  const secondHalf = Array.from({ length: 16 }, (_, index) => ({ at: 14_000 + index * 1000, hash: index % 2 ? 'a' : 'b' }))
  assert.throws(() => verifyScoredFrames(secondHalf, { durationMs: 30_000 }), /into the window/)
  // 只改 HUD 不会进 canvas 哈希：整段同一帧（哪怕颜色正常）仍是冻结。
  const hudOnly = frames.map(frame => ({ ...frame, hash: 'same', colors: 12 }))
  assert.throws(() => verifyScoredFrames(hudOnly, { durationMs: 10_000 }), /frozen/)
  assert.throws(() => verifyScoredFrames(frames.map(frame => ({ ...frame, colors: 1 })), { durationMs: 10_000 }), /blank/)
  // 窗口内 0–22.5 s 正常、22.5–30 s 冻结，31.5 s 才又变化：窗口外的帧必须不影响判定。
  const lateChange = [
    ...Array.from({ length: 10 }, (_, index) => ({ at: index * 2500, hash: 'a' })),
    { at: 31_500, hash: 'b' },
  ]
  assert.throws(() => verifyScoredFrames(lateChange, { durationMs: 30_000 }), /before the window ended|stopped drawing/)
})

test('diagnostic mode never creates the scored canvas PBO probe', () => {
  const source = readFileSync(new URL('./run.mjs', import.meta.url), 'utf8')
  const guard = source.indexOf('if (scoreMode) {')
  const creation = source.indexOf('window.__canvasProbe = {')
  assert.ok(guard > 0, 'score-mode guard is missing')
  assert.ok(guard < creation, 'PBO probe must be created inside the score-mode guard')
  assert.ok(source.indexOf('window.__canvasProbe = null') < guard, 'diagnostic mode must leave the probe unset')
  assert.match(source, /if \(now > start \+ duration\) \{\s+window\.__canvasProbe\.stopped = true\s+return/)
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
  assert.throws(() => check([...urls, root + '/map/other/terrain.u16.bin']), /Mixed map/)
  assert.throws(() => verifySceneResources(urls, null, version, 'A', true), /BENCH_ASSET_ROOT/)
})
