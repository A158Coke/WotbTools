import { GRID_DT, coverageSpanAt, keyframeAt, sampleChannel, sampleChannelWithin, sampleKeyframes, segmentAt, visibilitySpanForSampling, visibilitySpanForSamplingInto } from '../../scene/trackInterp.js'
import { activeEntityAt } from '../canonical/facts.js'
import type { AgentAoiPresence, AgentPoseKeyframes, AgentPlaybackFacet, AgentVehicleTrack } from '../../api/agent-replay-facets.js'

export { GRID_DT, coverageSpanAt, keyframeAt, sampleChannel, sampleChannelWithin, sampleKeyframes, segmentAt, visibilitySpanForSampling }
export type { AgentPoseKeyframes, AgentVehicleTrack }

export interface PoseGrid {
  tStart: number
  samples: number
}

export interface VehiclePoseGame {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  roll: number
  turretAbs: number
  turretRel: number
  gunPitch: number
}

export type PoseDef = Pick<
  AgentVehicleTrack,
  'pos' | 'hull_yaw' | 'hull_pitch' | 'hull_roll' | 'turret_yaw' | 'gun_pitch' | 'pose_kf'
>

export interface PoseFacetVehicle extends PoseDef {
  eid: number
  account_id: number
  coverage: number[]
  visibility?: number[]
}

export interface PoseFacet {
  tStart: number
  samples: number
  vehicles: PoseFacetVehicle[]
  entityStartsByAccount?: Map<number, Map<number, number | null>>
}

export function visibilitySpansByEid(
  visibility: readonly AgentAoiPresence[] | null | undefined,
): Map<number, number[]> {
  const out = new Map<number, number[]>()
  for (const w of visibility ?? []) {
    if (!Number.isFinite(w.t_in)) continue
    const spans = out.get(w.eid) ?? []
    spans.push(w.t_in, w.t_out ?? Number.POSITIVE_INFINITY)
    out.set(w.eid, spans)
  }
  return out
}

export function buildPoseFacet(
  playback: Pick<AgentPlaybackFacet, 'meta' | 'vehicles'> & { visibility?: AgentAoiPresence[] },
  entityStartsByAccount?: Map<number, Map<number, number | null>>,
): PoseFacet {
  const visByEid = visibilitySpansByEid(playback.visibility)
  return {
    tStart: playback.meta.t_start,
    samples: playback.meta.samples,
    vehicles: playback.vehicles.map((v) => ({
      eid: v.eid,
      account_id: v.account_id,
      pos: v.pos,
      hull_yaw: v.hull_yaw,
      hull_pitch: v.hull_pitch,
      hull_roll: v.hull_roll,
      turret_yaw: v.turret_yaw,
      gun_pitch: v.gun_pitch,
      pose_kf: v.pose_kf,
      coverage: v.coverage,
      visibility: visByEid.get(v.eid) ?? v.coverage,
    })),
    ...(entityStartsByAccount ? { entityStartsByAccount } : {}),
  }
}

export function selectActiveDef(
  defs: readonly PoseFacetVehicle[],
  starts: ReadonlyMap<number, number | null> | null | undefined,
  tBattle: number,
): PoseFacetVehicle | null {
  if (defs.length === 0) return null
  if (defs.length === 1) return defs[0]
  if (!starts) return null
  const eid = activeEntityAt(starts, tBattle)
  if (eid === null) return null
  return defs.find((def) => def.eid === eid) ?? null
}

const COVERAGE_EPS = 1e-6

export function poseCoveredAt(
  def: Pick<PoseFacetVehicle, 'coverage'> | null | undefined,
  rawTime: number,
): boolean {
  const spans = def?.coverage
  if (!Array.isArray(spans) || !Number.isFinite(rawTime)) return false
  for (let i = 0; i + 1 < spans.length; i += 2) {
    const start = spans[i]
    const end = spans[i + 1]
    if (typeof start !== 'number' || typeof end !== 'number') continue
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    if (rawTime >= start - COVERAGE_EPS && rawTime <= end + COVERAGE_EPS) return true
  }
  return false
}

export function poseKeyframesOf(def: Pick<PoseDef, 'pose_kf'> | null | undefined): AgentPoseKeyframes | null {
  const k = def?.pose_kf
  return k && Array.isArray(k.t) && k.t.length >= 2 ? k : null
}

export function wrapPi(a: number): number {
  let r = a
  while (r > Math.PI) r -= 2 * Math.PI
  while (r < -Math.PI) r += 2 * Math.PI
  return r
}

function gridChannel(
  arr: readonly number[] | null | undefined,
  t: number,
  grid: PoseGrid,
  span: readonly [number, number] | null,
): number {
  if (!arr || !arr.length) return 0
  if (arr.length === 1) return arr[0]
  if (span) {
    return sampleChannelWithin((i: number) => arr[i], arr.length, t, grid.tStart, GRID_DT, span[0], span[1])
  }
  return sampleChannel((i: number) => arr[i], arr.length, t, grid.tStart, GRID_DT)
}

const _spanScratch: [number, number] = [0, 0]

export function sampleVehiclePoseGame(
  def: PoseDef,
  grid: PoseGrid,
  t: number,
  out: VehiclePoseGame = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, turretAbs: 0, turretRel: 0, gunPitch: 0 },
  visibleSpans?: readonly number[] | null,
): VehiclePoseGame {
  const span = visibleSpans
    ? (visibilitySpanForSamplingInto(visibleSpans, t, _spanScratch) as readonly [number, number] | null)
    : null
  const kf = poseKeyframesOf(def)
  if (kf) {
    const col = (c: number) => (i: number) => kf.pos[i * 3 + c]
    out.x = sampleKeyframes(col(0), kf.t, t)
    out.y = sampleKeyframes(col(1), kf.t, t)
    out.z = sampleKeyframes(col(2), kf.t, t)
    out.yaw = sampleKeyframes((i) => kf.yaw[i], kf.t, t)
    out.pitch = sampleKeyframes((i) => kf.pitch[i], kf.t, t)
  } else {
    const p = def.pos
    const n = grid.samples
    const col = (c: number) => (i: number) => p[i * 3 + c]
    for (const c of [0, 1, 2]) {
      const get = col(c)
      const v = span
        ? sampleChannelWithin(get, n, t, grid.tStart, GRID_DT, span[0], span[1])
        : sampleChannel(get, n, t, grid.tStart, GRID_DT)
      if (c === 0) out.x = v
      else if (c === 1) out.y = v
      else out.z = v
    }
    out.yaw = gridChannel(def.hull_yaw, t, grid, span)
    out.pitch = gridChannel(def.hull_pitch, t, grid, span)
  }
  out.roll = gridChannel(def.hull_roll, t, grid, span)
  out.turretAbs = gridChannel(def.turret_yaw, t, grid, span)
  out.turretRel = wrapPi(out.turretAbs - out.yaw)
  out.gunPitch = gridChannel(def.gun_pitch, t, grid, span)
  return out
}
