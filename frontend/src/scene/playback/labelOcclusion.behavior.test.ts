// @vitest-environment happy-dom
// 标签软遮挡行为测试（#827 接替 labelOcclusion.test.js:20/:39/:50/:58/:71）：
// 场景只发布 occluded 标记（弱化强度归呈现层）；遮挡 LOS = camera → 标签锚点：
// 地形用高度场步进、静态场景用 raycast（只对线段经过的 16m 候选格）；车辆不是 blocker；
// 成本自适应（慢 raycast → 步长拉长）；raycaster.far 调用后恢复。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as THREE from 'three'
import { createLabelsRuntime } from './labelsRuntime.js'
import type { LabelsRuntimeDeps } from './labelsRuntime.js'
import { occlusionCells } from './pure.js'

type RuntimeVehicleLike = {
  def: { eid: number; account_id: number; team: number; max_hp: number }
  group: THREE.Group
  labelAnchor: THREE.Vector3
  labelOccluded: boolean | undefined
}

function makeVehicle(eid: number, pos: { x: number; y: number; z: number }) {
  const group = new THREE.Group()
  group.position.set(pos.x, pos.y, pos.z)
  return {
    def: { eid, account_id: eid, team: 1, max_hp: 1000 },
    group,
    labelAnchor: new THREE.Vector3(pos.x, pos.y + 4, pos.z),
    labelOccluded: undefined as boolean | undefined,
  } as RuntimeVehicleLike
}

function makeDeps({ vehicles, sampleHeight, occlGrid, mapScenery, raycaster }: {
  vehicles: RuntimeVehicleLike[]
  sampleHeight?: (x: number, z: number) => number
  occlGrid?: Map<string, unknown[]> | null
  mapScenery?: THREE.Object3D | null
  raycaster: THREE.Raycaster
}) {
  const container = document.createElement('div')
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 2, 0)
  const store = {
    killfeed: [], scoreFriend: 0, scoreEnemy: 0, friendlyTeam: null,
    roster: { team1: [], team2: [], unknown: [] }, labelsOn: true,
  }
  const setAnchor = vi.fn()
  const overlay = { setLabels: vi.fn(), setAnchor, clear: vi.fn() }
  const deps: LabelsRuntimeDeps = {
    store: store as never,
    container,
    getCamera: () => camera,
    getRaycaster: () => raycaster,
    getData: () => ({ meta: { friendly_team: 1 }, kills: [] }),
    getT: () => 0,
    getVehicles: () => vehicles as never,
    getSessionGen: () => 0,
    getFollowEid: () => null,
    deathAt: () => false,
    hpAt: () => 1000,
    visibleAt: () => true,
    visByEid: () => new Map(),
    scopedHiddenEid: () => 0,
    sampleHeight: sampleHeight ?? (() => 0),
    heightField: () => (sampleHeight ? (new Float32Array(64)) : null),
    heightMeta: () => (sampleHeight ? { size: 8, span: 600 } : null),
    mapScenery: () => mapScenery ?? null,
    occlGrid: () => occlGrid ?? null,
    transients: { ghostOf: () => undefined, hasFlash: () => false },
    fxScale: () => 1,
    getLabelOverlay: () => overlay as never,
    canonicalVehicles: () => [],
    invalidate: () => {},
  }
  return { deps, setAnchor, overlay, camera }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('createLabelsRuntime 标签软遮挡（行为）', () => {
  it('遮挡发布只打 occluded 标志：地形脊后 labelOccluded=true 并随 anchor 发布；脊前为 false', () => {
    // 高度场解析步进：z=-50 处一道 20m 山脊（camera 在 z=0，脊后锚点 z=-100）
    const sampleHeight = (x: number, z: number) => (Math.abs(z + 50) < 40 ? 20 : 0)
    const blocked = makeVehicle(1, { x: 0, y: 0, z: -100 })
    const { deps, setAnchor } = makeDeps({ vehicles: [blocked], sampleHeight })
    createLabelsRuntime(deps).updateLabels()
    expect(blocked.labelOccluded).toBe(true)
    expect(setAnchor).toHaveBeenCalledWith(1, expect.objectContaining({ occluded: true, visible: true }))

    // 山脊之前：视线不被地形挡
    const clear = makeVehicle(1, { x: 0, y: 0, z: -5 })
    const { deps: deps2 } = makeDeps({ vehicles: [clear], sampleHeight })
    createLabelsRuntime(deps2).updateLabels()
    expect(clear.labelOccluded).toBe(false)
  })

  it('场景遮挡只对候选格内网格 raycast（recursive=false），far 检测后恢复；车辆不是 blocker', () => {
    // 相机看 -z：锚点在 z=-100
    const vehicle = makeVehicle(1, { x: 0, y: 0, z: -100 })
    const otherVehicleMesh = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 7))   // 别的车，几何上挡在中间
    otherVehicleMesh.position.set(0, 2, -50)
    const building = new THREE.Mesh(new THREE.BoxGeometry(4, 10, 4))
    building.position.set(0, 5, -50)
    const occlGrid = new Map<string, unknown[]>()
    // 候选格 = 线段经过的 16m 格（真实 occlusionCells 枚举）；车辆登记在**视轴外**的邻格
    for (const key of occlusionCells(0, 0, 0, -100)) occlGrid.set(key, [building])
    const offPathKeys = [...occlusionCells(0, 0, 0, -100)].map((k) => {
      const [cx, cz] = k.split(',').map(Number)
      return `${cx - 5},${cz}`
    })
    occlGrid.set(offPathKeys[0], [otherVehicleMesh])
    const raycaster = new THREE.Raycaster()
    const intersectSpy = vi.spyOn(raycaster, 'intersectObjects').mockReturnValue([building as never])
    raycaster.far = 1234
    const { deps } = makeDeps({ vehicles: [vehicle], occlGrid, mapScenery: new THREE.Group(), raycaster })
    createLabelsRuntime(deps).updateLabels()
    // 候选格只含 occlGrid 登记的网格——不含车辆运行时（即使它在视线上）
    const cands = intersectSpy.mock.calls[0][0] as THREE.Object3D[]
    expect(cands).not.toContain(otherVehicleMesh)
    expect(cands).toContain(building)
    expect(intersectSpy.mock.calls[0][1]).toBe(false)   // 非递归（批次球测由 InstancedMesh 自理）
    expect(vehicle.labelOccluded).toBe(true)            // 命中建筑 → 遮挡
    expect(raycaster.far).toBe(1234)                    // far 恢复（不污染点选跟随）
    // 场景中途把建筑移出候选：无候选 → fail-open（不遮挡）
    for (const key of occlGrid.keys()) occlGrid.delete(key)
    createLabelsRuntime(deps).updateLabels()
    expect(vehicle.labelOccluded).toBe(false)
  })

  it('成本自适应：慢 raycast（>4ms）后步长拉长——下一帧跳过检测，隔帧才轮到下一辆车', () => {
    const vehicles = [makeVehicle(1, { x: 0, y: 0, z: -60 }), makeVehicle(2, { x: 5, y: 0, z: -60 })]
    const building = new THREE.Mesh(new THREE.BoxGeometry(4, 10, 4))
    const occlGrid = new Map<string, unknown[]>()
    for (const key of [...occlusionCells(0, 0, 0, -60), ...occlusionCells(0, 0, 5, -60)]) {
      occlGrid.set(key, [building])
    }
    const raycaster = new THREE.Raycaster()
    let first = true
    vi.spyOn(raycaster, 'intersectObjects').mockImplementation(() => {
      if (first) {
        first = false
        const end = performance.now() + 6   // 超 LABEL_OCCL_BUDGET_MS=4ms
        while (performance.now() < end) { /* busy */ }
      }
      return []
    })
    const { deps } = makeDeps({ vehicles, occlGrid, mapScenery: new THREE.Group(), raycaster })
    const rt = createLabelsRuntime(deps)
    rt.updateLabels()   // 车辆 1 检测（耗时 6ms → occlCostMs 超预算 → 步长自适应拉长）
    rt.updateLabels()   // 步长 >1：未到检测帧，沿用缓存（车辆 2 仍未检测、不 raycast）
    expect(raycaster.intersectObjects).toHaveBeenCalledTimes(1)
    expect(vehicles[1].labelOccluded).toBeUndefined()
    // 快路径相反：不超预算 → 每帧轮转检测（回到无慢检测的 runtime）
    const building2 = building
    const raycaster2 = new THREE.Raycaster()
    vi.spyOn(raycaster2, 'intersectObjects').mockReturnValue([building2 as never])
    const { deps: deps2 } = makeDeps({ vehicles, occlGrid, mapScenery: new THREE.Group(), raycaster: raycaster2 })
    const rt2 = createLabelsRuntime(deps2)
    rt2.updateLabels()   // 车辆 1
    rt2.updateLabels()   // 车辆 2（步长保持 1）
    expect(raycaster2.intersectObjects).toHaveBeenCalledTimes(2)
  })

  it('每帧推进遮挡并把结果作为 anchor.occluded 发布（updateLabels → setAnchor）', () => {
    const vehicle = makeVehicle(1, { x: 0, y: 0, z: -100 })
    const occlGrid = new Map<string, unknown[]>()
    const raycaster = new THREE.Raycaster()
    vi.spyOn(raycaster, 'intersectObjects').mockReturnValue([])
    const { deps, setAnchor } = makeDeps({ vehicles: [vehicle], occlGrid, mapScenery: new THREE.Group(), raycaster })
    createLabelsRuntime(deps).updateLabels()
    // 无遮挡快路径：occluded false 照样发布（呈现层按标志弱化，场景不带透明度）
    expect(setAnchor).toHaveBeenCalledWith(1, expect.objectContaining({ occluded: false, projected: true }))
  })
})
