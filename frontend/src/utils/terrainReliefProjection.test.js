import { describe, expect, it } from 'vitest'
import {
  RELIEF_PADDING,
  RELIEF_Z_EXAGGERATION,
  createTerrainReliefModel,
  projectTerrainPoint,
  sampleTerrainHeight,
  unprojectTerrainPoint,
  visualReliefZ,
} from './terrainReliefProjection.js'

function model() {
  return createTerrainReliefModel({
    mapCode: 'test',
    worldBounds: { xMin: -2, yMin: -2, xMax: 2, yMax: 2 },
    heightRangeMeters: { min: 0, max: 30 },
    samplesPerAxis: 2,
    heights: new Float32Array([
      0, 10,
      20, 30,
    ]),
    zExaggeration: 1,
    padding: 0,
  })
}

describe('fixed 45 degree terrain relief projection', () => {
  it('keeps the approved amplified tactical-relief defaults', () => {
    expect(RELIEF_Z_EXAGGERATION).toBe(2)
    expect(RELIEF_PADDING).toBeCloseTo(0.035)
  })

  it('keeps X horizontal while higher Z moves north/up on screen', () => {
    const m = model()
    const low = projectTerrainPoint(m, 0, 0, 0)
    const high = projectTerrainPoint(m, 0, 0, 30)

    expect(high.xNorm).toBeCloseTo(low.xNorm, 8)
    expect(high.yNorm).toBeLessThan(low.yNorm)
  })

  it('keeps north screen-up with no azimuth rotation', () => {
    const m = model()
    const south = projectTerrainPoint(m, 0, -1, 15)
    const north = projectTerrainPoint(m, 0, 1, 15)

    expect(north.xNorm).toBeCloseTo(south.xNorm, 8)
    expect(north.yNorm).toBeLessThan(south.yNorm)
  })

  it('bilinearly samples the tiled heightfield contract in world coordinates', () => {
    const m = model()
    expect(sampleTerrainHeight(m, -2, -2)).toBeCloseTo(0)
    expect(sampleTerrainHeight(m, 0, -2)).toBeCloseTo(10)
    expect(sampleTerrainHeight(m, -2, 0)).toBeCloseTo(20)
    expect(sampleTerrainHeight(m, 0, 0)).toBeCloseTo(30)
  })

  it('tight-fits the actual projected terrain instead of forcing a square frustum', () => {
    const m = model()
    const width = m.projectedBounds.right - m.projectedBounds.left
    const height = m.projectedBounds.top - m.projectedBounds.bottom
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
    expect(width).not.toBeCloseTo(height, 8)
  })

  it('round-trips a visible screen point back to terrain semantic coordinates', () => {
    const m = createTerrainReliefModel({
      mapCode: 'flat',
      worldBounds: { xMin: -2, yMin: -2, xMax: 2, yMax: 2 },
      heightRangeMeters: { min: 10, max: 10 },
      samplesPerAxis: 2,
      heights: new Float32Array([10, 10, 10, 10]),
      zExaggeration: 1,
      padding: 0,
    })
    const projected = projectTerrainPoint(m, 0.5, -0.5)
    const restored = unprojectTerrainPoint(m, projected.xNorm, projected.yNorm)
    expect(restored.x).toBeCloseTo(0.5, 5)
    expect(restored.y).toBeCloseTo(-0.5, 4)
  })

  it('applies visual Z exaggeration around the authoritative range midpoint only', () => {
    const m = createTerrainReliefModel({
      mapCode: 'test',
      worldBounds: { xMin: -1, yMin: -1, xMax: 1, yMax: 1 },
      heightRangeMeters: { min: 10, max: 30 },
      samplesPerAxis: 2,
      heights: new Float32Array([10, 10, 30, 30]),
      zExaggeration: 2,
      padding: 0,
    })

    expect(visualReliefZ(m, 20)).toBe(20)
    expect(visualReliefZ(m, 10)).toBe(0)
    expect(visualReliefZ(m, 30)).toBe(40)
  })
})
