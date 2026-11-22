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
    const validClone = {
      isNew: true,
      firstFile: { name: '/repo/src/first.ts', start: 12, end: 24, startLoc: { line: 12 }, endLoc: { line: 24 } },
      secondFile: { name: '/repo/src/second.ts', start: 30, end: 42, startLoc: { line: 30 }, endLoc: { line: 42 } },
      format: 'typescript', lines: 13, tokens: 66,
    }
    await writeFile(file, JSON.stringify({ statistics: { total: { sources: 2, newClones: 1 } }, duplicates: [validClone] }))
    assert.equal(run(), 0)
    for (const invalid of [
      { ...validClone, secondFile: undefined },
      { ...validClone, firstFile: { ...validClone.firstFile, name: '  ' } },
      { ...validClone, firstFile: { ...validClone.firstFile, start: 0 } },
      { ...validClone, secondFile: { ...validClone.secondFile, end: 29 } },
      { ...validClone, firstFile: { ...validClone.firstFile, startLoc: { line: 13 } } },
      { ...validClone, secondFile: { ...validClone.secondFile, endLoc: { line: 28 } } },

    ]) {
      await writeFile(file, JSON.stringify({ statistics: { total: { sources: 2, newClones: 1 } }, duplicates: [invalid] }))
      assert.notEqual(run(), 0, 'new clone without complete source positions fails')
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
