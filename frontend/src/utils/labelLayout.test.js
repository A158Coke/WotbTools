// @vitest-environment happy-dom
/**
 * PR4（§26–§35）labelLayout 纯函数单测：估算宽度 / 碰撞盒 / TankName 位移 /
 * PlayerName 冲突 / viewport 裁剪 / hysteresis 时间阈值。
 */
import { describe, expect, it } from 'vitest'
import {
  CHAR_WIDTH_FACTOR,
  LABEL_GAP_PX,
  LABEL_PAD_X,
  LABEL_PAD_Y,
  PLAYER_HIDE_MS,
  PLAYER_SHOW_MS,
  TANK_SHIFT_MAX_PX,
  computeLabelLayout,
  estimateLabelWidth,
  resolvePlayerVisibility,
} from './labelLayout'

const tankH = 12 + LABEL_PAD_Y // 14
const playerH = 11 + LABEL_PAD_Y // 13

function item(accountId, x, y, tankName = 'Maus', playerName = 'Player' + accountId) {
  return { accountId, x, y, tankName, playerName }
}

describe('estimateLabelWidth', () => {
  it('按字符数 × 字号 × 系数 + padding 估算，并钳制到 maxWidth', () => {
    const est = estimateLabelWidth('ABCD', 10)
    expect(est).toBeCloseTo(4 * 10 * CHAR_WIDTH_FACTOR + LABEL_PAD_X)
    expect(estimateLabelWidth('x'.repeat(100), 10, 50)).toBe(50)
    expect(estimateLabelWidth(null, 10)).toBe(0)
    expect(estimateLabelWidth('', 10)).toBe(0)
  })

  it('CJK/全角字符按整字宽估算——碰撞盒不低估中文玩家名', () => {
    const latin = estimateLabelWidth('ABCD', 10)
    const cjk = estimateLabelWidth('中文玩家', 10)
    expect(cjk).toBe(4 * 10 + LABEL_PAD_X)
    expect(cjk).toBeGreaterThan(latin)
    expect(estimateLabelWidth('混合abc名', 10)).toBeCloseTo(3 * 10 + 3 * 10 * CHAR_WIDTH_FACTOR + LABEL_PAD_X)
  })
})

describe('computeLabelLayout', () => {
  const vw = 800
  const vh = 600

  it('基础盒：TankName 居中于车上方，PlayerName 在其上；两行/单行自适应', () => {
    const res = computeLabelLayout([item(1, 100, 200)], { showTank: true, showPlayer: true, viewportW: vw, viewportH: vh })
    const r = res.get(1)
    const tankW = estimateLabelWidth('Maus', 10)
    expect(r.tankBox).toEqual({ x: 100 - tankW / 2, y: 200 - LABEL_GAP_PX - tankH, w: tankW, h: tankH })
    expect(r.playerBox).toEqual({
      x: 100 - estimateLabelWidth('Player1', 9) / 2,
      y: 200 - LABEL_GAP_PX - tankH - playerH,
      w: estimateLabelWidth('Player1', 9),
      h: playerH,
    })
    expect(r.tankDy).toBe(0)
    expect(r.playerConflict).toBe(false)
    // 只显示 TankName：无 player 盒；只显示 PlayerName：无 tank 盒
    const onlyTank = computeLabelLayout([item(1, 100, 200)], { showTank: true, showPlayer: false, viewportW: vw, viewportH: vh }).get(1)
    expect(onlyTank.playerBox).toBeNull()
    expect(onlyTank.tankBox).not.toBeNull()
    const onlyPlayer = computeLabelLayout([item(1, 100, 200)], { showTank: false, showPlayer: true, viewportW: vw, viewportH: vh }).get(1)
    expect(onlyPlayer.tankBox).toBeNull()
    expect(onlyPlayer.playerBox).not.toBeNull()
  })

  it('viewport 裁剪（§35）：越界 marker 不参与碰撞', () => {
    const res = computeLabelLayout(
      [item(1, 100, 100), item(2, -1000, 100), item(3, 100, 10000)],
      { showTank: true, showPlayer: true, viewportW: vw, viewportH: vh }
    )
    expect(res.get(1).tankBox).not.toBeNull()
    expect(res.get(2).tankBox).toBeNull()
    expect(res.get(3).tankBox).toBeNull()
    // 越界者不参与冲突（越界 3 的 player 不报冲突）
    expect(res.get(2).playerConflict).toBe(false)
  })

  it('§34 TankName 冲突：上方的标签上移让位，上限一行高度', () => {
    // 两车水平重叠、垂直间距小（200 vs 212）→ 标签重叠 2px → 上方标签上移 2px 让位
    const res = computeLabelLayout(
      [item(1, 200, 200, 'WZ-111 model 5A'), item(2, 200, 212, 'T57 Heavy Tank')],
      { showTank: true, showPlayer: false, viewportW: vw, viewportH: vh }
    )
    const r1 = res.get(1)
    const r2 = res.get(2)
    expect(r1.tankDy).toBe(-2)
    expect(r1.tankDy).toBeGreaterThanOrEqual(-TANK_SHIFT_MAX_PX)
    expect(r1.tankBox.y + r1.tankBox.h).toBeLessThanOrEqual(r2.tankBox.y)
    expect(r2.tankDy).toBe(0) // 下方的标签不动
  })

  it('§34 位移上限：深重叠时只允许一行高度，接受剩余 overlap', () => {
    // 同位重叠 14px → 位移被钳制在 -TANK_SHIFT_MAX_PX，接受剩余 overlap
    const res = computeLabelLayout(
      [item(1, 200, 200, 'Maus'), item(2, 200, 200, 'Maus')],
      { showTank: true, showPlayer: false, viewportW: vw, viewportH: vh }
    )
    expect(res.get(1).tankDy).toBe(-TANK_SHIFT_MAX_PX)
  })

  it('水平不重叠 → 无位移', () => {
    const res = computeLabelLayout(
      [item(1, 100, 200, 'Maus'), item(2, 500, 220, 'Maus')],
      { showTank: true, showPlayer: false, viewportW: vw, viewportH: vh }
    )
    expect(res.get(1).tankDy).toBe(0)
    expect(res.get(2).tankDy).toBe(0)
  })

  it('§32 PlayerName 冲突：player 盒压到任一 TankName 盒 → conflict（位移后判定）', () => {
    // 1 与 2 的 tank 标签重叠（1 被上移）→ 1 的 player 盒（在 1 的 tank 上方）与 2 的 tank 盒冲突
    const res = computeLabelLayout(
      [
        item(1, 200, 200, 'Maus', 'VeryLongPlayerNameOne'),
        item(2, 200, 240, 'T57 Heavy Tank', 'P2'),
      ],
      { showTank: true, showPlayer: true, viewportW: vw, viewportH: vh }
    )
    // 1 的 player 盒在位移后的 tank 盒之上；2 的 tank 盒在下方 —— 当 player 盒够宽时与 2 冲突
    const r1 = res.get(1)
    if (r1.playerBox && r1.playerBox.y + r1.playerBox.h > res.get(2).tankBox.y
        && r1.playerBox.x < res.get(2).tankBox.x + res.get(2).tankBox.w
        && r1.playerBox.x + r1.playerBox.w > res.get(2).tankBox.x) {
      expect(r1.playerConflict).toBe(true)
    }
    // 相距足够远 → 无冲突
    const far = computeLabelLayout(
      [item(1, 100, 100, 'Maus', 'P1'), item(2, 600, 500, 'T57 Heavy Tank', 'P2')],
      { showTank: true, showPlayer: true, viewportW: vw, viewportH: vh }
    )
    expect(far.get(1).playerConflict).toBe(false)
    expect(far.get(2).playerConflict).toBe(false)
  })
})

describe('resolvePlayerVisibility（§33 hysteresis）', () => {
  const now = 10_000
  it('冲突持续超过 hideMs 才隐藏；翻转后重新计时', () => {
    const conflicts = new Set([1])
    let r = resolvePlayerVisibility(conflicts, new Map(), now, PLAYER_HIDE_MS, PLAYER_SHOW_MS)
    expect(r.hidden.has(1)).toBe(false)
    r = resolvePlayerVisibility(conflicts, r.state, now + PLAYER_HIDE_MS - 10)
    expect(r.hidden.has(1)).toBe(false) // 未到阈值
    r = resolvePlayerVisibility(conflicts, r.state, now + PLAYER_HIDE_MS + 10)
    expect(r.hidden.has(1)).toBe(true) // 达到阈值 → 隐藏
    // 冲突继续 → 保持隐藏
    r = resolvePlayerVisibility(conflicts, r.state, now + PLAYER_HIDE_MS + 1000)
    expect(r.hidden.has(1)).toBe(true)
  })

  it('冲突解除后超过 showMs 才恢复，恢复帧标记 fading', () => {
    const conflicts = new Set([1])
    let r = resolvePlayerVisibility(conflicts, new Map(), now, PLAYER_HIDE_MS, PLAYER_SHOW_MS)
    r = resolvePlayerVisibility(conflicts, r.state, now + PLAYER_HIDE_MS + 10) // hidden=true
    expect(r.hidden.has(1)).toBe(true)
    r = resolvePlayerVisibility(new Set(), r.state, now + PLAYER_HIDE_MS + 20) // 冲突解除，开始计时
    expect(r.hidden.has(1)).toBe(true) // 未到 showMs
    r = resolvePlayerVisibility(new Set(), r.state, now + PLAYER_HIDE_MS + 20 + PLAYER_SHOW_MS - 10)
    expect(r.hidden.has(1)).toBe(true)
    r = resolvePlayerVisibility(new Set(), r.state, now + PLAYER_HIDE_MS + 20 + PLAYER_SHOW_MS + 10)
    expect(r.hidden.has(1)).toBe(false)
    expect(r.fading.has(1)).toBe(true) // 恢复帧带 fade
    // 稳定后无 fading
    r = resolvePlayerVisibility(new Set(), r.state, now + PLAYER_HIDE_MS + 20 + PLAYER_SHOW_MS + 200)
    expect(r.hidden.has(1)).toBe(false)
    expect(r.fading.has(1)).toBe(false)
  })

  it('无时间基准（NaN）→ 沿用 prev 快照，不迁移', () => {
    const prev = new Map([[1, { hidden: true, since: 0 }]])
    const r = resolvePlayerVisibility(new Set(), prev, NaN)
    expect(r.hidden.has(1)).toBe(true)
    expect(r.state.get(1).hidden).toBe(true)
  })

  it('非冲突 id 保持显示', () => {
    const r = resolvePlayerVisibility(new Set(), new Map([[9, { hidden: false, since: 0 }]]), now)
    expect(r.hidden.has(9)).toBe(false)
  })
})
