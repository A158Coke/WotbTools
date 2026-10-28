import { describe, expect, it } from 'vitest'
import { formatXpCompact } from './xpFormat.js'

describe('formatXpCompact（研发 XP 紧凑显示）', () => {
  it('千位以下原样', () => {
    expect(formatXpCompact(0)).toBe('')
    expect(formatXpCompact(45)).toBe('45')
    expect(formatXpCompact(500)).toBe('500')
  })

  it('千位按 k 缩写，1 位小数去尾 .0', () => {
    expect(formatXpCompact(2000)).toBe('2k')
    expect(formatXpCompact(2500)).toBe('2.5k')
    expect(formatXpCompact(5000)).toBe('5k')
    expect(formatXpCompact(31000)).toBe('31k')
    expect(formatXpCompact(75000)).toBe('75k')
    expect(formatXpCompact(101500)).toBe('101.5k')
  })

  it('非法/负数/缺省返回空串（不显示假数字）', () => {
    expect(formatXpCompact(null)).toBe('')
    expect(formatXpCompact(undefined)).toBe('')
    expect(formatXpCompact(-5)).toBe('')
    expect(formatXpCompact('abc')).toBe('')
  })
})
