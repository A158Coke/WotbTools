export interface SemanticPoint {
  x: number
  y: number
  surfaceY?: number
  surfaceN?: { x: number; y: number; z: number }
}

export interface PenAnnotation {
  type: 'pen'
  color?: unknown
  width?: number
  points: SemanticPoint[]
}

export type HeightSampler = (x: number, z: number) => number | null


export const ANNOTATION_LIFT = 0.08
export const ANNOTATION_MAX_SEGMENT = 2
export const ANNOTATION_MIDPOINT_ERROR = 0.08
export const ANNOTATION_MAX_DEPTH = 6
export const ANNOTATION_MAX_INPUT_POINTS = 4096
export const ANNOTATION_MAX_COMMITTED_POINTS = 4096
export const ANNOTATION_MAX_PROJECTED_POINTS = 4096
export const ANNOTATION_MITER_LIMIT = 2.5
export const ANNOTATION_RING_SEGMENTS = 48
export const ANNOTATION_CROSS_MIDPOINT_ERROR = 0.08
export const ANNOTATION_CROSS_MAX_SEGMENT = 0.5
export const ANNOTATION_MAX_CROSS_SAMPLES = 33
export const ANNOTATION_MAX_RIBBON_VERTICES = 65536
export const ANNOTATION_CLEARANCE_EPS = 0.05
export const ANNOTATION_MAX_REFINEMENT_ITERATIONS = 6
export const ANNOTATION_VALIDATION_MAX_DEPTH = 3
export const ANNOTATION_VALIDATION_EDGE_LIMIT = 2
export const ANNOTATION_VALIDATION_DEVIATION_TRIGGER = 0.01
export const ANNOTATION_MAX_PROJECTED_CENTERLINE_POINTS = 4096
export const ANNOTATION_MAX_ERASER_POINTS = 1024

export const EPS = 1e-9
const DUP_EPS = 1e-6

export function numberOr(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function sampleOrNull(sampleHeight: HeightSampler | null | undefined, x: number, z: number): number | null {
  if (typeof sampleHeight !== 'function') return null
  const y = sampleHeight(x, z)
  return Number.isFinite(y) ? y : null
}

function finiteNormal(n: SemanticPoint['surfaceN']): n is { x: number; y: number; z: number } {
  return !!n && Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z)
}

function copyNormal(n: SemanticPoint['surfaceN']): SemanticPoint['surfaceN'] {
  return finiteNormal(n) ? { x: n.x, y: n.y, z: n.z } : undefined
}

export function normalizeNormal(n: SemanticPoint['surfaceN']): SemanticPoint['surfaceN'] {
  if (!finiteNormal(n)) return undefined
  const len = Math.hypot(n.x, n.y, n.z)
  if (!(len > 1e-6)) return undefined
  return { x: n.x / len, y: n.y / len, z: n.z / len }
}

function copyPoint(p: SemanticPoint): SemanticPoint {
  const out: SemanticPoint = { x: p.x, y: p.y }
  if (Number.isFinite(p.surfaceY)) out.surfaceY = p.surfaceY
  const normal = copyNormal(p.surfaceN)
  if (normal) out.surfaceN = normal
  return out
}

export function pointAt(a: SemanticPoint, b: SemanticPoint, t: number): SemanticPoint {
  const out: SemanticPoint = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  if (a.surfaceY != null && b.surfaceY != null && Number.isFinite(a.surfaceY) && Number.isFinite(b.surfaceY)) {
    out.surfaceY = a.surfaceY + (b.surfaceY - a.surfaceY) * t
  }
  if (finiteNormal(a.surfaceN) && finiteNormal(b.surfaceN)) {
    const an = a.surfaceN
    const bn = b.surfaceN
    out.surfaceN = normalizeNormal({
      x: an.x + (bn.x - an.x) * t,
      y: an.y + (bn.y - an.y) * t,
      z: an.z + (bn.z - an.z) * t,
    })
  }
  return out
}

export function sanitizePoints(points: readonly (SemanticPoint | null | undefined)[] | null | undefined, { maxPoints = ANNOTATION_MAX_INPUT_POINTS as number | null }: { maxPoints?: number | null } = {}): SemanticPoint[] {
  if (!Array.isArray(points)) return []
  const finiteLimit = typeof maxPoints === 'number' && Number.isFinite(maxPoints) && maxPoints >= 2
  const limit: number = finiteLimit ? Math.floor(maxPoints as number) : (maxPoints == null || maxPoints === Infinity ? Infinity : ANNOTATION_MAX_INPUT_POINTS)
  const out: SemanticPoint[] = []
  for (const p of points) {
    const x = Number(p && p.x)
    const y = Number(p && p.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const prev = out[out.length - 1]
    if (prev && Math.hypot(x - prev.x, y - prev.y) <= DUP_EPS) {
      if (!Number.isFinite(prev.surfaceY) && Number.isFinite(p.surfaceY)) prev.surfaceY = Number(p.surfaceY)
      if (!prev.surfaceN) {
        const normal = normalizeNormal(p.surfaceN)
        if (normal) prev.surfaceN = normal
      }
      continue
    }
    const next: SemanticPoint = { x, y }
    if (Number.isFinite(p.surfaceY)) next.surfaceY = Number(p.surfaceY)
    const normal = normalizeNormal(p.surfaceN)
    if (normal) next.surfaceN = normal
    out.push(next)
    if (Number.isFinite(limit) && out.length >= limit) break
  }
  return out.length >= 2 ? out : []
}

function resampleByIndex(points: SemanticPoint[], limit: number): SemanticPoint[] {
  if (limit >= points.length) return points.map((p) => ({ ...p }))
  const anchored = (p: SemanticPoint): boolean => Number.isFinite(p.surfaceY)
  const mandatorySet = new Set([0, points.length - 1])
  const transitionPairs = []
  for (let i = 1; i < points.length; i++) {
    if (anchored(points[i]) !== anchored(points[i - 1])) {
      mandatorySet.add(i - 1)
      mandatorySet.add(i)
      transitionPairs.push([i - 1, i])
    }
  }
  const mandatory = [...mandatorySet].sort((a, b) => a - b)
  if (limit <= mandatory.length) {
    const picked = new Set([0, points.length - 1])
    for (let t = transitionPairs.length - 1; t >= 0; t--) {
      for (const idx of transitionPairs[t]) {
        if (picked.size >= limit) break
        if (idx !== 0 && idx !== points.length - 1) picked.add(idx)
      }
    }
    for (const idx of mandatory) {
      if (picked.size >= limit) break
      picked.add(idx)
    }
    return [...picked].sort((a, b) => a - b).slice(0, limit).map((idx) => ({ ...points[idx] }))
  }
  const extra = limit - mandatory.length
  const spans = []
  let totalSpan = 0
  for (let i = 1; i < mandatory.length; i++) {
    const span = mandatory[i] - mandatory[i - 1]
    spans.push({ a: mandatory[i - 1], b: mandatory[i], span, take: 0 })
    totalSpan += span
  }
  if (totalSpan <= 0) return points.slice(0, limit).map((p) => ({ ...p }))
  let remaining = extra
  for (const s of spans) {
    s.take = Math.floor((extra * s.span) / totalSpan)
    remaining -= s.take
  }
  const order = [...spans].sort((x, y) => (y.span * extra) % totalSpan - (x.span * extra) % totalSpan)
  for (let i = 0; i < remaining; i++) order[i % order.length].take++
  const out = [{ ...points[0] }]
  for (const s of spans) {
    for (let j = 1; j <= s.take; j++) {
      const idx = s.a + Math.round(((s.b - s.a) * j) / (s.take + 1))
      out.push({ ...points[idx] })
    }
    out.push({ ...points[s.b] })
  }
  return out
}

export function subdividePolyline(points: readonly (SemanticPoint | null | undefined)[] | null | undefined, sampleHeight: HeightSampler | null | undefined, {
  maxSegment = ANNOTATION_MAX_SEGMENT,
  midpointError = ANNOTATION_MIDPOINT_ERROR,
  maxDepth = ANNOTATION_MAX_DEPTH,
  maxPoints = ANNOTATION_MAX_PROJECTED_POINTS,
  maxInputPoints = ANNOTATION_MAX_INPUT_POINTS as number | null,
}: {
  maxSegment?: number
  midpointError?: number
  maxDepth?: number
  maxPoints?: number
  maxInputPoints?: number | null
} = {}): SemanticPoint[] {
  const clean = sanitizePoints(points, { maxPoints: maxInputPoints })
  if (clean.length < 2) return []
  const limit = Number.isFinite(maxPoints) && maxPoints >= 2 ? Math.floor(maxPoints) : ANNOTATION_MAX_PROJECTED_POINTS
  if (limit <= 2) return [{ ...clean[0] }, { ...clean[clean.length - 1] }]
  if (clean.length >= limit) return resampleByIndex(clean, limit)

  const seg = numberOr(maxSegment, ANNOTATION_MAX_SEGMENT)
  const tol = numberOr(midpointError, ANNOTATION_MIDPOINT_ERROR)
  const depthLimit = Math.max(0, Math.floor(numberOr(maxDepth, ANNOTATION_MAX_DEPTH)))
  const lengths = []
  let totalLength = 0
  for (let i = 1; i < clean.length; i++) {
    const len = Math.hypot(clean[i].x - clean[i - 1].x, clean[i].y - clean[i - 1].y)
    lengths.push(len)
    totalLength += len
  }
  const totalExtra = Math.max(0, limit - clean.length)
  const out = [{ ...clean[0] }]

  const subdivideSegment = (a: SemanticPoint, b: SemanticPoint, depth: number, budget: number): void => {
    let used = 0
    const recurse = (x: SemanticPoint, y: SemanticPoint, d: number): void => {
      const dx = y.x - x.x
      const dz = y.y - x.y
      const dist = Math.hypot(dx, dz)
      let split = dist > seg && d < depthLimit
      const anchored = Number.isFinite(x.surfaceY) && Number.isFinite(y.surfaceY)
      if (!split && !anchored) {
        const sa = sampleOrNull(sampleHeight, x.x, x.y)
        const sb = sampleOrNull(sampleHeight, y.x, y.y)
        if (sa !== null && sb !== null) {
          const mx = (x.x + y.x) / 2
          const mz = (x.y + y.y) / 2
          const sm = sampleOrNull(sampleHeight, mx, mz)
          if (sm !== null && Math.abs(sm - (sa + sb) / 2) > tol && d < depthLimit) split = true
        }
      }
      if (split && used < budget) {
        used++
        const mid = pointAt(x, y, 0.5)
        recurse(x, mid, d + 1)
        recurse(mid, y, d + 1)
        return
      }
      out.push(copyPoint(y))
    }
    recurse(a, b, depth)
  }

  for (let i = 1; i < clean.length; i++) {
    const isLast = i === clean.length - 1
    const remainingSlots = limit - out.length
    const proportional = totalLength > 0
      ? Math.floor((totalExtra * lengths[i - 1]) / totalLength)
      : 0
    const budget = Math.max(0, Math.min(remainingSlots - 1, isLast ? remainingSlots - 1 : proportional))
    subdivideSegment(clean[i - 1], clean[i], 0, budget)
  }
  return out.length >= 2 ? out : []
}

export function smoothPolyline(points: readonly (SemanticPoint | null | undefined)[] | null | undefined, { iterations = 1, strength = 0.2 }: { iterations?: number; strength?: number } = {}): SemanticPoint[] {
  let current = sanitizePoints(points, { maxPoints: null })
  if (current.length < 3) return current
  const rounds = Math.max(0, Math.floor(numberOr(iterations, 1)))
  const s = Math.max(0, Math.min(0.49, numberOr(strength, 0.2)))
  const anchored = (p: SemanticPoint): boolean => Number.isFinite(p.surfaceY)
  const chaikinRun = (run: SemanticPoint[]): SemanticPoint[] => {
    if (run.length < 3) return run.map((p) => ({ ...p }))
    const out = [{ ...run[0] }]
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1]
      const b = run[i]
      out.push(pointAt(a, b, s))
      out.push(pointAt(a, b, 1 - s))
    }
    out.push({ ...run[run.length - 1] })
    return out
  }
  for (let round = 0; round < rounds; round++) {
    const next: SemanticPoint[] = []
    let start = 0
    for (let i = 1; i <= current.length; i++) {
      if (i === current.length || anchored(current[i]) !== anchored(current[start])) {
        next.push(...chaikinRun(current.slice(start, i)))
        start = i
      }
    }
    current = next
  }
  return current
}

export function normalizePenPoints(points: readonly (SemanticPoint | null | undefined)[] | null | undefined): SemanticPoint[] {
  const clean = sanitizePoints(points, { maxPoints: null })
  if (clean.length < 3) return clean.map((p) => ({ ...p }))
  const smoothed = smoothPolyline(clean)
  return smoothed.length > ANNOTATION_MAX_COMMITTED_POINTS
    ? resampleByIndex(smoothed, ANNOTATION_MAX_COMMITTED_POINTS)
    : smoothed
}
