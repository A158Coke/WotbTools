import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import {
  GRID, PROXY_FOOTPRINT, createTankContactShadows, measureShadowFootprint, shadowGridXZ, sunShadowFrom,
} from './tankContactShadows.ts'

const O = { x: 0, y: 0, z: 0 }
const at = (x: number, y: number, z: number) => ({ x, y, z })

/** 阴影中心 = 网格中点（GRID 奇数） */
function center(x: number, z: number, yaw: number, sun = sunShadowFrom(at(0, 100, 0), O), fp = PROXY_FOOTPRINT) {
  const out = shadowGridXZ(x, z, yaw, fp, sun, new Float32Array(GRID * GRID * 2))
  const mid = ((GRID * GRID) - 1) / 2
  return { cx: out[mid * 2], cz: out[mid * 2 + 1], out }
}

describe('sunShadowFrom：传播方向 = target − light', () => {
  it('正上方的太阳：居中', () => {
    expect(sunShadowFrom(at(0, 1000, 0), O).centered).toBe(true)
  })

  it.each([
    ['光从 −X 射向 +X（左→右）', at(-500, 1000, 0), [1, 0]],
    ['光从 +X 射向 −X（右→左）', at(500, 1000, 0), [-1, 0]],
    ['光从 −Z 射向 +Z', at(0, 1000, -500), [0, 1]],
    ['光从 +Z 射向 −Z', at(0, 1000, 500), [0, -1]],
  ])('%s：阴影落在传播方向一侧（不取反）', (_name, light, [ex, ez]) => {
    const s = sunShadowFrom(light, O)
    expect(s.centered).toBe(false)
    expect(s.dirX).toBeCloseTo(ex, 6)
    expect(s.dirZ).toBeCloseTo(ez, 6)
    expect(s.offsetFactor).toBeGreaterThan(0)
    const { cx, cz } = center(0, 0, 0, s)
    expect(Math.sign(Math.round(cx * 1e6))).toBe(Math.sign(ex))
    expect(Math.sign(Math.round(cz * 1e6))).toBe(Math.sign(ez))
  })

  it('不假设 target 在原点：只看两者之差', () => {
    const a = sunShadowFrom(at(-500, 1000, 0), O)
    const b = sunShadowFrom(at(-400, 1000, 300), at(100, 0, 300))
    expect(b.dirX).toBeCloseTo(a.dirX, 9)
    expect(b.offsetFactor).toBeCloseTo(a.offsetFactor, 9)
  })

  it('太阳越低偏移/拉伸越大，但有硬上限', () => {
    const high = sunShadowFrom(at(-100, 1000, 0), O)
    const low = sunShadowFrom(at(-1000, 200, 0), O)
    const grazing = sunShadowFrom(at(-1000, 60, 0), O)
    expect(low.offsetFactor).toBeGreaterThan(high.offsetFactor)
    expect(low.stretch).toBeGreaterThan(high.stretch)
    expect(grazing.offsetFactor).toBeLessThanOrEqual(0.6)
    expect(grazing.stretch).toBeLessThanOrEqual(1.6)
  })

  it.each([
    ['零向量', at(0, 0, 0)],
    ['水平光', at(-1000, 0, 0)],
    ['自下而上', at(0, -1000, 0)],
    ['NaN', at(Number.NaN, 1000, 0)],
    ['Infinity', at(Number.POSITIVE_INFINITY, 1000, 0)],
  ])('%s → 居中回退（无 NaN）', (_name, light) => {
    const s = sunShadowFrom(light, O)
    expect(s).toEqual({ centered: true, dirX: 0, dirZ: 0, offsetFactor: 0, stretch: 1 })
    expect([...center(3, 4, 1, s).out].every(Number.isFinite)).toBe(true)
  })

  it('默认兜底太阳（renderer.ts：position 120,260,80 → 原点）：阴影偏向 −X/−Z', () => {
    const s = sunShadowFrom(at(120, 260, 80), O)
    expect(s.centered).toBe(false)
    expect(s.dirX).toBeLessThan(0)
    expect(s.dirZ).toBeLessThan(0)
  })
})

describe('shadowGridXZ：车体朝向与太阳偏移分离', () => {
  it('转向不改变太阳偏移方向（偏移在世界系施加）', () => {
    const s = sunShadowFrom(at(-500, 1000, 0), O)
    for (const yaw of [0, 0.7, Math.PI / 2, 2.5, -1.2]) {
      const { cx, cz } = center(10, 20, yaw, s)
      expect(cx).toBeGreaterThan(10)
      expect(cz).toBeCloseTo(20, 5)
    }
  })

  it('基础形状随车体旋转：yaw=π/2 时长轴转到 X', () => {
    const centered = sunShadowFrom(at(0, 1, 0), O)
    const span = (out: Float32Array, k: 0 | 1) => {
      let lo = Infinity, hi = -Infinity
      for (let i = k; i < out.length; i += 2) { lo = Math.min(lo, out[i]); hi = Math.max(hi, out[i]) }
      return hi - lo
    }
    const a = center(0, 0, 0, centered).out
    const b = center(0, 0, Math.PI / 2, centered).out
    expect(span(a, 1)).toBeGreaterThan(span(a, 0))
    expect(span(b, 0)).toBeGreaterThan(span(b, 1))
  })
})

describe('measureShadowFootprint', () => {
  it('取水平包围盒，长 = 较大轴；不可信时回落代理尺寸', () => {
    const tank = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 7))
    expect(measureShadowFootprint(tank)).toEqual({ halfW: 1.5, halfL: 3.5 })
    const sideways = new THREE.Mesh(new THREE.BoxGeometry(7, 2, 3))
    expect(measureShadowFootprint(sideways)).toEqual({ halfW: 1.5, halfL: 3.5 })
    expect(measureShadowFootprint(new THREE.Group())).toEqual(PROXY_FOOTPRINT)
  })
})

function harness(heightAt: (x: number, z: number) => number | null = () => 5) {
  const scene = new THREE.Scene()
  const sunLight = new THREE.DirectionalLight()
  sunLight.position.set(-500, 1000, 0)
  scene.add(sunLight); scene.add(sunLight.target)
  const sampler = vi.fn(heightAt)
  const shadows = createTankContactShadows({ scene, sunLight, heightAt: sampler })
  const meshes = () => scene.children.filter(o => o.name === 'tankContactShadow') as THREE.Mesh[]
  return { scene, sunLight, sampler, shadows, meshes }
}

describe('createTankContactShadows', () => {
  it('创建时不产生网格；首个可见车辆才建一片', () => {
    const h = harness()
    expect(h.meshes()).toHaveLength(0)
    const v = {}
    h.shadows.update(v, 0, 0, 0, true)
    expect(h.meshes()).toHaveLength(1)
    expect(h.shadows.count()).toBe(1)
    const m = h.meshes()[0].material as THREE.MeshBasicMaterial
    expect(m.depthTest).toBe(true)
    expect(m.depthWrite).toBe(false)
    expect(m.transparent).toBe(true)
  })

  it('贴合斜坡：每个顶点按自身 XZ 采样地表', () => {
    const h = harness((x, z) => 0.2 * x - 0.1 * z + 3)
    h.shadows.update({}, 10, 10, 0.4, true)
    const arr = h.meshes()[0].geometry.getAttribute('position').array
    for (let i = 0; i < GRID * GRID; i++) {
      const x = arr[i * 3], y = arr[i * 3 + 1], z = arr[i * 3 + 2]
      expect(y).toBeCloseTo(0.2 * x - 0.1 * z + 3 + 0.04, 4)
      expect([x, y, z].every(Number.isFinite)).toBe(true)
    }
    expect(h.sampler).toHaveBeenCalledTimes(GRID * GRID)
  })

  it('任一采样点无地表 → 隐藏（不拿 0 冒充）；地表就绪后 reground 恢复', () => {
    let ready = false
    const h = harness(x => (ready || x < 0 ? 1 : null))
    const v = {}
    h.shadows.update(v, 0, 0, 0, true)
    expect(h.meshes()[0].visible).toBe(false)
    h.shadows.update(v, 0, 0, 0, true)   // 同位姿：仍隐藏
    expect(h.meshes()[0].visible).toBe(false)
    ready = true
    h.shadows.reground()
    expect(h.meshes()[0].visible).toBe(true)
  })

  it('位姿/太阳未变时跳过重采样；位姿变化后跟随', () => {
    const h = harness()
    const v = {}
    h.shadows.update(v, 1, 2, 0, true)
    h.shadows.update(v, 1, 2, 0, true)
    expect(h.sampler).toHaveBeenCalledTimes(GRID * GRID)
    h.shadows.update(v, 50, 60, 0, true)
    expect(h.sampler).toHaveBeenCalledTimes(2 * GRID * GRID)
    const arr = h.meshes()[0].geometry.getAttribute('position').array
    expect(arr[((GRID * GRID - 1) / 2) * 3]).toBeGreaterThan(50)   // 太阳自 −X：中心落在 +X 侧
  })

  it('不可见 → 隐藏；太阳改变 → 偏移方向随之改变', () => {
    const h = harness()
    const v = {}
    h.shadows.update(v, 0, 0, 0, true)
    h.shadows.update(v, 0, 0, 0, false)
    expect(h.shadows.count()).toBe(0)
    h.sunLight.position.set(500, 1000, 0)
    h.shadows.syncSun()
    h.shadows.update(v, 0, 0, 0, true)
    const arr = h.meshes()[0].geometry.getAttribute('position').array
    expect(arr[((GRID * GRID - 1) / 2) * 3]).toBeLessThan(0)
  })

  it('实测尺寸影响阴影大小', () => {
    const h = harness()
    const small = {}, big = {}
    h.shadows.setFootprint(big, { halfW: 3, halfL: 6 })
    h.shadows.update(small, 0, 0, 0, true)
    h.shadows.update(big, 100, 0, 0, true)
    const [a, b] = h.meshes().map(m => { m.geometry.computeBoundingSphere(); return m.geometry.boundingSphere!.radius })
    expect(b).toBeGreaterThan(a)
  })

  it('dispose：移除网格，共享材质/贴图各释放一次，幂等且之后的调用无效', () => {
    const h = harness()
    h.shadows.update({}, 0, 0, 0, true)
    h.shadows.update({}, 10, 0, 0, true)
    const meshes = h.meshes()
    const mat = meshes[0].material as THREE.MeshBasicMaterial
    const tex = mat.map!
    const onMat = vi.fn(), onTex = vi.fn(), onGeo = vi.fn()
    mat.addEventListener('dispose', onMat)
    tex.addEventListener('dispose', onTex)
    for (const m of meshes) m.geometry.addEventListener('dispose', onGeo)
    h.shadows.dispose()
    h.shadows.dispose()
    expect(h.meshes()).toHaveLength(0)
    expect(onMat).toHaveBeenCalledTimes(1)
    expect(onTex).toHaveBeenCalledTimes(1)
    expect(onGeo).toHaveBeenCalledTimes(2)
    h.shadows.update({}, 0, 0, 0, true)
    expect(h.meshes()).toHaveLength(0)
  })
})
