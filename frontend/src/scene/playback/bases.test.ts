import { describe, expect, it } from 'vitest'
import { basesForVariant } from './bases.js'

const entry = {
  supremacy: [{ baseId: 'A', x: 0, y: 0 }],
  assault: [{ x: 1, y: 0 }],
  variants: {
    nt1: { supremacy: [], assault: [{ x: 56.7, y: 8 }] },
    nt2: { supremacy: [], assault: [{ x: -174.8, y: 8 }] },
  },
}

describe('basesForVariant', () => {
  it('按标签取该变体组', () => {
    expect(basesForVariant(entry, 'nt1')?.assault?.[0]?.x).toBe(56.7)
    expect(basesForVariant(entry, 'nt2')?.assault?.[0]?.x).toBe(-174.8)
  })

  it('缺标签 / 未知标签 / 无数据 → 回退基础组', () => {
    expect(basesForVariant(entry, null)?.supremacy?.[0]?.baseId).toBe('A')
    expect(basesForVariant(entry, 'zz9')?.assault?.[0]?.x).toBe(1)
    expect(basesForVariant(null, 'nt1')).toBe(null)
  })
})
