import { describe, expect, it } from 'vitest'
import { computeVehicleMarkerSize, MARKER_SIZE_LIMITS } from './vehicleMarkerSizing'

const mapView = {
  renderBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 },
}

describe('computeVehicleMarkerSize', () => {
  it('preserves real hull size relationships: compact LT < large HT/TD', () => {
    const lt = computeVehicleMarkerSize({ tankClass: 'Light tank' }, { mapView })
    const ht = computeVehicleMarkerSize({ tankClass: 'Heavy tank' }, { mapView })
    const td = computeVehicleMarkerSize({ tankClass: 'Tank destroyer' }, { mapView })
    expect(Math.max(lt.width, lt.height)).toBeLessThan(Math.max(ht.width, ht.height))
    expect(Math.max(lt.width, lt.height)).toBeLessThan(Math.max(td.width, td.height))
  })

  it('prefers source hull metadata and is deterministic for the same vehicle', () => {
    const vehicle = { tankClass: 'Heavy tank', tankId: 6929 }
    const model = { hullBounds: { minX: -1.86, maxX: 1.86, minY: -4.44, maxY: 4.6 } }
    const first = computeVehicleMarkerSize(vehicle, { model, mapView, mapWidthPx: 800, mapHeightPx: 800 })
    const second = computeVehicleMarkerSize(vehicle, { model, mapView, mapWidthPx: 800, mapHeightPx: 800 })
    expect(first).toEqual(second)
    expect(first.source).toBe('hull-metadata')
    expect(first.footprint.length).toBeCloseTo(9.04, 2)
  })

  it.each([
    [false, MARKER_SIZE_LIMITS.desktop],
    [true, MARKER_SIZE_LIMITS.mobile],
  ])('clamps the long edge in %s mode', (mobile, limits) => {
    for (const vehicle of [{ tankClass: 'Light tank' }, { tankClass: 'Heavy tank' }, {}]) {
      const size = computeVehicleMarkerSize(vehicle, { mapView, mobile, mapWidthPx: 800, mapHeightPx: 800 })
      const longEdge = Math.max(size.width, size.height)
      expect(longEdge).toBeGreaterThanOrEqual(limits.min)
      expect(longEdge).toBeLessThanOrEqual(limits.max)
      expect(size.hitTarget.width).toBeGreaterThan(size.width)
      expect(size.hitTarget.height).toBeGreaterThan(size.height)
    }
  })

  it('uses a reasonable class fallback when real metadata is missing', () => {
    const size = computeVehicleMarkerSize({ tankClass: 'not-a-real-class' }, { mapView })
    expect(size.source).toBe('class-fallback')
    expect(size.width).toBeGreaterThan(0)
    expect(size.height).toBeGreaterThan(0)
  })
})
