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

  it('§34 B1：3 label 连锁碰撞——从下往上 greedy，后处理标签不再撞回已处理标签', () => {
    // 同 X，y=200/212/224（h=14）：基础盒 184-198 / 196-210 / 208-222
    // 旧算法（从上往下）会得到 A 182-196 / B 194-208 / C 208-222（A/B 仍 overlap 2px）
    const res = computeLabelLayout(
      [
        item(1, 200, 200, 'WZ-111 model 5A'),
        item(2, 200, 212, 'T57 Heavy Tank'),
        item(3, 200, 224, 'Progetto 65'),
      ],
      { showTank: true, showPlayer: false, viewportW: vw, viewportH: vh }
    )
    expect(res.get(1).tankDy).toBe(-4)
    expect(res.get(2).tankDy).toBe(-2)
    expect(res.get(3).tankDy).toBe(0)
    // final boxes：A 180-194 / B 194-208 / C 208-222，无残留 overlap
    expect(res.get(1).tankBox.y).toBe(180)
    expect(res.get(2).tankBox.y).toBe(194)
    expect(res.get(3).tankBox.y).toBe(208)
    expect(res.get(1).tankBox.y + tankH).toBeLessThanOrEqual(res.get(2).tankBox.y)
    expect(res.get(2).tankBox.y + tankH).toBeLessThanOrEqual(res.get(3).tankBox.y)
  })

  it('§34 B1：4/5 label 密集链——未达上限时无残留 overlap', () => {
    // 4 label：y=200/210/220/230 → final tops 172/186/200/214
    const r4 = computeLabelLayout(
      [1, 2, 3, 4].map((i) => item(i, 200, 200 + (i - 1) * 10, 'WZ-111 model 5A')),
      { showTank: true, showPlayer: false, viewportW: vw, viewportH: vh }
    )
    expect([1, 2, 3, 4].map((id) => r4.get(id).tankBox.y)).toEqual([172, 186, 200, 214])
    for (let i = 1; i <= 3; i++) expect(r4.get(i).tankBox.y + tankH).toBeLessThanOrEqual(r4.get(i + 1).tankBox.y)
    // 5 label：y=200/212/224/236/248 → final tops 176/190/204/218/232
    const r5 = computeLabelLayout(
      [1, 2, 3, 4, 5].map((i) => item(i, 200, 200 + (i - 1) * 12, 'WZ-111 model 5A')),
      { showTank: true, showPlayer: false, viewportW: vw, viewportH: vh }
    )
    expect([1, 2, 3, 4, 5].map((id) => r5.get(id).tankBox.y)).toEqual([176, 190, 204, 218, 232])
    for (let i = 1; i <= 4; i++) expect(r5.get(i).tankBox.y + tankH).toBeLessThanOrEqual(r5.get(i + 1).tankBox.y)
  })

  it('§34 B1：达到位移上限后允许剩余 overlap（不无限移动）', () => {
    // 三标签同位：最下方不动，上两个各到 -TANK_SHIFT_MAX_PX 上限 → 1/2 接受剩余 overlap
    const res = computeLabelLayout(
      [item(1, 200, 200, 'Maus'), item(2, 200, 200, 'Maus'), item(3, 200, 200, 'Maus')],
      { showTank: true, showPlayer: false, viewportW: vw, viewportH: vh }
    )
    expect(res.get(3).tankDy).toBe(0)
    expect(res.get(2).tankDy).toBe(-TANK_SHIFT_MAX_PX)
    expect(res.get(1).tankDy).toBe(-TANK_SHIFT_MAX_PX)
    expect(res.get(1).tankBox.y + tankH).toBeGreaterThan(res.get(2).tankBox.y) // 剩余 overlap 被接受
    expect(res.get(2).tankBox.y + tankH).toBeLessThanOrEqual(res.get(3).tankBox.y)
  })

  it('§34 B1：输入顺序变化 → 结果 deterministic（y 排序 + accountId 决胜）', () => {
    const fwd = computeLabelLayout(
      [item(1, 200, 200, 'WZ-111 model 5A'), item(2, 200, 212, 'T57 Heavy Tank'), item(3, 200, 224, 'Progetto 65')],
      { showTank: true, showPlayer: false, viewportW: vw, viewportH: vh }
    )
    const rev = computeLabelLayout(
      [item(3, 200, 224, 'Progetto 65'), item(2, 200, 212, 'T57 Heavy Tank'), item(1, 200, 200, 'WZ-111 model 5A')],
      { showTank: true, showPlayer: false, viewportW: vw, viewportH: vh }
    )
    for (const id of [1, 2, 3]) {
      expect(rev.get(id).tankDy).toBe(fwd.get(id).tankDy)
      expect(rev.get(id).tankBox.y).toBe(fwd.get(id).tankBox.y)
    }
    // 同位（同 y）输入顺序翻转同样 deterministic（accountId 决胜）
    const a = computeLabelLayout([item(1, 200, 200, 'Maus'), item(2, 200, 200, 'Maus')], { showTank: true, showPlayer: false, viewportW: vw, viewportH: vh })
    const b = computeLabelLayout([item(2, 200, 200, 'Maus'), item(1, 200, 200, 'Maus')], { showTank: true, showPlayer: false, viewportW: vw, viewportH: vh })
    expect(a.get(1).tankDy).toBe(b.get(1).tankDy)
    expect(a.get(2).tankDy).toBe(b.get(2).tankDy)
  })

  it('水平不重叠 → 无位移', () => {
    const res = computeLabelLayout(
      [item(1, 100, 200, 'Maus'), item(2, 500, 220, 'Maus')],
      { showTank: true, showPlayer: false, viewportW: vw, viewportH: vh }
    )
    expect(res.get(1).tankDy).toBe(0)
    expect(res.get(2).tankDy).toBe(0)
  })

  it('§32 B2：playerBox 从 final tankBox 推导——共享块整体位移（tankDy=0 / -2 / -MAX）', () => {
    // tankDy=0：相距远，无位移
    const r0 = computeLabelLayout(
      [item(1, 100, 100, 'Maus', 'P1'), item(2, 600, 500, 'Maus', 'P2')],
      { showTank: true, showPlayer: true, viewportW: vw, viewportH: vh }
    )
    expect(r0.get(1).tankDy).toBe(0)
    expect(r0.get(1).playerBox.y).toBe(r0.get(1).tankBox.y - playerH)
    // tankDy=-2：上方车被下方车顶起 → player 盒跟随 final tankBox（不分离）
    const r2 = computeLabelLayout(
      [item(1, 200, 200, 'WZ-111 model 5A', 'P1'), item(2, 200, 212, 'T57 Heavy Tank', 'P2')],
      { showTank: true, showPlayer: true, viewportW: vw, viewportH: vh }
    )
    expect(r2.get(1).tankDy).toBe(-2)
    expect(r2.get(1).playerBox.y).toBe(r2.get(1).tankBox.y - playerH)
    // tankDy=-TANK_SHIFT_MAX_PX：同位深重叠 → player 仍跟随 final tankBox
    const rMax = computeLabelLayout(
      [item(1, 200, 200, 'Maus', 'P1'), item(2, 200, 200, 'Maus', 'P2')],
      { showTank: true, showPlayer: true, viewportW: vw, viewportH: vh }
    )
    expect(rMax.get(1).tankDy).toBe(-TANK_SHIFT_MAX_PX)
    expect(rMax.get(1).playerBox.y).toBe(rMax.get(1).tankBox.y - playerH)
    expect(rMax.get(2).playerBox.y).toBe(rMax.get(2).tankBox.y - playerH)
  })

  it('§32 B2：PlayerName 与自家 TankName 共享块关系下不误判 conflict', () => {
    const res = computeLabelLayout(
      [item(1, 200, 200, 'Maus', 'P1')],
      { showTank: true, showPlayer: true, viewportW: vw, viewportH: vh }
    )
    // player 行底边与 tank 行顶边恰好相接（同一 flex column），不是 overlap
    expect(res.get(1).playerBox.y + res.get(1).playerBox.h).toBe(res.get(1).tankBox.y)
    expect(res.get(1).playerConflict).toBe(false)
  })

  it('§32 B2：PlayerName 与另一辆车 **final** TankName 真正重叠 → conflict（确定性断言）', () => {
    // 下方车（2001）的 player 盒压到上方车（1001）位移后的 final tank 盒：
    // 1001 被 2001 顶起（dy=-2）→ 1001 final tank [182..196]；2001 player [183..196] 重叠
    const res = computeLabelLayout(
      [
        item(1001, 200, 200, 'Maus', 'P1'),
        item(2001, 200, 212, 'Maus', 'LongPlayerNameTwo'),
      ],
      { showTank: true, showPlayer: true, viewportW: vw, viewportH: vh }
    )
    expect(res.get(1001).tankDy).toBe(-2)
    expect(res.get(2001).playerConflict).toBe(true) // 下方车 player 与上方 final tank 冲突
    expect(res.get(1001).playerConflict).toBe(false) // 上方车 player 更高，不与下方 tank 冲突
    // 相距足够远 → 无冲突
    const far = computeLabelLayout(
      [item(1, 100, 100, 'Maus', 'P1'), item(2, 600, 500, 'Maus', 'P2')],
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
