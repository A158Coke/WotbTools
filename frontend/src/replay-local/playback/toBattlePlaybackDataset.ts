
import type {
  AgentAiReviewFacet,
  AgentBattleResult,
  AgentPlaybackFacet,
  AgentResultPlayer,
  AgentVehicleTrack,
} from '../../api/agent-replay-facets.js'
import type {
  BaseStateTransition,
  BattleEvent,
  BattlePlaybackDataset,
  DamageLoss,
  OrientationSample,
  OrientationSegment,
  PointsSample,
  PositionSample,
  PositionSegment,
  VehiclePlaybackTrack,
} from '../../types/playback-v2.js'
import {
  buildCanonicalReplayFacts,
  isCurrent,
  entityFirstSeenByAccount,
  displayCapacityAt,
  lastHpSampleAtOrBefore,
  EPS,
  lastPoseIndexAtOrBefore,
  resolveReplayClock,
  type CanonicalReplayFacts,
  type ReplayClock,
} from '../canonical/facts.js'
import { healthTransitions, lifeTransitions, respawnDestroyedTimes, respawnTracks, settlementInitialHp } from './healthTimeline.js'
import { consumableTransitions, moduleCrewTransitions, toLoadout } from './equipmentTimeline.js'
import type { Tankopedia } from '../compute/tankopedia.js'

export { healthTransitions, lifeTransitions, respawnDestroyedTimes, settlementInitialHp } from './healthTimeline.js'
export type { RespawnTrack } from './healthTimeline.js'

export interface ToDatasetOptions {
  canonicalFacts?: CanonicalReplayFacts | null
  tankopedia?: Tankopedia | null
  sampleStepSec?: number
}

export const PERSPECTIVE_TEAM_UNRESOLVED = 'PERSPECTIVE_TEAM_UNRESOLVED'
export const REPLAY_STREAM_TRUNCATED = 'REPLAY_STREAM_TRUNCATED'

const BASE_IDS = ['A', 'B', 'C', 'D'] as const


export type PlaybackClock = ReplayClock

export function resolvePlaybackClock(pb: AgentPlaybackFacet, result?: AgentBattleResult | null): PlaybackClock | null {
  return resolveReplayClock(pb.periods, result, pb.meta.duration)
}


function normDeg(deg: number): number {
  let d = ((deg + 180) % 360 + 360) % 360 - 180
  if (Object.is(d, -0)) d = 0
  return d
}

const RAD2DEG = 180 / Math.PI

function sampleTimes(durationSec: number, stepSec: number): number[] {
  const out: number[] = []
  const n = Math.floor(durationSec / stepSec + EPS)
  for (let k = 0; k <= n; k++) out.push(Number((k * stepSec).toFixed(6)))
  if (durationSec - out[out.length - 1] > EPS) out.push(durationSec)
  return out
}

interface PoseSample {
  t: number
  observedAt: number
  x: number
  y: number
  hull: number | null
  turretRel: number | null
}

function poseSamplesOf(facts: CanonicalReplayFacts, entityId: number, times: number[]): PoseSample[] {
  const pose = facts.poses.get(entityId)
  const turret = facts.turrets.get(entityId)
  const out: PoseSample[] = []
  for (const t of times) {
    const i = lastPoseIndexAtOrBefore(pose, t)
    if (i < 0 || !pose) continue
    const x = pose.x[i], z = pose.z[i]
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue
    const hull = Number.isFinite(pose.yaw[i]) ? normDeg(pose.yaw[i] * RAD2DEG) : null
    const ti = lastPoseIndexAtOrBefore(turret, t)
    out.push({
      t, observedAt: pose.t[i], x, y: z, hull,
      turretRel: hull !== null && ti >= 0 && turret ? normDeg(turret.relYawDeg[ti]) : null,
    })
  }
  return out
}

function positionSegments(facts: CanonicalReplayFacts, entityId: number, samples: PoseSample[]): PositionSegment[] {
  const out: PositionSegment[] = []
  let cur: PositionSample[] = []
  let knowledge: 'OBSERVED' | 'LAST_KNOWN' | null = null
  const flush = () => {
    if (cur.length === 0 || knowledge === null) return
    out.push({ startSec: cur[0].timeSec, endSec: cur[cur.length - 1].timeSec, knowledge, interpolationAllowed: knowledge === 'OBSERVED', samples: cur })
  }
  for (const s of samples) {
    const next = isCurrent(facts, entityId, s.t, s.observedAt) ? 'OBSERVED' : 'LAST_KNOWN'
    if (knowledge !== null && knowledge !== next) {
      flush()
      cur = []
    }
    knowledge = next
    cur.push({ timeSec: s.t, x: s.x, y: s.y })
  }
  flush()
  return out
}

function orientationSegments(facts: CanonicalReplayFacts, entityId: number, samples: PoseSample[]): OrientationSegment[] {
  const out: OrientationSegment[] = []
  let cur: OrientationSample[] = []
  let knowledge: 'CURRENT' | 'LAST_KNOWN' | null = null
  const flush = () => {
    if (cur.length === 0 || knowledge === null) return
    out.push({ startSec: cur[0].timeSec, endSec: cur[cur.length - 1].timeSec, knowledge, samples: cur })
  }
  for (const s of samples) {
    if (s.hull === null) {
      flush()
      cur = []
      knowledge = null
      continue
    }
    const next = isCurrent(facts, entityId, s.t, s.observedAt) ? 'CURRENT' : 'LAST_KNOWN'
    if (knowledge !== null && knowledge !== next) {
      flush()
      cur = []
    }
    knowledge = next
    cur.push({ timeSec: s.t, hullYawDeg: s.hull, turretRelativeYawDeg: s.turretRel })
  }
  flush()
  return out
}


const UNKNOWN_TANK_NAME = '未知坦克'
const UNKNOWN_TANK_CLASS = '未知'

function validTankName(name: unknown): name is string {
  if (typeof name !== 'string' || name.trim() === '') return false
  return !['#', '?', 'vehicle_', 'tankId='].some((p) => name.startsWith(p))
}

export function toBattlePlaybackDataset(
  pb: AgentPlaybackFacet,
  result: AgentBattleResult | null | undefined,
  aiReview: AgentAiReviewFacet,
  options: ToDatasetOptions = {},
): BattlePlaybackDataset | null {
  const facts = options.canonicalFacts === undefined ? buildCanonicalReplayFacts({
    result, aiReview, streamEndRaw: pb.meta.duration,
  }) : options.canonicalFacts
  if (!facts) return null
  const { clock } = facts
  const tankopedia = options.tankopedia ?? null
  const times = sampleTimes(clock.durationSec, options.sampleStepSec ?? 0.5)
  const recorderAccountId = facts.recorderAccountId
  const friendlyTeam = facts.perspectiveTeam

  const vehicleByEid = new Map(pb.vehicles.map((v) => [v.eid, v]))
  const respawnByEid = respawnTracks(pb, clock)
  const settlementPlayers = new Map<number, AgentResultPlayer>()
  for (const p of result?.players ?? []) if (p.account_id > 0) settlementPlayers.set(p.account_id, p)

  const entityStarts = entityFirstSeenByAccount(facts)
  const tracks: VehiclePlaybackTrack[] = []
  for (const player of settlementPlayers.values()) {
    if (!(player.team > 0)) continue
    const entityIds = facts.entityIdsByAccount.get(player.account_id) ?? []
    if (entityIds.length === 0) continue
    const vehicles = entityIds.map((id) => vehicleByEid.get(id)).filter((v): v is AgentVehicleTrack => !!v)
    const tankId = player.tank_id > 0 ? player.tank_id : vehicles[0]?.tank_id ?? 0
    const friendly = friendlyTeam === null ? null : player.team === friendlyTeam

    const firstSeen = entityStarts.get(player.account_id)!
    const posSegs: PositionSegment[] = []
    const oriSegs: OrientationSegment[] = []
    for (const id of entityIds) {
      const poses = poseSamplesOf(facts, id, times)
      posSegs.push(...positionSegments(facts, id, poses))
      oriSegs.push(...orientationSegments(facts, id, poses))
    }
    posSegs.sort((a, b) => a.startSec - b.startSec)
    oriSegs.sort((a, b) => a.startSec - b.startSec)

    const info = tankopedia && tankId > 0 ? tankopedia.info(tankId) : null
    const openingSeed = friendly === true
      ? settlementInitialHp(player)
      : (info?.maxHp != null && info.maxHp > 0 ? info.maxHp : null)
    const health = healthTransitions(facts, entityIds, firstSeen, clock.durationSec, friendly === true, openingSeed, respawnByEid)
    const losses = facts.lossesByVictim.get(player.account_id) ?? []
    const loadout = toLoadout(vehicles, result?.client_version ?? null)
    tracks.push({
      accountId: player.account_id,
      playerName: player.nickname || vehicles[0]?.nickname || '',
      tankId,
      tankName: validTankName(info?.name) ? info!.name : validTankName(player.tank_name) ? player.tank_name
        : validTankName(vehicles[0]?.tank_name) ? vehicles[0].tank_name : UNKNOWN_TANK_NAME,
      tankClass: info?.type ? info.type : UNKNOWN_TANK_CLASS,
      tankTier: typeof info?.tier === 'number' ? info.tier : null,
      team: player.team,
      friendly,
      loadout,
      positionSegments: posSegs,
      orientationSegments: oriSegs,
      healthTransitions: health,
      lifeTransitions: lifeTransitions(facts, entityIds, firstSeen, clock.durationSec, respawnByEid),
      damageLosses: losses.map((l): DamageLoss => ({
        ...l,
        displayCapacityHp: lossCapacity(facts, entityIds, l.toSec),
        transientAllowed: posSegs.some((s) => s.knowledge === 'OBSERVED' && s.startSec <= l.toSec + EPS && s.endSec >= l.toSec - EPS),
      })),
      ...(player.account_id === recorderAccountId && facts.recorderDamageDealt.length
        ? { damageDealtSamples: facts.recorderDamageDealt.map(sample => ({ ...sample })) } : {}),
      consumableTransitions: consumableTransitions(pb, facts, entityIds, clock, loadout),
      moduleCrewTransitions: moduleCrewTransitions(pb, entityIds, clock, recorderAccountId !== null && player.account_id === recorderAccountId),
    })
  }
  if (tracks.length === 0) return null
  tracks.sort((a, b) => a.accountId - b.accountId)

  const events: BattleEvent[] = []
  for (const n of facts.damageNotices) {
    if (n.kind !== 'HIT' || !(n.t >= 0)) continue
    const victim = facts.entities.get(n.victimEntityId)?.accountId
    if (victim === undefined) continue
    const attacker = n.attackerEntityId > 0 ? facts.entities.get(n.attackerEntityId)?.accountId ?? null : null
    const loss = (facts.lossesByVictim.get(victim) ?? []).find((x) => x.damageEventCount === 1 && x.attackerReliable
      && n.t > x.fromSec + EPS && n.t <= x.toSec + EPS)
    events.push({ type: 'DAMAGE', timeSec: n.t, accountId: attacker, targetAccountId: victim, observedHpLoss: loss ? loss.hpLoss : null })
  }
  const respawnDeathsByAccount = respawnDestroyedTimes(facts, respawnByEid)
  for (const d of facts.destroyed) {
    if (!(d.timeSec >= 0)) continue
    if (!respawnDeathsByAccount.has(d.accountId)) {
      events.push({ type: 'DESTROYED', timeSec: d.timeSec, accountId: d.accountId, targetAccountId: null, observedHpLoss: null })
    }
    if (d.killerAccountId !== null && d.killerAccountId !== d.accountId) {
      events.push({ type: 'KILL', timeSec: d.timeSec, accountId: d.killerAccountId, targetAccountId: d.accountId, observedHpLoss: null })
    }
  }
  for (const [accountId, deaths] of respawnDeathsByAccount) {
    let last = Number.NEGATIVE_INFINITY
    for (const t of deaths) {
      if (!(t >= 0) || t <= last + EPS) continue
      last = t
      events.push({
        type: 'DESTROYED', timeSec: Math.min(t, clock.durationSec + EPS),
        accountId, targetAccountId: null, observedHpLoss: null,
      })
    }
  }
  for (const track of tracks) {
    if (recorderAccountId !== null && track.accountId === recorderAccountId) continue
    for (const seg of track.positionSegments) {
      if (seg.knowledge !== 'OBSERVED') continue
      const end = Math.min(clock.durationSec, seg.endSec)
      if (seg.startSec < 0 || end < seg.startSec) continue
      events.push({ type: 'POSITION_REPORTED', timeSec: seg.startSec, accountId: track.accountId, targetAccountId: null, observedHpLoss: null })
      events.push({ type: 'POSITION_STALE', timeSec: end, accountId: track.accountId, targetAccountId: null, observedHpLoss: null })
    }
  }
  events.sort((a, b) => a.timeSec - b.timeSec)

  const limitations = new Set<string>(facts.mappingLimitations)
  if (clock.estimated) limitations.add('CLOCK_ESTIMATED')
  const combatants = new Set([...settlementPlayers.values()].filter((p) => p.team > 0).map((p) => p.account_id))
  if (combatants.size > new Set(tracks.map((t) => t.accountId)).size) limitations.add('PLAYBACK_COMBATANT_TRACK_INCOMPLETE')
  if (friendlyTeam === null) limitations.add(PERSPECTIVE_TEAM_UNRESOLVED)
  if (facts.streamTruncated) limitations.add(REPLAY_STREAM_TRUNCATED)
  const limitationList = [...limitations]

  const mapKey = typeof result?.map_key === 'string' && result.map_key.trim() ? result.map_key.trim().toLowerCase() : null
  return {
    durationSec: clock.durationSec,
    mapCode: mapKey,
    friendlyTeam,
    recorderAccountId,
    vehicles: tracks,
    events,
    pointsSamples: pointsSamples(pb, clock),
    assaultObjectivePresent: pb.assault_objective_present === true,
    baseStates: baseStates(pb, clock),
    limitations: limitationList,
    capability: limitationList.length > 0 ? 'PARTIAL' : 'FULL',
    arenaBonusType: typeof result?.arena_bonus_type === 'number' ? result.arena_bonus_type : null,
  }
}

function lossCapacity(facts: CanonicalReplayFacts, entityIds: number[], toSec: number): number | null {
  const frameT = Math.ceil(toSec - 1e-9)
  for (const id of entityIds) {
    const s = lastHpSampleAtOrBefore(facts, id, frameT)
    if (s && Math.abs(s.t - toSec) <= 1e-6) return displayCapacityAt(facts, id, frameT)
  }
  return null
}

function pointsSamples(pb: AgentPlaybackFacet, clock: ReplayClock): PointsSample[] {
  const out: PointsSample[] = []
  const preBattle = new Map<number, PointsSample>()
  const zeroTeams = new Set<number>()
  for (const p of pb.supremacy_points ?? []) {
    if (p.team !== 1 && p.team !== 2) continue
    const t = p.clock - clock.startRaw
    if (!Number.isFinite(t)) continue
    if (t < 0) {
      const prev = preBattle.get(p.team)
      if (!prev || prev.timeSec < t) preBattle.set(p.team, { timeSec: t, team: p.team, points: p.points })
    } else {
      out.push({ timeSec: t, team: p.team, points: p.points })
      if (t <= 1e-9) zeroTeams.add(p.team)
    }
  }
  for (const seed of preBattle.values()) if (!zeroTeams.has(seed.team)) out.push({ ...seed, timeSec: 0 })
  return out.sort((a, b) => a.timeSec - b.timeSec)
}

function baseStates(pb: AgentPlaybackFacet, clock: ReplayClock): BaseStateTransition[] {
  const projected: BaseStateTransition[] = []
  for (const b of pb.supremacy_bases ?? []) {
    const baseId = BASE_IDS[b.base_id]
    if (!baseId) continue
    projected.push({
      timeSec: b.clock - clock.startRaw, baseId,
      ownerTeam: teamOrNull(b.owner_team), capturingTeam: teamOrNull(b.capturing_team),
      captureProgress: typeof b.capture_progress === 'number' ? b.capture_progress : null,
    })
  }
  for (const a of pb.assault_bases ?? []) {
    projected.push({ timeSec: a.clock - clock.startRaw, baseId: 'BASE', ownerTeam: null, capturingTeam: null, captureProgress: a.progress })
  }
  const out: BaseStateTransition[] = []
  const preBattle = new Map<string, BaseStateTransition>()
  const zeroBases = new Set<string>()
  for (const s of projected) {
    if (!Number.isFinite(s.timeSec)) continue
    if (s.timeSec < 0) {
      const prev = preBattle.get(s.baseId)
      if (!prev || prev.timeSec < s.timeSec) preBattle.set(s.baseId, s)
      continue
    }
    if (s.timeSec > clock.durationSec + 1e-9) continue
    out.push(s)
    if (s.timeSec <= 1e-9) zeroBases.add(s.baseId)
  }
  for (const seed of preBattle.values()) if (!zeroBases.has(seed.baseId)) out.push({ ...seed, timeSec: 0 })
  return out.sort((a, b) => a.timeSec - b.timeSec || (a.baseId < b.baseId ? -1 : a.baseId > b.baseId ? 1 : 0))
}

function teamOrNull(v: number | null | undefined): 1 | 2 | null {
  return v === 1 || v === 2 ? v : null
}
