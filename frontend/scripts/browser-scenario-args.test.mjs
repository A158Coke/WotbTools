import { describe, expect, it } from 'vitest'
import { parseScenarioArgs, selectShard } from './browser-scenario-args.mjs'

describe('parseScenarioArgs', () => {
  it('defaults to the full list without a filter', () => {
    expect(parseScenarioArgs([])).toEqual({ nameFilter: undefined, shard: null })
  })

  it('accepts pnpm forwarding the -- separator and does not treat the shard value as a name', () => {
    expect(parseScenarioArgs(['--', '--shard', '2/2'])).toEqual({
      nameFilter: undefined,
      shard: { index: 1, total: 2, label: '2/2' },
    })
  })

  it('combines a name filter with a shard in either order', () => {
    expect(parseScenarioArgs(['picker', '--shard', '1/2']).nameFilter).toBe('picker')
    expect(parseScenarioArgs(['--shard', '1/2', 'picker']).nameFilter).toBe('picker')
  })

  it.each([
    [['--shard']],
    [['--shard=1/2']],
    [['--shard', '0/2']],
    [['--shard', '3/2']],
    [['--shard', '1/0']],
    [['--shard', 'foo']],
    [['--shard', '--other']],
  ])('rejects %j instead of falling back to the full list', (argv) => {
    expect(() => parseScenarioArgs(argv)).toThrow(/--shard/)
  })
})

describe('selectShard', () => {
  const scenarios = Array.from({ length: 28 }, (_, index) => `scenario-${index}`)

  it('partitions the list without overlap, gaps or reordering', () => {
    const first = selectShard(scenarios, parseScenarioArgs(['--shard', '1/2']))
    const second = selectShard(scenarios, parseScenarioArgs(['--shard', '2/2']))
    expect(first).toHaveLength(14)
    expect(second).toHaveLength(14)
    expect(first.filter((name) => second.includes(name))).toEqual([])
    expect(new Set([...first, ...second])).toEqual(new Set(scenarios))
    expect(first).toEqual(scenarios.filter((name) => first.includes(name)))
  })

  it('returns the whole list without a shard', () => {
    expect(selectShard(scenarios, parseScenarioArgs([]))).toBe(scenarios)
  })

  it('shards the filtered list', () => {
    const filtered = scenarios.slice(0, 3)
    expect(selectShard(filtered, parseScenarioArgs(['scenario', '--shard', '2/2']))).toEqual(['scenario-1'])
  })

  it('fails when an explicit selection is empty', () => {
    expect(() => selectShard(['only'], parseScenarioArgs(['--shard', '2/2']))).toThrow('no scenario matches')
    expect(() => selectShard([], parseScenarioArgs(['missing']))).toThrow('no scenario matches')
  })
})
