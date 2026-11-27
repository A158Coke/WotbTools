import { describe, it, expect } from 'vitest'
import {
  SUBDIVISION_METRICS, buildAdaptiveTerrain, CLIENT_NORMAL_CAMERA_FOV_H, buildRefineMask,
  morphFunc, subdivisionMetrics, groundMapUv, subdivMorphOf, terrainLodState, terrainLodStale,
  terrainLodStaleReason,
} from './terrainMesh.js'

const FOV = (55 * Math.PI) / 180
const ASPECT = 16 / 9

describe('地形网格（客户端补片级自适应 LOD，引擎 LandscapeSubdivision 口径）', () => {
  const make = (n, fill, at = null) => {
    const f = new Float32Array(n * n).fill(fill)
    if (at) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) f[i * n + j] = at(i, j)
    return f
  }
  const build = (field, n, span, cam) =>
    buildAdaptiveTerrain({ field, n, span, cam, fovY: FOV, aspect: ASPECT })

  it('阈值口径：tanFovY = tan(vfov/2)、阈值随（水平）fov 在 zoom/normal 预设间插值', () => {
    const wide = subdivisionMetrics(FOV, ASPECT)
    expect(wide.tanFovY).toBeCloseTo(Math.tan(FOV / 2), 12)
    const hFovDeg = (2 * Math.atan(Math.tan(FOV / 2) * ASPECT) * 180) / Math.PI
    expect(wide.fovLerp).toBeCloseTo(Math.min(1, Math.max(0, (hFovDeg - 6.5) / (70 - 6.5))), 9)
    const M = SUBDIVISION_METRICS
    expect(wide.maxHeightError).toBeCloseTo(
      M.zoomMaxHeightError + (M.normalMaxHeightError - M.zoomMaxHeightError) * wide.fovLerp, 12)
    expect(wide.maxPatchRadiusError).toBeCloseTo(
      M.zoomMaxPatchRadiusError + (M.normalMaxPatchRadiusError - M.zoomMaxPatchRadiusError) * wide.fovLerp, 12)
    const zoom = subdivisionMetrics((8 * Math.PI) / 180, ASPECT)
    expect(zoom.fovLerp).toBeLessThan(0.2)
    expect(zoom.maxHeightError).toBeGreaterThan(wide.maxHeightError)
    expect(zoom.maxPatchRadiusError).toBeGreaterThan(wide.maxPatchRadiusError)
    const half = subdivisionMetrics(FOV, ASPECT, 0.5)
    expect(half.maxHeightError).toBeCloseTo(wide.maxHeightError / 2, 12)
    expect(half.maxPatchRadiusError).toBeCloseTo(wide.maxPatchRadiusError / 2, 12)
    expect(half.maxAbsoluteHeightError).toBe(wide.maxAbsoluteHeightError)
  })

  it('阈值 fov 按客户端口径传入：水平 fov 来自相机配置，不随画布宽高比滑动', () => {
    const portrait = 0.5
    const derived = subdivisionMetrics(FOV, portrait)
    expect(derived.fovLerp).toBeLessThan(0.9)
    const clientWay = subdivisionMetrics(FOV, portrait, 1, CLIENT_NORMAL_CAMERA_FOV_H)
    expect(clientWay.fovLerp).toBe(1)
    const M = SUBDIVISION_METRICS
    expect(clientWay.maxHeightError).toBeCloseTo(M.normalMaxHeightError, 12)
    expect(clientWay.maxPatchRadiusError).toBeCloseTo(M.normalMaxPatchRadiusError, 12)
    expect(clientWay.tanFovY).toBeCloseTo(derived.tanFovY, 12)
    expect(clientWay.maxAbsoluteHeightError).toBe(M.normalMaxAbsoluteHeightError)
    expect(subdivisionMetrics(FOV, portrait, 1, 0).fovLerp).toBeCloseTo(derived.fovLerp, 12)
    expect(subdivisionMetrics(FOV, portrait, 1, NaN).fovLerp).toBeCloseTo(derived.fovLerp, 12)
    expect(subdivisionMetrics(FOV, ASPECT, 1, CLIENT_NORMAL_CAMERA_FOV_H).fovLerp)
      .toBe(subdivisionMetrics(FOV, ASPECT).fovLerp)
  })

  it('走廊掩码（B）：掩码内强制到最细层，「粗格插值抬过贴地薄板」的覆盖清零', () => {
    const n = 128, span = 600, jc = n / 2, row = n / 2, sigma = 8, depth = 1.5
    const field = new Float32Array(n * n)
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      field[i * n + j] = 20 - depth * Math.exp(-(((j - jc) / sigma) ** 2))
    }
    const truth = (j) => field[row * n + j]
    const covered = (res, j) => {
      const st = res.sizeAt[row * n + j]
      const j0 = Math.floor(j / st) * st, fj = (j - j0) / st
      const h = field[row * n + j0] * (1 - fj) + field[row * n + Math.min(j0 + st, n - 1)] * fj
      return h >= truth(j) + 0.10 - 0.02
    }
    const cam = { x: 0, y: 200, z: -1200 }
    const base = buildAdaptiveTerrain({ field, n, span, cam, fovY: FOV, aspect: ASPECT })
    let hitBase = 0
    for (let j = jc - 2; j <= jc + 2; j++) if (covered(base, j)) hitBase++
    expect(hitBase).toBeGreaterThan(0)
    const M = 2
    const pts = []
    for (let j = jc - M; j <= jc + M; j++) pts.push((j / n - 0.5) * span, 0)
    const mask = buildRefineMask(pts, n, span, 2)
    const withMask = buildAdaptiveTerrain({ field, n, span, cam, fovY: FOV, aspect: ASPECT, refineMask: mask })
    let hitMask = 0
    for (let j = jc - M; j <= jc + M; j++) if (covered(withMask, j)) hitMask++
    expect(hitMask).toBe(0)
    let masked = 0
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (!mask[i * n + j]) continue
      masked++
      expect(withMask.sizeAt[i * n + j]).toBe(1)
    }
    expect(masked).toBeGreaterThan(0)
    expect(withMask.quads).toBeGreaterThan(base.quads)
    const again = buildAdaptiveTerrain({ field, n, span, cam, fovY: FOV, aspect: ASPECT })
    expect(Array.from(again.sizeAt)).toEqual(Array.from(base.sizeAt))
    expect(again.quads).toBe(base.quads)
  })

  it('buildRefineMask：足迹点按 texel 标位、外扩按 margin、越界不越写', () => {
    const n = 32, span = 320
    const pts = [0, 0, 100, 0]
    const m1 = buildRefineMask(pts, n, span, 1)
    const at = (i, j) => m1[i * n + j]
    for (const [i, j] of [[16, 16], [16, 26], [15, 15], [17, 27], [16, 25]]) expect(at(i, j), `i=${i} j=${j}`).toBe(1)
    expect(at(14, 14)).toBe(0); expect(at(18, 18)).toBe(0)
    const m0 = buildRefineMask(pts, n, span, 0)
    expect(m0[16 * n + 16]).toBe(1); expect(m0[15 * n + 16]).toBe(0)
    const mEdge = buildRefineMask([150, 0], n, span, 2)
    expect(mEdge.reduce((a, b) => a + b, 0)).toBe(15)
    expect(buildRefineMask([-300, -300, 400, 400], n, span, 2).reduce((a, b) => a + b, 0)).toBe(0)
    expect(buildRefineMask([NaN, 0, 0, Infinity], n, span, 1).reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('地形 LOD 滞回是**单向**的：拉近一律细化，拉远才允许变粗，且有 120 ms 节流', () => {
    const st = (o = {}) => ({
      d: 100, px: 0, py: 100, pz: 0, ux: 0, uy: 1, uz: 0, fovY: 0.8, aspect: 16 / 9, ...o,
    })
    expect(terrainLodStale(null, st(), 0)).toBe(true)
    expect(terrainLodStale(st(), st({ d: 96, py: 96 }), 500)).toBe(false)
    expect(terrainLodStale(st(), st({ d: 90, py: 90 }), 500)).toBe(true)
    expect(terrainLodStale(st(), st({ d: 90, py: 90 }), 50)).toBe(false)
    expect(terrainLodStale(st(), st({ d: 110, py: 110 }), 500)).toBe(false)
    expect(terrainLodStale(st(), st({ d: 150, py: 150 }), 500)).toBe(true)
  })

  it('terrainLodStaleReason：给出触发判据，布尔 terrainLodStale 由它派生（判据数值不变）', () => {
    const st = (o = {}) => ({
      d: 100, px: 0, py: 100, pz: 0, ux: 0, uy: 1, uz: 0, fovY: 0.8, aspect: 16 / 9, ...o,
    })
    expect(terrainLodStaleReason(null, st(), 0)).toBe('first')
    expect(terrainLodStaleReason({ d: 100 }, st(), 500)).toBeNull()
    expect(terrainLodStaleReason(st(), st({ d: 90, py: 90 }), 500)).toBe('distance')
    expect(terrainLodStaleReason(st(), st({ d: 150, py: 150 }), 500)).toBe('distance')
    expect(terrainLodStaleReason(st(), st({ px: 6 }), 500)).toBe('lateral')
    expect(terrainLodStaleReason(st(), st({ fovY: 0.81 }), 500)).toBe('fov')
    expect(terrainLodStaleReason(st(), st({ aspect: 16 / 9 * 1.01 }), 500)).toBe('aspect')
    expect(terrainLodStaleReason(st(), st({ d: 96, py: 96 }), 500)).toBeNull()
    expect(terrainLodStaleReason(st(), st({ d: 90, py: 90 }), 50)).toBeNull()
    for (const cur of [st(), st({ d: 90, py: 90 }), st({ px: 6 }), st({ fovY: 0.81 }), st({ aspect: 2 })]) {
      for (const since of [0, 50, 500]) {
        expect(terrainLodStale(st(), cur, since)).toBe(terrainLodStaleReason(st(), cur, since) !== null)
      }
    }
  })

  it('groundMapUv：回退/低档底图朝向契约（旧 PlaneGeometry+rotπ 逐点等价；review P1 回归锁）', () => {
    const s = 600
    const P = new Float32Array([
      -s / 2, 0, -s / 2,
      s / 2, 0, -s / 2,
      -s / 2, 0, s / 2,
      s / 2, 0, s / 2,
    ])
    expect([...groundMapUv(P, s)]).toEqual([1, 0, 0, 0, 1, 1, 0, 1])
    expect([...groundMapUv(new Float32Array([0, 0, 0]), s)]).toEqual([0.5, 0.5])
    expect([...groundMapUv(new Float32Array([0, 0, 0]), s, -s / 2, 0)]).toEqual([0, 0.5])
    expect([...groundMapUv(new Float32Array([-s / 2, 0, 0]), s, -s / 2, 0)]).toEqual([0.5, 0.5])
    const uv = groundMapUv(P, s)
    expect(uv[0]).toBeGreaterThan(uv[2])
    expect(uv[5]).toBeGreaterThan(uv[1])
  })

  it('terrainLodState 快照：视距/位置/视轴/FOV/aspect —— 判据读什么，滞回就比什么', () => {
    const s = terrainLodState({ position: { x: 0, y: 100, z: 0 }, fov: 45 }, { x: 0, y: 0, z: 0 }, 21 / 9)
    expect(s.d).toBeCloseTo(100, 12)
    expect([s.px, s.py, s.pz]).toEqual([0, 100, 0])
    expect([s.ux, s.uy, s.uz]).toEqual([0, 1, 0])
    expect(s.fovY).toBeCloseTo((45 * Math.PI) / 180, 12)
    expect(s.aspect).toBeCloseTo(21 / 9, 12)
    const z = terrainLodState({ position: { x: 1, y: 2, z: 3 }, fov: 30 }, { x: 1, y: 2, z: 3 }, 16 / 9)
    expect(z.d).toBe(0)
    expect([z.ux, z.uy, z.uz]).toEqual([0, 0, 0])
  })

  it('地形 LOD 判据与构建同源：绕转（视距不变）/FOV/aspect 变化都必须重建（review P2 回归锁）', () => {
    const st = (o = {}) => ({
      d: 100, px: 0, py: 100, pz: 0, ux: 0, uy: 1, uz: 0, fovY: 0.8, aspect: 16 / 9, ...o,
    })
    expect(terrainLodStale(st(), st({ px: 4 }), 500)).toBe(false)
    expect(terrainLodStale(st(), st({ px: 6 }), 500)).toBe(true)
    expect(terrainLodStale(st(), st({ px: 6 }), 50)).toBe(false)
    expect(terrainLodStale(st(), st({ px: 0, py: 110, d: 110 }), 500)).toBe(false)
    expect(terrainLodStale(st(), st({ px: 6, py: 106, d: Math.hypot(6, 106) }), 500)).toBe(true)
    expect(terrainLodStale(st(), st({ fovY: 0.8004 }), 500)).toBe(false)
    expect(terrainLodStale(st(), st({ fovY: 0.9 }), 500)).toBe(true)
    expect(terrainLodStale(st(), st({ aspect: 21 / 9 }), 500)).toBe(true)
  })

  it('morphFunc / subdivMorph：客户端 `Landscape.cpp:1213` 与 `SubdividePatch` 末尾的直译', () => {
    expect(morphFunc(0)).toBeCloseTo(0, 12)
    expect(morphFunc(1)).toBeCloseTo(1, 12)
    expect(morphFunc(0.5)).toBeCloseTo(0.8125, 12)
    expect(morphFunc(-1)).toBe(0)
    expect(morphFunc(2)).toBeCloseTo(1, 12)
    const M = SUBDIVISION_METRICS
    const th = { maxHeightError: M.normalMaxHeightError, maxPatchRadiusError: M.normalMaxPatchRadiusError };
    expect(subdivMorphOf(th.maxHeightError, th.maxPatchRadiusError, th.maxHeightError, th.maxPatchRadiusError, th))
      .toBe(0)
    const m1 = subdivMorphOf(th.maxHeightError * 0.999, 0, th.maxHeightError * 1.01, 0, th)
    expect(m1).toBeGreaterThan(0.9)
    const m2 = subdivMorphOf(0, 0, th.maxHeightError * 10, 0, th)
    expect(m2).toBeGreaterThan(0.1)
    expect(m2).toBeLessThan(1)
  })

  it('两通道口径：平面地形上 morph 必须**恒等**（双抽头均值在直线上 = 原值）', () => {
    const n = 64, span = 600
    const plane = new Float32Array(n * n)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) plane[i * n + j] = 20 + 0.01 * i + 0.02 * j
    }
    const m = build(field2(plane), n, span, { x: 0, y: 30, z: 0 })
    for (let k = 0; k < m.positions.length; k += 3) {
      const x = m.positions[k], y = m.positions[k + 1], z = m.positions[k + 2]
      const i = (z / span + 0.5) * n, j = (x / span + 0.5) * n
      if (i >= n || j >= n) {
        const ci = Math.min(n - 1, Math.round(i)), cj = Math.min(n - 1, Math.round(j))
        expect(y).toBeCloseTo(20 + 0.01 * ci + 0.02 * cj, 3)
        continue
      }
      expect(y).toBeCloseTo(20 + 0.01 * i + 0.02 * j, 3)
    }
    function field2(a) { return a }
  })

  it('两通道口径：曲面上 morph 只**收缩**起伏（不放大），且顶点不外扩到邻域之外', () => {
    const n = 64, span = 600
    const bump = make(n, 20, (i, j) => 20 + 6 * Math.exp(-((i - 32) ** 2 + (j - 32) ** 2) / 60))
    const m = build(bump, n, span, { x: 0, y: 25, z: 0 })
    let minY = Infinity, maxY = -Infinity, minF = Infinity, maxF = -Infinity
    for (let k = 0; k < bump.length; k++) {
      if (bump[k] < minF) minF = bump[k]
      if (bump[k] > maxF) maxF = bump[k]
    }
    for (let k = 0; k < m.positions.length; k += 3) {
      const y = m.positions[k + 1]
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    expect(minY).toBeGreaterThanOrEqual(minF - 1e-4)
    expect(maxY).toBeLessThanOrEqual(maxF + 1e-4)
    let peak = -Infinity
    for (let k = 0; k < m.positions.length; k += 3) peak = Math.max(peak, m.positions[k + 1])
    expect(peak).toBeGreaterThan(maxF - 0.01)
    expect(peak).toBeLessThanOrEqual(maxF + 1e-4)
  })

  it('终止补片满足客户端三条判据（屏幕半径 / 屏幕高度 / 绝对 3 m）', () => {
    const n = 128
    const field = make(n, 20, (i, j) => 20 + 8 * Math.sin(i / 5) * Math.cos(j / 5) + (j > 80 ? 6 : 0))
    const m = build(field, n, 600, { x: 0, y: 60, z: 40 })
    const M = m.metrics
    const probed = m.patches.filter((p) => !p.floored)
    expect(probed.length).toBeGreaterThan(20)
    for (const p of probed) {
      expect(p.radiusError).toBeLessThan(M.maxPatchRadiusError)
      expect(p.heightError).toBeLessThan(M.maxHeightError)
      expect(p.err).toBeLessThanOrEqual(M.maxAbsoluteHeightError)
    }
  })

  it('半径判据的世界空间后果：单元格边长 ≤ 0.08·视距 + 1 texel（"薄结构被地形盖住"回归）', () => {
    const n = 256
    const tex = 600 / n
    const field = make(n, 20, (i, j) => 20 + 8 * Math.sin(i / 5) * Math.cos(j / 5))
    for (const cam of [{ x: 0, y: 20, z: 0 }, { x: 0, y: 250, z: 0 }, { x: 40, y: 400, z: -30 }]) {
      const m = build(field, n, 600, cam)
      const pos = m.positions, idx = m.indices
      let worst = 0
      for (let t = 0; t < idx.length; t += 3) {
        const A = idx[t] * 3, B = idx[t + 1] * 3, C = idx[t + 2] * 3
        const ex = Math.max(Math.abs(pos[A] - pos[B]), Math.abs(pos[A] - pos[C]), Math.abs(pos[B] - pos[C]))
        const ez = Math.max(Math.abs(pos[A + 2] - pos[B + 2]), Math.abs(pos[A + 2] - pos[C + 2]),
          Math.abs(pos[B + 2] - pos[C + 2]))
        const x = (pos[A] + pos[B] + pos[C]) / 3, y = (pos[A + 1] + pos[B + 1] + pos[C + 1]) / 3
        const z = (pos[A + 2] + pos[B + 2] + pos[C + 2]) / 3
        const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z)
        worst = Math.max(worst, Math.max(ex, ez) / (0.08 * Math.max(d, 1) + tex))
      }
      expect(m.quads).toBeGreaterThan(64)
      expect(worst).toBeLessThanOrEqual(1)
    }
  })

})
