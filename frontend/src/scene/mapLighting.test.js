// 逐图光照共享模块（src/scene/mapLighting.js）单测：
// 兜底常量、方向语义（position = −传播方向）、"保色相、归亮度"曝光归一（三通道同除）、
// 复位语义、sunUniforms 写入。用真 THREE 灯泡对象测（模块导入 three，vitest 环境可实例化）。
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { applyMapLighting, resetMapLighting, DEFAULT_HEMI_INTENSITY, DEFAULT_SUN_INTENSITY } from './mapLighting.js'
import { sunUniforms } from './sceneryMaterials.js'

function rig() {
  const renderer = { toneMappingExposure: 1.0 }
  const scene = { environmentIntensity: 1.0 }
  const sunLight = new THREE.DirectionalLight(0xffffff, DEFAULT_SUN_INTENSITY)
  sunLight.target = new THREE.Object3D()
  const hemiLight = new THREE.HemisphereLight(0xbfd4e8, 0x2a2f36, DEFAULT_HEMI_INTENSITY)
  return { renderer, scene, sunLight, hemiLight }
}

const FAUST = {
  sun: {
    color: [0.40, 0.50, 0.70],
    intensity: 8.0,
    ambient: [0.937752366065979, 0.957766056060791, 1.0044586658477783],
    direction_scene: [-0.4860337760940354, -0.6871515920696455, 0.5399943129446455],
  },
  ibl: { 'ibl.environmentMultiplier': 1.7 },
}

describe('mapLighting：应用与归一（faust 真值回归）', () => {
  it('方向 = −传播方向归一 ×1000；色/强度/环境色按 authored', () => {
    const r = rig()
    applyMapLighting({ ...r, lighting: FAUST })
    const d = FAUST.sun.direction_scene
    const n = Math.hypot(...d)
    expect(r.sunLight.position.x).toBeCloseTo(-d[0] / n * 1000, 3)
    expect(r.sunLight.position.y).toBeCloseTo(-d[1] / n * 1000, 3)
    expect(r.sunLight.position.z).toBeCloseTo(-d[2] / n * 1000, 3)
    expect(r.sunLight.intensity).toBe(8.0)
    expect(r.sunLight.color.r).toBeCloseTo(0.40, 5)
    expect(r.hemiLight.color.r).toBeCloseTo(0.937752366065979, 6)
  })

  it('曝光归一（保色相、归亮度）：expo = 3.0/8.0，hemi 与 IBL 三通道同除', () => {
    const r = rig()
    const ret = applyMapLighting({ ...r, lighting: FAUST })
    expect(ret.normalized).toBe(true)
    expect(r.renderer.toneMappingExposure).toBeCloseTo(DEFAULT_SUN_INTENSITY / 8.0, 6)
    expect(r.hemiLight.intensity).toBeCloseTo(DEFAULT_HEMI_INTENSITY / (DEFAULT_SUN_INTENSITY / 8.0), 6)
    expect(ret.envMultiplier).toBeCloseTo(1.7 / (DEFAULT_SUN_INTENSITY / 8.0), 6)
    expect(r.scene.environmentIntensity).toBeCloseTo(ret.envMultiplier, 6)
    // 共享 uniform：uSunColor = color × authored intensity（环境反射高光项用）
    expect(sunUniforms.uSunColor.value.x).toBeCloseTo(0.40 * 8.0, 5)
    expect(sunUniforms.uSunDirScene.value.z).toBeCloseTo(FAUST.sun.direction_scene[2], 6)
  })

  it('clamp 边界：强度 0.5 ⇒ expo 上限 4.0；强度 120 ⇒ 下限 0.05', () => {
    const a = rig()
    applyMapLighting({ ...a, lighting: { sun: { ...FAUST.sun, intensity: 0.5 } } })
    expect(a.renderer.toneMappingExposure).toBeCloseTo(4.0, 6)
    const b = rig()
    applyMapLighting({ ...b, lighting: { sun: { ...FAUST.sun, intensity: 120 } } })
    expect(b.renderer.toneMappingExposure).toBeCloseTo(0.05, 6)
  })

  it('无太阳方向块：不改灯、IBL authored 值原样返回（不可被归一覆盖）', () => {
    const r = rig()
    const ret = applyMapLighting({ ...r, lighting: { ibl: { 'ibl.environmentMultiplier': 1.3 } } })
    expect(ret.normalized).toBe(false)
    expect(ret.envMultiplier).toBeCloseTo(1.3, 6)
    expect(r.renderer.toneMappingExposure).toBeCloseTo(1.0, 6)
    expect(r.sunLight.intensity).toBeCloseTo(DEFAULT_SUN_INTENSITY, 6)
  })

  it('无灯光句柄：安全返回（envMultiplier=1，不改任何状态）', () => {
    const ret = applyMapLighting({ renderer: { toneMappingExposure: 1 }, scene: {}, sunLight: null, hemiLight: null, lighting: FAUST })
    expect(ret).toEqual({ envMultiplier: 1, normalized: false })
  })

  it('复位：灯回兜底常量、曝光 1.0、共享 uniform 回基线', () => {
    const r = rig()
    applyMapLighting({ ...r, lighting: FAUST })
    resetMapLighting({ ...r })
    expect(r.renderer.toneMappingExposure).toBeCloseTo(1.0, 6)
    expect(r.sunLight.intensity).toBeCloseTo(DEFAULT_SUN_INTENSITY, 6)
    expect(r.hemiLight.intensity).toBeCloseTo(DEFAULT_HEMI_INTENSITY, 6)
    expect(r.sunLight.position.x).toBeCloseTo(120, 6)
    expect(sunUniforms.uSunDirScene.value.y).toBeCloseTo(-1, 6)
    expect(sunUniforms.uSunColor.value.x).toBeCloseTo(1, 6)
    expect(r.scene.environmentIntensity).toBeCloseTo(1.0, 6)
  })
})
