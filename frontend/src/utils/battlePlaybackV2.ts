import type {
  HealthAtResult,
  LifeAtResult,
  VehiclePlaybackTrack,
} from '../types/playback-v2.js'


export {
  cumulativeStatsAtV2,
  damageLogAtV2,
} from './battlePlaybackStatsV2.js'
export {
  ghostAroundV2,
  observedFreezeTimeAt,
  orientationAtV2,
  orientationKnownAt,
  positionAtV2,
  positionCoveredAtV2,
  victimFeedbackAllowedV2,
} from './battlePlaybackPoseV2.js'
export {
  consumableRuntimeSlotsAt,
  moduleCrewStatesAt,
} from './battlePlaybackLoadoutV2.js'

function lastAtOrBefore<T extends { timeSec: number }>(
  items: readonly T[] | null | undefined,
  t: number,
): T | null {
  if (!Array.isArray(items) || items.length === 0) return null
  let lo = 0
  let hi = items.length - 1
  let ans: T | null = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const item = items[mid]
    if (item.timeSec <= t + 1e-6) {
      ans = item
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

export function healthAt(
  track: Pick<VehiclePlaybackTrack, 'healthTransitions'> | null | undefined,
  t: number,
): HealthAtResult | null {
  const tr = lastAtOrBefore(track?.healthTransitions, t)
  if (!tr || tr.knowledge == null
    || (tr.knowledge !== 'CURRENT' && tr.knowledge !== 'LAST_KNOWN')) return null
  if (tr.currentHp != null && (typeof tr.currentHp !== 'number' || !Number.isFinite(tr.currentHp))) return null
  if (tr.currentHp == null && tr.relativeFull !== true) return null
  return {
    currentHp: tr.currentHp,
    knowledge: tr.knowledge,
    source: tr.source ?? 'UNKNOWN',
    displayCapacityHp: tr.displayCapacityHp ?? null,
    relativeFull: tr.relativeFull === true,
    confidence: tr.confidence ?? 'UNKNOWN',
  }
}

export function lifeAt(
  track: Pick<VehiclePlaybackTrack, 'lifeTransitions'> | null | undefined,
  t: number,
): LifeAtResult | null {
  const tr = lastAtOrBefore(track?.lifeTransitions, t)
  if (!tr || (tr.lifeState !== 'ALIVE' && tr.lifeState !== 'DESTROYED')) return null
  return {
    lifeState: tr.lifeState,
    destroyedKnownAtSec: tr.destroyedKnownAtSec ?? null,
  }
}

export type DefLifeState = {
  lifeState: 'ALIVE' | 'DESTROYED'
  destroyedKnownAtSec: number | null
}

type DefLifeFields = {
  death_t: number | null
  death_times?: number[]
  resurrection_times?: number[]
}

export function defLifeAt(def: DefLifeFields | null | undefined, t: number): DefLifeState | null {
  if (def == null || !Number.isFinite(t)) return null
  const death = def.death_t
  if (typeof death !== 'number' || !Number.isFinite(death)) return null
  const res = def.resurrection_times ?? []
  const deaths = def.death_times && def.death_times.length > 1 ? def.death_times : [death]
  if (deaths.length <= 1 && res.length === 0) {
    return { lifeState: t >= death ? 'DESTROYED' : 'ALIVE', destroyedKnownAtSec: death }
  }
  let state: 'ALIVE' | 'DESTROYED' = 'ALIVE'
  let destroyedAt: number | null = null
  let di = 0
  let ri = 0
  while (di < deaths.length || ri < res.length) {
    const nextDeath = di < deaths.length ? deaths[di] : Infinity
    const nextRes = ri < res.length ? res[ri] : Infinity
    if (nextDeath <= t && nextDeath <= nextRes) {
      state = 'DESTROYED'
      destroyedAt = nextDeath
      di += 1
    } else if (nextRes <= t) {
      state = 'ALIVE'
      destroyedAt = null
      ri += 1
    } else {
      break
    }
  }
  return { lifeState: state, destroyedKnownAtSec: destroyedAt }
}

export function healthDisplayAt(
  track: Pick<VehiclePlaybackTrack, 'healthTransitions' | 'lifeTransitions'> | null | undefined,
  t: number,
) {
  if (!track || !Number.isFinite(t)) return null
  const life = lifeAt(track, t)
  const health = healthAt(track, t)
  const destroyed = life?.lifeState === 'DESTROYED'
  if (destroyed) {
    const capacity = health?.displayCapacityHp ?? null
    return {
      currentHp: 0,
      displayCapacityHp: capacity,
      pct: capacity && capacity > 0 ? 0 : null,
      knowledge: 'CURRENT',
      source: 'DESTROYED',
      confidence: health?.confidence ?? 'UNKNOWN',
      destroyed: true,
      relativeFull: false,
      state: 'DESTROYED',
    }
  }

  if (health?.currentHp != null && Number.isFinite(health.currentHp)) {
    const rawCapacity = health.displayCapacityHp
    const capacity = typeof rawCapacity === 'number' && Number.isFinite(rawCapacity) && rawCapacity > 0
      ? rawCapacity
      : null
    const pct = capacity == null ? null : Math.max(0, Math.min(100, (health.currentHp / capacity) * 100))
    const relativeFull = health.relativeFull === true
    return {
      currentHp: health.currentHp,
      displayCapacityHp: capacity,
      pct,
      knowledge: health.knowledge,
      source: health.source,
      confidence: health.confidence,
      destroyed: false,
      relativeFull,
      state: relativeFull && capacity == null ? 'RELATIVE_FULL' : health.knowledge,
    }
  }

  const relativeFull = health?.relativeFull === true
  return {
    currentHp: null,
    displayCapacityHp: null,
    pct: null,
    knowledge: null,
    source: null,
    confidence: health?.confidence ?? 'UNKNOWN',
    destroyed: false,
    relativeFull,
    state: relativeFull ? 'RELATIVE_FULL' : 'UNKNOWN',
  }
}

export function friendlyHealthAt(
  tracks: readonly VehiclePlaybackTrack[] | null | undefined,
  friendly: boolean,
  t: number,
) {
  const perspectiveTracks = (tracks || []).filter(track => track && track.friendly === friendly)
  return aggregateHealth(perspectiveTracks, t)
}

function presentationCapacityAt(track: Pick<VehiclePlaybackTrack, 'healthTransitions'> | null | undefined, t: number) {
  let capacity = null
  for (const tr of track?.healthTransitions || []) {
    if (!tr || !Number.isFinite(tr.timeSec) || tr.timeSec > t + 1e-6) continue
    if (typeof tr.displayCapacityHp === 'number'
      && Number.isFinite(tr.displayCapacityHp) && tr.displayCapacityHp > 0) {
      capacity = tr.displayCapacityHp
    }
  }
  return capacity
}

function aggregateHealth(teamTracks: readonly Pick<VehiclePlaybackTrack, 'healthTransitions' | 'lifeTransitions'>[], t: number) {
  if (teamTracks.length === 0) {
    return { totalMax: 0, knownRemaining: 0, unknownMax: 0, spawnFullCount: 0, openingFullCount: 0, state: 'UNKNOWN' }
  }

  const displays = teamTracks.map(track => healthDisplayAt(track, t))
  const capacities = teamTracks.map(track => presentationCapacityAt(track, t))
  const hasCompletePresentationScale = capacities.every((capacity): capacity is number => capacity != null && capacity > 0)
  const exact = displays.every(display => display
    && display.currentHp != null
    && display.displayCapacityHp != null
    && display.displayCapacityHp > 0
    && (display.knowledge === 'CURRENT' || display.destroyed))
  const allRelativeFull = displays.every(display => display
    && display.relativeFull === true && display.destroyed !== true)
  const knownRemaining = displays.reduce((sum, display) =>
    sum + (display?.currentHp != null && Number.isFinite(display.currentHp) ? display.currentHp : 0), 0)
  const totalMax = hasCompletePresentationScale
    ? capacities.reduce((sum, capacity) => sum + capacity, 0)
    : 0
  const hasKnownEvidence = displays.some(display => display && (
    display.currentHp != null || display.destroyed || display.knowledge === 'LAST_KNOWN'))
  let state = 'UNKNOWN'
  if (exact) {
    state = 'EXACT'
  } else if (allRelativeFull) {
    state = 'FULL_RELATIVE'
  } else if (hasKnownEvidence) {
    state = 'PARTIAL'
  }
  const relativeCount = displays.filter(display => display?.relativeFull === true).length
  return {
    totalMax,
    knownRemaining,
    unknownMax: 0,
    spawnFullCount: relativeCount,
    openingFullCount: relativeCount,
    state,
  }
}
