import { describe, expect, it } from 'vitest'
import { baselineViolations, inferEscapeHatchTransfers, reexportedModulePaths } from './check-typescript-baseline.mjs'

const baseline = (overrides = {}) => ({
  retained: { 'src/platform/runtime.js': 'Node' },
  p1: ['src/scene/a.js'],
  p2: ['src/utils/b.js'],
  escapeHatches: { 'src/old.ts': { any: 2, asUnknownAs: 1 } },
  ...overrides,
})

const mergedTransferBaseline = (overrides = {}) => baseline({
  escapeHatches: {
    'src/new-a.ts': { any: 1, asUnknownAs: 0 },
    'src/new-b.ts': { any: 1, asUnknownAs: 0 },
    'src/existing.ts': { any: 2, asUnknownAs: 0 },
  },
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

  it('allows an explicit escape-hatch transfer only within the source file budget', () => {
    const base = baseline()
    const head = baseline({
      escapeHatches: {
        'src/old.ts': { any: 0, asUnknownAs: 1 },
        'src/new-a.ts': { any: 1, asUnknownAs: 0 },
        'src/new-b.ts': { any: 1, asUnknownAs: 0 },
      },
    })
    const { transfers, violations } = inferEscapeHatchTransfers(base, head, {
      'src/old.ts': ['src/new-a.ts', 'src/new-b.ts'],
    })
    expect(violations).toEqual([])
    expect(baselineViolations(base, head, transfers)).toEqual([])
  })

  it('rejects transfer growth at a destination or source', () => {
    const base = baseline()
    const destinationsGrew = baseline({
      escapeHatches: { 'src/old.ts': { any: 1, asUnknownAs: 1 }, 'src/new.ts': { any: 2, asUnknownAs: 0 } },
    })
    const sourceDidNotDecrease = baseline({
      escapeHatches: { 'src/old.ts': { any: 2, asUnknownAs: 1 }, 'src/new.ts': { any: 1, asUnknownAs: 0 } },
    })
    const { transfers } = inferEscapeHatchTransfers(base, destinationsGrew, { 'src/old.ts': ['src/new.ts'] })
    expect(baselineViolations(base, destinationsGrew, transfers)).toEqual(['src/old.ts: any 从 0 增加到 1'])
    const sourceTransfer = inferEscapeHatchTransfers(base, sourceDidNotDecrease, { 'src/old.ts': ['src/new.ts'] })
    expect(baselineViolations(base, sourceDidNotDecrease, sourceTransfer.transfers)).toEqual(['src/old.ts: any 从 1 增加到 2'])
  })

  it('rejects a transfer allowance larger than its source budget', () => {
    const head = baseline({
      escapeHatches: { 'src/old.ts': { any: 0, asUnknownAs: 1 }, 'src/new.ts': { any: 3, asUnknownAs: 0 } },
    })
    const inferred = inferEscapeHatchTransfers(baseline(), head, { 'src/old.ts': ['src/new.ts'] })
    expect(baselineViolations(baseline(), head, inferred.transfers)).toContain('src/old.ts: any 迁移额度超过原基线')
  })

  it('does not let one escape-hatch kind consume another kind budget', () => {
    const base = baseline({ escapeHatches: { 'src/old.ts': { any: 2, asUnknownAs: 0 } } })
    const head = baseline({
      escapeHatches: {
        'src/old.ts': { any: 2, asUnknownAs: 0 },
        'src/new.ts': { any: 0, asUnknownAs: 1 },
      },
    })
    const inferred = inferEscapeHatchTransfers(base, head, { 'src/old.ts': ['src/new.ts'] })
    expect(baselineViolations(base, head, inferred.transfers)).toContain('src/old.ts: asUnknownAs 迁移额度超过原基线')
  })

  it('rejects duplicate destinations and transfers that overwrite existing paths', () => {
    const base = baseline({ escapeHatches: {
      'src/old.ts': { any: 2, asUnknownAs: 1 },
      'src/other.ts': { any: 1, asUnknownAs: 0 },
      'src/existing.ts': { any: 0, asUnknownAs: 1 },
    } })
    const head = baseline({
      escapeHatches: {
        'src/old.ts': { any: 1, asUnknownAs: 1 },
        'src/other.ts': { any: 1, asUnknownAs: 0 },
        'src/existing.ts': { any: 0, asUnknownAs: 1 },
        'src/new.ts': { any: 1, asUnknownAs: 0 },
      },
    })
    const duplicate = inferEscapeHatchTransfers(base, head, {
      'src/old.ts': ['src/new.ts'],
      'src/other.ts': ['src/new.ts'],
    })
    expect(duplicate.violations).toContain('src/new.ts: escape hatch split 目标必须只有一个旧基线来源')
    const overwroteExisting = baseline({
      escapeHatches: {
        'src/old.ts': { any: 1, asUnknownAs: 0 },
        'src/existing.ts': { any: 1, asUnknownAs: 1 },
      },
    })
    const overwritten = inferEscapeHatchTransfers(base, overwroteExisting, { 'src/old.ts': ['src/existing.ts'] })
    expect(overwritten.transfers).toEqual({})
    expect(baselineViolations(base, overwroteExisting)).toContain('src/existing.ts: any 从 0 增加到 1')
  })

  it('rejects transferring a budget to a base-tree file with no prior escape hatches', () => {
    const base = baseline({ escapeHatches: { 'src/old.ts': { any: 2, asUnknownAs: 0 } } })
    const head = baseline({
      escapeHatches: {
        'src/old.ts': { any: 1, asUnknownAs: 0 },
        'src/existing-zero-any.ts': { any: 1, asUnknownAs: 0 },
      },
    })
    const inferred = inferEscapeHatchTransfers(base, head, {
      'src/old.ts': ['src/existing-zero-any.ts'],
    }, new Set(['src/old.ts', 'src/existing-zero-any.ts']))
    expect(inferred.transfers).toEqual({})
    expect(inferred.violations).toEqual(['src/existing-zero-any.ts: 不得把预算转入基线中已存在的文件'])
    expect(baselineViolations(base, head, inferred.transfers)).toContain('src/existing-zero-any.ts: any 从 0 增加到 1')
  })

  it('treats a migration already present in the base as settled', () => {
    const base = mergedTransferBaseline()
    const inferred = inferEscapeHatchTransfers(base, base, {
      'src/old.ts': ['src/new-a.ts', 'src/new-b.ts'],
    })
    expect(inferred.transfers).toEqual({})
    expect(baselineViolations(base, base, inferred.transfers)).toEqual([])
  })

  it('allows ordinary follow-up changes after the migration is in the base', () => {
    const base = mergedTransferBaseline()
    const head = mergedTransferBaseline({
      escapeHatches: {
        ...base.escapeHatches,
        'src/existing.ts': { any: 1, asUnknownAs: 0 },
      },
    })
    const inferred = inferEscapeHatchTransfers(base, head, {
      'src/old.ts': ['src/new-a.ts', 'src/new-b.ts'],
    })
    expect(baselineViolations(base, head, inferred.transfers)).toEqual([])
  })

  it('does not reuse a settled transfer to grow its target again', () => {
    const base = mergedTransferBaseline()
    const head = mergedTransferBaseline({
      escapeHatches: {
        ...base.escapeHatches,
        'src/new-a.ts': { any: 2, asUnknownAs: 0 },
      },
    })
    const inferred = inferEscapeHatchTransfers(base, head, {
      'src/old.ts': ['src/new-a.ts', 'src/new-b.ts'],
    })
    expect(baselineViolations(base, head, inferred.transfers)).toContain('src/new-a.ts: any 从 1 增加到 2')
  })

  it('applies a new transfer when main already contains a settled migration', () => {
    const base = mergedTransferBaseline({
      escapeHatches: {
        ...mergedTransferBaseline().escapeHatches,
        'src/parallel-source.ts': { any: 3, asUnknownAs: 0 },
      },
    })
    const head = mergedTransferBaseline({
      escapeHatches: {
        'src/new-a.ts': { any: 1, asUnknownAs: 0 },
        'src/new-b.ts': { any: 1, asUnknownAs: 0 },
        'src/existing.ts': { any: 2, asUnknownAs: 0 },
        'src/parallel-target.ts': { any: 3, asUnknownAs: 0 },
      },
    })
    const inferred = inferEscapeHatchTransfers(base, head, {
      'src/old.ts': ['src/new-a.ts', 'src/new-b.ts'],
      'src/parallel-source.ts': ['src/parallel-target.ts'],
    })
    expect(inferred.violations).toEqual([])
    expect(baselineViolations(base, head, inferred.transfers)).toEqual([])
  })

  it('derives split destinations from direct facade re-exports', () => {
    const paths = reexportedModulePaths(
      'src/compute/setup.ts',
      "export { core } from './core'\nexport * from './helpers'\nimport value from './other'",
      path => {
        const normalized = path.replaceAll('\\', '/')
        return normalized.endsWith('/src/compute/core.ts') || normalized.endsWith('/src/compute/helpers.ts')
      },
    )
    expect(paths.sort()).toEqual(['src/compute/core.ts', 'src/compute/helpers.ts'])
  })

  it('maps a .js module specifier to its TypeScript source file', () => {
    const paths = reexportedModulePaths(
      'src/compute/setup.ts',
      "export * from './core.js'",
      path => path.replaceAll('\\', '/').endsWith('/src/compute/core.ts'),
    )
    expect(paths).toEqual(['src/compute/core.ts'])
  })
})
