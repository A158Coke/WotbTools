interface StrokeNormal { x: number; y: number; z: number }
interface StrokePoint { x: number; y: number; surfaceY?: number; surfaceN?: StrokeNormal }
type Interval = [number, number]

const ANNOT_ERASE_LAYER_EPS = 0.5

function capsuleIntervals(a: StrokePoint, b: StrokePoint, c: StrokePoint, d: StrokePoint, radius: number): Interval[] {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const ex = d.x - c.x
  const ey = d.y - c.y
  const length2 = ex * ex + ey * ey
  const intervals: Interval[] = []
  const segLength2 = vx * vx + vy * vy
  if (segLength2 <= 1e-12) return intervals

  const addDisc = (p: StrokePoint) => {
    const px = a.x - p.x
    const py = a.y - p.y
    const bq = 2 * (px * vx + py * vy)
    const cq = px * px + py * py - radius * radius
    const disc = bq * bq - 4 * segLength2 * cq
    if (disc < 0) return
    const root = Math.sqrt(disc)
    intervals.push([(-bq - root) / (2 * segLength2), (-bq + root) / (2 * segLength2)])
  }

  if (length2 <= 1e-12) {
    addDisc(c)
    return intervals
  }

  const length = Math.sqrt(length2)
  const ux = ex / length
  const uy = ey / length
  const nx = -uy
  const ny = ux
  const w0 = (a.x - c.x) * nx + (a.y - c.y) * ny
  const wd = vx * nx + vy * ny
  let lineLo = -Infinity
  let lineHi = Infinity
  let bodyPossible = true
  if (Math.abs(wd) <= 1e-12) {
    if (Math.abs(w0) > radius) bodyPossible = false
  } else {
    lineLo = (-radius - w0) / wd
    lineHi = (radius - w0) / wd
    if (lineLo > lineHi) {
      const tmp = lineLo
      lineLo = lineHi
      lineHi = tmp
    }
  }

  const q0 = (a.x - c.x) * ux + (a.y - c.y) * uy
  const qd = vx * ux + vy * uy
  let projLo = -Infinity
  let projHi = Infinity
  if (Math.abs(qd) <= 1e-12) {
    if (q0 < -1e-9 || q0 > length + 1e-9) bodyPossible = false
  } else {
    projLo = -q0 / qd
    projHi = (length - q0) / qd
    if (projLo > projHi) {
      const tmp = projLo
      projLo = projHi
      projHi = tmp
    }
  }

  if (bodyPossible) {
    const lo = Math.max(lineLo, projLo)
    const hi = Math.min(lineHi, projHi)
    if (hi > lo) intervals.push([lo, hi])
  }
  addDisc(c)
  addDisc(d)
  return intervals
}

function mergeCoveredIntervals(intervals: Interval[]): Interval[] {
  const clamped = intervals
    .map(([a, b]): Interval => [Math.max(0, a), Math.min(1, b)])
    .filter(([a, b]) => b > a + 1e-9)
    .sort((p, q) => p[0] - q[0])
  if (!clamped.length) return []
  const out = [clamped[0]]
  for (let i = 1; i < clamped.length; i++) {
    const last = out[out.length - 1]
    const next = clamped[i]
    if (next[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], next[1])
    else out.push(next)
  }
  return out
}

function boxesOverlap(a: number[], b: number[]) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

function pathLength(points: StrokePoint[]) {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return total
}

export function clipPenByEraser(points: (StrokePoint | null | undefined)[], eraserPoints: (StrokePoint | null | undefined)[], radius: number): StrokePoint[][] | null {
  if (!Array.isArray(points) || points.length < 2) return null
  const validNormal = (n: StrokeNormal | undefined): n is StrokeNormal => !!n && Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z)
  const copyPoint = (p: StrokePoint) => {
    const out: StrokePoint = { x: p.x, y: p.y }
    if (Number.isFinite(p.surfaceY)) out.surfaceY = p.surfaceY
    if (validNormal(p.surfaceN)) out.surfaceN = { x: p.surfaceN.x, y: p.surfaceN.y, z: p.surfaceN.z }
    return out
  }
  const cleanPoints: StrokePoint[] = []
  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
    const previous = cleanPoints[cleanPoints.length - 1]
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) <= 1e-9) {
      if (!Number.isFinite(previous.surfaceY) && Number.isFinite(point.surfaceY)) previous.surfaceY = point.surfaceY
      if (!validNormal(previous.surfaceN) && validNormal(point.surfaceN)) previous.surfaceN = point.surfaceN
      continue
    }
    cleanPoints.push(copyPoint(point))
  }
  if (cleanPoints.length < 2) return null
  const cleanEraser: StrokePoint[] = []
  for (const point of eraserPoints) {
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) cleanEraser.push(point)
  }
  if (!cleanEraser.length) return null
  const segments: Array<{ a: StrokePoint; b: StrokePoint }> = []
  if (cleanEraser.length === 1) {
    segments.push({ a: cleanEraser[0], b: cleanEraser[0] })
  } else {
    for (let i = 1; i < cleanEraser.length; i++) {
      segments.push({ a: cleanEraser[i - 1], b: cleanEraser[i] })
    }
  }
  const boxes = segments.map((segment) => [
    Math.min(segment.a.x, segment.b.x) - radius,
    Math.min(segment.a.y, segment.b.y) - radius,
    Math.max(segment.a.x, segment.b.x) + radius,
    Math.max(segment.a.y, segment.b.y) + radius,
  ])

  const pieces: StrokePoint[][] = []
  let current: StrokePoint[] = []
  let changed = false
  const flush = () => {
    if (current.length >= 2 && pathLength(current) > 1e-9) pieces.push(current)
    current = []
  }
  const anchorY = (p: StrokePoint): number | null => (Number.isFinite(p.surfaceY) ? p.surfaceY! : null)
  const normalAt = (p: StrokePoint, q: StrokePoint, k: number) => {
    const np = validNormal(p.surfaceN) ? p.surfaceN : null
    const nq = validNormal(q.surfaceN) ? q.surfaceN : null
    if (!np && !nq) return null
    let nx = 0
    let ny = 0
    let nz = 0
    if (np && nq) {
      nx = np.x + (nq.x - np.x) * k
      ny = np.y + (nq.y - np.y) * k
      nz = np.z + (nq.z - np.z) * k
    } else {
      const n = (np || nq)!
      nx = n.x
      ny = n.y
      nz = n.z
    }
    const len = Math.hypot(nx, ny, nz)
    if (!(len > 1e-6)) return null
    return { x: -nx / len, y: ny / len, z: nz / len }
  }
  const layerDeltaAt = (a: StrokePoint, b: StrokePoint, c: StrokePoint, d: StrokePoint, t: number) => {
    const ay = anchorY(a)
    const by = anchorY(b)
    const cy = anchorY(c)
    const dy = anchorY(d)
    if ((ay === null) !== (by === null)) return null
    if ((cy === null) !== (dy === null)) return null
    if (ay === null) return cy === null ? 0 : null
    if (cy === null) return null
    const sx = a.x + (b.x - a.x) * t
    const sz = a.y + (b.y - a.y) * t
    const ex = d.x - c.x
    const ez = d.y - c.y
    const len2 = ex * ex + ez * ez
    let u = 0
    if (len2 > 1e-12) u = Math.max(0, Math.min(1, ((sx - c.x) * ex + (sz - c.y) * ez) / len2))
    const sy = ay + (by! - ay) * t
    const ey = cy + (dy! - cy) * u
    const strokePoint = { x: sx, z: sz }
    const eraserPoint = { x: c.x + ex * u, z: c.y + ez * u }
    const en = normalAt(c, d, u)
    if (!en) return Math.abs(sy - ey)
    const expectedStrokeY = ey
      - (en.x * (strokePoint.x - eraserPoint.x) + en.z * (strokePoint.z - eraserPoint.z)) / en.y
    return Math.abs(sy - expectedStrokeY)
  }
  const layerCompatibleIntervals = (a: StrokePoint, b: StrokePoint, c: StrokePoint, d: StrokePoint, lo: number, hi: number): Interval[] => {
    const t0 = Math.max(0, lo)
    const t1 = Math.min(1, hi)
    if (!(t1 > t0 + 1e-9)) return []
    const ay = anchorY(a)
    const by = anchorY(b)
    const cy = anchorY(c)
    const dy = anchorY(d)
    if ((ay === null) !== (by === null)) return []
    if ((cy === null) !== (dy === null)) return []
    if (ay === null) return cy === null ? [[t0, t1]] : []
    if (cy === null) return []
    const compatible = (t: number) => {
      const delta = layerDeltaAt(a, b, c, d, t)
      return delta !== null && delta <= ANNOT_ERASE_LAYER_EPS
    }
    const samples = []
    const N = 24
    for (let i = 0; i <= N; i++) {
      const t = t0 + ((t1 - t0) * i) / N
      samples.push({ t, ok: compatible(t) })
    }
    if (samples.every((s) => s.ok)) return [[t0, t1]]
    const boundary = (falseT: number, trueT: number) => {
      let f = falseT
      let t = trueT
      for (let i = 0; i < 16; i++) {
        const m = (f + t) / 2
        if (compatible(m)) t = m
        else f = m
      }
      return (f + t) / 2
    }
    const intervals: Interval[] = []
    let start: number | null = null
    for (let i = 0; i <= N; i++) {
      if (samples[i].ok && start === null) start = i
      if ((!samples[i].ok || i === N) && start !== null) {
        const end = samples[i].ok ? i : i - 1
        const from = start === 0 ? t0 : boundary(samples[start - 1].t, samples[start].t)
        const to = end === N ? t1 : boundary(samples[end + 1].t, samples[end].t)
        if (to > from + 1e-9) intervals.push([from, to])
        start = null
      }
    }
    return intervals
  }
  const lerp = (a: StrokePoint, b: StrokePoint, t: number) => {
    const out: StrokePoint = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    if (Number.isFinite(a.surfaceY) && Number.isFinite(b.surfaceY)) {
      out.surfaceY = a.surfaceY! + (b.surfaceY! - a.surfaceY!) * t
    }
    if (validNormal(a.surfaceN) && validNormal(b.surfaceN)) {
      const nx = a.surfaceN.x + (b.surfaceN.x - a.surfaceN.x) * t
      const ny = a.surfaceN.y + (b.surfaceN.y - a.surfaceN.y) * t
      const nz = a.surfaceN.z + (b.surfaceN.z - a.surfaceN.z) * t
      const len = Math.hypot(nx, ny, nz)
      if (len > 1e-6) out.surfaceN = { x: nx / len, y: ny / len, z: nz / len }
    }
    return out
  }

  for (let i = 1; i < cleanPoints.length; i++) {
    const a = cleanPoints[i - 1]
    const b = cleanPoints[i]
    const strokeBox = [
      Math.min(a.x, b.x) - radius, Math.min(a.y, b.y) - radius,
      Math.max(a.x, b.x) + radius, Math.max(a.y, b.y) + radius,
    ]
    let covered: Interval[] = []
    for (let k = 0; k < segments.length; k++) {
      if (!boxesOverlap(strokeBox, boxes[k])) continue
      const intervals = capsuleIntervals(a, b, segments[k].a, segments[k].b, radius)
      for (const interval of intervals) {
        covered.push(...layerCompatibleIntervals(a, b, segments[k].a, segments[k].b, interval[0], interval[1]))
      }
    }
    covered = mergeCoveredIntervals(covered)
    if (!covered.length) {
      if (!current.length) current.push(copyPoint(a))
      current.push(copyPoint(b))
      continue
    }
    changed = true
    let cursor = 0
    for (const [lo, hi] of covered) {
      if (lo > cursor + 1e-9) {
        const start = cursor <= 1e-9 ? copyPoint(a) : lerp(a, b, cursor)
        if (!current.length) current.push(start)
        current.push(lerp(a, b, lo))
        flush()
      } else {
        flush()
      }
      cursor = Math.max(cursor, hi)
    }
    if (cursor < 1 - 1e-9) {
      const start = cursor <= 1e-9 ? copyPoint(a) : lerp(a, b, cursor)
      if (!current.length) current.push(start)
      current.push(copyPoint(b))
    } else {
      flush()
    }
  }
  flush()
  if (!changed) return null
  return pieces
}
