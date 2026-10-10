import { describe, expect, it } from 'vitest'
import { guideCardPosition, guideCutout, guideMasks } from './onboardingGeometry.js'

describe('onboarding viewport geometry', () => {
  const viewport = { left: 0, top: 0, width: 1200, height: 800 }
  it('clips offscreen targets and never spotlights a zero-size or absent target', () => {
    expect(guideCutout({ left: -10, top: 12, width: 100, height: 44 }, viewport, 8)).toEqual({ left: 0, top: 4, width: 98, height: 60 })
    expect(guideCutout({ left: 1400, top: 0, width: 100, height: 40 }, viewport, 8)).toBeNull()
    expect(guideCutout({ left: 10, top: 10, width: 0, height: 40 }, viewport, 8)).toBeNull()
  })
  it('covers only the background, leaving the real target hit area uncovered', () => {
    const hole = { left: 20, top: 30, width: 200, height: 80 }
    const masks = guideMasks(hole, viewport)
    const area = masks.reduce((sum, rect) => sum + rect.width * rect.height, 0)
    expect(area).toBe(viewport.width * viewport.height - hole.width * hole.height)
    expect(masks.every(rect => rect.width > 0 && rect.height > 0)).toBe(true)
  })
  it('puts the desktop card beside controls and within visual viewport offsets', () => {
    const target = { left: 900, top: 700, width: 240, height: 44 }
    const position = guideCardPosition(target, viewport, { width: 360, height: 200 }, 12, false)
    expect(position.left + position.width).toBeLessThan(target.left)
    expect(position.top + 200).toBeLessThanOrEqual(788)
    const zoomed = guideCardPosition(null, { left: 50, top: 30, width: 320, height: 500 }, { width: 360, height: 200 }, 12, true)
    expect(zoomed).toEqual({ left: 62, top: 318, width: 296, maxHeight: 476 })
  })
  it('moves a compact card above fixed phone controls instead of hiding their hit area', () => {
    const target = { left: 20, top: 290, width: 500, height: 44 }
    const card = guideCardPosition(target, { left: 0, top: 0, width: 740, height: 360 }, { width: 360, height: 220 }, 12, true)
    expect(card.top + 220).toBeLessThan(target.top)
  })
  it('constrains long phone copy to the free area next to the focused control', () => {
    const target = { left: 20, top: 280, width: 340, height: 100 }
    const card = guideCardPosition(target, { left: 0, top: 0, width: 390, height: 600 }, { width: 360, height: 450 }, 12, true)
    expect(card.top + Math.min(450, card.maxHeight)).toBeLessThan(target.top)
  })
})
