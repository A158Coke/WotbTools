import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { createShotTrajectoryGroup, SHOT_TRAJECTORY_STYLE } from './shotTrajectoryGeometry.js'
import type { ShotTrajectoryGeometryLayer } from './shotTrajectoryGeometry.js'
import { SCENE_RESULT_COLORS, layerResultRole, sceneResultColor } from './shotResultPalette.js'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

function layer(partial: Partial<ShotTrajectoryGeometryLayer> & { point: THREE.Vector3 }): ShotTrajectoryGeometryLayer {
  return { ...partial }
}

function lineObjects(group: THREE.Object3D): Line2[] {
  const out: Line2[] = []
  group.traverse((o) => { if (o instanceof Line2) out.push(o) })
  return out
}
function dotObjects(group: THREE.Object3D): THREE.Points[] {
  const out: THREE.Points[] = []
  group.traverse((o) => { if (o instanceof THREE.Points) out.push(o) })
  return out
}
function polylineGroups(group: THREE.Object3D): THREE.Group[] {
  const out: THREE.Group[] = []
  group.traverse((o) => { if (o instanceof THREE.Group && o.userData.overlayRole === 'polyline') out.push(o) })
  return out
}

describe('createShotTrajectoryGroup — 结构', () => {
  it('空层链：无射线、无层点，lastPoint 回落 firstPoint', () => {
    const first = v(1, 2, 3)
    const { group, lastPoint } = createShotTrajectoryGroup({
      firstPoint: first, cameraPosition: v(1, 2, 103), layers: [], resultRole: 'PENETRATION', probabilityMode: false,
    })
    expect(lineObjects(group)).toHaveLength(0)
    expect(dotObjects(group)).toHaveLength(0)
    expect(lastPoint.equals(first)).toBe(true)
  })

  it('单层穿透：1 条 incoming（描边+核心）+ 1 个层点；不产生 reflected 段', () => {
    const first = v(0, 0, 0)
    const hit = v(0, 0, 10)
    const { group } = createShotTrajectoryGroup({
      firstPoint: first, cameraPosition: v(0, 0, 100),
      layers: [layer({ point: hit, penetrated: true })], resultRole: 'PENETRATION', probabilityMode: false,
    })
    expect(polylineGroups(group)).toHaveLength(1)
    expect(lineObjects(group)).toHaveLength(2)
    expect(dotObjects(group)).toHaveLength(1)
  })

  it('多层：每个层一个屏幕空间圆点；射线恒为 2px 核心 + 4px 描边', () => {
    const layers = [
      layer({ point: v(0, 0, 10), penetrated: true }),
      layer({ point: v(0, 0, 20), penetrated: true }),
      layer({ point: v(0, 0, 30), penetrated: false }),
    ]
    const { group } = createShotTrajectoryGroup({
      firstPoint: v(0, 0, 0), cameraPosition: v(0, 0, 100), layers, resultRole: 'BLOCKED', probabilityMode: false,
    })
    expect(dotObjects(group)).toHaveLength(3)
    expect(lineObjects(group)).toHaveLength(2)
    expect(SHOT_TRAJECTORY_STYLE).toEqual({ rayWidthPx: 2, rayHaloWidthPx: 4, dotSizePx: 7, renderOrder: 997 })
    for (const line of lineObjects(group)) {
      const mat = line.material as THREE.ShaderMaterial & { linewidth: number; toneMapped: boolean }
      expect(mat.toneMapped).toBe(false)
      expect(mat.depthTest).toBe(false)
      expect(mat.transparent).toBe(true)
      expect([2, 4]).toContain(mat.linewidth)
    }
    for (const dot of dotObjects(group)) {
      const mat = dot.material as THREE.PointsMaterial
      expect(mat).toBeInstanceOf(THREE.PointsMaterial)
      expect(mat.size).toBe(7)
      expect(mat.sizeAttenuation).toBe(false)
      expect(mat.toneMapped).toBe(false)
      expect(mat.depthTest).toBe(false)
      expect(mat.transparent).toBe(true)
      expect(dot.renderOrder).toBe(997)
    }
  })

  it('renderOrder：描边 996 / 核心与层点 997（溅射球壳 995 之上、命中点 999 之下）', () => {
    const layers = [layer({ point: v(0, 0, 10), penetrated: true }), layer({ point: v(0, 0, 20) })]
    const { group } = createShotTrajectoryGroup({
      firstPoint: v(0, 0, 0), cameraPosition: v(0, 0, 100), layers, resultRole: 'RICOCHET', probabilityMode: false,
    })
    const orders = lineObjects(group).map((line) => line.renderOrder).sort()
    expect(orders).toEqual([996, 997])
    for (const dot of dotObjects(group)) expect(dot.renderOrder).toBe(997)
  })

  it('factory 不自行挂载到任何 scene（parent 为 null，调用方拥有 fxScene 所有权）', () => {
    const { group } = createShotTrajectoryGroup({
      firstPoint: v(0, 0, 0), cameraPosition: v(0, 0, 100),
      layers: [layer({ point: v(0, 0, 10) })], resultRole: 'RICOCHET', probabilityMode: false,
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
      layers: [layer({ point: v(0, 0, 10) })], resultRole: 'RICOCHET', probabilityMode: false,
    })
    const core = lineObjects(group).find((line) => (line.material as { linewidth: number }).linewidth === 2)!
    const box = core.geometry.boundingBox!
    expect(box.min.z).toBeCloseTo(10, 3)
    expect(box.max.z).toBeCloseTo(300, 3)
  })

  it('trajOrigin 优先：射线从弹道起点铺到命中点，不用 300m 回退', () => {
    const { group } = createShotTrajectoryGroup({
      firstPoint: v(0, 0, 0), cameraPosition: v(0, 0, 100), trajOrigin: v(0, 0, 50),
      layers: [layer({ point: v(0, 0, 10) })], resultRole: 'RICOCHET', probabilityMode: false,
    })
    const core = lineObjects(group).find((line) => (line.material as { linewidth: number }).linewidth === 2)!
    expect(core.geometry.boundingBox!.max.z).toBeCloseTo(50, 3)
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

  it('incoming 段在 ricochet 点截断：不含截断之后的层点', () => {
    const { group } = createShotTrajectoryGroup({
      firstPoint: v(0, 0, 0), cameraPosition: v(0, 0, 100), layers: ricLayers, resultRole: 'RICOCHET', probabilityMode: false,
    })
    const incoming = polylineGroups(group)[0]
    const firstLine = incoming.children[0]
    const box = firstLine instanceof Line2 ? firstLine.geometry.boundingBox : null
    expect(box).not.toBeNull()
    expect(box!.min.x).toBeCloseTo(0, 6)
    expect(box!.max.x).toBeCloseTo(0, 6)
  })

  it('reflected 段：由 ricochet 点与 seg===1 续飞点组成（第 2 条折线）', () => {
    const { group } = createShotTrajectoryGroup({
      firstPoint: v(0, 0, 0), cameraPosition: v(0, 0, 100), layers: ricLayers, resultRole: 'RICOCHET', probabilityMode: false,
    })
    const lines = polylineGroups(group)
    expect(lines).toHaveLength(2)
    const core = lines[1].children[1] as Line2
    const box = core.geometry.boundingBox!
    expect(box.min.z).toBeCloseTo(10, 1)
    expect(box.max.z).toBeCloseTo(15, 1)
  })

  it('有 ricochet 但无 seg===1 续飞点：不产生 reflected 段', () => {
    const { group } = createShotTrajectoryGroup({
      firstPoint: v(0, 0, 0), cameraPosition: v(0, 0, 100),
      layers: [layer({ point: ricAt, ricochet: true })], resultRole: 'RICOCHET', probabilityMode: false,
    })
    expect(polylineGroups(group)).toHaveLength(1)
  })

  it('seg===1 续飞点出现在 ricochet 之前（无 ricochet）：与原实现等价地构造失败（生产层链不可达）', () => {
    expect(() => createShotTrajectoryGroup({
      firstPoint: v(0, 0, 0), cameraPosition: v(0, 0, 100),
      layers: [layer({ point: v(0, 0, 5), seg: 1 }), layer({ point: v(0, 0, 10) })],
      resultRole: 'BLOCKED', probabilityMode: false,
    })).toThrow(TypeError)
  })
})

describe('createShotTrajectoryGroup — 层色', () => {
  const role = (
    partial: Partial<ShotTrajectoryGeometryLayer>,
    probabilityMode = false,
  ) => layerResultRole({ layer: layer({ point: v(0, 0, 0), ...partial }), probabilityMode })

  it('非概率模式：penetrated 穿透绿 / ricochet 跳弹紫 / 其他挡下红', () => {
    expect(sceneResultColor(role({ penetrated: true }))).toBe(SCENE_RESULT_COLORS.PENETRATION)
    expect(sceneResultColor(role({ ricochet: true }))).toBe(SCENE_RESULT_COLORS.RICOCHET)
    expect(sceneResultColor(role({}))).toBe(SCENE_RESULT_COLORS.BLOCKED)
  })

  it('概率模式：层点按当前层局部 layerChance 分档（0 红、0–1 黄、1 绿）', () => {
    expect(role({ layerChance: 0 }, true)).toBe('BLOCKED')
    expect(role({ layerChance: 0.5 }, true)).toBe('MAY_PENETRATE')
    expect(role({ layerChance: 1 }, true)).toBe('PENETRATION')
    expect(role({}, true)).toBe('BLOCKED')
    expect(role({ chance: 0.5, layerChance: 1 }, true)).toBe('PENETRATION')
    expect(role({ ricochet: true, layerChance: 1 }, true)).toBe('RICOCHET')
  })

  it('层点材质吃到角色亮变体', () => {
    const { group } = createShotTrajectoryGroup({
      firstPoint: v(0, 0, 0), cameraPosition: v(0, 0, 100),
      layers: [layer({ point: v(0, 0, 5), layerChance: 1 }), layer({ point: v(0, 0, 10), layerChance: 0 })],
      resultRole: 'PENETRATION', probabilityMode: true,
    })
    const colors = dotObjects(group).map((m) => (m.material as THREE.PointsMaterial).color.getHex())
    expect(colors).toEqual([SCENE_RESULT_COLORS.PENETRATION, SCENE_RESULT_COLORS.BLOCKED])
  })

  it('提供 layerRoles 时直接消费调用方角色（与卡片同一数组）', () => {
    const { group } = createShotTrajectoryGroup({
      firstPoint: v(0, 0, 0), cameraPosition: v(0, 0, 100),
      layers: [layer({ point: v(0, 0, 5), layerChance: 1 })],
      layerRoles: ['MAY_PENETRATE'],
      resultRole: 'BLOCKED', probabilityMode: true,
    })
    const colors = dotObjects(group).map((m) => (m.material as THREE.PointsMaterial).color.getHex())
    expect(colors).toEqual([SCENE_RESULT_COLORS.MAY_PENETRATE])
  })

  it('未到达层用中性灰，不画成挡下红', () => {
    const { group } = createShotTrajectoryGroup({
      firstPoint: v(0, 0, 0), cameraPosition: v(0, 0, 100),
      layers: [
        layer({ point: v(0, 0, 5), penetrated: true }),
        layer({ point: v(0, 0, 10), reached: false }),
      ],
      resultRole: 'BLOCKED', probabilityMode: false,
    })
    const colors = dotObjects(group).map((m) => (m.material as THREE.PointsMaterial).color.getHex())
    expect(colors).toEqual([SCENE_RESULT_COLORS.PENETRATION, SCENE_RESULT_COLORS.UNREACHED])
  })

  it('射线核心/描边使用最终结果角色色与近黑描边', () => {
    const { group } = createShotTrajectoryGroup({
      firstPoint: v(0, 0, 0), cameraPosition: v(0, 0, 100),
      layers: [layer({ point: v(0, 0, 10), penetrated: true })], resultRole: 'PENETRATION', probabilityMode: false,
    })
    const lines = lineObjects(group)
    const core = lines.find((line) => (line.material as { linewidth: number }).linewidth === 2)!
    const halo = lines.find((line) => (line.material as { linewidth: number }).linewidth === 4)!
    expect((core.material as unknown as { color: THREE.Color }).color.getHex()).toBe(SCENE_RESULT_COLORS.PENETRATION)
    expect((halo.material as unknown as { color: THREE.Color }).color.getHex()).toBe(0x05070a)
    expect((halo.material as THREE.Material).opacity).toBe(0.5)
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
      firstPoint: first, cameraPosition: cam, trajOrigin: origin, layers, resultRole: 'RICOCHET', probabilityMode: false,
    })
    expect(first.equals(firstClone)).toBe(true)
    expect(cam.equals(camClone)).toBe(true)
    expect(JSON.stringify(layers.map((l) => l.point.toArray()))).toBe(layersSnapshot)
  })
})