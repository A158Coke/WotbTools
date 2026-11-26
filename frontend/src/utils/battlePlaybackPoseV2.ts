import type { PlaybackDirection, PlaybackPosition } from '../types/playback.js'
import type {
  DamageLoss,
  OrientationKnowledge,
  OrientationSample,
  OrientationSegment,
  PositionSample,
  PositionSegment,
  VehiclePlaybackTrack,
} from '../types/playback-v2.js'


export function victimFeedbackAllowedV2(
  track: Pick<VehiclePlaybackTrack, 'positionSegments'> | null | undefined,
  eventTimeSec: number,
) {
  return Number.isFinite(eventTimeSec) && positionCoveredAtV2(track?.positionSegments, eventTimeSec)
}

export function ghostAroundV2(
  loss: Pick<DamageLoss, 'fromHp' | 'toHp' | 'displayCapacityHp'> | null | undefined,
) {
  if (!loss || typeof loss.fromHp !== 'number' || !Number.isFinite(loss.fromHp)
    || typeof loss.toHp !== 'number' || !Number.isFinite(loss.toHp)
    || typeof loss.displayCapacityHp !== 'number' || !Number.isFinite(loss.displayCapacityHp)
    || loss.displayCapacityHp <= 0 || loss.fromHp < loss.toHp) return null
  return {
    prevPct: (loss.fromHp / loss.displayCapacityHp) * 100,
    nextPct: (loss.toHp / loss.displayCapacityHp) * 100,
  }
}

export function positionCoveredAtV2(
  segments: readonly PositionSegment[] | null | undefined,
  t: number,
): boolean {
  if (!Array.isArray(segments)) return false
  return segments.some(s => s.knowledge === 'OBSERVED'
    && t >= s.startSec - 1e-6 && t <= s.endSec + 1e-6)
}

export function observedFreezeTimeAt(
  segments: readonly PositionSegment[] | null | undefined,
  t: number,
): number | null {
  if (!Array.isArray(segments) || segments.length === 0 || !Number.isFinite(t)) return null
  let freeze: number | null = null
  for (const s of segments) {
    if (!s || s.knowledge !== 'OBSERVED' || !Number.isFinite(s.startSec)) continue
    if (s.startSec > t + 1e-6) break
    const end = Number.isFinite(s.endSec) ? s.endSec : s.startSec
    if (t <= end + 1e-6) return t
    freeze = Math.max(freeze ?? Number.NEGATIVE_INFINITY, end)
  }
  return freeze
}

export function positionAtV2(
  positionSegments: readonly PositionSegment[] | null | undefined,
  t: number,
): PlaybackPosition | null {
  if (!Array.isArray(positionSegments) || positionSegments.length === 0 || !Number.isFinite(t)) return null
  let lastSeen: PositionSample | null = null
  for (const seg of positionSegments) {
    if (seg.startSec > t + 1e-6) continue
    const samples = seg.samples || []
    if (samples.length === 0) continue
    if (seg.knowledge === 'OBSERVED' && seg.interpolationAllowed !== false) {
      const lo = samples[0]
      const hi = samples[samples.length - 1]
      if (t >= lo.timeSec - 1e-6 && t <= hi.timeSec + 1e-6) {
        if (lo.timeSec >= t - 1e-6) return { x: lo.x, y: lo.y, timeSec: lo.timeSec }
        let p = samples[0]
        for (let i = 1; i < samples.length; i++) {
          const n = samples[i]
          if (t <= n.timeSec + 1e-6) {
            if (t >= n.timeSec - 1e-6) return { x: n.x, y: n.y, timeSec: n.timeSec }
            const gap = n.timeSec - p.timeSec
            if (gap <= 0) return { x: p.x, y: p.y, timeSec: p.timeSec }
            const ratio = Math.min(1, Math.max(0, (t - p.timeSec) / gap))
            return {
              x: p.x + (n.x - p.x) * ratio,
              y: p.y + (n.y - p.y) * ratio,
              timeSec: t,
            }
          }
          p = n
        }
      }
      if (t > hi.timeSec + 1e-6 && hi.timeSec <= t + 1e-6
          && (lastSeen == null || hi.timeSec > lastSeen.timeSec)) {
        lastSeen = hi
      }
    } else {
      let cand: PositionSample | null = null
      for (const s of samples) {
        if (s.timeSec <= t + 1e-6 && (cand == null || s.timeSec > cand.timeSec)) cand = s
      }
      if (cand && (lastSeen == null || cand.timeSec > lastSeen.timeSec)) lastSeen = cand
    }
  }
  return lastSeen ? { x: lastSeen.x, y: lastSeen.y, timeSec: lastSeen.timeSec } : null
}

export function orientationKnownAt(
  track: Pick<VehiclePlaybackTrack, 'orientationSegments'> | null | undefined,
  t: number,
): OrientationKnowledge | 'UNKNOWN' {
  if (!Array.isArray(track?.orientationSegments) || track.orientationSegments.length === 0) {
    return 'UNKNOWN'
  }
  let lastSeen: OrientationSegment | null = null
  for (const seg of track.orientationSegments) {
    if (t >= seg.startSec - 1e-6 && t <= seg.endSec + 1e-6) {
      return seg.knowledge === 'CURRENT' || seg.knowledge === 'LAST_KNOWN'
        ? seg.knowledge : 'UNKNOWN'
    }
    if (seg.startSec <= t) {
      lastSeen = seg
    }
  }
  return (lastSeen && t > lastSeen.endSec + 1e-6) ? 'LAST_KNOWN' : 'UNKNOWN'
}

export function orientationAtV2(
  orientationSegments: readonly OrientationSegment[] | null | undefined,
  t: number,
): PlaybackDirection | null {
  if (!Array.isArray(orientationSegments) || orientationSegments.length === 0 || !Number.isFinite(t)) return null
  let lastSeen: OrientationSample | null = null
  for (const seg of orientationSegments) {
    if (seg.startSec > t + 1e-6) continue
    const samples = seg.samples || []
    if (samples.length === 0) continue
    const lo = samples[0]
    const hi = samples[samples.length - 1]
    if (t >= lo.timeSec - 1e-6 && t <= hi.timeSec + 1e-6) {
      if (seg.knowledge !== 'CURRENT' && seg.knowledge !== 'LAST_KNOWN') continue
      if (seg.knowledge === 'LAST_KNOWN') {
        let cand: OrientationSample | null = null
        for (const s of samples) {
          if (s.timeSec <= t + 1e-6 && (cand == null || s.timeSec > cand.timeSec)) cand = s
        }
        if (cand) {
          return { hullYawDeg: cand.hullYawDeg, turretRelativeYawDeg: cand.turretRelativeYawDeg, timeSec: cand.timeSec }
        }
      }
      if (lo.timeSec >= t - 1e-6) {
        return { hullYawDeg: lo.hullYawDeg, turretRelativeYawDeg: lo.turretRelativeYawDeg, timeSec: lo.timeSec }
      }
      let p = samples[0]
      for (let i = 1; i < samples.length; i++) {
        const n = samples[i]
        if (t <= n.timeSec + 1e-6) {
          if (t >= n.timeSec - 1e-6) {
            return { hullYawDeg: n.hullYawDeg, turretRelativeYawDeg: n.turretRelativeYawDeg, timeSec: n.timeSec }
          }
          const gap = n.timeSec - p.timeSec
          if (gap <= 0) return { hullYawDeg: p.hullYawDeg, turretRelativeYawDeg: p.turretRelativeYawDeg, timeSec: p.timeSec }
          const ratio = Math.min(1, Math.max(0, (t - p.timeSec) / gap))
          const norm = (a: number) => ((a + 180) % 360 + 360) % 360 - 180
          const shortest = (a: number, b: number) => norm(a - b)
          const interpolate = (previous: number | null, next: number | null) => {
            if (typeof previous !== 'number' || !Number.isFinite(previous)
              || typeof next !== 'number' || !Number.isFinite(next)) return null
            return norm(previous + shortest(next, previous) * ratio)
          }
          return {
            hullYawDeg: interpolate(p.hullYawDeg, n.hullYawDeg),
            turretRelativeYawDeg: interpolate(p.turretRelativeYawDeg, n.turretRelativeYawDeg),
            timeSec: t,
          }
        }
        p = n
      }
    }
    if (t > hi.timeSec && hi.timeSec <= t + 1e-6
        && (lastSeen == null || hi.timeSec > lastSeen.timeSec)) lastSeen = hi
  }
  return lastSeen
    ? { hullYawDeg: lastSeen.hullYawDeg, turretRelativeYawDeg: lastSeen.turretRelativeYawDeg, timeSec: lastSeen.timeSec }
    : null
}
