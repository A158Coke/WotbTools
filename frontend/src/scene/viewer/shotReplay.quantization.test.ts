// Issue #827 Wave 2 — 1/255 量化分母行为测试（接替 tankViewer.collisionBoxFailsafe.test.js 的源码文本守卫）。
// 客户端 BWUtils::DecodeShotSegment 常量是 255.0f（@0x364B110）：b=0→min、b=255→max；
// 用 /256 会让 max 面永远差一个量化步长（b=255 不再精确等于部件盒 max）。
// decodeB255 是从 runShotReplay 闭包等价抽取的纯函数（同一实现）。
import { describe, expect, it } from 'vitest'
import { decodeB255 } from './shotReplay.ts'

describe('客户端部件盒 1/255 量化解码（DecodeShotSegment 口径）', () => {
  const MIN = 10, SIZE = 255

  it('b=0 → min，b=255 → 恰好等于 max（精确相等，不差一个量化步长）', () => {
    expect(decodeB255(0, MIN, SIZE)).toBe(MIN)
    // 整数域精确性：/256 口径下 b=255 会得到 254.99…，永远到不了 max
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
