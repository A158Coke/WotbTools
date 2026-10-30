import { describe, expect, it } from 'vitest'
import { placeShotResultCard } from './shotResultCardPlacement.js'

const clip = { left: 0, top: 0, right: 1200, bottom: 700 }
const base = { offsetY: 0, cardWidth: 240, cardHeight: 120, clip, blockers: [] }

describe('placeShotResultCard', () => {
  it('四边钳制在可见画布内（translateX(-50%)：x 是卡片中心）', () => {
    const left = placeShotResultCard({ ...base, anchorX: -500, anchorY: 300 })
    expect(left.x).toBe(130)          // 0 + 240/2 + 10
    const right = placeShotResultCard({ ...base, anchorX: 5000, anchorY: 300 })
    expect(right.x).toBe(1070)        // 1200 - 240/2 - 10
    const top = placeShotResultCard({ ...base, anchorX: 600, anchorY: -500 })
    expect(top.y).toBe(10)
    const bottom = placeShotResultCard({ ...base, anchorX: 600, anchorY: 5000 })
    expect(bottom.y).toBe(700 - 120 - 10)
  })

  it('卡片比可见区还宽时水平居中', () => {
    const out = placeShotResultCard({ ...base, cardWidth: 1400, anchorX: 600, anchorY: 300 })
    expect(out.x).toBe(600)
  })

  it('blocker 上方有空间时整体上移', () => {
    const blocker = { left: 500, top: 300, right: 700, bottom: 400, width: 200, height: 100 }
    const out = placeShotResultCard({ ...base, anchorX: 600, anchorY: 320, blockers: [blocker] })
    expect(out.y).toBe(300 - 120 - 12)
  })

  it('blocker 顶部放不下时按左右可用空间选边，且跨中线不翻转', () => {
    const blocker = { left: 500, top: 20, right: 700, bottom: 200, width: 200, height: 180 }
    const leftAnchor = placeShotResultCard({ ...base, anchorX: 420, anchorY: 100, blockers: [blocker] })
    const rightAnchor = placeShotResultCard({ ...base, anchorX: 780, anchorY: 100, blockers: [blocker] })
    expect(leftAnchor.x).toBe(rightAnchor.x)
    expect(leftAnchor.x - 120).toBeGreaterThanOrEqual(700 + 12)
  })

  it('结果卡不与 blocker 重叠（避让后）', () => {
    const blocker = { left: 500, top: 20, right: 700, bottom: 200, width: 200, height: 180 }
    for (const anchorX of [420, 500, 600, 700, 780]) {
      const out = placeShotResultCard({ ...base, anchorX, anchorY: 150, blockers: [blocker] })
      const l = out.x - 120
      const t = out.y
      const overlaps = l < blocker.right && l + 240 > blocker.left && t < blocker.bottom && t + 120 > blocker.top
      expect(overlaps, `anchorX=${anchorX} → ${JSON.stringify(out)}`).toBe(false)
    }
  })
})
