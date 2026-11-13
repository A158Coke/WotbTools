// Issue #827 Wave 2 — 相机距离钳制行为测试（接替 seekPointer.test.js 的源码文本守卫）。
// 钳制实现 owner = playback/cameraTerrainClamp.ts（#820 Wave B6A 出仓）；
// 行为断言：applyCameraClamp(ext) 设置 min/max 且基准距离 = max(20, ext*0.08)。
// 宿主注入与调用（applyCameraClamp();）为无注入点的 glue，守卫见 seekPointer.test.js 窄化子句。
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
    }
    const clamp = createCameraTerrainClamp({ ...deps, getControls: () => controls, getCamera: () => ({ position: { x: 0, y: 0, z: 0 }, getWorldDirection: () => ({ x: 0, y: -1, z: 0 }) }) })
    clamp.applyCameraClamp(ext)
    return { controls, baseMin: clamp.baseMinDistance() }
  }

  it('applyCameraClamp(ext)：min = max(20, ext*0.08)，max = ext*2.2', () => {
    const small = harness(100)   // 100*0.08=8 < 20 → 下限 20 生效
    expect(small.baseMin).toBe(20)
    expect(small.controls.minDistance).toBe(20)
    expect(small.controls.maxDistance).toBeCloseTo(220, 10)

    const big = harness(500)     // 500*0.08=40 > 20 → 按 ext 推导
    expect(big.baseMin).toBeCloseTo(40, 10)
    expect(big.controls.minDistance).toBeCloseTo(40, 10)
    expect(big.controls.maxDistance).toBeCloseTo(1100, 10)
  })

  it('基准距离是模块单处状态，accessor 读取（无第二份）', () => {
    const a = harness(100)
    const b = harness(500)
    expect(a.baseMin).toBe(20)
    expect(b.baseMin).toBeCloseTo(40, 10)
  })
})
