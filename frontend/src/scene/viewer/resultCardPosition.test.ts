// 结果卡定位（纯函数）：跟随点击 + 候选位逐个避让 HUD 面板 + 视口钳制。
// 候选顺序固定（右下/右上/左下/左上/正上/正下），是确定性几何排布而非统计打分。
// 厚度点选卡（#click-info）与判定结果卡（#traj-info）共用这一处实现。
import { describe, expect, it } from 'vitest'
import { chooseResultCardPosition, type ResultCardRect } from './resultCardPosition.ts'

const overlaps = (pos: { left: number, top: number }, w: number, h: number, panel: ResultCardRect) =>
  pos.left + w > panel.left && pos.left < panel.right && pos.top + h > panel.top && pos.top < panel.bottom

describe('chooseResultCardPosition', () => {
  it('评审反例：600×320、左上胶囊 (60,20)-(284,58)、190×120 卡、点击 (100,5) 不压胶囊', () => {
    const capsule: ResultCardRect = { left: 60, top: 20, right: 284, bottom: 58 }
    const pos = chooseResultCardPosition({
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
    const pos = chooseResultCardPosition({
      clickX: 300, clickY: 150, width: 160, height: 100,
      viewportWidth: 800, viewportHeight: 600, panels: [],
    })
    expect(pos).toEqual({ left: 314, top: 164 })
  })

  it('anchorGap：结果卡与命中点错开更大距离，不贴住命中点', () => {
    const pos = chooseResultCardPosition({
      clickX: 300, clickY: 150, width: 160, height: 100,
      viewportWidth: 800, viewportHeight: 600, panels: [],
      gap: 14, anchorGap: 24,
    })
    expect(pos).toEqual({ left: 324, top: 174 })
  })

  it('anchorGapY：垂直方向再往下让（结果卡 24/40 口径）', () => {
    const pos = chooseResultCardPosition({
      clickX: 300, clickY: 150, width: 160, height: 100,
      viewportWidth: 800, viewportHeight: 600, panels: [],
      gap: 14, anchorGap: 24, anchorGapY: 40,
    })
    expect(pos).toEqual({ left: 324, top: 190 })
  })

  it('anchorGap：右下候选被视口钳回命中点方向时改选左上，不覆盖命中点', () => {
    const clickX = 700, clickY = 500, width = 360, height = 120
    const pos = chooseResultCardPosition({
      clickX, clickY, width, height,
      viewportWidth: 800, viewportHeight: 600, panels: [],
      gap: 14, anchorGap: 24, anchorGapY: 40,
    })
    expect(pos).toEqual({ left: 316, top: 340 })
    const coversAnchor = pos.left < clickX && pos.left + width > clickX
      && pos.top < clickY && pos.top + height > clickY
    expect(coversAnchor).toBe(false)
  })

  it('右下被占时翻到右上；左右都被占时翻到正上/正下', () => {
    const rightBottom: ResultCardRect = { left: 280, top: 140, right: 520, bottom: 280 }
    const up = chooseResultCardPosition({
      clickX: 300, clickY: 150, width: 160, height: 100,
      viewportWidth: 800, viewportHeight: 600, panels: [rightBottom],
    })
    expect(overlaps(up, 160, 100, rightBottom)).toBe(false)
    expect(up.top).toBeLessThan(150)   // 翻到点击点上方

    const band: ResultCardRect = { left: 100, top: 140, right: 600, bottom: 300 }
    const above = chooseResultCardPosition({
      clickX: 340, clickY: 200, width: 160, height: 100,
      viewportWidth: 800, viewportHeight: 600, panels: [band],
    })
    expect(overlaps(above, 160, 100, band)).toBe(false)
  })

  it('评审反例 2：三面板夹击、点击在中部，仍能找到空位（网格搜索，不只单轴贴边）', () => {
    const panels: ResultCardRect[] = [
      { left: 60, top: 20, right: 284, bottom: 58 },
      { left: 340, top: 168, right: 580, bottom: 312 },
      { left: 20, top: 240, right: 260, bottom: 312 },
    ]
    const pos = chooseResultCardPosition({
      clickX: 155, clickY: 125, width: 190, height: 120,
      viewportWidth: 600, viewportHeight: 320, panels,
    })
    for (const panel of panels) expect(overlaps(pos, 190, 120, panel), JSON.stringify(pos)).toBe(false)
    expect(pos.left).toBeGreaterThanOrEqual(8)
    expect(pos.top).toBeGreaterThanOrEqual(8)
    expect(pos.left + 190).toBeLessThanOrEqual(600 - 8 + 1)
    expect(pos.top + 120).toBeLessThanOrEqual(320 - 8 + 1)
  })

  it('评审反例 3：面板夹缝恰好等于卡片尺寸时命中无缝贴合位', () => {
    // 反例来源（评审）：600×320、190×120、点击 (155,125)，四面板把中间夹成
    // x∈[100,290] × y∈[72,192] 的缝；唯一可行位是 (100,72)（右沿贴左面板、上沿贴上方面板）。
    // 固定 gap 网格会漏掉它（dx=-55 / dy=-53 都不是步长整数倍），必须靠边缘坐标交叉积。
    const panels: ResultCardRect[] = [
      { left: 0, top: 0, right: 600, bottom: 72 },
      { left: 0, top: 192, right: 600, bottom: 320 },
      { left: 0, top: 72, right: 100, bottom: 192 },
      { left: 290, top: 72, right: 600, bottom: 192 },
    ]
    const pos = chooseResultCardPosition({
      clickX: 155, clickY: 125, width: 190, height: 120,
      viewportWidth: 600, viewportHeight: 320, panels,
    })
    expect(pos).toEqual({ left: 100, top: 72 })
    for (const panel of panels) expect(overlaps(pos, 190, 120, panel), JSON.stringify(pos)).toBe(false)
  })

  it('四个角都被面板占满时仍返回视口内的钳制位（读数优先，不越界）', () => {
    const panels: ResultCardRect[] = [
      { left: 0, top: 0, right: 400, bottom: 200 },
      { left: 400, top: 0, right: 800, bottom: 200 },
      { left: 0, top: 200, right: 400, bottom: 400 },
      { left: 400, top: 200, right: 800, bottom: 400 },
    ]
    const pos = chooseResultCardPosition({
      clickX: 400, clickY: 200, width: 160, height: 100,
      viewportWidth: 800, viewportHeight: 400, panels,
    })
    expect(pos.left).toBeGreaterThanOrEqual(8)
    expect(pos.top).toBeGreaterThanOrEqual(8)
    expect(pos.left + 160).toBeLessThanOrEqual(800 - 8 + 1)
    expect(pos.top + 100).toBeLessThanOrEqual(400 - 8 + 1)
  })
})
