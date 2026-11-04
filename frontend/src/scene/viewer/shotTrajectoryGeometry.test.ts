/**
 * shotTrajectoryGeometry 单测（Issue #820 Wave B3B）。
 *
 * 使用真实 Three.js 几何对象锁工厂不变量：Tube/标记结构、跳弹截断与续飞段、
 * 层色与 renderOrder、材质深度/透明参数、300m 默认回退、输入向量不可变、
 * 不挂载到任何 scene。等价基准 = 原 tankViewer.showTrajectory() 的几何分支。
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createShotTrajectoryGroup, trajectoryChanceColor, trajectoryLayerColor } from './shotTrajectoryGeometry.js'
import type { ShotTrajectoryGeometryLayer } from './shotTrajectoryGeometry.js'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

function layer(partial: Partial<ShotTrajectoryGeometryLayer> & { point: THREE.Vector3 }): ShotTrajectoryGeometryLayer {
  return { ...partial }
}

function positionBox(mesh: THREE.Mesh): THREE.Box3 {
  const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
  return new THREE.Box3().setFromBufferAttribute(attr)
}
function meshChildren(group: THREE.Group): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  group.traverse((o) => { if (o instanceof THREE.Mesh) out.push(o) })
  return out
}

function tubeMeshes(group: THREE.Group): THREE.Mesh[] {
  return meshChildren(group).filter((m) => m.geometry instanceof THREE.TubeGeometry)
}

function dotMeshes(group: THREE.Group): THREE.Mesh[] {
  return meshChildren(group).filter((m) => m.geometry instanceof THREE.SphereGeometry)
}

/** 轨迹材质：tube 与 dot 分别的 MeshBasicMaterial 形状（depthTest off、透明）。 */
function assertTrajMaterial(mat: THREE.Material, color: number, opacity: number): void {
  expect(mat).toBeInstanceOf(THREE.MeshBasicMaterial)
  const basic = mat as THREE.MeshBasicMaterial
  expect(basic.color.getHex()).toBe(color)
  expect(basic.depthTest).toBe(false)
  expect(basic.transparent).toBe(true)
  expect(basic.opacity).toBe(opacity)
}

describe('createShotTrajectoryGroup — 结构', () => {
  it('空层链：无 tube、无标记，lastPoint 回落 firstPoint', () => {
    const first = v(1, 2, 3)
    const { group, lastPoint } = createShotTrajectoryGroup({
      firstPoint: first, cameraPosition: v(1, 2, 103), layers: [], color: 0x4CAF50, probabilityMode: false,
    })
    expect(tubeMeshes(group)).toHaveLength(0)
    expect(dotMeshes(group)).toHaveLength(0)
    expect(lastPoint.equals(first)).toBe(true)
  })

  it('单层穿透：1 条 incoming tube + 1 个标记；不产生 reflected 段', () => {
    const first = v(0, 0, 0)
    const hit = v(0, 0, 10)
    const { group } = createShotTrajectoryGroup({
      firstPoint: first, cameraPosition: v(0, 0, 100),
      layers: [layer({ point: hit, penetrated: true })], color: 0x4CAF50, probabilityMode: false,
    })
    expect(tubeMeshes(group)).toHaveLength(1)
    expect(dotMeshes(group)).toHaveLength(1)
  })

  it('多层：每个层一个标记；tube 参数保持原值（半径 0.025、radial 8、tubular = max(2, n*2)）', () => {
    const layers = [
      layer({ point: v(0, 0, 10), penetrated: true }),
      layer({ point: v(0, 0, 20), penetrated: true }),
      layer({ point: v(0, 0, 30), penetrated: false }),
    ]
    const { group } = createShotTrajectoryGroup({
      firstPoint: v(0, 0, 0), cameraPosition: v(0, 0, 100), layers, color: 0xf44336, probabilityMode: false,
    })
    expect(dotMeshes(group)).toHaveLength(3)
    const tubes = tubeMeshes(group)
    expect(tubes).toHaveLength(1)
    const params = (tubes[0].geometry as THREE.TubeGeometry).parameters
    expect(params.radius).toBe(0.025)
    expect(params.radialSegments).toBe(8)
    // incoming = origin + 3 层 = 4 点 → tubularSegments = 8
    expect(params.tubularSegments).toBe(8)
    for (const dot of dotMeshes(group)) {
      expect((dot.geometry as THREE.SphereGeometry).parameters.radius).toBe(0.04)
    }
  })

  it('所有 mesh renderOrder 997、材质 depthTest 关闭（溅射球壳 996 之上、命中标记 999 之下）', () => {
    const layers = [layer({ point: v(0, 0, 10), penetrated: true }), layer({ point: v(0, 0, 20) })]
    const { group } = createShotTrajectoryGroup({
      firstPoint: v(0, 0, 0), cameraPosition: v(0, 0, 100), layers, color: 0xffcf5c, probabilityMode: false,
    })
    for (const mesh of meshChildren(group)) {
      expect(mesh.renderOrder).toBe(997)
      expect((mesh.material as THREE.MeshBasicMaterial).depthTest).toBe(false)
      expect((mesh.material as THREE.MeshBasicMaterial).transparent).toBe(true)
    }
    // 轨迹管透明度 0.85、层点 0.95
    assertTrajMaterial(tubeMeshes(group)[0].material as THREE.Material, 0xffcf5c, 0.85)
    assertTrajMaterial(dotMeshes(group)[0].material as THREE.Material, 0x4CAF50, 0.95)
  })

  it('factory 不自行挂载到任何 scene（parent 为 null，调用方拥有 fxScene 所有权）', () => {
    const { group } = createShotTrajectoryGroup({
      firstPoint: v(0, 0, 0), cameraPosition: v(0, 0, 100),
      layers: [layer({ point: v(0, 0, 10) })], color: 0xff8800, probabilityMode: false,
    })
    expect(group.parent).toBeNull()
    expect(group.isGroup).toBe(true)
  })
})

describe('createShotTrajectoryGroup — 原点回退', () => {
  it('无 trajOrigin：沿视线反向回退 300m（camDir = cameraPosition - firstPoint）', () => {
    const first = v(0, 0, 0)
    const { group } = createShotTrajectoryGroup({
      firstPoint: first, cameraPosition: v(0, 0, 100),
      layers: [layer({ point: v(0, 0, 10) })], color: 0xff8800, probabilityMode: false,
    })
    const tube = tubeMeshes(group)[0]
    const box = positionBox(tube)
    // origin = first + camDir*300 = (0,0,300)；tube 从 origin 铺到命中点 (0,0,10)
    expect(box.min.z).toBeCloseTo(10, 3)
    expect(box.max.z).toBeCloseTo(300, 3)
  })

  it('trajOrigin 优先：tube 从弹道起点铺到命中点，不用 300m 回退', () => {
    const { group } = createShotTrajectoryGroup({
      firstPoint: v(0, 0, 0), cameraPosition: v(0, 0, 100), trajOrigin: v(0, 0, 50),
      layers: [layer({ point: v(0, 0, 10) })], color: 0xff8800, probabilityMode: false,
    })
    const tube = tubeMeshes(group)[0]
    const box = positionBox(tube)
    expect(box.max.z).toBeCloseTo(50, 3)
  })
})

describe('createShotTrajectoryGroup — 跳弹', () => {
  const ricAt = v(0, 0, 10)
  const after = v(5, 0, 15)
  const ricLayers = [
    layer({ point: v(0, 0, 5) }),
    layer({ point: ricAt, ricochet: true }),
    layer({ point: after, seg: 1 }),
  ]

  it('incoming tube 在 ricochet 点截断：不含截断之后的层点', () => {
    const { group } = createShotTrajectoryGroup({
      firstPoint: v(0, 0, 0), cameraPosition: v(0, 0, 100), layers: ricLayers, color: 0xFF8800, probabilityMode: false,
    })
    const tubes = tubeMeshes(group)
    expect(tubes.length).toBeGreaterThanOrEqual(1)
    const incoming = tubes[0]
    const box = positionBox(incoming)
    // 入射段各点共线于 z 轴，x/y 范围只有管半径；若截断失效会延到续飞点 (x=5)
    expect(box.min.x).toBeGreaterThan(-0.1)
    expect(box.max.x).toBeLessThan(0.1)
    // tubularSegments = max(2, 3*2)（origin + 2 层）
    expect((incoming.geometry as THREE.TubeGeometry).parameters.tubularSegments).toBe(6)
  })

  it('reflected 段：由 ricochet 点与 seg===1 续飞点组成（第 2 条 tube）', () => {
    const { group } = createShotTrajectoryGroup({
      firstPoint: v(0, 0, 0), cameraPosition: v(0, 0, 100), layers: ricLayers, color: 0xFF8800, probabilityMode: false,
    })
    const tubes = tubeMeshes(group)
    expect(tubes).toHaveLength(2)
    const box = positionBox(tubes[1])
    expect(box.min.z).toBeCloseTo(10, 1) // 从 ricochet 点起
    expect(box.max.z).toBeCloseTo(15, 1) // 到续飞点止
  })

  it('有 ricochet 但无 seg===1 续飞点：不产生 reflected tube', () => {
    const { group } = createShotTrajectoryGroup({
      firstPoint: v(0, 0, 0), cameraPosition: v(0, 0, 100),
      layers: [layer({ point: ricAt, ricochet: true })], color: 0xFF8800, probabilityMode: false,
    })
    expect(tubeMeshes(group)).toHaveLength(1)
  })

  it('seg===1 续飞点出现在 ricochet 之前（无 ricochet）：与原实现等价地构造失败（生产层链不可达）', () => {
    // 原 showTrajectory() 在该输入下会向 reflected 补 null ricPoint，TubeGeometry
    // 构造抛 TypeError；工厂逐字迁移该分支，生产链路中 seg===1 只随 ricochet 出现。
    expect(() => createShotTrajectoryGroup({
      firstPoint: v(0, 0, 0), cameraPosition: v(0, 0, 100),
      layers: [layer({ point: v(0, 0, 5), seg: 1 }), layer({ point: v(0, 0, 10) })],
      color: 0xf44336, probabilityMode: false,
    })).toThrow(TypeError)
  })
})

describe('createShotTrajectoryGroup — 层色', () => {
  it('非概率模式：penetrated 绿 / ricochet 橙 / 其他红', () => {
    expect(trajectoryLayerColor(layer({ point: v(0, 0, 0), penetrated: true }), false)).toBe(0x4CAF50)
    expect(trajectoryLayerColor(layer({ point: v(0, 0, 0), ricochet: true }), false)).toBe(0xFF8800)
    expect(trajectoryLayerColor(layer({ point: v(0, 0, 0) }), false)).toBe(0xf44336)
  })

  it('概率模式：层点按逐层累计 chance 分档（0 红、0–1 黄、1 绿）', () => {
    expect(trajectoryLayerColor(layer({ point: v(0, 0, 0), chance: 0 }), true)).toBe(0xf44336)
    expect(trajectoryLayerColor(layer({ point: v(0, 0, 0), chance: 0.5 }), true)).toBe(0xffcf5c)
    expect(trajectoryLayerColor(layer({ point: v(0, 0, 0), chance: 1 }), true)).toBe(0x4CAF50)
    expect(trajectoryLayerColor(layer({ point: v(0, 0, 0) }), true)).toBe(0xf44336) // 缺 chance → 0
    expect(trajectoryChanceColor(0.99)).toBe(0xffcf5c)
  })

  it('概率模式层点材质吃到分档色', () => {
    const { group } = createShotTrajectoryGroup({
      firstPoint: v(0, 0, 0), cameraPosition: v(0, 0, 100),
      layers: [layer({ point: v(0, 0, 5), chance: 1 }), layer({ point: v(0, 0, 10), chance: 0 })],
      color: 0x4CAF50, probabilityMode: true,
    })
    const colors = dotMeshes(group).map((m) => (m.material as THREE.MeshBasicMaterial).color.getHex())
    expect(colors).toEqual([0x4CAF50, 0xf44336])
  })
})

describe('createShotTrajectoryGroup — 输入不可变', () => {
  it('不修改传入的 firstPoint / cameraPosition / trajOrigin / layers', () => {
    const first = v(1, 2, 3)
    const cam = v(4, 5, 6)
    const origin = v(7, 8, 9)
    const p1 = v(0, 0, 10)
    const layers = [layer({ point: p1, penetrated: true })]
    const firstClone = first.clone()
    const camClone = cam.clone()
    const layersSnapshot = JSON.stringify(layers.map((l) => l.point.toArray()))
    createShotTrajectoryGroup({
      firstPoint: first, cameraPosition: cam, trajOrigin: origin, layers, color: 0xff8800, probabilityMode: false,
    })
    expect(first.equals(firstClone)).toBe(true)
    expect(cam.equals(camClone)).toBe(true)
    expect(JSON.stringify(layers.map((l) => l.point.toArray()))).toBe(layersSnapshot)
  })
})
