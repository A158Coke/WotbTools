import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildAdaptiveTerrain, terrainSurfaceHeightAt } from '../terrainMesh.js'
import {
  ANNOTATION_LIFT,
  ANNOTATION_MAX_COMMITTED_POINTS,
  ANNOTATION_MITER_LIMIT,
  ANNOTATION_RING_SEGMENTS,
  buildEraserRing,
  buildPenRibbon,
  normalizePenPoints,
  sanitizePoints,
  smoothPolyline,
  subdividePolyline,
} from './annotation3d.js'
import { applyEraser, commit, redo, undo } from '../../utils/annotation.js'

function pen(points, width = 1.4, color = '#ff4d4f') {
  return { type: 'pen', color, width, points }
}

function ribbonVertices(ribbon) {
  const out = []
  for (const strip of ribbon.strips) {
    for (let i = 0; i < strip.positions.length; i += 3) {
      out.push({ x: strip.positions[i], y: strip.positions[i + 1], z: strip.positions[i + 2] })
    }
  }
  return out
}

function ringVertices(ring) {
  const out = []
  for (let i = 0; i < ring.positions.length; i += 3) {
    out.push({ x: ring.positions[i], y: ring.positions[i + 1], z: ring.positions[i + 2] })
  }
  return out
}

function expectDraped(ribbon, surface, lift = ANNOTATION_LIFT) {
  const verts = ribbonVertices(ribbon)
  expect(verts.length).toBeGreaterThan(0)
  for (const v of verts) {
    expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true)
    expect(v.y).toBeCloseTo(surface(v.x, v.z) + lift, 4)
  }
}

function expectTrianglesClear(ribbon, surface, { allowEmpty = false } = {}) {
  let checked = 0
  for (const strip of ribbon.strips) {
    for (let i = 0; i < strip.indices.length; i += 3) {
      const ia = strip.indices[i] * 3
      const ib = strip.indices[i + 1] * 3
      const ic = strip.indices[i + 2] * 3
      const ax = strip.positions[ia]; const ay = strip.positions[ia + 1]; const az = strip.positions[ia + 2]
      const bx = strip.positions[ib]; const by = strip.positions[ib + 1]; const bz = strip.positions[ib + 2]
      const cx = strip.positions[ic]; const cy = strip.positions[ic + 1]; const cz = strip.positions[ic + 2]
      for (const [wa, wb, wc] of [
        [1 / 3, 1 / 3, 1 / 3], [0.5, 0.25, 0.25], [0.25, 0.5, 0.25], [0.25, 0.25, 0.5],
        [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5],
      ]) {
        const x = wa * ax + wb * bx + wc * cx
        const y = wa * ay + wb * by + wc * cy
        const z = wa * az + wb * bz + wc * cz
        // 5cm 允许误差；production lift=8cm 覆盖。固定 0.5m cross samples 的 off-grid
        // ridge 实测 ~8.7cm，超过该阈值，因此这个回归仍能锁住 adaptive refinement。
        expect(y).toBeGreaterThanOrEqual(surface(x, z) - 0.05)
        checked++
      }
    }
  }
  if (allowEmpty) expect(checked).toBeGreaterThanOrEqual(0)
  else expect(checked).toBeGreaterThan(0)
}

describe('sanitizePoints', () => {
  it('drops non-finite points and consecutive duplicates, keeps a later repeat', () => {
    const out = sanitizePoints([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: NaN, y: 1 },
      { x: 10, y: Number.POSITIVE_INFINITY },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
    ])
    expect(out).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }])
  })

  it('returns [] for non-array, empty or single-point input', () => {
    expect(sanitizePoints(null)).toEqual([])
    expect(sanitizePoints([])).toEqual([])
    expect(sanitizePoints([{ x: 1, y: 2 }])).toEqual([])
  })

  it('honours the maxPoints cap', () => {
    const pts = []
    for (let i = 0; i < 20; i++) pts.push({ x: i, y: 0 })
    expect(sanitizePoints(pts, { maxPoints: 4 })).toHaveLength(4)
  })
})

describe('subdividePolyline', () => {
  it('fills a sparse 100m segment to the hard maximum segment length', () => {
    const pts = subdividePolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }], () => 20, {
      maxSegment: 2, midpointError: 999, maxPoints: 4096,
    })
    expect(pts.length).toBeGreaterThan(40)
    expect(pts[0]).toEqual({ x: 0, y: 0 })
    expect(pts[pts.length - 1]).toEqual({ x: 100, y: 0 })
    for (let i = 1; i < pts.length; i++) {
      expect(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)).toBeLessThanOrEqual(2 + 1e-6)
      expect(pts[i].y).toBe(0)
    }
  })

  it('splits on midpoint terrain error even when the segment is short', () => {
    const surface = (x) => 20 + (Math.abs(x) <= 0.5 ? 2 : 0)
    const pts = subdividePolyline([{ x: -1, y: 0 }, { x: 1, y: 0 }], surface, {
      maxSegment: 10, midpointError: 0.1, maxDepth: 3,
    })
    expect(pts.length).toBeGreaterThan(3)
    expect(pts[0]).toEqual({ x: -1, y: 0 })
    expect(pts[pts.length - 1]).toEqual({ x: 1, y: 0 })
  })

  it('still splits by distance when the sampler has no terrain', () => {
    const pts = subdividePolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], () => null, {
      maxSegment: 2, midpointError: 0.08,
    })
    expect(pts.length).toBeGreaterThan(5)
    expect(pts[0]).toEqual({ x: 0, y: 0 })
    expect(pts[pts.length - 1]).toEqual({ x: 10, y: 0 })
    for (let i = 1; i < pts.length; i++) {
      expect(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)).toBeLessThanOrEqual(2 + 1e-6)
    }
  })

  it('keeps the two endpoints when maxPoints is only 2', () => {
    const pts = subdividePolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }], () => 20, {
      maxSegment: 1, maxPoints: 2,
    })
    expect(pts).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }])
  })

  it('preserves first/last and full span when projected budget is smaller than a long polyline', () => {
    const source = Array.from({ length: 50 }, (_, i) => ({ x: i * 2, y: 0 }))
    const out = subdividePolyline(source, () => 0, { maxSegment: 0.1, maxPoints: 5 })
    expect(out.length).toBe(5)
    expect(out[0]).toEqual(source[0])
    expect(out[out.length - 1]).toEqual(source[source.length - 1])
    expect(out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })

  it('allocates projected budget without dropping the tail of a sparse long segment', () => {
    const source = [{ x: 0, y: 0 }, { x: 100, y: 0 }]
    const out = subdividePolyline(source, () => 0, { maxSegment: 1, maxPoints: 5 })
    expect(out.length).toBe(5)
    expect(out[0]).toEqual(source[0])
    expect(out[out.length - 1]).toEqual(source[1])
  })

  it('smooths semantic XZ lightly while preserving endpoints and staying in the segment hull', () => {
    const source = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]
    const out = smoothPolyline(source)
    expect(out[0]).toEqual(source[0])
    expect(out[out.length - 1]).toEqual(source[2])
    expect(out.length).toBe(6)
    expect(out.every((p) => p.x >= 0 && p.x <= 10 && p.y >= 0 && p.y <= 10)).toBe(true)
    expect(out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })

  it('caps output at maxPoints and keeps the result finite', () => {
    const pts = subdividePolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }], () => 20, {
      maxSegment: 1, maxPoints: 5,
    })
    expect(pts.length).toBeLessThanOrEqual(5)
    expect(pts.length).toBeGreaterThanOrEqual(2)
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })
})

describe('buildPenRibbon', () => {
  it('emits left/right edges at half width and drapes both independently on a cross slope', () => {
    const surface = (x, z) => 20 + 0.3 * z
    const ribbon = buildPenRibbon(pen([{ x: 0, y: 0 }, { x: 10, y: 0 }], 2, '#40c4ff'), {
      sampleHeight: surface, lift: 0, maxSegment: 100,
    })
    expect(ribbon).not.toBeNull()
    expect(ribbon.vertexCount).toBeLessThanOrEqual(ribbon.vertexBudget)
    expect(ribbon.strips[0].rowCount).toBe(2)
    const strip = ribbon.strips[0]
    const n = strip.crossCount
    for (let k = 0; k < strip.rowCount; k++) {
      const li = (k * n) * 3
      const ri = (k * n + n - 1) * 3
      const left = { z: strip.positions[li + 2], y: strip.positions[li + 1] }
      const right = { z: strip.positions[ri + 2], y: strip.positions[ri + 1] }
      expect(Math.abs(left.z - right.z)).toBeCloseTo(2, 6)
      expect((left.z + right.z) / 2).toBeCloseTo(0, 6)
      expect(left.y).toBeCloseTo(20 + 0.3 * left.z, 5)
      expect(right.y).toBeCloseTo(20 + 0.3 * right.z, 5)
    }
  })

  it('satisfies the per-edge terrain oracle on flat, slope, ridge and valley', () => {
    const cases = [
      ['flat', () => 20, [{ x: -10, y: -8 }, { x: 10, y: 8 }]],
      ['slope', (x) => 20 + 0.2 * x, [{ x: -20, y: -5 }, { x: 20, y: 5 }]],
      ['ridge', (x) => 30 - 0.05 * Math.abs(x), [{ x: -30, y: 0 }, { x: 30, y: 0 }]],
      ['valley', (x) => 20 + 0.01 * x * x, [{ x: -30, y: -10 }, { x: 30, y: 10 }]],
    ]
    for (const [name, surface, points] of cases) {
      const ribbon = buildPenRibbon(pen(points, 1.8), { sampleHeight: surface, lift: ANNOTATION_LIFT })
      expect(ribbon, name).not.toBeNull()
      expectDraped(ribbon, surface)
    }
  })

  it('keeps triangle interiors above convex ridge, valley and cross-slope terrain', () => {
    const cases = [
      ['flat', () => 20, [{ x: -10, y: 0 }, { x: 10, y: 0 }], 2],
      ['slope', (x) => 20 + 0.2 * x, [{ x: -10, y: 0 }, { x: 10, y: 0 }], 2],
      ['ridge', (x, z) => 20 - 0.5 * Math.abs(z), [{ x: -10, y: 0 }, { x: 10, y: 0 }], 8],
      ['valley', (x, z) => 20 + 0.5 * Math.abs(z), [{ x: -10, y: 0 }, { x: 10, y: 0 }], 8],
      ['cross-slope', (x, z) => 20 + 0.3 * z, [{ x: -10, y: 0 }, { x: 10, y: 0 }], 2],
    ]
    for (const [name, surface, points, width] of cases) {
      const ribbon = buildPenRibbon(pen(points, width), { sampleHeight: surface, lift: 0 })
      expect(ribbon, name).not.toBeNull()
      expect(ribbon.validation.unsafeCells, name).toBe(0)
      let triangles = 0
      for (const strip of ribbon.strips) {
        const n = strip.crossCount
        for (let i = 0; i < strip.indices.length; i += 3) {
          const ia = strip.indices[i] * 3
          const ib = strip.indices[i + 1] * 3
          const ic = strip.indices[i + 2] * 3
          const ax = strip.positions[ia]; const ay = strip.positions[ia + 1]; const az = strip.positions[ia + 2]
          const bx = strip.positions[ib]; const by = strip.positions[ib + 1]; const bz = strip.positions[ib + 2]
          const cx = strip.positions[ic]; const cy = strip.positions[ic + 1]; const cz = strip.positions[ic + 2]
          // 重心 + 三个偏向顶点的重心采样；只查 mesh 线性插值是否低于 terrain。
          for (const [wa, wb, wc] of [
            [1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6],
            [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5],
          ]) {
            const x = wa * ax + wb * bx + wc * cx
            const y = wa * ay + wb * by + wc * cy
            const z = wa * az + wb * bz + wc * cz
            expect(y, name).toBeGreaterThanOrEqual(surface(x, z) - 1e-6)
          }
          triangles++
        }
        expect(n).toBeGreaterThanOrEqual(2)
      }
      expect(triangles, name).toBeGreaterThan(0)
    }
  })

  it('bounds cross-width tessellation for a long wide stroke without dropping the tail', () => {
    const points = Array.from({ length: 4096 }, (_, i) => ({ x: (i / 4095) * 200 - 100, y: 0 }))
    const ribbon = buildPenRibbon(pen(points, 40), { sampleHeight: () => 20, lift: 0, maxSegment: 1e9 })
    expect(ribbon).not.toBeNull()
    expect(ribbon.vertexCount).toBeLessThanOrEqual(ribbon.vertexBudget)
    expect(ribbon.vertexCount).toBeLessThanOrEqual(65536)
    expect(ribbon.strips.every((strip) => Number.isFinite(strip.positions[strip.positions.length - 1]))).toBe(true)
  })

  it('refines cells until the exact diagonal ridge reproduction clears terrain', () => {
    const n = 128
    const span = 128
    const field = new Float32Array(n * n)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) field[i * n + j] = 20 - Math.abs(i - 64)
    }
    const build = buildAdaptiveTerrain({
      field,
      n,
      span,
      cam: { x: 0, y: 40, z: 20 },
      fovY: 0.96,
      aspect: 1.7,
      hFovDeg: 70,
    })
    const sampler = terrainSurfaceHeightAt.bind(null, { ...build, n, span })
    const ribbon = buildPenRibbon(pen([{ x: -10, y: -10 }, { x: 10, y: 10 }], 2), {
      sampleHeight: sampler,
      lift: ANNOTATION_LIFT,
    })
    expect(ribbon).not.toBeNull()
    expect(ribbon.validation.unsafeCells).toBe(0)
    expect(ribbon.validation.iterations).toBeGreaterThan(0)
    expectTrianglesClear(ribbon, sampler)
  })

  it('fails closed by skipping unsafe cells when refinement budget is exhausted', () => {
    const points = Array.from({ length: 4096 }, (_, i) => ({ x: (i / 4095) * 200 - 100, y: 0 }))
    const surface = (x, z) => 20 - Math.abs(((z + 100) % 1) - 0.5)
    const ribbon = buildPenRibbon(pen(points, 40), { sampleHeight: surface, lift: 0, maxSegment: 1e9 })
    expect(ribbon).not.toBeNull()
    expect(ribbon.validation.unsafeCells).toBeGreaterThan(0)
    // unsafe cells are omitted; if any safe triangle is emitted it must still be clear.
    expectTrianglesClear(ribbon, surface, { allowEmpty: true })
  })

  it('normalizes at commit and uses the same centerline for rendering and erasing', () => {
    const raw = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]
    const normalized = normalizePenPoints(raw)
    expect(normalized[0]).toEqual(raw[0])
    expect(normalized[normalized.length - 1]).toEqual(raw[2])
    expect(normalized).not.toEqual(raw)

    const committed = pen(normalized, 1)
    const ribbon = buildPenRibbon(committed, { sampleHeight: () => 20, lift: 0, maxSegment: 1e9 })
    expect(ribbon).not.toBeNull()
    // Renderer consumes normalized points; raw peak (10,10) must not appear as a centerline row.
    const verts = ribbonVertices(ribbon)
    expect(verts.some((v) => Math.abs(v.x - 10) < 1e-6 && Math.abs(v.z - 10) < 1e-6)).toBe(false)

    const eraser = [{ x: 10, y: 8 }]
    const rawAnn = pen(raw, 1)
    expect(applyEraser([rawAnn], eraser, 0.5)).toEqual([rawAnn])
    const erased = applyEraser([committed], eraser, 0.5)
    expect(erased).not.toBe(committed)
    expect(erased.length).toBe(2)

    let state = commit([[]], 0, [committed])
    const original = state.history[state.index][0]
    state = commit(state.history, state.index, applyEraser(state.history[state.index], eraser, 0.5))
    const erasedSnapshot = state.history[state.index]
    state = undo(state.history, state.index)
    expect(state.history[state.index][0]).toBe(original)
    state = redo(state.history, state.index)
    expect(state.history[state.index]).toBe(erasedSnapshot)
  })

  it('bounds the committed centerline while preserving endpoints and full span', () => {
    const raw = Array.from({ length: 4096 }, (_, i) => ({ x: i, y: i % 2 }))
    const normalized = normalizePenPoints(raw)
    expect(normalized.length).toBeLessThanOrEqual(ANNOTATION_MAX_COMMITTED_POINTS)
    expect(normalized[0]).toEqual(raw[0])
    expect(normalized[normalized.length - 1]).toEqual(raw[raw.length - 1])
    expect(normalized.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })

  it('refines cross samples for an off-grid convex ridge instead of trusting fixed spacing', () => {
    const surface = (x, z) => 20 - Math.abs(z - 0.25)
    const ribbon = buildPenRibbon(pen([{ x: -10, y: 0 }, { x: 10, y: 0 }], 2), { sampleHeight: surface, lift: 0 })
    expect(ribbon).not.toBeNull()
    expect(ribbon.crossCount).toBeGreaterThanOrEqual(5)
    expect(ribbon.validation.unsafeCells).toBe(0)
    expectTrianglesClear(ribbon, surface)
  })

  it('refines sharp miter rows using their actual transverse span', () => {
    const surface = (x, z) => 20 - 0.5 * Math.abs(z - 0.25)
    const ribbon = buildPenRibbon(pen([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 8), { sampleHeight: surface, lift: 0 })
    expect(ribbon).not.toBeNull()
    expect(ribbon.crossCount).toBeGreaterThanOrEqual(5)
    expect(ribbon.validation.unsafeCells).toBe(0)
    expectTrianglesClear(ribbon, surface)
  })

  it('handles duplicate semantic points without NaN', () => {
    const ribbon = buildPenRibbon(pen([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]), {
      sampleHeight: () => 20, maxSegment: 100,
    })
    expect(ribbon).not.toBeNull()
    expect(ribbon.pointCount).toBeGreaterThanOrEqual(3)
    expectDraped(ribbon, () => 20)
  })

  it('clamps a 90 degree miter and keeps the 180 degree turn finite', () => {
    const surface = () => 20
    const corner = buildPenRibbon(pen([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 2), {
      sampleHeight: surface, maxSegment: 100,
    })
    expect(corner).not.toBeNull()
    expectDraped(corner, surface)
    const verts = ribbonVertices(corner)
    const cornerVerts = verts.filter((v) => Math.hypot(v.x - 10, v.z) <= 1 * ANNOTATION_MITER_LIMIT + 1e-6)
    expect(cornerVerts.length).toBeGreaterThanOrEqual(2)
    for (const v of cornerVerts) {
      expect(Math.hypot(v.x - 10, v.z)).toBeLessThanOrEqual(1 * ANNOTATION_MITER_LIMIT + 1e-6)
    }
    const turn = buildPenRibbon(pen([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }], 1), {
      sampleHeight: surface, maxSegment: 100,
    })
    expect(turn).not.toBeNull()
    expect(turn.strips.length).toBeGreaterThan(0)
    for (const v of ribbonVertices(turn)) {
      expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true)
    }
    expectDraped(turn, surface)
  })

  it('breaks the strip where edge sampling has no terrain', () => {
    const surface = (x) => (x < 20 ? 20 : null)
    const ribbon = buildPenRibbon(pen([{ x: 0, y: 0 }, { x: 40, y: 0 }], 1), {
      sampleHeight: surface, maxSegment: 10,
    })
    expect(ribbon).not.toBeNull()
    expect(ribbon.strips.length).toBe(1)
    const verts = ribbonVertices(ribbon)
    expect(verts.length).toBeGreaterThan(0)
    for (const v of verts) {
      expect(v.x).toBeLessThan(20)
      expect(v.y).toBeCloseTo(20 + ANNOTATION_LIFT, 4)
    }
    expect(buildPenRibbon(pen([{ x: 10, y: 0 }, { x: 80, y: 0 }], 1), {
      sampleHeight: () => null, maxSegment: 100,
    })).toBeNull()
  })

  it('rejects a non-pen annotation or invalid width', () => {
    expect(buildPenRibbon({ type: 'line', points: [] }, { sampleHeight: () => 0 })).toBeNull()
    expect(buildPenRibbon(pen([{ x: 0, y: 0 }, { x: 1, y: 0 }], 0), { sampleHeight: () => 0 })).toBeNull()
    expect(buildPenRibbon(pen([{ x: 0, y: 0 }, { x: 1, y: 0 }], 1), {})).toBeNull()
  })

  it('matches an independent downward raycast against the real adaptive terrain mesh', () => {
    const n = 128
    const span = 600
    const field = new Float32Array(n * n)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        field[i * n + j] = 20 + 6 * Math.sin(i / 11) * Math.cos(j / 13) + 2 * Math.sin((i + j) / 7)
      }
    }
    const build = buildAdaptiveTerrain({
      field, n, span,
      cam: { x: 0, y: 200, z: 120 },
      fovY: (55 * Math.PI) / 180,
      aspect: 16 / 9,
      hFovDeg: 70,
    })
    const sampler = terrainSurfaceHeightAt.bind(null, { ...build, n, span })
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(build.positions, 3))
    geometry.setIndex(new THREE.BufferAttribute(build.indices, 1))
    geometry.computeBoundingSphere()
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    mesh.updateMatrixWorld(true)
    const raycaster = new THREE.Raycaster()
    const ribbon = buildPenRibbon(pen([{ x: -120, y: -70 }, { x: 120, y: 80 }], 1.2), {
      sampleHeight: sampler, lift: 0.05, maxSegment: 2,
    })
    expect(ribbon).not.toBeNull()
    let checked = 0
    for (const v of ribbonVertices(ribbon)) {
      raycaster.set(new THREE.Vector3(v.x, 200, v.z), new THREE.Vector3(0, -1, 0))
      const hits = raycaster.intersectObject(mesh, false)
      if (!hits.length) continue
      checked++
      expect(v.y - 0.05).toBeCloseTo(hits[0].point.y, 3)
    }
    expect(checked).toBeGreaterThan(10)
  })
})

describe('buildEraserRing', () => {
  it('emits a closed terrain-draped ring at the requested radius', () => {
    const surface = (x, z) => 20 + 0.1 * z
    const ring = buildEraserRing({ x: 3, y: -4 }, 5, surface, { segments: 24, lift: 0.02 })
    expect(ring).not.toBeNull()
    expect(ring.segments).toBe(24)
    const verts = ringVertices(ring)
    expect(verts).toHaveLength(24)
    for (const v of verts) {
      expect(Math.hypot(v.x - 3, v.z + 4)).toBeCloseTo(5, 5)
      expect(v.y).toBeCloseTo(surface(v.x, v.z) + 0.02, 4)
    }
    expect(ANNOTATION_RING_SEGMENTS).toBeGreaterThanOrEqual(24)
  })

  it('falls back to the center height when the ring leaves the terrain', () => {
    const surface = (x, z) => (z > 0 ? null : 20)
    const ring = buildEraserRing({ x: 0, y: 0 }, 5, surface, { segments: 16 })
    expect(ring).not.toBeNull()
    for (const v of ringVertices(ring)) {
      expect(Number.isFinite(v.y)).toBe(true)
      expect(v.y).toBeCloseTo(20 + ANNOTATION_LIFT / 2, 4)
    }
  })

  it('rejects invalid radius or center', () => {
    expect(buildEraserRing({ x: 0, y: 0 }, 0, () => 0)).toBeNull()
    expect(buildEraserRing(null, 4, () => 0)).toBeNull()
    expect(buildEraserRing({ x: 0, y: 0 }, 4, null)).toBeNull()
  })
})
