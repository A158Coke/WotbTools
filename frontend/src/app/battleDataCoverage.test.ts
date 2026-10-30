import { describe, expect, it } from 'vitest'
import { mapCoverage, spawnSideKey, spawnTables } from './battleDataCoverage.js'

const latest = '2026-10-29T00:00:00Z'
const stat = (mapKey: string, arenaBonusType: 1 | 7 | null, side: 'NORTH' | 'SOUTH' | 'WEST' | 'EAST', wins: number, draws: number, losses: number) =>
  ({ mapKey, arenaBonusType, side, battles: wins + draws + losses, wins, draws, losses })

describe('reviewed coverage from Collector semantics', () => {
  it('includes reviewed maps without observations and retains unknown observed keys', () => {
    const value = mapCoverage([{ key: 'rift', count: 3, latestReceivedAt: latest }, { key: 'unmapped', count: 2, latestReceivedAt: latest }])
    expect(value.reviewed.find(row => row.key === 'rift')?.count).toBe(3)
    expect(value.reviewed.find(row => row.key === 'malinovka')?.count).toBe(0)
    expect(value.other.map(row => row.key)).toEqual(['unmapped'])
    // Canonical universe: every semantic with a replay mapCode. Semantic-only files stay out.
    expect(value.reviewed).toHaveLength(29)
    expect(value.reviewed.map(row => row.key)).toContain('karieri')
    expect(value.reviewed.map(row => row.key)).not.toContain('06_rudniki_rd')
    expect(value).not.toHaveProperty('unresolved')
  })
})

describe('spawn side tables', () => {
  const stats = [
    stat('rift', null, 'NORTH', 2, 1, 1), stat('rift', null, 'SOUTH', 1, 1, 2),
    stat('rift', 1, 'NORTH', 2, 1, 0), stat('rift', 1, 'SOUTH', 0, 1, 2),
    stat('rift', 7, 'NORTH', 0, 0, 1), stat('rift', 7, 'SOUTH', 1, 0, 0),
    stat('karieri', null, 'WEST', 1, 0, 0), stat('karieri', null, 'EAST', 0, 0, 1),
  ]
  const coverage = mapCoverage([{ key: 'rift', count: 4, latestReceivedAt: latest }, { key: 'karieri', count: 1, latestReceivedAt: latest }])

  it('keeps Copperfield on its own west/east axis', () => {
    const tables = spawnTables(coverage, stats, 'ALL')
    expect(tables.map(table => table.axis)).toEqual([['NORTH', 'SOUTH'], ['WEST', 'EAST']])
    expect(tables[1].rows.map(row => row.key)).toEqual(['karieri'])
    expect(tables[0].rows.map(row => row.key)).not.toContain('karieri')
  })
  it('switches rows by mode without changing the fact counts', () => {
    const rift = (mode: 'ALL' | 'RANDOM' | 'RATING') => spawnTables(coverage, stats, mode)[0].rows.find(row => row.key === 'rift')!
    expect(rift('ALL')).toMatchObject({ battles: 4, draws: 1, sides: [{ side: 'NORTH', wins: 2, losses: 1 }, { side: 'SOUTH', wins: 1, losses: 2 }] })
    expect(rift('RANDOM')).toMatchObject({ battles: 3, draws: 1, sides: [{ wins: 2 }, { wins: 0 }] })
    expect(rift('RATING')).toMatchObject({ battles: 1, draws: 0, sides: [{ wins: 0 }, { wins: 1 }] })
  })
  it('lists a reviewed map with zero observations and never loses unmapped stored rows', () => {
    const value = mapCoverage([{ key: 'unmapped', count: 1, latestReceivedAt: latest }])
    const tables = spawnTables(value, [stat('unmapped', null, 'WEST', 1, 0, 0), stat('unmapped', null, 'EAST', 0, 0, 1)], 'RANDOM')
    expect(tables[0].rows.find(row => row.key === 'erlenberg')).toMatchObject({ battles: 0, draws: 0 })
    expect(tables[1].rows.find(row => row.key === 'unmapped')).toMatchObject({ observedOnly: true, battles: 0 })
  })
  it('maps sides to presentation keys only', () => {
    expect((['NORTH', 'SOUTH', 'WEST', 'EAST'] as const).map(spawnSideKey)).toEqual(['top', 'bottom', 'west', 'east'])
  })
})
