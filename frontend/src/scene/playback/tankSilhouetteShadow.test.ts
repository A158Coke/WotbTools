import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createSilhouetteShadow, makeSilhouetteMaterial, planarShadowMatrix } from './tankSilhouetteShadow.ts'

const UP = { x: 0, y: 1, z: 0 }

describe('planarShadowMatrix', () => {
  it('点沿光线传播方向落到平面上（不是沿反方向）', () => {
    const light = new THREE.Vector3(1, -1, 0).normalize()
    const m = planarShadowMatrix(UP, -0.04, light, new THREE.Matrix4())   // 平面 y = 0.04
    const p = new THREE.Vector3(1, 3, 2).applyMatrix4(m)
    expect(p.y).toBeCloseTo(0.04, 6)
    expect(p.x).toBeCloseTo(1 + (3 - 0.04), 6)   // 高 2.96 m、45° 光 ⇒ 向 +X 落 2.96 m
    expect(p.z).toBeCloseTo(2, 6)
  })

  it('斜面：投影点满足平面方程', () => {
    const n = new THREE.Vector3(0.2, 1, -0.1).normalize()
    const p0 = new THREE.Vector3(5, 2, 7)
    const light = new THREE.Vector3(-0.4, -0.8, 0.3).normalize()
    const m = planarShadowMatrix(n, -n.dot(p0), light, new THREE.Matrix4())
    for (const [x, y, z] of [[5, 4, 7], [6.5, 3, 5], [3, 2.5, 9]]) {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(m)
      expect(n.dot(p) - n.dot(p0)).toBeCloseTo(0, 6)
    }
  })

  it('背光入射（n·light > 0）退化为沿法线投影，不沿光线反方向求交', () => {
    const m = planarShadowMatrix(UP, 0, { x: 0.8, y: 0.6, z: 0 }, new THREE.Matrix4())
    const p = new THREE.Vector3(2, 5, 3).applyMatrix4(m)
    expect(p.x).toBeCloseTo(2, 9)
    expect(p.y).toBeCloseTo(0, 9)
    expect(p.z).toBeCloseTo(3, 9)
  })

  it('光线贴着平面（入射角过小）时改为沿法线投影，不产生无限延伸', () => {
    const m = planarShadowMatrix(UP, 0, { x: 1, y: -0.001, z: 0 }, new THREE.Matrix4())
    const p = new THREE.Vector3(2, 5, 3).applyMatrix4(m)
    expect(p.x).toBeCloseTo(2, 9)
    expect(p.y).toBeCloseTo(0, 9)
    expect(p.z).toBeCloseTo(3, 9)
  })
})

describe('createSilhouetteShadow', () => {
  function model() {
    const root = new THREE.Group()
    const hull = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 6)); hull.position.y = 1
    const turretPivot = new THREE.Group(); turretPivot.position.y = 2
    const turret = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 3)); turretPivot.add(turret)
    const variant = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 3)); variant.visible = false   // 未搭载的炮塔变体
    root.add(hull, turretPivot, variant)
    return { root, hull, turret, turretPivot }
  }
  const shadowsIn = (scene: THREE.Scene) => scene.children.filter(o => o.name === 'tankSilhouetteShadow') as THREE.Mesh[]

  it('每个网格一个共享几何体的影子；隐藏的部件（炮塔变体）不投影', () => {
    const scene = new THREE.Scene()
    const { root, hull } = model()
    const s = createSilhouetteShadow(scene, root, makeSilhouetteMaterial(0, 0.5))
    expect(shadowsIn(scene)).toHaveLength(3)
    expect(shadowsIn(scene).some(m => m.geometry === hull.geometry)).toBe(true)
    s.setVisible(true)
    expect(s.count()).toBe(2)
    s.setVisible(false)
    expect(s.count()).toBe(0)
  })

  it('渲染前按「投影 × 部件 matrixWorld」写矩阵：炮塔转动后影子跟着转', () => {
    const scene = new THREE.Scene()
    const { root, turret, turretPivot } = model()
    const s = createSilhouetteShadow(scene, root, makeSilhouetteMaterial(0, 0.5))
    planarShadowMatrix(UP, 0, new THREE.Vector3(1, -1, 0).normalize(), s.projection)
    const shadow = shadowsIn(scene).find(m => m.geometry === turret.geometry)!
    const renderer = {} as THREE.WebGLRenderer, camera = new THREE.PerspectiveCamera()
    const tip = () => {
      root.updateMatrixWorld(true)
      shadow.onBeforeRender(renderer, scene, camera, shadow.geometry, shadow.material as THREE.Material, new THREE.Group())
      return new THREE.Vector3(0, 0, 1.5).applyMatrix4(shadow.matrixWorld)
    }
    const a = tip()
    expect(a.y).toBeCloseTo(0, 6)
    turretPivot.rotation.y = Math.PI / 2
    const b = tip()
    expect(b.y).toBeCloseTo(0, 6)
    expect(b.distanceTo(a)).toBeGreaterThan(1)
  })

  it('dispose 只移除影子网格，不释放车模的共享几何', () => {
    const scene = new THREE.Scene()
    const { root, hull } = model()
    let disposed = 0
    hull.geometry.addEventListener('dispose', () => { disposed++ })
    createSilhouetteShadow(scene, root, makeSilhouetteMaterial(0, 0.5)).dispose()
    expect(shadowsIn(scene)).toHaveLength(0)
    expect(disposed).toBe(0)
  })

  it('材质：同一像素只变暗一次（模板 NotEqual→Replace），深度只测不写，双面', () => {
    const m = makeSilhouetteMaterial(0x0b0f14, 0.5)
    expect(m.stencilWrite).toBe(true)
    expect(m.stencilFunc).toBe(THREE.NotEqualStencilFunc)
    expect(m.stencilZPass).toBe(THREE.ReplaceStencilOp)
    expect(m.depthTest).toBe(true)
    expect(m.depthWrite).toBe(false)
    expect(m.side).toBe(THREE.DoubleSide)
  })
})
