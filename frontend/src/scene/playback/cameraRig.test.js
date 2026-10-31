import { describe, expect, it } from 'vitest'

import {
  ARCADE_BOOM_M,
  BACKWARD_ZOOM_SCALE,
  BASE_FOV_DEG,
  CAMERA_MODE,
  aimDirectionScene,
  arcadeCameraPosition,
  backwardZoomScale,
  blendProgress,
  fovFromZoomRaw,
  isReversing,
  reticleRadiusPx,
  sampleRecorderCamera,
} from './cameraRig.js'

const facet = (zoom) => ({
  aim: { t: [0, 10], yaw: [0, 1], pitch: [0, 0.5], ray_x: [0, 10], ray_y: [0, 20], ray_z: [0, 30] },
  mode: { t: [0, 2, 3, 5, 6], raw: [1, 0, 1, 0x80000000, 1] },
  zoom,
  bloom: { t: [4], raw: [0.9] },
})
const CONTINUOUS = { t: [2.008, 2.5, 3], raw: [54, 40, 27] }
const SPARSE = { t: [2, 2.6, 5.5], raw: [27, 16.88, 6.75] }

describe('sampleRecorderCamera', () => {
  it('interpolates aim between keyframes and clamps outside them', () => {
    const middle = sampleRecorderCamera(facet(CONTINUOUS), 5)
    expect(middle.yaw).toBeCloseTo(0.5)
    expect(middle.pitch).toBeCloseTo(0.25)
    expect([middle.rayX, middle.rayY, middle.rayZ]).toEqual([5, 10, 15])
    expect(sampleRecorderCamera(facet(CONTINUOUS), 99).yaw).toBe(1)
    expect(sampleRecorderCamera(facet(CONTINUOUS), -1).yaw).toBe(0)
  })

  it('reads mode from Type23 and keeps the raw high bit', () => {
    const samples = facet(CONTINUOUS)
    expect(sampleRecorderCamera(samples, 1).mode).toBe(CAMERA_MODE.ARCADE)
    expect(sampleRecorderCamera(samples, 2.5).mode).toBe(CAMERA_MODE.SNIPER)
    const highBit = sampleRecorderCamera(samples, 5.5)
    expect(highBit.mode).toBe(CAMERA_MODE.SNIPER)
    expect(highBit.rawMode).toBe(0x80000000)
  })

  it('holds zoom without interpolating sparse samples', () => {
    expect(sampleRecorderCamera(facet(SPARSE), 2.59).zoomRaw).toBe(27)
    expect(sampleRecorderCamera(facet(SPARSE), 2.61).zoomRaw).toBe(16.88)
  })

  it('never leaks zoom across sessions or into arcade', () => {
    expect(sampleRecorderCamera(facet(SPARSE), 4).zoomRaw).toBeNull()
    // 第二个 session 开始时第一段的值不得延续，取本 session 的首样本
    expect(sampleRecorderCamera(facet(SPARSE), 5.1).zoomRaw).toBe(6.75)
  })

  it('uses the first sample while a session has none yet, and null when it has none at all', () => {
    expect(sampleRecorderCamera(facet(CONTINUOUS), 2.001).zoomRaw).toBe(54)
    expect(sampleRecorderCamera(facet({ t: [], raw: [] }), 2.5).zoomRaw).toBeNull()
  })

  it('reports no bloom before the first sample, then holds it', () => {
    expect(sampleRecorderCamera(facet(SPARSE), 3).bloomRaw).toBeNull()
    expect(sampleRecorderCamera(facet(SPARSE), 9).bloomRaw).toBe(0.9)
  })

  it('gives the same answer for a seek as for sequential playback', () => {
    const samples = facet(SPARSE)
    const reused = {}
    for (const t of [1, 2.7, 4.5, 5.6, 9]) sampleRecorderCamera(samples, t, reused)
    sampleRecorderCamera(samples, 2.7, reused)
    expect(reused).toEqual(sampleRecorderCamera(samples, 2.7))
  })
})

describe('aimDirectionScene', () => {
  it('negates game x and keeps a unit vector', () => {
    const direction = aimDirectionScene(Math.PI / 2, 0)
    expect(direction.x).toBeCloseTo(-1)
    expect(direction.z).toBeCloseTo(0)
    const tilted = aimDirectionScene(0.7, -0.2)
    expect(Math.hypot(tilted.x, tilted.y, tilted.z)).toBeCloseTo(1)
    expect(tilted.y).toBeLessThan(0)
  })
})

describe('arcadeCameraPosition', () => {
  it('sits behind the aim direction and above the anchor', () => {
    const position = arcadeCameraPosition({ x: 1, y: 2, z: 3 }, { x: 0, y: -0.5, z: 1 }, ARCADE_BOOM_M)
    expect(position.x).toBeCloseTo(1)
    expect(position.z).toBeCloseTo(3 - ARCADE_BOOM_M)
    expect(position.y).toBeGreaterThan(2)
  })
})

describe('reverse handling', () => {
  it('detects motion against the hull', () => {
    expect(isReversing({ x: 0, z: 0 }, { x: 0, z: -1 }, 0)).toBe(true)
    expect(isReversing({ x: 0, z: 0 }, { x: 0, z: 1 }, 0)).toBe(false)
    expect(isReversing({ x: 0, z: 0 }, { x: 0, z: -0.01 }, 0)).toBe(false)
  })

  it('eases toward the pull-back scale', () => {
    let scale = 1
    for (let i = 0; i < 200; i++) scale = backwardZoomScale(scale, true, 0.05)
    expect(scale).toBeCloseTo(BACKWARD_ZOOM_SCALE)
  })
})

describe('fovFromZoomRaw', () => {
  it('clamps to the observed range and falls back when zoom is unknown', () => {
    expect(fovFromZoomRaw(27)).toBe(27)
    expect(fovFromZoomRaw(1)).toBe(6.75)
    expect(fovFromZoomRaw(99)).toBe(54)
    expect(fovFromZoomRaw(null)).toBe(BASE_FOV_DEG)
  })
})

describe('reticleRadiusPx', () => {
  const radius = (bloomRaw, fovDeg) => reticleRadiusPx({ bloomRaw, fovDeg, viewportH: 900 })

  it('grows with bloom and with deeper zoom', () => {
    expect(radius(1.2, 55)).toBeGreaterThan(radius(0.8, 55))
    expect(radius(0.8, 13)).toBeGreaterThan(radius(0.8, 55))
  })

  it('stays small enough for a deep sniper zoom', () => {
    expect(radius(0.9, 6.75)).toBeLessThan(90)
    expect(radius(0.9, 27)).toBeLessThan(25)
  })

  it('stays inside the viewport budget and treats missing bloom as 1', () => {
    expect(radius(50, 6.75)).toBe(180)
    expect(radius(null, 55)).toBe(radius(1, 55))
  })
})

describe('blendProgress', () => {
  it('runs from 0 to 1 and clamps', () => {
    expect(blendProgress(0)).toBe(0)
    expect(blendProgress(0.125)).toBeCloseTo(0.5)
    expect(blendProgress(1)).toBe(1)
  })
})
