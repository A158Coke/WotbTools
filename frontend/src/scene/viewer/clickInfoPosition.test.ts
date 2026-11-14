// 点选卡定位（纯函数）：跟随点击 + 候选位逐个避让 HUD 面板 + 视口钳制。
// 候选顺序固定（右下/右上/左下/左上/正上/正下），是确定性几何排布而非统计打分。
import { describe, expect, it } from 'vitest'
import { chooseClickInfoPosition, type ClickInfoRect } from './judgment.ts'

const overlaps = (pos: { left: number, top: number }, w: number, h: number, panel: ClickInfoRect) =>
  pos.left + w > panel.left && pos.left < panel.right && pos.top + h > panel.top && pos.top < panel.bottom

describe('chooseClickInfoPosition', () => {
  it('评审反例：600×320、左上胶囊 (60,20)-(284,58)、190×120 卡、点击 (100,5) 不压胶囊', () => {
    const capsule: ClickInfoRect = { left: 60, top: 20, right: 284, bottom: 58 }
    const pos = chooseClickInfoPosition({
      clickX: 100, clickY: 5, width: 190, height: 120,
      viewportWidth: 600, viewportHeight: 320, panels: [capsule],
    })
    expect(overlaps(pos, 190, 120, capsule)).toBe(false)
    expect(pos.left).toBeGreaterThanOrEqual(8)
    expect(pos.top).toBeGreaterThanOrEqual(8)
    expect(pos.left + 190).toBeLessThanOrEqual(600 - 8 + 1)
    expect(pos.top + 120).toBeLessThanOrEqual(320 - 8 + 1)
  })

  it('中部点击、无面板：首选右下偏移（点击点 + gap）', () => {
    const pos = chooseClickInfoPosition({
      clickX: 300, clickY: 150, width: 160, height: 100,
      viewportWidth: 800, viewportHeight: 600, panels: [],
    })
    expect(pos).toEqual({ left: 314, top: 164 })
  })

  it('右下被占时翻到右上；左右都被占时翻到正上/正下', () => {
    const rightBottom: ClickInfoRect = { left: 280, top: 140, right: 520, bottom: 280 }
    const up = chooseClickInfoPosition({
      clickX: 300, clickY: 150, width: 160, height: 100,
      viewportWidth: 800, viewportHeight: 600, panels: [rightBottom],
    })
    expect(overlaps(up, 160, 100, rightBottom)).toBe(false)
    expect(up.top).toBeLessThan(150)   // 翻到点击点上方

    const band: ClickInfoRect = { left: 100, top: 140, right: 600, bottom: 300 }
    const above = chooseClickInfoPosition({
      clickX: 340, clickY: 200, width: 160, height: 100,
      viewportWidth: 800, viewportHeight: 600, panels: [band],
    })
    expect(overlaps(above, 160, 100, band)).toBe(false)
  })

  it('四个角都被面板占满时仍返回视口内的钳制位（读数优先，不越界）', () => {
    const panels: ClickInfoRect[] = [
      { left: 0, top: 0, right: 400, bottom: 200 },
      { left: 400, top: 0, right: 800, bottom: 200 },
      { left: 0, top: 200, right: 400, bottom: 400 },
      { left: 400, top: 200, right: 800, bottom: 400 },
    ]
    const pos = chooseClickInfoPosition({
      clickX: 400, clickY: 200, width: 160, height: 100,
      viewportWidth: 800, viewportHeight: 400, panels,
    })
    expect(pos.left).toBeGreaterThanOrEqual(8)
    expect(pos.top).toBeGreaterThanOrEqual(8)
    expect(pos.left + 160).toBeLessThanOrEqual(800 - 8 + 1)
    expect(pos.top + 100).toBeLessThanOrEqual(400 - 8 + 1)
  })
})
