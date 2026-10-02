/** Java 语义原语：golden 覆盖不到的边界（-0、指数记法、BigDecimal 求和、CI 排序、Java trim/hasText）。 */

import { describe, expect, it } from 'vitest'

import { DecimalSum, compareIgnoreCase, doubleCompare, hasText, javaRound, javaTrim, r1 } from './java.js'

describe('java primitives', () => {
  it('Math.round：half-up、不产生 -0、NaN → 0', () => {
    expect(javaRound(2.5)).toBe(3)
    expect(javaRound(-2.5)).toBe(-2)
    expect(javaRound(0.49999999999999994)).toBe(0)
    expect(Object.is(javaRound(-0.3), 0)).toBe(true)
    expect(javaRound(Number.NaN)).toBe(0)
    expect(Object.is(r1(-0.01), 0)).toBe(true)
  })

  it('Double.compare：-0.0 < 0.0，NaN 最大', () => {
    expect(doubleCompare(-0, 0)).toBe(-1)
    expect(doubleCompare(Number.NaN, Infinity)).toBe(1)
    expect(doubleCompare(Number.NaN, Number.NaN)).toBe(0)
  })

  it('BigDecimal 精确十进制求和（≠ double 逐项累加）', () => {
    const sum = new DecimalSum()
    sum.add(0.1)
    sum.add(0.2)
    expect(sum.doubleValue()).toBe(0.3)
    expect(0.1 + 0.2).not.toBe(0.3)
    const tiny = new DecimalSum()
    tiny.add(1e-7)
    tiny.add(1.5e21)
    tiny.add(-0)
    expect(tiny.doubleValue()).toBe(Number('1500000000000000000000.0000001'))
  })

  it('CASE_INSENSITIVE_ORDER / trim / hasText 按 Java 语义', () => {
    expect(compareIgnoreCase('maus', 'MAUS')).toBe(0)
    expect(compareIgnoreCase('a', 'B')).toBeLessThan(0)
    expect(compareIgnoreCase('ab', 'a')).toBe(1)
    expect(javaTrim(' x\t ')).toBe(' x')
    expect(hasText(' ')).toBe(true)
    expect(hasText(' 　\t')).toBe(false)
    expect(hasText(null)).toBe(false)
  })
})
