import { describe, expect, it } from 'vitest'
import {
  normalizeMissing, compareValues, stableSortRows, nextDirection
} from './tableSort.js'

describe('normalizeMissing', () => {
  it('normalizes null/undefined/empty/NaN/-- to missing', () => {
    expect(normalizeMissing(null)).not.toBe(null)
    expect(normalizeMissing(undefined)).not.toBe(undefined)
    expect(normalizeMissing('')).not.toBe('')
    expect(normalizeMissing(NaN)).not.toBe(NaN)
    expect(normalizeMissing('--')).not.toBe('--')
  })
  it('keeps real values', () => {
    expect(normalizeMissing(0)).toBe(0)
    expect(normalizeMissing('0')).toBe('0')
    expect(normalizeMissing(100)).toBe(100)
  })
})

describe('compareValues numeric', () => {
  const sort = values => values.slice().sort((a, b) => compareValues(a, b, { num: true }))
  it('sorts 100/9/21 numerically asc: 9 21 100', () => {
    expect(sort([100, 9, 21])).toEqual([9, 21, 100])
  })
  it('sorts desc via direction: 100 21 9', () => {
    expect([100, 9, 21].slice().sort((a, b) => -compareValues(a, b, { num: true }))).toEqual([100, 21, 9])
  })
  it('string numbers are not lexicographic', () => {
    expect(sort(['100', '20', '3'])).toEqual(['3', '20', '100'])
  })
  it('missing always last regardless of direction (via stableSortRows)', () => {
    const asc = [null, 50, 20, '--', 100].map(v => ({ cells: { v } }))
    expect(stableSortRows(asc, { key: 'v', direction: 1, num: true }).map(r => r.cells.v))
      .toEqual([20, 50, 100, null, '--'])
    expect(stableSortRows(asc, { key: 'v', direction: -1, num: true }).map(r => r.cells.v))
      .toEqual([100, 50, 20, null, '--'])
  })
})

describe('compareValues string', () => {
  it('natural order Player1 Player2 Player10', () => {
    const vals = ['Player10', 'Player2', 'Player1']
    expect(vals.slice().sort((a, b) => compareValues(a, b, { num: false })))
      .toEqual(['Player1', 'Player2', 'Player10'])
  })
  it('missing last for strings', () => {
    const vals = ['B', '', 'A', null]
    expect(vals.slice().sort((a, b) => compareValues(a, b, { num: false })))
      .toEqual(['A', 'B', '', null])
  })
})

describe('stableSortRows', () => {
  const rows = [
    { cells: { rating: 927.4, name: 'P1' } },
    { cells: { rating: 812.6, name: 'P2' } },
    { cells: { rating: null, name: 'P3' } },
    { cells: { rating: 927.4, name: 'P4' } },
  ]
  it('sorts by raw numeric asc (812→927, ties stable), missing last', () => {
    const out = stableSortRows(rows, { key: 'rating', direction: 1, num: true })
    expect(out.map(r => r.cells.name)).toEqual(['P2', 'P1', 'P4', 'P3'])
  })
  it('desc (927→812) keeps missing last, ties stable', () => {
    const out = stableSortRows(rows, { key: 'rating', direction: -1, num: true })
    expect(out.map(r => r.cells.name)).toEqual(['P1', 'P4', 'P2', 'P3'])
  })
  it('does not mutate input', () => {
    const before = rows.map(r => r.cells.name)
    stableSortRows(rows, { key: 'rating', direction: 1, num: true })
    expect(rows.map(r => r.cells.name)).toEqual(before)
  })
  it('supports valueGetter for formatted-vs-raw', () => {
    const rawRows = [
      { cells: { rating: '342 / 400 · 85.5%' }, raw: 342.1 },
      { cells: { rating: '400 / 400 · 100%' }, raw: 400 },
      { cells: { rating: '250 / 400 · 62.5%' }, raw: 250.2 },
    ]
    const out = stableSortRows(rawRows, { key: 'rating', direction: 1, num: true, valueGetter: r => r.raw })
    expect(out.map(r => r.cells.rating)).toEqual([
      '250 / 400 · 62.5%', '342 / 400 · 85.5%', '400 / 400 · 100%'
    ])
  })
  it('supports tiebreakGetter', () => {
    const rows2 = [
      { cells: { k: 'a' }, tb: 2 },
      { cells: { k: 'a' }, tb: 1 },
    ]
    const out = stableSortRows(rows2, { key: 'k', direction: 1, num: false, tiebreakGetter: r => r.tb })
    expect(out.map(r => r.tb)).toEqual([1, 2])
  })
})

describe('nextDirection', () => {
  it('first click asc, second desc, third asc (no unsorted)', () => {
    expect(nextDirection(null, 'rating', 1)).toBe(1)
    expect(nextDirection('rating', 'rating', 1)).toBe(-1)
    expect(nextDirection('rating', 'rating', -1)).toBe(1)
  })
  it('switching key resets to asc', () => {
    expect(nextDirection('rating', 'damage', -1)).toBe(1)
  })
})