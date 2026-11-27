import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { VIEWBOX } from './types.js'
import {
  bounds2D,
  buildMetadata,
  classifyDetail,
  clusterEdges,
  computeFit,
  convexHull2D,
  correctZYTuple,
  extractMajorEdges,
  extractTopSurfaces,
  hullToPath,
  projectTriangles,
  silhouetteToSvgPaths,
  simplifyRing,
  toSvg,
  trianglesFromGeometry,
  unionTriangles,
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
describe('correctZYTuple（引擎坐标 → 模型坐标）', () => {
  it('DAVA (x, y高, z长) → 模型 (x, z, y)', () => {
    const out = correctZYTuple({ x: 0, y: 2.140294075012207, z: -1.144700050354004 })
    expect(out.x).toBeCloseTo(0, 9)
    expect(out.y).toBeCloseTo(-1.1447, 4)
    expect(out.z).toBeCloseTo(2.1403, 4)
  })
  it('非零 turretOrigin 案例（炮塔座圈在车体前部）', () => {
    const out = correctZYTuple({ x: 0.5, y: 2.0, z: -3.0 })
    expect(out).toEqual({ x: 0.5, y: -3, z: 2 })
  })
})

describe('convexHull2D / bounds2D（silhouette 基础）', () => {
  it('矩形点集凸包 = 4 顶点', () => {
    const pts = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 }, { x: 0, y: 3 }, { x: 1, y: 1 }]
    const h = convexHull2D(pts)
    expect(h.length).toBe(4)
    expect(h.some((p) => p.x === 0 && p.y === 0)).toBe(true)
    expect(h.some((p) => p.x === 2 && p.y === 3)).toBe(true)
  })
  it('确定性：相同输入两次输出一致', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: Math.sin(i) * 3, y: Math.cos(i * 1.7) * 2 }))
    expect(convexHull2D(pts)).toEqual(convexHull2D(pts))
  })
  it('bounds2D 正确', () => {
    const b = bounds2D([{ x: -1, y: 2 }, { x: 3, y: -4 }, { x: 0, y: 0 }])
    expect(b).toEqual({ minX: -1, minY: -4, maxX: 3, maxY: 2 })
  })
})

describe('computeFit / toSvg / hullToPath（统一 320×320 fit）', () => {
  const mausBounds = { minX: -1.86006, minY: -4.43796, maxX: 1.86006, maxY: 4.59554 }
  it('fit 保持长宽比且居中（scale 由几何决定）', () => {
    const fit = computeFit(mausBounds, VIEWBOX, 0.88)
    expect(fit.scale).toBeCloseTo(31.17, 2)
    expect(fit.tx).toBeCloseTo(VIEWBOX.width / 2, 6)
  })
  it('车头（+y）朝 SVG 12 点', () => {
    const fit = computeFit(mausBounds, VIEWBOX, 0.88)
    const nose = toSvg({ x: 0, y: 4.59554 }, fit)
    const tail = toSvg({ x: 0, y: -4.43796 }, fit)
    expect(nose.y).toBeLessThan(tail.y)
  })
  it('hullToPath 输出闭合 path', () => {
    const fit = computeFit(mausBounds, VIEWBOX, 0.88)
    const h = convexHull2D([{ x: -1, y: -2 }, { x: 1, y: -2 }, { x: 1, y: 2 }, { x: -1, y: 2 }])
    const d = hullToPath(h, fit)
    expect(d).toMatch(/^M[0-9.]+ [0-9.]+ /)
    expect(d.endsWith(' Z')).toBe(true)
  })
  it('fit bounds 无效（零面积）抛错', () => {
    expect(() => computeFit({ minX: 1, minY: 1, maxX: 1, maxY: 1 }, VIEWBOX)).toThrow()
  })
})

describe('buildMetadata（source 契约：provider/tankId/modelGlb）', () => {
  it('输出 source.provider=blitzkit + generation.method', () => {
    const meta = buildMetadata({
      modelKey: 'maus', kind: 'turreted', tankId: 6929,
      modelGlbUrl: 'https://api.blitzkit.app/tanks/6929/model.glb',
      modelsPbUrl: 'https://api.blitzkit.app/definitions/models.pb',
      turretPivot: { x: 160, y: 193.23 },
      hullBounds: { min: [-1.86, -4.44], max: [1.86, 4.6] },
      turretBounds: null, gunBounds: null,
      viewBox: VIEWBOX,
    })
    expect(meta.source.provider).toBe('blitzkit')
    expect(meta.source.tankId).toBe(6929)
    expect(meta.generation.method).toBe('blitzkit-model-topdown-extraction')
    expect(meta.turretPivot.x).toBe(160)
  })
})

describe('Blocker 1 — concave silhouette（projected triangle union）', () => {
  const L_SHAPE_TRIS = [
    [[0, 0], [4, 0], [4, 1]],
    [[0, 0], [4, 1], [0, 1]],
    [[0, 0], [1, 0], [1, 3]],
    [[0, 0], [1, 3], [0, 3]],
  ]
  it('L 形凹轮廓不被 convex hull 填平（union ≠ hull）', () => {
    const union = unionTriangles(L_SHAPE_TRIS)
    expect(union.length).toBe(1)
    const ring = union[0].ring
    const hull = convexHull2D(ring.map(([x, y]) => ({ x, y })))
    expect(hull.length).toBe(5)
    expect(ring.length).toBeGreaterThan(5)
    expect(ring.some((p) => Math.abs(p[0] - 1) < 1e-9 && Math.abs(p[1] - 1) < 1e-9)).toBe(true)
  })
  it('projectTriangles 过滤退化（垂直面投影为线）', () => {
    const tris = [
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[0, 0, 0], [1, 0, 0], [0.5, 0, 5]], // 与投影面垂直 → 投影退化
    ]
    const out = projectTriangles(tris)
    expect(out.length).toBe(1)
  })
  it('polygon union 确定性：相同输入两次输出一致', () => {
    expect(unionTriangles(L_SHAPE_TRIS)).toEqual(unionTriangles(L_SHAPE_TRIS))
  })
  it('silhouetteToSvgPaths 输出 evenodd path（含洞支持）', () => {
    const fit = computeFit({ minX: -1, minY: -1, maxX: 4, maxY: 3 }, VIEWBOX, 0.8)
    const paths = silhouetteToSvgPaths([{ ring: [[0, 0], [4, 0], [4, 3], [0, 3]], holes: [[[1, 1], [2, 1], [2, 2], [1, 2]]] }], fit, '#123456')
    expect(paths.length).toBe(1)
    expect(paths[0].fillRule).toBe('evenodd')
    expect(paths[0].d).toMatch(/M[0-9.]+ [0-9.]+ /)
    expect(paths[0].d.split('M').length - 1).toBe(2)
  })
})

describe('Blocker 1 — trianglesFromGeometry（POSITION + INDEX 解析）', () => {
  it('索引网格按 indices 构建三角形', () => {
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]
    const indices = [0, 1, 2, 1, 3, 2]
    const tris = trianglesFromGeometry({ positions, indices })
    expect(tris.length).toBe(2)
    expect(tris[0][0]).toEqual([0, 0, 0])
    expect(tris[1][1]).toEqual([1, 1, 0])
  })
  it('无索引网格按连续 3 顶点', () => {
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0]
    const tris = trianglesFromGeometry({ positions, indices: null })
    expect(tris.length).toBe(1)
  })
})

describe('Blocker 2 — transform / hide_elements（collectTriangles 语义）', () => {
  it('simplifyRing 合并共线点且保持形状', () => {
    const ring = [[0, 0], [1, 0], [2, 0], [2, 1], [0, 1]]
    const simplified = simplifyRing(ring)
    expect(simplified.length).toBeLessThan(ring.length)
    expect(simplified.some((p) => p[0] === 2 && p[1] === 0)).toBe(true)
    expect(simplified.some((p) => p[0] === 0 && p[1] === 1)).toBe(true)
  })
  it('simplifyRing 去重相邻/闭合重复点且不丢真实角点（polygon-clipping 退化修复）', () => {
    const ring = [
      [-1.7521, 4.511], [-0.3325, 4.0719], [-0.274, 2.5997], [1.7158, 3.4383], [1.7521, 4.511],
      [-1.7521, 4.511],
      [-1.7521, 4.511], // 相邻重复
    ]
    const simplified = simplifyRing(ring)
    expect(simplified.some((p) => Math.abs(p[0] + 1.7521) < 1e-6 && Math.abs(p[1] - 4.511) < 1e-6)).toBe(true)
    expect(simplified.some((p) => Math.abs(p[0] - 1.7521) < 1e-6 && Math.abs(p[1] - 4.511) < 1e-6)).toBe(true)
    for (let i = 0; i < simplified.length; i++) {
      const a = simplified[i]
      const b = simplified[(i + 1) % simplified.length]
      expect(Math.abs(a[0] - b[0]) > 1e-9 || Math.abs(a[1] - b[1]) > 1e-9).toBe(true)
    }
  })
  it('simplifyRing 不缩小 polygon（bbox 保持不变）', () => {
    const ring = [
      [-1.7521, 4.511], [-0.3325, 4.0719], [-0.274, 2.5997], [-0.2699, 2.7611],
      [0.3335, 3.8659], [1.7158, 3.4383], [1.7521, 4.511], [-1.7521, 4.511],
    ]
    const bbox = (pts) => {
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9
      for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
      return { minX, minY, maxX, maxY }
    }
    const a = bbox(ring)
    const b = bbox(simplifyRing(ring))
    expect(b.maxX - b.minX).toBeCloseTo(a.maxX - a.minX, 6)
    expect(b.maxY - b.minY).toBeCloseTo(a.maxY - a.minY, 6)
  })
  it('Maus 资产：hide_elements 纳入后 turretBounds 保持（hide 在炮塔内，不改变轮廓；mantlet 独立）', () => {
    const meta = JSON.parse(readFileSync(MAUS_DIR + 'metadata.json', 'utf8'))
    expect(meta.generation.turretBounds.max[1]).toBeCloseTo(1.0, 0)
    const hull = readFileSync(MAUS_DIR + 'hull.webp', 'latin1')
    expect(hull.slice(0, 4)).toBe('RIFF')
  })
})

describe('Blocker 4 — generation method 命名', () => {
  it('metadata.generation.method = blitzkit-model-topdown-texture-bake（正式契约）', () => {
    const meta = JSON.parse(readFileSync(MAUS_DIR + 'metadata.json', 'utf8'))
    expect(meta.generation.method).toBe('blitzkit-model-topdown-texture-bake')
    expect(meta.generation.method).not.toMatch(/collision/)
  })
})

describe('Layer B — top-facing surface extraction', () => {
  it('水平/垂直/倾斜三角形的 top-facing 判定（normal.z 阈值）', () => {
    const horizontal = [[[0,0,0],[1,0,0],[0,1,0]]]
    const vertical = [[[0,0,0],[1,0,0],[0,0,1]]]
    const slope = [[[0,0,0],[1,0,1],[0,1,1]]]
    expect(extractTopSurfaces(horizontal, { topFacingCos: 0.35, zTolerance: 0.5, minAreaM2: 0.01 }).length).toBe(1)
    expect(extractTopSurfaces(vertical, { topFacingCos: 0.35, zTolerance: 0.5, minAreaM2: 0.01 }).length).toBe(0)
    expect(extractTopSurfaces(slope, { topFacingCos: 0.35, zTolerance: 0.5, minAreaM2: 0.01 }).length).toBe(1)
  })
  it('高度层聚类：不同高度平面分离，连续曲面合并', () => {
    const tris = [
      [[0,0,0],[2,0,0],[0,2,0]], [[0,0,0],[2,0,0],[2,2,0]], [[0,2,0],[2,2,0],[2,0,0]],
      [[0,0,1],[2,0,1],[0,2,1]], [[0,0,1],[2,0,1],[2,2,1]], [[0,2,1],[2,2,1],[2,0,1]],
    ]
    const s = extractTopSurfaces(tris, { topFacingCos: 0.35, zTolerance: 0.5, minAreaM2: 0.1 })
    expect(s.length).toBe(2)
  })
  it('小区域（minAreaM2）被过滤，大区域保留', () => {
    const big = [[[0,0,0],[4,0,0],[0,4,0]], [[0,0,0],[4,0,0],[4,4,0]], [[0,4,0],[4,4,0],[4,0,0]]]
    const small = [[[0,0,0],[0.2,0,0],[0,0.2,0]]]
    const s = extractTopSurfaces([...big, ...small], { topFacingCos: 0.35, zTolerance: 0.5, minAreaM2: 0.5 })
    expect(s.length).toBe(1)
    expect(s[0].areaM2).toBeGreaterThan(10)
  })
  it('高度层内碎片 polygon 单独过滤（防碎块混入）', () => {
    const tris = [
      [[0,0,0],[4,0,0],[0,4,0]], [[0,0,0],[4,0,0],[4,4,0]], [[0,4,0],[4,4,0],[4,0,0]],
      [[10,10,0],[10.3,10,0],[10,10.3,0]],
    ]
    const s = extractTopSurfaces(tris, { topFacingCos: 0.35, zTolerance: 0.5, minAreaM2: 0.5 })
    expect(s.length).toBe(1)
    expect(s[0].polys.length).toBe(1)
  })
})

describe('Layer B — major edge extraction', () => {
  it('平台边缘边（顶面 + 垂直壁邻居）→ 结构边；同高度共面 → 无边', () => {
    const flat = [
      [[0,0,0],[2,0,0],[0,2,0]], [[0,0,0],[2,0,0],[2,2,0]], [[0,2,0],[2,0,0],[2,2,0]],
    ]
    expect(extractMajorEdges(flat, { topFacingCos: 0.35, heightDeltaM: 0.15, normalDeltaCos: 0.92, minEdgeLenM: 0.1 }).length).toBe(0)
    const platform = [
      [[0,0,0],[2,0,0],[0,2,0]], [[0,0,0],[2,0,0],[2,2,0]], [[0,2,0],[2,0,0],[2,2,0]],
      [[0,0,-1],[2,0,-1],[2,0,0]], [[0,0,-1],[2,0,0],[0,0,0]], // 垂直壁（z 向下）
    ]
    const e = extractMajorEdges(platform, { topFacingCos: 0.35, heightDeltaM: 0.15, normalDeltaCos: 0.92, minEdgeLenM: 0.1 })
    expect(e.length).toBe(1)
    expect(e[0].reason).toBe('surface-edge')
  })
  it('共享边去重（一条边只输出一次）', () => {
    const tris = [
      [[0,0,0],[2,0,0],[0,2,0]], [[0,0,0],[2,0,0],[2,2,0]], [[0,2,0],[2,0,0],[2,2,0]],
      [[0,0,-1],[2,0,-1],[2,0,0]], [[0,0,-1],[2,0,0],[0,0,0]],
      [[0,0,1],[2,0,1],[2,0,0]], [[0,0,1],[2,0,0],[0,0,0]],
    ]
    const e = extractMajorEdges(tris, { topFacingCos: 0.35, heightDeltaM: 0.15, normalDeltaCos: 0.92, minEdgeLenM: 0.1 })
    expect(e.length).toBe(1)
  })
  it('短边（minEdgeLenM）被过滤', () => {
    const stepped = [
      [[0,0,0],[0.3,0,0],[0,0.3,0]],
      [[0,0,0.5],[0.3,0,0.5],[0,0.3,0.5]],
    ]
    const e = extractMajorEdges(stepped, { topFacingCos: 0.35, heightDeltaM: 0.15, normalDeltaCos: 0.92, minEdgeLenM: 1.0 })
    expect(e.length).toBe(0)
  })
  it('高度差驱动：法线突变但高度差小（格栅凹槽）→ 不输出', () => {
    const gutter = [
      [[0,0,0],[2,0,0],[0,2,0]], [[0,0,0],[2,0,0],[2,2,0]], [[0,2,0],[2,0,0],[2,2,0]],
      [[0,0,0.05],[2,0,0.05],[0,2,0.05]], [[0,0,0.05],[2,0,0.05],[2,2,0.05]], [[0,2,0.05],[2,0,0.05],[2,2,0.05]],
    ]
    const e = extractMajorEdges(gutter, { topFacingCos: 0.35, heightDeltaM: 0.15, normalDeltaCos: 0.92, minEdgeLenM: 0.1 })
    expect(e.length).toBe(0)
  })
  it('确定性：相同输入两次输出一致', () => {
    const stepped = [
      [[0,0,0],[2,0,0],[0,2,0]], [[0,0,0.5],[2,0,0.5],[0,2,0.5]],
    ]
    const opts = { topFacingCos: 0.35, heightDeltaM: 0.15, normalDeltaCos: 0.92, minEdgeLenM: 0.1 }
    expect(extractMajorEdges(stepped, opts)).toEqual(extractMajorEdges(stepped, opts))
  })
  it('clusterEdges：近乎平行且位置重合的边聚类为一条（斜切台阶交叉线去重）', () => {
    const edges = [
      { p1: [1.86, -0.13], p2: [-1.86, -0.13], reason: 'surface-edge' },
      { p1: [-1.75, 3.943], p2: [1.8, 3.855], reason: 'height' },
      { p1: [-1.75, 3.855], p2: [1.8, 3.767], reason: 'height' },
      { p1: [1.75, 3.943], p2: [-1.8, 3.855], reason: 'height' },
      { p1: [1.75, 3.855], p2: [-1.8, 3.767], reason: 'height' },
    ]
    const clustered = clusterEdges(edges, { angleDeg: 5, maxDistM: 0.5 })
    expect(clustered.length).toBe(2)
    expect(clustered.some((e) => Math.abs(e.p1[0] - 1.86) < 1e-9)).toBe(true)
  })
  it('clusterEdges：真实平行台阶（距离 > maxDistM）保持独立', () => {
    const edges = [
      { p1: [1.53, 2.5], p2: [1.53, -2.5], reason: 'surface-edge' },
      { p1: [1.21, 2.5], p2: [1.21, -2.5], reason: 'surface-edge' },
      { p1: [0.88, 2.5], p2: [0.88, -2.5], reason: 'surface-edge' },
    ]
    const clustered = clusterEdges(edges, { angleDeg: 5, maxDistM: 0.15 })
    expect(clustered.length).toBe(3)
  })
  it('高保真：同一平滑曲面内共享边（tessellation）不输出', () => {
    const flat = [
      [[0,0,0],[2,0,0],[0,2,0]], [[0,0,0],[2,0,0],[2,2,0]], [[0,2,0],[2,2,0],[2,0,0]],
      [[2,0,0],[4,0,0],[2,2,0]], [[2,0,0],[4,0,0],[4,2,0]], [[2,2,0],[4,2,0],[4,0,0]],
    ]
    const e = extractMajorEdges(flat, { topFacingCos: 0.35, heightDeltaM: 0.15, normalDeltaCos: 0.995, minEdgeLenM: 0.1 })
    expect(e.length).toBe(0)
  })
  it('高保真：真实 feature boundary（高度不连续）保留，无数量上限', () => {
    const stepped = [
      [[0,0,0],[4,0,0],[0,4,0]], [[4,0,0],[4,4,0],[0,4,0]],
      [[0,0,0.5],[4,0,0.5],[0,4,0.5]], [[4,0,0.5],[4,4,0.5],[0,4,0.5]],
      [[0,0,0],[0,4,0],[0,4,0.5]], [[0,0,0],[0,4,0.5],[0,0,0.5]],
    ]
    const e = extractMajorEdges(stepped, { topFacingCos: 0.35, heightDeltaM: 0.15, normalDeltaCos: 0.995, minEdgeLenM: 0.1 })
    expect(e.length).toBe(2)
    expect(e.every((x) => x.reason === 'surface-edge')).toBe(true)
  })
  it('高保真：surface-edge 需要显著壁高（> heightDeltaM）——低模斜面面片台阶壁不输出', () => {
    const lowWall = [
      [[0,0,0],[2,0,0],[0,2,0]], [[0,0,0],[2,0,0],[2,2,0]], [[0,2,0],[2,0,0],[2,2,0]],
      [[0,0,-0.05],[2,0,-0.05],[2,0,0]], [[0,0,-0.05],[2,0,0],[0,0,0]],
    ]
    expect(extractMajorEdges(lowWall, { topFacingCos: 0.35, heightDeltaM: 0.15, normalDeltaCos: 0.995, minEdgeLenM: 0.1 }).length).toBe(0)
    const tallWall = [
      [[0,0,0],[2,0,0],[0,2,0]], [[0,0,0],[2,0,0],[2,2,0]], [[0,2,0],[2,0,0],[2,2,0]],
      [[0,0,-0.3],[2,0,-0.3],[2,0,0]], [[0,0,-0.3],[2,0,0],[0,0,0]],
    ]
    const e = extractMajorEdges(tallWall, { topFacingCos: 0.35, heightDeltaM: 0.15, normalDeltaCos: 0.995, minEdgeLenM: 0.1 })
    expect(e.length).toBe(1)
    expect(e[0].reason).toBe('surface-edge')
  })
})

describe('Layer B — classifyDetail（high-fidelity detail 分级）', () => {
  it('silhouette/track/mantlet/gun 恒为 vehicle-primary', () => {
    expect(classifyDetail({ kind: 'silhouette' })).toBe('vehicle-primary')
    expect(classifyDetail({ kind: 'track' })).toBe('vehicle-primary')
    expect(classifyDetail({ kind: 'mantlet' })).toBe('vehicle-primary')
    expect(classifyDetail({ kind: 'gun' })).toBe('vehicle-primary')
  })
  it('surface 按面积分级（primary ≥ 0.5 m²、secondary 0.1-0.5、micro < 0.1）', () => {
    expect(classifyDetail({ kind: 'surface', areaM2: 26.8 })).toBe('vehicle-primary')
    expect(classifyDetail({ kind: 'surface', areaM2: 0.3 })).toBe('vehicle-secondary')
    expect(classifyDetail({ kind: 'surface', areaM2: 0.05 })).toBe('vehicle-micro-detail')
  })
  it('bump 按面积分级（secondary ≥ 0.1、micro < 0.1——真实小 hatch 归 micro 而非删除）', () => {
    expect(classifyDetail({ kind: 'bump', areaM2: 0.21 })).toBe('vehicle-secondary')
    expect(classifyDetail({ kind: 'bump', areaM2: 0.052 })).toBe('vehicle-micro-detail')
  })
  it('edge 按长度分级（secondary ≥ 3m、micro < 3m）', () => {
    expect(classifyDetail({ kind: 'edge', lengthM: 7.1 })).toBe('vehicle-secondary')
    expect(classifyDetail({ kind: 'edge', lengthM: 1.2 })).toBe('vehicle-micro-detail')
  })
})

describe('Layer B — Maus 生成资产细节（Layer 正确性）', () => {
  it('正式资产：hull.webp 为 WebP 二进制（texture-bake 契约，非 SVG）', () => {
    const buf = readFileSync(MAUS_DIR + 'hull.webp', 'latin1')
    expect(buf.slice(0, 4)).toBe('RIFF')
    expect(buf.slice(8, 12)).toBe('WEBP')
    expect(buf.length).toBeGreaterThan(1000)
  })
  it('turreted 正式资产：turret.webp 存在（turret + mantlet + gun 刚性层）', () => {
    const buf = readFileSync(MAUS_DIR + 'turret.webp', 'latin1')
    expect(buf.slice(0, 4)).toBe('RIFF')
    expect(buf.slice(8, 12)).toBe('WEBP')
  })
  it('turretPivot 稳定（0/90/180/270 旋转不动点）且 metadata method = texture-bake', () => {
    const meta = JSON.parse(readFileSync(MAUS_DIR + 'metadata.json', 'utf8'))
    expect(meta.generation.method).toBe('blitzkit-model-topdown-texture-bake')
    expect(meta.generation.hullPhysicalPixelSize).toEqual([640, 640])
    const pivot = meta.turretPivot
    for (const deg of [0, 90, 180, 270]) {
      const img = rotatePointAround({ point: pivot, origin: pivot, deg })
      expect(img.x).toBeCloseTo(pivot.x, 6)
      expect(img.y).toBeCloseTo(pivot.y, 6)
    }
  })
  it('同源同输出：再次生成（纯函数路径）结果一致', () => {
    const tris = [[[0,0,0],[1,0,0],[0,1,0]]]
    const a = extractTopSurfaces(tris, { topFacingCos: 0.35, zTolerance: 0.5, minAreaM2: 0.01 })
    const b = extractTopSurfaces(tris, { topFacingCos: 0.35, zTolerance: 0.5, minAreaM2: 0.01 })
    expect(a).toEqual(b)
  })
})
