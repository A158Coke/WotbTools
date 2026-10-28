import { describe, expect, it } from 'vitest'
import { romanLevel } from './tierFormat.js'

describe('romanLevel（等级统一罗马数字）', () => {
  it('1..11 → I..XI', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(romanLevel))
      .toEqual(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'])
  })

  it('非法/缺省返回空串（不显示假等级）', () => {
    expect(romanLevel(0)).toBe('')
    expect(romanLevel(-1)).toBe('')
    expect(romanLevel(null)).toBe('')
    expect(romanLevel(undefined)).toBe('')
    expect(romanLevel('abc')).toBe('')
    expect(romanLevel(12)).toBe('12') // 超出 XI 时退化为数字，不吞值
  })
})
