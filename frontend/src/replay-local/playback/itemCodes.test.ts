import { describe, expect, it } from 'vitest'
import { consumableItemId, provisionItemId } from './itemCodes.js'

describe('wire code fallback', () => {
  it('给养线码与上游 v0.4.19 表一致（含欧系/捷克/波兰块）', () => {
    expect(provisionItemId(0x4c)).toBe('LARGE_FOOD')
    expect(provisionItemId(0x4d)).toBe('SMALL_FOOD')
    expect(provisionItemId(0x4a)).toBe('LARGE_FOOD')
    expect(provisionItemId(0x4b)).toBe('SMALL_FOOD')
    expect(provisionItemId(0x48)).toBe('LARGE_FOOD')
    expect(provisionItemId(0x49)).toBe('SMALL_FOOD')
    expect(provisionItemId(0x32)).toBe('SPALL_LINER')
  })

  it('波兰补给 0x6D/0x6E 按版本化观测闭合（11.18/11.20 回放）', () => {
    expect(provisionItemId(0x6d)).toBe('LARGE_FOOD')
    expect(provisionItemId(0x6e)).toBe('SMALL_FOOD')
  })

  it('未知线码保留 null，不猜名', () => {
    expect(provisionItemId(0xfe)).toBeNull()
    expect(consumableItemId(0xfe)).toBeNull()
  })
})
