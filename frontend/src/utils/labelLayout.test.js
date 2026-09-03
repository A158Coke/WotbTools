// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  CHAR_WIDTH_FACTOR,
  LABEL_LANES_PX,
  LABEL_PAD_X,
  MARKER_CORE_PX,
  computeLabelLayout,
  computeTankCollisionLayout,
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

describe('computeTankCollisionLayout', () => {
  const tank = (accountId, extra = {}) => ({ accountId, x: 100, y: 100, width: 32, height: 32, ...extra })
  const box = (it, offset) => ({
    x: it.x + offset.x - (it.width * 1.05) / 2,
    y: it.y + offset.y - (it.height * 1.05) / 2,
    w: it.width * 1.05,
    h: it.height * 1.05,
  })
  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x
    && a.y < b.y + b.h && a.y + a.h > b.y
  const expectPairwiseNonOverlap = (items, result) => {
    const boxes = items.map(it => box(it, result.get(it.accountId)))
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(overlaps(boxes[i], boxes[j])).toBe(false)
      }
    }
  }

  it.each([3, 7, 14])('keeps %i dense model boxes pairwise non-overlapping', (count) => {
    const items = Array.from({ length: count }, (_, i) => tank(i + 1))
    const result = computeTankCollisionLayout(items)
    expect(result.get(1)).toEqual({ x: 0, y: 0 })
    expectPairwiseNonOverlap(items, result)
  })

  it('keeps canonical coordinates and hit-test anchors independent from presentation offsets', () => {
    const items = [tank(1), tank(2)]
    const result = computeTankCollisionLayout(items)
    expect(items.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 100, y: 100 }, { x: 100, y: 100 }])
    expect(result.get(1)).toEqual({ x: 0, y: 0 })
    expect(result.get(2)).not.toEqual({ x: 0, y: 0 })
  })

  it('gives selected vehicles priority and preserves non-selected offsets when possible', () => {
    const previous = new Map([[2, { x: 32, y: 0 }]])
    const result = computeTankCollisionLayout([tank(1), tank(2, { selected: true })], previous)
    expect(result.get(2)).toEqual({ x: 0, y: 0 })
    expect(result.get(1)).not.toEqual({ x: 0, y: 0 })
  })

  it.each([1, 2, 4])('keeps model boxes non-overlapping across zoom scale %i and resize geometry', (scale) => {
    const items = [
      tank(1, { width: 32 * scale, height: 28 * scale }),
      tank(2, { width: 38 * scale, height: 30 * scale }),
      tank(3, { width: 26 * scale, height: 34 * scale }),
    ]
    const result = computeTankCollisionLayout(items, new Map([[2, { x: 64, y: 0 }]]))
    expectPairwiseNonOverlap(items, result)
  })

  it.each([
    ['left', 1, 8, 120, 320, 240],
    ['right', 1, 312, 120, 320, 240],
    ['top', 1, 160, 8, 320, 240],
    ['bottom', 1, 160, 232, 320, 240],
    ['left', 2, 16, 240, 640, 480],
    ['right', 2, 624, 240, 640, 480],
    ['top', 2, 320, 16, 640, 480],
    ['bottom', 2, 320, 464, 640, 480],
    ['left', 4, 32, 480, 1280, 960],
    ['right', 4, 1248, 480, 1280, 960],
    ['top', 4, 640, 32, 1280, 960],
    ['bottom', 4, 640, 928, 1280, 960],
  ])('keeps 14 model boxes inside the viewport at the %s edge and %ix zoom', (_edge, scale, x, y, w, h) => {
    const items = Array.from({ length: 14 }, (_, i) => tank(i + 1, {
      x, y, width: 32 * scale, height: 32 * scale,
    }))
    const viewport = { x: 0, y: 0, w, h }
    const result = computeTankCollisionLayout(items, new Map(), viewport)
    expectPairwiseNonOverlap(items, result)
    for (const it of items) {
      const b = box(it, result.get(it.accountId))
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.x + b.w).toBeLessThanOrEqual(viewport.w)
      expect(b.y + b.h).toBeLessThanOrEqual(viewport.h)
    }
  })

  it('uses a deterministic bounded fallback instead of throwing for an impossible viewport', () => {
    const items = [tank(1), tank(2)]
    expect(() => computeTankCollisionLayout(items, new Map(), { x: 0, y: 0, w: 20, h: 20 })).not.toThrow()
    expect(computeTankCollisionLayout(items, new Map(), { x: 0, y: 0, w: 20, h: 20 })).toEqual(
      computeTankCollisionLayout(items, new Map(), { x: 0, y: 0, w: 20, h: 20 }),
    )
  })

  it('keeps a feasible previous layout stable across viewport resize', () => {
    const items = [tank(1, { x: 160, y: 120 }), tank(2, { x: 160, y: 120 })]
    const first = computeTankCollisionLayout(items, new Map(), { x: 0, y: 0, w: 320, h: 240 })
    const second = computeTankCollisionLayout(items, first, { x: 0, y: 0, w: 640, h: 480 })
    expect(second).toEqual(first)
    expectPairwiseNonOverlap(items, second)
  })
})

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

  it('lane 仅由 tag 盒评分：core / destroyed / selected / recorder 不影响 lane', () => {
    const opts = { showTank: true, showPlayer: true, viewportW: 800, viewportH: 600 }
    const plain = computeLabelLayout([item(1, 200, 200), item(2, 200, 200)], opts)
    const overlay = computeLabelLayout(
      [item(1, 200, 200, { destroyed: true, selected: true, recorder: true }), item(2, 200, 200)],
      opts,
    )
    // 同位两车：tag 重叠 → v2 走非零 lane（保证测试非空转）
    expect(LABEL_LANES_PX).toContain(plain.get(2).tankDy)
    expect(plain.get(2).tankDy).not.toBe(0)
    // 给 v1 加 destroyed / selected / recorder 盒（core 恒在）后 v2 的 lane 必须不变
    // —— 这些盒不参与 lane 评分，只有 tankBox/playerBox/hpBox（tag）才参与。
    expect(overlay.get(2).tankDy).toBe(plain.get(2).tankDy)
    expect(overlay.get(1).tankDy).toBe(plain.get(1).tankDy)
  })

  it('只有 tag 重叠才触发 lane 位移：仅与车辆 core 重叠时 lane 为 0', () => {
    const opts = { showTank: true, showPlayer: true, viewportW: 800, viewportH: 600 }
    // v1(200,200) core 盒 y∈[185,215]；v2(200,251) 的 hp/player 盒 y∈[185,220] 与 v1 core 重叠，
    // 但与 v1 的 tag 盒（tank/player/hp，y≤183）无重叠 → 无 tag overlap → lane 0（core 不触发位移）。
    const res = computeLabelLayout([item(1, 200, 200), item(2, 200, 251)], opts)
    expect(res.get(2).tankDy).toBe(0)
  })
})
