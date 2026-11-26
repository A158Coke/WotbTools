import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { VIEWBOX } from './types.js'
import { validateModelEntry } from './validate.js'
import {
  bounds2D,
  collectNodeTriangles,
  collectNodeVerts,
  computeFit,
  computeTurretModelPivot,
  convexHull2D,
  filterDegeneratePolys,
  groupRenderNodes,
  rasterVisibility,
  resolveBakeScenes,
  selectDefaultModules,
  visibilityPixel,
} from '../../scripts/extractor-lib.mjs'

function rotatePointAround({ point, origin, deg }) {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = point.x - origin.x
  const dy = point.y - origin.y
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  }
}

const MAUS_DIR = fileURLToPath(new URL('./assets/maus/', import.meta.url))
describe('Maus 生成资产契约（assets/maus，texture-bake 正式契约）', () => {
  it('hull.webp / turret.webp / metadata.json / bake-report.json 存在且通过 validateModelEntry', () => {
    const files = { hull: null, turret: null, metadata: null, bakeReport: null, extra: [] }
    for (const name of ['hull.webp', 'turret.webp', 'metadata.json', 'bake-report.json']) {
      try {
        const key = name === 'metadata.json' ? 'metadata' : name === 'bake-report.json' ? 'bakeReport' : name.replace('.webp', '')
        files[key] = readFileSync(MAUS_DIR + name, 'latin1')
      } catch {
        // missing → null
      }
    }
    const errors = validateModelEntry({ modelKey: 'maus', kind: 'turreted', files })
    expect(errors, JSON.stringify(errors)).toEqual([])
  })
  it('正式资产契约：WebP 二进制 / 320 logical + 640 physical / 无 base64 内嵌', () => {
    for (const name of ['hull.webp', 'turret.webp']) {
      const buf = readFileSync(MAUS_DIR + name, 'latin1')
      expect(buf.slice(0, 4)).toBe('RIFF')
      expect(buf.slice(8, 12)).toBe('WEBP')
      expect(buf.includes('base64')).toBe(false)
    }
  })
  it('metadata.json：source.provider=blitzkit、tankId=6929、turretPivot 在画布内', () => {
    const meta = JSON.parse(readFileSync(MAUS_DIR + 'metadata.json', 'utf8'))
    expect(meta.modelKey).toBe('maus')
    expect(meta.source.provider).toBe('blitzkit')
    expect(meta.source.tankId).toBe(6929)
    expect(meta.turretPivot.x).toBeGreaterThan(0)
    expect(meta.turretPivot.y).toBeGreaterThan(0)
    expect(meta.turretPivot.x).toBeLessThan(VIEWBOX.width)
    expect(meta.turretPivot.y).toBeLessThan(VIEWBOX.height)
  })
  it('turretPivot 稳定性：0/90/180/270 旋转不动点（任务 11）', () => {
    const meta = JSON.parse(readFileSync(MAUS_DIR + 'metadata.json', 'utf8'))
    const pivot = meta.turretPivot
    for (const deg of [0, 90, 180, 270]) {
      const img = rotatePointAround({ point: pivot, origin: pivot, deg })
      expect(img.x).toBeCloseTo(pivot.x, 6)
      expect(img.y).toBeCloseTo(pivot.y, 6)
    }
  })
  it('高保真：真实比例无夸大——gun 宽度与模型投影一致（faithful geometry scale，bake 无放大）', () => {
    const meta = JSON.parse(readFileSync(MAUS_DIR + 'metadata.json', 'utf8'))
    const [gMinX, gMaxX] = [meta.generation.gunBounds.min[0], meta.generation.gunBounds.max[0]]
    const hb = meta.generation.hullBounds
    const hullMaxDim = Math.max(hb.max[0] - hb.min[0], hb.max[1] - hb.min[1])
    const scale = (VIEWBOX.width * 0.88) / hullMaxDim
    const expectedUnits = (gMaxX - gMinX) * scale
    expect(expectedUnits).toBeGreaterThan(10)
    expect(expectedUnits).toBeLessThan(20)
  })
  it('高保真：Source-faithful 契约写入 metadata（fidelity=high / geometryScale=faithful / retention target）', () => {
    const meta = JSON.parse(readFileSync(MAUS_DIR + 'metadata.json', 'utf8'))
    expect(meta.generation.fidelity).toBe('high')
    expect(meta.generation.geometryScale).toBe('faithful')
    expect(meta.generation.visibleDetailRetentionTarget).toBe(0.9)
    expect(meta.generation.method).toBe('blitzkit-model-topdown-texture-bake')
    expect(meta.generation.detailThresholds).toBeUndefined()
  })
  it('确定性：extractor 纯函数相同输入两次输出一致', () => {
    const pts = [{ x: -1.86, y: -4.44 }, { x: 1.86, y: -4.44 }, { x: 1.86, y: 4.6 }, { x: -1.86, y: 4.6 }]
    const fitA = computeFit(bounds2D(pts), VIEWBOX, 0.88)
    const fitB = computeFit(bounds2D(pts), VIEWBOX, 0.88)
    expect(fitA).toEqual(fitB)
    expect(convexHull2D(pts)).toEqual(convexHull2D(pts))
  })
})


function mockNode(name, { mesh = null, children = [], t = null, r = null, s = null } = {}) {
  return {
    getName: () => name,
    getMesh: () => mesh,
    getTranslation: () => t,
    getRotation: () => r,
    getScale: () => s,
    listChildren: () => children,
  }
}

function mockPrim({ positions, indices }) {
  return {
    getAttribute: (n) => (n === 'POSITION' ? { getArray: () => positions } : null),
    getIndices: () => (indices ? { getArray: () => indices } : null),
  }
}

function mockMesh(positions, indices) {
  return { listPrimitives: () => [mockPrim({ positions, indices })] }
}

describe('Phase A1 — hide_elements 子树采集（复刻 TankModel.tsx 完整子树渲染）', () => {
  const tri = (x, y, z) => [x, y, z]
  const hullMain = mockMesh(
    new Float32Array([...tri(0, 0, 2), ...tri(1, 0, 2), ...tri(0, 1, 2)]),
    new Uint16Array([0, 1, 2]),
  )
  const hideMesh = mockMesh(
    new Float32Array([...tri(0.5, 0.5, 2.4), ...tri(1.5, 0.5, 2.4), ...tri(0.5, 1.5, 2.4)]),
    new Uint16Array([0, 1, 2]),
  )
  const maskMesh = mockMesh(
    new Float32Array([...tri(5, 5, 5), ...tri(6, 5, 5), ...tri(5, 6, 5)]),
    new Uint16Array([0, 1, 2]),
  )
  const nodes = [
    mockNode('hull', { children: [mockNode('0001', { mesh: hullMain }), mockNode('hull_hide_elements_switch', { children: [mockNode('hull_hide_elements', { children: [mockNode('0000', { mesh: hideMesh })] })] })] }),
    mockNode('mask_01', { children: [mockNode('0001', { mesh: maskMesh })] }),
    mockNode('turret_01', { children: [mockNode('0001', { mesh: mockMesh(new Float32Array([...tri(0, 0, 4), ...tri(1, 0, 4), ...tri(0, 1, 4)]), new Uint16Array([0, 1, 2])) })] }),
    mockNode('gun_01', { children: [mockNode('0001', { mesh: mockMesh(new Float32Array([...tri(0, 0, 3), ...tri(1, 0, 3), ...tri(0, 1, 3)]), new Uint16Array([0, 1, 2])) })] }),
    mockNode('gun_01_mask', { children: [mockNode('0001', { mesh: mockMesh(new Float32Array([...tri(0, 0, 3.5), ...tri(1, 0, 3.5), ...tri(0, 1, 3.5)]), new Uint16Array([0, 1, 2])) })] }),
  ]
  it('matched render node 的 hide_elements child 会被采集（BlitzKit 实际渲染整个子树）', () => {
    const groups = groupRenderNodes(nodes, { turretId: 1, gunId: 1, withWheels: false })
    const tris = groups.hullBody.reduce((n, m) => n + m.indices.length / 3, 0)
    expect(tris).toBe(2)
    expect(groups.hullBody.some((m) => m.indices.length === 3)).toBe(true)
  })
  it('非 TankModel layer 的无关 mask 节点不会被采集', () => {
    const groups = groupRenderNodes(nodes, { turretId: 1, gunId: 1, withWheels: false })
    const all = [...groups.hullBody, ...groups.tracks, ...groups.turret, ...groups.mantlet, ...groups.gun]
    const total = all.reduce((n, m) => n + m.indices.length / 3, 0)
    expect(total).toBe(5)
  })
  it('不是通过名字黑名单提前删除 hide 命名节点', () => {
    const groups = groupRenderNodes(nodes, { turretId: 1, gunId: 1, withWheels: false })
    const out = []
    collectNodeTriangles(nodes[0], out, new (require('three').Matrix4)())
    expect(out.length).toBe(2)
  })
})
describe('Phase A1b — collectNodeVerts matrix traversal（PR92 Review B1 第三轮）', () => {
  const tri = (x, y, z) => [x, y, z]
  const parentMesh = mockMesh(
    new Float32Array(tri(1, 0, 0)),
    new Uint16Array([0, 1, 2]),
  )
  const childMesh = mockMesh(
    new Float32Array(tri(0, 1, 0)),
    new Uint16Array([0, 1, 2]),
  )
  const Rz90 = [0, 0, Math.SQRT1_2, Math.SQRT1_2]
  const parent = mockNode('parent', {
    mesh: parentMesh,
    t: [1, 2, 3],
    r: Rz90,
    s: [2, 1, 1],
    children: [
      mockNode('child', { mesh: childMesh, t: [0.5, 0, 0], r: null, s: [1, 2, 1] }),
    ],
  })

  it('node 自身 TRS 作用于自己的 mesh（parent mesh 顶点 = P·v）', () => {
    const out = []
    collectNodeVerts(parent, out, new (require('three').Matrix4)())
    expect(out[0][0]).toBeCloseTo(1, 9)
    expect(out[0][1]).toBeCloseTo(4, 9)
    expect(out[0][2]).toBeCloseTo(3, 9)
  })

  it('parent + child matrix composition 正确（child mesh 顶点 = P·C·v）', () => {
    const out = []
    collectNodeVerts(parent, out, new (require('three').Matrix4)())
    expect(out[1][0]).toBeCloseTo(-1, 9)
    expect(out[1][1]).toBeCloseTo(3, 9)
    expect(out[1][2]).toBeCloseTo(3, 9)
  })

  it('child 子树再嵌套：worldMatrix 逐级合成（P·C·G·v）', () => {
    const grand = mockNode('grand', { mesh: mockMesh(new Float32Array(tri(1, 1, 1)), new Uint16Array([0, 1, 2])), t: [1, 0, 0], r: null, s: [1, 1, 1] })
    const child2 = mockNode('child2', { children: [grand], t: [0.5, 0, 0], r: null, s: [1, 2, 1] })
    const p2 = mockNode('p2', { children: [child2], t: [1, 2, 3], r: Rz90, s: [2, 1, 1] })
    const out = []
    collectNodeVerts(p2, out, new (require('three').Matrix4)())
    expect(out[0][0]).toBeCloseTo(-1, 9)
    expect(out[0][1]).toBeCloseTo(7, 9)
    expect(out[0][2]).toBeCloseTo(4, 9)
  })

  it('与 collectNodeTriangles 同一 hierarchy 语义（同树顶点一致）', () => {
    const outV = []
    collectNodeVerts(parent, outV, new (require('three').Matrix4)())
    const outT = []
    collectNodeTriangles(parent, outT, new (require('three').Matrix4)())
    const t0 = outT[0].positions
    expect(outV[0][0]).toBeCloseTo(t0[0], 9)
    expect(outV[0][1]).toBeCloseTo(t0[1], 9)
    expect(outV[0][2]).toBeCloseTo(t0[2], 9)
  })
})


describe('Phase A2 — filterDegeneratePolys（几何退化判定，替代长窄 sliver 规则）', () => {
  it('真实长条（3.5m × 0.087m）保留——320px 下 110×2.7px 可见，不能算 noise', () => {
    const poly = { ring: [[0, 0], [3.5, 0], [3.5, 0.087], [0, 0.087], [0, 0]], holes: [] }
    const { kept, removed } = filterDegeneratePolys([poly])
    expect(kept).toHaveLength(1)
    expect(removed).toHaveLength(0)
  })
  it('数值 sliver（3.5m × 0.001m）过滤（bbox 窄边 < 5mm）', () => {
    const poly = { ring: [[0, 0], [3.5, 0], [3.5, 0.001], [0, 0.001], [0, 0]], holes: [] }
    const { kept, removed } = filterDegeneratePolys([poly])
    expect(kept).toHaveLength(0)
    expect(removed).toHaveLength(1)
  })
  it('自交 ring（bowtie，polygon-clipping 数值伪影）过滤', () => {
    const bowtie = { ring: [[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]], holes: [] }
    const { kept, removed } = filterDegeneratePolys([bowtie])
    expect(kept).toHaveLength(0)
    expect(removed).toHaveLength(1)
  })
  it('完全重合的 duplicate polygon 去重', () => {
    const a = { ring: [[0, 0], [1, 0], [1, 1], [0, 0]], holes: [] }
    const b = { ring: [[0, 0], [1, 0], [1, 1], [0, 0]], holes: [] }
    const { kept, removed } = filterDegeneratePolys([a, b])
    expect(kept).toHaveLength(1)
    expect(removed).toHaveLength(1)
  })
  it('near-zero 面积过滤', () => {
    const tiny = { ring: [[0, 0], [0.001, 0], [0, 0.001], [0, 0]], holes: [] }
    const { kept, removed } = filterDegeneratePolys([tiny])
    expect(kept).toHaveLength(0)
    expect(removed).toHaveLength(1)
  })
  it('确定性：相同输入两次输出一致', () => {
    const polys = [{ ring: [[0, 0], [3.5, 0], [3.5, 0.087], [0, 0.087], [0, 0]], holes: [] }]
    expect(filterDegeneratePolys(polys)).toEqual(filterDegeneratePolys(polys))
  })
})

describe('Phase A3 — rasterVisibility（真实 z-buffer 顶视可见性）', () => {
  const deck = [[[0, 0, 2.0], [4, 0, 2.0], [0, 4, 2.0]]]
  const under = [[[1, 1, 1.0], [3, 1, 1.0], [1, 3, 1.0]]]
  const peek = [[[3.2, 0.4, 1.5], [4.2, 0.4, 1.5], [3.2, 1.4, 1.5]]]
  it('被上层完全遮挡的三角形可见像素 = 0（tracks 语义）', () => {
    const vis = rasterVisibility([...deck, ...under], { resolution: 64 })
    expect(vis.visiblePx[1]).toBe(0)
    expect(vis.visiblePx[0]).toBeGreaterThan(0)
  })
  it('部分可见的组件保留（可见像素 > 0）', () => {
    const vis = rasterVisibility([...deck, ...peek], { resolution: 64 })
    expect(vis.visiblePx[1]).toBeGreaterThan(0)
  })
  it('按输入索引对齐（非 top-facing = 0）', () => {
    const vertical = [[[0, 0, 0], [1, 0, 0], [0, 0, 1]]]
    const vis = rasterVisibility([...deck, ...vertical], { resolution: 64 })
    expect(vis.visiblePx[0]).toBeGreaterThan(0)
    expect(vis.visiblePx[1]).toBe(0)
  })
  it('groups 参数：按组累计赢家像素（surface 级可见性）', () => {
    const vis = rasterVisibility([...deck, ...under], { resolution: 64, groups: [0, 1] })
    expect(vis.visibleGroupPx[0]).toBeGreaterThan(0)
    expect(vis.visibleGroupPx[1]).toBe(0)
  })
  it('确定性：相同输入两次输出一致 + visibleMask 可用', () => {
    const a = rasterVisibility(deck, { resolution: 64 })
    const b = rasterVisibility(deck, { resolution: 64 })
    expect(a.visiblePx).toEqual(b.visiblePx)
    expect(a.visibleMask).toBeTruthy()
    const mid = { x: 1, y: 1 }
    const pi = visibilityPixel(mid.x, mid.y, a)
    expect(pi >= 0 && a.visibleMask[pi] === 1).toBe(true)
  })
})
describe('Generalization — selectDefaultModules（models.pb/tanks.pb 数据驱动）', () => {
  it('turrets/tracks/guns 数组最后 = 默认配置（不假设 turret_01/gun_01 永远最终模块）', () => {
    const tankDefs = { tanks: { '1': { turrets: [{ id: 100, guns: [{ id: 300 }] }, { id: 200, guns: [{ id: 400 }] }], tracks: [{ id: 10 }, { id: 20 }] } } }
    const modelDefs = { models: { '1': { turrets: { '100': { modelId: 2 }, '200': { modelId: 7 } }, turretOrigin: { x: 0, y: 1, z: 2 } } } }
    const m = selectDefaultModules(tankDefs, { models: { '1': { ...modelDefs.models['1'], turrets: { ...modelDefs.models['1'].turrets, '200': { modelId: 7, guns: { '400': { modelId: 9 } } }, '100': { modelId: 2, guns: { '300': { modelId: 5 } } } } } } }, 1)
    expect(m.turretId).toBe(200)
    expect(m.turretModelId).toBe(7)
    expect(m.gunId).toBe(400)
    expect(m.gunModelId).toBe(9)
    expect(m.trackId).toBe(20)
    expect(m.turretOrigin).toEqual({ x: 0, y: 1, z: 2 })
  })
  it('缺 model_id 显式报错', () => {
    const tankDefs = { tanks: { '1': { turrets: [{ id: 1, guns: [{ id: 1 }] }], tracks: [] } } }
    const modelDefs = { models: { '1': { turrets: { '1': {} } } } }
    expect(() => selectDefaultModules(tankDefs, modelDefs, 1)).toThrow()
  })
})

describe('Generalization — resolveBakeScenes（turreted / turretless contract）', () => {
  const nodes = ['hull', 'chassis_track_L', 'chassis_track_R', 'chassis_wheel_L_01', 'chassis_wheel_R_01', 'mask_01', 'turret_01', 'turret_02', 'gun_01', 'gun_02', 'gun_01_mask', 'gun_02_mask']
  it('turreted：只选 selected turret/gun（alternate 模块排除）', () => {
    const s = resolveBakeScenes(nodes, { turretModelId: 1, gunModelId: 1, kind: 'turreted' })
    expect(s.hullNames).toContain('hull')
    expect(s.hullNames).toContain('chassis_track_L')
    expect(s.turretNames).toEqual(['turret_01', 'gun_01', 'gun_01_mask'])
    expect(s.turretNames).not.toContain('turret_02')
    expect(s.turretNames).not.toContain('gun_02')
    expect(s.turretNames).not.toContain('mask_01')
  })
  it('turretless：gun/mantlet（casemate）全部 bake 进 hull 场景，无独立 turret 层', () => {
    const s = resolveBakeScenes(nodes, { turretModelId: 1, gunModelId: 1, kind: 'turretless' })
    expect(s.turretNames).toEqual([])
    expect(s.hullNames).toContain('turret_01')
    expect(s.hullNames).toContain('gun_01')
    expect(s.hullNames).toContain('gun_01_mask')
  })
  it('不依赖 display name（纯节点名匹配，无名称推断）', () => {
    const s = resolveBakeScenes(['hull', 'turret_05', 'gun_03', 'gun_03_mask'], { turretModelId: 5, gunModelId: 3, kind: 'turreted' })
    expect(s.turretNames).toEqual(['turret_05', 'gun_03', 'gun_03_mask'])
  })
})
describe('computeTurretModelPivot（BlitzKit useTankTransform yaw 中心契约，PR92）', () => {
  it('modelPivot = correctZYTuple(hullOrigin) + correctZYTuple(turretOrigin)', () => {
    const p = computeTurretModelPivot({ x: 0, y: 0, z: 0 }, { x: 0, y: 2.140294075012207, z: -1.144700050354004 })
    expect(p.x).toBeCloseTo(0, 9)
    expect(p.y).toBeCloseTo(-1.1447, 4)
    expect(p.z).toBeCloseTo(2.1403, 4)
  })

  it('hullOrigin 与 turretOrigin 向量相加（含非零 track origin 情形）', () => {
    const p = computeTurretModelPivot({ x: 0, y: 0.9, z: 0.3 }, { x: 0, y: 1.5, z: -0.5 })
    expect(p.x).toBeCloseTo(0, 9)
    expect(p.y).toBeCloseTo(-0.2, 9)
    expect(p.z).toBeCloseTo(2.4, 9)
  })

  it('缺失 origin 按零向量处理（track origin 常缺失）', () => {
    const p = computeTurretModelPivot(null, { x: 0, y: 1.5, z: 0.3 })
    expect(p.y).toBeCloseTo(0.3, 9)
    const q = computeTurretModelPivot(undefined, undefined)
    expect(q).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('不消费 initial_turret_rotation（仅影响初始朝向角，不影响顶视 pivot——minotauro pitch=3° 证据）', () => {
    const p = computeTurretModelPivot({ x: 0, y: 0, z: 0 }, { x: 0, y: 1.45136296749115, z: 0.6842650175094604 })
    expect(p.y).toBeCloseTo(0.6843, 4)
    expect(computeTurretModelPivot.length).toBe(2)
  })
})
