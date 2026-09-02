// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  CHAR_WIDTH_FACTOR,
  LABEL_LANES_PX,
  LABEL_PAD_X,
  MARKER_CORE_PX,
  computeLabelLayout,
  estimateLabelWidth,
} from './labelLayout'

function item(accountId, x, y, extra = {}) {
  return {
    accountId,
    x,
    y,
    tankName: `Tank-${accountId}`,
    playerName: `Player-${accountId}`,
    hpRendered: true,
    hpDisplayText: '2000',
    ...extra,
  }
}

describe('estimateLabelWidth', () => {
  it('估算拉丁/CJK 宽度并支持 maxWidth', () => {
    expect(estimateLabelWidth('ABCD', 10)).toBeCloseTo(4 * 10 * CHAR_WIDTH_FACTOR + LABEL_PAD_X)
    expect(estimateLabelWidth('中文玩家', 10)).toBe(4 * 10 + LABEL_PAD_X)
    expect(estimateLabelWidth('x'.repeat(100), 10, 50)).toBe(50)
  })
})

describe('computeLabelLayout overlap-first UX', () => {
  it('默认 marker core baseline 为 30px', () => {
    expect(MARKER_CORE_PX).toBe(30)
    const r = computeLabelLayout([item(1, 100, 100)], {
      showTank: true,
      showPlayer: true,
      viewportW: 800,
      viewportH: 600,
    }).get(1)
    expect(r.coreBox.w).toBe(30)
    expect(r.coreBox.h).toBe(30)
  })

  it('14 辆车密集重叠时允许 lane/overlap，但所有标签与 HP 始终可见', () => {
    const items = Array.from({ length: 14 }, (_, i) => item(i + 1, 300, 300))
    const result = computeLabelLayout(items, {
      showTank: true,
      showPlayer: true,
      viewportW: 800,
      viewportH: 600,
      coreSize: 30,
    })

    expect(result.size).toBe(14)
    for (const r of result.values()) {
      expect(r.blockHidden).toBe(false)
      expect(r.playerConflict).toBe(false)
      expect(r.hpHidden).toBe(false)
      expect(r.tankBox).not.toBeNull()
      expect(r.playerBox).not.toBeNull()
      expect(r.hpBox).not.toBeNull()
      expect(LABEL_LANES_PX).toContain(r.tankDy)
    }
  })

  it('lane 选择 deterministic，不受输入顺序影响', () => {
    const forwardItems = [item(1, 200, 200), item(2, 200, 200), item(3, 200, 210)]
    const reverseItems = [...forwardItems].reverse()
    const opts = { showTank: true, showPlayer: true, viewportW: 800, viewportH: 600, coreSize: 30 }
    const a = computeLabelLayout(forwardItems, opts)
    const b = computeLabelLayout(reverseItems, opts)

    for (const id of [1, 2, 3]) {
      expect(a.get(id).tankDy).toBe(b.get(id).tankDy)
      expect(a.get(id).blockHidden).toBe(false)
      expect(b.get(id).blockHidden).toBe(false)
    }
  })

  it('关闭 HP 时不制造 hp footprint，但标签仍不隐藏', () => {
    const r = computeLabelLayout([item(1, 100, 100, { hpRendered: false })], {
      showTank: true,
      showPlayer: true,
      viewportW: 800,
      viewportH: 600,
    }).get(1)
    expect(r.hpBox).toBeNull()
    expect(r.hpHidden).toBe(false)
    expect(r.blockHidden).toBe(false)
    expect(r.playerConflict).toBe(false)
  })

  it('viewport 外 marker 不参与 layout', () => {
    const result = computeLabelLayout([
      item(1, 100, 100),
      item(2, -1000, 100),
    ], { showTank: true, showPlayer: true, viewportW: 800, viewportH: 600 })
    expect(result.get(1).tankBox).not.toBeNull()
    expect(result.get(2).tankBox).toBeNull()
  })
})
