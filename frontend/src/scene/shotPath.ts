import type { AgentPlaybackShot } from '../api/agent-replay-facets.js'

export type Vec3Tuple = [number, number, number]

export type BallisticShot = Pick<AgentPlaybackShot, 'from' | 'to' | 'via' | 'leg_secs'>

export type Writable3 = { set(x: number, y: number, z: number): unknown } | { [index: number]: number }

function validPolylineLegs(shot: BallisticShot): boolean {
  const via = Array.isArray(shot.via) ? shot.via : []
  const legs = shot.leg_secs
  return via.length > 0
    && Array.isArray(legs)
    && legs.length === via.length + 1
    && legs.every((x) => Number.isFinite(x) && x > 0)
}

export function pathPointsOf(shot: BallisticShot): Vec3Tuple[] {
  const via = Array.isArray(shot.via) ? shot.via : []
  return validPolylineLegs(shot) ? [shot.from, ...via, shot.to] : [shot.from, shot.to]
}

export function legSecsOf(shot: BallisticShot, fallbackSecs: number): number[] {
  return validPolylineLegs(shot) ? (shot.leg_secs as number[]) : [fallbackSecs]
}

export function legEndTimes(legSecs: readonly number[], t0: number): number[] {
  const out: number[] = []
  let acc = t0
  for (const l of legSecs) {
    acc += l
    out.push(acc)
  }
  return out
}

export function pointAt(points: readonly Vec3Tuple[], legEnds: readonly number[], t: number, t0: number): Writable3 {
  return pointAtInto(points, legEnds, t, t0, [])
}

function write3(out: Writable3, x: number, y: number, z: number): Writable3 {
  if ('set' in out) out.set(x, y, z)
  else { out[0] = x; out[1] = y; out[2] = z }
  return out
}

export function pointAtInto(points: readonly Vec3Tuple[], legEnds: readonly number[], t: number, t0: number, out: Writable3): Writable3 {
  const n = legEnds.length
  if (n === 0) return copy3(points[0], out)
  if (t <= t0) return copy3(points[0], out)
  if (t >= legEnds[n - 1]) return copy3(points[points.length - 1], out)
  let k = 0
  while (k < n - 1 && t > legEnds[k]) k++
  const segStart = k === 0 ? t0 : legEnds[k - 1]
  const span = legEnds[k] - segStart
  const f = span > 0 ? (t - segStart) / span : 0
  const a = points[k]
  const b = points[k + 1]
  return write3(out,
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f)
}

function copy3(p: readonly number[], out: Writable3): Writable3 {
  return write3(out, p[0], p[1], p[2])
}

export function legArcEnds(points: readonly Vec3Tuple[]): number[] {
  const out: number[] = []
  let acc = 0
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k]
    const b = points[k + 1]
    acc += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    out.push(acc)
  }
  return out
}

export function pointAtArc(points: readonly Vec3Tuple[], arcEnds: readonly number[], s: number): Writable3 {
  return pointAtArcInto(points, arcEnds, s, [])
}

export function pointAtArcInto(points: readonly Vec3Tuple[], arcEnds: readonly number[], s: number, out: Writable3): Writable3 {
  if (arcEnds.length === 0 || !(s > 0)) return copy3(points[0], out)
  if (s >= arcEnds[arcEnds.length - 1]) return copy3(points[points.length - 1], out)
  let k = 0
  while (k < arcEnds.length - 1 && s > arcEnds[k]) k++
  const segStart = k === 0 ? 0 : arcEnds[k - 1]
  const span = arcEnds[k] - segStart
  const f = span > 0 ? (s - segStart) / span : 0
  const a = points[k]
  const b = points[k + 1]
  return write3(out,
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f)
}

export function arcAtTime(_points: readonly Vec3Tuple[], legEnds: readonly number[], arcEnds: readonly number[], t: number, t0: number): number {
  const n = legEnds.length
  if (n === 0) return 0
  if (t <= t0) return 0
  if (t >= legEnds[n - 1]) return arcEnds[arcEnds.length - 1]
  let k = 0
  while (k < n - 1 && t > legEnds[k]) k++
  const segStart = k === 0 ? t0 : legEnds[k - 1]
  const span = legEnds[k] - segStart
  const f = span > 0 ? (t - segStart) / span : 0
  const before = k === 0 ? 0 : arcEnds[k - 1]
  return before + (arcEnds[k] - before) * f
}
