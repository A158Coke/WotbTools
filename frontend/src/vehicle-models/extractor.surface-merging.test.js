import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  buildFeatureAudit,
  extractTopSurfaces,
  filterOccludedSurfaces,
  mergeVisualSurfaces,
  projectTopFacingPolygons,
} from '../../scripts/extractor-lib.mjs'

const MAUS_DIR = fileURLToPath(new URL('./assets/maus/', import.meta.url))
describe('Layer B — visual surface merging（HIGH-FIDELITY，Blocker 1/2/4）', () => {
  it('projectTopFacingPolygons：每个 top-facing 三角形独立投影（raw ground truth，无 merge）', () => {
    const tris = [
      [[0,0,0],[2,0,0],[0,2,0]], [[2,0,0],[2,2,0],[0,2,0]],
      [[0,0,1],[1,0,1],[0,1,0]],
      [[0,0,0],[2,0,0],[0,0,1]],                                        // 垂直壁（nz = 0，排除）
    ]
    const polys = projectTopFacingPolygons(tris, { topFacingCos: 0.35 })
    expect(polys.length).toBe(3)
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
    expect(s[0].polys.length).toBe(1)
    const ring = s[0].polys[0].ring
    expect(ring.length).toBeLessThanOrEqual(5)
  })
  it('近共面连续曲面合并（环带式斜面不炸成三角马赛克）', () => {
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
    expect(s.length).toBe(2)
    expect(s.some((x) => x.areaM2 < 0.2)).toBe(true)
  })
  it('遮挡过滤：被高处表面完全覆盖的 hidden geometry 剔除', () => {
    const surfaces = [
      { z: 2.1, polys: [{ ring: [[0,0],[10,0],[10,10],[0,10]], holes: [] }], areaM2: 100 },
      { z: 0.7, polys: [{ ring: [[2,2],[4,2],[4,4],[2,4]], holes: [] }], areaM2: 4 },
      { z: 1.2, polys: [{ ring: [[8,8],[12,8],[12,12],[8,12]], holes: [] }], areaM2: 16 }, // 部分露出
    ]
    const kept = filterOccludedSurfaces(surfaces)
    expect(kept.length).toBe(2)
    expect(kept.some((s) => s.areaM2 === 100)).toBe(true)
    expect(kept.some((s) => s.areaM2 === 4)).toBe(false)
    expect(kept.some((s) => s.areaM2 === 16)).toBe(true)
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
  it('正式资产 hull.webp / turret.webp 为 WebP 二进制（texture-bake 契约取代 SVG）', () => {
    for (const f of ['hull.webp', 'turret.webp']) {
      const buf = readFileSync(MAUS_DIR + f, 'latin1')
      expect(buf.slice(0, 4)).toBe('RIFF')
      expect(buf.slice(8, 12)).toBe('WEBP')
    }
  })
  it('不同 component/node boundary：无共享边的独立表面不合并（除非显式允许）', () => {
    const tris = [
      [[0,0,0],[4,0,0],[0,4,0]], [[4,0,0],[4,4,0],[0,4,0]],
      [[10,0,0.5],[14,0,0.5],[10,4,0.5]], [[14,0,0.5],[14,4,0.5],[10,4,0.5]],
    ]
    const s = extractTopSurfaces(tris, { topFacingCos: 0.35, mergeAngleDeg: 20, mergeHeightDeltaM: 0.4, minAreaM2: 0.5 })
    expect(s.length).toBe(2)
  })
  it('低噪声高度差（斜面面片间）合并——连续曲面不炸碎', () => {
    const tris = [
      [[0,0,0],[2,0,0.25],[0,2,0]], [[2,0,0.25],[2,2,0.25],[0,2,0]],
      [[2,0,0.25],[4,0,0.5],[2,2,0.25]], [[4,0,0.5],[4,2,0.5],[2,2,0.25]],
    ]
    const s = extractTopSurfaces(tris, { topFacingCos: 0.35, mergeAngleDeg: 20, mergeHeightDeltaM: 0.4, minAreaM2: 0.5 })
    expect(s.length).toBe(1)
    expect(s[0].areaM2).toBeCloseTo(8, 5)
  })
  it('真实 deck step（垂直壁分隔）→ 不合并', () => {
    const tris = [
      [[0,0,0],[4,0,0],[0,4,0]], [[4,0,0],[4,4,0],[0,4,0]],
      [[0,0,0.5],[4,0,0.5],[0,4,0.5]], [[4,0,0.5],[4,4,0.5],[0,4,0.5]],
    ]
    const s = extractTopSurfaces(tris, { topFacingCos: 0.35, mergeAngleDeg: 20, mergeHeightDeltaM: 0.4, minAreaM2: 0.5 })
    expect(s.length).toBe(2)
  })
  it('bounding-box projection fidelity：turret source bbox 与 bake turretBounds 比例一致', () => {
    const meta = JSON.parse(readFileSync(MAUS_DIR + 'metadata.json', 'utf8'))
    const tb = meta.generation.turretBounds
    const ratio = (tb.max[1] - tb.min[1]) / (tb.max[0] - tb.min[0])
    expect(ratio).toBeCloseTo(4.5228 / 3.0676, 2)
    expect(meta.generation.hullPhysicalPixelSize).toEqual([640, 640])
    expect(meta.turretRaster.pixelWidth).not.toBe(640)
    expect(meta.turretRaster.pixelHeight).not.toBe(640)
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
