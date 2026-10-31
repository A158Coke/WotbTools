import { describe, expect, it } from 'vitest'
import { consumableItemId, provisionItemId } from './itemCodes.js'

describe('wire code fallback', () => {
  it('给养线码与上游 v0.4.22 表一致（含欧系/瑞典/捷克块）', () => {
    expect(provisionItemId(0x46)).toBe('LARGE_FOOD')
    expect(provisionItemId(0x47)).toBe('SMALL_FOOD')
    expect(provisionItemId(0x48)).toBe('SMALL_FOOD')
    expect(provisionItemId(0x49)).toBe('LARGE_FOOD')
    expect(provisionItemId(0x4a)).toBe('LARGE_FOOD')
    expect(provisionItemId(0x4b)).toBe('SMALL_FOOD')
    expect(provisionItemId(0x32)).toBe('SPALL_LINER')
  })

  it('0x4C/0x4D 从未观测，不再当食物', () => {
    expect(provisionItemId(0x4c)).toBeNull()
    expect(provisionItemId(0x4d)).toBeNull()
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
