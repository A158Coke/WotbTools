import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { captureName } from './capture-policy.mjs'

const profiler = fileURLToPath(new URL('./prof.mjs', import.meta.url))

function capture(hooks) {
  return captureName({
    tag: '', fixture: 'random-battle-example', scenario: 'follow-mid', rate: 1,
    mode: 'diagnostic', seconds: 30, runId: 'prof-test',
    viewport: { width: 1280, height: 720, dpr: 1 }, hooks,
  })
}

function profilePayload(name) {
  return {
    name,
    profile: {
      p0: 0,
      nodes: [{ id: 1, callFrame: { url: '', functionName: 'frame', lineNumber: 0 }, children: [] }],
      samples: [1, 1],
      timeDeltas: [1000, 1000],
    },
    raf: { ts: [0, 10, 20] },
  }
}

function runProfiler(cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [profiler], { cwd })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
}

test('default discovery accepts captureName profile files and ignores other JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wotb-prof-'))
  const out = join(directory, 'out')
  await mkdir(out)
  const names = [capture(['profile']), capture(['profile', 'trace']), capture(['profile', 'count-anchors'])]
  const legacy = ['legacy_prof.json', 'legacy_prof_noprobe.json']
  try {
    for (const name of [...names, ...legacy.map(name => name.slice(0, -5))]) {
      await writeFile(join(out, name + '.json'), JSON.stringify(profilePayload(name)))
    }
    await writeFile(join(out, 'notes.json'), JSON.stringify({ name: 'not-a-profile' }))

    const { code, stdout, stderr } = await runProfiler(directory)
    assert.equal(code, 0, stderr)
    for (const name of names) assert.ok(stdout.includes(name), name + ' missing from output')
    assert.ok(stdout.includes('legacy_prof'), 'legacy _prof output missing')
    assert.ok(stdout.includes('legacy_prof_noprobe'), 'legacy _prof_noprobe output missing')
    assert.ok(!stdout.includes('not-a-profile'), 'non-profile JSON was parsed')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('empty out/ fails loudly instead of silently succeeding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wotb-prof-empty-'))
  await mkdir(join(directory, 'out'))
  try {
    const { code, stderr } = await runProfiler(directory)
    assert.notEqual(code, 0)
    assert.match(stderr, /No profile captures found in out\//)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
