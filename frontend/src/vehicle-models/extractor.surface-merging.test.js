/**
 * High fidelity visual surface merge contracts for the extractor.
 * These cases compare real projected surfaces and generated output from committed Maus fixtures.
 */
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
  it('正式资产 hull.webp / turret.webp 为 WebP 二进制（texture-bake 契约取代 SVG）', () => {
    for (const f of ['hull.webp', 'turret.webp']) {
      const buf = readFileSync(MAUS_DIR + f, 'latin1')
      expect(buf.slice(0, 4)).toBe('RIFF')
      expect(buf.slice(8, 12)).toBe('WEBP')
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
  it('bounding-box projection fidelity：turret source bbox 与 bake turretBounds 比例一致', () => {
    // source turret_01 mesh bbox（模型坐标）：x ±1.5338（3.0676m）、y -3.5188..1.0040（4.5228m）
    // 比例 = 4.5228 / 3.0676 = 1.4743；bake-report turretBounds（turret 主体，排除 mantlet/gun）
    // 必须同比例（±3%）——bake 保留真实比例，无 crop/拉伸
    const meta = JSON.parse(readFileSync(MAUS_DIR + 'metadata.json', 'utf8'))
    const tb = meta.generation.turretBounds
    const ratio = (tb.max[1] - tb.min[1]) / (tb.max[0] - tb.min[0])
    expect(ratio).toBeCloseTo(4.5228 / 3.0676, 2)
    // 逻辑画布契约：320×320 + hull physical 固定 640×640（turret 尺寸以 turretRaster 为准）
    expect(meta.generation.hullPhysicalPixelSize).toEqual([640, 640])
    expect(meta.turretRaster.pixelWidth).not.toBe(640) // turret.webp 是 variable-size canvas（Maus 191×574）
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

