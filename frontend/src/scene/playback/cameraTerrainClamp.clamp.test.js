import { describe, expect, it } from 'vitest'
import { createCameraTerrainClamp } from './cameraTerrainClamp.ts'

describe('相机距离钳制（PR #411 P1-3，行为测试）', () => {
  function harness(ext) {
    const controls = {}
    const deps = {
      getControls: () => controls,
      getCamera: () => null,
      getTerrainMesh: () => null,
      sampleRenderedTerrainHeight: () => null,
      getHeightField: () => null,
      getHeightMeta: () => null,
      getWorldCenter: () => null,
      cameraDriven: () => false,
      isFollowing: () => false,
    }
    const clamp = createCameraTerrainClamp(deps)
    clamp.applyCameraClamp(ext)
    return { controls, baseMin: clamp.baseMinDistance() }
  }

  it('applyCameraClamp(ext)：近端 1 m，max = ext*2.2', () => {
    const small = harness(100)
    expect(small.baseMin).toBe(1)
    expect(small.controls.minDistance).toBe(1)
    expect(small.controls.maxDistance).toBeCloseTo(220, 10)

    const big = harness(500)
    expect(big.baseMin).toBe(1)
    expect(big.controls.minDistance).toBe(1)
    expect(big.controls.maxDistance).toBeCloseTo(1100, 10)
  })

  it('基准近端是模块单处状态，accessor 读取（无第二份）', () => {
    const a = harness(100)
    const b = harness(500)
    expect(a.baseMin).toBe(1)
    expect(b.baseMin).toBe(1)
  })
})
