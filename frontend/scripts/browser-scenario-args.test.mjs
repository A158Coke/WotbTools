import { describe, expect, it } from 'vitest'
import { parseScenarioArgs, selectShard } from './browser-scenario-args.mjs'

function shardsOf(scenarios, total) {
  return Array.from({ length: total }, (_, index) =>
    selectShard(scenarios, parseScenarioArgs(['--shard', `${index + 1}/${total}`])),
  )
}

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

  // 分片不变量对任意 n 成立：用与真实门禁同规模的两组输入覆盖 n = 1..4。
  it.each([
    ['28', Array.from({ length: 28 }, (_, index) => `scenario-${index}`)],
    ['166', Array.from({ length: 166 }, (_, index) => `scenario-${index}`)],
  ])('partitions %s scenarios for n = 1, 2, 3 and 4', (_label, list) => {
    for (const total of [1, 2, 3, 4]) {
      const shards = shardsOf(list, total)
      expect(shards.flat()).toHaveLength(list.length)
      expect(new Set(shards.flat())).toEqual(new Set(list))
      const sizes = shards.map((shard) => shard.length)
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
      for (const [index, shard] of shards.entries()) {
        // 片内顺序必须与全集一致；并集完整与互斥由上面的 length + Set 证明。
        expect(shard).toEqual(list.filter((name) => shard.includes(name)))
        for (const other of shards.slice(index + 1)) {
          expect(shard.filter((name) => other.includes(name))).toEqual([])
        }
      }
    }
  })

  it('fails when a shard is empty for a larger n', () => {
    expect(() => selectShard(['only'], parseScenarioArgs(['--shard', '3/3']))).toThrow('no scenario matches')
    expect(() => selectShard(['a', 'b'], parseScenarioArgs(['--shard', '3/4']))).toThrow('no scenario matches')
  })
})
