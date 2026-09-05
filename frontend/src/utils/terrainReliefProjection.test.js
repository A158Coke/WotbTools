import { describe, expect, it } from 'vitest'
import {
  createTerrainReliefModel,
  projectTerrainPoint,
  sampleTerrainHeight,
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
