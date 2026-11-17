// 地图边界材质（sceneryMaterials.ts::makeMapBorderMaterial）单测。
// 上游（Agent 仓 export_map_glb.collect_map_border）把 MapBorderComponent 的视觉字段
// 写进材质 extras.mapBorder；材质 id=0 是引擎内置、不可得 ⇒ 这些字段是唯一视觉依据。
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { makeMapBorderMaterial } from './sceneryMaterials.js'

const VISUAL = {
  color: [1.0, 0.156, 0.156, 1.0],
  height: 0.9,
  minZ: 14.5,
  maxZ: 100,
  zFadeWidth: 2,
  zOffset: -0.2,
  distanceFadeEnabled: false,
  distanceFadeNear: 300,
  distanceFadeFar: 400,
  distanceNearFarSq: [90000, 160000],
  distanceFadeEnabledRo: false,
  rect: [-287, -275.4, 274, 276.6],
}

describe('makeMapBorderMaterial', () => {
  it('uniforms 逐字段取组件视觉参数（颜色/高度区间/淡出/距离界）', () => {
    const m = makeMapBorderMaterial(new THREE.MeshStandardMaterial(), VISUAL)
    expect(m.uniforms.uColor.value.toArray()).toEqual([1.0, 0.156, 0.156])
    expect(m.uniforms.uAlpha.value).toBe(1.0)
    expect(m.uniforms.uMinZ.value).toBe(14.5)
    expect(m.uniforms.uMaxZ.value).toBe(100)
    expect(m.uniforms.uFade.value).toBe(2)
    expect(m.uniforms.uZOffset.value).toBeCloseTo(-0.2, 6)
    expect(m.uniforms.uFadeEnable.value).toBe(0)      // 该图两侧淡出都关
    expect(m.uniforms.uNearSq.value).toBe(90000)
    expect(m.uniforms.uFarSq.value).toBe(160000)
    m.dispose()
  })

  it('不受光半透明双面（引擎边界视觉不进光照管线）', () => {
    const m = makeMapBorderMaterial(new THREE.MeshStandardMaterial(), VISUAL)
    expect(m.transparent).toBe(true)
    expect(m.depthWrite).toBe(false)
    expect(m.side).toBe(THREE.DoubleSide)
    m.dispose()
  })

  it('缺字段回退安全默认（不抛异常；颜色红/距离界默认）', () => {
    const m = makeMapBorderMaterial(new THREE.MeshStandardMaterial(), {})
    expect(m.uniforms.uColor.value.x).toBe(1)
    expect(m.uniforms.uNearSq.value).toBe(90000)
    expect(m.uniforms.uMinZ.value).toBe(-100)
    expect(m.uniforms.uMaxZ.value).toBe(100)
    m.dispose()
  })

  it('展示端高亮：uTime 驱动呼吸，颜色向亮红提亮（作者色仍保留在 uniform）', () => {
    const m = makeMapBorderMaterial(new THREE.MeshStandardMaterial(), VISUAL)
    expect(m.uniforms.uTime.value).toBe(0)
    expect(m.uniforms.uColor.value.toArray()).toEqual([1.0, 0.156, 0.156])
    expect(m.fragmentShader).toContain('uTime * 2.4')
    expect(m.fragmentShader).toContain('mix(uColor, vec3(1.0, 0.18, 0.12), 0.55)')
    // 距离淡出以相机为原点（不是世界原点）：边缘/角落靠近时仍可见
    expect(m.fragmentShader).toContain('cameraPosition.xz')
    expect(m.fragmentShader).not.toMatch(/dot\(vWorld\.xz, vWorld\.xz\)/)
    m.dispose()
  })
})
