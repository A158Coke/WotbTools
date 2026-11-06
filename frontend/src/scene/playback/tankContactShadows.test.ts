import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import {
  GRID, PROXY_FOOTPRINT, createTankContactShadows, measureShadowFootprint, shadowAlpha, shadowGridXZ, shadowMargin,
  sunShadowFrom,
} from './tankContactShadows.ts'

const O = { x: 0, y: 0, z: 0 }
const at = (x: number, y: number, z: number) => ({ x, y, z })

/** 阴影外框中心（网格顶点包围盒中心）：背光侧尾巴把它推向传播方向 */
function center(x: number, z: number, yaw: number, sun = sunShadowFrom(at(0, 100, 0), O), fp = PROXY_FOOTPRINT) {
  const out = shadowGridXZ(x, z, yaw, fp, sun, new Float32Array(GRID * GRID * 2))
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (let i = 0; i < out.length; i += 2) {
    x0 = Math.min(x0, out[i]); x1 = Math.max(x1, out[i]); z0 = Math.min(z0, out[i + 1]); z1 = Math.max(z1, out[i + 1])
  }
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, out }
}
/** 内核（车体）四角：网格线 1 与 3 的交点 */
const CORE = [GRID + 1, GRID + 3, 3 * GRID + 1, 3 * GRID + 3]

describe('sunShadowFrom：传播方向 = target − light', () => {
  it('正上方的太阳：居中', () => {
    expect(sunShadowFrom(at(0, 1000, 0), O).centered).toBe(true)
  })

  it.each([
    ['光从 −X 射向 +X（左→右）', at(-500, 1000, 0), [1, 0]],
    ['光从 +X 射向 −X（右→左）', at(500, 1000, 0), [-1, 0]],
    ['光从 −Z 射向 +Z', at(0, 1000, -500), [0, 1]],
    ['光从 +Z 射向 −Z', at(0, 1000, 500), [0, -1]],
  ])('%s：尾巴落在传播方向一侧（不取反）', (_name, light, [ex, ez]) => {
    const s = sunShadowFrom(light, O)
    expect(s.centered).toBe(false)
    expect(s.dirX).toBeCloseTo(ex, 6)
    expect(s.dirZ).toBeCloseTo(ez, 6)
    expect(s.tailFactor).toBeGreaterThan(0)
    const { cx, cz } = center(0, 0, 0, s)
    expect(Math.sign(Math.round(cx * 1e6))).toBe(Math.sign(ex))
    expect(Math.sign(Math.round(cz * 1e6))).toBe(Math.sign(ez))
  })

  it('不假设 target 在原点：只看两者之差', () => {
    const a = sunShadowFrom(at(-500, 1000, 0), O)
    const b = sunShadowFrom(at(-400, 1000, 300), at(100, 0, 300))
    expect(b.dirX).toBeCloseTo(a.dirX, 9)
    expect(b.tailFactor).toBeCloseTo(a.tailFactor, 9)
  })

  it('太阳越低尾巴越长，但有硬上限', () => {
    const high = sunShadowFrom(at(-100, 1000, 0), O)
    const low = sunShadowFrom(at(-1000, 1000, 0), O)
    const grazing = sunShadowFrom(at(-1000, 60, 0), O)
    expect(low.tailFactor).toBeGreaterThan(high.tailFactor)
    expect(grazing.tailFactor).toBe(1.2)
  })

  it.each([
    ['零向量', at(0, 0, 0)],
    ['水平光', at(-1000, 0, 0)],
    ['自下而上', at(0, -1000, 0)],
    ['NaN', at(Number.NaN, 1000, 0)],
    ['Infinity', at(Number.POSITIVE_INFINITY, 1000, 0)],
  ])('%s → 居中回退（无 NaN）', (_name, light) => {
    const s = sunShadowFrom(light, O)
    expect(s).toEqual({ centered: true, dirX: 0, dirZ: 0, tailFactor: 0 })
    expect([...center(3, 4, 1, s).out].every(Number.isFinite)).toBe(true)
  })

  it('默认兜底太阳（renderer.ts：position 120,260,80 → 原点）：阴影偏向 −X/−Z', () => {
    const s = sunShadowFrom(at(120, 260, 80), O)
    expect(s.centered).toBe(false)
    expect(s.dirX).toBeLessThan(0)
    expect(s.dirZ).toBeLessThan(0)
  })
})

describe('shadowGridXZ：不透明内核恒等于车体，太阳只加长背光侧渐隐尾', () => {
  const grazing = sunShadowFrom(at(-1000, 60, -700), O)   // 低太阳、斜向：尾巴打满上限

  it('任何太阳 / 朝向下，内核四角都恰好是车体四角（不再有被平移/拉伸的实心暗板）', () => {
    const fp = { halfW: 1.6, halfL: 3.4 }
    for (const yaw of [0, 0.7, Math.PI / 2, 2.5, -1.2]) {
      const out = shadowGridXZ(10, 20, yaw, fp, grazing, new Float32Array(GRID * GRID * 2))
      const c = Math.cos(yaw), s = Math.sin(yaw)
      const want = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => {
        const lx = sx * fp.halfW, lz = sz * fp.halfL
        return [10 + lx * c + lz * s, 20 - lx * s + lz * c]
      })
      CORE.forEach((k, n) => {
        expect(out[k * 2]).toBeCloseTo(want[n][0], 4)        // Float32 输出
        expect(out[k * 2 + 1]).toBeCloseTo(want[n][1], 4)
      })
    }
  })

  it('尾巴总长 = tailFactor × halfW，沿传播方向；背光对侧只剩基础 margin', () => {
    const fp = { halfW: 1.6, halfL: 3.4 }
    const sun = sunShadowFrom(at(-1000, 60, 0), O)   // 传播 +X
    const out = shadowGridXZ(0, 0, 0, fp, sun, new Float32Array(GRID * GRID * 2))
    const m = shadowMargin(fp)
    expect(out[4 * 2]).toBeCloseTo(fp.halfW + m + sun.tailFactor * fp.halfW, 6)   // +X 外线
    expect(out[0]).toBeCloseTo(-(fp.halfW + m), 6)                                 // −X 外线
    expect(out[(4 * GRID) * 2 + 1]).toBeCloseTo(fp.halfL + m, 6)                   // ±Z 不受影响
  })

  it('转向不改变尾巴方向（方向在世界系，按车体系分解到两轴）', () => {
    const s = sunShadowFrom(at(-500, 1000, 0), O)
    for (const yaw of [0, 0.7, Math.PI / 2, 2.5, -1.2]) {
      const { cx } = center(10, 20, yaw, s)
      expect(cx).toBeGreaterThan(10)
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

describe('车体外可见性（俯视时车体盖住内核，只看得到车外一圈）', () => {
  const overhead = sunShadowFrom(at(0, 1000, 0), O)
  /** 网格线 q 对应的 uv → 贴图坐标（-1..1） */
  const tex = (q: number) => (q / (GRID - 1)) * 2 - 1

  it('内网格线恰好压在车体边缘，外网格线在车外 margin 处', () => {
    const fp = { halfW: 1.6, halfL: 3.4 }
    const out = shadowGridXZ(0, 0, 0, fp, overhead, new Float32Array(GRID * GRID * 2))
    const xAt = (q: number) => out[q * 2]                       // 第 0 行，沿 X
    const zAt = (r: number) => out[(r * GRID) * 2 + 1]          // 第 0 列，沿 Z
    expect(xAt(1)).toBeCloseTo(-fp.halfW, 6)
    expect(xAt(3)).toBeCloseTo(fp.halfW, 6)
    expect(zAt(1)).toBeCloseTo(-fp.halfL, 6)
    expect(xAt(4)).toBeCloseTo(fp.halfW + shadowMargin(fp), 6)
    expect(zAt(4)).toBeCloseTo(fp.halfL + shadowMargin(fp), 6)
  })

  it('车体边缘不透明、外缘透明，车外一圈有可见的过渡（修复前车外 alpha ≈ 0.006）', () => {
    expect(shadowAlpha(tex(1), 0)).toBe(1)
    expect(shadowAlpha(tex(3), tex(3))).toBe(1)
    expect(shadowAlpha(tex(4), 0)).toBe(0)
    expect(shadowAlpha(0, tex(0))).toBe(0)
    // 车外 margin 的前 1/4 处仍保留大部分遮蔽
    expect(shadowAlpha(0.5 + 0.5 * 0.25, 0)).toBeGreaterThan(0.8)
    expect(shadowAlpha(0.5 + 0.5 * 0.5, 0)).toBeGreaterThan(0.4)
  })

  it('margin 与车宽成比例且有上下限', () => {
    expect(shadowMargin({ halfW: 1.8, halfL: 3.25 })).toBeCloseTo(0.45, 6)
    expect(shadowMargin({ halfW: 0.5, halfL: 1 })).toBe(0.35)
    expect(shadowMargin({ halfW: 6, halfL: 9 })).toBe(0.6)
  })

  it('迎光侧只有窄接触带，明显的渐隐只在背光侧（典型 35° 太阳下背光侧至少是迎光侧的 3 倍）', () => {
    const fp = { halfW: 1.75, halfL: 3.6 }
    const sun = sunShadowFrom(at(-Math.cos(0.61) * 1000, Math.sin(0.61) * 1000, 0), O)   // 仰角 35°，传播 +X
    const out = shadowGridXZ(0, 0, 0, fp, sun, new Float32Array(GRID * GRID * 2))
    const lit = -out[0] - fp.halfW            // −X 外线到车体边
    const shade = out[4 * 2] - fp.halfW       // +X 外线到车体边
    expect(lit).toBeLessThanOrEqual(0.6)
    expect(shade).toBeGreaterThan(3 * lit)
  })
})

describe('measureShadowFootprint（GLB 模型系 Z-up：X = 车宽、Y = 车长、Z = 高）', () => {
  it('按模型轴取车宽 / 车长（不是按大小猜轴）；不可信时回落代理尺寸', () => {
    // 宽 3、长 7、高 2：旧实现量场景 x/z 会把「高」当成车长
    const tank = new THREE.Mesh(new THREE.BoxGeometry(3, 7, 2))
    expect(measureShadowFootprint(tank)).toEqual({ halfW: 1.5, halfL: 3.5 })
    expect(measureShadowFootprint(new THREE.Group())).toEqual(PROXY_FOOTPRINT)
  })

  it('与实例当前位姿无关（已受姿 / 已入场景的实例量出同一尺寸）', () => {
    const tank = new THREE.Mesh(new THREE.BoxGeometry(3, 7, 2))
    tank.position.set(120, 30, -40)
    tank.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 2.1, 0.1))
    const parent = new THREE.Group(); parent.position.set(5, 0, 5); parent.add(tank)
    const fp = measureShadowFootprint(tank)
    expect(fp.halfW).toBeCloseTo(1.5, 5)
    expect(fp.halfL).toBeCloseTo(3.5, 5)
  })

  it('有底盘节点时只量履带/负重轮：炮管外伸不计入车长', () => {
    const root = new THREE.Group()
    const track = (side: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6.4, 1))
      m.name = side < 0 ? 'chassis_track_L' : 'chassis_track_R'
      m.position.x = side * 1.5
      return m
    }
    const hull = new THREE.Mesh(new THREE.BoxGeometry(3.2, 6.8, 1.5)); hull.name = 'hull'
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.2, 6, 0.2)); gun.name = 'gun_01'; gun.position.y = 5
    root.add(track(-1), track(1), hull, gun)
    const fp = measureShadowFootprint(root)
    expect(fp.halfW).toBeCloseTo(1.8, 5)
    expect(fp.halfL).toBeCloseTo(3.2, 5)   // 整车包围盒会是 (5 + 3) = 8
  })
})

/** 阴影网格 X 范围的中点（太阳尾巴把它推向传播方向） */
function meshCenterX(mesh: THREE.Mesh): number {
  const a = mesh.geometry.getAttribute('position').array
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < a.length; i += 3) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]) }
  return (lo + hi) / 2
}

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
    expect(meshCenterX(h.meshes()[0])).toBeGreaterThan(50)   // 太阳自 −X：尾巴落在 +X 侧
  })

  it('不可见 → 隐藏；太阳改变 → 尾巴方向随之改变', () => {
    const h = harness()
    const v = {}
    h.shadows.update(v, 0, 0, 0, true)
    h.shadows.update(v, 0, 0, 0, false)
    expect(h.shadows.count()).toBe(0)
    h.sunLight.position.set(500, 1000, 0)
    h.shadows.syncSun()
    h.shadows.update(v, 0, 0, 0, true)
    expect(meshCenterX(h.meshes()[0])).toBeLessThan(0)
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
