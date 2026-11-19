import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const validator = path.resolve(import.meta.dirname, 'validate-jscpd-report.mjs')

test('requires a valid nonempty baseline comparison report', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'jscpd-report-'))
  const file = path.join(dir, 'report.json')
  const run = () => spawnSync(process.execPath, [validator, file], { encoding: 'utf8' }).status
  try {
    assert.notEqual(run(), 0, 'missing report fails')
    await writeFile(file, '{invalid')
    assert.notEqual(run(), 0, 'malformed report fails')
    for (const report of [
      { statistics: { total: { sources: 0, newClones: 0 } }, duplicates: [] },
      { statistics: { total: { sources: 1 } }, duplicates: [] },
      { statistics: { total: { sources: 1, newClones: 0 } }, duplicates: [{}] },
      { statistics: { total: { sources: 1, newClones: 0 } }, duplicates: [{ isNew: true }] },
    ]) {
      await writeFile(file, JSON.stringify(report))
      assert.notEqual(run(), 0, 'incomplete comparison fails')
    }
    await writeFile(file, JSON.stringify({ statistics: { total: { sources: 1, newClones: 1 } }, duplicates: [{ isNew: true }, { isNew: false }] }))
    assert.equal(run(), 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
