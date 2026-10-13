import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { BURST_SECS, FX_BUDGETS, TRAIL_FADE_SECS, TRAIL_HOLD_SECS, createBattleFx, muzzleTipOf, trailOpacityAt } from './battleFx.js'

const TIERS = ['low', 'mid', 'high', 'ultra']
const CHUNK_TILE = 6

function camera(pos = [0, 60, 120]) {
  const cam = new THREE.PerspectiveCamera(55, 1.5, 0.5, 4000)
  cam.position.set(...pos)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld()
  return cam
}
const meshNamed = (fx, name) => fx.root.children.find((o) => o.name === name)
function instances(mesh) {
  const g = mesh.geometry, n = g.instanceCount
  const A = g.attributes.iA.array, B = g.attributes.iB.array, C = g.attributes.iC.array
  return Array.from({ length: n }, (_, i) => ({
    x: A[i * 4], y: A[i * 4 + 1], z: A[i * 4 + 2], w: B[i * 4], h: B[i * 4 + 1], tile: B[i * 4 + 2], alpha: C[i * 4 + 3],
  }))
}
const at = (x, y, z) => new THREE.Vector3(x, y, z)
const near = (a, b) => Math.abs(a - b) < 1e-6   // GPU 数组是 Float32

describe('FX_BUDGETS 画质档位预算', () => {
  it('四档齐全；容量严格递增，数量与开关只增不减', () => {
    expect(Object.keys(FX_BUDGETS)).toEqual(TIERS)
    const keys = Object.keys(FX_BUDGETS.low)
    for (const t of TIERS) expect(Object.keys(FX_BUDGETS[t])).toEqual(keys)
    const caps = TIERS.map((t) => FX_BUDGETS[t].capacity)
    expect(caps).toEqual([...caps].sort((a, b) => a - b))
    expect(new Set(caps).size).toBe(4)
    for (const k of keys) {
      const ladder = TIERS.map((t) => Number(FX_BUDGETS[t][k]))
      expect(ladder, k).toEqual([...ladder].sort((a, b) => a - b))
    }
  })

  it('信息类元素四档都有，纯氛围元素只在高档出现', () => {
    for (const t of TIERS) {
      const b = FX_BUDGETS[t]
      expect(b.impactSparks).toBeGreaterThan(0)
      expect(b.burstFire).toBeGreaterThan(0)
      expect(b.burstSmoke).toBeGreaterThan(0)
      expect(b.burstSparks).toBeGreaterThan(0)
    }
    expect(FX_BUDGETS.low).toMatchObject({ burstDust: 0, burstDebris: 0, wreckSmoke: 0, muzzleSmoke: 0, impactSmoke: 0, muzzleBrake: false })
    expect(FX_BUDGETS.mid).toMatchObject({ burstDebris: 0, wreckSmoke: 0 })
    expect(FX_BUDGETS.high.wreckSmoke).toBeGreaterThan(0)
    expect(FX_BUDGETS.high.wreckEmbers).toBe(false)
    expect(FX_BUDGETS.ultra.wreckEmbers).toBe(true)
  })
})

describe('trailOpacityAt 弹道光迹停留与淡出（回放秒）', () => {
  it('飞行中与停留期全亮，随后线性淡出到 0', () => {
    expect(trailOpacityAt(-0.1)).toBe(1)
    expect(trailOpacityAt(0)).toBe(1)
    expect(trailOpacityAt(TRAIL_HOLD_SECS)).toBe(1)
    expect(trailOpacityAt(TRAIL_HOLD_SECS + TRAIL_FADE_SECS / 2)).toBeCloseTo(0.5)
    expect(trailOpacityAt(TRAIL_HOLD_SECS + TRAIL_FADE_SECS)).toBe(0)
    expect(trailOpacityAt(99)).toBe(0)
    expect(TRAIL_HOLD_SECS + TRAIL_FADE_SECS).toBe(4)
  })
})

describe('muzzleTipOf 炮口定位（开火起点在火炮枢轴，火光要放到炮管末端）', () => {
  // GLB 炮管：局部 +z 为炮管轴，炮尾伸进炮塔 0.6 m、炮口在枢轴前 4.4 m；外层组摆到世界弹道方向
  function gun(pivot, dir, { breech = 0.6, muzzle = 4.4, mantlet = true } = {}) {
    const node = new THREE.Group()
    node.position.copy(pivot)
    node.quaternion.setFromUnitVectors(at(0, 0, 1), dir)
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, breech + muzzle).translate(0, 0, (muzzle - breech) / 2))
    node.add(barrel)
    if (mantlet) node.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.5)))   // 炮盾在枢轴处
    node.updateMatrixWorld(true)
    return node
  }
  const pivot = at(12, 3, -7)
  const dir = at(1, 0.2, -0.5).normalize()

  it('沿弹道推到炮管末端（炮盾等近处网格不影响）', () => {
    const tip = muzzleTipOf([gun(pivot, dir)], pivot, dir)
    expect(tip.distanceTo(pivot.clone().addScaledVector(dir, 4.4))).toBeLessThan(1e-4)
  })

  it('起点不在炮管轴上时仍落在弹道线上（光迹与火光对齐）', () => {
    const from = pivot.clone().add(at(0, -0.3, 0.1))
    const tip = muzzleTipOf([gun(pivot, dir)], from, dir)
    const along = tip.clone().sub(from)
    expect(along.clone().cross(dir).length()).toBeLessThan(1e-4)
    expect(along.dot(dir)).toBeGreaterThan(4)
  })

  it('没有炮管节点、炮管与弹道对不上或长得离谱：回落到记录起点', () => {
    const side = at(-dir.z, 0, dir.x).normalize()
    expect(muzzleTipOf(null, pivot, dir).equals(pivot)).toBe(true)
    expect(muzzleTipOf([], pivot, dir).equals(pivot)).toBe(true)
    expect(muzzleTipOf([gun(pivot, side, { breech: 0.1, mantlet: false })], pivot, dir).equals(pivot)).toBe(true)
    expect(muzzleTipOf([gun(pivot, dir, { muzzle: 40 })], pivot, dir).equals(pivot)).toBe(true)
  })

  it('写入 out 并返回它，不改动入参', () => {
    const out = new THREE.Vector3()
    const from = pivot.clone()
    expect(muzzleTipOf([gun(pivot, dir)], from, dir, out)).toBe(out)
    expect(from.equals(pivot)).toBe(true)
  })
})

describe('createBattleFx 粒子批次', () => {
  it('同一输入逐值确定：两个实例在同一年龄写出完全相同的粒子', () => {
    const write = () => {
      const fx = createBattleFx(FX_BUDGETS.ultra)
      fx.spawnBurst(at(10, 2, -5), 1000, 7)
      fx.spawnMuzzle(at(0, 2, 0), at(1, 0, 0), 1000, 3)
      fx.spawnImpact('nonpen', at(20, 1.5, 0), at(1, 0, 0), null, 1000, 3)
      fx.frame(1600, camera(), 720, (emit) => emit.wreck(30, 0, 30, 0.4, 9, 12.5, 2))
      return [meshNamed(fx, 'battle-fx-glow'), meshNamed(fx, 'battle-fx-smoke')]
        .map((m) => [...m.geometry.attributes.iA.array, ...m.geometry.attributes.iC.array])
    }
    expect(write()).toEqual(write())
  })

  it('碎片、尘浪与残骸烟按档位裁剪；残骸余火只在极致档', () => {
    const run = (tier) => {
      const fx = createBattleFx(FX_BUDGETS[tier])
      fx.spawnBurst(at(0, 0, 0), 0, 1)
      fx.frame(600, camera(), 720)
      const burst = instances(meshNamed(fx, 'battle-fx-smoke'))
      fx.clearTransients()
      fx.frame(600, camera(), 720, (emit) => emit.wreck(0, 0, 0, 0, 3, 3, 1))   // 死后 3 s：烟已渐入、余火未熄
      return {
        debris: burst.filter((p) => p.tile === CHUNK_TILE).length,
        lowDust: burst.filter((p) => p.y < 1.6 && p.tile !== CHUNK_TILE).length,
        wreckSmoke: meshNamed(fx, 'battle-fx-smoke').geometry.instanceCount,
        wreckGlow: meshNamed(fx, 'battle-fx-glow').geometry.instanceCount,
      }
    }
    const low = run('low'), mid = run('mid'), high = run('high'), ultra = run('ultra')
    expect(low).toEqual({ debris: 0, lowDust: 0, wreckSmoke: 0, wreckGlow: 0 })
    expect(mid.debris).toBe(0)
    expect(mid.lowDust).toBeGreaterThan(0)
    expect(mid.wreckSmoke).toBe(0)
    expect(high.debris).toBe(FX_BUDGETS.high.burstDebris)
    expect(high.wreckSmoke).toBeGreaterThan(0)
    expect(high.wreckGlow).toBe(0)
    expect(ultra.wreckGlow).toBe(3)
  })

  it('残骸烟只在死亡 1.4 s 后渐入；倒带回死亡前（调用方不再上报）立即消失', () => {
    const fx = createBattleFx(FX_BUDGETS.high)
    const smoke = meshNamed(fx, 'battle-fx-smoke')
    fx.frame(0, camera(), 720, (emit) => emit.wreck(0, 0, 0, 0, 1.0, 0, 1))
    expect(smoke.geometry.instanceCount).toBe(0)
    fx.frame(0, camera(), 720, (emit) => emit.wreck(0, 0, 0, 0, 5, 0, 1))
    expect(smoke.geometry.instanceCount).toBeGreaterThan(FX_BUDGETS.high.wreckSmoke / 2)
    expect(smoke.geometry.instanceCount).toBeLessThanOrEqual(FX_BUDGETS.high.wreckSmoke)
    expect(smoke.visible).toBe(true)
    fx.frame(0, camera(), 720)
    expect(smoke.geometry.instanceCount).toBe(0)
    expect(smoke.visible).toBe(false)
  })

  it('残骸烟是连续浓烟柱：底部有高不透明烟团，相邻烟团上下重叠（亮图远景可读）', () => {
    for (const tier of ['high', 'ultra']) {
      for (const phase of [0, 1.3, 2.7, 4.1]) {
        const fx = createBattleFx(FX_BUDGETS[tier])
        fx.frame(0, camera(), 720, (emit) => emit.wreck(0, 10, 0, 0.7, Infinity, phase, 3))
        const puffs = instances(meshNamed(fx, 'battle-fx-smoke')).sort((a, b) => a.y - b.y)
        expect(puffs.length, `${tier}@${phase}`).toBeGreaterThanOrEqual(FX_BUDGETS[tier].wreckSmoke - 1)
        expect(Math.max(...puffs.map((p) => p.alpha)), `${tier}@${phase}`).toBeGreaterThanOrEqual(0.8)
        expect(puffs[0].y - 10, `${tier}@${phase}`).toBeLessThan(3)
        for (let i = 1; i < puffs.length; i++) {
          expect(puffs[i].y - puffs[i - 1].y, `${tier}@${phase}#${i}`).toBeLessThan(0.5 * Math.min(puffs[i].h, puffs[i - 1].h))
        }
        fx.dispose()
      }
    }
  })

  it('容量封顶，命中特效优先于爆炸写入', () => {
    const fx = createBattleFx(FX_BUDGETS.low)
    for (let i = 0; i < 40; i++) fx.spawnBurst(at(i * 20, 0, 0), 0, i)
    fx.spawnImpact('pen', at(-100, 1.5, 0), at(1, 0, 0), null, 0, 9)
    fx.frame(20, camera(), 720)
    const glow = meshNamed(fx, 'battle-fx-glow')
    expect(glow.geometry.instanceCount).toBe(FX_BUDGETS.low.capacity)
    // 第一颗 = 命中火光：沿来弹方向退 0.2 m（远镜头下随屏幕尺寸下限放大，最多 3 倍）
    expect(glow.geometry.attributes.iA.array[0]).toBeLessThan(-100.1)
    expect(glow.geometry.attributes.iA.array[0]).toBeGreaterThan(-100.7)
    expect(meshNamed(fx, 'battle-fx-smoke').geometry.instanceCount).toBeLessThanOrEqual(FX_BUDGETS.low.capacity)
  })

  it('普通混合批次按视深从远到近排序', () => {
    const fx = createBattleFx(FX_BUDGETS.high)
    const cam = camera([0, 10, 200])
    fx.frame(0, cam, 720, (emit) => {
      emit.wreck(0, 0, 150, 0, Infinity, 2, 1)
      emit.wreck(0, 0, -300, 0, Infinity, 2, 1)
    })
    const view = cam.matrixWorldInverse.elements
    const depth = instances(meshNamed(fx, 'battle-fx-smoke')).map((p) => view[2] * p.x + view[6] * p.y + view[10] * p.z + view[14])
    expect(depth.length).toBeGreaterThan(4)
    expect(depth).toEqual([...depth].sort((a, b) => a - b))
  })

  it('开火：制退器侧焰随档位出现，前喷火光四档都有', () => {
    const count = (tier) => {
      const fx = createBattleFx(FX_BUDGETS[tier])
      fx.spawnMuzzle(at(0, 2, 0), at(0, 0, 1), 0, 1)
      fx.frame(50, camera(), 720)
      return meshNamed(fx, 'battle-fx-glow').geometry.instanceCount
    }
    expect(count('low')).toBe(4)   // 3 团前喷 + 星芒
    expect(count('mid')).toBe(6)   // + 两侧制退器焰
  })

  it('命中三类外观不同：击穿留橙色余火与暗烟，跳弹火花顺出射方向飞', () => {
    const run = (kind, out = null) => {
      const fx = createBattleFx(FX_BUDGETS.high)
      fx.spawnImpact(kind, at(0, 2, 0), at(1, 0, 0), out, 0, 4)
      return fx
    }
    const close = camera([0, 4, 8])   // 近距离：命中特效保持世界尺寸（屏幕下限不触发）
    const pen = run('pen')
    pen.frame(500, close, 720)
    const penGlow = instances(meshNamed(pen, 'battle-fx-glow'))
    expect(penGlow.some((p) => near(p.w, 0.9))).toBe(true)   // 余火仍在
    const nonpen = run('nonpen')
    nonpen.frame(500, close, 720)
    expect(instances(meshNamed(nonpen, 'battle-fx-glow')).some((p) => near(p.w, 0.6))).toBe(false)   // 0.4 s 已灭
    const ric = run('ricochet', at(0, 0, 1))
    ric.frame(150, close, 720)
    const heads = instances(meshNamed(ric, 'battle-fx-glow')).filter((p) => near(p.w, 0.36))
    expect(heads.length).toBeGreaterThan(0)
    expect(heads.every((p) => p.z > 0.5)).toBe(true)
    expect(() => run('miss')).not.toThrow()
    expect(run('miss').active()).toBe(false)
  })

  it('命中特效有屏幕尺寸下限：镜头拉远时等比放大（最多 3 倍），近处保持世界尺寸', () => {
    const shot = (camPos) => {
      const fx = createBattleFx(FX_BUDGETS.high)
      fx.spawnImpact('nonpen', at(0, 2, 0), at(1, 0, 0), null, 0, 4)
      fx.frame(1, camera(camPos), 720)
      const flash = Math.max(...instances(meshNamed(fx, 'battle-fx-glow')).map((p) => p.w))
      fx.frame(400, camera(camPos), 720)
      const smoke = Math.max(...instances(meshNamed(fx, 'battle-fx-smoke')).map((p) => p.w))
      fx.dispose()
      return { flash, smoke }
    }
    const pxPerM = (dist) => 720 / (dist * 2 * Math.tan(THREE.MathUtils.degToRad(55) / 2))
    const close = shot([0, 4, 8]), app = shot([0, 20, 40]), far = shot([0, 300, 600])
    // 应用最近缩放距离量级（~44 m）：火光约 30 px，而不是世界尺寸下的十几像素
    expect(app.flash * pxPerM(Math.hypot(18, 40))).toBeGreaterThan(28)
    expect(close.flash * pxPerM(Math.hypot(2, 8))).toBeGreaterThan(app.flash * pxPerM(Math.hypot(18, 40)))
    expect(far.flash / close.flash).toBeCloseTo(3, 4)
    expect(far.smoke / close.smoke).toBeCloseTo(3, 4)
  })

  it('壁钟寿命到期自动移除；clearTransients 立即清空且不补播', () => {
    const fx = createBattleFx(FX_BUDGETS.mid)
    fx.spawnBurst(at(0, 0, 0), 1000, 1)
    fx.spawnMuzzle(at(0, 2, 0), at(1, 0, 0), 1000, 1)
    fx.frame(1000 + BURST_SECS * 1000 - 10, camera(), 720)
    expect(fx.stats()).toMatchObject({ bursts: 1, muzzles: 0 })
    fx.frame(1000 + BURST_SECS * 1000, camera(), 720)
    expect(fx.active()).toBe(false)
    fx.spawnImpact('pen', at(0, 0, 0), at(1, 0, 0), null, 0, 1)
    fx.clearTransients()
    fx.frame(10, camera(), 720)
    expect(fx.active()).toBe(false)
    expect(meshNamed(fx, 'battle-fx-glow').visible).toBe(false)
  })
})

describe('createBattleFx 条带与资源', () => {
  it('条带池化复用；屏幕像素下限按相机 FOV 与视口高度换算', () => {
    const fx = createBattleFx(FX_BUDGETS.high)
    const tracer = fx.takeRibbon('tracer')
    expect(tracer.parent).toBe(fx.root)
    expect(tracer.material.blending).toBe(THREE.AdditiveBlending)
    fx.setTracer(tracer, at(0, 1, 0), at(14, 1, 0), 0x3ee08a)
    const u = tracer.material.uniforms
    expect(u.uB.value.x).toBe(14)
    expect(u.uWB.value).toBeGreaterThan(u.uWA.value)   // 弹头粗、尾迹细
    expect(u.uCA.value.getHex()).toBe(0x3ee08a)
    const cam = camera()
    fx.frame(0, cam, 900)
    expect(u.uPxScale.value).toBeCloseTo(2 * Math.tan(THREE.MathUtils.degToRad(55) / 2) / 900)
    fx.giveRibbon(tracer)
    expect(tracer.parent).toBe(null)
    expect(fx.takeRibbon('tracer')).toBe(tracer)
    const trail = fx.takeRibbon('trail')
    expect(trail).not.toBe(tracer)
    expect(trail.material.blending).toBe(THREE.NormalBlending)
    fx.setTrail(trail, at(0, 0, 0), at(5, 0, 0), 0xff5a45, 0.25)
    expect(trail.material.uniforms.uOpacity.value).toBe(0.25)
    const t = trail.material.uniforms
    expect(t.uWA.value).toBe(t.uWB.value)   // 光迹整段等宽
    expect(t.uAA.value).toBeGreaterThanOrEqual(0.5)   // 低于 0.5 与地表混合后发灰（2026-10-05 用户反馈）
    expect(u.uWB.value).toBeGreaterThan(t.uWB.value)   // 层级：弹头比光迹粗
    expect(t.uMinPx.value).toBeGreaterThanOrEqual(1.5)   // 拉远看全场也不细到消失
    expect(u.uMinPx.value).toBeGreaterThan(t.uMinPx.value)
  })

  it('特效材质不做 tone mapping、保留深度测试、挂 logdepth 代码块', () => {
    const fx = createBattleFx(FX_BUDGETS.high)
    const materials = [...fx.root.children.map((o) => o.material), fx.takeRibbon('tracer').material, fx.takeRibbon('trail').material]
    for (const m of materials) {
      expect(m.toneMapped).toBe(false)
      expect(m.depthTest).toBe(true)
      expect(m.depthWrite).toBe(false)
      if (m.isShaderMaterial) {
        expect(m.vertexShader).toContain('#include <logdepthbuf_vertex>')
        expect(m.fragmentShader).toContain('#include <logdepthbuf_fragment>')
        expect(m.vertexShader.indexOf('#include <common>')).toBeLessThan(m.vertexShader.indexOf('#include <logdepthbuf_vertex>'))
      }
    }
    expect(meshNamed(fx, 'battle-fx-glow').material.blending).toBe(THREE.AdditiveBlending)
    expect(meshNamed(fx, 'battle-fx-smoke').material.blending).toBe(THREE.NormalBlending)
  })

  it('预热时批次与两种条带可见，结束后复原', () => {
    const fx = createBattleFx(FX_BUDGETS.low)
    let seen = null
    fx.prewarm(() => {
      seen = { visible: fx.root.children.filter((o) => o.visible).length, ribbons: fx.stats().ribbons }
    })
    expect(seen).toEqual({ visible: 5, ribbons: 2 })
    expect(fx.root.children.filter((o) => o.visible)).toHaveLength(0)
    expect(fx.stats().ribbons).toBe(0)
  })

  it('dispose 只释放一次全部几何、材质与图集，并从场景摘下', () => {
    const fx = createBattleFx(FX_BUDGETS.ultra)
    const scene = new THREE.Scene()
    scene.add(fx.root)
    const out = fx.takeRibbon('trail')
    fx.giveRibbon(fx.takeRibbon('tracer'))
    const batches = fx.root.children.filter((o) => o !== out)
    const resources = new Set([
      ...batches.flatMap((o) => [o.geometry, o.material]), out.geometry, out.material,
      batches[0].material.uniforms.uMap.value,
    ])
    const spies = [...resources].map((r) => vi.spyOn(r, 'dispose'))
    fx.dispose()
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1)
    expect(fx.root.parent).toBe(null)
  })
})
