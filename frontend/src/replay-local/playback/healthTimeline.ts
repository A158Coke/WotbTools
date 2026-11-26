import type { AgentPlaybackFacet, AgentResultPlayer } from '../../api/agent-replay-facets.js'
import type { HealthTransition, LifeTransition } from '../../types/playback-v2.js'
import { activeEntityAt, displayCapacityAt, EPS, isCurrent, lastHpSampleAtOrBefore, type CanonicalReplayFacts, type ReplayClock } from '../canonical/facts.js'
import { isPlausibleHp } from '../canonical/hpRawState.js'


export function settlementInitialHp(player: AgentResultPlayer | undefined): number | null {
  if (!player) return null
  const left = typeof player.hitpoints_left === 'number' ? player.hitpoints_left : null
  const received = typeof player.damage_received === 'number' ? player.damage_received : 0
  if (left === null && received <= 0) return null
  return Math.max(left ?? 0, 0) + Math.max(received, 0)
}

function changePoints(facts: CanonicalReplayFacts, entityIds: number[], durationSec: number): number[] {
  const set = new Set<number>([0])
  for (const id of entityIds) {
    for (const s of facts.hpSamples.get(id) ?? []) set.add(Math.max(0, s.t))
    for (const w of facts.observation.get(id) ?? []) {
      set.add(Math.max(0, w.fromSec))
      if (w.toSec !== null) set.add(Math.max(0, w.toSec))
    }
  }
  return [...set].filter((t) => t <= durationSec + EPS).sort((a, b) => a - b)
}

export function healthTransitions(
  facts: CanonicalReplayFacts, entityIds: number[], firstSeen: Map<number, number | null>, durationSec: number,
  friendly: boolean, openingSeed: number | null, respawnByEid?: Map<number, RespawnTrack>,
): HealthTransition[] {
  const out: HealthTransition[] = []
  let previous: HealthTransition | null = null
  if (openingSeed !== null && openingSeed > 0) {
    previous = {
      timeSec: 0, currentHp: openingSeed, knowledge: 'CURRENT',
      source: friendly ? 'SETTLEMENT_OPENING_HP_EXACT' : 'TANKOPEDIA_BASE_PROVISIONAL',
      displayCapacityHp: openingSeed, relativeFull: false, confidence: friendly ? 'HIGH' : 'MEDIUM',
    }
    out.push(previous)
  }
  const points = new Set(changePoints(facts, entityIds, durationSec))
  for (const id of entityIds) {
    for (const r of respawnTrackOf(respawnByEid, id)?.resurrections ?? []) {
      if (r >= 0) points.add(Math.min(r, durationSec + EPS))
    }
  }
  let replayCapacity: number | null = null
  for (const t of [...points].sort((a, b) => a - b)) {
    const eid = activeEntityAt(firstSeen, t)
    if (eid === null) continue
    const resurrectedAt = lastResurrectionAtOrBefore(respawnTrackOf(respawnByEid, eid), t)
    if (resurrectedAt !== null && !hasPlausibleHpBetween(facts, eid, resurrectedAt, t)) {
      const next: HealthTransition = {
        timeSec: t, currentHp: null, knowledge: 'LAST_KNOWN', source: null,
        displayCapacityHp: replayCapacity, relativeFull: false, confidence: 'UNKNOWN',
      }
      if (!sameHealth(previous, next)) {
        out.push(next)
        previous = next
      }
      continue
    }
    const sample = lastHpSampleAtOrBefore(facts, eid, t)
    if (!sample || sample.hp === null) continue
    const capacity = displayCapacityAt(facts, eid, t)
    if (friendly) replayCapacity = openingSeed !== null && openingSeed > 0 ? openingSeed : capacity ?? sample.hp
    else if (capacity !== null && capacity > 0) replayCapacity = capacity
    const next: HealthTransition = {
      timeSec: t,
      currentHp: sample.hp,
      knowledge: isCurrent(facts, eid, t, sample.t) ? 'CURRENT' : 'LAST_KNOWN',
      source: sample.exact ? 'EXACT_BATTLE_EVENT' : 'INFERRED',
      displayCapacityHp: replayCapacity,
      relativeFull: false,
      confidence: sample.exact ? 'HIGH' : 'MEDIUM',
    }
    if (!sameHealth(previous, next)) {
      out.push(next)
      previous = next
    }
  }
  return out
}

function sameHealth(a: HealthTransition | null, b: HealthTransition): boolean {
  return a !== null && a.currentHp === b.currentHp && a.knowledge === b.knowledge && a.source === b.source
    && a.displayCapacityHp === b.displayCapacityHp && a.relativeFull === b.relativeFull && a.confidence === b.confidence
}

export type RespawnTrack = { deaths: number[]; resurrections: number[] }

export function respawnTracks(pb: AgentPlaybackFacet, clock: ReplayClock): Map<number, RespawnTrack> {
  const out = new Map<number, RespawnTrack>()
  for (const v of pb.vehicles) {
    const declared = v.death_times ?? []
    const resurrections = v.resurrection_times ?? []
    if (declared.length <= 1 && resurrections.length === 0) continue
    const deaths = (declared.length > 0 ? declared : v.death_t != null ? [v.death_t] : [])
      .map((t) => t - clock.startRaw).sort((a, b) => a - b)
    out.set(v.eid, {
      deaths,
      resurrections: resurrections.map((t) => t - clock.startRaw).sort((a, b) => a - b),
    })
  }
  return out
}

function respawnTrackOf(tracks: Map<number, RespawnTrack> | undefined, eid: number): RespawnTrack | null {
  const track = tracks?.get(eid)
  return track && (track.deaths.length > 1 || track.resurrections.length > 0) ? track : null
}

function lastResurrectionAtOrBefore(track: RespawnTrack | null, t: number): number | null {
  let latest: number | null = null
  for (const r of track?.resurrections ?? []) {
    if (r <= t + EPS && (latest === null || r > latest)) latest = r
  }
  return latest
}

function hasPlausibleHpBetween(facts: CanonicalReplayFacts, eid: number, from: number, to: number): boolean {
  for (const s of facts.hpSamples.get(eid) ?? []) {
    if (s.t >= from - EPS && s.t <= to + EPS && isPlausibleHp(s.hp)) return true
  }
  return false
}

export function respawnDestroyedTimes(
  facts: CanonicalReplayFacts, respawnByEid: Map<number, RespawnTrack>,
): Map<number, number[]> {
  const out = new Map<number, number[]>()
  for (const [eid, track] of respawnByEid) {
    if (!respawnTrackOf(respawnByEid, eid) || track.deaths.length === 0) continue
    const accountId = facts.entities.get(eid)?.accountId
    if (accountId === undefined) continue
    const merged = out.get(accountId)
    if (merged) merged.push(...track.deaths)
    else out.set(accountId, [...track.deaths])
  }
  for (const deaths of out.values()) {
    deaths.sort((a, b) => a - b)
    let kept = 0
    for (const t of deaths) {
      if (kept > 0 && t <= deaths[kept - 1] + EPS) continue
      deaths[kept++] = t
    }
    deaths.length = kept
  }
  return out
}

export function lifeTransitions(
  facts: CanonicalReplayFacts, entityIds: number[], firstSeen: Map<number, number | null>, durationSec: number,
  respawnByEid?: Map<number, RespawnTrack>,
): LifeTransition[] {
  const out: LifeTransition[] = []
  let previous: LifeTransition | null = null
  const tracksOf = (eid: number): RespawnTrack | null => respawnTrackOf(respawnByEid, eid)
  const extraPoints: number[] = []
  for (const id of entityIds) {
    const track = tracksOf(id)
    if (!track) continue
    extraPoints.push(...track.deaths, ...track.resurrections)
  }
  const points = changePoints(facts, entityIds, durationSec)
  if (extraPoints.length) {
    const set = new Set(points)
    for (const t of extraPoints) if (t >= 0) set.add(Math.min(t, durationSec + EPS))
    points.length = 0
    points.push(...set)
    points.sort((a, b) => a - b)
  }
  for (const t of points) {
    const eid = activeEntityAt(firstSeen, t)
    if (eid === null) continue
    let destroyedAt: number | null = null
    let resurrected = false
    const track = tracksOf(eid)
    if (track) {
      let di = 0
      let ri = 0
      while (di < track.deaths.length || ri < track.resurrections.length) {
        const d = di < track.deaths.length ? track.deaths[di] : Infinity
        const r = ri < track.resurrections.length ? track.resurrections[ri] : Infinity
        if (d <= t && d <= r) { destroyedAt = d; di += 1 }
        else if (r <= t) { destroyedAt = null; resurrected = true; ri += 1 }
        else break
      }
    } else {
      for (const s of facts.hpSamples.get(eid) ?? []) {
        if (s.t > t) break
        if (s.kind === 'PROP3' && s.exact && s.alive === false) destroyedAt = s.t
      }
    }
    const sample = lastHpSampleAtOrBefore(facts, eid, t)
    const aliveBySample = sample != null && (sample.alive === true || (sample.hp !== null && sample.hp > 0))
    const lifeState = destroyedAt !== null ? 'DESTROYED'
      : (resurrected || aliveBySample) ? 'ALIVE' : null
    if (lifeState === null) continue
    const next: LifeTransition = { timeSec: t, lifeState, destroyedKnownAtSec: destroyedAt }
    if (!previous || previous.lifeState !== next.lifeState || previous.destroyedKnownAtSec !== next.destroyedKnownAtSec) {
      out.push(next)
      previous = next
    }
  }
  return out
}
