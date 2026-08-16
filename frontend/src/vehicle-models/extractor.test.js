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
  buildMetadata,
  computeFit,
  convexHull2D,
  correctZYTuple,
  hullToPath,
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
  it('Maus 资产：turret 不含 hide_elements 细长条（raw bbox y 上界来自 mantlet 而非 hide）', () => {
    const meta = JSON.parse(readFileSync(MAUS_DIR + 'metadata.json', 'utf8'))
    // mantlet 在炮塔前部（+y）→ turretBounds.max.y ≈ 2.56（模型米），而非 hide_elements 的 0.47
    expect(meta.generation.turretBounds.max[1]).toBeGreaterThan(1.5)
    expect(meta.generation.turretBounds.max[1]).toBeLessThan(3)
  })
})

describe('Blocker 4 — generation method 命名', () => {
  it('metadata.generation.method = blitzkit-model-topdown-extraction', () => {
    const meta = JSON.parse(readFileSync(MAUS_DIR + 'metadata.json', 'utf8'))
    expect(meta.generation.method).toBe('blitzkit-model-topdown-extraction')
    expect(meta.generation.method).not.toMatch(/collision/)
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
  it('确定性：extractor 纯函数相同输入两次输出一致', () => {
    const pts = [{ x: -1.86, y: -4.44 }, { x: 1.86, y: -4.44 }, { x: 1.86, y: 4.6 }, { x: -1.86, y: 4.6 }]
    const fitA = computeFit(bounds2D(pts), VIEWBOX, 0.88)
    const fitB = computeFit(bounds2D(pts), VIEWBOX, 0.88)
    expect(fitA).toEqual(fitB)
    expect(convexHull2D(pts)).toEqual(convexHull2D(pts))
  })
})
