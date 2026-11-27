import { describe, expect, it } from 'vitest'
import { assaultSelectable, resolveBasesKind } from './mapBasesKind.js'

const base = (x = 0) => ({ x, y: 0, radius: null, team: 1 })

describe('assaultSelectable', () => {
  it('只有恰好 1 个 candidate 才可选', () => {
    expect(assaultSelectable({ assault: [base()] })).toBe(true)
    expect(assaultSelectable({ assault: [base(), base(1)] })).toBe(false)
    expect(assaultSelectable({ assault: [] })).toBe(false)
    expect(assaultSelectable(null)).toBe(false)
  })
})

describe('resolveBasesKind', () => {
  const single = { supremacy: [{ baseId: 'A' }, { baseId: 'B' }], assault: [base()] }
  const multi = { supremacy: [{ baseId: 'A' }], assault: [base(), base(1), base(2)] }

  it('URL 显式选择优先（单 candidate 图）', () => {
    expect(resolveBasesKind(single, 'encounter')).toBe('assault')
    expect(resolveBasesKind(single, 'supremacy')).toBe('supremacy')
  })

  it('多 candidate 图的遭遇 URL 被拒绝并回落争霸（fail-closed）', () => {
    expect(resolveBasesKind(multi, 'encounter')).toBe('supremacy')
  })

  it('无 URL 时：有争霸先争霸，否则单 candidate 遭遇', () => {
    expect(resolveBasesKind(single, undefined)).toBe('supremacy')
    expect(resolveBasesKind({ assault: [base()] }, undefined)).toBe('assault')
  })

  it('无几何 / 多 candidate 且无争霸 → null（不显示切换）', () => {
    expect(resolveBasesKind(null, 'encounter')).toBe(null)
    expect(resolveBasesKind({ assault: multi.assault }, 'encounter')).toBe(null)
  })
})
