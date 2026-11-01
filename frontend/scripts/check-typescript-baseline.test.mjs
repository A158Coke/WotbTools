import { describe, expect, it } from 'vitest'
import { baselineViolations } from './check-typescript-baseline.mjs'

const baseline = (overrides = {}) => ({
  retained: { 'src/platform/runtime.js': 'Node' },
  p1: ['src/scene/a.js'],
  p2: ['src/utils/b.js'],
  escapeHatches: { 'src/old.ts': { any: 2, asUnknownAs: 1 } },
  ...overrides,
})

describe('baselineViolations', () => {
  it('accepts an unchanged or shrinking baseline', () => {
    expect(baselineViolations(baseline(), baseline())).toEqual([])
    expect(baselineViolations(baseline(), baseline({ p2: [], escapeHatches: { 'src/old.ts': { any: 1, asUnknownAs: 0 } } }))).toEqual([])
    expect(baselineViolations(baseline(), baseline({ escapeHatches: {} }))).toEqual([])
  })

  it('rejects a new module legalized by editing the baseline', () => {
    expect(baselineViolations(baseline(), baseline({ p2: ['src/utils/b.js', 'src/foo.js'] }))).toHaveLength(1)
    expect(baselineViolations(baseline(), baseline({ retained: { 'src/platform/runtime.js': 'Node', 'src/foo.js': 'Node' } }))).toHaveLength(1)
  })

  it('rejects an escape hatch legalized by editing the baseline', () => {
    expect(baselineViolations(baseline(), baseline({ escapeHatches: { 'src/old.ts': { any: 3, asUnknownAs: 1 } } }))).toHaveLength(1)
  })

  it('rejects moving an escape hatch to another file even when the total shrinks', () => {
    const moved = { 'src/old.ts': { any: 0, asUnknownAs: 0 }, 'src/new.ts': { any: 1, asUnknownAs: 0 } }
    expect(baselineViolations(baseline(), baseline({ escapeHatches: moved }))).toEqual(['src/new.ts: any 从 0 增加到 1'])
  })
})
