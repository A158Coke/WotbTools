// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  CHAR_WIDTH_FACTOR,
  HP_HUD_H_PX,
  IDENTITY_TO_COMBAT_GAP_PX,
  LABEL_GAP_PX,
  LABEL_LANES_PX,
  LABEL_PAD_X,
  LABEL_LINE_H,
  MARKER_CORE_PX,
  SELECTED_NAME_GAP_PX,
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
    // v2 的 HP 盒压在 v1 的 core 上，但两者的 tag 盒（tank/player/hp）互不相交 → lane 0
    //（core 只作 lane 评分障碍，不驱动位移）。
    //
    // 几何按**真实层级**（player → tank → HP → marker）推导，两个 marker 相差 62px：
    //   v1@200: core y∈[185,215]  tank[182,198]  player[166,182]  hp[138,158]
    //   v2@262: core y∈[247,277]  tank[244,260]  player[228,244]  hp[200,220]
    // v2 的 hp[200,220] 与 v1 的 core[185,215] 相交（200–215），但 v2 的 tank/player
    // 都在 228 以下、v1 的 tank/player/hp 都在 198 以上 → 无 tag overlap。
    const res = computeLabelLayout([item(1, 200, 200), item(2, 200, 262)], opts)
    expect(res.get(2).tankDy).toBe(0)
  })
})

describe('computeLabelLayout vertical hierarchy (collision geometry == rendered DOM)', () => {
  const opts = { showTank: true, showPlayer: true, viewportW: 800, viewportH: 600 }

  /**
   * 真实呈现顺序（`PlaybackVehicleLabel.vue`，2D/3D 共用）：
   *
   *     PlayerName → TankName → HP → Reload → marker
   *
   * screen 坐标 y 向下增长，所以竖直方向必须满足
   * `playerBox.y < tankBox.y < hpBox.y < markerTop`。
   * 这里曾经是 `hp → player → tank → marker`，与渲染顺序相反。
   */
  it('player 在 tank 之上、tank 在 HP 之上、HP 在 marker 之上', () => {
    const r = computeLabelLayout([item(1, 100, 300)], opts).get(1)
    expect(r.playerBox).not.toBeNull()
    expect(r.tankBox).not.toBeNull()
    expect(r.hpBox).not.toBeNull()

    expect(r.playerBox.y).toBeLessThan(r.tankBox.y)
    expect(r.tankBox.y).toBeLessThan(r.hpBox.y)
    expect(r.hpBox.y).toBeLessThan(r.coreBox.y)
  })

  it('相邻块按约定的间距相接，不留缝也不重叠', () => {
    const r = computeLabelLayout([item(1, 100, 300)], opts).get(1)
    // 身份两行之间无 gap（.pb-labels 是 flex column 且没有 gap）
    expect(r.playerBox.y + r.playerBox.h).toBe(r.tankBox.y)
    // 身份块 → combat block = IDENTITY_TO_COMBAT_GAP_PX
    expect(r.tankBox.y + r.tankBox.h + IDENTITY_TO_COMBAT_GAP_PX).toBe(r.hpBox.y)
    // HP → marker = LABEL_GAP_PX
    expect(r.hpBox.y + r.hpBox.h + LABEL_GAP_PX).toBe(r.coreBox.y)
  })

  it('HP 盒高度跟随实测 hpBoxH，且 HP 变高只把身份块整体上推', () => {
    const measured = computeLabelLayout([item(1, 100, 300, { hpBoxH: 34 })], opts).get(1)
    const fallback = computeLabelLayout([item(1, 100, 300)], opts).get(1)
    expect(measured.hpBox.h).toBe(34)
    expect(fallback.hpBox.h).toBe(HP_HUD_H_PX)
    // HP 是 marker 之上最近的一块：它变高（底边不动）时自己也整体上移
    expect(measured.hpBox.y).toBe(fallback.hpBox.y - (34 - HP_HUD_H_PX))
    // 身份块叠在 HP 之上，所以跟着一起上移同样的量
    expect(measured.tankBox.y).toBe(fallback.tankBox.y - (34 - HP_HUD_H_PX))
    expect(measured.playerBox.y).toBe(fallback.playerBox.y - (34 - HP_HUD_H_PX))
  })

  it('关掉 HP 时身份块直接贴 marker，不留空白间距', () => {
    const r = computeLabelLayout([item(1, 100, 300, { hpRendered: false })], opts).get(1)
    expect(r.hpBox).toBeNull()
    // 没有 combat block 时，marker 之上只剩两段间距：identity gap + label gap
    expect(r.tankBox.y + r.tankBox.h).toBe(r.coreBox.y - LABEL_GAP_PX - IDENTITY_TO_COMBAT_GAP_PX)
    expect(r.playerBox.y).toBeLessThan(r.tankBox.y)
  })

  it('选中倒三角贴在身份块（标签栈最上沿）之上', () => {
    const r = computeLabelLayout([item(1, 100, 300, { selected: true })], opts).get(1)
    expect(r.selectedBox).not.toBeNull()
    expect(r.selectedBox.y + r.selectedBox.h).toBe(r.playerBox.y - SELECTED_NAME_GAP_PX)
    expect(r.selectedBox.y + r.selectedBox.h).toBeLessThan(r.playerBox.y)
  })
})


describe('ring label geometry', () => {
  it('uses each vehicle ring diameter and avoids phantom combat gaps and overlapping long names', () => {
    const rings = [
      item(1, 100, 100, { coreSize: 68, hpRing: true, hpRendered: false, tankName: 'A very long tank name' }),
      item(2, 160, 80, { coreSize: 28, hpRing: true, hpRendered: false, tankName: 'Another long tank name' }),
    ]
    const result = computeLabelLayout(rings, { showTank: true, showPlayer: false, coreSize: 68 })
    const first = result.get(1), second = result.get(2)
    expect(first.coreBox.w).toBe(68)
    expect(second.coreBox.w).toBe(28)
    expect(first.hpBox).toBeNull()
    expect(second.hpBox).toBeNull()
    for (const entry of [first, second]) {
      expect(entry.tankBox.y + entry.tankBox.h - entry.tankDy).toBe(entry.coreBox.y - LABEL_GAP_PX)
    }
    const a = first.tankBox, b = second.tankBox
    expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false)
  })
})

it('reserves fixed screen width for an identity badge without changing tank or combat geometry', () => {
  const item = { accountId: 7, x: 200, y: 200, tankName: 'Maus' }
  const plain = computeLabelLayout([item], { showTank: true }).get(7)
  const marked = computeLabelLayout([{ ...item, tankNameExtraWidth: 16 }], { showTank: true }).get(7)
  expect(marked.tankBox.w).toBe(plain.tankBox.w + 16)
  expect(marked.tankBox.h).toBe(plain.tankBox.h)
  expect(marked.coreBox).toEqual(plain.coreBox)
  const hidden = computeLabelLayout([{ ...item, tankNameExtraWidth: 16 }], { showTank: false }).get(7)
  expect(hidden.tankBox).toBeNull()
})
