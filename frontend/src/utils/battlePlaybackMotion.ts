/** Battle Playback route interpolation and observed-position trails. */

import { positionAtV2, positionCoveredAtV2 } from './battlePlaybackV2.js'
import type { PositionSegment, VehiclePlaybackTrack } from '../types/playback-v2.js'

type TimedPoint = { x: number; y: number; timeSec: number }
export type RouteLike = { positionSegments?: PositionSegment[] | null; points?: TimedPoint[] | null }
export type PoseAt = (route: RouteLike, t: number) => { x: number; y: number } | null | undefined
type TrailVehicle = RouteLike & Pick<VehiclePlaybackTrack, 'accountId' | 'friendly'>
type PositionTrail = Pick<VehiclePlaybackTrack, 'accountId' | 'friendly'> & {
  opacity: number
  from?: TimedPoint
  to?: TimedPoint
  point?: TimedPoint
}

/** Legacy point-route interpolation limit. V2 routes use canonical segment boundaries. */
const LEGACY_OBSERVED_GAP_SEC = 5

/**
 * 某时刻车辆位置：
 * - t 早于首点 → null（尚未观测，不显示）
 * - 落在相邻可信点之间且 gap ≤ 5s → 线性插值
 * - gap > 5s（跨越断线/失察）→ null，不穿线
 * - 晚于末点 → 返回最后已知位置（供失察淡化/阵亡标记）
 */
export function positionAt(points: TimedPoint[] | null | undefined, t: number) {
  if (!points || points.length === 0 || !Number.isFinite(t)) return null
  if (t < points[0].timeSec - 1e-6) return null
  // t 恰为采样点（含 gap 后重新上报的首点）：直接返回该点本身；
  // gap > LEGACY_OBSERVED_GAP_SEC 的断线判定只用于「两点之间」的插值，
  // 不适用于落在采样点上的时刻。
  if (t <= points[0].timeSec + 1e-6) {
    return { x: points[0].x, y: points[0].y, timeSec: points[0].timeSec }
  }
  let prev = points[0]
  for (let i = 1; i < points.length; i++) {
    const next = points[i]
    if (t <= next.timeSec + 1e-6) {
      if (t >= next.timeSec - 1e-6) {
        return { x: next.x, y: next.y, timeSec: next.timeSec }
      }
      const gap = next.timeSec - prev.timeSec
      if (gap > LEGACY_OBSERVED_GAP_SEC) return null
      const ratio = gap <= 0 ? 0 : Math.min(1, Math.max(0, (t - prev.timeSec) / gap))
      return {
        x: prev.x + (next.x - prev.x) * ratio,
        y: prev.y + (next.y - prev.y) * ratio,
        timeSec: t
      }
    }
    prev = next
  }
  return { x: prev.x, y: prev.y, timeSec: prev.timeSec }
}

/**
 * 事件时刻严格可信位置：仅当 t 落在该车路线首末点之间、所在相邻点 gap ≤ LEGACY_OBSERVED_GAP_SEC
 * （即 positionAt 返回插值/采样点本身，timeSec === t）且坐标为有限值时返回。
 * 末点之后的最后已知位置、gap 内、首点之前与非有限坐标一律 null——
 * 炮线端点禁止用最后已知位置伪造射击位置。
 */
export function trustedPositionAt(points: TimedPoint[] | null | undefined, t: number) {
  const p = positionAt(points, t)
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
  if (Math.abs(p.timeSec - t) > 1e-6) return null
  return p
}

/**
 * Canonical V2 route position at a shot time; point routes remain legacy-test compatible.
 *
 * `poseAt(route, t)`（可选）= 与 3D 同源的位姿通道取值（`replay-local/pose/vehiclePose.ts`）。
 * **门控不变**：事件时刻必须落在观测区间（`positionCoveredAtV2`）才可信——位姿通道只改"取哪个值"，
 * 不放松"能不能画"（炮线端点禁止用最后已知位置 / 编造位置伪造射击位置）。
 */
export function trustedRoutePosition(route: RouteLike, t: number, poseAt: PoseAt | null = null) {
  if (Array.isArray(route?.positionSegments)) {
    if (!positionCoveredAtV2(route.positionSegments, t)) return null
    if (poseAt) {
      const p = poseAt(route, t)
      return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y, timeSec: t } : null
    }
    const p = positionAtV2(route.positionSegments, t)
    return p && Number.isFinite(p.x) && Number.isFinite(p.y)
      && Math.abs(p.timeSec - t) <= 1e-6 ? p : null
  }
  return trustedPositionAt(route?.points, t)
}

/**
 * Per-segment cache of the validated + time-sorted sample list. Playback data is
 * immutable after parse, so the filter/sort only needs to run once per segment;
 * per-frame window extraction then costs two binary searches + a slice instead of
 * re-filtering and re-sorting every sample of every observed segment at 60 fps.
 */
const trailSamplesCache = new WeakMap<object, PositionSegment['samples']>()

function sortedTrailSamples(segment: PositionSegment, segmentStart: number, segmentEnd: number) {
  let sorted = trailSamplesCache.get(segment)
  if (!sorted) {
    sorted = segment.samples
      .filter(sample => sample && Number.isFinite(sample.timeSec)
        && Number.isFinite(sample.x) && Number.isFinite(sample.y)
        && sample.timeSec >= segmentStart - 1e-6
        && sample.timeSec <= segmentEnd + 1e-6)
      .sort((a, b) => a.timeSec - b.timeSec)
    trailSamplesCache.set(segment, sorted)
  }
  return sorted
}

function lowerBoundTimeSec(sorted: Array<{ timeSec: number }>, t: number) {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid].timeSec < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

function upperBoundTimeSec(sorted: Array<{ timeSec: number }>, t: number) {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid].timeSec <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Build the last battle-relative two seconds of observed positions for each vehicle.
 * V2 segment boundaries and interpolationAllowed are the only interpolation authority:
 * segments are never joined, future samples are never emitted, and LAST_KNOWN/unknown
 * intervals do not extend the visible trail. The current endpoint is queried through
 * canonical segment interpolation when the current time is inside that segment.
 */
export function recentPositionTrails(vehicles: TrailVehicle[] | null | undefined, nowSec: number, windowSec = 2) {
  if (!Array.isArray(vehicles) || !Number.isFinite(nowSec)) return []
  const span = Number.isFinite(windowSec) && windowSec > 0 ? windowSec : 2
  const start = nowSec - span
  const trails: PositionTrail[] = []
  for (const vehicle of vehicles) {
    for (const segment of vehicle?.positionSegments || []) {
      if (segment?.knowledge !== 'OBSERVED'
        || segment.interpolationAllowed === false
        || !Array.isArray(segment.samples)) continue
      const segmentStart = Number.isFinite(segment.startSec) ? segment.startSec : Number.NEGATIVE_INFINITY
      const segmentEnd = Number.isFinite(segment.endSec) ? segment.endSec : Number.POSITIVE_INFINITY
      const samples = sortedTrailSamples(segment, segmentStart, segmentEnd)
      if (samples.length === 0) continue

      const path: TimedPoint[] = []
      const first = samples[0]
      const last = samples[samples.length - 1]
      if (start > first.timeSec + 1e-6 && start < last.timeSec - 1e-6) {
        const clippedStart = positionAtV2([segment], start)
        if (clippedStart && Math.abs(clippedStart.timeSec - start) <= 1e-6) {
          path.push({ ...clippedStart, timeSec: start })
        }
      }
      // window samples are contiguous in the time-sorted list: slice instead of filter
      path.push(...samples.slice(
        lowerBoundTimeSec(samples, start - 1e-6),
        upperBoundTimeSec(samples, nowSec + 1e-6),
      ))
      if (nowSec > first.timeSec + 1e-6 && nowSec < last.timeSec - 1e-6) {
        const current = positionAtV2([segment], nowSec)
        if (current && Math.abs(current.timeSec - nowSec) <= 1e-6) {
          path.push({ ...current, timeSec: nowSec })
        }
      }
      path.sort((a, b) => a.timeSec - b.timeSec)
      const uniquePath = path.filter((point, index) => index === 0
        || Math.abs(point.timeSec - path[index - 1].timeSec) > 1e-6)
      for (let index = 1; index < uniquePath.length; index += 1) {
        const from = uniquePath[index - 1]
        const to = uniquePath[index]
        const age = Math.max(0, nowSec - to.timeSec)
        trails.push({
          accountId: vehicle.accountId,
          friendly: vehicle.friendly,
          from,
          to,
          opacity: 0.12 + 0.58 * Math.max(0, 1 - age / span),
        })
      }
      if (uniquePath.length === 1) {
        const point = uniquePath[0]
        trails.push({
          accountId: vehicle.accountId,
          friendly: vehicle.friendly,
          point,
          opacity: 0.2 + 0.5 * Math.max(0, 1 - Math.max(0, nowSec - point.timeSec) / span),
        })
      }
    }
  }
  return trails
}

/**
 * 位姿通道版尾迹（与 3D 同源的位置序列）。
 *
 * 与 `recentPositionTrails` 的区别只有"取哪个值"：位置来自 `poseAt(vehicle, t)`（= 3D 场景同一
 * 采样器），而**可信度门控 `coveredAt(vehicle, t)` 仍由 canonical 知识层给出**；段外（未观测/
 * AoI 空隙）不连线、不插值——观感与 3D 运动一致，同时保留"最后已知不伪造轨迹"的既有语义。
 *
 * @param poseAt     (vehicle, t) → { x, y } | null（y = 游戏 z）
 * @param coveredAt  (vehicle, t) → boolean（canonical 观测区间）
 */
export function recentPositionTrailsFromPose(
  vehicles: TrailVehicle[] | null | undefined,
  poseAt: PoseAt,
  coveredAt: (vehicle: TrailVehicle, t: number) => boolean,
  nowSec: number,
  windowSec = 2,
  stepSec = 0.1,
) {
  if (!Array.isArray(vehicles) || typeof poseAt !== 'function' || typeof coveredAt !== 'function'
    || !Number.isFinite(nowSec)) return []
  const span = Number.isFinite(windowSec) && windowSec > 0 ? windowSec : 2
  const step = Number.isFinite(stepSec) && stepSec > 0 ? stepSec : 0.1
  const start = nowSec - span
  const trails: PositionTrail[] = []
  for (const vehicle of vehicles) {
    // 从当前时刻向回走；未观测处断链（绝不跨越 AoI 空隙连线）。
    let chain: TimedPoint[] = []
    const emit = () => {
      for (let i = 1; i < chain.length; i += 1) {
        const from = chain[i - 1]
        const to = chain[i]
        const age = Math.max(0, nowSec - to.timeSec)
        trails.push({
          accountId: vehicle.accountId,
          friendly: vehicle.friendly,
          from,
          to,
          opacity: 0.12 + 0.58 * Math.max(0, 1 - age / span),
        })
      }
      if (chain.length === 1) {
        const point = chain[0]
        trails.push({
          accountId: vehicle.accountId,
          friendly: vehicle.friendly,
          point,
          opacity: 0.2 + 0.5 * Math.max(0, 1 - Math.max(0, nowSec - point.timeSec) / span),
        })
      }
      chain = []
    }
    for (let age = 0; age <= span + 1e-9; age += step) {
      const t = nowSec - age
      if (t < start - 1e-9) break
      if (!coveredAt(vehicle, t)) { emit(); continue }
      const p = poseAt(vehicle, t)
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) { emit(); continue }
      chain.unshift({ x: p.x, y: p.y, timeSec: t })
    }
    emit()
  }
  return trails
}
