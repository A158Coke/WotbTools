import { describe, expect, it } from 'vitest'
import { gunMarksCount, gunMarksByAccount } from './gunMarks.js'

describe('earned gun marks', () => {
  it('keeps only explicit integer counts, including a real zero', () => {
    for (const n of [0, 1, 2, 3]) expect(gunMarksCount(n)).toBe(n)
    for (const value of [null, undefined, '', '2', false, NaN, Infinity, -1, 4, 1.5]) expect(gunMarksCount(value)).toBeNull()
  })
  it('indexes replay-local accounts without inventing missing marks or mutating the owner', () => {
    const result = { players: [{ account_id: 7, gun_marks: 2 }, { account_id: 8, gun_marks: 0 }, { account_id: 9 }, { account_id: 0, gun_marks: 3 }] }
    const before = JSON.stringify(result)
    expect([...gunMarksByAccount(result)]).toEqual([[7, 2], [8, 0], [9, null]])
    expect(JSON.stringify(result)).toBe(before)
    expect(gunMarksByAccount(null).size).toBe(0)
    expect([...gunMarksByAccount({ players: [{ account_id: 7, gun_marks: 1 }] })]).toEqual([[7, 1]])
  })
})
