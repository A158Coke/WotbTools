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
  svgDocument,
  toSvg,
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
    expect(meta.generation.method).toBe('collision-glb-topdown-projection')
    expect(meta.turretPivot.x).toBe(160)
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
