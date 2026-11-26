import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  MAX_DYNAMIC_LIGHTS, applyDynamicLights, applyMapLighting, lightPositionScene,
  resetDynamicLights, resetMapLighting, selectDynamicLights, updateDynamicLights,
  DEFAULT_HEMI_INTENSITY, DEFAULT_SUN_INTENSITY,
} from './mapLighting.ts'
import { sunUniforms } from './sceneryMaterials.ts'

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



const LIGHT = (over = {}) => ({
  name: 'spot.sc2',
  type: 2, flags: 3,
  intensity: 1.0, radius: 18.0, falloffExponent: 1.3,
  color: [0.145, 0.487, 1.0, 1.0],
  ambient: [0, 0, 0, 1],
  position: [112.19, -179.49, 38.49],
  rotation: [0, 0, 0.878, -0.478],
  ...over,
})

describe('selectDynamicLights（性能预算，非语义判据）', () => {
  it('按 亮度×半径 降序取前 max；并列按文件序稳定', () => {
    const recs = [LIGHT({ radius: 5 }), LIGHT({ radius: 20 }), LIGHT({ radius: 10 })]
    expect(selectDynamicLights(recs).map((r) => r.radius)).toEqual([20, 10, 5])
    expect(selectDynamicLights(recs, 2).length).toBe(2)
  })

  it('fail-closed：缺位置/色/半径/强度的记录被剔除', () => {
    const recs = [
      LIGHT(),
      LIGHT({ position: [1, 2] }),
      LIGHT({ position: [1, NaN, 3] }),
      LIGHT({ color: [] }),
      LIGHT({ radius: 0 }),
      LIGHT({ intensity: -1 }),
      null,
    ]
    expect(selectDynamicLights(recs).length).toBe(1)
    expect(selectDynamicLights(null)).toEqual([])
  })
})

describe('lightPositionScene（客户端世界系 → 回放场景系，qFrame 同式）', () => {
  it('(x,y,z) → (−x, z, y)；iceworld 实测值回归', () => {
    expect(lightPositionScene([1, 2, 3])).toEqual([-1, 3, 2])
    const [x, y, z] = lightPositionScene([112.192, -179.493, 38.494])
    expect(x).toBeCloseTo(-112.192, 3)
    expect(y).toBeCloseTo(38.494, 3)
    expect(z).toBeCloseTo(-179.493, 3)
  })
})

describe('applyDynamicLights / resetDynamicLights（真 THREE.Scene）', () => {
  it('建 PointLight：色/半径/位置按映射；亮度 = intensity×radius×0.35÷expo', () => {
    const scene = new THREE.Scene()
    const lights = applyDynamicLights(scene, [LIGHT()], 2.0)
    expect(lights.length).toBe(1)
    const l = lights[0]
    expect(l).toBeInstanceOf(THREE.PointLight)
    expect(l.distance).toBe(18.0)
    expect(l.decay).toBe(1)
    expect(l.intensity).toBeCloseTo(1.0 * 18.0 * 0.35 / 2.0, 6)
    expect(l.position.x).toBeCloseTo(-112.19, 3)
    expect(l.position.y).toBeCloseTo(38.49, 3)
    expect(l.position.z).toBeCloseTo(-179.49, 3)
    expect(scene.children).toContain(l)
    resetDynamicLights(scene)
    expect(scene.children.length).toBe(0)
  })

  it('超预算图（iceworld 71 盏）截到 MAX_DYNAMIC_LIGHTS；重入先摘旧灯', () => {
    const scene = new THREE.Scene()
    const many = Array.from({ length: 71 }, (_, i) => LIGHT({ position: [i, 0, 0] }))
    const first = applyDynamicLights(scene, many, 1)
    expect(first.length).toBe(MAX_DYNAMIC_LIGHTS)
    expect(scene.children.length).toBe(MAX_DYNAMIC_LIGHTS)
    const second = applyDynamicLights(scene, [LIGHT()], 1)
    expect(second.length).toBe(1)
    expect(scene.children.length).toBe(1)
    resetDynamicLights(scene)
  })

  it('无记录 = 无灯；applyMapLighting 路径下 dynamicLights 随 lighting.json 一起生效', () => {
    const scene = new THREE.Scene()
    expect(applyDynamicLights(scene, null, 1).length).toBe(0)
    expect(scene.children.length).toBe(0)
    const r = rig()
    const realScene = new THREE.Scene()
    applyMapLighting({ ...r, scene: realScene, lighting: { ...FAUST, dynamicLights: [LIGHT()] } })
    expect(realScene.children.length).toBe(1)
    const lamp = realScene.children[0]
    expect(lamp.intensity).toBeCloseTo(1.0 * 18.0 * 0.35 / 0.375, 6)
    resetMapLighting({ ...r, scene: realScene })
    expect(realScene.children.length).toBe(0)
  })
})


describe('updateDynamicLights（固定池逐帧近邻换绑）', () => {
  it('池大小恒定；相机移到哪，最近的灯就绑到池里', () => {
    const scene = new THREE.Scene()
    const east = LIGHT({ position: [200, 0, 0], radius: 10 })
    const west = LIGHT({ position: [-200, 0, 0], radius: 10 })
    const lights = applyDynamicLights(scene, [east, west], 1)
    expect(lights.length).toBe(2)
    updateDynamicLights(scene, { x: 200, y: 0, z: 0 })
    const xs = lights.map((l) => l.position.x).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(-200, 6)
    expect(xs[1]).toBeCloseTo(200, 6)
    resetDynamicLights(scene)
  })

  it('池满时只绑最近 MAX 盏；相机移动后绑定集合随之更替', () => {
    const scene = new THREE.Scene()
    const many = Array.from({ length: 40 }, (_, i) => LIGHT({ position: [i * 10, 0, 0], radius: 5 }))
    const lights = applyDynamicLights(scene, many, 1)
    expect(lights.length).toBe(MAX_DYNAMIC_LIGHTS)
    updateDynamicLights(scene, { x: 0, y: 0, z: 0 })
    const nearLeft = lights.map((l) => l.position.x).sort((a, b) => a - b)
    expect(Math.min(...nearLeft)).toBeCloseTo(-150, 6)
    expect(Math.max(...nearLeft)).toBeCloseTo(0, 6)
    updateDynamicLights(scene, { x: -390, y: 0, z: 0 })
    const nearRight = lights.map((l) => l.position.x).sort((a, b) => a - b)
    expect(Math.min(...nearRight)).toBeCloseTo(-390, 6)
    expect(Math.max(...nearRight)).toBeCloseTo(-240, 6)
    resetDynamicLights(scene)
  })

  it('无池/无相机位置 = no-op；复位清掉池与源表', () => {
    const scene = new THREE.Scene()
    updateDynamicLights(scene, { x: 0, y: 0, z: 0 })
    applyDynamicLights(scene, [LIGHT()], 1)
    updateDynamicLights(scene, null)
    resetDynamicLights(scene)
    expect(scene.userData.__dynamicLights).toBeUndefined()
    expect(scene.userData.__dynamicLightSource).toBeUndefined()
  })
})
