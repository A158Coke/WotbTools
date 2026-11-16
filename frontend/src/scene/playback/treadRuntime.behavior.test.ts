// @vitest-environment happy-dom
// 履带印运行时行为测试（#827 接替 treadMarks.test.js 的 :23/:53/:62 源码守卫；
// :31/:46/:56 的槽位/老化/fround 量化契约由 treadBufferWriter.test.ts 的行为测试接替）：
// - 关断（暂停态也生效）：updateTrails 立即置 mesh.visible=false 并复位路径态；
// - 关断重开：从 START 全量重建（L/R totals 复位后重铺，不追加到旧末端）；
// - teardown：逐车 treadMesh 几何/材质释放 + 会话级贴图缓存逐张 dispose。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as THREE from 'three'

vi.mock('../assetProvider.js', () => ({
  assetProvider: {
    json: vi.fn(async (p: string) => (p === '/tread/textures.json' ? {} : { width: 0.9, space: 1, texture: '/tread/tex.png' })),
    url: (p: string) => 'http://assets' + p,
  },
}))

import { createTreadRuntime } from './treadRuntime.js'
import type { TreadRuntimeDeps } from './treadRuntime.js'
import { createTrailState } from '../treadMarks.js'
import type { RuntimeVehicle } from './vehicleRuntime.js'

function makeVehicle(eid: number): RuntimeVehicle {
  return {
    def: { eid, account_id: eid, tank_id: 10001 + eid, team: 1, death_t: null },
    group: new THREE.Group(),
    trail: { L: createTrailState(), R: createTrailState(), builtT: -Infinity },
    tread: null,
    treadMesh: null,
  } as never as RuntimeVehicle
}

function makeRuntime(vehicles: RuntimeVehicle[], opts: { treadOn?: boolean } = {}) {
  const scene = new THREE.Scene()
  let t = 0
  const deps: TreadRuntimeDeps = {
    store: { treadOn: opts.treadOn ?? true },
    quality: () => ({ treadMarks: true, anisotropy: 1 }),
    getScene: () => scene,
    destroyed: () => false,
    invalidate: vi.fn(),
    getT: () => t,
    getStart: () => 0,
    getData: () => ({}),
    getVehicles: () => vehicles,
    // 匀速 +x 直线（2 m/s）：0.1s 网格片喂样生成真实路径事实
    vehicles: {
      posAt: (_v, tt, out) => out.set(tt * 2, 0, 0),
      yawAt: () => 0,
    },
    visibleAt: () => true,
    heightAt: () => 0,
    heightFieldReady: () => false,
  }
  const rt = createTreadRuntime(deps)
  return {
    rt, scene,
    setT: (v: number) => { t = v },
    setTreadOn: (v: boolean) => { deps.store.treadOn = v },
  }
}

const flushAttach = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('createTreadRuntime（行为）', () => {
  it('游标泵：treadOn 期间 updateTrails 喂样推进路径态并写出印记 Buffer（drawRange 展开）', async () => {
    const v = makeVehicle(1)
    const { rt, setT } = makeRuntime([v])
    rt.attachVehicle(v)
    await flushAttach()
    expect(v.tread).toBeTruthy()
    expect(v.treadMesh).toBeTruthy()
    setT(1)
    rt.updateTrails()
    expect(v.trail!.builtT).toBeGreaterThan(0)          // 游标泵推进（否则印记只在 seek 时出现）
    expect(v.trail!.L.total + v.trail!.R.total).toBeGreaterThan(0)
    expect(v.treadMesh!.geometry.drawRange.count).toBeGreaterThan(0)
    expect(v.treadMesh!.visible).toBe(true)
    rt.dispose()
  })

  it('关断（暂停态立即生效）：mesh.visible=false 且路径态复位（不只回退 builtT）', async () => {
    const v = makeVehicle(1)
    const { rt, setT, setTreadOn } = makeRuntime([v])
    rt.attachVehicle(v)
    await flushAttach()
    setT(1)
    rt.updateTrails()
    expect(v.trail!.L.total).toBeGreaterThan(0)
    // 暂停（animate 不 tick）：开关 setter 只改 store，下一次 updateTrails 立即生效
    setTreadOn(false)
    rt.updateTrails()
    expect(v.treadMesh!.visible).toBe(false)
    // 路径态游标复位：builtT 归 -∞（历史印记保留，重开时从 START 全量重写覆盖）
    expect(v.trail!.builtT).toBe(-Infinity)
    rt.dispose()
  })

  it('关断重开：从 START 全量重建（与全新会话同值，不追加到旧末端）', async () => {
    const v = makeVehicle(1)
    const { rt, setT, setTreadOn } = makeRuntime([v])
    rt.attachVehicle(v)
    await flushAttach()
    setT(1)
    rt.updateTrails()
    expect(v.trail!.L.total).toBeGreaterThan(0)
    setTreadOn(false)
    rt.updateTrails()
    setTreadOn(true)
    setT(2)
    rt.updateTrails()
    // 复位语义真值：重开后的印记与「全新会话直接喂 [0,2]」逐值一致（若只是回退
    // builtT 而不复位路径态，整条路径会被追加到旧末端 → 戳数/时刻分布不同）
    const vFresh = makeVehicle(1)
    const { rt: rtFresh, setT: setTFresh } = makeRuntime([vFresh])
    rtFresh.attachVehicle(vFresh)
    await flushAttach()
    setTFresh(2)
    rtFresh.updateTrails()
    expect(v.trail!.L.total).toBe(vFresh.trail!.L.total)
    expect(v.trail!.R.total).toBe(vFresh.trail!.R.total)
    expect(v.treadMesh!.visible).toBe(true)
    rt.dispose()
    rtFresh.dispose()
  })

  it('teardown：逐车 treadMesh 几何/材质释放、贴图缓存逐张 dispose、路径态置空', async () => {
    const v1 = makeVehicle(1)
    const v2 = makeVehicle(2)
    const { rt, scene } = makeRuntime([v1, v2])
    rt.attachVehicle(v1)
    rt.attachVehicle(v2)
    await flushAttach()
    expect(v1.treadMesh).toBeTruthy()
    expect(v2.treadMesh).toBeTruthy()
    expect(scene.children.length).toBe(2)
    const geoDispose = vi.spyOn(v1.treadMesh!.geometry, 'dispose')
    const matDispose = vi.spyOn(v1.treadMesh!.material as THREE.Material, 'dispose')
    const texDispose = vi.spyOn(THREE.Texture.prototype, 'dispose')
    rt.dispose()
    expect(geoDispose).toHaveBeenCalledTimes(1)
    expect(matDispose).toHaveBeenCalledTimes(1)
    expect(texDispose).toHaveBeenCalled()   // 共享贴图缓存逐张释放（两车共享同一贴图）
    expect(scene.children.length).toBe(0)
    expect(v1.treadMesh).toBeNull()
    expect(v1.tread).toBeNull()
    expect(v1.trail).toBeNull()
    expect(v2.tread).toBeNull()
  })
})
