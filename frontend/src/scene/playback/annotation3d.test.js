import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildAdaptiveTerrain, terrainSurfaceHeightAt } from '../terrainMesh.js'
import {
  ANNOTATION_LIFT,
  ANNOTATION_MITER_LIMIT,
  ANNOTATION_RING_SEGMENTS,
  buildEraserRing,
  buildPenRibbon,
  sanitizePoints,
  subdividePolyline,
} from './annotation3d.js'

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
    const verts = ribbonVertices(ribbon)
    expect(verts).toHaveLength(4)
    for (let i = 0; i < verts.length; i += 2) {
      const left = verts[i]
      const right = verts[i + 1]
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

  it('handles duplicate semantic points without NaN', () => {
    const ribbon = buildPenRibbon(pen([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]), {
      sampleHeight: () => 20, maxSegment: 100,
    })
    expect(ribbon).not.toBeNull()
    expect(ribbon.pointCount).toBe(3)
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
