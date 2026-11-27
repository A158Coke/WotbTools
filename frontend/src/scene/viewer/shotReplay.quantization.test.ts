import { describe, expect, it } from 'vitest'
import { decodeB255 } from './shotReplay.ts'

describe('客户端部件盒 1/255 量化解码（DecodeShotSegment 口径）', () => {
  const MIN = 10, SIZE = 255

  it('b=0 → min，b=255 → 恰好等于 max（精确相等，不差一个量化步长）', () => {
    expect(decodeB255(0, MIN, SIZE)).toBe(MIN)
    expect(decodeB255(255, MIN, SIZE)).toBe(MIN + SIZE)
    expect(decodeB255(255, MIN, SIZE) === MIN + SIZE).toBe(true)
  })

  it('分母是 255 不是 256：b=255 与 b=254 之间恰好差 size/255', () => {
    const step = decodeB255(255, MIN, SIZE) - decodeB255(254, MIN, SIZE)
    expect(step).toBeCloseTo(SIZE / 255, 12)
    expect(step).not.toBeCloseTo(SIZE / 256, 12)
  })

  it('中间码线性内插', () => {
    expect(decodeB255(128, MIN, SIZE)).toBeCloseTo(MIN + (SIZE * 128) / 255, 12)
  })
})
