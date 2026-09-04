import { describe, expect, it } from 'vitest'
import { computeVehicleMarkerSize, MARKER_SIZE_LIMITS } from './vehicleMarkerSizing'
import maus from '../vehicle-models/assets/maus/metadata.json'
import vickersLight from '../vehicle-models/assets/vickers-light/metadata.json'
import superConqueror from '../vehicle-models/assets/super-conqueror/metadata.json'
import grille15 from '../vehicle-models/assets/grille-15/metadata.json'

const mapView = {
  renderBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 },
}

describe('computeVehicleMarkerSize', () => {
  it('preserves real hull size relationships: compact LT < large HT/TD', () => {
    const lt = computeVehicleMarkerSize({ tankClass: 'Light tank' }, { mapView })
    const ht = computeVehicleMarkerSize({ tankClass: 'Heavy tank' }, { mapView })
    const td = computeVehicleMarkerSize({ tankClass: 'Tank destroyer' }, { mapView })
    expect(lt.renderBox.width).toBeLessThan(ht.renderBox.width)
    expect(lt.renderBox.width).toBeLessThan(td.renderBox.width)
  })

  // 尺寸优先级：vehicleSizes 真实车体表（按 tankId，覆盖全部 735 辆）> 模型 metadata > class 猜测。
  it('prefers the real hull table and is deterministic for the same vehicle', () => {
    const vehicle = { tankClass: 'Heavy tank', tankId: 6929 } // Maus
    const model = { hullBounds: { minX: -1.86, maxX: 1.86, minY: -4.44, maxY: 4.6 } }
    const first = computeVehicleMarkerSize(vehicle, { model, mapView, mapWidthPx: 800, mapHeightPx: 800 })
    const second = computeVehicleMarkerSize(vehicle, { model, mapView, mapWidthPx: 800, mapHeightPx: 800 })
    expect(first).toEqual(second)
    expect(first.source).toBe('blitzkit-hull')
    expect(first.footprint.length).toBeCloseTo(8.984, 3)
    expect(first.renderBox.width).toBe(first.renderBox.height)
    expect(first.collisionFootprint.height).toBeGreaterThan(first.collisionFootprint.width)
  })

  it('falls back to model metadata for a tankId the hull table does not cover', () => {
    const vehicle = { tankClass: 'Heavy tank', tankId: 999999999 }
    const model = { hullBounds: { minX: -1.86, maxX: 1.86, minY: -4.44, maxY: 4.6 } }
    const size = computeVehicleMarkerSize(vehicle, { model, mapView, mapWidthPx: 800, mapHeightPx: 800 })
    expect(size.source).toBe('hull-metadata')
    expect(size.footprint.length).toBeCloseTo(9.04, 2)
  })

  // 真实尺度回归：800px 地图覆盖 600m → 1.333 px/m，毛斯车体 8.984m ≈ 12px（含 88% 烘焙补偿）。
  it('draws the Maus close to its real hull length in map pixels', () => {
    const size = computeVehicleMarkerSize({ tankClass: 'Heavy tank', tankId: 6929 },
      { mapView, mapWidthPx: 800, mapHeightPx: 800 })
    const pxPerMetre = 800 / 600
    expect(size.renderBox.height).toBeCloseTo(8.984 * pxPerMetre * 1.14, 1)
    expect(size.renderBox.height).toBeLessThan(16)
  })

  it('keeps all dedicated rasters isotropic while preserving Maus/LT/HT/TD size differences', () => {
    const entries = [
      ['Maus', maus, 'Heavy tank'],
      ['Vickers Light', vickersLight, 'Light tank'],
      ['Super Conqueror', superConqueror, 'Heavy tank'],
      ['Grille 15', grille15, 'Tank destroyer'],
    ]
    const sizes = entries.map(([, metadata, tankClass]) => computeVehicleMarkerSize(
      { tankClass },
      { model: { hullBounds: metadata.generation.hullBounds }, mapView, mapWidthPx: 800, mapHeightPx: 800 },
    ))
    for (const size of sizes) {
      expect(size.renderBox.width).toBe(size.renderBox.height)
      expect(size.hitTarget.width).toBe(size.hitTarget.height)
    }
    expect(Math.max(sizes[1].collisionFootprint.width, sizes[1].collisionFootprint.height))
      .toBeLessThan(Math.max(sizes[0].collisionFootprint.width, sizes[0].collisionFootprint.height))
    expect(Math.max(sizes[1].collisionFootprint.width, sizes[1].collisionFootprint.height))
      .toBeLessThan(Math.max(sizes[2].collisionFootprint.width, sizes[2].collisionFootprint.height))
    expect(Math.max(sizes[1].collisionFootprint.width, sizes[1].collisionFootprint.height))
      .toBeLessThan(Math.max(sizes[3].collisionFootprint.width, sizes[3].collisionFootprint.height))
  })

  it.each([
    [false, MARKER_SIZE_LIMITS.desktop],
    [true, MARKER_SIZE_LIMITS.mobile],
  ])('clamps the long edge in %s mode', (mobile, limits) => {
    for (const vehicle of [{ tankClass: 'Light tank' }, { tankClass: 'Heavy tank' }, {}]) {
      const size = computeVehicleMarkerSize(vehicle, { mapView, mobile, mapWidthPx: 800, mapHeightPx: 800 })
      const longEdge = Math.max(size.renderBox.width, size.renderBox.height)
      expect(longEdge).toBeGreaterThanOrEqual(limits.min)
      expect(longEdge).toBeLessThanOrEqual(limits.max)
      expect(size.hitTarget.width).toBeGreaterThan(size.renderBox.width)
      expect(size.hitTarget.height).toBeGreaterThan(size.renderBox.height)
    }
  })

  it('uses a reasonable class fallback when real metadata is missing', () => {
    const size = computeVehicleMarkerSize({ tankClass: 'not-a-real-class' }, { mapView })
    expect(size.source).toBe('class-fallback')
    expect(size.renderBox.width).toBeGreaterThan(0)
    expect(size.renderBox.height).toBeGreaterThan(0)
    expect(size.collisionFootprint.width).toBeGreaterThan(0)
    expect(size.collisionFootprint.height).toBeGreaterThan(0)
  })
})
