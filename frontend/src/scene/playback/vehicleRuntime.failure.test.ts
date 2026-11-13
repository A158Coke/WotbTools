// 车辆运行时 GLB 装载失败路径（#827 sceneryMaterials.test.js:169 接替）：
// - GLB fetch/解析失败必须带 tank_id 留痕（禁止静默 catch，"切真实车模后没有车"无从定位）；
// - 部位链不全 / 装载失败 → 保留低模代理车（v.glb 不落库），代理车保持可见；
// - 解析返回空场景 → '解析返回空' 告警。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as THREE from 'three'

const provider = vi.hoisted(() => ({
  bytes: vi.fn(),
  json: vi.fn(async () => null),
  configured: () => true,
}))
vi.mock('../assetProvider.js', () => ({ assetProvider: provider }))
// GLTFLoader 替身：parse 可编排——onError 收尾（bytes 非法/空场景）或 onLoad 收尾（空 group 场景）
const gltfMock = vi.hoisted(() => ({ mode: 'error' as 'error' | 'empty-scene' }))
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    parse(_bytes: ArrayBuffer, _path: string, onLoad: (g: { scene: THREE.Object3D }) => void, onError: (e: unknown) => void) {
      if (gltfMock.mode === 'error') onError(new Error('stub parse failure'))
      else onLoad({ scene: new THREE.Group() })
    }
  },
}))

import { createVehicleRuntime } from './vehicleRuntime.js'
import type { VehicleRuntimeDeps } from './vehicleRuntime.js'

function makeDeps() {
  const scene = new THREE.Scene()
  const data = {
    vehicles: [{ eid: 1, account_id: 1, tank_id: 10001, team: 1, death_t: null, pos: [0, 0, 0] }],
    detached_turrets: [],
  }
  const deps: VehicleRuntimeDeps = {
    store: { glbOn: false },
    destroyed: () => false,
    sessionGen: () => 0,
    getScene: () => scene,
    getT: () => 0,
    getData: () => data as never,
    teamColor: () => 0xff0000,
    quality: () => ({}),
    classIconsVisible: () => false,
    showMarkerStatus: () => false,
    invalidate: vi.fn(),
    visibleAt: () => true,
    sceneLifeAt: () => null,
    sampleHeight: () => 0,
    treadAttachVehicle: vi.fn(),
    disposeObject3D: vi.fn(),
    poseGrid: {} as never,
    visByEid: () => new Map(),
    contactShadows: () => null,
    scopedHiddenEid: () => 0,
  }
  return { deps, scene, data }
}

function makeRuntime() {
  const { deps, scene } = makeDeps()
  const rt = createVehicleRuntime(deps)
  rt.buildVehicles()
  const v = rt.getVehicles()[0]
  return { rt, v, scene }
}

beforeEach(() => {
  provider.bytes.mockReset()
  provider.json.mockReset().mockResolvedValue(null)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('createVehicleRuntime GLB 装载失败路径', () => {
  it('GLB fetch reject：warn 含 tank_id 与原始错误，代理车保留（v.glb 不落库）', async () => {
    const { rt, v } = makeRuntime()
    provider.bytes.mockRejectedValue(new Error('404 model.glb'))
    await rt.applyGlbToggle(true)
    const warns = (console.warn as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]))
    expect(warns.some((w) => w.includes('[playback] 坦克 GLB 加载失败 tank_id=10001'))).toBe(true)
    const errArg = (console.warn as ReturnType<typeof vi.fn>).mock.calls
      .find((c) => String(c[0]).includes('tank_id=10001'))?.[1]
    expect(String(errArg)).toContain('404 model.glb')
    // 失败可见：代理车仍低模渲染，GLB 未挂载
    expect(v.glb).toBeUndefined()
    expect(v.glbParts).toBeUndefined()
    expect(v.meshHull.visible).toBe(true)
    expect(v.group.parent).toBe(rt.getVehicles()[0].group.parent)
    rt.dispose()
  })

  it('GLB 解析返回空场景：warn "解析返回空 tank_id=..."，代理车保留', async () => {
    const { rt, v } = makeRuntime()
    provider.bytes.mockResolvedValue(new ArrayBuffer(8))
    await rt.applyGlbToggle(true)
    const warns = (console.warn as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]))
    expect(warns.some((w) => w.includes('[playback] 坦克 GLB 解析返回空 tank_id=10001'))).toBe(true)
    expect(v.glb).toBeUndefined()
    expect(v.meshHull.visible).toBe(true)
    rt.dispose()
  })

  it('失败不入缓存：同一 tank_id 再次切换会重试（资产补位后可恢复）', async () => {
    const { rt, v } = makeRuntime()
    provider.bytes.mockRejectedValueOnce(new Error('404'))
    await rt.applyGlbToggle(true)
    expect(provider.bytes).toHaveBeenCalledTimes(1)
    provider.bytes.mockResolvedValue(new ArrayBuffer(8))
    await rt.applyGlbToggle(false)
    await rt.applyGlbToggle(true)
    expect(provider.bytes).toHaveBeenCalledTimes(2)
    // 第二次仍是空场景替身 → 依旧失败可见，代理保留
    expect(v.glb).toBeUndefined()
    rt.dispose()
  })

  it('部位/枢轴链不全（sd 缺失）：warn "GLB 部位不全，保留代理车"，不落半装载 GLB', async () => {
    const { rt, v } = makeRuntime()
    gltfMock.mode = 'empty-scene'
    provider.bytes.mockResolvedValue(new ArrayBuffer(8))
    try {
      await rt.applyGlbToggle(true)
      const warns = (console.warn as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]))
      expect(warns.some((w) => w.includes('[playback] GLB 部位不全，保留代理车 tank_id=10001'))).toBe(true)
      // 部位检查先于落库：v.glb 保持 undefined（不会停在世界原点被地形埋住）
      expect(v.glb).toBeUndefined()
      expect(v.glbParts).toBeUndefined()
      expect(v.meshHull.visible).toBe(true)
    } finally {
      gltfMock.mode = 'error'
      rt.dispose()
    }
  })
})
