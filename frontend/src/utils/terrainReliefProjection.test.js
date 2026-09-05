import { describe, expect, it } from 'vitest'
import {
  RELIEF_EDGE_FADE_FRACTION,
  RELIEF_PADDING,
  RELIEF_Z_EXAGGERATION,
  VEHICLE_ATTITUDE_MAX_PITCH_DEG,
  createTerrainReliefModel,
  projectTerrainPoint,
  sampleTerrainAttitude,
  sampleTerrainHeight,
  terrainReliefEdgeWeight,
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

describe('footprint-preserving terrain relief projection', () => {
  it('keeps amplified relief without artificial framing shrink', () => {
    expect(RELIEF_Z_EXAGGERATION).toBe(2)
    expect(RELIEF_PADDING).toBe(0)
    expect(RELIEF_EDGE_FADE_FRACTION).toBeCloseTo(0.08)
  })

  it('pins the original 2d map perimeter exactly to the viewport', () => {
    const m = model()
    const southWest = projectTerrainPoint(m, -2, -2, 0)
    const northEast = projectTerrainPoint(m, 2, 2, 30)

    expect(southWest.xNorm).toBeCloseTo(0, 8)
    expect(southWest.yNorm).toBeCloseTo(1, 8)
    expect(northEast.xNorm).toBeCloseTo(1, 8)
    expect(northEast.yNorm).toBeCloseTo(0, 8)
    expect(terrainReliefEdgeWeight(m, -2, -2)).toBe(0)
    expect(terrainReliefEdgeWeight(m, 2, 2)).toBe(0)
  })

  it('uses height only as an interior vertical relief cue without compressing base Y', () => {
    const m = createTerrainReliefModel({
      mapCode: 'interior',
      worldBounds: { xMin: -2, yMin: -2, xMax: 2, yMax: 2 },
      heightRangeMeters: { min: 0, max: 30 },
      samplesPerAxis: 3,
      heights: new Float32Array([
        0, 0, 0,
        0, 15, 0,
        0, 30, 0,
      ]),
      zExaggeration: 1,
      padding: 0,
    })
    const low = projectTerrainPoint(m, 0, 0, 0)
    const high = projectTerrainPoint(m, 0, 0, 30)
    const south = projectTerrainPoint(m, 0, -1, 15)
    const north = projectTerrainPoint(m, 0, 1, 15)

    expect(high.xNorm).toBeCloseTo(low.xNorm, 8)
    expect(high.yNorm).toBeLessThan(low.yNorm)
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

  it('keeps projected bounds equal to the centered original map footprint', () => {
    const m = model()
    expect(m.projectedBounds.left).toBeCloseTo(-2)
    expect(m.projectedBounds.right).toBeCloseTo(2)
    expect(m.projectedBounds.bottom).toBeCloseTo(-2)
    expect(m.projectedBounds.top).toBeCloseTo(2)
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


describe('vehicle terrain attitude', () => {
  function gradientModel(axis, step = 0.5) {
    const size = 6
    const heights = []
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        heights.push((axis === 'y' ? row : col) * step)
      }
    }
    return createTerrainReliefModel({
      mapCode: 'attitude',
      worldBounds: { xMin: -12, yMin: -12, xMax: 12, yMax: 12 },
      heightRangeMeters: { min: 0, max: 100 },
      samplesPerAxis: size,
      heights: new Float32Array(heights),
      zExaggeration: 1,
      padding: 0,
    })
  }

  it('derives positive pitch from an uphill front/rear ground slope', () => {
    const attitude = sampleTerrainAttitude(gradientModel('y'), 0, 0, 0, { length: 8, width: 3.5 })
    expect(attitude.pitchDeg).toBeGreaterThan(5)
    expect(Math.abs(attitude.rollDeg)).toBeLessThan(0.01)
  })

  it('derives roll in vehicle-local axes without inventing pitch', () => {
    const attitude = sampleTerrainAttitude(gradientModel('x'), 0, 0, 0, { length: 8, width: 3.5 })
    expect(attitude.rollDeg).toBeGreaterThan(5)
    expect(Math.abs(attitude.pitchDeg)).toBeLessThan(0.01)
  })

  it('clamps extreme terrain to the presentation safety limit', () => {
    const attitude = sampleTerrainAttitude(gradientModel('y', 20), 0, 0, 0, { length: 8, width: 3.5 })
    expect(attitude.pitchDeg).toBe(VEHICLE_ATTITUDE_MAX_PITCH_DEG)
  })
})
