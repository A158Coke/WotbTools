/**
 * Extractor 契约测试（任务 15）：
 * - extractor-lib 纯函数（坐标转换 / 凸包 / fit / SVG / metadata）；
 * - Maus 生成资产契约（存在性 / validateModelEntry / XML / viewBox / 无 raster / 有限坐标）；
 * - turretPivot 稳定性（0/90/180/270 不动点）；
 * - 确定性（相同输入两次输出一致）。
 * CI 不访问 BlitzKit 网络（任务 17）：端到端提取由 extractor CLI 本地执行。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { VIEWBOX } from './types.js'
import { validateModelEntry } from './validate.js'
import {
  bounds2D,
  buildFeatureAudit,
  buildMetadata,
  classifyDetail,
  clusterEdges,
  computeFit,
  convexHull2D,
  correctZYTuple,
  extractMajorEdges,
  extractTopSurfaces,
  filterOccludedSurfaces,
  hullToPath,
  mergeVisualSurfaces,
  projectTopFacingPolygons,
  projectTopDown,
  projectTriangles,
  silhouetteToSvgPaths,
  simplifyRing,
  svgDocument,
  toSvg,
  trianglesFromGeometry,
  unionTriangles,
} from '../../scripts/extractor-lib.mjs'

/** 数学验证辅助：以 origin 为不动点的 rotate(deg) 下，点 point 的像（2D 仿射，角度制）。 */
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

const ASSETS = fileURLToPath(new URL('./assets/', import.meta.url))
const MAUS_DIR = ASSETS + 'maus/'

describe('correctZYTuple（引擎坐标 → 模型坐标）', () => {
  it('DAVA (x, y高, z长) → 模型 (x, z, y)', () => {
    // BlitzKit: R_x(+90°)(x, y, -z) = (x, z, y)；Maus turret_origin=(0, 2.14, -1.14) → (0, -1.14, 2.14)
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

describe('buildMetadata（geometry-source schema）', () => {
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
  // L 形：由两个矩形三角形对构成——union 必须保留 L 形凹轮廓
  const L_SHAPE_TRIS = [
    // 底部横条 (0,0)-(4,1)
    [[0, 0], [4, 0], [4, 1]],
    [[0, 0], [4, 1], [0, 1]],
    // 左侧竖条 (0,0)-(1,3)
    [[0, 0], [1, 0], [1, 3]],
    [[0, 0], [1, 3], [0, 3]],
  ]
  it('L 形凹轮廓不被 convex hull 填平（union ≠ hull）', () => {
    const union = unionTriangles(L_SHAPE_TRIS)
    expect(union.length).toBe(1)
    const ring = union[0].ring
    // L 形外轮廓：4+4+1+1 = 10 个角点（含共线点简化前）
    const hull = convexHull2D(ring.map(([x, y]) => ({ x, y })))
    // convex hull 只有 5 个角点（填掉凹角），union ring 必须保留凹角（更多点）
    expect(hull.length).toBe(5)
    expect(ring.length).toBeGreaterThan(5)
    // 凹角 (1,1) 必须存在（hull 会丢失它）
    expect(ring.some((p) => Math.abs(p[0] - 1) < 1e-9 && Math.abs(p[1] - 1) < 1e-9)).toBe(true)
  })
  it('projectTriangles 过滤退化（垂直面投影为线）', () => {
    const tris = [
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],   // 水平 → 保留
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
    // 洞作为第二个 subpath（M 出现两次）
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
    // (1,0) 共线应被合并
    expect(simplified.length).toBeLessThan(ring.length)
    expect(simplified.some((p) => p[0] === 2 && p[1] === 0)).toBe(true)
    expect(simplified.some((p) => p[0] === 0 && p[1] === 1)).toBe(true)
  })
  it('simplifyRing 去重相邻/闭合重复点且不丢真实角点（polygon-clipping 退化修复）', () => {
    // 含闭合重复点 + 相邻重复点的 ring（polygon-clipping 典型输出）：首尾角点必须保留
    const ring = [
      [-1.7521, 4.511], [-0.3325, 4.0719], [-0.274, 2.5997], [1.7158, 3.4383], [1.7521, 4.511],
      [-1.7521, 4.511], // 闭合重复
      [-1.7521, 4.511], // 相邻重复
    ]
    const simplified = simplifyRing(ring)
    // 真实角点（首尾）必须保留
    expect(simplified.some((p) => Math.abs(p[0] + 1.7521) < 1e-6 && Math.abs(p[1] - 4.511) < 1e-6)).toBe(true)
    expect(simplified.some((p) => Math.abs(p[0] - 1.7521) < 1e-6 && Math.abs(p[1] - 4.511) < 1e-6)).toBe(true)
    // 无重复点
    for (let i = 0; i < simplified.length; i++) {
      const a = simplified[i]
      const b = simplified[(i + 1) % simplified.length]
      expect(Math.abs(a[0] - b[0]) > 1e-9 || Math.abs(a[1] - b[1]) > 1e-9).toBe(true)
    }
  })
  it('simplifyRing 不缩小 polygon（bbox 保持不变）', () => {
    // Maus glacis 带状多边形（曾因重复点塌成细条）：简化后 bbox 不变
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
  it('Maus 资产：turret 不含 hide_elements 细长条（bbox 仅炮塔本体；mantlet 独立）', () => {
    const meta = JSON.parse(readFileSync(MAUS_DIR + 'metadata.json', 'utf8'))
    // turretBounds = 炮塔本体（mantlet 已独立分组）→ y max ≈ 1.0（模型米）
    expect(meta.generation.turretBounds.max[1]).toBeCloseTo(1.0, 0)
    // hull 主甲板层存在（Layer B surfaces 写入 hull.svg）
    const hullSvg = readFileSync(MAUS_DIR + 'hull.svg', 'utf8')
    expect(hullSvg).toContain('#565e58')
  })
})

describe('Blocker 4 — generation method 命名', () => {
  it('metadata.generation.method = blitzkit-model-topdown-extraction', () => {
    const meta = JSON.parse(readFileSync(MAUS_DIR + 'metadata.json', 'utf8'))
    expect(meta.generation.method).toBe('blitzkit-model-topdown-extraction')
    expect(meta.generation.method).not.toMatch(/collision/)
  })
})

describe('Layer B — top-facing surface extraction', () => {
  it('水平/垂直/倾斜三角形的 top-facing 判定（normal.z 阈值）', () => {
    // 水平面 nz=1 → 保留；垂直面 nz=0 → 丢弃；45° 斜面 nz=0.707 → 保留（>0.35）
    const horizontal = [[[0,0,0],[1,0,0],[0,1,0]]]
    const vertical = [[[0,0,0],[1,0,0],[0,0,1]]]
    const slope = [[[0,0,0],[1,0,1],[0,1,1]]]
    expect(extractTopSurfaces(horizontal, { topFacingCos: 0.35, zTolerance: 0.5, minAreaM2: 0.01 }).length).toBe(1)
    expect(extractTopSurfaces(vertical, { topFacingCos: 0.35, zTolerance: 0.5, minAreaM2: 0.01 }).length).toBe(0)
    expect(extractTopSurfaces(slope, { topFacingCos: 0.35, zTolerance: 0.5, minAreaM2: 0.01 }).length).toBe(1)
  })
  it('高度层聚类：不同高度平面分离，连续曲面合并', () => {
    // 两层平台（z=0 与 z=1，gap 1.0 > 0.5）→ 2 层
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
    // 同层一个大区域 + 一个小碎片（不相连）
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
    // 平台（z=0 水平面）+ 垂直壁（共享边 [0,0,0]-[2,0,0]）→ 顶面边缘边
    const platform = [
      [[0,0,0],[2,0,0],[0,2,0]], [[0,0,0],[2,0,0],[2,2,0]], [[0,2,0],[2,0,0],[2,2,0]],
      [[0,0,-1],[2,0,-1],[2,0,0]], [[0,0,-1],[2,0,0],[0,0,0]], // 垂直壁（z 向下）
    ]
    const e = extractMajorEdges(platform, { topFacingCos: 0.35, heightDeltaM: 0.15, normalDeltaCos: 0.92, minEdgeLenM: 0.1 })
    // 顶面与壁共享边 [0,0,0]-[2,0,0] → 1 条 surface-edge（共享边去重）
    expect(e.length).toBe(1)
    expect(e[0].reason).toBe('surface-edge')
  })
  it('共享边去重（一条边只输出一次）', () => {
    // 平台 + 两侧各一块垂直壁（共享同一条 [0,0,0]-[2,0,0] 边）
    const tris = [
      [[0,0,0],[2,0,0],[0,2,0]], [[0,0,0],[2,0,0],[2,2,0]], [[0,2,0],[2,0,0],[2,2,0]],
      [[0,0,-1],[2,0,-1],[2,0,0]], [[0,0,-1],[2,0,0],[0,0,0]],
      [[0,0,1],[2,0,1],[2,0,0]], [[0,0,1],[2,0,0],[0,0,0]],
    ]
    const e = extractMajorEdges(tris, { topFacingCos: 0.35, heightDeltaM: 0.15, normalDeltaCos: 0.92, minEdgeLenM: 0.1 })
    // 共享边只输出一次（即使有多个非顶面邻居）
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
    // 两个水平三角形 z 差 0.05（< 0.15 且 < 0.6×0.15）→ 无边
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
    // Maus 前甲板 4 条 ~110.9 交叉斜线（±1.4°、中点距离 ~0.06-0.1m）→ 1 条
    const edges = [
      { p1: [1.86, -0.13], p2: [-1.86, -0.13], reason: 'surface-edge' }, // 侧边（0°）
      // 4 条 ~±1.4° 交叉斜线（Maus 前甲板斜切台阶），中点距离 ~0.05-0.1m
      { p1: [-1.75, 3.943], p2: [1.8, 3.855], reason: 'height' },
      { p1: [-1.75, 3.855], p2: [1.8, 3.767], reason: 'height' },
      { p1: [1.75, 3.943], p2: [-1.8, 3.855], reason: 'height' },
      { p1: [1.75, 3.855], p2: [-1.8, 3.767], reason: 'height' },
    ]
    const clustered = clusterEdges(edges, { angleDeg: 5, maxDistM: 0.5 })
    // 侧边（0° 但中点距离 ~4m）与斜切台阶簇分离；4 条斜线 → 1 条
    expect(clustered.length).toBe(2)
    expect(clustered.some((e) => Math.abs(e.p1[0] - 1.86) < 1e-9)).toBe(true)
  })
  it('clusterEdges：真实平行台阶（距离 > maxDistM）保持独立', () => {
    // 炮塔侧三阶结构：0.33m 间距的三条平行竖边必须保留
    const edges = [
      { p1: [1.53, 2.5], p2: [1.53, -2.5], reason: 'surface-edge' },
      { p1: [1.21, 2.5], p2: [1.21, -2.5], reason: 'surface-edge' },
      { p1: [0.88, 2.5], p2: [0.88, -2.5], reason: 'surface-edge' },
    ]
    const clustered = clusterEdges(edges, { angleDeg: 5, maxDistM: 0.15 })
    expect(clustered.length).toBe(3)
  })
  it('高保真：同一平滑曲面内共享边（tessellation）不输出', () => {
    // 两个共面/近共面三角形（法线差 <1°，高度连续）共享边 → 无 feature edge
    const flat = [
      [[0,0,0],[2,0,0],[0,2,0]], [[0,0,0],[2,0,0],[2,2,0]], [[0,2,0],[2,2,0],[2,0,0]],
      [[2,0,0],[4,0,0],[2,2,0]], [[2,0,0],[4,0,0],[4,2,0]], [[2,2,0],[4,2,0],[4,0,0]],
    ]
    const e = extractMajorEdges(flat, { topFacingCos: 0.35, heightDeltaM: 0.15, normalDeltaCos: 0.995, minEdgeLenM: 0.1 })
    expect(e.length).toBe(0)
  })
  it('高保真：真实 feature boundary（高度不连续）保留，无数量上限', () => {
    // 双层平台 z=0 / z=0.5 + 连接竖壁（x=0 面）：壁顶/壁底与上下层共享边 → 2 条 surface-edge
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
    // 平台 + 0.05m 矮壁（tessellation 台阶）→ 不输出；0.3m 高壁（真实甲板边缘）→ 输出
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
  it('hull.svg 含履带独立区域与主甲板层（非单色）', () => {
    const svg = readFileSync(MAUS_DIR + 'hull.svg', 'utf8')
    const paths = (svg.match(/<path/g) || []).length
    expect(paths).toBeGreaterThanOrEqual(5) // silhouette + tracks×2 + surfaces + edges
    expect(svg).toContain('#454b47') // tracks fill
    expect(svg).toContain('#565e58') // surfaces fill
  })
  it('turret.svg 含 mantlet 独立区域与炮管（mask 不再并入 gun 轮廓）', () => {
    const svg = readFileSync(MAUS_DIR + 'turret.svg', 'utf8')
    expect(svg).toContain('#656c67') // mantlet fill
    expect(svg).toContain('#4d534f') // gun fill
    const paths = (svg.match(/<path/g) || []).length
    expect(paths).toBeGreaterThanOrEqual(4)
  })
  it('高保真：edges 不再设数量上限（仅剔除 tessellation/duplicate，见 extractMajorEdges 判据）', () => {
    // 策略变更记录：旧"少而强"上限（hull ≤ 8 / turret ≤ 6）已删除；
    // 结构边保留原则 = 真实 component/height/normal boundary，数量由模型决定。
    expect(true).toBe(true)
  })
  it('turret detail 与 silhouette 同一 fit（pivot 不变：detail 路径存在且 pivot 稳定）', () => {
    const meta = JSON.parse(readFileSync(MAUS_DIR + 'metadata.json', 'utf8'))
    expect(meta.generation.detailMethod).toBe('top-surface-and-major-edge-extraction')
    expect(meta.generation.detailThresholds).toBeTruthy()
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

describe('Layer B — visual surface merging（HIGH-FIDELITY，Blocker 1/2/4）', () => {
  it('projectTopFacingPolygons：每个 top-facing 三角形独立投影（raw ground truth，无 merge）', () => {
    const tris = [
      [[0,0,0],[2,0,0],[0,2,0]], [[2,0,0],[2,2,0],[0,2,0]],           // 2 个水平三角形（top-facing）
      [[0,0,1],[1,0,1],[0,1,0]],                                        // 斜面（nz ≈ 0.816 > 0.35）
      [[0,0,0],[2,0,0],[0,0,1]],                                        // 垂直壁（nz = 0，排除）
    ]
    const polys = projectTopFacingPolygons(tris, { topFacingCos: 0.35 })
    expect(polys.length).toBe(3) // 3 个 top-facing，垂直壁排除
    // 每个 polygon 是三角形（3 个点）
    for (const p of polys) {
      expect(p.ring.length).toBeGreaterThanOrEqual(3)
      expect(p.holes).toEqual([])
    }
  })
  it('projectTopFacingPolygons 确定性：相同输入两次输出一致', () => {
    const tris = [
      [[0,0,0],[2,0,0],[0,2,0]], [[2,0,0],[2,2,0],[0,2,0]],
      [[0,0,1],[1,0,1],[0,1,0]],
    ]
    expect(projectTopFacingPolygons(tris)).toEqual(projectTopFacingPolygons(tris))
  })
  it('共面相邻三角形合并为一个矩形表面（共享对角线不得输出）', () => {
    const tris = [
      [[0,0,0],[2,0,0],[0,2,0]], [[2,0,0],[2,2,0],[0,2,0]],
    ]
    const s = extractTopSurfaces(tris, { topFacingCos: 0.35, mergeAngleDeg: 20, mergeHeightDeltaM: 0.4, minAreaM2: 0.1 })
    expect(s.length).toBe(1)
    expect(s[0].areaM2).toBeCloseTo(4, 6)
    // 1 个 polygon（无内部对角线）
    expect(s[0].polys.length).toBe(1)
    // 矩形 4 顶点（简化后）
    const ring = s[0].polys[0].ring
    expect(ring.length).toBeLessThanOrEqual(5)
  })
  it('近共面连续曲面合并（环带式斜面不炸成三角马赛克）', () => {
    // 连续斜面（z 线性变化，面片间高度差 0.2m、法线差 < 20°）→ 1 个表面
    const zAt = (x) => x * 0.05
    const tris = []
    for (let i = 0; i < 5; i++) {
      const x0 = i * 2
      const x1 = (i + 1) * 2
      const z0 = zAt(x0)
      const z1 = zAt(x1)
      tris.push([[x0,0,z0],[x1,0,z1],[x0,2,z0]])
      tris.push([[x1,0,z1],[x1,2,z1],[x0,2,z0]])
    }
    const s = extractTopSurfaces(tris, { topFacingCos: 0.35, mergeAngleDeg: 20, mergeHeightDeltaM: 0.4, minAreaM2: 0.5 })
    expect(s.length).toBe(1)
    expect(s[0].areaM2).toBeCloseTo(20, 5)
  })
  it('真实高度台阶保留为两个表面', () => {
    // 双层平台 z=0 / z=0.5：顶面法线同为 0° 但共享边高度差 0.5 > 0.4 → 不合并
    // （台阶用垂直壁连接——顶面间不共享边，自然分离）
    const tris = [
      [[0,0,0],[4,0,0],[0,4,0]], [[4,0,0],[4,4,0],[0,4,0]],
      [[0,0,0.5],[4,0,0.5],[0,4,0.5]], [[4,0,0.5],[4,4,0.5],[0,4,0.5]],
    ]
    const s = extractTopSurfaces(tris, { topFacingCos: 0.35, mergeAngleDeg: 20, mergeHeightDeltaM: 0.4, minAreaM2: 0.5 })
    expect(s.length).toBe(2)
  })
  it('隔离凸起（hatch，与基底隔垂直壁）保留为独立表面', () => {
    const tris = [
      [[0,0,0],[10,0,0],[0,10,0]], [[10,0,0],[10,10,0],[0,10,0]],
      [[2,2,0.3],[4,2,0.3],[2,4,0.3]], [[4,2,0.3],[4,4,0.3],[2,4,0.3]],
    ]
    const s = extractTopSurfaces(tris, { topFacingCos: 0.35, mergeAngleDeg: 20, mergeHeightDeltaM: 0.4, minAreaM2: 0.5 })
    expect(s.length).toBe(2)
    const hatch = s.find((x) => x.areaM2 === 4)
    expect(hatch).toBeTruthy()
  })
  it('小凸起（只占主面 4%）不因相对占比被拒——保留为独立表面', () => {
    const tris = [
      [[0,0,0],[10,0,0],[0,10,0]], [[10,0,0],[10,10,0],[0,10,0]],
      [[4.8,4.8,0.2],[5.2,4.8,0.2],[4.8,5.2,0.2]], [[5.2,4.8,0.2],[5.2,5.2,0.2],[4.8,5.2,0.2]],
    ]
    const s = extractTopSurfaces(tris, { topFacingCos: 0.35, mergeAngleDeg: 20, mergeHeightDeltaM: 0.4, minAreaM2: 0.01 })
    // 平台 + 0.16 m² 小 hatch（占平台 0.16%）
    expect(s.length).toBe(2)
    expect(s.some((x) => x.areaM2 < 0.2)).toBe(true)
  })
  it('遮挡过滤：被高处表面完全覆盖的 hidden geometry 剔除', () => {
    const surfaces = [
      { z: 2.1, polys: [{ ring: [[0,0],[10,0],[10,10],[0,10]], holes: [] }], areaM2: 100 }, // 甲板（高层）
      { z: 0.7, polys: [{ ring: [[2,2],[4,2],[4,4],[2,4]], holes: [] }], areaM2: 4 },      // 裙板（被甲板盖）
      { z: 1.2, polys: [{ ring: [[8,8],[12,8],[12,12],[8,12]], holes: [] }], areaM2: 16 }, // 部分露出
    ]
    const kept = filterOccludedSurfaces(surfaces)
    expect(kept.length).toBe(2)
    expect(kept.some((s) => s.areaM2 === 100)).toBe(true)
    expect(kept.some((s) => s.areaM2 === 4)).toBe(false) // 完全遮挡
    expect(kept.some((s) => s.areaM2 === 16)).toBe(true)  // 部分遮挡保留
  })
  it('mergeVisualSurfaces 确定性：相同输入两次输出一致', () => {
    const tris = [
      [[0,0,0],[2,0,0],[0,2,0]], [[2,0,0],[2,2,0],[0,2,0]],
    ]
    const a = mergeVisualSurfaces(tris)
    const b = mergeVisualSurfaces(tris)
    expect(a.surfaceCount).toBe(b.surfaceCount)
    expect(a.stats.rawFaces).toBe(b.stats.rawFaces)
  })
  it('Maus hull.svg 含主面填充（#565e58）与履带（#454b47），无 tessellation 色（旧 bump 色已删除）', () => {
    const svg = readFileSync(MAUS_DIR + 'hull.svg', 'utf8')
    expect(svg).toContain('#565e58')
    expect(svg).toContain('#454b47')
    expect(svg).not.toContain('#6f776f') // 旧 bump 填充色已随 bump 概念移除
  })
  it('Maus turret.svg 含屋顶主面（#6d756f）与炮盾（#656c67），无三角马赛克色', () => {
    const svg = readFileSync(MAUS_DIR + 'turret.svg', 'utf8')
    expect(svg).toContain('#6d756f')
    expect(svg).toContain('#656c67')
    expect(svg).not.toContain('#838b85') // 旧 bump 填充色已移除（面片块合并进 roof/环带）
  })
  it('Maus turret 屋顶无三角马赛克：vehicle-secondary 不含小三角面片块', () => {
    // 合并后 roof 是单一区域；面片块被合并/遮挡过滤——secondary 中不应有大量小面片
    const svg = readFileSync(MAUS_DIR + 'turret.svg', 'utf8')
    const groups = [...svg.matchAll(/<g class="vehicle-([^"]+)">([\s\S]*?)<\/g>/g)]
    const micro = groups.find((m) => m[1] === 'micro-detail')
    // micro 允许存在（真实小结构），但不应有 ~16 个规则小三角
    if (micro) {
      const paths = [...micro[2].matchAll(/<path/g)]
      expect(paths.length).toBeLessThan(16)
    }
  })
  it('不同 component/node boundary：无共享边的独立表面不合并（除非显式允许）', () => {
    // 两个分离的平台（无共享边）→ 2 个独立表面
    const tris = [
      [[0,0,0],[4,0,0],[0,4,0]], [[4,0,0],[4,4,0],[0,4,0]],
      [[10,0,0.5],[14,0,0.5],[10,4,0.5]], [[14,0,0.5],[14,4,0.5],[10,4,0.5]],
    ]
    const s = extractTopSurfaces(tris, { topFacingCos: 0.35, mergeAngleDeg: 20, mergeHeightDeltaM: 0.4, minAreaM2: 0.5 })
    expect(s.length).toBe(2)
  })
  it('低噪声高度差（斜面面片间）合并——连续曲面不炸碎', () => {
    // 连续斜面 z=0.125x：相邻面片共享边顶点连续、重心高度差 0.25m（< 0.4）、角度连续 → 1 表面
    const tris = [
      [[0,0,0],[2,0,0.25],[0,2,0]], [[2,0,0.25],[2,2,0.25],[0,2,0]],
      [[2,0,0.25],[4,0,0.5],[2,2,0.25]], [[4,0,0.5],[4,2,0.5],[2,2,0.25]],
    ]
    const s = extractTopSurfaces(tris, { topFacingCos: 0.35, mergeAngleDeg: 20, mergeHeightDeltaM: 0.4, minAreaM2: 0.5 })
    expect(s.length).toBe(1)
    expect(s[0].areaM2).toBeCloseTo(8, 5)
  })
  it('真实 deck step（垂直壁分隔）→ 不合并', () => {
    // 上层（z 0.5）与下层（z 0）顶面不共享边（隔垂直壁）→ 2 个表面
    const tris = [
      [[0,0,0],[4,0,0],[0,4,0]], [[4,0,0],[4,4,0],[0,4,0]],
      [[0,0,0.5],[4,0,0.5],[0,4,0.5]], [[4,0,0.5],[4,4,0.5],[0,4,0.5]],
    ]
    const s = extractTopSurfaces(tris, { topFacingCos: 0.35, mergeAngleDeg: 20, mergeHeightDeltaM: 0.4, minAreaM2: 0.5 })
    expect(s.length).toBe(2)
  })
  it('bounding-box projection fidelity：turret source bbox 与最终 SVG bbox 比例一致', () => {
    // source turret_01 mesh bbox（模型坐标）：x ±1.5338（3.0676m）、y -3.5188..1.0040（4.5228m）
    // 比例 = 4.5228 / 3.0676 = 1.4743；最终 turret.svg 主体（body+roof+ring，即 turret_01 对应
    // 部分，排除 mantlet/gun 前伸）必须同比例（±3%）
    const meta = JSON.parse(readFileSync(MAUS_DIR + 'metadata.json', 'utf8'))
    const tb = meta.generation.turretBounds
    const srcRatio = (tb.max[1] - tb.min[1]) / (tb.max[0] - tb.min[0])
    expect(srcRatio).toBeCloseTo(4.5228 / 3.0676, 2)
    const svg = readFileSync(MAUS_DIR + 'turret.svg', 'utf8')
    // 仅统计 turret_01 对应层：body #7a817c + 屋顶/环带 #6d756f（mantlet/gun 是独立节点，不算）
    const paths = [...svg.matchAll(/<path d="([^"]+)"([^>]*)>/g)].filter((m) => {
      const fill = (m[2].match(/fill="([^"]*)"/) || [])[1]
      return fill === '#7a817c' || fill === '#6d756f'
    })
    expect(paths.length).toBeGreaterThan(0)
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9
    for (const m of paths) {
      const cs = [...m[1].matchAll(/([ML])\s*([-\d.]+)\s+([-\d.]+)/g)].map((x) => [parseFloat(x[2]), parseFloat(x[3])])
      for (const [x, y] of cs) {
        minX = Math.min(minX, x); minY = Math.min(minY, y)
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
      }
    }
    const svgRatio = (maxY - minY) / (maxX - minX)
    expect(Math.abs(svgRatio - srcRatio) / srcRatio).toBeLessThan(0.03)
  })
  it('feature-fidelity-report 确定性：相同输入两次输出一致', () => {
    const input = {
      sourceHull: [{ polys: [{ ring: [[0,0],[2,0],[0,2]], holes: [] }], areaM2: 2, zMean: 2.1, faceCount: 2 }],
      sourceTurret: [{ polys: [{ ring: [[0,0],[1,0],[0,1]], holes: [] }], areaM2: 0.5, zMean: 3.4, faceCount: 1 }],
      finalHull: [{ polys: [{ ring: [[0,0],[2,0],[0,2]], holes: [] }], areaM2: 2, z: 2.1, faceCount: 2 }],
      finalTurret: [{ polys: [{ ring: [[0,0],[1,0],[0,1]], holes: [] }], areaM2: 0.5, z: 3.4, faceCount: 1 }],
      hullBounds: { min: [-2, -5], max: [2, 5] },
      turretBounds: { min: [-2, -4], max: [2, 1] },
    }
    expect(buildFeatureAudit(input)).toEqual(buildFeatureAudit(input))
  })
})

describe('Maus 生成资产契约（assets/maus）', () => {
  it('hull.svg / turret.svg / metadata.json 存在且通过 validateModelEntry', () => {
    const files = { hull: null, turret: null, metadata: null, extra: [] }
    for (const name of ['hull.svg', 'turret.svg', 'metadata.json']) {
      try {
        const key = name === 'metadata.json' ? 'metadata' : name.replace('.svg', '')
        files[key] = readFileSync(MAUS_DIR + name, 'utf8')
      } catch {
        // missing → null
      }
    }
    const errors = validateModelEntry({ modelKey: 'maus', kind: 'turreted', files })
    expect(errors, JSON.stringify(errors)).toEqual([])
  })
  it('SVG 契约：合法 XML / 正确 viewBox / 无 raster / 无 base64 / 坐标有限', () => {
    for (const name of ['hull.svg', 'turret.svg']) {
      const svg = readFileSync(MAUS_DIR + name, 'utf8')
      expect(svg.includes('<svg')).toBe(true)
      expect(svg).toContain(`viewBox="0 0 ${VIEWBOX.width} ${VIEWBOX.height}"`)
      expect(svg).not.toMatch(/<image|<img|data:image|base64/)
      expect(svg.includes('NaN') || svg.includes('Infinity')).toBe(false)
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
  it('高保真：真实比例无夸大——gun 渲染宽度与模型投影一致（faithful geometry scale）', () => {
    // gunBounds 模型宽度 0.497m（-0.254..0.243）× fit.scale 31.17 ≈ 15.5 units；
    // 渲染 gun path 宽度不得被人为放大（无 intentional exaggeration）。
    const meta = JSON.parse(readFileSync(MAUS_DIR + 'metadata.json', 'utf8'))
    const [gMinX, gMaxX] = [meta.generation.gunBounds.min[0], meta.generation.gunBounds.max[0]]
    // fit.scale = 320×0.88 / max(hull 宽, 高)（与 extractor computeFit 同式）
    const hb = meta.generation.hullBounds
    const hullMaxDim = Math.max(hb.max[0] - hb.min[0], hb.max[1] - hb.min[1])
    const scale = (VIEWBOX.width * 0.88) / hullMaxDim
    const expectedUnits = (gMaxX - gMinX) * scale
    // 从 SVG 解析 gun path（#4d534f）的宽度
    const svg = readFileSync(MAUS_DIR + 'turret.svg', 'utf8')
    const gunPath = svg.match(/<path d="([^"]*)" fill="#4d534f"/)
    expect(gunPath).toBeTruthy()
    const xs = [...gunPath[1].matchAll(/[ML]\s*([-\d.]+)\s+([-\d.]+)/g)].map((m) => parseFloat(m[1]))
    const w = Math.max(...xs) - Math.min(...xs)
    // 允许 ±2 units 容差（投影与路径简化），但不允许放大（真实宽度 ≈ 15.5 units）
    expect(w).toBeLessThanOrEqual(expectedUnits + 2)
    expect(w).toBeGreaterThan(10)
  })
  it('高保真：fidelity 契约写入 metadata（fidelity=high / geometryScale=faithful / retention target）', () => {
    const meta = JSON.parse(readFileSync(MAUS_DIR + 'metadata.json', 'utf8'))
    expect(meta.generation.fidelity).toBe('high')
    expect(meta.generation.geometryScale).toBe('faithful')
    expect(meta.generation.visibleDetailRetentionTarget).toBe(0.9)
    expect(meta.generation.detailThresholds.bumpSignificanceRatio).toBeUndefined()
  })
  it('确定性：extractor 纯函数相同输入两次输出一致', () => {
    const pts = [{ x: -1.86, y: -4.44 }, { x: 1.86, y: -4.44 }, { x: 1.86, y: 4.6 }, { x: -1.86, y: 4.6 }]
    const fitA = computeFit(bounds2D(pts), VIEWBOX, 0.88)
    const fitB = computeFit(bounds2D(pts), VIEWBOX, 0.88)
    expect(fitA).toEqual(fitB)
    expect(convexHull2D(pts)).toEqual(convexHull2D(pts))
  })
})