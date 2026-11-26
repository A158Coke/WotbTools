import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as THREE from 'three'
import { writeUvOffsetV, measureBeltUvSlope, chainBottomRunDir, chainChanged, chainDrift } from '../suspension.js'
import { poseFromYPR } from '../glbRig.js'
import { sampleVehiclePoseGame } from '../../replay-local/pose/vehiclePose.js'

const SUSP = {
  wheels: [[1, 0.15, 0.15]],
  chains: { left: [[[-3, 0], [-1, 0], [1, 0], [3, 0]]], right: [[[-3, 0], [-1, 0], [1, 0], [3, 0]]] },
  wheels_reaction_speed: 5,
  track_bending: null,
}
const SD = { model_origins: { track: [1, 2, 3], turret: [10, 20, 30] }, configs: null }

const namedMesh = (name: string, geo = new THREE.BufferGeometry()) => {
  const m = new THREE.Mesh(geo)
  m.name = name
  return m
}
function suspTank(wheelsPerSide = 1) {
  const root = new THREE.Group()
  root.add(namedMesh('hull'))
  const gun = new THREE.Group(); gun.name = 'gun_01'; gun.add(namedMesh('m_barrel'))
  const t1 = new THREE.Group(); t1.name = 'turret_01'; t1.add(gun)
  root.add(t1)
  for (const side of ['L', 'R'] as const) {
    const trackGeo = new THREE.BoxGeometry(0.8, 6.5, 0.75)
    trackGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(trackGeo.attributes.position.count * 2), 2))
    root.add(namedMesh(`chassis_track_${side}`, trackGeo))
    for (let i = 1; i <= wheelsPerSide; i++) {
      root.add(namedMesh(`chassis_wheel_${side}_${String(i).padStart(2, '0')}`, new THREE.BoxGeometry(0.6, 1.0, 1.0)))
    }
  }
  return root
}

const gltfMock = vi.hoisted(() => ({ mode: 'error' as 'error' | 'susp' | 'mismatch' }))
const provider = vi.hoisted(() => ({
  bytes: vi.fn(),
  json: vi.fn(),
  configured: () => true,
}))
vi.mock('../assetProvider.js', () => ({ assetProvider: provider }))
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    parse(_bytes: ArrayBuffer, _path: string, onLoad: (g: { scene: THREE.Object3D }) => void, onError: (e: unknown) => void) {
      if (gltfMock.mode === 'error') { onError(new Error('stub parse failure')); return }
      onLoad({ scene: suspTank(gltfMock.mode === 'mismatch' ? 2 : 1) })
    }
  },
}))

import { createVehicleRuntime } from './vehicleRuntime.js'
import type { VehicleRuntimeDeps } from './vehicleRuntime.js'

function makeData(vehicleCount = 1) {
  return {
    vehicles: Array.from({ length: vehicleCount }, (_, i) => ({
      eid: i + 1, account_id: i + 1, tank_id: 10001, team: 1, death_t: null,
      coverage: [0, 100], pos: posColumn(), hull_yaw: col(0), hull_pitch: col(0), hull_roll: col(0),
    })),
    detached_turrets: [],
  }
}
function posColumn() {
  const out: number[] = []
  for (let i = 0; i < 101; i++) out.push(0, 0, 0.2 * i)
  return out
}
const col = (v: number) => Array.from({ length: 101 }, () => v)
const ramp = (start: number, step: number) => Array.from({ length: 101 }, (_, i) => start + step * i)

function makeDeps(data: ReturnType<typeof makeData>, overrides: Partial<VehicleRuntimeDeps> = {}) {
  const scene = new THREE.Scene()
  const deps: VehicleRuntimeDeps = {
    store: { glbOn: false, lastKnownOn: false },
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
    poseGrid: { tStart: 0, samples: 101 } as never,
    visByEid: () => new Map(),
    contactShadows: () => null,
    scopedHiddenEid: () => 0,
    ...overrides,
  }
  return { deps, scene, data }
}

function jsonRoutes({ susp = SUSP as unknown, sd = SD as unknown }: { susp?: unknown; sd?: unknown } = {}) {
  provider.json.mockImplementation((p: string) => {
    if (p.startsWith('/suspension/')) return susp === null ? Promise.reject(new Error('404')) : Promise.resolve(susp)
    if (p.startsWith('/tank/')) return Promise.resolve(sd)
    return Promise.resolve(null)
  })
}

beforeEach(() => {
  provider.bytes.mockReset().mockResolvedValue(new ArrayBuffer(8))
  provider.json.mockReset()
  gltfMock.mode = 'susp'
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

async function mountSuspension(vehicleCount = 1, data?: ReturnType<typeof makeData>) {
  const d = data ?? makeData(vehicleCount)
  const { deps, scene } = makeDeps(d)
  const rt = createVehicleRuntime(deps)
  rt.buildVehicles()
  jsonRoutes()
  await rt.applyGlbToggle(true)
  const vs = rt.getVehicles()
  return { rt, vs, deps, scene }
}

describe('低模车体 / 最后已知位置：阵营色只来自宿主注入', () => {
  it('hull 与 last-known proxy 使用 deps.teamColor，不在 runtime 内重选阵营色', () => {
    const data = makeData(1)
    const { deps } = makeDeps(data, { teamColor: () => 0x123456 })
    const rt = createVehicleRuntime(deps)
    rt.buildVehicles()
    const v = rt.getVehicles()[0]
    expect((v.meshHull.material as THREE.MeshLambertMaterial).color.getHex()).toBe(0x123456)
    if (!v.lastKnownProxy) throw new Error('lastKnownProxy missing')
    const proxyMat = v.lastKnownProxy.material as THREE.MeshLambertMaterial
    expect(proxyMat.color.getHex()).toBe(0x123456)
    expect(proxyMat.opacity).toBe(0.35)
    rt.dispose()
  })
})

describe(':1007 悬挂数据（包内 suspension/<id>.json）', () => {
  it('suspension json 404 → 整车回落刚体（v.suspParts===null），GLB 照常挂载', async () => {
    const data = makeData()
    const { deps } = makeDeps(data)
    jsonRoutes({ susp: null })
    const rt = createVehicleRuntime(deps)
    rt.buildVehicles()
    await rt.applyGlbToggle(true)
    const v = rt.getVehicles()[0]
    expect(v.glb).toBeTruthy()
    expect(v.suspParts).toBeNull()
    rt.dispose()
  })

  it('成功 fixture → 挂载 + beltW 有限（beltW 声明序回归：不得引用未声明简写）', async () => {
    const { rt, vs } = await mountSuspension()
    const sp = vs[0].suspParts!
    expect(sp).not.toBeNull()
    expect(Number.isFinite(sp.sides.L!.beltW)).toBe(true)
    expect(sp.sides.L!.beltW).toBeGreaterThan(0)
    expect(vs[0].def.suspReaction).toBe(5)
    rt.dispose()
  })

  it('GLB 挂载与卸载都通知宿主刷新跟随相机近端', async () => {
    const data = makeData()
    const onModelChanged = vi.fn()
    const { deps } = makeDeps(data, { onModelChanged })
    const rt = createVehicleRuntime(deps)
    rt.buildVehicles()
    jsonRoutes()
    await rt.applyGlbToggle(true)
    expect(rt.getVehicles()[0].glb).toBeTruthy()
    expect(onModelChanged).toHaveBeenCalledTimes(1)
    expect(onModelChanged).toHaveBeenCalledWith(1)
    await rt.applyGlbToggle(false)
    expect(rt.getVehicles()[0].glb).toBeNull()
    expect(onModelChanged).toHaveBeenCalledTimes(2)
    expect(onModelChanged).toHaveBeenLastCalledWith(1)
    rt.dispose()
  })
})

describe(':1040 fail-closed 与 per-vehicle clone', () => {
  it('轮数 ≠ suspension.wheels → collectSuspensionParts null（整车刚体，不挂半装配悬挂）', async () => {
    gltfMock.mode = 'mismatch'
    const { rt, vs } = await mountSuspension()
    expect(vs[0].glb).toBeTruthy()
    expect(vs[0].suspParts).toBeNull()
    rt.dispose()
  })

  it('同 tank_id 两车：履带几何逐车 clone（变形不互相串）', async () => {
    const { rt, vs } = await mountSuspension(2)
    expect(vs.length).toBe(2)
    expect(vs[0].suspParts).not.toBeNull()
    expect(vs[1].suspParts).not.toBeNull()
    const g0 = vs[0].suspParts!.sides.L!.tracks[0].parts[0].mesh.geometry
    const g1 = vs[1].suspParts!.sides.L!.tracks[0].parts[0].mesh.geometry
    expect(g0).not.toBe(g1)
    rt.dispose()
  })
})

async function mountWithClock() {
  const data = makeData()
  let t = 0
  const { deps, scene } = makeDeps(data, { getT: () => t })
  const rt = createVehicleRuntime(deps)
  rt.buildVehicles()
  jsonRoutes()
  await rt.applyGlbToggle(true)
  const v = rt.getVehicles()[0]
  return { rt, v, deps, scene, setT: (x: number) => { t = x } }
}

describe(':1020 每帧解算 + seek 吸附（真实实现）', () => {
  it('两帧匀速 → 自转逐帧积累（侧位移积分）；markSeekSnap 后跳变只吸附不积累', async () => {
    const { rt, v, setT } = await mountWithClock()
    const w = v.suspParts!.sides.L!.wheels[0]
    rt.frameTiming(0.1, false)
    rt.applyPose(v)
    const spin0 = w.spin
    setT(0.1); rt.frameTiming(0.1, false); rt.applyPose(v)
    const spin1 = w.spin
    expect(Math.abs(spin1 - spin0)).toBeGreaterThan(0)
    setT(0.2); rt.frameTiming(0.1, false); rt.applyPose(v)
    const spin2 = w.spin
    expect(Math.abs(spin2 - spin1)).toBeGreaterThan(0)
    setT(5); rt.markSeekSnap()
    rt.applyPose(v)
    expect(w.spin).toBe(spin2)
    rt.clearSnap()
    setT(5.1); rt.frameTiming(0.1, false); rt.applyPose(v)
    expect(Math.abs(w.spin - spin2)).toBeGreaterThan(0)
    rt.dispose()
  })
})

describe(':1035 关闭 GLB / 会话结束', () => {
  it('applyGlbToggle(false)：先释放悬挂 disposables 再清引用；GLB 摘出场景', async () => {
    const { rt, vs, scene } = await mountSuspension()
    const v = vs[0]
    const disposables = v.suspParts!.disposables
    const spies = disposables.map((g) => vi.spyOn(g, 'dispose'))
    expect(scene.children).toContain(v.glb)
    await rt.applyGlbToggle(false)
    for (const s of spies) expect(s).toHaveBeenCalled()
    expect(v.glb).toBeNull()
    expect(v.glbParts).toBeNull()
    expect(v.suspParts).toBeNull()
    expect(scene.children).not.toContain(v.glb)
    rt.dispose()
  })
})

describe(':984 恒等姿态 + :1222 记录位姿带负号', () => {
  it('GLB 根四元数 = poseFromYPR(−yaw, pitch, −roll)（非零 yaw/pitch/roll + 随时间变化）；__hullGroup 恒归单位', async () => {
    const data = makeData()
    data.vehicles[0].hull_yaw = ramp(0.2, 0.01)
    data.vehicles[0].hull_pitch = ramp(-0.05, 0.001)
    data.vehicles[0].hull_roll = ramp(0.05, -0.0005)
    let t = 2
    const { deps } = makeDeps(data, { getT: () => t })
    const rt = createVehicleRuntime(deps)
    rt.buildVehicles()
    jsonRoutes()
    await rt.applyGlbToggle(true)
    const v = rt.getVehicles()[0]
    for (const [time, sample] of [[2, 20], [3, 30]] as const) {
      t = time
      rt.applyPose(v)
      const yaw = 0.2 + 0.01 * sample
      const pitch = -0.05 + 0.001 * sample
      const roll = 0.05 - 0.0005 * sample
      const expected = poseFromYPR(-yaw, pitch, -roll, new THREE.Quaternion())
      expect(v.glb!.quaternion.angleTo(expected)).toBeLessThan(1e-6)
      expect(v.glb!.quaternion.angleTo(poseFromYPR(-yaw, pitch, roll, new THREE.Quaternion()))).toBeGreaterThan(1e-3)
      const hg = v.glbParts!.hullGroup!
      expect(hg.quaternion.x).toBe(0); expect(hg.quaternion.y).toBe(0)
      expect(hg.quaternion.z).toBe(0); expect(hg.quaternion.w).toBe(1)
      expect(hg.position.x).toBe(0); expect(hg.position.y).toBe(0); expect(hg.position.z).toBe(0)
      expect(v.group.rotation.order).toBe('YXZ')
      expect(v.group.rotation.y).toBeCloseTo(-yaw, 10)
      expect(v.group.rotation.x).toBeCloseTo(pitch, 10)
      expect(v.group.rotation.z).toBeCloseTo(-roll, 10)
    }
    rt.dispose()
  })
})

describe(':1055/:1065/:1375 履带花纹与形变纯函数', () => {
  it(':1055 writeUvOffsetV 只取模偏移（整带同相）：V = base + phase，不逐顶点折叠', () => {
    const uvBase = [0, 2.85, 0.5, 2.85, 1.0, 2.85]
    const uv = new Float32Array(uvBase)
    const phase = writeUvOffsetV(uv, uvBase, 0.15)
    expect(phase).toBeCloseTo(0.15)
    expect(Array.from(uv)).toEqual([0, 3.0, 0.5, 3.0, 1.0, 3.0])
    const uv2 = new Float32Array(uvBase)
    expect(writeUvOffsetV(uv2, uvBase, 1.15)).toBeCloseTo(0.15)
    expect(uv2[1]).toBeCloseTo(3.0)
  })

  it(':1065 measureBeltUvSlope 取网格实测斜率；chainBottomRunDir 给底段走向符号', () => {
    const samples: Array<[number, number]> = []
    for (let s = 0; s <= 5; s += 0.1) samples.push([s, 0.5 * s])
    const fit = measureBeltUvSlope(samples)
    expect(fit.ok).toBe(true)
    expect(fit.slope).toBeCloseTo(0.5, 1)
    const chain: Array<[number, number]> = [[-3, 0], [-1, 0], [1, 0], [3, 1]]
    expect(chainBottomRunDir(chain)).toBe(1)
    const flipped: Array<[number, number]> = [[3, 0], [1, 0], [-1, 0], [-3, 1]]
    expect(chainBottomRunDir(flipped)).toBe(-1)
  })

  it(':1375 链形变下发按解算链逐点比较：等幅不同分布 → 变化；相等链 → 跳过', () => {
    const a = new Float64Array([0, 0.1, 0, 0])
    const b = new Float64Array([0.1, 0, 0, 0])
    const same = new Float64Array([0, 0.1, 0, 0])
    expect(chainChanged(a, b)).toBe(true)
    expect(chainChanged(a, same)).toBe(false)
    expect(chainChanged(null, a)).toBe(true)
    expect(chainDrift(a, b)).toBeCloseTo(0.1)
    expect(chainDrift(a, same)).toBe(0)
    expect(chainDrift(a, new Float64Array([0.1]))).toBe(Infinity)
  })
})

describe(':1166/:1213/:1201 位姿采样纯函数（零分配 / 缺列 / AoI 覆盖）', () => {
  const grid = { tStart: 0, samples: 101 }
  const def = {
    eid: 1, account_id: 1, coverage: [0, 100],
    pos: posColumn(), hull_yaw: col(1), hull_pitch: col(0.05), hull_roll: undefined,
    turret_yaw: col(2), gun_pitch: col(0),
  }

  it(':1201 旧产物缺 hull_roll 列 → roll 落 0（不拿 pitch 顶替）', () => {
    const out = sampleVehiclePoseGame(def as never, grid, 3)
    expect(out.roll).toBe(0)
    expect(out.pitch).toBeCloseTo(0.05)
  })

  it(':1166 poseFromYPR 支持 out 参数（模块级 scratch 零分配）', () => {
    const out = new THREE.Quaternion()
    const base = poseFromYPR(0, 0, 0, out)
    expect(base).toBe(out)
    const yawed = poseFromYPR(0.5, 0, 0, new THREE.Quaternion())
    expect(yawed.angleTo(base)).toBeCloseTo(0.5, 9)
    const rolled = poseFromYPR(0, 0, 0.1, new THREE.Quaternion())
    expect(rolled.angleTo(base)).toBeCloseTo(0.1, 9)
    const q2 = poseFromYPR(0.5, 0.2, 0.1, out)
    expect(q2).toBe(out)
    const q3 = poseFromYPR(0.5, 0.2, 0.1, new THREE.Quaternion())
    expect(q2.angleTo(q3)).toBeLessThan(1e-7)
  })

  it(':1213 visByEid 覆盖段优先于 coverage：段外钳位到段末（不跨隐藏段插值）', () => {
    const clamped = sampleVehiclePoseGame(def as never, grid, 5.5, undefined, [0, 5, 6, 100])
    expect(clamped.z).toBeCloseTo(10, 6)
    const full = sampleVehiclePoseGame(def as never, grid, 5.5)
    expect(full.z).toBeCloseTo(11, 6)
    void sampleVehiclePoseGame
  })
})
