import { describe, expect, it } from 'vitest'
import {
  RADAR,
  axisPoint,
  radarGridPolygons,
  radarScoreBadgeWidth,
  radarScoreLabelPosition,
  radarScaleTicks,
  radarValueRatio,
} from './radarGeometry.js'

describe('radarGeometry visual scale', () => {
  it('reserves 150 as an invisible cap and exposes only 25/50/100 grids', () => {
    const grids = radarGridPolygons(6)
    expect(grids.map(grid => grid.value)).toEqual([25, 50, 100])
    expect(grids.map(grid => grid.ratio)).toEqual([1 / 6, 1 / 3, 2 / 3])
    expect(grids.some(grid => grid.value === RADAR.DISPLAY_CAP)).toBe(false)
  })

  it('shows 25/50/75/100 ticks without exposing the 150 cap', () => {
    const ticks = radarScaleTicks(7)
    expect(ticks.map(tick => tick.value)).toEqual([25, 50, 75, 100])
    expect(ticks.map(tick => tick.ratio)).toEqual([1 / 6, 1 / 3, 1 / 2, 2 / 3])
    expect(ticks.some(tick => tick.value === 150)).toBe(false)
  })

  it('places the 75 average at half radius, 100 at two thirds, and player cap at full radius', () => {
    const center = axisPoint(0, 6, 0)
    const average = axisPoint(0, 6, radarValueRatio(RADAR.AVERAGE_VALUE))
    const strong = axisPoint(0, 6, radarValueRatio(RADAR.STRONG_VALUE))
    const cap = axisPoint(0, 6, radarValueRatio(RADAR.DISPLAY_CAP))
    expect(center).toEqual([RADAR.CENTER, RADAR.CENTER])
    expect(RADAR.CENTER - average[1]).toBe(RADAR.RADIUS / 2)
    expect(RADAR.CENTER - strong[1]).toBeCloseTo(RADAR.RADIUS * 2 / 3, 12)
    expect(RADAR.CENTER - cap[1]).toBe(RADAR.RADIUS)
  })

  it('positions score badges away from axis labels and sizes their backplates', () => {
    const top = radarScoreLabelPosition(0, 6, 125 / 150)
    const side = radarScoreLabelPosition(1, 6, 125 / 150)
    expect(top.ratio).toBeGreaterThan(125 / 150)
    expect(side.ratio).toBeLessThan(125 / 150)
    expect(top.y).toBeLessThan(axisPoint(0, 6, 125 / 150)[1])
    expect(radarScoreBadgeWidth('8')).toBe(18)
    expect(radarScoreBadgeWidth('138')).toBe(26)
  })

  it.each([6, 7])('keeps capped %i-axis top badges clear of the top axis label', count => {
    const labelY = axisPoint(0, count, RADAR.LABEL_RADIUS)[1]
    for (const ratio of [149 / 150, 1]) {
      const badge = radarScoreLabelPosition(0, count, ratio)
      expect(badge.y - labelY).toBeGreaterThanOrEqual(RADAR.SCORE_BADGE_HEIGHT)
    }
  })

  it.each([6, 7])('keeps %i zero/near-zero score badges readable around the center', count => {
    for (const ratio of [0, 0.01]) {
      const badges = Array.from({ length: count }, (_, index) => {
        const position = radarScoreLabelPosition(index, count, ratio)
        const width = radarScoreBadgeWidth('0')
        return {
          left: position.x - width / 2,
          right: position.x + width / 2,
          top: position.y - RADAR.SCORE_BADGE_HEIGHT / 2,
          bottom: position.y + RADAR.SCORE_BADGE_HEIGHT / 2,
        }
      })
      for (let i = 0; i < badges.length; i++) {
        for (let j = i + 1; j < badges.length; j++) {
          const a = badges[i]
          const b = badges[j]
          const overlaps = a.left < b.right && a.right > b.left
            && a.top < b.bottom && a.bottom > b.top
          expect(overlaps, `badges ${i}/${j} overlap at ratio ${ratio}`).toBe(false)
        }
      }
      expect(radarScoreLabelPosition(0, count, ratio).x).toBeGreaterThan(RADAR.CENTER)
    }
  })
})
