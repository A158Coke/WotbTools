import {
  ANNOTATION_LIFT, ANNOTATION_MAX_SEGMENT, ANNOTATION_MIDPOINT_ERROR, ANNOTATION_MAX_DEPTH,
  ANNOTATION_MAX_PROJECTED_POINTS, ANNOTATION_MITER_LIMIT, ANNOTATION_CROSS_MIDPOINT_ERROR,
  ANNOTATION_CROSS_MAX_SEGMENT, ANNOTATION_MAX_CROSS_SAMPLES, ANNOTATION_MAX_RIBBON_VERTICES,
  ANNOTATION_CLEARANCE_EPS, ANNOTATION_MAX_REFINEMENT_ITERATIONS, ANNOTATION_VALIDATION_MAX_DEPTH,
  ANNOTATION_VALIDATION_EDGE_LIMIT, ANNOTATION_VALIDATION_DEVIATION_TRIGGER,
  ANNOTATION_MAX_PROJECTED_CENTERLINE_POINTS, EPS, normalizeNormal, sampleOrNull, numberOr,
  pointAt, subdividePolyline,
} from './annotationPoints.js'
import type { SemanticPoint, PenAnnotation, HeightSampler } from './annotationPoints.js'

const TRIANGLE_CLEARANCE_SAMPLES = [
  [1 / 3, 1 / 3, 1 / 3],
  [0.5, 0.25, 0.25],
  [0.25, 0.5, 0.25],
  [0.25, 0.25, 0.5],
  [0.5, 0.5, 0],
  [0, 0.5, 0.5],
  [0.5, 0, 0.5],
]

interface RibbonFrame {
  x: number
  z: number
  nx: number
  nz: number
  half: number
  surfaceY?: number
  normal: { x: number; y: number; z: number } | null
}

function ribbonFrames(points: SemanticPoint[], half: number): RibbonFrame[] | null {
  const frames = []
  for (let i = 0; i < points.length; i++) {
    const prev = points[i - 1]
    const cur = points[i]
    const next = points[i + 1]
    const dirIn = prev ? unitDirection(prev, cur) : null
    const dirOut = next ? unitDirection(cur, next) : null
    let dx = 0
    let dz = 0
    let miter = 1
    if (dirIn && dirOut) {
      dx = dirIn.x + dirOut.x
      dz = dirIn.z + dirOut.z
      const len = Math.hypot(dx, dz)
      if (len <= 1e-6) {
        dx = dirOut.x
        dz = dirOut.z
      } else {
        dx /= len
        dz /= len
      }
      const cosT = Math.max(-1, Math.min(1, dirIn.x * dirOut.x + dirIn.z * dirOut.z))
      const cosHalf = Math.sqrt(Math.max(1e-6, (1 + cosT) / 2))
      miter = Math.min(ANNOTATION_MITER_LIMIT, 1 / Math.max(0.4, cosHalf))
    } else if (dirIn) {
      dx = dirIn.x
      dz = dirIn.z
    } else if (dirOut) {
      dx = dirOut.x
      dz = dirOut.z
    } else {
      return null
    }
    frames.push({
      x: cur.x, z: cur.y, nx: -dz, nz: dx, half: half * miter,
      surfaceY: Number.isFinite(cur.surfaceY) ? cur.surfaceY : undefined,
      normal: normalizeNormal(cur.surfaceN) || null,
    })
  }
  return frames
}

function ribbonRows(frames: RibbonFrame[], fractions: number[], sampleHeight: HeightSampler | null | undefined, liftValue: number) {
  const rows: Array<Array<{ x: number; y: number; z: number } | null>> = []
  const valid: boolean[] = []
  for (const frame of frames) {
    const row: Array<{ x: number; y: number; z: number } | null> = []
    let rowValid = true
    const anchored = Number.isFinite(frame.surfaceY)
    for (const fraction of fractions) {
      if (anchored) {
        const p = crossPoint3D(frame, fraction, liftValue)
        row.push({ x: p.x, y: p.y, z: p.z })
        continue
      }
      const p = crossPoint(frame, fraction)
      const y = sampleOrNull(sampleHeight, p.x, p.z)
      if (y === null) {
        row.push(null)
        rowValid = false
      } else {
        row.push({ x: p.x, y: y + liftValue, z: p.z })
      }
    }
    rows.push(row)
    valid.push(rowValid)
  }
  return { rows, valid }
}

function triangleClear(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, c: { x: number; y: number; z: number }, sampleHeight: HeightSampler | null | undefined, clearance: number, depth = 0): boolean {
  const ta = sampleOrNull(sampleHeight, a.x, a.z)
  const tb = sampleOrNull(sampleHeight, b.x, b.z)
  const tc = sampleOrNull(sampleHeight, c.x, c.z)
  if (ta === null || tb === null || tc === null) return false
  let maxDeviation = 0
  for (const [wa, wb, wc] of TRIANGLE_CLEARANCE_SAMPLES) {
    const x = wa * a.x + wb * b.x + wc * c.x
    const y = wa * a.y + wb * b.y + wc * c.y
    const z = wa * a.z + wb * b.z + wc * c.z
    const terrain = sampleOrNull(sampleHeight, x, z)
    if (terrain === null || y < terrain - clearance) return false
    maxDeviation = Math.max(maxDeviation, Math.abs(terrain - (wa * ta + wb * tb + wc * tc)))
  }
  const maxEdge = Math.max(
    Math.hypot(a.x - b.x, a.z - b.z),
    Math.hypot(b.x - c.x, b.z - c.z),
    Math.hypot(c.x - a.x, c.z - a.z),
  )
  const converged = maxDeviation <= ANNOTATION_VALIDATION_DEVIATION_TRIGGER
    && maxEdge <= ANNOTATION_VALIDATION_EDGE_LIMIT
  if (converged) return true
  if (depth >= ANNOTATION_VALIDATION_MAX_DEPTH) return false
  const ab = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
  const bc = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2, z: (b.z + c.z) / 2 }
  const ca = { x: (c.x + a.x) / 2, y: (c.y + a.y) / 2, z: (c.z + a.z) / 2 }
  return triangleClear(a, ab, ca, sampleHeight, clearance, depth + 1)
    && triangleClear(ab, b, bc, sampleHeight, clearance, depth + 1)
    && triangleClear(ca, bc, c, sampleHeight, clearance, depth + 1)
    && triangleClear(ab, bc, ca, sampleHeight, clearance, depth + 1)
}

type RibbonCell = { x: number; y: number; z: number } | null

function ribbonCellFailures(rows: RibbonCell[][], valid: boolean[], crossCount: number, sampleHeight: HeightSampler | null | undefined, clearance: number) {
  const failing: Array<{ i: number; j: number }> = []
  let checked = 0
  for (let i = 0; i < rows.length - 1; i++) {
    if (!valid[i] || !valid[i + 1]) continue
    for (let j = 0; j < crossCount - 1; j++) {
      const a = rows[i][j]
      const b = rows[i][j + 1]
      const c = rows[i + 1][j + 1]
      const d = rows[i + 1][j]
      if (!a || !b || !c || !d) continue
      checked++
      if (!triangleClear(a, b, d, sampleHeight, clearance)
        || !triangleClear(b, c, d, sampleHeight, clearance)) {
        failing.push({ i, j })
      }
    }
  }
  return { failing, checked }
}

function unitDirection(a: SemanticPoint, b: SemanticPoint) {
  const dx = b.x - a.x
  const dz = b.y - a.y
  const len = Math.hypot(dx, dz)
  if (!(len > EPS)) return null
  return { x: dx / len, z: dz / len }
}

function annotationCrossBudget(pointCount: number): number {
  return Math.max(2, Math.min(ANNOTATION_MAX_CROSS_SAMPLES, Math.floor(ANNOTATION_MAX_RIBBON_VERTICES / Math.max(1, pointCount))))
}

function crossPoint(frame: RibbonFrame, fraction: number) {
  const offset = frame.half * (1 - 2 * fraction)
  return { x: frame.x + frame.nx * offset, z: frame.z + frame.nz * offset }
}

function crossPoint3D(frame: RibbonFrame, fraction: number, liftValue: number) {
  const offset = frame.half * (1 - 2 * fraction)
  const x = frame.x + frame.nx * offset
  const z = frame.z + frame.nz * offset
  const anchor = frame.surfaceY as number
  let y = anchor
  const n = frame.normal
  if (n && Math.abs(n.y) > 1e-6) {
    y = anchor - (n.x * (x - frame.x) + n.z * (z - frame.z)) / n.y
  }
  return { x, y: y + liftValue, z }
}

function crossIntervalNeedsSplit(frames: RibbonFrame[], sampleHeight: HeightSampler | null | undefined, fa: number, fb: number): boolean {
  const fm = (fa + fb) / 2
  for (const frame of frames) {
    if (Number.isFinite(frame.surfaceY)) {
      const pa = crossPoint3D(frame, fa, 0)
      const pb = crossPoint3D(frame, fb, 0)
      if (Math.hypot(pb.x - pa.x, pb.z - pa.z) > ANNOTATION_CROSS_MAX_SEGMENT) return true
      continue
    }
    const pa = crossPoint(frame, fa)
    const pb = crossPoint(frame, fb)
    const pm = crossPoint(frame, fm)
    const ha = sampleOrNull(sampleHeight, pa.x, pa.z)
    const hb = sampleOrNull(sampleHeight, pb.x, pb.z)
    const hm = sampleOrNull(sampleHeight, pm.x, pm.z)
    if (ha === null || hb === null || hm === null) continue
    if (Math.hypot(pb.x - pa.x, pb.z - pa.z) > ANNOTATION_CROSS_MAX_SEGMENT) return true
    if (Math.abs(hm - (ha + hb) / 2) > ANNOTATION_CROSS_MIDPOINT_ERROR) return true
  }
  return false
}

function adaptiveCrossFractions(frames: RibbonFrame[], sampleHeight: HeightSampler | null | undefined, pointCount: number): number[] {
  const maxSamples = annotationCrossBudget(pointCount)
  if (maxSamples < 3) return [0, 1]
  let fractions = [0, 0.5, 1]
  while (fractions.length < maxSamples) {
    const additions = []
    for (let i = 0; i < fractions.length - 1; i++) {
      if (fractions.length + additions.length >= maxSamples) break
      const a = fractions[i]
      const b = fractions[i + 1]
      if (crossIntervalNeedsSplit(frames, sampleHeight, a, b)) additions.push((a + b) / 2)
    }
    if (!additions.length) break
    fractions = [...fractions, ...additions].sort((a, b) => a - b)
  }
  return fractions
}

export function reprojectRibbonPositions(positions: Float32Array, sampleHeight: HeightSampler, lift = ANNOTATION_LIFT, anchored?: Uint8Array | boolean[] | null): Float32Array {
  for (let i = 0; i + 2 < positions.length; i += 3) {
    if (anchored && anchored[i / 3]) continue
    const y = sampleHeight(positions[i], positions[i + 2])
    if (y != null && Number.isFinite(y)) positions[i + 1] = y + lift
  }
  return positions
}

export interface PenRibbonStrip {
  positions: Float32Array
  indices: Uint32Array
  rowCount: number
  crossCount: number
  anchored: Uint8Array
}

export interface PenRibbonResult {
  strips: PenRibbonStrip[]
  pointCount: number
  crossCount: number
  vertexCount: number
  vertexBudget: number
  validation: {
    iterations: number
    cellsChecked: number
    unsafeCells: number
    rowCount: number
    crossCount: number
  }
}

export function buildPenRibbon(annotation: PenAnnotation | null | undefined, {
  sampleHeight,
  lift = ANNOTATION_LIFT,
  maxSegment = ANNOTATION_MAX_SEGMENT,
  midpointError = ANNOTATION_MIDPOINT_ERROR,
  maxDepth = ANNOTATION_MAX_DEPTH,
  maxPoints = ANNOTATION_MAX_PROJECTED_POINTS,
  refine = true,
}: {
  sampleHeight?: HeightSampler
  lift?: number
  maxSegment?: number
  midpointError?: number
  maxDepth?: number
  maxPoints?: number
  refine?: boolean
} = {}): PenRibbonResult | null {
  if (!annotation || annotation.type !== 'pen') return null
  if (typeof sampleHeight !== 'function') return null
  const width = Number(annotation.width)
  if (!Number.isFinite(width) || width <= 0) return null
  const points = subdividePolyline(annotation.points, sampleHeight, {
    maxSegment, midpointError, maxDepth, maxPoints, maxInputPoints: null,
  })
  if (points.length < 2) return null
  const half = width / 2
  const liftValue = numberOr(lift, ANNOTATION_LIFT)
  let rowPoints = points
  let frames = ribbonFrames(rowPoints, half)
  if (!frames) return null
  let fractions = adaptiveCrossFractions(frames, sampleHeight, rowPoints.length)
  let crossCount = fractions.length
  let rows: RibbonCell[][] = []
  let valid: boolean[] = []
  let failures: { failing: Array<{ i: number; j: number }>; checked: number } = { failing: [], checked: 0 }
  let iterations = 0

  for (; iterations <= ANNOTATION_MAX_REFINEMENT_ITERATIONS; iterations++) {
    const built = ribbonRows(frames, fractions, sampleHeight, liftValue)
    rows = built.rows
    valid = built.valid
    if (!refine) break
    failures = ribbonCellFailures(rows, valid, crossCount, sampleHeight, ANNOTATION_CLEARANCE_EPS)
    if (!failures.failing.length || iterations === ANNOTATION_MAX_REFINEMENT_ITERATIONS) break

    const rowSplits = new Set(failures.failing.map((cell) => cell.i))
    const crossSplits = new Set(failures.failing.map((cell) => cell.j))
    const nextRowCount = rowPoints.length + rowSplits.size
    const nextCrossCount = fractions.length + crossSplits.size
    const canRows = rowSplits.size > 0
      && nextRowCount <= ANNOTATION_MAX_PROJECTED_CENTERLINE_POINTS
      && nextRowCount * fractions.length <= ANNOTATION_MAX_RIBBON_VERTICES
    const canCross = crossSplits.size > 0
      && nextCrossCount <= ANNOTATION_MAX_CROSS_SAMPLES
      && (canRows ? nextRowCount : rowPoints.length) * nextCrossCount <= ANNOTATION_MAX_RIBBON_VERTICES
    if (!canRows && !canCross) break

    let changed = false
    if (canRows) {
      const nextRows = []
      for (let i = 0; i < rowPoints.length; i++) {
        nextRows.push(rowPoints[i])
        if (rowSplits.has(i)) {
          const a = rowPoints[i]
          const b = rowPoints[i + 1]
          nextRows.push(pointAt(a, b, 0.5))
        }
      }
      rowPoints = nextRows
      changed = true
    }
    if (canCross) {
      const nextFractions = new Set(fractions)
      for (const j of crossSplits) nextFractions.add((fractions[j] + fractions[j + 1]) / 2)
      fractions = [...nextFractions].sort((a, b) => a - b)
      crossCount = fractions.length
      changed = true
    }
    if (!changed) break
    if (canRows) {
      frames = ribbonFrames(rowPoints, half)
      if (!frames) return null
    }
  }

  const unsafe = new Set(failures.failing.map((cell) => cell.i * (crossCount - 1) + cell.j))

  const strips = []
  let i = 0
  while (i < rowPoints.length) {
    if (!valid[i]) { i++; continue }
    let j = i
    while (j + 1 < rowPoints.length && valid[j + 1]) j++
    if (j > i) {
      const rowCount = j - i + 1
      const anchored = new Uint8Array(rowCount)
      for (let k = 0; k < rowCount; k++) {
        anchored[k] = Number.isFinite(frames[i + k].surfaceY) ? 1 : 0
      }
      const positions = new Float32Array(rowCount * crossCount * 3)
      const indices: number[] = []
      for (let k = 0; k < rowCount; k++) {
        for (let c = 0; c < crossCount; c++) {
          const cell = rows[i + k][c]
          if (!cell) continue
          const o = (k * crossCount + c) * 3
          positions[o] = cell.x
          positions[o + 1] = cell.y
          positions[o + 2] = cell.z
        }
      }
      for (let k = 0; k < rowCount - 1; k++) {
        for (let c = 0; c < crossCount - 1; c++) {
          const cellKey = (i + k) * (crossCount - 1) + c
          if (unsafe.has(cellKey)) continue
          const a = k * crossCount + c
          const b = a + 1
          const d = a + crossCount
          const e = d + 1
          indices.push(a, b, d, b, e, d)
        }
      }
      strips.push({ positions, indices: new Uint32Array(indices), rowCount, crossCount, anchored })
    }
    i = j + 1
  }
  if (!strips.length) return null
  const vertexCount = strips.reduce((sum, strip) => sum + strip.positions.length / 3, 0)
  return {
    strips,
    pointCount: rowPoints.length,
    crossCount,
    vertexCount,
    vertexBudget: ANNOTATION_MAX_RIBBON_VERTICES,
    validation: {
      iterations,
      cellsChecked: failures.checked,
      unsafeCells: unsafe.size,
      rowCount: rowPoints.length,
      crossCount,
    },
  }
}
