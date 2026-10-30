import { describe, expect, it } from 'vitest'
import { mapCoverage } from './battleDataCoverage.js'

describe('reviewed coverage from Collector semantics', () => {
  it('includes reviewed maps without observations and retains unknown observed keys', () => {
    const value = mapCoverage([{ key: 'rift', count: 3, latestReceivedAt: '2026-10-29T00:00:00Z' },
      { key: 'unmapped', count: 2, latestReceivedAt: '2026-10-29T00:00:00Z' }])
    expect(value.reviewed.find(row => row.key === 'rift')?.count).toBe(3)
    expect(value.reviewed.find(row => row.key === 'malinovka')?.count).toBe(0)
    expect(value.other.map(row => row.key)).toEqual(['unmapped'])
    // Canonical reviewed universe: 10 maps from common/map-semantics, not DB rows.
    expect(value.reviewed.map(row => row.key).sort()).toEqual([
      'amigosville', 'desert_train', 'erlenberg', 'himmelsdorf', 'malinovka',
      'medvedkovo', 'milbase', 'neptune', 'pliego', 'rift',
    ])
    expect(value.unresolved).toHaveLength(23)
  })
})
