// 车辆运行时行为测试（#827 接替 sceneryMaterials.test.js 的
// :1007/:1020/:1035/:1040/:984 恒等半句/:1222，及 :1055/:1065/:1166/:1375 纯函数）：
// - 悬挂数据 404 → 整车刚体（v.suspParts===null，GLB 照常挂载）；成功 fixture → 挂载 +
//   beltW 有限（beltW 声明序回归）；
// - 轮数/链数不符 → fail-closed null；两车履带几何 per-vehicle clone；
// - frameTiming + applyPose 两帧正常积分；markSeekSnap 后跳变吸附（侧位移不积累）；
// - applyGlbToggle(false)：先释放 disposables 再清引用；
// - poseGlb 的 __hullGroup 恒归单位（拆分组不改变摆放）；hull_roll 记录位姿带负号；
// - 纯函数：writeUvOffsetV 只取模偏移、measureBeltUvSlope 实测斜率、chainChanged/chainDrift
//   逐点比较、poseFromYPR out 参数零分配。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as THREE from 'three'
import { writeUvOffsetV, measureBeltUvSlope, chainBottomRunDir, chainChanged, chainDrift } from '../suspension.js'
import { poseFromYPR } from '../glbRig.js'
import { sampleVehiclePoseGame } from '../../replay-local/pose/vehiclePose.js'

// ---------- fixtures ----------
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
/** 悬挂可解算坦克：hull + turret_01/gun_01 + 每侧 1 轮 1 带段 */
function suspTank(wheelsPerSide = 1) {
  const root = new THREE.Group()
  root.add(namedMesh('hull'))
  const gun = new THREE.Group(); gun.name = 'gun_01'; gun.add(namedMesh('m_barrel'))
  const t1 = new THREE.Group(); t1.name = 'turret_01'; t1.add(gun)
  root.add(t1)
  for (const side of ['L', 'R'] as const) {
    const trackGeo = new THREE.BoxGeometry(0.8, 6.5, 0.75)   // 模型系：宽 x / 纵向 y / 高 z
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
import type { VehicleRuntimeDeps, RuntimeVehicle } from './vehicleRuntime.js'

function makeData(vehicleCount = 1) {
  return {
    vehicles: Array.from({ length: vehicleCount }, (_, i) => ({
      eid: i + 1, account_id: i + 1, tank_id: 10001, team: 1, death_t: null,
      coverage: [0, 100], pos: posColumn(), hull_yaw: col(0), hull_pitch: col(0), hull_roll: col(0),
    })),
    detached_turrets: [],
  }
}
/** 网格位姿列：沿游戏 +z 以 2 m/s 匀速（GRID_DT=0.1，101 样本 = 0–10s） */
function posColumn() {
  const out: number[] = []
  for (let i = 0; i < 101; i++) out.push(0, 0, 0.2 * i)
  return out
}
const col = (v: number) => Array.from({ length: 101 }, () => v)

function makeDeps(data: ReturnType<typeof makeData>, overrides: Partial<VehicleRuntimeDeps> = {}) {
  const scene = new THREE.Scene()
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

describe(':1007 悬挂数据（包内 suspension/<id>.json）', () => {
  it('suspension json 404 → 整车回落刚体（v.suspParts===null），GLB 照常挂载', async () => {
    const data = makeData()
    const { deps } = makeDeps(data)
    jsonRoutes({ susp: null })   // .json('/suspension/...').catch(() => null) → 与数据面缺省同路
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
    expect(vs[0].def.suspReaction).toBe(5)   // wheels_reaction_speed 透传
    rt.dispose()
  })
})

describe(':1040 fail-closed 与 per-vehicle clone', () => {
  it('轮数 ≠ suspension.wheels → collectSuspensionParts null（整车刚体，不挂半装配悬挂）', async () => {
    gltfMock.mode = 'mismatch'   // 每侧 2 轮，数据只有 1 条 wheel 记录
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
    rt.applyPose(v)                       // t=0：首帧 prev 无 → dS=0
    const spin0 = w.spin
    setT(0.1); rt.frameTiming(0.1, false); rt.applyPose(v)
    const spin1 = w.spin
    expect(Math.abs(spin1 - spin0)).toBeGreaterThan(0)   // 0.2m 侧位移 → 自转推进
    setT(0.2); rt.frameTiming(0.1, false); rt.applyPose(v)
    const spin2 = w.spin
    expect(Math.abs(spin2 - spin1)).toBeGreaterThan(0)   // 无横向积累断点
    // seek 跳变：直接跳到 t=5（位置跳 1m）——markSeekSnap 后 tick 吸附，自转不再按跳变量推进
    setT(5); rt.markSeekSnap()
    rt.applyPose(v)
    expect(w.spin).toBe(spin2)   // 跳变段不计侧位移（客户端"首次可见直接吸附"）
    rt.clearSnap()
    setT(5.1); rt.frameTiming(0.1, false); rt.applyPose(v)
    expect(Math.abs(w.spin - spin2)).toBeGreaterThan(0)  // seek 后恢复逐帧积分
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
    for (const s of spies) expect(s).toHaveBeenCalled()   // 反复开关不累积 GPU 缓冲
    expect(v.glb).toBeNull()
    expect(v.glbParts).toBeNull()
    expect(v.suspParts).toBeNull()
    expect(scene.children).not.toContain(v.glb)
    rt.dispose()
  })
})

describe(':984 恒等姿态 + :1222 记录位姿带负号', () => {
  it('GLB 挂载后 __hullGroup 恒归单位（拆分组不改变摆放）；hull_roll/yaw 场景系取负', async () => {
    const data = makeData()
    data.vehicles[0].hull_yaw = col(1)          // 1 rad
    data.vehicles[0].hull_roll = col(Math.PI / 18)  // 10°
    let t = 2
    const { deps } = makeDeps(data, { getT: () => t })
    const rt = createVehicleRuntime(deps)
    rt.buildVehicles()
    jsonRoutes()
    await rt.applyGlbToggle(true)
    const v = rt.getVehicles()[0]
    rt.applyPose(v)
    // GLB 拆分组：恒单位（记录位姿在根上）
    const hg = v.glbParts!.hullGroup!
    expect(hg.quaternion.x).toBe(0); expect(hg.quaternion.y).toBe(0)
    expect(hg.quaternion.z).toBe(0); expect(hg.quaternion.w).toBe(1)
    expect(hg.position.x).toBe(0); expect(hg.position.y).toBe(0); expect(hg.position.z).toBe(0)
    // 低模侧同口径：y = −yaw / x = pitch / z = −roll（镜像约定，与 −yaw 同号）
    expect(v.group.rotation.order).toBe('YXZ')
    expect(v.group.rotation.y).toBeCloseTo(-1, 10)
    expect(v.group.rotation.z).toBeCloseTo(-Math.PI / 18, 10)
    void t
    rt.dispose()
  })
})

describe(':1055/:1065/:1375 履带花纹与形变纯函数', () => {
  it(':1055 writeUvOffsetV 只取模偏移（整带同相）：V = base + phase，不逐顶点折叠', () => {
    const uvBase = [0, 2.85, 0.5, 2.85, 1.0, 2.85]   // 3 顶点，V=2.85（跨 wrap 底段）
    const uv = new Float32Array(uvBase)
    const phase = writeUvOffsetV(uv, uvBase, 0.15)
    expect(phase).toBeCloseTo(0.15)
    expect(Array.from(uv)).toEqual([0, 3.0, 0.5, 3.0, 1.0, 3.0])   // 无 frac 折叠（2.85+0.15=3.0）
    // 偏移 >1：取模只作用在偏移上（整带同相），基础 V 原样保留
    const uv2 = new Float32Array(uvBase)
    expect(writeUvOffsetV(uv2, uvBase, 1.15)).toBeCloseTo(0.15)
    expect(uv2[1]).toBeCloseTo(3.0)
  })

  it(':1065 measureBeltUvSlope 取网格实测斜率；chainBottomRunDir 给底段走向符号', () => {
    // 沿带弧长每 1m V 增加 0.5（线性带）→ 实测 |slope| ≈ 0.5
    const samples: Array<[number, number]> = []
    for (let s = 0; s <= 5; s += 0.1) samples.push([s, 0.5 * s])
    const fit = measureBeltUvSlope(samples)
    expect(fit.ok).toBe(true)
    expect(fit.slope).toBeCloseTo(0.5, 1)
    // 底段走向：点序号增大方向为 +y（车尾→车头）→ +1；反向 → −1
    const chain: Array<[number, number]> = [[-3, 0], [-1, 0], [1, 0], [3, 1]]
    expect(chainBottomRunDir(chain)).toBe(1)
    const flipped: Array<[number, number]> = [[3, 0], [1, 0], [-1, 0], [-3, 1]]
    expect(chainBottomRunDir(flipped)).toBe(-1)
  })

  it(':1375 链形变下发按解算链逐点比较：等幅不同分布 → 变化；相等链 → 跳过', () => {
    const a = new Float64Array([0, 0.1, 0, 0])
    const b = new Float64Array([0.1, 0, 0, 0])     // 幅度相同、分布不同
    const same = new Float64Array([0, 0.1, 0, 0])
    expect(chainChanged(a, b)).toBe(true)          // 只比最大幅度会漏
    expect(chainChanged(a, same)).toBe(false)      // 相等链 → 跳过下发
    expect(chainChanged(null, a)).toBe(true)       // 首帧 fail-safe
    expect(chainDrift(a, b)).toBeCloseTo(0.1)
    expect(chainDrift(a, same)).toBe(0)
    expect(chainDrift(a, new Float64Array([0.1]))).toBe(Infinity)   // 长度不符 → 重算法线
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
    expect(out.pitch).toBeCloseTo(0.05)   // pitch 正常采样（独立通道）
  })

  it(':1166 poseFromYPR 支持 out 参数（模块级 scratch 零分配）', () => {
    const out = new THREE.Quaternion()
    const base = poseFromYPR(0, 0, 0, out)
    expect(base).toBe(out)
    // 语义：yaw 绕场景系 Y 轴（相对零位姿的相对旋转角 = 入参角；镜像符号由调用方取负）
    const yawed = poseFromYPR(0.5, 0, 0, new THREE.Quaternion())
    expect(yawed.angleTo(base)).toBeCloseTo(0.5, 9)
    const rolled = poseFromYPR(0, 0, 0.1, new THREE.Quaternion())
    expect(rolled.angleTo(base)).toBeCloseTo(0.1, 9)
    // 复用同一 out：重复写入幂等（无残留）
    const q2 = poseFromYPR(0.5, 0.2, 0.1, out)
    expect(q2).toBe(out)
    const q3 = poseFromYPR(0.5, 0.2, 0.1, new THREE.Quaternion())
    expect(q2.angleTo(q3)).toBeLessThan(1e-7)
  })

  it(':1213 visByEid 覆盖段优先于 coverage：段外钳位到段末（不跨隐藏段插值）', () => {
    // t=5.5 落在隐藏段 [5,6]：钳位到段末 t=5 的位姿（z=10），不得插值到 11
    const clamped = sampleVehiclePoseGame(def as never, grid, 5.5, undefined, [0, 5, 6, 100])
    expect(clamped.z).toBeCloseTo(10, 6)
    // 无覆盖段信息 → 回退 def.coverage 全域插值
    const full = sampleVehiclePoseGame(def as never, grid, 5.5)
    expect(full.z).toBeCloseTo(11, 6)
    // 运行时接线：deps.visByEid().get(eid) ?? def.coverage（场景侧消费同一判定）
    void sampleVehiclePoseGame
  })
})
