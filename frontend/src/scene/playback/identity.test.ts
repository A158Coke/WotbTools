import { describe, it, expect } from 'vitest'
import { makeReplacedAt } from './identity'

const vehicles = [
  { eid: 42, account_id: 7, coverage: [42, 48] },
  { eid: 49, account_id: 7, coverage: [42, 51] },
  { eid: 60, account_id: 8, coverage: [10, 70] },
]

function make(canonical: unknown) {
  return makeReplacedAt({
    canonical: () => canonical as never,
    vehicles: () => vehicles,
    spansOf: () => null, // 无 AoI 段：走 coverage 回退
  })
}

describe('makeReplacedAt', () => {
  it('canonical 证据：接管时刻之后抑制，接管前保留（coverage 重叠也正确）', () => {
    const canonical = {
      clock: { startRaw: 0 },
      entityStartsByAccount: new Map([[7, new Map([[42, 42], [49, 49]])]]),
    }
    const replacedAt = make(canonical)
    expect(replacedAt(42, 50)).toBe(true)
    expect(replacedAt(42, 48.5)).toBe(false)
    expect(replacedAt(49, 50)).toBe(false)
  })

  it('战斗相对秒换算：startRaw 偏移不改变判据', () => {
    const canonical = {
      clock: { startRaw: 14 },
      entityStartsByAccount: new Map([[7, new Map([[42, 42], [49, 49]])]]),
    }
    const replacedAt = make(canonical)
    expect(replacedAt(42, 14 + 50)).toBe(true)
    expect(replacedAt(42, 14 + 48.5)).toBe(false)
  })

  it('无 canonical：coverage 段序回退（重叠不判替换，且接管前不隐藏）', () => {
    const replacedAt = make(null)
    expect(replacedAt(42, 50)).toBe(false)

    const disjoint = makeReplacedAt({
      canonical: () => null,
      vehicles: () => [
        { eid: 1, account_id: 9, coverage: [42, 48] },
        { eid: 2, account_id: 9, coverage: [60, 70] },
      ],
      spansOf: () => null,
    })
    expect(disjoint(1, 50)).toBe(false)
    expect(disjoint(1, 60)).toBe(true)
  })

  it('身份证据歧义（activeEntityAt 同刻双实体 → null）时 fail-closed 不抑制', () => {
    const canonical = {
      clock: { startRaw: 0 },
      entityStartsByAccount: new Map([[7, new Map([[42, 49], [49, 49]])]]), // 同刻双实体
    }
    expect(make(canonical)(42, 50)).toBe(false)
  })

  it('非有限时刻 / 未知车辆 → false', () => {
    expect(make(null)(42, Number.NaN)).toBe(false)
    expect(make(null)(999, 10)).toBe(false)
  })
})
