import { describe, expect, it } from 'vitest'
import {
  RADAR,
  axisPoint,
  radarGridPolygons,
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
})
