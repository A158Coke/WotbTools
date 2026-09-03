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
  const expectBounded = (items, result, maxOffset = 12) => {
    for (const it of items) {
      const offset = result.get(it.accountId)
      expect(Math.hypot(offset.x, offset.y)).toBeLessThanOrEqual(maxOffset)
    }
  }

  it.each([3, 7, 14])('keeps %i dense model offsets bounded and canonical coordinates untouched', (count) => {
    const items = Array.from({ length: count }, (_, i) => tank(i + 1))
    const result = computeTankCollisionLayout(items)
    expect(result.get(1)).toEqual({ x: 0, y: 0 })
    expectBounded(items, result)
    expect(items.every(it => it.x === 100 && it.y === 100)).toBe(true)
  })

  it('uses the smaller mobile offset budget and accepts residual model overlap', () => {
    const items = Array.from({ length: 14 }, (_, i) => tank(i + 1))
    const result = computeTankCollisionLayout(items, new Map(), { mobile: true })
    expectBounded(items, result, 10)
    const boxes = items.map((it) => {
      const offset = result.get(it.accountId)
      return { x: it.x + offset.x - it.width / 2, y: it.y + offset.y - it.height / 2, w: it.width, h: it.height }
    })
    const hasResidualOverlap = boxes.some((a, index) => boxes.slice(index + 1).some((b) => (
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
    )))
    expect(hasResidualOverlap).toBe(true)
  })

  it('uses a small soft offset for a light collision instead of forcing zero overlap', () => {
    const items = [tank(1), tank(2)]
    const result = computeTankCollisionLayout(items)
    expect(result.get(1)).toEqual({ x: 0, y: 0 })
    expect(result.get(2)).not.toEqual({ x: 0, y: 0 })
    expectBounded(items, result)
    expect(items.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 100, y: 100 }, { x: 100, y: 100 }])
  })

  it('does not let nickname, tank name, HP, or tag changes affect model layout', () => {
    const items = [tank(1), tank(2)]
    const decorated = items.map((it, index) => ({
      ...it,
      playerName: index === 0 ? 'A very long nickname' : 'B',
      tankName: index === 0 ? 'A very long tank name' : 'B',
      hpDisplayText: index === 0 ? '0' : '9999',
      tag: index === 0 ? '[CLAN]' : undefined,
    }))
    expect(computeTankCollisionLayout(decorated)).toEqual(computeTankCollisionLayout(items))
  })

  it('gives selected vehicles priority and preserves non-selected offsets when possible', () => {
    const previous = new Map([[2, { x: 32, y: 0 }]])
    const result = computeTankCollisionLayout([tank(1), tank(2, { selected: true })], previous)
    expect(result.get(2)).toEqual({ x: 0, y: 0 })
    expect(result.get(1)).not.toEqual({ x: 0, y: 0 })
  })

  it.each([1, 2, 4])('keeps model offsets bounded across zoom scale %i and resize geometry', (scale) => {
    const items = [
      tank(1, { width: 32 * scale, height: 28 * scale }),
      tank(2, { width: 38 * scale, height: 30 * scale }),
      tank(3, { width: 26 * scale, height: 34 * scale }),
    ]
    const result = computeTankCollisionLayout(items, new Map([[2, { x: 64, y: 0 }]]))
    expectBounded(items, result)
  })

  it.each(['left', 'right', 'top', 'bottom'])('does not move a lone marker because of viewport clipping at the %s edge', (edge) => {
    const position = {
      left: { x: 0, y: 100 },
      right: { x: 320, y: 100 },
      top: { x: 160, y: 0 },
      bottom: { x: 160, y: 240 },
    }[edge]
    const result = computeTankCollisionLayout([tank(1, position)])
    expect(result.get(1)).toEqual({ x: 0, y: 0 })
  })

  it('uses a deterministic bounded fallback instead of throwing for malformed layout input', () => {
    const items = [tank(1), tank(2)]
    expect(() => computeTankCollisionLayout(items, new Map(), { mobile: true })).not.toThrow()
    expect(computeTankCollisionLayout(items, new Map(), { mobile: true })).toEqual(
      computeTankCollisionLayout(items, new Map(), { mobile: true }),
    )
  })

  it('keeps a feasible previous layout stable across viewport resize', () => {
    const items = [tank(1, { x: 160, y: 120 }), tank(2, { x: 160, y: 120 })]
    const first = computeTankCollisionLayout(items)
    const second = computeTankCollisionLayout(items, first)
    expect(second).toEqual(first)
    expectBounded(items, second)
  })

  it('reuses a valid previous offset when it does not create a new conflict', () => {
    const items = [tank(1, { x: 100, y: 100 }), tank(2, { x: 220, y: 100 })]
    const previous = new Map([[1, { x: 8, y: 0 }], [2, { x: -6, y: 0 }]])
    const result = computeTankCollisionLayout(items, previous)
    expect(result.get(1)).toEqual({ x: 8, y: 0 })
    expect(result.get(2)).toEqual({ x: -6, y: 0 })
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
