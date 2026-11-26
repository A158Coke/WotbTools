import type { AgentAiReviewFacet, AgentBattleResult } from '../../api/agent-replay-facets.js'
import type { HpRawState } from './hpRawState.js'

export const EPS = 1e-6

export interface ReplayClock {
  startRaw: number
  durationSec: number
  estimated: boolean
}

export interface PeriodPoint { clock: number; period: number }


export interface CanonicalEntity {
  entityId: number
  accountId: number
  team: 1 | 2
  nickname: string
  tankId: number
  recorder: boolean
}

export interface ObservationWindow {
  entityId: number
  fromSec: number
  toSec: number | null
  materializationHp: number | null
  order: number
}

export type HpSampleKind = 'PROP3' | 'MATERIALIZATION'

export interface HpSample {
  t: number
  entityId: number
  hp: number | null
  kind: HpSampleKind
  rawState: HpRawState | null
  alive: boolean | null
  exact: boolean
  order: number
}

export interface HealthEvent {
  t: number
  entityId: number
  hpRaw: number
  rawState: HpRawState
  sourceEntityId: number
  causeFlag: number
  order: number
}

export type DamageNoticeKind = 'HIT' | 'UNDECODED_VARIANT' | 'SHORT_VARIANT'

export interface DamageNotice {
  t: number
  kind: DamageNoticeKind
  envelopeEntityId: number
  attackerEntityId: number
  victimEntityId: number
  primaryResult: number | null
  secondaryResult: number | null
  order: number
}

export interface PoseTrack {
  entityId: number
  t: number[]
  x: number[]
  y: number[]
  z: number[]
  yaw: number[]
}

export interface TurretTrack {
  entityId: number
  t: number[]
  relYawDeg: number[]
}

export interface CombatLoss {
  fromSec: number
  toSec: number
  hpLoss: number
  attackerAccountId: number | null
  attackerReliable: boolean
  damageEventCount: number
  fromHp: number
  toHp: number
}

export type TerminalKind = 'HP_ZERO' | 'DEATH_SENTINEL' | 'DROWNING' | 'LEGACY_EXACT_ALIVE_FALSE'

export interface TerminalEvidence {
  accountId: number
  entityId: number
  timeSec: number
  order: number
  terminal: boolean
  kind: TerminalKind | null
}

export interface DestroyedFact {
  timeSec: number
  accountId: number
  killerAccountId: number | null
  kind: TerminalKind
}

export interface CanonicalReplayFacts {
  clock: ReplayClock
  battleEndSec: number | null
  streamEndSec: number | null
  streamTruncated: boolean
  winnerTeam: 1 | 2 | null
  recorderAccountId: number | null
  perspectiveTeam: 1 | 2 | null
  recorderEntityIds: number[]
  entities: Map<number, CanonicalEntity>
  entityIdsByAccount: Map<number, number[]>
  vehicleEntityIds: Set<number>
  observation: Map<number, ObservationWindow[]>
  poses: Map<number, PoseTrack>
  turrets: Map<number, TurretTrack>
  hpSamples: Map<number, HpSample[]>
  healthEvents: HealthEvent[]
  damageNotices: DamageNotice[]
  lossesByVictim: Map<number, CombatLoss[]>
  recorderDamageDealt: Array<{ timeSec: number; total: number }>
  destroyed: DestroyedFact[]
  mappingLimitations: string[]
  perspectiveLimitations: string[]
}

export interface CanonicalInput {
  result?: AgentBattleResult | null
  aiReview: AgentAiReviewFacet
  streamEndRaw?: number | null
}


export function observationAt(facts: CanonicalReplayFacts, entityId: number, t: number): ObservationWindow | null {
  for (const w of facts.observation.get(entityId) ?? []) {
    if (!Number.isFinite(t) || t < w.fromSec - 1e-9) continue
    if (w.toSec === null || t < w.toSec - 1e-9) return w
  }
  return null
}

export function lastHpSampleAtOrBefore(facts: CanonicalReplayFacts, entityId: number, t: number): HpSample | null {
  let hit: HpSample | null = null
  for (const s of facts.hpSamples.get(entityId) ?? []) {
    if (s.t > t) break
    hit = s
  }
  return hit
}

export function displayCapacityAt(facts: CanonicalReplayFacts, entityId: number, t: number): number | null {
  let max = 0
  for (const s of facts.hpSamples.get(entityId) ?? []) {
    if (s.t > t + 1e-9) break
    if (s.hp !== null && s.hp > max) max = s.hp
  }
  return max > 0 ? max : null
}

export function lastPoseIndexAtOrBefore(track: { t: number[] } | undefined, t: number): number {
  if (!track) return -1
  let lo = 0, hi = track.t.length - 1, hit = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (track.t[mid] <= t) { hit = mid; lo = mid + 1 } else hi = mid - 1
  }
  return hit
}

export function prop2RelYawDeg(raw: number): number {
  return ((raw & 0xffff) * 360) / 65536 - 180
}

export function entityFirstSeenByAccount(facts: CanonicalReplayFacts): Map<number, Map<number, number | null>> {
  return new Map([...facts.entityIdsByAccount].map(([accountId, ids]) => [accountId, new Map(ids.map(id => {
    const starts = [facts.poses.get(id)?.t[0], facts.hpSamples.get(id)?.[0]?.t, facts.observation.get(id)?.[0]?.fromSec]
      .filter((t): t is number => typeof t === 'number' && Number.isFinite(t))
    return [id, starts.length ? Math.min(...starts) : null]
  }))]))
}

export function activeEntityAt(firstSeen: ReadonlyMap<number, number | null>, t: number): number | null {
  if (!Number.isFinite(t)) return null
  let latest = -Infinity
  for (const first of firstSeen.values()) {
    if (first === null || !Number.isFinite(first)) return null
    if (first <= t + EPS) latest = Math.max(latest, first)
  }
  let owner: number | null = null
  for (const [id, first] of firstSeen) {
    if (first !== null && first <= t + EPS && Math.abs(first - latest) <= EPS) {
      if (owner !== null) return null
      owner = id
    }
  }
  return owner
}

export function isCurrent(facts: CanonicalReplayFacts, entityId: number, t: number, observedAt: number): boolean {
  const w = observationAt(facts, entityId, t)
  return w !== null && observedAt >= w.fromSec - 1e-9
}
